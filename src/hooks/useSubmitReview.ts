import { useCallback, useState } from 'react';

import { m } from '../paraglide/messages.js';
import { usePublish, useSharedQuery } from './useSharedQuery';
import type {
  ReviewEvent,
  SubmittedReview,
  TeamReview,
} from '@/lib/reviewDecision';
import { rpc, rpcErrorMessage } from '@/lib/rpc/client';

// The state of one reviewer's verdict on one pull request: the one they left
// before this visit, and the one they are sending now.
//
// The event that is in flight is the state, rather than a boolean: a dialog
// with three buttons has to disable all three and say which one it is waiting
// on, and a bare boolean cannot say which.

export interface SubmitReviewState {
  /** The event GitHub is deciding on, or undefined when nothing is in flight. */
  pending?: ReviewEvent;
  error?: string;
  /** The last verdict GitHub recorded, for the line the header then shows. */
  submitted?: SubmittedReview;
  /**
   * The verdict on record: what GitHub already had when the review opened, and
   * then whatever this reviewer sends. Absent until GitHub has answered, and
   * absent for good for a reviewer who has not reviewed this pull request —
   * which is also every reviewer with no token, since the verdict is the
   * token's own.
   */
  latest?: SubmittedReview;
  /**
   * The newest verdicts other people left, newest first. Empty until GitHub
   * has answered, and for good when nobody else has reviewed.
   */
  team: TeamReview[];
  submit(
    event: ReviewEvent,
    body: string
  ): Promise<SubmittedReview | undefined>;
  /** Clears the error and the last verdict, for a dialog opening again. */
  reset(): void;
}

const NO_REVIEWS: TeamReview[] = [];

export function useSubmitReview(options: {
  number?: number;
  owner?: string;
  repo?: string;
}): SubmitReviewState {
  const { number, owner, repo } = options;
  const [pending, setPending] = useState<ReviewEvent | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [submitted, setSubmitted] = useState<SubmittedReview | undefined>(
    undefined
  );

  // What GitHub already has. It is one extra fact about a pull request whose
  // diff is the screen, so a failure to read it is reported nowhere: the header
  // goes on offering a first review, which is what it would have said anyway.
  // The same holds for the team's verdicts: the dialog lists none, which is
  // what it would list for a pull request nobody else has reviewed.
  //
  // Both are shared between tabs and kept on disk. Neither carries a signed
  // address, and a verdict a reviewer gave in one tab is a verdict the header
  // of every other tab on the same pull request should say.
  const enabled = owner != null && repo != null && number != null;
  const pullRef = () => {
    if (owner == null || repo == null || number == null) {
      throw new Error('No pull request to ask about.');
    }
    return { number, owner, repo };
  };
  const mineKey = ['reviews.mine', owner, repo, number];
  const mine = useSharedQuery({
    queryKey: mineKey,
    fetch: (signal) => rpc.reviews.mine(pullRef(), { signal }),
    enabled,
    persist: true,
  });
  const teamQuery = useSharedQuery({
    queryKey: ['reviews.team', owner, repo, number],
    fetch: (signal) => rpc.reviews.team(pullRef(), { signal }),
    enabled,
    persist: true,
  });
  const latest = mine.data?.review;
  const team = teamQuery.data?.reviews ?? NO_REVIEWS;
  const publish = usePublish();
  const mineHash = JSON.stringify(mineKey);

  const submit = useCallback(
    async (event: ReviewEvent, body: string) => {
      if (owner == null || repo == null || number == null) return undefined;
      setPending(event);
      setError(undefined);
      try {
        const review = await rpc.reviews.submit({
          body,
          event,
          number,
          owner,
          repo,
        });
        setSubmitted(review);
        // The verdict just sent is now the verdict on record, and GitHub has
        // said so in its answer, so nothing is asked again to find that out —
        // in this tab or in any other open on the same pull request.
        publish(JSON.parse(mineHash) as readonly unknown[], { review }, true);
        return review;
      } catch (cause) {
        // GitHub refuses an approval of your own pull request, and a token
        // without write access to the repository, in its own words. Those
        // words are the whole of what the reviewer needs, so they are what the
        // dialog shows.
        setError(
          rpcErrorMessage(
            cause,
            m.use_submit_review_could_not_submit_this_review()
          )
        );
        return undefined;
      } finally {
        setPending(undefined);
      }
    },
    [mineHash, number, owner, publish, repo]
  );

  // The verdict on record survives this, because it is a fact about the pull
  // request rather than the residue of a dialog that was open a moment ago.
  const reset = useCallback(() => {
    setError(undefined);
    setSubmitted(undefined);
  }, []);

  return { error, latest, pending, reset, submit, submitted, team };
}
