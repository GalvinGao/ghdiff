// The one-time hand-off from the personal access token to the GitHub App.
//
// An older build of ghdiff kept a reviewer's token in this browser's local
// storage. Nothing sends it any more, so it authenticates nothing — but it is
// still a live credential at GitHub, and a reviewer who does not know it is
// there will not go and delete it. So the first load after this change removes
// it and sends them to `/setup`, once, with a notice saying what happened.
//
// **This must never fire for a reviewer who never had one.** ghdiff works
// signed out — every public diff loads without a credential — and an anonymous
// visitor redirected off the page they asked for would be a plain regression.
// The whole gate is therefore the presence of a value under one key that only
// the old token form ever wrote:
//
//   never set a token            no key          no redirect
//   set one, then cleared it     no key          no redirect
//   set one and left it          key present     one redirect, ever
//   storage blocked or throwing  unreadable      no redirect
//
// The third row is the only one that moves, and it moves once: the key is
// deleted before the navigation, so a reviewer who presses back arrives at a
// browser with nothing left to migrate.
//
// `heldLegacyToken` is what enforces that, and it is tested. The old
// `writeStoredString(key, null)` called `removeItem`, so clearing a token never
// left an empty string behind — but an empty value is checked for anyway,
// because the cost is one condition and the failure it prevents is a redirect
// nobody asked for.

/**
 * Whether this browser is holding a token from before the GitHub App.
 *
 * Everything that is not a non-empty string answers no: an absent key, an empty
 * value, whitespace, and whatever a browser hands back when storage is refused.
 */
export function heldLegacyToken(raw: string | null | undefined): boolean {
  return typeof raw === 'string' && raw.trim().length > 0;
}
