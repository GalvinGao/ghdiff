import type { CodeViewOptions } from '@pierre/diffs';
import { CodeView, type CodeViewHandle } from '@pierre/diffs/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
  applySearchMarks,
  clearSearchMarks,
  SEARCH_MARKS_CSS,
} from './diffSearchMarks';
import imageFixture from './fixtures/image-preview.svg?url&no-inline';
import {
  applyEffectHints,
  clearEffectHints,
  EFFECT_HINTS_CSS,
} from './lenses/diffEffectHints';
import { WorkerPoolProvider } from './WorkerPoolProvider';
import { useColorPreviews } from '@/hooks/useColorPreviews';
import { useImagePreviews } from '@/hooks/useImagePreviews';
import type { CommentMetadata } from '@/lib/comments';
import { indexMatchesByLine, searchDiff } from '@/lib/diffSearch';
import { buildReviewData } from '@/lib/reviewData';

function ImageLinkPreviewFixture({
  themeType = 'light',
  diffStyle = 'unified',
  search = false,
  effectLens = false,
}: {
  themeType?: 'light' | 'dark';
  diffStyle?: 'unified' | 'split';
  search?: boolean;
  effectLens?: boolean;
}) {
  const viewerRef = useRef<CodeViewHandle<CommentMetadata>>(null);
  const [effectEnabled, setEffectEnabled] = useState(effectLens);
  const effectRef = useRef(effectEnabled);
  useLayoutEffect(() => {
    effectRef.current = effectEnabled;
    for (const entry of viewerRef.current?.getInstance()?.getRenderedItems() ??
      []) {
      if (entry.type === 'diff')
        applyEffectHints(entry.element, entry.item.fileDiff, effectEnabled);
    }
  }, [effectEnabled]);
  const image = new URL(imageFixture, window.location.href).href;
  const data = useMemo(() => {
    const slowImage = new URL(image);
    slowImage.searchParams.set('slow', '1');
    const lines = [
      '// Hover or focus the image icon; tap it on a phone.',
      effectLens
        ? `const failed = yield* Effect.fail("${image}");`
        : `const landscape = "${image}";`,
      `const slowImage = "${slowImage.href}";`,
      `const unavailable = "${new URL('/missing-preview.png', window.location.href).href}";`,
      'const page = "https://example.com/docs";',
      'const accent = "#58796f";',
    ];
    return buildReviewData(
      [
        'diff --git a/src/gallery.ts b/src/gallery.ts',
        'new file mode 100644',
        '--- /dev/null',
        '+++ b/src/gallery.ts',
        `@@ -0,0 +1,${lines.length} @@`,
        ...lines.map((line) => `+${line}`),
        '',
      ].join('\n'),
      'image-preview-fixture'
    );
  }, [image, effectLens]);
  const options = useMemo<CodeViewOptions<CommentMetadata>>(
    () => ({
      themeType,
      diffStyle,
      overflow: 'wrap',
      unsafeCSS: SEARCH_MARKS_CSS + EFFECT_HINTS_CSS,
      onPostRender(node, _instance, phase, { item }) {
        if (phase === 'unmount') {
          clearSearchMarks(node);
          clearEffectHints(node);
          return;
        }
        if (item.type === 'diff')
          applyEffectHints(node, item.fileDiff, effectRef.current);
        if (search)
          applySearchMarks(node, item.id, {
            index: indexMatchesByLine(
              searchDiff(data.items, image, { diffStyle }).matches
            ),
            current: 0,
          });
      },
    }),
    [themeType, diffStyle, search, data, image]
  );
  const colorOptions = useColorPreviews(options);
  const previewOptions = useImagePreviews(colorOptions);
  return (
    <div className="bg-canvas text-ink w-[min(960px,100vw)] p-4">
      <div className="border-line bg-raised overflow-hidden rounded-lg border">
        <div className="border-line flex items-center justify-between border-b px-4 py-3 text-sm">
          <span className="font-semibold">ghdiff · Image link previews</span>
          {effectLens && (
            <button
              type="button"
              aria-pressed={effectEnabled}
              onClick={() => setEffectEnabled((enabled) => !enabled)}
            >
              Effect lens
            </button>
          )}
          <span className="text-ink-muted text-xs">Local fixture</span>
        </div>
        <WorkerPoolProvider>
          <CodeView<CommentMetadata>
            ref={viewerRef}
            items={data.items}
            options={previewOptions}
            className="h-[420px] overflow-y-auto [direction:ltr]"
          />
        </WorkerPoolProvider>
      </div>
    </div>
  );
}

const meta = {
  title: 'Review/Image link previews',
  component: ImageLinkPreviewFixture,
  args: {
    themeType: 'light',
    diffStyle: 'unified',
    search: false,
    effectLens: false,
  },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ImageLinkPreviewFixture>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Unified: Story = {};
export const Split: Story = { args: { diffStyle: 'split' } };
export const Search: Story = { args: { search: true } };
export const EffectFold: Story = { args: { effectLens: true } };
export const EffectSearch: Story = { args: { effectLens: true, search: true } };
