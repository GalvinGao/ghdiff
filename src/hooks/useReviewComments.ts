import type { DiffLineAnnotation, SelectedLineRange } from '@pierre/diffs';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { m } from '../paraglide/messages.js';
import { readStoredJson, writeStoredString } from './useLocalStorage';
import { useForcedRefetch, usePublish, useSharedQuery } from './useSharedQuery';
import {
  mergeSignedAttachments,
  type SignedAttachment,
  type SignedAttachments,
} from '@/lib/attachments';
import { issueCommentBody } from '@/lib/commentIssue';
import { mergeGitHubThreads } from '@/lib/commentMerge';
import {
  commentPayloadRangeFields,
  type CommentMetadata,
  type CommentPayload,
  isCommentThread,
  rangeFromCommentPayload,
} from '@/lib/comments';
import { groupCommentThreads, threadComments } from '@/lib/commentThreads';
import { entriesWithoutAttachments } from '@/lib/queryCache/persist';
import type { ReviewFileEntry } from '@/lib/reviewData';
import {
  isGitHubTarget,
  type ReviewTarget,
  reviewTargetKey,
  supportsGitHubComments,
} from '@/lib/reviewTarget';
import { rpc, rpcErrorMessage } from '@/lib/rpc/client';
import { localCommentsStorageKey } from '@/lib/storageKeys';

// Where a comment lives depends on the target. A GitHub pull request keeps its
// comments on GitHub, so a comment written here shows up on github.com. Every
// other target has no upstream review thread, so those comments stay in this
// browser and the sidebar says so.

export type CommentStore = 'github' | 'local';

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

