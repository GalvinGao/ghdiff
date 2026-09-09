# ghdiff

A code review surface built on [`@pierre/diffs`](https://diffs.com) and
`@pierre/trees`, served at [ghdiff.com](https://ghdiff.com).

ghdiff shows one diff at a time: a GitHub pull request, commit, or compare
range. It filters the file list by preset path rules, and a line comment on a
pull request goes back to GitHub.

Every review URL mirrors github.com's own path, so swapping the host is the
whole instruction:

```diff
- github.com/owner/repo/pull/123
+ ghdiff.com/owner/repo/pull/123
```

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
implementation. ghdiff adds three things:

- **Preset filter rules.** Hide tests, show tests alone, or narrow to source,
  docs, config, or generated files. One preset drives the file tree **and** the
  diff scroll region, so a hidden file leaves both.
- **Comments that persist.** A comment on a GitHub pull request becomes a real
  pull request review comment. ghdiff keeps no comment store of its own.
- **A pull request switcher.** Open pull requests for the repositories you
  watch, split into the ones you opened, for self review after an agent pushes,
  and everybody else.

## Start

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000, add a GitHub token, and paste a pull request URL.
The token stays in your browser. The home page links straight to GitHub's
fine-grained token page and names the four repository permissions to grant:
Contents read, Pull requests read and write, Commit statuses read, and Checks
read. A classic token with the `repo` scope works as well.

ghdiff is a [TanStack Start](https://tanstack.com/start) app on Vite, and it
runs on Cloudflare Workers. `pnpm dev` and `pnpm preview` both serve the server
on workerd through `@cloudflare/vite-plugin`, so the development runtime and the
deployed runtime are the same one.

## Deploy

CI deploys every push to `main`, after the lint, type, test, and build jobs all
pass. `.github/workflows/ci.yml` holds the job. It needs one repository secret:

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

| Variable        | Effect                                           |
| --------------- | ------------------------------------------------ |
| `GITHUB_TOKEN`  | Fallback token when the browser has none.        |
| `PORT` / `HOST` | Node-only: where the self-hosted server listens. |

## Commands

```bash
pnpm dev          pnpm build        pnpm preview      pnpm deploy
pnpm test         pnpm typecheck    pnpm cf-typegen
pnpm lint         pnpm fmt          pnpm fmt:check
pnpm build:cli    # the ghdiff command, into dist/cli
```

`AGENTS.md` holds the project conventions.

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
