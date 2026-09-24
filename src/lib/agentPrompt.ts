import type { FileDiffMetadata } from '@pierre/diffs';

import { commentLineText } from './commentLine.ts';
import type { CommentListEntry, CommentListSection } from './comments.ts';

// The review, as text to hand to a coding agent.
//
// A comment kept in a browser used to be a dead end: the reviewer wrote a note
// on a line, closed the tab, and that was where it stayed. This is the way out
// — the whole review as one block of markdown, anchored file by file and line
// by line, to paste into whatever is going to act on it.
//
// Pure, and every decision in it is about text, so it is tested as such rather
// than by reading a clipboard.

/**
 * The most lines of code quoted under one note.
 *
 * Unlike the untracked list, a cap here is the right answer rather than a
 * convenience: the whole output is an agent's context window, and a drag across
 * four hundred lines would spend it on a quotation nobody reads. What is cut is
 * counted and said, so the note never silently claims a smaller range than the
 * reviewer selected.
 */
export const MAX_QUOTED_LINES = 20;

export interface AgentPromptInput {
  /** The threads, grouped by file in diff order. Drafts are already out. */
  sections: readonly CommentListSection[];
  /** The parsed diff each thread's file came from, for the lines it quotes. */
  fileDiffById: ReadonlyMap<string, FileDiffMetadata>;
  /** What is under review, in words. The one line of context the notes get. */
  targetLabel: string;
  /**
   * True when the threads came from GitHub, which is the only case where they
   * are a conversation between people. A browser store holds one reviewer's own
   * notes, and a name in front of every one of them is noise.
   */
  named: boolean;
}

/**
 * The whole review as markdown, or nothing when there is nothing to say.
 *
 * Nothing, rather than a header with no notes under it: a reviewer who pressed
 * this by accident on an empty review should find their clipboard untouched.
 */
export function buildAgentPrompt(input: AgentPromptInput): string | undefined {
  const { fileDiffById, named, sections, targetLabel } = input;
  const parts: string[] = [];

  for (const section of sections) {
    if (section.threads.length === 0) continue;
    const fileDiff = fileDiffById.get(section.itemId);
    const entries = section.threads.map((thread) =>
      formatThread(thread, fileDiff, named)
    );
    parts.push(`## ${section.path}\n\n${entries.join('\n\n')}`);
  }

  if (parts.length === 0) return undefined;
  return `Review notes from ghdiff — ${targetLabel}\n\n${parts.join('\n\n')}\n`;
}

function formatThread(
  thread: CommentListEntry,
  fileDiff: FileDiffMetadata | undefined,
  named: boolean
): string {
  const lines: string[] = [`### ${lineLabel(thread)}`];
  const quote = quoteLines(thread, fileDiff);
  if (quote != null) lines.push('', quote);
  for (const message of thread.messages) {
    // The author goes on every message of a conversation, not only the replies:
    // a reply that names its writer under a note that does not reads as one
    // person answering themselves.
    const prefix = named ? `**${message.author}:** ` : '';
    lines.push('', `${prefix}${message.body.trim()}`);
  }
  return lines.join('\n');
}

/**
 * `line 42`, or `lines 42-58`.
 *
 * The label names the range the reviewer selected and never the quotation,
 * which the cap above may have shortened — the note is about the lines they
 * picked either way.
 */
function lineLabel(thread: CommentListEntry): string {
  const span = quotedSpan(thread);
  return span.from === span.to
    ? `line ${span.from}`
    : `lines ${span.from}-${span.to}`;
}

/**
 * The lines a note covers, on one side.
 *
 * A selection whose two ends sit on different sides of a split diff has no one
 * side to read, so it falls back to the line the annotation is actually
 * anchored to. That is the line GitHub would file the comment against, and it
 * is the honest answer where a range across two files-in-one has none.
 */
function quotedSpan(thread: CommentListEntry): { from: number; to: number } {
  const { range } = thread;
  const crossesSides =
    range.side != null && range.endSide != null && range.side !== range.endSide;
  if (crossesSides) return { from: thread.lineNumber, to: thread.lineNumber };
  return {
    from: Math.min(range.start, range.end),
    to: Math.max(range.start, range.end),
  };
}

/** The code under the note, fenced, or nothing when the diff cannot answer. */
function quoteLines(
  thread: CommentListEntry,
  fileDiff: FileDiffMetadata | undefined
): string | undefined {
  if (fileDiff == null) return undefined;
  const span = quotedSpan(thread);
  const taken: string[] = [];
  for (
    let line = span.from;
    line <= span.to && taken.length < MAX_QUOTED_LINES;
    line += 1
  ) {
    const text = commentLineText(fileDiff, thread.side, line);
    if (text == null) break;
    taken.push(text);
  }
  if (taken.length === 0) return undefined;

  const omitted = span.to - span.from + 1 - taken.length;
  const body =
    omitted > 0
      ? `${taken.join('\n')}\n… ${omitted} more ${omitted === 1 ? 'line' : 'lines'}`
      : taken.join('\n');
  return `\`\`\`${fenceTag(fileDiff)}\n${body}\n\`\`\``;
}

/**
 * The language tag on the fence. `lang` first, because `buildReviewData` has
 * already set it for every file whose name *is* its type — `Dockerfile`,
 * `.env.local` — which is the set an extension cannot answer for. The extension
 * is the fallback, and a cheap guess: a tag an agent does not know costs
 * nothing.
 */
function fenceTag(fileDiff: FileDiffMetadata): string {
  if (fileDiff.lang != null) return fileDiff.lang;
  const name = fileDiff.name;
  const base = name.slice(name.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  const extension = base.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,12}$/.test(extension) ? extension : '';
}