export interface ReviewCommentsState {
  store: CommentStore;
  annotationsByItemId: AnnotationsByItemId;
  /** Increases whenever any annotation changes, so items bump their version. */
  revision: number;
  loading: boolean;
  error?: string;
  /** Opens an empty composer on the last line of the selection. */
  startDraft(itemId: string, range: SelectedLineRange): void;
  /**
   * True when a note can be filed as an issue: the diff is on GitHub and there
   * is a token to file it with.
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
  /** Adds a message to the end of a thread that already exists. */
  replyToThread(itemId: string, key: string, body: string): void;
  /** Removes a draft, or deletes a saved comment from its store. */
  removeComment(itemId: string, key: string): void;
  reload(): void;
  /**
   * Signed addresses for every attachment the comments name, by uuid. Kept
   * beside the annotations and not inside them: a renewal replaces this alone,
   * so no item takes a new version and the viewer lays nothing out again.
   */
  attachments: Record<string, SignedAttachment>;
  /**
   * Asks GitHub to sign the comments' attachments again, when one failed to
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
  comments: ReturnType<typeof threadComments>
): Annotation {
  const root = payloads[0];
  return {
    side: root.side,
    lineNumber: root.line,
    metadata: {
      kind: 'thread',
      key,
      range: rangeFromCommentPayload(root),
      comments,
    },
  };
}

/** Flattens every message of every thread back into browser-storage rows. */
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
 * One annotation per thread, on the file each thread's path names. A comment
 * on a path absent from this diff is dropped, which is what happens after a
 * force push rewrites the branch under it.
 */
function threadsByItemId(
  rows: readonly StoredLocalComment[],
  itemIdByPath: ReadonlyMap<string, string>
): Map<string, Annotation[]> {
  // Grouped first, so a reply lands in its root's card instead of stacking as
  // a separate annotation on the same line.
  const byPath = new Map<string, CommentPayload[]>();
  for (const row of rows) {
    const list = byPath.get(row.path) ?? [];
    list.push(row);
    byPath.set(row.path, list);
  }
  const byItemId = new Map<string, Annotation[]>();
  for (const [path, payloads] of byPath) {
    const itemId = itemIdByPath.get(path);
    if (itemId == null) continue;
    const annotations = byItemId.get(itemId) ?? [];
    for (const thread of groupCommentThreads(payloads)) {
      annotations.push(
        annotationFromThread(
          thread.key,
          thread.comments,
          threadComments(thread)
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
}): ReviewCommentsState {
  const { entries, ready, target, viewerAvatarUrl, viewerLogin } = options;
  const store: CommentStore = supportsGitHubComments(target)
    ? 'github'
    : 'local';

  // `target` arrives from a server component, so its object identity changes
  // whenever the RSC payload is read again. Every loader below depends on these
  // derived strings instead, which compare by value.
  const storageKey = localCommentsStorageKey(reviewTargetKey(target));
  const pullOwner = target.kind === 'github-pull' ? target.owner : undefined;
  const pullRepo = target.kind === 'github-pull' ? target.repo : undefined;
  const pullNumber = target.kind === 'github-pull' ? target.number : undefined;
  // The same rule for the issue source, over all three GitHub targets.
  const gitHubOwner = isGitHubTarget(target) ? target.owner : undefined;
  const gitHubRepo = isGitHubTarget(target) ? target.repo : undefined;
  const commitSha = target.kind === 'github-commit' ? target.sha : undefined;
  const compareBase =
    target.kind === 'github-compare' ? target.base : undefined;
  const compareHead =
    target.kind === 'github-compare' ? target.head : undefined;
  const issueSource = useMemo(() => {
    if (pullNumber != null) {
      return { kind: 'github-pull' as const, number: pullNumber };
    }
    if (commitSha != null) {
      return { kind: 'github-commit' as const, sha: commitSha };
    }
    if (compareBase != null && compareHead != null) {
      return {
        kind: 'github-compare' as const,
        base: compareBase,
        head: compareHead,
      };
    }
    return undefined;
  }, [commitSha, compareBase, compareHead, pullNumber]);
  const canCreateIssue =
    gitHubOwner != null && issueSource != null && viewerLogin != null;

  const [state, setState] = useState<CommentState>(EMPTY_STATE);
  const [attachments, setAttachments] =
    useState<SignedAttachments>(NO_ATTACHMENTS);
  // When the addresses on screen arrived, and whether a renewal is on its way.
  // Read in an event handler and never while rendering, so neither is state.
  const signedAtRef = useRef(0);
  const renewingRef = useRef(false);
  // Bumped by every seed, so a renewal that answers after the reviewer moved
  // to another pull request cannot put that one's addresses over this one's.
  const loadGenerationRef = useRef(0);
  // A failure of this tab's own write. A failure to read is the query's.
  const [error, setError] = useState<string | undefined>(undefined);
  const nextKeyRef = useRef(0);

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
  /**
   * The single write path. It produces the next state, writes browser storage
   * from that same value when the store is local, and hands the caller the
   * annotation it touched so a network write can follow.
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

  // A pull request's comments are a shared query: kept on disk without their
  // signed addresses, and carried to every other tab on the same pull request
  // when one of them posts, answers or deletes.
  const queryKey = ['comments.list', pullOwner, pullRepo, pullNumber];
  const listHash = JSON.stringify(queryKey);
  const query = useSharedQuery<CommentPayload[]>({
    queryKey,
    fetch: (signal) => {
      if (pullOwner == null || pullRepo == null || pullNumber == null) {
        throw new Error('No pull request to ask about.');
      }
      return rpc.comments.list(
        { number: pullNumber, owner: pullOwner, repo: pullRepo },
        { signal }
      );
    },
    enabled: ready && store === 'github',
    persist: entriesWithoutAttachments,
  });
  const client = useQueryClient();
  const publish = usePublish();
  const comments = query.data;
  const answeredAt = query.dataUpdatedAt;

  // The diff the threads were last seeded for. A first answer for a diff
  // replaces whatever was drawn; every later one — another tab's post, a
  // reload — is merged in, so a composer with text in it survives it. The
  // tab's own post is published as an answer too, and that one is not merged
  // back: this tab already drew it, under the keys its cards are mounted with.
  const seededRef = useRef<{
    list: string;
    itemIdByPath: ReadonlyMap<string, string>;
    answered: boolean;
  } | null>(null);
  const publishedRef = useRef<CommentPayload[] | undefined>(undefined);

  useEffect(() => {
    if (!ready) return;
    if (store === 'local') {
      loadGenerationRef.current += 1;
      setAttachments(NO_ATTACHMENTS);
      const byItemId = threadsByItemId(
        readStoredJson<StoredLocalComment[]>(storageKey, []),
        itemIdByPath
      );
      setState((current) => ({ byItemId, revision: current.revision + 1 }));
      return;
    }
    const seed = seededRef.current;
    const sameDiff =
      seed != null &&
      seed.list === listHash &&
      seed.itemIdByPath === itemIdByPath;
    if (comments == null) {
      if (!sameDiff) {
        loadGenerationRef.current += 1;
        setAttachments(NO_ATTACHMENTS);
        setState((current) => ({
          byItemId: new Map(),
          revision: current.revision + 1,
        }));
        seededRef.current = { list: listHash, itemIdByPath, answered: false };
      }
      return;
    }
    const seeding = !sameDiff || !seed.answered;
    if (!seeding && comments === publishedRef.current) return;

    signedAtRef.current = answeredAt;
    setAttachments(
      mergeSignedAttachments(comments.map((comment) => comment.attachments))
    );
    const fromGitHub = threadsByItemId(
      comments.map((payload) => ({
        ...payload,
        key: `github-${payload.githubId ?? nextKeyRef.current++}`,
      })),
      itemIdByPath
    );
    if (seeding) {
      loadGenerationRef.current += 1;
      seededRef.current = { list: listHash, itemIdByPath, answered: true };
      setState((current) => ({
        byItemId: fromGitHub,
        revision: current.revision + 1,
      }));
      return;
    }
    setState((current) => ({
      byItemId: mergeGitHubThreads(fromGitHub, current.byItemId),
      revision: current.revision + 1,
    }));
  }, [answeredAt, comments, itemIdByPath, listHash, ready, storageKey, store]);

  /**
   * Tells every other tab what this one just changed on GitHub, by changing
   * the list the cache holds. Only when the cache holds one: a list that never
   * loaded would tell the others this is the only comment there is.
   */
  const publishComments = useCallback(
    (change: (current: CommentPayload[]) => CommentPayload[]) => {
      const key = JSON.parse(listHash) as readonly unknown[];
      const current = client.getQueryData<CommentPayload[]>(key);
      if (current == null) return;
      publish(key, change(current), entriesWithoutAttachments);
      publishedRef.current = client.getQueryData<CommentPayload[]>(key);
    },
    [client, listHash, publish]
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
      if (pullOwner == null || pullRepo == null || pullNumber == null) return;
      try {
        const comment = await rpc.comments.create({
          number: pullNumber,
          owner: pullOwner,
          repo: pullRepo,
          ...input,
        });
        publishComments((current) => [...current, comment]);
        replace(itemId, key, (metadata) => ({
          ...metadata,
          kind: 'thread',
          range: rangeFromCommentPayload(comment),
          comments: [
            {
              key: `gh-${comment.githubId ?? key}`,
              githubId: comment.githubId,
              author: comment.author,
              authorAvatarUrl: comment.authorAvatarUrl,
              authorIsBot: comment.authorIsBot,
              body: comment.body,
              createdAt: comment.createdAt,
              htmlUrl: comment.htmlUrl,
            },
          ],
          draftBody: undefined,
          pending: false,
          error: undefined,
        }));
      } catch (cause) {
        replace(itemId, key, (metadata) => ({
          ...metadata,
          pending: false,
          error: rpcErrorMessage(
            cause,
            m.use_review_comments_could_not_post_that_comment_to_github()
          ),
        }));
      }
    },
    [publishComments, pullNumber, pullOwner, pullRepo, replace]
  );

  const postReply = useCallback(
    async (
      itemId: string,
      key: string,
      pendingKey: string,
      replyToId: number,
      body: string
    ) => {
      if (pullOwner == null || pullRepo == null || pullNumber == null) return;
      try {
        const comment = await rpc.comments.create({
          body,
          number: pullNumber,
          owner: pullOwner,
          repo: pullRepo,
          replyToId,
        });
        publishComments((current) => [...current, comment]);
        // The optimistic message becomes the real one, in place. Its position
        // is already right: GitHub sorts replies by creation time and this is
        // the newest, so the thread does not reorder under the reader.
        replace(itemId, key, (metadata) => ({
          ...metadata,
          comments: (metadata.comments ?? []).map((existing) =>
            existing.key === pendingKey
              ? {
                  key: `gh-${comment.githubId ?? pendingKey}`,
                  githubId: comment.githubId,
                  author: comment.author,
                  authorAvatarUrl: comment.authorAvatarUrl,
                  authorIsBot: comment.authorIsBot,
                  body: comment.body,
                  createdAt: comment.createdAt,
                  htmlUrl: comment.htmlUrl,
                }
              : existing
          ),
          pending: false,
          error: undefined,
        }));
      } catch (cause) {
        // The text stays in the thread, marked as failed. Throwing it away
        // would lose what the reviewer wrote.
        replace(itemId, key, (metadata) => ({
          ...metadata,
          pending: false,
          error: rpcErrorMessage(
            cause,
            m.use_review_comments_could_not_post_this_reply_to_github()
          ),
        }));
      }
    },
    [publishComments, pullNumber, pullOwner, pullRepo, replace]
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
      if (gitHubOwner == null || gitHubRepo == null || issueSource == null) {
        return;
      }
      const fields = commentPayloadRangeFields(range);
      const path =
        fields.side === 'deletions'
          ? previousPathByItemId.get(itemId)
          : pathByItemId.get(itemId);
      if (path == null) return;

      let issue;
      try {
        issue = await rpc.issues.create({
          owner: gitHubOwner,
          repo: gitHubRepo,
          source: issueSource,
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
            m.use_review_comments_could_not_create_the_issue_on_github()
          ),
        }));
        return;
      }

      const body = issueCommentBody(issue.number);
      replace(itemId, key, (metadata) => ({
        ...metadata,
        issue,
        creatingIssue: false,
        pending: store === 'github',
        comments: (metadata.comments ?? []).map((comment) =>
          comment.key === pendingKey ? { ...comment, body } : comment
        ),
      }));
      if (store !== 'github') return;
      const newPath = pathByItemId.get(itemId);
      if (newPath == null) return;
      void postToGitHub(itemId, key, { body, path: newPath, ...fields });
    },
    [
      gitHubOwner,
      gitHubRepo,
      issueSource,
      pathByItemId,
      postToGitHub,
      previousPathByItemId,
      replace,
      store,
    ]
  );

