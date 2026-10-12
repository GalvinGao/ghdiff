import type { StagedReviewComment } from './comments';

// The staged review as JSONL for an agent, in the grammar of hunk's
// `agent-context.json`: one JSON object per line — the review first, then
// one line per comment. A comment's side travels as the range it names
// (`newRange` on the additions side, `oldRange` on the deletions one), and
// bodies are the markdown as written. No patch is embedded: the agent opens
// the files itself.

/**
 * The staged review, `\n`-joined with no trailing newline. The review line's
 * `title` and `summary` keys are present only when they have values;
 * `author`, when given, is stamped on every comment.
 */
export function reviewToJsonl(input: {
  /** `github.com:owner/repo#123`. */
  target: string;
  /** The pull request's page on its forge. */
  url: string;
  title?: string;
  /** The review body; omitted from the line when absent or blank. */
  note?: string;
  author?: string;
  comments: StagedReviewComment[];
}): string {
  const title = input.title?.trim();
  const note = input.note?.trim();
  const author = input.author?.trim();
  const lines = [
    JSON.stringify({
      type: 'review',
      target: input.target,
      url: input.url,
      ...(title == null || title.length === 0 ? {} : { title }),
      ...(note == null || note.length === 0 ? {} : { summary: note }),
    }),
  ];
  for (const comment of input.comments) {
    const range = [comment.startLine ?? comment.line, comment.line];
    lines.push(
      JSON.stringify({
        type: 'comment',
        path: comment.path,
        ...(comment.side === 'deletions'
          ? { oldRange: range }
          : { newRange: range }),
        ...(author == null || author.length === 0 ? {} : { author }),
        body: comment.body,
      })
    );
  }
  return lines.join('\n');
}
