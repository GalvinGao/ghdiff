import type { CommentListSection } from './comments.ts';

// Who wrote a thread, and whether the sidebar should list it.
//
// A review on a busy repository arrives with two kinds of comment on it. A
// person wrote one kind and a review bot wrote the other, and the bot usually
// wrote most of them: on troph-team/lilja#584 one bot accounted for 19 of the
// 28 review comments. Reading what your colleagues said means reading past all
// of that, so the sidebar can hold one kind at a time.
//
// The thread's opening author decides which kind the thread is, because that is
// the author the row names. A bot answering a person stays under People.

export type CommentAuthorFilter = 'all' | 'people' | 'bots';

export const DEFAULT_COMMENT_AUTHOR_FILTER: CommentAuthorFilter = 'all';

export function isCommentAuthorFilter(
  value: unknown
): value is CommentAuthorFilter {
  return value === 'all' || value === 'people' || value === 'bots';
}

/**
 * Whether a login belongs to a bot, judged from its name alone.
 *
 * GitHub reports `user.type` as `Bot` for an app, and `/api/comments` forwards
 * that, so this is the fallback for the comments that never came from the API:
 * a comment made against a target with no upstream review thread lives in
 * browser storage, which keeps the login and nothing else. GitHub reserves the
 * `[bot]` suffix for apps, so the suffix is the whole test.
 */
export function isBotLogin(login: string): boolean {
  return login.toLowerCase().endsWith('[bot]');
}

/** The two totals the filter bar puts against its buttons. */
export interface CommentAuthorCounts {
  people: number;
  bots: number;
}

export function countCommentAuthors(
  sections: readonly CommentListSection[]
): CommentAuthorCounts {
  const counts: CommentAuthorCounts = { people: 0, bots: 0 };
  for (const section of sections) {
    for (const thread of section.threads) {
      if (thread.authorIsBot) {
        counts.bots += 1;
      } else {
        counts.people += 1;
      }
    }
  }
  return counts;
}

/**
 * The sections the sidebar lists under one filter. A file whose every thread
 * the filter removed drops out with them, so no empty heading is left behind.
 */
export function filterCommentSections(
  sections: readonly CommentListSection[],
  filter: CommentAuthorFilter
): CommentListSection[] {
  if (filter === 'all') return [...sections];
  const wantBot = filter === 'bots';
  const result: CommentListSection[] = [];
  for (const section of sections) {
    const threads = section.threads.filter(
      (thread) => thread.authorIsBot === wantBot
    );
    if (threads.length === 0) continue;
    result.push({ ...section, threads });
  }
  return result;
}