  const saveDraft = useCallback(
    (itemId: string, key: string, body: string, createIssue = false) => {
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
        pending: store === 'github' || asIssue,
        creatingIssue: asIssue,
      }));

      if (asIssue) {
        void fileIssue(itemId, key, `pending-${key}`, trimmed, range);
        return;
      }
      if (store !== 'github') return;
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

  const replyToThread = useCallback(
    (itemId: string, key: string, body: string) => {
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
      const replyToId = metadata.comments[0].githubId;
      if (store === 'github' && replyToId == null) return;

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
        pending: store === 'github',
        error: undefined,
      }));

      if (store !== 'github' || replyToId == null) return;
      void postReply(itemId, key, pendingKey, replyToId, trimmed);
    },
    [postReply, replace, state.byItemId, store, viewerAvatarUrl, viewerLogin]
  );

  const removeComment = useCallback(
    (itemId: string, key: string) => {
      const metadata = state.byItemId
        .get(itemId)
        ?.find((annotation) => annotation.metadata.key === key)?.metadata;
      // Deleting a thread deletes every message ghdiff knows about it. A
      // reply left behind on GitHub would reappear as its own thread.
      const githubIds =
        metadata != null && isCommentThread(metadata)
          ? metadata.comments
              .map((comment) => comment.githubId)
              .filter((id): id is number => id != null)
          : [];

      replace(itemId, key, () => undefined);

      if (
        store !== 'github' ||
        githubIds.length === 0 ||
        pullOwner == null ||
        pullRepo == null
      ) {
        return;
      }
      const remove = async () => {
        try {
          // Newest first, because GitHub refuses to delete a comment that
          // still has replies pointing at it.
          for (const githubId of [...githubIds].reverse()) {
            await rpc.comments.remove({
              commentId: githubId,
              owner: pullOwner,
              repo: pullRepo,
            });
          }
          const removed = new Set(githubIds);
          publishComments((current) =>
            current.filter(
              (comment) =>
                comment.githubId == null || !removed.has(comment.githubId)
            )
          );
        } catch {
          setError(
            m.use_review_comments_could_not_delete_that_thread_on_github_reload()
          );
        }
      };
      void remove();
    },
    [publishComments, pullOwner, pullRepo, replace, state.byItemId, store]
  );

  // A reload asks GitHub, whatever another tab holds, and its answer is merged
  // in: a composer open while the reviewer pressed it keeps its text.
  const reload = useForcedRefetch(queryKey, query.refetch);

  // A thread card is drawn when the viewer scrolls it into the window, which
  // can be long after the list's five minutes, and only a file the browser
  // never loaded in time fails. The list is asked for again, and only its
  // addresses are kept: the threads already on screen are the ones the
  // reviewer is reading, and replacing them would relayout every file.
  const lifetimeMs = attachments.lifetimeMs;
  const renewAttachments = useCallback(() => {
    if (lifetimeMs == null || renewingRef.current) return;
    if (pullOwner == null || pullRepo == null || pullNumber == null) return;
    if (Date.now() - signedAtRef.current < lifetimeMs - RENEW_MARGIN_MS) return;
    renewingRef.current = true;
    const generation = loadGenerationRef.current;
    const renew = async () => {
      try {
        const renewed = await rpc.comments.list({
          number: pullNumber,
          owner: pullOwner,
          repo: pullRepo,
        });
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
  }, [lifetimeMs, pullNumber, pullOwner, pullRepo]);

  return {
    store,
    annotationsByItemId: state.byItemId,
    revision: state.revision,
    loading: query.isFetching,
    error:
      error ??
      (query.error == null
        ? undefined
        : rpcErrorMessage(
            query.error,
            m.use_review_comments_could_not_load_comments()
          )),
    canCreateIssue,
    startDraft,
    saveDraft,
    replyToThread,
    removeComment,
    reload,
    attachments: attachments.byId,
    renewAttachments,
  };
}
