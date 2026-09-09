import { resolve } from 'node:path';

// These pinned library versions don't expose localization callbacks for their
// built-in labels. Adapt the small rendering boundary at build time, including
// worker builds. Match exact source so a dependency upgrade cannot silently
// restore English labels. Remove this adapter when upstream exposes messages.
/** @returns {import('vite').Plugin} */
export function pierreI18n() {
  const messages = resolve('src/paraglide/messages.js');
  return {
    name: 'ghdiff-pierre-i18n',
    enforce: 'pre',
    configEnvironment() {
      // Prebundling would hide these modules from transform in development.
      return {
        optimizeDeps: {
          exclude: ['@pierre/diffs', '@pierre/trees'],
          include: ['@pierre/diffs > lru_map'],
        },
      };
    },
    transform(source, id) {
      id = id.split('?')[0];
      const replacements = [];
      if (id.endsWith('/diffs/dist/utils/createSeparator.js')) {
        replacements.push([
          'createTextNodeElement("Expand all")',
          'createTextNodeElement(m.diff_expand_all())',
        ]);
      } else if (id.endsWith('/diffs/dist/utils/createNoNewlineElement.js')) {
        replacements.push([
          'createTextNodeElement("No newline at end of file")',
          'createTextNodeElement(m.diff_no_newline())',
        ]);
      } else if (id.endsWith('/diffs/dist/renderers/DiffHunksRenderer.js')) {
        replacements.push([
          '`${lines} unmodified line${EN_PLURAL_RULES.select(lines) === "one" ? "" : "s"}`',
          // The surrounding code stays LTR; this count belongs to UI prose.
          '`\u2068${m.diff_unmodified_lines({ count: lines })}\u2069`',
        ]);
      } else if (id.endsWith('/trees/dist/utils/gitStatusPresentation.js')) {
        for (const status of [
          'added',
          'deleted',
          'ignored',
          'modified',
          'renamed',
          'untracked',
        ]) {
          replacements.push([
            `${status}: "Git status: ${status}"`,
            `get ${status}() { return m.tree_git_${status}(); }`,
          ]);
        }
      } else if (id.endsWith('/trees/dist/render/FileTreeView.js')) {
        replacements.push([
          'title: GIT_STATUS_DESCENDANT_TITLE',
          'title: m.tree_git_contains_changes()',
        ]);
      } else return;
      for (const [before, after] of replacements) {
        if (!source.includes(before))
          throw new Error(
            `Update the ghdiff i18n adapter for ${id}: missing ${before}`
          );
        source = source.replace(before, after);
      }
      return {
        code: `import { m } from ${JSON.stringify(messages)};\n${source}`,
        map: null,
      };
    },
  };
}
