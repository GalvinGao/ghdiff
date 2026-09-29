import {
  readSignedAttachments,
  type SignedAttachments,
} from './attachments.ts';
import type {
  CommentAuthorCounts,
  CommentAuthorFilter,
} from './commentAuthors.ts';

// What was said about a pull request as a whole, rather than on one of its
// lines: the comments under the description, and the reviews that carried a
// verdict or words of their own. github.com draws these as the Conversation
// tab, and a reviewer reading the diff here had no way to see them at all —
// the comment list held line threads and nothing else.
//
// Two REST lists make it, because GitHub files the two kinds apart. An issue
// comment is a remark with no verdict. A review is a verdict, and its body is
// the summary a reviewer wrote above their line comments; the line comments
// themselves are already threads in the diff and are not repeated here.

/** One entry of the conversation, whichever list it came from. */
export interface ConversationEntry {
  /** `comment-<id>` or `review-<id>`: the two lists number independently. */
  key: string;
  kind: 'comment' | 'review';
  /** A review's own state: `APPROVED`, `CHANGES_REQUESTED` or `COMMENTED`. */
  state?: string;
  author: string;
  authorAvatarUrl?: string;
  authorIsBot: boolean;
  /** Markdown, as the author wrote it. Empty for an approval with no words. */
  body: string;
  createdAt?: string;
  htmlUrl?: string;
  /** Never written to browser storage: every address expires in minutes. */
  attachments?: SignedAttachments;
}

interface GitHubUserSource {
  login?: string | null;
  avatar_url?: string | null;
  type?: string | null;
}

/** `GET /issues/{n}/comments`, as much of it as this reads. */
export interface IssueCommentSource {
  id: number;
  body?: string | null;
  body_html?: string | null;
  created_at?: string | null;
  html_url?: string | null;
  user?: GitHubUserSource | null;
}

/** `GET /pulls/{n}/reviews`, as much of it as this reads. */
export interface PullReviewSource {
  id: number;
  state?: string | null;
  body?: string | null;
  body_html?: string | null;
  submitted_at?: string | null;
  html_url?: string | null;
  user?: GitHubUserSource | null;
}

/**
 * A verdict is worth an entry with no words; a remark is not. `COMMENTED` with
 * an empty body is how GitHub files a batch of line comments, or a reply in a
 * line thread, and those are threads in the diff already. `PENDING` is a draft
 * nobody sent, and `DISMISSED` is a verdict GitHub took back.
 */
function reviewBelongs(state: string, body: string): boolean {
  if (state === 'APPROVED' || state === 'CHANGES_REQUESTED') return true;
  return state === 'COMMENTED' && body.length > 0;
}

function author(user: GitHubUserSource | null | undefined) {
  return {
    author: user?.login ?? 'ghost',
    authorAvatarUrl: user?.avatar_url ?? undefined,
    // GitHub types an App's account as `Bot`, which is what the sidebar's
    // People and Bots filter reads for a line thread too.
    authorIsBot: user?.type === 'Bot',
  };
}

function withAttachments(html: string | null | undefined) {
  const attachments = readSignedAttachments(html);
  return Object.keys(attachments.byId).length > 0 ? { attachments } : {};
}

/** Both lists as one conversation, oldest first, the way github.com reads. */
export function buildConversation(
  comments: readonly IssueCommentSource[],
  reviews: readonly PullReviewSource[]
): ConversationEntry[] {
  const entries: ConversationEntry[] = [];
  for (const comment of comments) {
    const body = comment.body?.trim() ?? '';
    if (body.length === 0) continue;
    entries.push({
      key: `comment-${comment.id}`,
      kind: 'comment',
      ...author(comment.user),
      body,
      createdAt: comment.created_at ?? undefined,
      htmlUrl: comment.html_url ?? undefined,
      ...withAttachments(comment.body_html),
    });
  }
  for (const review of reviews) {
    const state = review.state ?? '';
    const body = review.body?.trim() ?? '';
    if (!reviewBelongs(state, body)) continue;
    entries.push({
      key: `review-${review.id}`,
      kind: 'review',
      state,
      ...author(review.user),
      body,
      createdAt: review.submitted_at ?? undefined,
      htmlUrl: review.html_url ?? undefined,
      ...withAttachments(review.body_html),
    });
  }
  // Stable, so two entries in the same second keep the order GitHub gave. An
  // entry with no time goes last: nothing says where it belongs.
  return entries
    .map((entry, index) => ({ entry, index, at: time(entry.createdAt) }))
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .map(({ entry }) => entry);
}

function time(iso: string | undefined): number {
  const value = iso == null ? Number.NaN : Date.parse(iso);
  return Number.isNaN(value) ? Number.POSITIVE_INFINITY : value;
}

/** The entries the sidebar lists under the People and Bots filter. */
export function filterConversation(
  entries: readonly ConversationEntry[],
  filter: CommentAuthorFilter
): ConversationEntry[] {
  if (filter === 'all') return [...entries];
  const wantBot = filter === 'bots';
  return entries.filter((entry) => entry.authorIsBot === wantBot);
}

/** The filter bar's two totals, with the conversation counted in. */
export function addConversationAuthors(
  counts: CommentAuthorCounts,
  entries: readonly ConversationEntry[]
): CommentAuthorCounts {
  let bots = 0;
  for (const entry of entries) if (entry.authorIsBot) bots += 1;
  return {
    people: counts.people + entries.length - bots,
    bots: counts.bots + bots,
  };
}
