import { m } from '../paraglide/messages.js';
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
    get title() {
      return m.example_targets_rewrite_bun_in_rust();
    },
    target: {
      kind: 'github-pull',
      owner: 'oven-sh',
      repo: 'bun',
      number: 30412,
    },
    get scale() {
      return m.example_targets_2_188_files_1_0m_lines();
    },
    get note() {
      return m.example_targets_the_largest_of_them_43_mb_of_unified();
    },
  },
  {
    get title() {
      return m.example_targets_resolve_maimai_net_import_pr_conflicts();
    },
    target: {
      kind: 'github-commit',
      owner: 'gekichumai',
      repo: 'dxrating',
      sha: '637a9c80f69d3222d1c3aed3ae8f4aefdb613bc9',
    },
    get scale() {
      return m.example_targets_25_files_494k_lines();
    },
    get note() {
      return m.example_targets_one_generated_json_file_holds_465_486_of();
    },
  },
  {
    get title() {
      return m.example_targets_deps_update_v8_to_14_1();
    },
    target: {
      kind: 'github-pull',
      owner: 'nodejs',
      repo: 'node',
      number: 59805,
    },
    get scale() {
      return m.example_targets_3_420_files_268k_lines();
    },
    get note() {
      return m.example_targets_the_widest_file_tree_past_the_api_diff();
    },
  },
  {
    get title() {
      return m.example_targets_libghostty_remove_all_libc_and_libc_abi_dependencies();
    },
    target: {
      kind: 'github-pull',
      owner: 'ghostty-org',
      repo: 'ghostty',
      number: 12291,
    },
    get scale() {
      return m.example_targets_25_files_88k_lines();
    },
    get note() {
      return m.example_targets_large_and_still_a_diff_a_person_can();
    },
  },
  {
    get title() {
      return m.example_targets_ghostty_1_3_0_to_1_3_1();
    },
    target: {
      kind: 'github-compare',
      owner: 'ghostty-org',
      repo: 'ghostty',
      base: 'v1.3.0',
      head: 'v1.3.1',
    },
    get scale() {
      return m.example_targets_53_files_2_6k_lines();
    },
    get note() {
      return m.example_targets_a_compare_range_of_one_release_100_commits();
    },
  },
];
