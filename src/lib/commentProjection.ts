import { type CodeViewDiffItem, type FileDiffMetadata } from '@pierre/diffs';

import type { CommentMetadata, CommentPayload } from './comments.ts';
import { groupCommentThreads, type RawThread } from './commentThreads.ts';

function lineAt(
  file: FileDiffMetadata,
  side: 'additions' | 'deletions',
  line: number
): string | undefined {
  for (const hunk of file.hunks) {
    const start =
      side === 'additions' ? hunk.additionStart : hunk.deletionStart;
    const count =
      side === 'additions' ? hunk.additionCount : hunk.deletionCount;
    const index =
      side === 'additions' ? hunk.additionLineIndex : hunk.deletionLineIndex;
    if (line >= start && line < start + count)
      return file[side === 'additions' ? 'additionLines' : 'deletionLines'][
        index + line - start
      ]?.replace(/\r?\n$/, '');
  }
  return undefined;
}

/** GitHub's hunk can end at the commented line, so it is parsed as a prefix. */
function hunkLines(
  hunk: string,
  side: 'additions' | 'deletions'
): Map<number, string> {
  const result = new Map<number, string>();
  let left = 0;
  let right = 0;
  let inHunk = false;
  for (const row of hunk.split('\n')) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(row);
    if (header != null) {
      left = Number(header[1]);
      right = Number(header[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    const mark = row[0];
    if (mark !== ' ' && mark !== '+' && mark !== '-') continue;
    if (side === 'additions' && mark !== '-')
      result.set(right, row.slice(1).replace(/\r$/, ''));
    if (side === 'deletions' && mark !== '+')
      result.set(left, row.slice(1).replace(/\r$/, ''));
    if (mark !== '+') left++;
    if (mark !== '-') right++;
  }
  return result;
}

export function projectCommentThreads(
  rows: readonly CommentPayload[],
  items: readonly CodeViewDiffItem<CommentMetadata>[],
  commitSha?: string
) {
  const located: { itemId: string; thread: RawThread }[] = [];
  const unplaced: RawThread[] = [];
  for (const thread of groupCommentThreads(rows)) {
    const root = thread.comments[0];
    if (commitSha != null && root.originalCommitSha !== commitSha) continue;
    const line = commitSha == null ? root.line : root.originalLine;
    const startLine =
      commitSha == null ? root.startLine : root.originalStartLine;
    const item = items.find(
      (candidate) =>
        candidate.fileDiff.name === root.path ||
        candidate.fileDiff.prevName === root.path
    );
    const start = startLine ?? line;
    let fits =
      item != null &&
      line != null &&
      start != null &&
      start > 0 &&
      start <= line;
    const historical =
      commitSha != null ? hunkLines(root.diffHunk ?? '', root.side) : undefined;
    if (fits && item != null && line != null && start != null) {
      // A mixed-side range cannot be represented by GitHub's line-comment API.
      if (root.startSide != null && root.startSide !== root.side) fits = false;
      for (let at = start; fits && at <= line; at++) {
        const actual = lineAt(item.fileDiff, root.side, at);
        if (
          actual == null ||
          (historical != null && historical.get(at) !== actual)
        )
          fits = false;
      }
      if (fits && commitSha != null) {
        // The historical PR hunk can use a different base from this commit's
        // first parent. Matching one repeated line is not enough evidence.
        for (const side of ['additions', 'deletions'] as const) {
          for (const [at, expected] of hunkLines(root.diffHunk ?? '', side)) {
            const actual = lineAt(item.fileDiff, side, at);
            if (actual != null && actual !== expected) fits = false;
          }
        }
      }
    }
    if (!fits || item == null || line == null) {
      unplaced.push(thread);
      continue;
    }
    located.push({
      itemId: item.id,
      thread: {
        ...thread,
        comments: [
          { ...root, line, startLine: startLine ?? undefined },
          ...thread.comments.slice(1),
        ],
      },
    });
  }
  return { located, unplaced };
}
