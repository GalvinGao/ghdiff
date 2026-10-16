import type { AnnotationSide, SelectedLineRange } from '@pierre/diffs';

import type { SignedAttachments } from './attachments';
import type { CreatedIssue } from './commentIssue';

/** One message inside a thread. */
export interface ThreadComment {
  /** Stable key within the page. */
  key: string;
  /** The comment's id on its forge. Absent for a browser-only comment. */
  remoteId?: number;
  /**
   * The comment's GraphQL node id on its forge. Only a GitHub draft carries
   * one — deleting it addresses the comment by it — and GitLab never sets it.
   */
  remoteNodeId?: string;
  author: string;
  authorAvatarUrl?: string;
  /** True when the forge reports the author as an app rather than a person. */
  authorIsBot?: boolean;
  body: string;
  createdAt?: string;
  /** URL of this message on its forge, when it has one. */
  htmlUrl?: string;
  /**
   * True on a message that is the forge's own draft inside a posted thread —
   * a reply staged on GitHub's pending review. A thread that is a draft as a
   * whole says so on the thread instead.
   */
  staged?: boolean;
}

/**
 * One comment thread on one diff line range.
 *
 * A thread is the unit, not a message: GitHub returns a root comment and its
 * replies as separate rows, and stacking each one as its own card buried the
 * diff. One card holds the whole conversation.
 *
 * This is a single interface rather than a draft-or-thread union on purpose.
 * `DiffLineAnnotation<T>` resolves its metadata through a conditional type, and
 * a union `T` would distribute into a union of annotation shapes the viewer
 * rejects. `kind` discriminates, and the two aliases below name the fields each
 * kind guarantees.
 */
export interface CommentMetadata {
  kind: 'draft' | 'thread';
  /** Identifies the thread, or the draft being composed. */
  key: string;
  range: SelectedLineRange;
  /** Draft only: the text being typed. */
  draftBody?: string;
  /** Thread only: the root first, then replies oldest first. */
  comments?: ThreadComment[];
  /**
   * Thread only: the thread sits on the merge request itself, not on a diff
   * line. It is listed in its own section of the comments tab and is never
   * rendered as an annotation in the diff — `range` is a formality there.
   */
  scope?: 'merge-request';
  /** Thread only: the thread was resolved on the forge. */
  resolved?: boolean;
  /**
   * Thread only: the id the forge's resolve call addresses — GitHub's
   * review-thread node id, GitLab's discussion id. Absent on a thread the
   * forge will not resolve: a local comment, a draft, a GitLab note that is
   * not resolvable.
   */
  threadId?: string;
  /** True while the thread's newest message is on its way to the forge. */
  pending?: boolean;
  /**
   * Thread only: the forge's own draft — a GitHub pending-review thread or a
   * GitLab draft note — published by the verdict.
   */
  staged?: boolean;
  /** Set when the upstream write failed, so the UI can say so. */
  error?: string;
  /**
   * Thread only: the issue this note was filed as. Held in memory and nowhere
   * else, so a reload keeps the `see #N` comment and loses the button. Finding
   * the issue again would be a search, and the comment already names it.
   */
  issue?: CreatedIssue;
  /** True while that issue is on its way to GitHub. */
  creatingIssue?: boolean;
}

/** A comment being typed. It has no upstream identity yet. */
export type DraftComment = CommentMetadata & {
  kind: 'draft';
  draftBody: string;
};

/** A thread that exists in its store, either the forge or browser storage. */
export type CommentThread = CommentMetadata & {
  kind: 'thread';
  comments: ThreadComment[];
};

export function isDraftComment(
  metadata: CommentMetadata
): metadata is DraftComment {
  return metadata.kind === 'draft';
}

/**
 * The item id merge-request-level threads are filed under. It names no file —
 * a NUL can never open one — so the annotations travel the same map and take
 * the same mutation paths as every other thread, and the viewer, which renders
 * items from the diff, never draws them.
 */
export const MERGE_REQUEST_ITEM_ID = '\u0000merge-request';

export function isCommentThread(
  metadata: CommentMetadata
): metadata is CommentThread {
  return (
    metadata.kind === 'thread' &&
    metadata.comments != null &&
    metadata.comments.length > 0
  );
}

/** The message that opened the thread. */
export function threadRoot(thread: CommentThread): ThreadComment {
  return thread.comments[0];
}

/** Distinct authors, in the order they first spoke. */
export function threadParticipants(thread: CommentThread): string[] {
  const seen = new Set<string>();
  const authors: string[] = [];
  for (const comment of thread.comments) {
    if (seen.has(comment.author)) continue;
    seen.add(comment.author);
    authors.push(comment.author);
  }
  return authors;
}

/**
 * Whether the line the thread is anchored to is a real addition or deletion, or
 * an unchanged context line. The sidebar reads this so it does not print a
 * misleading `+` or `-` in front of a context line number.
 */
export type CommentLineType = 'change' | 'context';

