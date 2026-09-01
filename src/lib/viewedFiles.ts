// Which files of a review the reviewer has already read.
//
// GitHub keeps this per viewer on a pull request, and it is the one review
// state this app can neither derive nor guess: a mark is a statement by the
// person reading. `markFileAsViewed` and `unmarkFileAsViewed` are the two
// GraphQL mutations behind it, and `PullRequestChangedFile.viewerViewedState`
// is what reads it back. REST carries none of the three.
//
// A commit and a compare range have no such state on GitHub, so their marks
// stay in this browser, the way their comments already do.

/** GitHub's own three answers to "has this viewer read this file". */
export type FileViewedState = 'VIEWED' | 'UNVIEWED' | 'DISMISSED';

/**
 * What `viewedFiles.list` answers with: the paths this token's own user has
 * marked, and nothing about the files it has not.
 */
export interface ViewedFilesData {
  paths: string[];
}

/**
 * True only for `VIEWED`.
 *
 * `DISMISSED` is what GitHub writes when a file the reviewer had marked
 * changed underneath them, and GitHub's own screen takes the tick off at that
 * point — the mark was about lines that are no longer there. So this app
 * treats it as unread, which is also the answer that makes a second press
 * mean something.
 */
export function isFileViewed(state: string | null | undefined): boolean {
  return state === 'VIEWED';
}
