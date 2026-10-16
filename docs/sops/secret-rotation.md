# SOP: rotate secrets

`SESSION_SECRET` and the GitHub App client secret, without signing anybody out.

## `SESSION_SECRET` (the session-cookie keyring)

It is a **comma-separated keyring**, newest key first: the first seals every new
cookie, and every key is tried on the way in. So a rotation is two entries for a
while and costs nobody their session.

1. Generate the new key:

   ```bash
   node -e "console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'))"
   ```

2. Prepend it: `SESSION_SECRET=<new>,<old>`.
3. Restart (Node) or deploy (Cloudflare).
4. When the oldest session you care about has aged out — the absolute ceiling is
   180 days, so six months is the safe outer bound — remove the old key:
   `SESSION_SECRET=<new>`.

Removing a key early signs out exactly the sessions sealed with it.

## The GitHub App client secret

Same shape: generate a new one on the App's settings page, update
`GITHUB_APP_CLIENT_SECRET`, restart or deploy. Existing sessions are bearer
tokens and keep working; the next refresh uses the new secret. Delete the old
one on GitHub.
