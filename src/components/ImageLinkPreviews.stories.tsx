import type { CodeViewOptions } from '@pierre/diffs';
import { CodeView } from '@pierre/diffs/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useMemo } from 'react';

import {
  applySearchMarks,
  clearSearchMarks,
  SEARCH_MARKS_CSS,
} from './diffSearchMarks';
import imageFixture from './fixtures/image-preview.svg?url&no-inline';
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
}: {
  themeType?: 'light' | 'dark';
  diffStyle?: 'unified' | 'split';
  search?: boolean;
}) {
  const image = new URL(imageFixture, window.location.href).href;
  const data = useMemo(() => {
    const slowImage = new URL(image);
    slowImage.searchParams.set('slow', '1');
    const lines = [
      '// Hover or focus the image icon; tap it on a phone.',
      `const landscape = "${image}";`,
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
  }, [image]);
  const options = useMemo<CodeViewOptions<CommentMetadata>>(
    () => ({
      themeType,
      diffStyle,
      overflow: 'wrap',
      unsafeCSS: SEARCH_MARKS_CSS,
      onPostRender(node, _instance, phase, { item }) {
        if (phase === 'unmount') clearSearchMarks(node);
        else if (search)
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
          <span className="text-ink-muted text-xs">Local fixture</span>
        </div>
        <WorkerPoolProvider>
          <CodeView<CommentMetadata>
            items={data.items}
            options={previewOptions}
            className="h-[420px] overflow-y-auto"
          />
        </WorkerPoolProvider>
      </div>
    </div>
  );
}

const meta = {
  title: 'Review/Image link previews',
  component: ImageLinkPreviewFixture,
  args: { themeType: 'light', diffStyle: 'unified', search: false },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ImageLinkPreviewFixture>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Unified: Story = {};
export const Split: Story = { args: { diffStyle: 'split' } };
export const Search: Story = { args: { search: true } };
