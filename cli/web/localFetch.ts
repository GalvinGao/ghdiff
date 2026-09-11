import { TOKEN_HEADER, TOKEN_PARAM } from '../src/guards.ts';

// How this run's token gets onto every request the app makes, without a single
// hook or component being told it exists.
//
// The app's own `fetchWithRefresh` wraps every call to its own server, and on
// the hosted side the credential is a cookie the browser attaches by itself —
// so nothing above the network layer carries one, and nothing should have to
// start. Here the credential is a header, so the header is added at the same
// layer: `window.fetch` is wrapped once, before React is mounted, for
// same-origin `/api` requests and nothing else.
//
// A cookie was the other answer and it is wrong on loopback: cookies are not
// scoped by port, so `127.0.0.1:5173` and `127.0.0.1:8080` share a jar and a
// credential would travel between them. `sessionStorage` is scoped by origin,
// which includes the port, and is scoped per tab besides.
//
// That port scoping used to be the reason two runs could not hand each other a
// credential. It is not any more: the command binds `DEFAULT_PORT` every time,
// so two runs ordinarily share an origin, and a tab left open from the previous
// one still holds that run's token. Nothing gets through on it — `checkApiRequest`
// compares against the token this process minted and a spent one fails, which is
// where the guarantee actually lives and always did. What sessionStorage is for
// here is narrower and still true: the token is not written where a later page
// load, another tab, or `localStorage` alongside it could read it back.

/** Where the token is kept between the opened address and a reload. */
const TOKEN_STORAGE_KEY = 'ghdiff-local-token';

/**
 * Takes the token out of the address, keeps it, and gives it back.
 *
 * The address is rewritten in the same breath, so the token is not left in the
 * bar to be copied into a message or read out of history. A reload then has no
 * `?t=` and reads the stored one, which is why it is stored at all.
 */
export function claimToken(): string | undefined {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get(TOKEN_PARAM);
  if (fromUrl != null && fromUrl.length > 0) {
    remember(fromUrl);
    url.searchParams.delete(TOKEN_PARAM);
    window.history.replaceState(
      null,
      '',
      `${url.pathname}${url.search}${url.hash}`
    );
    return fromUrl;
  }
  return recall();
}

function remember(token: string): void {
  try {
    window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // A browser refusing storage still has the token in this document's own
    // closure, so the tab works and only a reload would not.
  }
}

function recall(): string | undefined {
  try {
    return window.sessionStorage.getItem(TOKEN_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Puts the token on every same-origin `/api` request this document makes.
 *
 * Same-origin only, and `/api` only. The wrapper is deliberately narrow: it is
 * one credential for one server, and a header added to anything else would be
 * this page handing it somewhere it does not belong.
 */
export function installTokenHeader(token: string): void {
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isLocalApi(input)) return original(input, init);
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    );
    headers.set(TOKEN_HEADER, token);
    return original(input, { ...init, headers });
  };
}

function isLocalApi(input: RequestInfo | URL): boolean {
  const href =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  const url = new URL(href, window.location.origin);
  return (
    url.origin === window.location.origin && url.pathname.startsWith('/api/')
  );
}
