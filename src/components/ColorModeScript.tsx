import { COLOR_MODE_SCRIPT } from '@/lib/prePaintScripts';

// Runs before the first paint so the chrome never flashes the wrong scheme.
// The source text is `src/lib/prePaintScripts.ts`, which the `ghdiff` command's
// own server inlines into the document it serves: two hosts, one statement of
// what a stored colour mode means.

export function ColorModeScript() {
  return <script dangerouslySetInnerHTML={{ __html: COLOR_MODE_SCRIPT }} />;
}
