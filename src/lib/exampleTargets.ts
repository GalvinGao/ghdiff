import { m } from '@/paraglide/messages.js';

// Diffs worth opening before there is one of your own to read.
//
// Every figure here was measured against the forge's own API — the GitHub rows
// against GitHub's, the gitlab.com rows against GitLab's — and the point of the
// list is the range: a compare range of one release against a pull request that
// rewrites a runtime. A reviewer who opens the small one first learns what the
// surface does, and the large ones say what it survives.
//
// diffshub.com publishes four of these, and three of them are here. The fourth,
// torvalds/linux v6.0...v7.0, is 306,367 commits wide. No browser holds that
// diff, and an example that cannot open is a broken link with a story.
//
// The catalog is keyed by host because that is how a deployment's own examples
// are configured too (`GHDIFF_EXAMPLES`): the rows a reviewer sees are the
// groups whose host this deployment serves. This constant is the default
// catalog, what a deployment gets when it names none of its own.

export interface ExampleEntry {
  /** What the diff is, in the words its own author used. */
  title: string;
  /**
   * The forge's own path for the target: `owner/repo/pull/123` on GitHub,
   * `group/repo/-/merge_requests/1` on GitLab. The row's display and its href
   * are both the host glued to this with a colon.
   */
  path: string;
  /** How big it is. Short enough for the right edge of a row. */
  scale: string;
  /** Why this one is on the list, for the row's hover text. */
  note: string;
}

/**
 * What the row prints: the path with a commit SHA cut to seven characters. A
 * row that prints all forty spends its width on a hash nobody reads, and the
 * link under it still carries the whole one.
 */
export function exampleDisplayPath(entry: ExampleEntry): string {
  return entry.path.replace(/(\/commit\/[0-9a-f]{7})[0-9a-f]{33}$/i, '$1');
}

// The built-in catalog reads its words at render time, through getters, so a
// row is in the request's own locale and never the one the module loaded in.
export const DEFAULT_EXAMPLES: Record<string, readonly ExampleEntry[]> = {
  'github.com': [
    {
      get title() {
        return m.example_targets_rewrite_bun_in_rust();
      },
      path: 'oven-sh/bun/pull/30412',
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
      path: 'gekichumai/dxrating/commit/637a9c80f69d3222d1c3aed3ae8f4aefdb613bc9',
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
      path: 'nodejs/node/pull/59805',
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
      path: 'ghostty-org/ghostty/pull/12291',
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
      path: 'ghostty-org/ghostty/compare/v1.3.0...v1.3.1',
      get scale() {
        return m.example_targets_53_files_2_6k_lines();
      },
      get note() {
        return m.example_targets_a_compare_range_of_one_release_100_commits();
      },
    },
  ],
  'gitlab.com': [
    {
      get title() {
        return m.example_targets_migrate_workflow_catalog_to_ai_catalog_curation();
      },
      path: 'gitlab-org/gitlab/-/merge_requests/250858',
      get scale() {
        return m.example_targets_269_files_669_lines();
      },
      get note() {
        return m.example_targets_the_widest_of_them_a_mechanical_migration();
      },
    },
    {
      get title() {
        return m.example_targets_add_userprompt_value_type_to_duo_chat();
      },
      path: 'gitlab-org/gitlab/-/commit/908cae1aed60fd4fb98b0e8d9c4702732969aaa0',
      get scale() {
        return m.example_targets_28_files_2_8k_lines();
      },
      get note() {
        return m.example_targets_one_feature_as_one_commit();
      },
    },
    {
      get title() {
        return m.example_targets_replace_removed_grape_router_methods();
      },
      path: 'gitlab-org/gitlab/-/merge_requests/253200',
      get scale() {
        return m.example_targets_27_files_230_lines();
      },
      get note() {
        return m.example_targets_small_enough_to_open_first();
      },
    },
    {
      get title() {
        return m.example_targets_gitlab_19_3_0_to_19_3_1();
      },
      path: 'gitlab-org/gitlab/-/compare/v19.3.0-ee...v19.3.1-ee',
      get scale() {
        return m.example_targets_74_files_2_2k_lines();
      },
      get note() {
        return m.example_targets_a_compare_range_of_one_patch_release();
      },
    },
  ],
};
