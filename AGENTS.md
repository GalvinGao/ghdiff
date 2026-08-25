<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may
all differ from your training data. Read the relevant guide in
`node_modules/next/dist/docs/` (resolved from this file's directory; in
monorepos the `next` package may not be visible from the repo root) before
writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at
`node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a
diff only re-creates the uncommitted change; committing it with your work keeps
the tree clean.

<!-- END:nextjs-agent-rules -->

# reviewer

A code review surface built on [`@pierre/diffs`](https://diffs.com) and
`@pierre/trees`. It renders one unified diff, filters the file list by preset
path rules, and carries line comments back to GitHub.

`diffs-hub` in the `pierrecomputer/pierre` monorepo is the reference
implementation. Reviewer differs from it in three ways that matter:

| Concern        | diffs-hub                                          | reviewer                                                  |
| -------------- | -------------------------------------------------- | --------------------------------------------------------- |
| File filter    | git status only                                    | preset path rules **and** git status **and** a path query |
| Filter reach   | the file tree                                      | the file tree **and** the diff scroll region              |
| Comments       | client state, discarded on reload                  | GitHub pull request review comments                       |
| Item ownership | `initialItems` plus an imperative handle, streamed | controlled `items`, whole patch in state                  |

## Commands

```bash
pnpm dev          # next dev
pnpm build        # next build
pnpm test         # node --test over lib/**/*.test.ts
pnpm typecheck    # tsc --noEmit
pnpm lint         # oxlint
pnpm fmt          # oxfmt, writes in place
pnpm fmt:check    # oxfmt, reports only
npx prek run --all-files
```

## Layout

```
app/
  page.tsx                 home: the open pull requests, and a box for any GitHub URL
  gh/[...segments]/        mirrors github.com paths: /gh/owner/repo/pull/123
  api/diff/                one unified diff
  api/comments/            GitHub pull request review comments: read, post, delete
  api/github/pull/         one pull request's own details, for the header card
  api/github/pulls/        open pull requests for the watched repositories
  api/github/viewer/       who the token belongs to
components/                the review surface and its chrome
hooks/                     client state: token, color mode, patch, comments, switcher
lib/                       pure domain logic, unit tested
lib/server/                server-only: the GitHub client
```

## Rules this project holds to

**The filter drives both panes.** `applyReviewFilter` returns the items for the
viewer and the paths for the tree from one pass. Never filter one without the
other.

**Presets are pure predicates over a path.** Add a rule to `FILTER_PRESETS` in
`lib/filterRules.ts` and add its cases to `lib/filterRules.test.ts`. Do not put
path parsing in a component.

**The token never reaches the server's disk.** The browser holds the personal
access token and sends it on the `Authorization` header of each request.
`GITHUB_TOKEN` is honoured as a fallback for a single-user deployment.

**Comments belong to their target.** A GitHub pull request is the only target
with an upstream review thread, so only `supportsGitHubComments` targets post to
GitHub. Every other target keeps comments in browser storage, and the sidebar
says so.

**`CommentMetadata` is one interface, not a union.** `DiffLineAnnotation<T>`
resolves its metadata through a conditional type, so a union `T` distributes
into a union of annotation shapes the viewer rejects. `kind` discriminates
instead.

**Client hooks depend on strings, not on the target object.** The target arrives
from a server component, so its identity changes whenever the RSC payload is
read again. `useReviewComments` derives `storageKey`, `pullQuery`, and
`pullRepo` and depends on those.

**Bump the version when annotations change.** `CodeView` keys an item update off
`id` and `version`. `ReviewScreen` uses the comment revision as the version.

**Highlighting runs in workers.** `WorkerPoolProvider` wraps the whole app, and
the viewer waits for `useWorkerPoolReady`. Shiki on the main thread was the
whole cause of scroll stutter: on troph-team/lilja#584 it gave a p99 frame of
135 ms with 9% of frames dropped, and the pool took that to a p99 of 17 ms with
none dropped. Do not mount a `CodeView` outside the provider.

**A comment card never changes height.** `@pierre/diffs` watches each annotation
with a `ResizeObserver` and relays out the virtualized list when one resizes, so
`lib/commentHeight.ts` picks a height from the text before the first paint and
the card keeps it. Reading a long comment happens in `CommentExpansion`, a
portaled fixed-position layer that grows from the card's own rectangle, so the
card in the diff is untouched. A clipped body is `overflow: hidden`, which also
makes a late-loading image harmless. Never let a card grow in place.

## Tests

`pnpm test` runs the Node test runner with `--experimental-strip-types`. There
is no bundler in that path, so **relative imports inside `lib/` carry an
explicit `.ts` extension**, and `allowImportingTsExtensions` is on in
`tsconfig.json`. Only pure logic in `lib/` is unit tested; the surface is
checked in a browser.

## Environment

| Variable       | Effect                                    |
| -------------- | ----------------------------------------- |
| `GITHUB_TOKEN` | Fallback token when the browser has none. |

## Lint rules that are off, and why

- `react/set-state-in-effect` — this app synchronizes React with two external
  systems (GitHub and browser storage). Reading browser storage after mount is
  also what keeps the server markup and the first client render equal.
- `react/react-in-jsx-scope` — React 19 uses the automatic JSX runtime.
- `import/no-unassigned-import` — `import './globals.css'` is how Next loads a
  stylesheet.
- `sort-imports` — oxfmt owns import order through `experimentalSortImports`.
  The two tools disagreed on letter case.

## Dependency note

`@pierre/trees` pins `@pierre/theming` 1.0.0 and `@pierre/diffs` pins 1.0.1. Two
copies give the two libraries two separate theme controllers, so the diff and
the tree drift apart. `pnpm-workspace.yaml` overrides both to 1.0.1. Do not
remove that override.
