import handler from '@tanstack/react-start/server-entry';

import { paraglideMiddleware } from './paraglide/server.js';

export default {
  fetch(request: Request) {
    // AsyncLocalStorage keeps each request's locale isolated, including RPC errors.
    // No URL strategy: GitHub-shaped review URLs remain unchanged.
    return paraglideMiddleware(request, () => handler.fetch(request));
  },
};
