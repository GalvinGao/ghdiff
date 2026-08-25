# reviewer

A code review surface built on [`@pierre/diffs`](https://diffs.com) and
`@pierre/trees`.

Reviewer shows one diff at a time: a GitHub pull request, commit, or compare
range, or a range in a git repository on this machine. It filters the file list
by preset path rules, and a line comment on a pull request goes back to GitHub.

## What it adds over diffs-hub

`diffs-hub` in the `pierrecomputer/pierre` monorepo is the reference
implementation. Reviewer adds three things:

- **Preset filter rules.** Hide tests, show tests alone, or narrow to source,
  docs, config, or generated files. One preset drives the file tree **and** the
  diff scroll region, so a hidden file leaves both.
- **Comments that persist.** A comment on a GitHub pull request becomes a real
  pull request review comment. Reviewer keeps no comment store of its own.
- **A pull request switcher.** Open pull requests for the repositories you
  watch, split into the ones you opened, for self review after an agent pushes,
  and everybody else.

## Start

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000, add a GitHub personal access token with the `repo`
scope, and paste a pull request URL. The token stays in your browser.

## Environment

| Variable                  | Effect                                                                        |
| ------------------------- | ----------------------------------------------------------------------------- |
| `GITHUB_TOKEN`            | Fallback token when the browser has none.                                     |
| `REVIEWER_LOCAL_GIT`      | `on` or `off`. Default: on in development, off in production.                 |
| `REVIEWER_LOCAL_GIT_ROOT` | Every local repository must sit under this path. Default: the home directory. |

## Commands

```bash
pnpm dev          pnpm build        pnpm start
pnpm test         pnpm typecheck
pnpm lint         pnpm fmt          pnpm fmt:check
```

`AGENTS.md` holds the project conventions.
