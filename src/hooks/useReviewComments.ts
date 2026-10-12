import type { DiffLineAnnotation, SelectedLineRange } from '@pierre/diffs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { readStoredJson, writeStoredString } from './useLocalStorage';
import { useForcedRefetch, useSharedQuery } from './useSharedQuery';
import {
  mergeSignedAttachments,
  type SignedAttachment,
  type SignedAttachments,
} from '@/lib/attachments';
import { issueCommentBody } from '@/lib/commentIssue';
import { mergeForgeThreads } from '@/lib/commentMerge';
import {
  commentPayloadRangeFields,
  type CommentMetadata,
  type CommentPayload,
  isCommentThread,
  rangeFromCommentPayload,
  type StagedReviewComment,
} from '@/lib/comments';
import {
  groupCommentThreads,
  threadComment,
  threadComments,
} from '@/lib/commentThreads';
import {
  type ForgeName,
  forgeLabel,
  forgeOfTarget,
  pullRefFromTarget,
  refQueryKey,
  reviewCapabilities,
} from '@/lib/forges';
import { entriesWithoutAttachments } from '@/lib/queryCache/persist';
import type { ReviewFileEntry } from '@/lib/reviewData';
import {
  type ForgeTarget,
  isForgeTarget,
  type ReviewTarget,
  reviewTargetKey,
} from '@/lib/reviewTarget';
import { rpc, rpcErrorMessage, rpcFailure } from '@/lib/rpc/client';
import { localCommentsStorageKey } from '@/lib/storageKeys';
import { m } from '@/paraglide/messages.js';

// Where a comment lives depends on the target. A pull request has an upstream
// review thread, so a comment written here shows up on the forge. Every other target has none, so those comments stay in this
// browser and the sidebar says so.
//
// A comment on a forge target can also be staged instead of posted: it becomes
// the forge's own draft — a thread on the viewer's pending review on GitHub —
// shown here with a Draft chip, and published by the
// verdict. A draft lives on the forge, so it survives a reload and shows on
// the forge's own UI as pending, and one started there lists here.

export type CommentStore = 'forge' | 'local';

type Annotation = DiffLineAnnotation<CommentMetadata>;
export type AnnotationsByItemId = ReadonlyMap<string, readonly Annotation[]>;

/**
 * Annotations and their revision move together: the viewer keys an item update
 * off id and version, so a changed annotation set is meaningless without a new
 * revision. One state object makes that impossible to get wrong.
 */
interface CommentState {
  byItemId: Map<string, Annotation[]>;
  revision: number;
}

const EMPTY_STATE: CommentState = { byItemId: new Map(), revision: 0 };
const NO_ATTACHMENTS: SignedAttachments = { byId: {} };

// Counted from the answer's arrival, a little after GitHub signed it. The same
// margin, for the same reason, as the description's in `usePullDetails`.
const RENEW_MARGIN_MS = 30_000;

/** What one read of a forge's comments answers: the posted, and the drafts. */
interface ForgeComments {
  comments: CommentPayload[];
  drafts: CommentPayload[];
}

/**
 * A forge's answer as it may be kept on disk: every signed address dropped,
 * since each expires within minutes and a stored one would draw a broken
 * picture on the next load.
 */
function persistableComments(answer: ForgeComments): ForgeComments {
  return {
    comments: entriesWithoutAttachments(answer.comments),
    drafts: entriesWithoutAttachments(answer.drafts),
  };
}

/**
 * Whether the store's contents are known right now.
 *
 * A verdict publishes the forge's drafts, so it may only be sent from
 * `'ready'`: a read the reviewer cannot see the answer of could be hiding a
 * draft the verdict would publish unseen. A failed read lands on `'failed'`
 * with the sentence, and stays there — no retry loop — until an explicit
 * retry (`reload`) succeeds.
 */
export type CommentStoreReadiness =
  | { kind: 'reading' }
  | { kind: 'failed'; error: string }
  | { kind: 'ready' };

export interface ReviewCommentsState {
  store: CommentStore;
  annotationsByItemId: AnnotationsByItemId;
  /** Increases whenever any annotation changes, so items bump their version. */
  revision: number;
  /** See {@link CommentStoreReadiness}. */
  readiness: CommentStoreReadiness;
  /** True while a forge write is on the wire; a verdict waits for it. */
  writesPending: boolean;
  /**
   * A delete failed and the forge may still hold what the card no longer
   * shows. The strip along the foot of the screen says so; the store is
   * reconciled from the forge on its own.
   */
  writeError?: string;
  /** Opens an empty composer on the last line of the selection. */
  startDraft(itemId: string, range: SelectedLineRange): void;
  /**
   * True when a note can be filed as an issue: the diff is on a forge and
   * there is a signed-in account to file it with.
   */
  canCreateIssue: boolean;
  /**
   * Turns a draft into a saved comment and writes it to the store. With
   * `createIssue`, the text goes into a new issue first and the comment left
   * on the line is `see #N`.
   */
  saveDraft(
    itemId: string,
    key: string,
    body: string,
    createIssue?: boolean
  ): void;
  /**
   * Turns a draft into the forge's own draft comment: shown at once with a
   * Draft chip, and published by the verdict. Forge targets only.
   */
  stageDraft(itemId: string, key: string, body: string): void;
  /** Adds a message to the end of a thread that already exists. */
  replyToThread(itemId: string, key: string, body: string): void;
  /**
   * Resolves a thread on the forge, or takes the mark back. The flip is
   * optimistic; a failure rolls it back with the forge's own sentence. The
   * promise settles when the call does, so the card can hold its button.
   */
  resolveThread(itemId: string, key: string, resolved: boolean): Promise<void>;
  /** Removes a draft, or deletes a saved comment from its store. */
  removeComment(itemId: string, key: string): void;
  /**
   * One entry per draft thread, for the header's count and the dialog. Only
   * settled rows enter it: see {@link settledStagedThreads}.
   */
  stagedThreads: StagedReviewComment[];
  reload(): void;
  /**
   * Signed addresses for every attachment the comments name, by uuid. Kept
   * beside the annotations and not inside them: a renewal replaces this alone,
   * so no item takes a new version and the viewer lays nothing out again.
   */
  attachments: Record<string, SignedAttachment>;
  /**
   * Asks the forge to sign the comments' attachments again, when one failed to
   * load and its signature is old enough to be the reason.
   */
  renewAttachments(): void;
}

