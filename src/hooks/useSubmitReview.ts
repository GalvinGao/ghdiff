import { useCallback, useEffect, useState } from 'react';

import type { ReviewEvent, SubmittedReview } from '@/lib/reviewDecision';
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
  submit(
    event: ReviewEvent,
    body: string
  ): Promise<SubmittedReview | undefined>;
  /** Clears the error and the last verdict, for a dialog opening again. */
  reset(): void;
}

export function useSubmitReview(options: {
  number?: number;
  owner?: string;
  repo?: string;
  token?: string;
}): SubmitReviewState {
  const { number, owner, repo, token } = options;
  const [pending, setPending] = useState<ReviewEvent | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [submitted, setSubmitted] = useState<SubmittedReview | undefined>(
    undefined
  );
  const [latest, setLatest] = useState<SubmittedReview | undefined>(undefined);

  // What GitHub already has. It is one extra fact about a pull request whose
  // diff is the screen, so a failure to read it is reported nowhere: the header
  // goes on offering a first review, which is what it would have said anyway.
  useEffect(() => {
    setLatest(undefined);
    if (owner == null || repo == null || number == null) return undefined;
    const controller = new AbortController();
    void (async () => {
      try {
        const answer = await rpc.reviews.mine(
          { number, owner, repo },
          { context: { token }, signal: controller.signal }
        );
        if (!controller.signal.aborted) setLatest(answer.review);
      } catch {
        // Nothing to say. See above.
      }
    })();
    return () => controller.abort();
  }, [number, owner, repo, token]);

  const submit = useCallback(
    async (event: ReviewEvent, body: string) => {
      if (owner == null || repo == null || number == null) return undefined;
      setPending(event);
      setError(undefined);
      try {
        const review = await rpc.reviews.submit(
          { body, event, number, owner, repo },
          { context: { token } }
        );
        setSubmitted(review);
        // The verdict just sent is now the verdict on record, and GitHub has
        // said so in its answer, so nothing is asked again to find that out.
        setLatest(review);
        return review;
      } catch (cause) {
        // GitHub refuses an approval of your own pull request, and a token
        // without write access to the repository, in its own words. Those
        // words are the whole of what the reviewer needs, so they are what the
        // dialog shows.
        setError(rpcErrorMessage(cause, 'That review was not submitted.'));
        return undefined;
      } finally {
        setPending(undefined);
      }
    },
    [number, owner, repo, token]
  );

  // The verdict on record survives this, because it is a fact about the pull
  // request rather than the residue of a dialog that was open a moment ago.
  const reset = useCallback(() => {
    setError(undefined);
    setSubmitted(undefined);
  }, []);

  return { error, latest, pending, reset, submit, submitted };
}
