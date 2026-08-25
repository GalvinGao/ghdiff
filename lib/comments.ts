import type { AnnotationSide, SelectedLineRange } from '@pierre/diffs';

/** One message inside a thread. */
export interface ThreadComment {
  /** Stable key within the page. */
  key: string;
  /** GitHub review-comment id. Absent for a browser-only comment. */
  githubId?: number;
  author: string;
  authorAvatarUrl?: string;
  body: string;
  createdAt?: string;
  /** URL of this message on github.com, when it has one. */
  htmlUrl?: string;
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
  /** True while the thread's newest message is on its way to GitHub. */
  pending?: boolean;
  /** Set when the upstream write failed, so the UI can say so. */
  error?: string;
}

/** A comment being typed. It has no upstream identity yet. */
export type DraftComment = CommentMetadata & {
  kind: 'draft';
  draftBody: string;
};

/** A thread that exists in its store, either GitHub or browser storage. */
export type CommentThread = CommentMetadata & {
  kind: 'thread';
  comments: ThreadComment[];
};

export function isDraftComment(
  metadata: CommentMetadata
): metadata is DraftComment {
  return metadata.kind === 'draft';
}

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
  /** The root message, for the preview line. */
  body: string;
  replyCount: number;
  participants: string[];
  lineNumber: number;
  lineType: CommentLineType;
  side: AnnotationSide;
  range: SelectedLineRange;
  pending?: boolean;
  error?: string;
}

/** The sidebar groups threads by file, in diff order. */
export interface CommentListSection {
  itemId: string;
  path: string;
  fileOrder: number;
  threads: CommentListEntry[];
}

/** Wire shape shared by `/api/comments` and the client. */
export interface CommentPayload {
  githubId?: number;
  path: string;
  author: string;
  authorAvatarUrl?: string;
  body: string;
  /** 1-based line on `side`. */
  line: number;
  /** First line of a multi-line comment, when GitHub reported one. */
  startLine?: number;
  side: AnnotationSide;
  startSide?: AnnotationSide;
  createdAt?: string;
  htmlUrl?: string;
  /** The comment this one replies to. Absent for the root of a thread. */
  replyToId?: number;
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
  const start = payload.startLine ?? payload.line;
  return {
    start,
    end: payload.line,
    side: payload.startSide ?? payload.side,
    endSide: payload.side,
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