interface StoredLocalComment extends CommentPayload {
  key: string;
}

/** One annotation per thread, anchored where the thread's root sits. */
function annotationFromThread(
  key: string,
  payloads: readonly CommentPayload[],
  comments: ReturnType<typeof threadComments>,
  staged = false
): Annotation {
  const root = payloads[0];
  const flags = {
    ...(root.resolved === true ? { resolved: true } : {}),
    ...(root.threadId != null ? { threadId: root.threadId } : {}),
    ...(staged ? { staged: true } : {}),
  };
  return {
    side: root.side,
    lineNumber: root.line,
    metadata: {
      kind: 'thread',
      key,
      range: rangeFromCommentPayload(root),
      comments,
      ...flags,
    },
  };
}

/**
 * Flattens every message of every thread back into browser-storage rows. Only
 * the local store is written: the forge store holds its comments upstream —
 * drafts included — so there is nothing of its own to keep here.
 */
function toStoredRows(
  state: CommentState,
  pathByItemId: ReadonlyMap<string, string>
): StoredLocalComment[] {
  const rows: StoredLocalComment[] = [];
  for (const [itemId, list] of state.byItemId) {
    const path = pathByItemId.get(itemId);
    if (path == null) continue;
    for (const annotation of list) {
      const metadata = annotation.metadata;
      if (!isCommentThread(metadata)) continue;
      const range = commentPayloadRangeFields(metadata.range);
      for (const comment of metadata.comments) {
        rows.push({
          key: comment.key,
          // Names the thread, so a reply written here is still a reply after a
          // reload. There is no GitHub id for it to point at.
          threadKey: metadata.key,
          path,
          author: comment.author,
          authorIsBot: comment.authorIsBot,
          body: comment.body,
          createdAt: comment.createdAt,
          ...range,
        });
      }
    }
  }
  return rows;
}

/**
 * Whether a thread has a write on the wire. Delete is withheld while it is
 * true: the row it would remove has not reached its final state, and removing
 * it is how a comment ends up on the forge with no card here. The write
 * settling — reconciliation, success or failure — takes the mark back and the
 * press comes back with it.
 */
export function threadWritePending(metadata: CommentMetadata): boolean {
  return metadata.pending === true;
}

/**
 * Merges the open composers of the current map into a freshly placed one. A
 * composer is nobody's stored state: it is the text being written right now,
 * and a re-read — a refresh, a verdict's reconciliation — must not take it
 * away. Threads are never carried: they came from the store the read just
 * placed.
 */
export function carryOverComposers(
  placed: Map<string, Annotation[]>,
  current: ReadonlyMap<string, readonly Annotation[]>
): Map<string, Annotation[]> {
  for (const [itemId, list] of current) {
    const composers = list.filter(
      (annotation) => annotation.metadata.kind === 'draft'
    );
    if (composers.length === 0) continue;
    placed.set(itemId, [...(placed.get(itemId) ?? []), ...composers]);
  }
  return placed;
}

/**
 * The drafts a verdict would publish, as the header's count and the JSONL
 * export read them: every draft thread, and every staged reply inside a posted
 * one. Settled rows only: a draft thread whose write is optimistic or failed is
 * not on the forge to publish, and a row with no remote identity is not
 * addressable there, so none of the three belongs in the count. A posted
 * thread's own write — a resolve that failed, say — does not take a settled
 * reply out of it.
 */
export function settledStagedThreads(
  byItemId: AnnotationsByItemId,
  pathByItemId: ReadonlyMap<string, string>
): StagedReviewComment[] {
  const list: StagedReviewComment[] = [];
  for (const [itemId, annotations] of byItemId) {
    const path = pathByItemId.get(itemId);
    if (path == null) continue;
    for (const annotation of annotations) {
      const metadata = annotation.metadata;
      if (!isCommentThread(metadata)) continue;
      // A posted thread's write state is about that write — a resolve, a
      // reply, a delete — and a staged reply already on the forge is still
      // there whatever became of it, so only a draft thread waits on its own.
      if (
        metadata.staged === true &&
        (metadata.pending === true || metadata.error != null)
      ) {
        continue;
      }
      const range = commentPayloadRangeFields(metadata.range);
      const drafts =
        metadata.staged === true
          ? [{ key: metadata.key, comment: metadata.comments[0] }]
          : metadata.comments
              .filter((comment) => comment.staged === true)
              .map((comment) => ({ key: comment.key, comment }));
      for (const { key, comment } of drafts) {
        if (comment.remoteId == null && comment.remoteNodeId == null) continue;
        list.push({
          key,
          path,
          body: comment.body,
          line: range.line,
          side: range.side,
          ...(range.startLine == null ? {} : { startLine: range.startLine }),
          ...(range.startSide == null ? {} : { startSide: range.startSide }),
        });
      }
    }
  }
  return list;
}

/**
 * The keys a draft from the forge is placed under. A reply staged under a
 * posted thread keeps its own id in the forge's space and its `replyToId`, so
 * the chain walk files it in the thread it answers. Any other draft names its
 * thread outright, because a draft's id need not share the posted comments'
 * sequence — GitLab's draft notes do not — and must never merge into one by it.
 */
export function draftRowKeys(
  payload: CommentPayload,
  id: number
): { key: string; threadKey?: string } {
  if (payload.replyToId != null) return { key: `remote-${id}` };
  return { key: `staged-${id}`, threadKey: `staged-${id}` };
}

