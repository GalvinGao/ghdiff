// The wire client both e2e suites build on: ORIGIN pins where the app under
// test answers, rpc() pins the oRPC envelope ({json} in, {json} out), and
// raw() pins the plain routes' request shape. Each forge's helpers pre-bind
// its own token on top of these.
export const ORIGIN = process.env.GHDIFF_ORIGIN ?? 'http://localhost:3000';

export interface CredentialOptions {
  /** A Bearer token for the Authorization header. Absent means anonymous. */
  token?: string;
  /** A sealed session cookie, as `name=value`. */
  cookie?: string;
}

/**
 * The answer envelope. `json` is the procedure's payload — present on every
 * success, and only read by tests after `assert.ok(r.ok)`, so it is typed as
 * always there; failures are asserted against `raw`.
 */
export interface RpcAnswer<T = unknown> {
  ok: boolean;
  status: number;
  json: T;
  raw: string;
}

export async function rpc<T = unknown>(
  path: string,
  input: unknown,
  { token, cookie }: CredentialOptions = {}
): Promise<RpcAnswer<T>> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (token != null) headers.authorization = `Bearer ${token}`;
  if (cookie != null) headers.cookie = cookie;
  const res = await fetch(`${ORIGIN}/api/rpc/${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ json: input }),
  });
  const text = await res.text();
  let parsed: { json?: T } | undefined;
  try {
    parsed = JSON.parse(text) as { json?: T };
  } catch {
    parsed = undefined;
  }
  return { ok: res.ok, status: res.status, json: parsed?.json as T, raw: text };
}

export interface RawOptions extends CredentialOptions {
  headers?: Record<string, string>;
  redirect?: RequestRedirect;
}

export interface RawAnswer {
  ok: boolean;
  status: number;
  headers: Headers;
  text: string;
}

export async function raw(
  path: string,
  { token, cookie, headers = {}, redirect = 'manual' }: RawOptions = {}
): Promise<RawAnswer> {
  const h: Record<string, string> = { ...headers };
  if (token != null) h.authorization = `Bearer ${token}`;
  if (cookie != null) h.cookie = cookie;
  const res = await fetch(`${ORIGIN}${path}`, { headers: h, redirect });
  const text = await res.text();
  return { ok: res.ok, status: res.status, headers: res.headers, text };
}

/** The `viewer/get` answer, as the suites read it. */
export interface ViewerGetAnswer {
  viewer?: { login: string };
  fromSession?: boolean;
  gitlab?: { host: string; viewer: { login: string } }[];
}
