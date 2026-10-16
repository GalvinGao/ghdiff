# SOP: self-host ghdiff on Node or Docker

How to run your own ghdiff, on a machine you choose.

## What you need

- Node.js 24 or newer (`node --version`), or Docker.
- A copy of `.dev.vars` — start from `.dev.vars.example`. Every line in it is
  optional; `SESSION_SECRET` is the one you want for sign-in. Generate one with

  ```bash
  node -e "console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'))"
  ```

## Run with Node

```bash
pnpm install --frozen-lockfile
pnpm build:node
node --env-file=.dev.vars .output/server/index.mjs
```

The server listens on `PORT` (default 3000) and `HOST` (default 0.0.0.0).
`--env-file` reads the same `.dev.vars` wrangler uses, so one file serves both.

The build emits a directly runnable Node server through Nitro — the same fetch
handler the Cloudflare Worker runs, bundled with its static assets and every
dependency but Node's builtins. There is no launcher script of ours in between;
`.output/server/index.mjs` is the server.

## Run with Docker

```bash
docker build -t ghdiff .
docker run -p 3000:3000 --env-file .dev.vars ghdiff
```

The image is the same Node build; no wrangler or Cloudflare account is involved
anywhere.

## Multi-user and containers

- **Sessions are stateless.** Everything a session holds travels in two sealed
  `httpOnly` cookies; the server keeps nothing about anybody between requests.
  There is nothing to back up, any replica can answer any request, and no sticky
  sessions are needed.
- **`SESSION_SECRET` must be identical on every replica and stable across
  restarts** — changing it signs everybody out. Rotate with the `new,old`
  keyring form.
- **`GITHUB_TOKEN` is a deployment-wide identity.** Every request without a
  session acts as that account: its private reads are every visitor's reads, and
  its quota is every visitor's quota. It is a single-user answer — leave it
  unset when more than one person is served.
- **Put a limiting TLS reverse proxy in front.** The server does no inbound rate
  limiting of its own; TLS and per-IP limits belong to the proxy, as does
  compression.

## Verify

- `curl -sf http://localhost:3000/` answers the home page.
- A public diff answers — once GitHub is served, which takes the App credentials
  or `GITHUB_TOKEN` in `.dev.vars`: with neither, the forge gate answers every
  GitHub ref with a 404.
  `curl -sf "http://localhost:3000/api/diff?kind=github-commit&owner=GalvinGao&repo=ghdiff&sha=24ff1db"`
  prints a patch starting with `diff --git`.

If the diff call 404s and the target is private, nothing is wrong with the
server — sign in, and install the App on the account (`/setup` walks through
both).

## Upgrade

```bash
git pull
pnpm install --frozen-lockfile
pnpm build:node        # or: docker build -t ghdiff . again
# restart the process or the container
```

No state migrates: sessions live in sealed cookies, and the server keeps nothing
else between requests.

## Roll back

`git revert` the offending commit, rebuild, restart. There is no database to
roll back with it.