/**
 * One annotation per thread, on the file each thread's path names. A
 * comment on a path absent from this diff is dropped, which is what happens
 * after a force push rewrites the branch under it.
 */
function placeRows(
  rows: readonly StoredLocalComment[],
  itemIdByPath: ReadonlyMap<string, string>,
  nextKeyRef: { current: number }
): Map<string, Annotation[]> {
  // A reloaded thread keeps its key, and the key counter restarts with
  // the page — so the next draft must start past every key this store
  // has handed out here, or a fresh `draft-3` and a reloaded `draft-3`
  // name the same thread and saving one overwrites the other.
  for (const row of rows) {
    for (const key of [row.key, row.threadKey]) {
      const match = /^(?:draft|reply)-(\d+)$/.exec(key ?? '');
      if (match != null) {
        nextKeyRef.current = Math.max(nextKeyRef.current, Number(match[1]) + 1);
      }
    }
  }
  // Group first, so a reply lands in its root's card instead of stacking
  // as a separate annotation on the same line.
  const byItemId = new Map<string, Annotation[]>();
  const byPath = Map.groupBy(rows, (row) => row.path);

  for (const [path, payloads] of byPath) {
    const itemId = itemIdByPath.get(path);
    // A comment on a path absent from this diff is dropped. That happens
    // after a force push rewrites the branch under the comment.
    if (itemId == null) continue;
    const annotations = byItemId.get(itemId) ?? [];
    for (const thread of groupCommentThreads(payloads)) {
      annotations.push(
        annotationFromThread(
          thread.key,
          thread.comments,
          threadComments(thread),
          // A draft arrives marked by the server, on the payload itself.
          thread.comments[0].staged === true
        )
      );
    }
    byItemId.set(itemId, annotations);
  }
  return byItemId;
}

