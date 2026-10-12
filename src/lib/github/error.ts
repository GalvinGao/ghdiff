// The sentence to show for a failed GitHub request.
//
// GitHub answers a failure with a JSON body, and for most of them the useful
// sentence is the top-level `message`: "Not Found", "Bad credentials", "API rate
// limit exceeded for …". A validation failure is the exception. There the
// top-level `message` is only the status name — "Unprocessable Entity" — and the
// reason a person needs sits one level down, in `errors[].message`.
//
// Reading only the top level is what put "Unprocessable Entity" in front of a
// reviewer who had tried to approve their own pull request. That is a true
// sentence and the least useful one available: GitHub knows exactly why it
// refused, and says so, in the part that was being discarded.
//
// So the detail wins when there is one, and nothing else changes: a body with no
// `errors` array behaves exactly as it did.

interface GitHubErrorBody {
  message?: unknown;
  errors?: unknown;
}

/** The first `errors[].message` that is actually a sentence. */
function firstDetail(errors: unknown): string | undefined {
  if (!Array.isArray(errors)) return undefined;
  for (const entry of errors) {
    if (typeof entry !== 'object' || entry == null) continue;
    const message = (entry as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim().length > 0) {
      return message.trim();
    }
  }
  // Some entries carry only `resource`, `field` and `code` — a machine's
  // description of the fault with no sentence in it. There is nothing to show
  // from one of those, so the caller falls back to the top level.
  return undefined;
}

/**
 * What to tell a reviewer about a failed GitHub request.
 *
 * `fallback` is the response's own status text, for a body that is not JSON and
 * a body that is empty. Neither is something GitHub does on purpose, and a
 * status name is better than a blank panel.
 */
export function gitHubErrorMessage(body: string, fallback: string): string {
  try {
    const parsed = JSON.parse(body) as GitHubErrorBody;
    if (typeof parsed === 'object' && parsed != null) {
      const detail = firstDetail(parsed.errors);
      if (detail != null) return detail;
      if (typeof parsed.message === 'string' && parsed.message.length > 0) {
        return parsed.message;
      }
    }
  } catch {
    // Not JSON. The raw body is the next best thing, and the status text after.
  }
  return body.trim().length > 0 ? body.trim() : fallback;
}
