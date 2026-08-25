import { type ReviewTarget } from './reviewTarget.ts';

// Diffs worth opening before there is one of your own to read.
//
// Every number here was measured against the GitHub API, and the point of the
// list is the range: a compare range of one release against a pull request that
// rewrites a runtime. A reviewer who opens the small one first learns what the
// surface does, and the large ones say what it survives.
//
// diffshub.com publishes four of these, and three of them are here. The fourth,
// torvalds/linux v6.0...v7.0, is 306,367 commits wide. No browser holds that
// diff, and an example that cannot open is a broken link with a story.

export interface ExampleTarget {
  /** What the diff is, in the words its own author used. */
  title: string;
  target: ReviewTarget;
  /** How big it is. Short enough for the right edge of a row. */
  scale: string;
  /** Why this one is on the list, for the row's hover text. */
  note: string;
}

export const EXAMPLE_TARGETS: readonly ExampleTarget[] = [
  {
    title: 'Rewrite Bun in Rust',
    target: {
      kind: 'github-pull',
      owner: 'oven-sh',
      repo: 'bun',
      number: 30412,
    },
    scale: '2,188 files · 1.0M lines',
    note: 'The largest of them. 43 MB of unified diff over 6,755 commits.',
  },
  {
    title: 'Resolve Maimai NET import PR conflicts',
    target: {
      kind: 'github-commit',
      owner: 'gekichumai',
      repo: 'dxrating',
      sha: '637a9c80f69d3222d1c3aed3ae8f4aefdb613bc9',
    },
    scale: '25 files · 494k lines',
    note: 'One generated JSON file holds 465,486 of those lines.',
  },
  {
    title: 'deps: update V8 to 14.1',
    target: {
      kind: 'github-pull',
      owner: 'nodejs',
      repo: 'node',
      number: 59805,
    },
    scale: '3,420 files · 268k lines',
    note: 'The widest file tree. Past the API diff cap, so it comes off the web host.',
  },
  {
    title: 'libghostty: Remove all libc++ and libc++ ABI dependencies',
    target: {
      kind: 'github-pull',
      owner: 'ghostty-org',
      repo: 'ghostty',
      number: 12291,
    },
    scale: '25 files · 88k lines',
    note: 'Large, and still a diff a person can read to the end.',
  },
  {
    title: 'Ghostty 1.3.0 to 1.3.1',
    target: {
      kind: 'github-compare',
      owner: 'ghostty-org',
      repo: 'ghostty',
      base: 'v1.3.0',
      head: 'v1.3.1',
    },
    scale: '53 files · 2.6k lines',
    note: 'A compare range of one release. 100 commits, and comments stay local.',
  },
];
