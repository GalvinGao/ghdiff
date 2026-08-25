import type { AnnotationSide, SelectedLineRange } from '@pierre/diffs';

/**
 * One comment on one diff line range.
 *
 * This is a single interface rather than a draft-or-saved union on purpose.
 * `DiffLineAnnotation<T>` resolves its metadata through a conditional type, and
 * a union `T` would distribute into a union of annotation shapes that the
 * viewer will not accept. `kind` discriminates, and the two aliases below name
 * the fields each kind guarantees.
 */
export interface CommentMetadata {
  kind: 'draft' | 'saved';
  /** Client-side identity, unique for the life of the page. */
  key: string;
  body: string;
  range: SelectedLineRange;
  /** Set once the comment is saved. */
  author?: string;
  authorAvatarUrl?: string;
  /** GitHub review-comment id. Absent for a browser-only comment. */
  githubId?: number;
  createdAt?: string;
  /** URL of the comment on github.com, when it has one. */
  htmlUrl?: string;
  /** True while the comment is on its way to GitHub. */
  pending?: boolean;
  /** Set when the upstream write failed, so the UI can offer a retry. */
  error?: string;
}

/** A comment the user is still typing. It has no upstream identity yet. */
export type DraftComment = CommentMetadata & { kind: 'draft' };

/** A comment that exists in its store, either GitHub or browser storage. */
export type SavedComment = CommentMetadata & { kind: 'saved'; author: string };

export function isDraftComment(
  metadata: CommentMetadata
): metadata is DraftComment {
  return metadata.kind === 'draft';
}

export function isSavedComment(
  metadata: CommentMetadata
): metadata is SavedComment {
  return metadata.kind === 'saved' && metadata.author != null;
}

/**
 * Whether the line the comment is anchored to is a real addition or deletion,
 * or an unchanged context line. The sidebar uses this so it does not print a
 * misleading `+` or `-` in front of a context line number.
 */
export type CommentLineType = 'change' | 'context';

/** One comment as the sidebar lists it. */
export interface CommentListEntry {
  itemId: string;
  path: string;
  key: string;
  author: string;
  body: string;
  lineNumber: number;
  lineType: CommentLineType;
  side: AnnotationSide;
  range: SelectedLineRange;
  pending?: boolean;
  error?: string;
  htmlUrl?: string;
}

/** The sidebar groups comments by file, in diff order. */
export interface CommentListSection {
  itemId: string;
  path: string;
  fileOrder: number;
  comments: CommentListEntry[];
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
