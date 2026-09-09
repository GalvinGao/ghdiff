import { withThemeByDataAttribute } from '@storybook/addon-themes';
import type { Preview } from '@storybook/react-vite';

// The preview needs the same global stylesheet as the app.
// oxlint-disable-next-line import/no-unassigned-import
import '../src/globals.css';

const preview: Preview = {
  parameters: { layout: 'centered' },
  decorators: [
    withThemeByDataAttribute({
      themes: { light: 'light', dark: 'dark' },
      defaultTheme: 'light',
      attributeName: 'data-color-scheme',
    }),
  ],
};
export default preview;