export function useReviewComments(options: {
  target: ReviewTarget;
  entries: readonly ReviewFileEntry[];
  viewerLogin?: string;
  /**
   * The signed-in account's picture. A comment written here is shown before
   * GitHub answers, and without this it would draw the initial and then swap
   * to the picture a moment later.
   */
  viewerAvatarUrl?: string;
  /** True once the diff is parsed. Comments only map onto known files. */
  ready: boolean;
  /**
   * True while a verdict submission is in flight. Every comment write is
   * blocked for its duration: the verdict publishes what the forge holds, and
   * a write that lands mid-submit is one its answer cannot account for.
   */
  verdictPending?: boolean;
}): ReviewCommentsState {
  const { entries, ready, target, viewerAvatarUrl, viewerLogin } = options;
  // The forge-backed store answers wherever a pull request is on screen; everything else keeps its comments in this browser. The
  // memos are keyed on the target's own string, so the values are as stable
  // as the strings they replace.
  const targetKey = reviewTargetKey(target);
  const capabilities = useMemo(
    () => reviewCapabilities(target),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetKey]
  );
  const pullRef = useMemo(
    () => pullRefFromTarget(target),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetKey]
  );
  const store: CommentStore = capabilities.commentStore;
  // A local diff is on no forge; its comments stay in this browser, so the
  // forge is only ever read for a forge target's sentences and positions.
  const forge: ForgeName = isForgeTarget(target)
    ? forgeOfTarget(target)
    : 'github';

  // `target` arrives from a server component, so its object identity changes
  // whenever the RSC payload is read again. Every loader below depends on these
  // derived strings instead, which compare by value.
  const storageKey = localCommentsStorageKey(reviewTargetKey(target));

  const [state, setState] = useState<CommentState>(EMPTY_STATE);
  const [writesPending, setWritesPending] = useState(false);
  const [writeError, setWriteError] = useState<string | undefined>(undefined);
  const [attachments, setAttachments] =
    useState<SignedAttachments>(NO_ATTACHMENTS);
  // When the addresses on screen arrived, and whether a renewal is on its way.
  // Read in an event handler and never while rendering, so neither is state.
  const signedAtRef = useRef(0);
  const renewingRef = useRef(false);
  // Bumped by every seed, so a renewal that answers after the reviewer moved
  // to another pull request cannot put that one's addresses over this one's.
  const loadGenerationRef = useRef(0);
  const nextKeyRef = useRef(0);
  // Forge writes in flight (create, stage, reply, resolve, remove). An answer
  // that lands mid-write places a state the write is about to change under
  // it, so placements wait for the writes.
  const activeWritesRef = useRef(0);
  // Set when an answer arrived while writes were in flight; the last write to
  // settle places it.
  const deferredReadRef = useRef(false);
  // The draft author fallback, read at map time rather than depended on: the
  // session viewer arrives after `ready` flips, and a placement that depended
  // on it would run again for a fallback alone.
  const viewerRef = useRef({ avatarUrl: viewerAvatarUrl, login: viewerLogin });
  useEffect(() => {
    viewerRef.current = { avatarUrl: viewerAvatarUrl, login: viewerLogin };
  }, [viewerAvatarUrl, viewerLogin]);
  // The verdict flag, read from the mutations rather than depended on: they
  // are handed to a memoized viewer, and an identity change per flip would
  // re-render the diff for a gate alone.
  const verdictPendingRef = useRef(options.verdictPending === true);
  useEffect(() => {
    verdictPendingRef.current = options.verdictPending === true;
  }, [options.verdictPending]);
  // The committed state, for write completions that must check whether their
  // row is still on the map before reconciling it.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const itemIdByPath = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of entries) {
      if (!map.has(entry.path)) map.set(entry.path, entry.itemId);
    }
    return map;
  }, [entries]);

  const pathByItemId = useMemo(
    () => new Map(entries.map((entry) => [entry.itemId, entry.path])),
    [entries]
  );
  const previousPathByItemId = useMemo(
    () =>
      new Map(
        entries.map((entry) => [entry.itemId, entry.previousPath ?? entry.path])
      ),
    [entries]
  );

  // A note filed as an issue names the repository the diff is in, on any
  // forge target — a commit and a compare range have lines to file from too —
  // and needs an account to file it with. The target is the route's object,
  // so it is memoized on its own key like the refs above.
  const issueTarget = useMemo<ForgeTarget | undefined>(
    () => (isForgeTarget(target) ? target : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetKey]
  );
  const canCreateIssue = issueTarget != null && viewerLogin != null;
  /**
   * The single write path. It produces the next state, writes browser storage
   * from that same value, and hands the caller the annotation it touched so a
   * network write can follow. Only the local store has anything to write: the
   * forge store holds its comments upstream, drafts included.
   */
  const update = useCallback(
    (mutate: (draft: Map<string, Annotation[]>) => void) => {
      setState((current) => {
        const byItemId = new Map(current.byItemId);
        mutate(byItemId);
        const next: CommentState = { byItemId, revision: current.revision + 1 };
        if (store === 'local') {
          writeStoredString(
            storageKey,
            JSON.stringify(toStoredRows(next, pathByItemId))
          );
        }
        return next;
      });
    },
    [pathByItemId, storageKey, store]
  );

  const replace = useCallback(
    (
      itemId: string,
      key: string,
      next: (metadata: CommentMetadata) => CommentMetadata | undefined
    ) => {
      update((draft) => {
        const list = draft.get(itemId);
        if (list == null) return;
        const kept: Annotation[] = [];
        for (const annotation of list) {
          if (annotation.metadata.key !== key) {
            kept.push(annotation);
            continue;
          }
          const metadata = next(annotation.metadata);
          if (metadata != null) kept.push({ ...annotation, metadata });
        }
        draft.set(itemId, kept);
      });
    },
    [update]
  );

  // A pull request's comments and its drafts are one shared query: read as
  // one unit — a drafts answer that fails fails the read, because a verdict
  // publishes drafts the reviewer cannot see otherwise — kept on disk without
  // their signed addresses, and carried to every other tab on the same pull
  // request when one of them posts, answers, stages or deletes. Anonymous is
  // not a reason to skip: both adapters answer an empty list with no token.
  const listKey = [
    'comments.list',
    ...(pullRef == null ? [] : refQueryKey(pullRef)),
  ];
  const listHash = JSON.stringify(listKey);
  const query = useSharedQuery<ForgeComments>({
    queryKey: listKey,
    fetch: async (signal) => {
      if (pullRef == null) throw new Error('No pull request to ask about.');
      const [comments, drafts] = await Promise.all([
        rpc.comments.list(pullRef, { signal }),
        rpc.drafts.list(pullRef, { signal }),
      ]);
      return { comments, drafts: drafts.drafts };
    },
    enabled: ready && store === 'forge' && pullRef != null,
    persist: persistableComments,
  });
  const answer = query.data;
  const answeredAt = query.dataUpdatedAt;

  // After a write the forge took, the list is asked for afresh rather than
  // patched here and published: two tabs patching the same old list at once
  // would each erase the other's comment. The answer reaches every tab on the
  // same pull request, and each merges it in, this one included.
  const reload = useForcedRefetch(listKey, query.refetch);
  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);

  // The diff the threads were last seeded for. A first answer for a diff is
  // placed whole; every later one — another tab's post, this tab's own refresh
  // after a write, a reload — is merged in, so a composer with text in it
  // survives it, and a thread this tab already drew keeps the keys its card is
  // mounted under.
  const seededRef = useRef<{
    list: string;
    itemIdByPath: ReadonlyMap<string, string>;
  } | null>(null);
  // Bumped when the last write settles over an answer that arrived during it,
  // so the placement below runs again with the answer it set aside.
  const [placeTick, setPlaceTick] = useState(0);

  useEffect(() => {
    if (!ready) return;
    if (store === 'local') {
      loadGenerationRef.current += 1;
      setAttachments(NO_ATTACHMENTS);
      const byItemId = placeRows(
        readStoredJson<StoredLocalComment[]>(storageKey, []),
        itemIdByPath,
        nextKeyRef
      );
      setState((current) => ({
        byItemId: carryOverComposers(byItemId, current.byItemId),
        revision: current.revision + 1,
      }));
      return;
    }
    const seed = seededRef.current;
    const sameDiff =
      seed != null &&
      seed.list === listHash &&
      seed.itemIdByPath === itemIdByPath;
    if (answer == null) {
      if (!sameDiff) {
        loadGenerationRef.current += 1;
        setAttachments(NO_ATTACHMENTS);
        setState((current) => ({
          byItemId: carryOverComposers(new Map(), current.byItemId),
          revision: current.revision + 1,
        }));
      }
      return;
    }
    if (activeWritesRef.current > 0) {
      // An answer that lands mid-write places a state the write is about to
      // change under it. The last write to settle places it.
      deferredReadRef.current = true;
      return;
    }

    signedAtRef.current = answeredAt;
    setAttachments(
      mergeSignedAttachments(
        [...answer.comments, ...answer.drafts].map(
          (comment) => comment.attachments
        )
      )
    );
    const fromForge = placeRows(
      [
        ...answer.comments.map((payload) => ({
          ...payload,
          // The key names the row in this store's own key space, so it says
          // where the row lives rather than which forge: `remote-` for a
          // posted comment, beside the `staged-` space the forge's drafts
          // keep, so the two never merge.
          key: `remote-${payload.remoteId ?? nextKeyRef.current++}`,
        })),
        ...answer.drafts.map((payload) => {
          const id = payload.remoteId ?? nextKeyRef.current++;
          return {
            ...payload,
            author:
              payload.author.length > 0
                ? payload.author
                : (viewerRef.current.login ?? m.pull_request_list_you()),
            authorAvatarUrl:
              payload.authorAvatarUrl ?? viewerRef.current.avatarUrl,
            ...draftRowKeys(payload, id),
          };
        }),
      ],
      itemIdByPath,
      nextKeyRef
    );
    if (!sameDiff) {
      loadGenerationRef.current += 1;
      seededRef.current = { list: listHash, itemIdByPath };
      setState((current) => ({
        byItemId: carryOverComposers(fromForge, current.byItemId),
        revision: current.revision + 1,
      }));
      return;
    }
    setState((current) => ({
      byItemId: mergeForgeThreads(fromForge, current.byItemId),
      revision: current.revision + 1,
    }));
  }, [
    answer,
    answeredAt,
    itemIdByPath,
    listHash,
    placeTick,
    ready,
    storageKey,
    store,
  ]);

  // Known exactly when the store's contents are on screen: the local store
  // once the diff is parsed, the forge's once its answer has arrived. A read
  // that failed stays failed — no retry loop — until a retry succeeds.
  const readiness: CommentStoreReadiness =
    store === 'local'
      ? ready
        ? { kind: 'ready' }
        : { kind: 'reading' }
      : query.error != null
        ? {
            kind: 'failed',
            // A refusal the Worker classified as a sign-in question is the
            // forge's bare status line — `401 Unauthorized` in English, in
            // every locale — so the read says it failed in the reader's own.
            error:
              rpcFailure(query.error)?.reason === 'auth-required' ||
              rpcFailure(query.error)?.reason === 'auth-expired'
                ? m.use_review_comments_could_not_load_comments()
                : rpcErrorMessage(
                    query.error,
                    m.use_review_comments_could_not_load_comments()
                  ),
          }
        : answer == null
          ? { kind: 'reading' }
          : { kind: 'ready' };

  // The write bookends. An answer that arrives while writes are in flight
  // waits for the last of them; the count itself is what `writesPending`
  // reports.
  const beginWrite = useCallback(() => {
    activeWritesRef.current += 1;
    setWritesPending(true);
  }, []);
  const endWrite = useCallback(() => {
    activeWritesRef.current -= 1;
    if (activeWritesRef.current > 0) return;
    setWritesPending(false);
    if (!deferredReadRef.current) return;
    deferredReadRef.current = false;
    setPlaceTick((tick) => tick + 1);
  }, []);

  /**
   * Whether the row a write started from is still on the map. A read that
   * landed while the write was on the wire places a map without the
   * optimistic row; the completion then reconciles from the forge instead of
   * replacing a row that is not there.
   */
  const rowExists = useCallback(
    (itemId: string, key: string) =>
      stateRef.current.byItemId
        .get(itemId)
        ?.some((annotation) => annotation.metadata.key === key) === true,
    []
  );

  const startDraft = useCallback(
    (itemId: string, range: SelectedLineRange) => {
      const side = range.endSide ?? range.side;
      if (side == null) return;
      const key = `draft-${nextKeyRef.current++}`;
      update((draft) => {
        // One composer at a time: a second gutter click replaces the open one.
        for (const [id, list] of draft) {
          const kept = list.filter((item) => item.metadata.kind !== 'draft');
          if (kept.length !== list.length) draft.set(id, kept);
        }
        draft.set(itemId, [
          ...(draft.get(itemId) ?? []),
          {
            side,
            lineNumber: range.end,
            metadata: { kind: 'draft', key, draftBody: '', range },
          },
        ]);
      });
    },
    [update]
  );

  const postToGitHub = useCallback(
    async (
      itemId: string,
      key: string,
      input: {
        body: string;
        path: string;
      } & Pick<CommentPayload, 'line' | 'side' | 'startLine' | 'startSide'>
    ) => {
      if (pullRef == null) return;
      beginWrite();
      try {
        const comment = await rpc.comments.create({ ...pullRef, ...input });
        if (!rowExists(itemId, key)) {
          // A read that landed while the create was on the wire placed a map
          // without the optimistic row. The forge has the comment now; a
          // fresh read is what shows it.
          void reloadRef.current();
          return;
        }
        replace(itemId, key, (metadata) => ({
          ...metadata,
          kind: 'thread',
          range: rangeFromCommentPayload(comment),
          comments: [threadComment(comment, key)],
          // The create answer carries the thread's identity where the forge
          // states it — GitHub's review-thread node id. Kept here, so a thread born on this screen can be resolved
          // without a reload.
          ...(comment.threadId == null ? {} : { threadId: comment.threadId }),
          ...(comment.resolved == null ? {} : { resolved: comment.resolved }),
          draftBody: undefined,
          pending: false,
          error: undefined,
        }));
        void reloadRef.current();
      } catch (cause) {
        if (!rowExists(itemId, key)) {
          void reloadRef.current();
          return;
        }
        replace(itemId, key, (metadata) => ({
          ...metadata,
          pending: false,
          error: rpcErrorMessage(
            cause,
            m.use_review_comments_could_not_post_that_comment_to_forge({
              forge: forgeLabel(forge),
            })
          ),
        }));
      } finally {
        endWrite();
      }
    },
    [beginWrite, endWrite, forge, pullRef, replace, rowExists]
  );

  const postDraft = useCallback(
    async (
      itemId: string,
      key: string,
      input: {
        body: string;
        path: string;
        line: number;
        side: NonNullable<CommentPayload['side']>;
        startLine?: number;
        startSide?: CommentPayload['startSide'];
      }
    ) => {
      if (pullRef == null) return;
      beginWrite();
      try {
        const draft = await rpc.drafts.create({ ...pullRef, ...input });
        if (!rowExists(itemId, key)) {
          void reloadRef.current();
          return;
        }
        replace(itemId, key, (metadata) => ({
          ...metadata,
          kind: 'thread',
          range: rangeFromCommentPayload(draft),
          comments: [threadComment(draft, key)],
          ...(draft.threadId == null ? {} : { threadId: draft.threadId }),
          ...(draft.resolved == null ? {} : { resolved: draft.resolved }),
          draftBody: undefined,
          pending: false,
          error: undefined,
        }));
        void reloadRef.current();
      } catch (cause) {
        if (!rowExists(itemId, key)) {
          void reloadRef.current();
          return;
        }
        replace(itemId, key, (metadata) => ({
          ...metadata,
          pending: false,
          error: rpcErrorMessage(
            cause,
            m.use_review_comments_could_not_stage_that_comment_on_forge({
              forge: forgeLabel(forge),
            })
          ),
        }));
      } finally {
        endWrite();
      }
    },
    [beginWrite, endWrite, forge, pullRef, replace, rowExists]
  );

  const postReply = useCallback(
    async (
      itemId: string,
      key: string,
      pendingKey: string,
      replyToId: number,
      body: string
    ) => {
      if (pullRef == null) return;
      beginWrite();
      try {
        const comment = await rpc.comments.create({
          ...pullRef,
          body,
          replyToId,
        });
        if (!rowExists(itemId, key)) {
          void reloadRef.current();
          return;
        }
        // The optimistic message becomes the real one, in place. Its position
        // is already right: GitHub sorts replies by creation time and this is
        // the newest, so the thread does not reorder under the reader.
        replace(itemId, key, (metadata) => ({
          ...metadata,
          comments: (metadata.comments ?? []).map((existing) =>
            existing.key === pendingKey
              ? threadComment(comment, pendingKey)
              : existing
          ),
          ...(comment.threadId == null ? {} : { threadId: comment.threadId }),
          pending: false,
          error: undefined,
        }));
        void reloadRef.current();
      } catch (cause) {
        if (!rowExists(itemId, key)) {
          void reloadRef.current();
          return;
        }
        // The text stays in the thread, marked as failed. Throwing it away
        // would lose what the reviewer wrote.
        replace(itemId, key, (metadata) => ({
          ...metadata,
          pending: false,
          error: rpcErrorMessage(
            cause,
            m.use_review_comments_could_not_post_this_reply_to_forge({
              forge: forgeLabel(forge),
            })
          ),
        }));
      } finally {
        endWrite();
      }
    },
    [beginWrite, endWrite, forge, pullRef, replace, rowExists]
  );

  /**
   * Files the note as an issue, then leaves `see #N` on the line in its place.
   * The typed text is what the thread shows until the issue exists, and what
   * it keeps if the issue fails: throwing it away would lose what the reviewer
   * wrote.
   */
  const fileIssue = useCallback(
    async (
      itemId: string,
      key: string,
      pendingKey: string,
      text: string,
      range: SelectedLineRange
    ) => {
      if (issueTarget == null) return;
      const fields = commentPayloadRangeFields(range);
      if (fields.line == null || fields.side == null) return;
      const path =
        fields.side === 'deletions'
          ? previousPathByItemId.get(itemId)
          : pathByItemId.get(itemId);
      if (path == null) return;

      let issue;
      try {
        issue = await rpc.issues.create({
          target: issueTarget,
          text,
          path,
          line: fields.line,
          startLine: fields.startLine,
          side: fields.side,
        });
      } catch (cause) {
        replace(itemId, key, (metadata) => ({
          ...metadata,
          pending: false,
          creatingIssue: false,
          error: rpcErrorMessage(
            cause,
            m.use_review_comments_could_not_create_the_issue_on_forge({
              forge: forgeLabel(forge),
            })
          ),
        }));
        return;
      }

      const body = issueCommentBody(issue.number);
      replace(itemId, key, (metadata) => ({
        ...metadata,
        issue,
        creatingIssue: false,
        pending: store === 'forge',
        comments: (metadata.comments ?? []).map((comment) =>
          comment.key === pendingKey ? { ...comment, body } : comment
        ),
      }));
      if (store !== 'forge') return;
      const newPath = pathByItemId.get(itemId);
      if (newPath == null) return;
      void postToGitHub(itemId, key, { body, path: newPath, ...fields });
    },
    [
      forge,
      issueTarget,
      pathByItemId,
      postToGitHub,
      previousPathByItemId,
      replace,
      store,
    ]
  );

  const saveDraft = useCallback(
    (itemId: string, key: string, body: string, createIssue = false) => {
      if (verdictPendingRef.current) return;
      const trimmed = body.trim();
      if (trimmed.length === 0) return;
      const asIssue = createIssue && canCreateIssue;

      const existing = state.byItemId
        .get(itemId)
        ?.find((annotation) => annotation.metadata.key === key);
      if (existing == null) return;
      const range = existing.metadata.range;

      // Shown at once as a thread of one, then reconciled with what GitHub
      // returns. ghdiff posts a new top-level comment; it does not reply.
      replace(itemId, key, () => ({
        kind: 'thread',
        key,
        range,
        comments: [
          {
            key: `pending-${key}`,
            author: viewerLogin ?? m.pull_request_list_you(),
            authorAvatarUrl: viewerAvatarUrl,
            body: trimmed,
            createdAt: new Date().toISOString(),
          },
        ],
        pending: store === 'forge' || asIssue,
        creatingIssue: asIssue,
      }));

      if (asIssue) {
        void fileIssue(itemId, key, `pending-${key}`, trimmed, range);
        return;
      }
      if (store !== 'forge') return;
      const path = pathByItemId.get(itemId);
      if (path == null) return;
      void postToGitHub(itemId, key, {
        body: trimmed,
        path,
        ...commentPayloadRangeFields(range),
      });
    },
    [
      canCreateIssue,
      fileIssue,
      pathByItemId,
      postToGitHub,
      replace,
      state.byItemId,
      store,
      viewerAvatarUrl,
      viewerLogin,
    ]
  );

  const stageDraft = useCallback(
    (itemId: string, key: string, body: string) => {
      if (verdictPendingRef.current) return;
      // Staging is the forge's own draft; a local comment already waits here
      // by definition — and no draft RPC is issued for it.
      if (store !== 'forge') return;
      const trimmed = body.trim();
      if (trimmed.length === 0) return;

      const existing = state.byItemId
        .get(itemId)
        ?.find((annotation) => annotation.metadata.key === key);
      if (existing == null) return;
      const range = existing.metadata.range;

      // Shown at once as a draft thread of one, pending while the forge's own
      // draft is written, then reconciled with what the forge returns — the
      // same optimistic flow a posted comment takes.
      replace(itemId, key, () => ({
        kind: 'thread',
        key,
        range,
        comments: [
          {
            key: `staged-${key}`,
            author: viewerLogin ?? m.pull_request_list_you(),
            authorAvatarUrl: viewerAvatarUrl,
            body: trimmed,
            createdAt: new Date().toISOString(),
          },
        ],
        pending: true,
        staged: true,
      }));

      const path = pathByItemId.get(itemId);
      if (path == null) return;
      const fields = commentPayloadRangeFields(range);
      // A draft is always a new thread on a named line, so the range ends are
      // required where a posted comment leaves them optional.
      if (fields.line == null || fields.side == null) return;
      void postDraft(itemId, key, {
        body: trimmed,
        path,
        line: fields.line,
        side: fields.side,
        ...(fields.startLine == null ? {} : { startLine: fields.startLine }),
        ...(fields.startSide == null ? {} : { startSide: fields.startSide }),
      });
    },
    [
      pathByItemId,
      postDraft,
      replace,
      state.byItemId,
      store,
      viewerAvatarUrl,
      viewerLogin,
    ]
  );

  const replyToThread = useCallback(
    (itemId: string, key: string, body: string) => {
      if (verdictPendingRef.current) return;
      const trimmed = body.trim();
      if (trimmed.length === 0) return;

      const metadata = state.byItemId
        .get(itemId)
        ?.find((annotation) => annotation.metadata.key === key)?.metadata;
      if (metadata == null || !isCommentThread(metadata)) return;

      // GitHub files a reply under the thread of the comment it answers, and
      // the root is the comment that identifies the thread. A thread whose
      // root has not reached GitHub yet cannot take a reply, so the composer
      // stays closed until the root has posted.
      const replyToId = metadata.comments[0].remoteId;
      if (store === 'forge' && replyToId == null) return;

      const pendingKey = `reply-${nextKeyRef.current++}`;
      replace(itemId, key, (current) => ({
        ...current,
        comments: [
          ...(current.comments ?? []),
          {
            key: pendingKey,
            author: viewerLogin ?? m.pull_request_list_you(),
            authorAvatarUrl: viewerAvatarUrl,
            body: trimmed,
            createdAt: new Date().toISOString(),
          },
        ],
        pending: store === 'forge',
        error: undefined,
      }));

      if (store !== 'forge' || replyToId == null) return;
      void postReply(itemId, key, pendingKey, replyToId, trimmed);
    },
    [postReply, replace, state.byItemId, store, viewerAvatarUrl, viewerLogin]
  );

  const resolveThread = useCallback(
    async (itemId: string, key: string, resolved: boolean): Promise<void> => {
      if (verdictPendingRef.current) return;
      const metadata = state.byItemId
        .get(itemId)
        ?.find((annotation) => annotation.metadata.key === key)?.metadata;
      if (metadata == null || !isCommentThread(metadata)) return;
      // The resolve call addresses the thread by the id its forge reported
      // on the root payload; a thread without one has nothing to send.
      const threadId = metadata.threadId;
      if (store !== 'forge' || pullRef == null || threadId == null) return;

      // The flip is optimistic: the card collapses or reopens at once, and a
      // refusal rolls the mark back with the forge's own sentence.
      replace(itemId, key, (current) => ({
        ...current,
        resolved,
        error: undefined,
      }));
      beginWrite();
      try {
        await rpc.comments.resolve({ ...pullRef, threadId, resolved });
        void reloadRef.current();
      } catch (cause) {
        if (!rowExists(itemId, key)) {
          void reloadRef.current();
          return;
        }
        replace(itemId, key, (current) => ({
          ...current,
          resolved: metadata.resolved,
          error: rpcErrorMessage(
            cause,
            resolved
              ? m.use_review_comments_could_not_resolve_that_thread_on_forge({
                  forge: forgeLabel(forge),
                })
              : m.use_review_comments_could_not_unresolve_that_thread_on_forge({
                  forge: forgeLabel(forge),
                })
          ),
        }));
      } finally {
        endWrite();
      }
    },
    [
      beginWrite,
      endWrite,
      forge,
      pullRef,
      replace,
      rowExists,
      state.byItemId,
      store,
    ]
  );

  const removeComment = useCallback(
    (itemId: string, key: string) => {
      if (verdictPendingRef.current) return;

      // A reply staged under a posted thread is removed on its own: it is the
      // viewer's draft, and the rest of the thread is published and stays.
      const holder = state.byItemId
        .get(itemId)
        ?.map((annotation) => annotation.metadata)
        .find(
          (candidate) =>
            isCommentThread(candidate) &&
            candidate.staged !== true &&
            candidate.comments.some(
              (comment) => comment.key === key && comment.staged === true
            )
        );
      if (
        holder != null &&
        isCommentThread(holder) &&
        store === 'forge' &&
        pullRef != null
      ) {
        if (threadWritePending(holder)) return;
        const message = holder.comments.find((comment) => comment.key === key);
        if (message?.remoteId == null && message?.remoteNodeId == null) return;
        const threadKey = holder.key;
        replace(itemId, threadKey, (current) => ({
          ...current,
          pending: true,
          error: undefined,
        }));
        setWriteError(undefined);
        const removeStagedReply = async () => {
          beginWrite();
          try {
            await rpc.drafts.remove({
              ...pullRef,
              ...(message.remoteId == null ? {} : { id: message.remoteId }),
              ...(message.remoteNodeId == null
                ? {}
                : { nodeId: message.remoteNodeId }),
            });
            replace(itemId, threadKey, (current) =>
              isCommentThread(current)
                ? {
                    ...current,
                    pending: false,
                    comments: current.comments.filter(
                      (comment) => comment.key !== key
                    ),
                  }
                : current
            );
          } catch (cause) {
            replace(itemId, threadKey, (current) => ({
              ...current,
              pending: false,
            }));
            setWriteError(
              rpcErrorMessage(
                cause,
                m.use_review_comments_could_not_delete_that_draft_on_forge({
                  forge: forgeLabel(forge),
                })
              )
            );
          } finally {
            endWrite();
            void reloadRef.current();
          }
        };
        void removeStagedReply();
        return;
      }

      const metadata = state.byItemId
        .get(itemId)
        ?.find((annotation) => annotation.metadata.key === key)?.metadata;
      const thread =
        metadata != null && isCommentThread(metadata) ? metadata : undefined;

      // A composer cancelled, or a browser-only comment: gone at once, and
      // there is nowhere else to delete it.
      if (thread == null || store !== 'forge' || pullRef == null) {
        replace(itemId, key, () => undefined);
        return;
      }

      // A write still on the wire: deleting the row now is how a comment ends
      // up on the forge with no card here. The card enables Delete again once
      // the write settles.
      if (threadWritePending(thread)) return;

      // Deleting a thread deletes every message ghdiff knows about it. A
      // reply left behind on GitHub would reappear as its own thread.
      const remoteIds = thread.comments
        .map((comment) => comment.remoteId)
        .filter((id): id is number => id != null);
      const root = thread.comments[0];

      if (thread.staged === true) {
        // A draft is a single comment, and the drafts endpoint addresses it
        // by the id its list reported — GitHub's node id.
        if (root.remoteId == null && root.remoteNodeId == null) {
          // The create never landed, so there is nothing upstream to delete.
          replace(itemId, key, () => undefined);
          return;
        }
        // The row stays on the map, marked pending, until the forge answers:
        // a delete that fails must not leave a forge-side ghost with no card
        // here. The failure is surfaced on the strip and the store is
        // reconciled from the forge.
        replace(itemId, key, (current) => ({
          ...current,
          pending: true,
          error: undefined,
        }));
        setWriteError(undefined);
        const removeDraft = async () => {
          beginWrite();
          try {
            await rpc.drafts.remove({
              ...pullRef,
              ...(root.remoteId == null ? {} : { id: root.remoteId }),
              ...(root.remoteNodeId == null
                ? {}
                : { nodeId: root.remoteNodeId }),
            });
            if (rowExists(itemId, key)) {
              replace(itemId, key, () => undefined);
            }
            void reloadRef.current();
          } catch (cause) {
            if (!rowExists(itemId, key)) {
              void reloadRef.current();
              return;
            }
            replace(itemId, key, (current) => ({
              ...current,
              pending: false,
            }));
            setWriteError(
              rpcErrorMessage(
                cause,
                m.use_review_comments_could_not_delete_that_draft_on_forge({
                  forge: forgeLabel(forge),
                })
              )
            );
            void reloadRef.current();
          } finally {
            endWrite();
          }
        };
        void removeDraft();
        return;
      }

      if (remoteIds.length === 0) {
        // The create never landed, so there is nothing upstream to delete.
        replace(itemId, key, () => undefined);
        return;
      }
      replace(itemId, key, (current) => ({
        ...current,
        pending: true,
        error: undefined,
      }));
      setWriteError(undefined);
      const remove = async () => {
        beginWrite();
        try {
          // Newest first, because GitHub refuses to delete a comment that
          // still has replies pointing at it.
          for (const remoteId of remoteIds.toReversed()) {
            await rpc.comments.remove({
              ...pullRef,
              commentId: remoteId,
            });
          }
          if (rowExists(itemId, key)) {
            replace(itemId, key, () => undefined);
          }
          void reloadRef.current();
        } catch (cause) {
          if (!rowExists(itemId, key)) {
            void reloadRef.current();
            return;
          }
          replace(itemId, key, (current) => ({
            ...current,
            pending: false,
          }));
          setWriteError(
            rpcErrorMessage(
              cause,
              m.use_review_comments_could_not_delete_that_thread_on_forge({
                forge: forgeLabel(forge),
              })
            )
          );
          void reloadRef.current();
        } finally {
          endWrite();
        }
      };
      void remove();
    },
    [
      beginWrite,
      endWrite,
      forge,
      pullRef,
      replace,
      rowExists,
      state.byItemId,
      store,
    ]
  );

  // A thread card is drawn when the viewer scrolls it into the window, which
  // can be long after the list's five minutes, and only a file the browser
  // never loaded in time fails. The list is asked for again, and only its
  // addresses are kept: the threads already on screen are the ones the
  // reviewer is reading, and replacing them would relayout every file.
  const lifetimeMs = attachments.lifetimeMs;
  const renewAttachments = useCallback(() => {
    if (lifetimeMs == null || renewingRef.current || pullRef == null) return;
    if (Date.now() - signedAtRef.current < lifetimeMs - RENEW_MARGIN_MS) return;
    renewingRef.current = true;
    const generation = loadGenerationRef.current;
    const renew = async () => {
      try {
        const renewed = await rpc.comments.list(pullRef);
        if (generation !== loadGenerationRef.current) return;
        signedAtRef.current = Date.now();
        setAttachments(
          mergeSignedAttachments(renewed.map((comment) => comment.attachments))
        );
      } catch {
        // A picture that stays broken is the whole of the cost, and the next
        // failure after the margin asks again.
      } finally {
        renewingRef.current = false;
      }
    };
    void renew();
  }, [lifetimeMs, pullRef]);

  // One entry per settled draft thread, in the shape the dialog lists and the
  // JSONL export takes. The filtering is `settledStagedThreads` above.
  const stagedThreads = useMemo(
    () => settledStagedThreads(state.byItemId, pathByItemId),
    [pathByItemId, state.byItemId]
  );

  return {
    store,
    annotationsByItemId: state.byItemId,
    revision: state.revision,
    readiness,
    writesPending,
    writeError,
    canCreateIssue,
    startDraft,
    saveDraft,
    stageDraft,
    replyToThread,
    resolveThread,
    removeComment,
    stagedThreads,
    reload,
    attachments: attachments.byId,
    renewAttachments,
  };
}
