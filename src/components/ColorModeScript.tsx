import { COLOR_MODE_STORAGE_KEY } from '@/lib/storageKeys';

// Runs before the first paint so the chrome never flashes the wrong scheme.
// It writes the same attribute useColorMode maintains afterwards.
const SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('${COLOR_MODE_STORAGE_KEY}');
    var mode = stored === 'light' || stored === 'dark' ? stored : 'system';
    var scheme =
      mode === 'system'
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : mode;
    document.documentElement.dataset.colorScheme = scheme;
    document.documentElement.dataset.colorMode = mode;
  } catch (error) {
    document.documentElement.dataset.colorScheme = 'light';
  }
})();
`;

export function ColorModeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
