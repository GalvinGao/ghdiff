# ghdiff

A code review surface built on [`@pierre/diffs`](https://diffs.com) and
`@pierre/trees`, served at ghdiff.com.

ghdiff shows one diff at a time: a GitHub pull request, commit, or compare
range. It filters the file list by preset path rules, and a line comment on a
pull request goes back to GitHub.

Every review URL mirrors github.com's own path, so swapping the host is the
whole instruction:

```diff
- github.com/owner/repo/pull/123
+ ghdiff.com/owner/repo/pull/123
```

A `/gh/...` path, which earlier versions required, redirects to the same review
without the prefix.

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

```bash
pnpm dlx wrangler login
pnpm build
pnpm deploy
```

`wrangler.jsonc` names the Worker `ghdiff` and turns on `nodejs_compat`, which
the request logger and `process.env` both need. To give a single-user deployment
its own token, set it as a Worker secret:

```bash
pnpm exec wrangler secret put GITHUB_TOKEN
```

For local development the same variable goes in `.dev.vars`, which git ignores.

## Environment

| Variable       | Effect                                    |
| -------------- | ----------------------------------------- |
| `GITHUB_TOKEN` | Fallback token when the browser has none. |

## Commands

```bash
pnpm dev          pnpm build        pnpm preview      pnpm deploy
pnpm test         pnpm typecheck    pnpm cf-typegen
pnpm lint         pnpm fmt          pnpm fmt:check
```

`AGENTS.md` holds the project conventions.
