// What stands between a loopback server that can read a repository and every
// other page the developer has open.
//
// Loopback is not a boundary. Any page in any tab can issue a request to
// `http://127.0.0.1:<port>`, and a page that guessed the port would otherwise
// be reading source code. Four things answer that, and each is a few lines:
//
//  1. The socket binds `127.0.0.1` and nothing else, so nothing off the machine
//     can reach it at all. That is in `server.ts`, where the listen call is.
//  2. Every `/api` request must carry the run's own token in a **custom
//     header**. A custom header cannot be sent cross-origin without a
//     preflight, and this server answers no preflight and sends no CORS header
//     of any kind — so a hostile page is stopped before the token is even
//     compared. The token is what stops a *local* process that guessed the
//     port.
//  3. The `Host` header must name the address the browser was given. That is
//     what closes DNS rebinding, where a name the attacker controls resolves to
//     127.0.0.1 and the browser then treats their own origin as same-origin.
//  4. The repository and the range are pinned when the process starts, so no
//     request decides what is read. That is in `server.ts` too.
//
// Everything here is a decision about strings and is tested as one.

/** The header the client sends the run's token in. */
export const TOKEN_HEADER = 'x-ghdiff-token';

/** The query parameter the opened URL carries the token in, once. */
export const TOKEN_PARAM = 't';

/**
 * True when this request's `Host` names the loopback address this server is
 * listening on.
 *
 * A browser sends whatever host the address bar holds, so a name that resolves
 * to 127.0.0.1 arrives here as that name. Only the two spellings of loopback
 * are accepted, and the port has to match — a request that reached this socket
 * naming a different port arrived through something rewriting it.
 */
export function hostAllowed(host: string | undefined, port: number): boolean {
  if (host == null) return false;
  const expected = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
  return expected.includes(host.toLowerCase());
}

/**
 * A comparison that takes the same time whichever character differs.
 *
 * The token is 256 bits of `crypto.randomBytes`, so a timing attack on it is
 * not a practical worry to begin with. It costs four lines to not have to
 * argue about that.
 */
export function tokenMatches(
  presented: string | undefined,
  expected: string
): boolean {
  if (presented == null || presented.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= presented.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

export type ApiRefusal =
  | { allowed: true }
  | { allowed: false; status: number; message: string };

/**
 * Whether one `/api` request may be answered. Every reason it may not is a
 * reason the developer cannot fix from the browser, so each says what happened
 * and what to do about it rather than naming a rule.
 */
export function checkApiRequest(input: {
  host: string | undefined;
  port: number;
  token: string | undefined;
  expectedToken: string;
}): ApiRefusal {
  if (!hostAllowed(input.host, input.port)) {
    return {
      allowed: false,
      status: 403,
      message:
        'This server answers 127.0.0.1 only. Open the address the ghdiff command printed.',
    };
  }
  if (!tokenMatches(input.token, input.expectedToken)) {
    return {
      allowed: false,
      status: 403,
      message:
        'This page is from an earlier run of ghdiff. Reload it from the address the command printed.',
    };
  }
  return { allowed: true };
}
