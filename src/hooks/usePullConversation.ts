import { useCallback, useEffect, useRef, useState } from 'react';

import {
  mergeSignedAttachments,
  type SignedAttachment,
  type SignedAttachments,
} from '@/lib/attachments';
import type { ConversationEntry } from '@/lib/pullConversation';
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
  const [entries, setEntries] = useState(NO_ENTRIES);
  const [attachments, setAttachments] =
    useState<SignedAttachments>(NO_ATTACHMENTS);
  // One request at a time. A reload, or a move to another pull request,
  // cancels the one in flight, so a slow answer cannot overwrite a newer one.
  const controllerRef = useRef<AbortController | null>(null);
  // Read in an event handler and never while rendering, so neither is state.
  const signedAtRef = useRef(0);
  const renewingRef = useRef(false);

  const load = useCallback(async () => {
    if (owner == null || repo == null || number == null) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const answer = await rpc.comments.conversation(
        { number, owner, repo },
        { signal: controller.signal }
      );
      if (controller.signal.aborted) return;
      signedAtRef.current = Date.now();
      setEntries(answer);
      setAttachments(
        mergeSignedAttachments(answer.map((entry) => entry.attachments))
      );
    } catch {
      // Nothing to say. See above.
    }
  }, [number, owner, repo]);

  useEffect(() => {
    setEntries(NO_ENTRIES);
    setAttachments(NO_ATTACHMENTS);
    void load();
    return () => controllerRef.current?.abort();
  }, [load]);

  const reload = useCallback(() => {
    void load();
  }, [load]);

  // Only the addresses are kept from the second answer. The entries on screen
  // are the ones the reviewer is reading, and an entry expanded under the
  // pointer should not be replaced for a picture.
  const lifetimeMs = attachments.lifetimeMs;
  const renewAttachments = useCallback(() => {
    if (lifetimeMs == null || renewingRef.current) return;
    if (owner == null || repo == null || number == null) return;
    if (Date.now() - signedAtRef.current < lifetimeMs - RENEW_MARGIN_MS) return;
    renewingRef.current = true;
    void (async () => {
      try {
        const answer = await rpc.comments.conversation({ number, owner, repo });
        signedAtRef.current = Date.now();
        setAttachments(
          mergeSignedAttachments(answer.map((entry) => entry.attachments))
        );
      } catch {
        // A picture that stays broken is the whole of the cost.
      } finally {
        renewingRef.current = false;
      }
    })();
  }, [lifetimeMs, number, owner, repo]);

  return {
    entries,
    attachments: attachments.byId,
    renewAttachments,
    reload,
  };
}
