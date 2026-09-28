// A comment that is really a job for later becomes an issue, and the comment
// that stays on the line points at it.
//
// The issue carries the words the reviewer wrote and a permalink to the lines
// under them, which GitHub embeds as a snippet, and it names the review it came
// from, which puts a cross-reference on that pull request's timeline. The
// comment left on the line is `see #N`, which does the same in the other
// direction. That pair is the whole binding: nothing here remembers it, and
// GitHub shows both ends of it.

/** The longest title taken from the first line before it is cut. */
export const MAX_ISSUE_TITLE_LENGTH = 80;

/**
 * Mentions at the very start of the first line. A note that opens by calling a
 * bot or a colleague is addressed to them, and the address is not the subject.
 * The mention still reaches them, because the whole text goes into the body.
 */
const LEADING_MENTIONS = /^(?:@[\w-]+(?:\/[\w.-]+)?[\s,:]*)+/;

export interface CommentIssueInput {
  /** What the reviewer typed into the composer. */
  text: string;
  /** Where the lines are, from `blobPermalinkUrl`. */
  permalink: string;
  /** The review the note was written on, on github.com. */
  sourceUrl: string;
  /** For the title, when the text gives none. */
  path: string;
  line: number;
}

export function composeCommentIssue(input: CommentIssueInput): {
  title: string;
  body: string;
} {
  const text = input.text.trim();
  return {
    title: issueTitleFromText(text, input.path, input.line),
    // The permalink sits on a line of its own, which is what GitHub needs to
    // turn it into a snippet instead of a link.
    body: [text, input.permalink, `From ${input.sourceUrl}`]
      .filter((part) => part.length > 0)
      .join('\n\n'),
  };
}

/**
 * The first line of the note, without the mentions that open it. A note with
 * no words of its own left is titled by the place it was written on.
 */
export function issueTitleFromText(
  text: string,
  path: string,
  line: number
): string {
  const firstLine =
    text
      .split('\n')
      .map((row) => row.trim())
      .find((row) => row.length > 0) ?? '';
  const title = firstLine.replace(LEADING_MENTIONS, '').trim();
  if (title.length === 0) return `Follow up on ${path} line ${line}`;
  if (title.length <= MAX_ISSUE_TITLE_LENGTH) return title;
  return `${title.slice(0, MAX_ISSUE_TITLE_LENGTH - 1).trimEnd()}…`;
}

/** What the comment on the line says once its issue exists. */
export function issueCommentBody(issueNumber: number): string {
  return `see #${issueNumber}`;
}

/** What `issues.create` answers with, and what a card links to. */
export interface CreatedIssue {
  number: number;
  htmlUrl: string;
}
