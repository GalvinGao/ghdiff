// Every request this app makes to its own Worker, with one retry behind it.
//
// A signed-in reviewer's access token lasts eight hours and a diff can be open
// for longer than that. So a 401 is not an error to report — it is a token that
// aged out while nobody was looking, and the fix is one call to
// `/api/auth/refresh` and the same request again. Nothing above this has to know
// that, which is the point: `useReviewPatch`, `useDiffFileLoader` and the whole
// RPC client each get one send that already handles it.
//
// The Worker holds up its half. Every route that reads the cookie answers a
// spent token with 401 before GitHub is asked, because this is the only place a
// refresh is ever asked for: a route that went on anonymously instead left the
// cookie unmended, and for one deploy that is what every read did — the
// reviewer was signed out from the ninth hour of a session good for thirty days.
//
// One refresh at a time in this tab, however many requests hit 401 at once. Two
// concurrent refreshes would spend the same single-use refresh token twice and
// the second would get nothing — the same race two tabs have, which the refresh
// route answers on its own. This is the cheaper half of that: inside one tab a
// promise is all it takes.

/** The refresh in flight, so a second caller joins it rather than racing it. */
let refreshing: Promise<boolean> | null = null;

function refreshOnce(): Promise<boolean> {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST' })
    .then((response) => response.status === 204)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/** The sign-out in flight, so several failed retries end the session once. */
let ending: Promise<void> | null = null;

/**
 * Ends a session the refresh could not mend.
 *
 * The refresh route answers a refresh token somebody already spent with 204 and
 * no cookie, on the reading that the somebody was another tab of this browser,
 * whose new cookie the retry will carry. That reading is right nearly every
 * time, and it has one failure: a refresh token spent where this browser will
 * never see the result — revoked at github.com, or taken — leaves a cookie no
 * refresh can mend and no route clears, and every load would pay for a refresh
 * and end in an error for the rest of the cookie's thirty days. A 401 on the
 * retry is the proof that the race had no winner here, and this is the one
 * place that sees both answers. `/api/auth/signout` already knows how to end a
 * session, cookie and token both, so the next load is an ordinary signed-out
 * one. The same press covers a token GitHub has stopped honouring while the
 * cookie still counts it live: the refresh answers "already fresh", and the
 * retry fails the same way.
 */
function endSession(): Promise<void> {
  ending ??= fetch('/api/auth/signout', { method: 'POST' })
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      ending = null;
    });
  return ending;
}

/**
 * Sends a request, and sends it once more after a refresh if the answer is 401.
 *
 * It takes a function rather than a request, because a request is not a thing
 * that can be sent twice: a body is a stream and reading it is what sending
 * does. A caller that builds a fresh one each time is a caller that can be
 * retried, and both callers here are — one builds a `fetch(url, init)` and the
 * other clones a `Request` it keeps.
 *
 * Three more things about the retry. The first answer's body is cancelled
 * rather than dropped, because a body nobody reads and nobody closes is a
 * stream left open. A refresh that answers anything but 204 means there is
 * nothing left to refresh, so the original 401 goes back to the caller and the
 * screen says what a signed-out reviewer should be told. And a retry that is
 * 401 as well is a session nothing here can mend, so it is ended before the
 * answer goes back — see `endSession`.
 */
export async function withRefresh(
  send: () => Promise<Response>,
  signal?: AbortSignal | null
): Promise<Response> {
  // Read through a function rather than inline. The refresh below takes time
  // and a signal is a live object, but TypeScript narrows the first reading and
  // then calls the second one unreachable.
  const abandoned = () => signal?.aborted === true;

  const first = await send();
  if (first.status !== 401) return first;
  if (abandoned()) return first;

  if (!(await refreshOnce())) return first;
  if (abandoned()) return first;

  await first.body?.cancel().catch(() => undefined);
  const second = await send();
  if (second.status === 401) await endSession();
  return second;
}

/** The same, for the two plain `fetch` calls that read a stream of text. */
export function fetchWithRefresh(
  url: string,
  init?: RequestInit
): Promise<Response> {
  return withRefresh(() => fetch(url, init), init?.signal);
}
