import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// Stories run in the browser without the app's Worker or server routes.
export default defineConfig({
  plugins: [tailwindcss()],
  resolve: { tsconfigPaths: true },
  worker: { format: 'es' },
});