/** One thread as the sidebar lists it. */
export interface CommentListEntry {
  itemId: string;
  path: string;
  key: string;
  /** The author who opened the thread. */
  author: string;
  authorAvatarUrl?: string;
  /** Decides whether the People or the Bots filter keeps this thread. */
  authorIsBot: boolean;
  /** The root message, for the preview line. */
  body: string;
  replyCount: number;
  /**
   * Every message in the thread, root first. `body` and `replyCount` are read
   * off this same array where the row is built, so the three cannot disagree;
   * they stay because the list draws a preview and a count and has no use for
   * the rest.
   */
  messages: readonly ThreadComment[];
  participants: string[];
  /** Absent on a merge-request thread: it has no line to name. */
  lineNumber?: number;
  lineType?: CommentLineType;
  side?: AnnotationSide;
  range?: SelectedLineRange;
  /** Set on a thread that sits on the merge request itself. */
  scope?: 'merge-request';
  /** Set on a thread resolved on the forge; it lists after the open ones. */
  resolved?: boolean;
  pending?: boolean;
  /** The forge's own draft; the verdict publishes it. */
  staged?: boolean;
  error?: string;
}

/** The sidebar groups threads by file, in diff order. */
export interface CommentListSection {
  itemId: string;
  path: string;
  fileOrder: number;
  threads: CommentListEntry[];
}

/** Wire shape shared by the comments RPC and the client. */
export interface CommentPayload {
  /** The comment's id on its forge. Absent for a browser-only comment. */
  remoteId?: number;
  /**
   * The comment's GraphQL node id on its forge. Only GitHub sets it — the
   * review-thread mutations address a comment by it where REST takes the
   * numeric `remoteId` — and GitLab never does.
   */
  remoteNodeId?: string;
  path: string;
  author: string;
  authorAvatarUrl?: string;
  authorIsBot?: boolean;
  body: string;
  /** 1-based line on `side`. Absent on a merge-request comment. */
  line?: number;
  /** First line of a multi-line comment, when the forge reported one. */
  startLine?: number;
  /** Absent on a merge-request comment: it sits on no side. */
  side?: AnnotationSide;
  startSide?: AnnotationSide;
  createdAt?: string;
  htmlUrl?: string;
  /** The comment this one replies to. Absent for the root of a thread. */
  replyToId?: number;
  /**
   * Where the comment sits. Absent means a diff line, which is every comment
   * but one kind: a GitLab note on the merge request itself, which has no
   * file or line and is listed in its own section of the comments tab.
   */
  scope?: 'merge-request';
  /**
   * True when the thread was resolved on the forge. It travels on the
   * thread's root payload and only there, because the state belongs to the
   * thread and not to any one message.
   */
  resolved?: boolean;
  /**
   * The id the forge's resolve call addresses the thread by — GitHub's
   * review-thread node id, GitLab's discussion id. Like `resolved`, it
   * travels on the root payload alone, and like `resolved` it is absent on a
   * thread the forge will not resolve, which is how the card knows not to
   * offer the press.
   */
  threadId?: string;
  /**
   * The files the body attaches, at addresses a browser can load. Only a list
   * from GitHub carries it, and it is never written to browser storage: every
   * address in it expires within minutes.
   */
  attachments?: SignedAttachments;
  /**
   * The thread this comment belongs to, stated outright. Only the browser
   * store writes it: a comment kept in this browser has no forge id, so
   * there is no id for a reply to point at. The forges never send this; the
   * client's draft mapping writes it too, so a GitLab draft note — whose ids
   * are a sequence of their own — can never merge into a posted note's
   * thread.
   */
  threadKey?: string;
  /**
   * True when the comment is the forge's own draft — a GitHub pending-review
   * comment or a GitLab draft note — rather than a posted one. Only
   * `drafts.list` and `drafts.create` set it.
   */
  staged?: boolean;
}

/**
 * A line comment staged for the review, as the JSONL export serializes it:
 * the range half of `CreateCommentInput` minus `replyToId`, which no forge's
 * draft path takes, plus the key the browser store knows the thread by.
 */
export interface StagedReviewComment {
  key: string;
  path: string;
  line: number;
  side: AnnotationSide;
  startLine?: number;
  startSide?: AnnotationSide;
  body: string;
}

/** GitHub calls the new file RIGHT and the old file LEFT. */
export function annotationSideFromGitHub(side: string): AnnotationSide {
  return side === 'LEFT' ? 'deletions' : 'additions';
}

export function gitHubSideFromAnnotation(
  side: AnnotationSide
): 'LEFT' | 'RIGHT' {
  return side === 'deletions' ? 'LEFT' : 'RIGHT';
}

export function rangeFromCommentPayload(
  payload: CommentPayload
): SelectedLineRange {
  const start = payload.startLine ?? payload.line ?? 1;
  return {
    start,
    end: payload.line ?? 1,
    side: payload.startSide ?? payload.side ?? 'additions',
    endSide: payload.side ?? 'additions',
  };
}

export function commentPayloadRangeFields(
  range: SelectedLineRange
): Pick<CommentPayload, 'line' | 'side' | 'startLine' | 'startSide'> {
  const endSide = range.endSide ?? range.side ?? 'additions';
  const startSide = range.side ?? endSide;
  // GitHub rejects a multi-line comment whose two ends sit on different sides,
  // so collapse to a single line in that case.
  if (range.start === range.end || startSide !== endSide) {
    return { line: range.end, side: endSide };
  }
  return {
    line: range.end,
    side: endSide,
    startLine: Math.min(range.start, range.end),
    startSide,
  };
}
