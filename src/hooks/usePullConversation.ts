import { useCallback, useMemo, useRef, useState } from 'react';

import { useForcedRefetch, useSharedQuery } from './useSharedQuery';
import {
  mergeSignedAttachments,
  type SignedAttachment,
  type SignedAttachments,
} from '@/lib/attachments';
import type { ConversationEntry } from '@/lib/pullConversation';
import { entriesWithoutAttachments } from '@/lib/queryCache/persist';
import { rpc } from '@/lib/rpc/client';

// What was said about one pull request as a whole, for the top of the comment
// list. Only a pull request has a conversation: a commit and a compare range
// have no thread on GitHub above their lines.
//
// A failure to read it is reported nowhere. The list is a companion to the line
// threads, which have their own error, and an absent conversation draws exactly
// what a pull request nobody has discussed draws.

export interface PullConversationState {
  entries: readonly ConversationEntry[];
  /** Signed addresses for every attachment the entries name, by uuid. */
  attachments: Record<string, SignedAttachment>;
  /**
   * Asks GitHub to sign the attachments again, when one failed to load and its
   * signature is old enough to be the reason.
   */
  renewAttachments(): void;
  /** Asks again, after the reviewer has added a verdict of their own. */
  reload(): void;
}

const NO_ENTRIES: readonly ConversationEntry[] = [];
const NO_ATTACHMENTS: SignedAttachments = { byId: {} };

// The same margin `useReviewComments` keeps, for the same reason.
const RENEW_MARGIN_MS = 30_000;

export function usePullConversation(options: {
  number?: number;
  owner?: string;
  repo?: string;
}): PullConversationState {
  const { number, owner, repo } = options;
  const queryKey = ['comments.conversation', owner, repo, number];
  const pullHash = JSON.stringify(queryKey);

  // Shared between tabs, and kept on disk without the signed addresses — see
  // `@/lib/queryCache/persist`. A remark another tab's reviewer has just read
  // in arrives here as well.
  const query = useSharedQuery<ConversationEntry[]>({
    queryKey,
    fetch: (signal) => {
      if (owner == null || repo == null || number == null) {
        throw new Error('No pull request to ask about.');
      }
      return rpc.comments.conversation({ number, owner, repo }, { signal });
    },
    enabled: owner != null && repo != null && number != null,
    persist: entriesWithoutAttachments,
  });
  const entries = query.data ?? NO_ENTRIES;

  // A renewal keeps only the addresses of its answer, held apart from the
  // query. The entries on screen are the ones the reviewer is reading, and an
  // entry expanded under the pointer should not be replaced for a picture. The
  // renewal belongs to one pull request, and a newer answer to the query —
  // a reload, or another tab's — carries newer addresses than it does.
  const [renewed, setRenewed] = useState<{
    pull: string;
    signedAt: number;
    attachments: SignedAttachments;
  }>();
  const fromQuery = useMemo(
    () =>
      query.data == null
        ? NO_ATTACHMENTS
        : mergeSignedAttachments(query.data.map((entry) => entry.attachments)),
    [query.data]
  );
  const renewalApplies =
    renewed != null &&
    renewed.pull === pullHash &&
    renewed.signedAt > query.dataUpdatedAt;
  const attachments = renewalApplies ? renewed.attachments : fromQuery;
  const signedAt = renewalApplies ? renewed.signedAt : query.dataUpdatedAt;

  const reload = useForcedRefetch(queryKey, query.refetch);

  // Read in an event handler and never while rendering, so it is not state.
  const renewingRef = useRef(false);
  const lifetimeMs = attachments.lifetimeMs;
  const renewAttachments = useCallback(() => {
    if (lifetimeMs == null || renewingRef.current) return;
    if (owner == null || repo == null || number == null) return;
    if (Date.now() - signedAt < lifetimeMs - RENEW_MARGIN_MS) return;
    renewingRef.current = true;
    void (async () => {
      try {
        const answer = await rpc.comments.conversation({ number, owner, repo });
        setRenewed({
          pull: pullHash,
          signedAt: Date.now(),
          attachments: mergeSignedAttachments(
            answer.map((entry) => entry.attachments)
          ),
        });
      } catch {
        // A picture that stays broken is the whole of the cost.
      } finally {
        renewingRef.current = false;
      }
    })();
  }, [lifetimeMs, number, owner, pullHash, repo, signedAt]);

  return {
    entries,
    attachments: attachments.byId,
    renewAttachments,
    reload,
  };
}
