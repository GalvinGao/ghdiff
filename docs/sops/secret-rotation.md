# SOP: rotate secrets

`SESSION_SECRET` and the OAuth client secrets, without signing anybody out.

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

## A GitLab OAuth client secret

An application holds exactly one secret — GitLab has no create-new/delete-old
pair. **Renew an application secret** (`POST /applications/:id/renew-secret`, or
the button on the application's page) replaces it in place, and the old secret
is dead from that moment.

1. Renew the secret on the instance's application page.
2. Update the host's `clientSecret` in `GITLAB_HOSTS` and restart immediately —
   no rebuild, the secret is runtime-only. It cannot wait: a refresh that comes
   due against the old secret fails, and a failed refresh drops the grant.
3. Existing OAuth grants keep working — they are bearer tokens, not signed by
   the secret. The next refresh uses the new secret.

## The GitHub App client secret

Same shape: generate a new one on the App's settings page, update
`GITHUB_APP_CLIENT_SECRET`, restart or deploy. Existing sessions are bearer
tokens and keep working; the next refresh uses the new secret. Delete the old
one on GitHub.
