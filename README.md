# ghdiff

A code review surface built on [`@pierre/diffs`](https://diffs.com) and
`@pierre/trees`, served at [ghdiff.com](https://ghdiff.com) and self-hostable
anywhere Node runs.

ghdiff shows one diff at a time: a pull request or merge request, a commit, or a
compare range, on **GitHub or GitLab** (gitlab.com and self-hosted instances).
It filters the file list by preset path rules, and a line comment goes back to
the forge as a real review comment.

One deployment serves GitHub and as many GitLab hosts as it is configured for.
Every review URL names the forge's host in its first segment, glued on with a
colon, so moving a review to ghdiff is one edit:

```diff
- github.com/owner/repo/pull/123
+ ghdiff.com/github.com:owner/repo/pull/123
```

and a GitLab instance's own host travels with the path:

```diff
- gitlab.corp.com/group/repo/-/merge_requests/123
+ ghdiff.internal/gitlab.corp.com:group/repo/-/merge_requests/123
```

A hostless paste — `ghdiff.com/owner/repo/pull/123`, or a bare
`/group/repo/-/...` — is an entry point that redirects to the canonical form.

## A diff that is still on your machine

Work that is uncommitted, unpushed, or in a repository with no GitHub remote is
invisible to the site. The `ghdiff` command is the same review surface over
`git diff`, served from `127.0.0.1` by a process you start and stop:

```bash
npx ghdiff              # uncommitted work, in a browser
ghdiff --staged         # what is about to be committed
ghdiff main             # this branch against its base
ghdiff main..feature    # any two revisions
ghdiff --commit         # the last commit
ghdiff --commit abc123  # one commit
```

It reads the repository you run it in and nothing else, never writes to it, and
uploads nothing anywhere. `cli/README.md` is its own documentation, and
`pnpm build:cli` is what builds it from this repository.

## What it adds over diffs-hub

`diffs-hub` in the `pierrecomputer/pierre` monorepo is the reference
implementation. ghdiff adds:

- **Two forges.** GitLab merge requests, commits and compare ranges render
  exactly like GitHub's: diffs, whole-file expansion, line comments as
  discussions, approvals, and the same status squares.
- **Preset filter rules.** Hide tests, show tests alone, or narrow to source,
  docs, config, or generated files. One preset drives the file tree **and** the
  diff scroll region, so a hidden file leaves both.
- **Comments that persist.** A comment becomes a real pull request review
  comment on GitHub, or a discussion on GitLab. ghdiff keeps no comment store of
  its own.
- **A pull request switcher.** Open pull requests and merge requests for the
  repositories you watch, on either forge.
- **A self-hosted shape.** The same server builds for Node as for Cloudflare
  Workers, so a firewalled GitLab gets a ghdiff inside the firewall with it.

## Start

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000 and paste a pull request or merge request URL. Public
diffs work signed out. To read private code, sign in to GitHub through the
ghdiff GitHub App, or connect a GitLab instance with OAuth or a personal access
token — every credential lives in a sealed `httpOnly` cookie, never in browser
storage.

ghdiff is a [TanStack Start](https://tanstack.com/start) app on Vite. `pnpm dev`
and `pnpm preview` serve the server on workerd through
`@cloudflare/vite-plugin`, so the development runtime and the deployed runtime
are the same one.

## Self-host

The Node build is how a firewalled GitLab gets a ghdiff it can reach. Copy the
example environment first — `--env-file` fails outright when the file is missing
(`pnpm start` is the same launch with `--env-file-if-exists`, and goes without):

```bash
cp .dev.vars.example .dev.vars
pnpm build:node
node --env-file=.dev.vars .output/server/index.mjs
```

or with Docker:

```bash
cp .dev.vars.example .dev.vars
docker build -t ghdiff .
docker run -p 3000:3000 --env-file .dev.vars ghdiff
```

`.dev.vars.example` is the list of variables; `SESSION_SECRET` is the one
sign-in needs. `GITLAB_HOSTS` names the GitLab hosts as a JSON array, each with
its optional OAuth pair —
[`docs/sops/gitlab-instance-onboarding.md`](docs/sops/gitlab-instance-onboarding.md)
registers one end to end, and
[`docs/sops/gitlab-pat-connect.md`](docs/sops/gitlab-pat-connect.md) is the
token path for instances without one. `docs/sops/` also covers the
[Node deployment](docs/sops/self-host-node.md),
[secret rotation](docs/sops/secret-rotation.md), and
[releasing](docs/sops/release-deploy.md).

## Deploy to Cloudflare

CI deploys every push to `main`, after the check and build jobs pass.
`.github/workflows/ci.yml` holds the job. It needs one repository secret:

| Secret                 | Where it comes from                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `CLOUDFLARE_API_TOKEN` | A Cloudflare API token from the **Edit Cloudflare Workers** template, on account GalvinGao |

`wrangler.jsonc` names the account, so the token is the only secret the job
carries.

To deploy from your own machine instead:

```bash
pnpm dlx wrangler login
pnpm build
pnpm deploy
```

`pnpm build` is not optional. It writes `.wrangler/deploy/config.json`, which
sends wrangler to the generated `dist/server/wrangler.json`. `wrangler deploy`
builds nothing and fails without it.

`wrangler.jsonc` names the Worker `ghdiff` and turns on `nodejs_compat`, which
the request logger and `process.env` both need. To give a single-user deployment
its own token, set it as a Worker secret:

```bash
pnpm exec wrangler secret put GITHUB_TOKEN
```

GitHub Actions reserves every secret name that opens with `GITHUB_`, so CI
cannot carry this one under its own name. Set it with the command above, or add
a repository secret under another name and map it in the job's `env`.

For local development the same variable goes in `.dev.vars`, which git ignores.

## Self-host on Node or Docker

The same server the Worker runs also builds for plain Node:

```bash
pnpm build:node
node --env-file-if-exists=.dev.vars .output/server/index.mjs
```

`GHDIFF_TARGET=node` swaps the Cloudflare Vite plugin for Nitro's, which emits a
directly runnable server at `.output/server/index.mjs` — no launcher in between.
It listens on `PORT` (default 3000) and `HOST` (default 0.0.0.0), and `/healthz`
answers `ok` for a liveness probe. The `Dockerfile` builds the same shape:

```bash
docker build -t ghdiff .
docker run -p 3000:3000 --env-file .dev.vars ghdiff
```

One caveat: `GITHUB_TOKEN` is a deployment-wide identity — every request without
a session acts as that account. Leave it unset when more than one person is
served.

## Environment

| Variable                   | Effect                                                               |
| -------------------------- | -------------------------------------------------------------------- |
| `SESSION_SECRET`           | Seals the session cookie. A comma-separated keyring.                 |
| `GITLAB_HOSTS`             | The GitLab hosts, as a JSON array; the OAuth pair optional per host. |
| `GITHUB_APP_CLIENT_ID`     | The GitHub App's client id, for GitHub sign-in.                      |
| `GITHUB_APP_CLIENT_SECRET` | Signs the code exchange, the refresh, and the revocation.            |
| `GITHUB_APP_SLUG`          | The App's name in a URL, for the install link.                       |
| `GITHUB_TOKEN`             | Fallback token when the request carries none.                        |
| `GHDIFF_BRANDING`          | What the deployment calls itself on screen. Unset reads ghdiff.com.  |
| `GHDIFF_EXAMPLES`          | The home page's example diffs, as JSON. Unset offers the built-in.   |
| `GHDIFF_TARGET`            | Build-time: `node` builds the self-hosted server.                    |
| `PORT` / `HOST`            | Node-only: where the self-hosted server listens.                     |

Every one is absent-tolerant except `SESSION_SECRET` set to something that is
not a key, which throws; unset simply means no sign-in. The other exceptions are
typos a loud failure reports the same way: half a GitHub App pair, a
`GHDIFF_EXAMPLES` value that is not JSON or names what this deployment does not
serve, a `GITLAB_HOSTS` value that is not JSON, an entry whose host is not a
host, the same host twice, half an OAuth pair, or more than eight hosts, which
is as many sign-ins as one session cookie holds.

## Commands

```bash
pnpm dev          pnpm build        pnpm build:node   pnpm preview
pnpm start        pnpm deploy       pnpm test         pnpm typecheck
pnpm lint         pnpm fmt          pnpm fmt:check    pnpm codegen
pnpm build:cli    # the ghdiff command, into dist/cli
```

`AGENTS.md` points at the project conventions, which live in `docs/rules/`.

## Component captures

Run `pnpm storybook` to open the component workshop at http://localhost:6006. It
uses the real app CSS with light/dark themes and local fixtures, without
starting the Cloudflare Worker. `pnpm storybook:build` creates a static
workshop. Use `pnpm storybook --port 6017` when another worktree owns the
default port.

Install Chromium once with `pnpm exec playwright install chromium`, then run:

```bash
pnpm storybook:shot                             # status overview PNG
pnpm storybook:shot ui-dialog--open dark         # dark dialog PNG
pnpm storybook:video                            # scripted dialog WebM
HEADLESS=1 pnpm storybook:video                  # automated environments
```

The server must be running. Set `STORYBOOK_URL` for a different origin. Each
capture gets its own temporary directory; the command prints the artifact path.
The video includes setup footage: use the skill's `finish-video.py` with
inspected frame boundaries to produce the final MP4 (requires Python 3 and
ffmpeg).

Add `*.stories.tsx` alongside components. Use static stories for screenshots and
scenario modules like `scripts/storybook-dialog.mjs` for repeatable
interactions. The
[PR visual evidence skill](.agents/skills/pr-visual-evidence/SKILL.md) covers
framing, before/after composition, video trimming, and attaching evidence.
