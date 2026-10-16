# ghdiff

A code review surface built on [`@pierre/diffs`](https://diffs.com) and
`@pierre/trees`, served at ghdiff.com. It renders one unified diff, filters the
file list by preset path rules, and carries line comments back to GitHub.

It has a second host. `ghdiff` is a command a developer runs in their own
repository, which serves the same surface over `git diff` — see
`docs/rules/local-command.md`. The Worker and the command answer the same two
routes, and everything above those routes is the same code.

`diffs-hub` in the `pierrecomputer/pierre` monorepo is the reference
implementation. ghdiff differs from it in three ways that matter:

| Concern        | diffs-hub                                          | ghdiff                                                    |
| -------------- | -------------------------------------------------- | --------------------------------------------------------- |
| File filter    | git status only                                    | preset path rules **and** git status **and** a path query |
| Filter reach   | the file tree                                      | the file tree **and** the diff scroll region              |
| Comments       | client state, discarded on reload                  | GitHub pull request review comments                       |
| Auth           | none                                               | the ghdiff GitHub App, in a sealed `httpOnly` cookie      |
| Item ownership | `initialItems` plus an imperative handle, streamed | controlled `items`, whole patch in state                  |

## A turn that changes the screen ends with a picture of it

**An agent turn that changes what a reviewer sees must give screenshots in its
reply.** Not a description of the change, and not a promise that it was checked:
the picture. This app's surface is checked in a browser and nowhere else — no
test renders a component — so a reply about a UI change without one asks the
reader to take its word for the one thing they cannot verify by reading the
diff.

That covers anything that renders differently: markup, a class, a token in
`globals.css`, copy on screen, a new state, a layout at some width. A change
that renders identically — a server route, a pure function in `src/lib/`, a
test, a comment, the build — needs none, and a reply should not invent one.

What to capture is whatever the change touched, in the state where it shows:

- **The change itself, at the size a reviewer meets it.** An element shot of the
  control is fine for detail, but give at least one shot with the screen around
  it, so the reader can see where it sits.
- **Each state it adds** — pressed and unpressed, empty, loading, failure — when
  the change is about that state.
- **A phone, at 402 × 874, whenever the change reaches a screen a phone draws.**
  The phone layout is not a second design, but it is a second set of widths, and
  that is where a row overflows.
- **The narrowest and widest a pane allows**, when the change sits in a
  resizable one. The left bar runs from 200px to 480px.
- **Both colour schemes**, when the change touches a colour.

Take them from the running app — `pnpm dev` and a browser the agent drives —
against real data where it can reach some, and say in the reply what the screen
was showing: which target, which width, signed in or not. A shot of seeded or
mocked state is allowed when real data cannot reach the case, and the reply says
so. Send the images to the user. Leave the files out of the repository:
`.playwright-mcp/` is ignored for that reason.

A pull request for the same change follows the same rule: the screenshot goes
first in its description.

## The stack

TanStack Start on Vite, served by Cloudflare Workers in production at
ghdiff.com, and by plain Node.js wherever it is self-hosted.
`@cloudflare/vite-plugin` runs the server on workerd in development too, so
`pnpm dev` and the deployed Worker are the same runtime and a Node-only API
cannot pass locally and then fail after a deploy. `GHDIFF_TARGET=node` swaps
that plugin for Nitro's (`nitro/vite`) — one plugin line, the canonical setup —
which emits a directly runnable Node server at `.output/server/index.mjs` around
the same fetch handler the Worker runs.

Every environment variable the server reads is validated by one zod schema,
`parseDeploymentConfig` in `src/lib/server/config.ts` — parsed at each request
boundary and handed down as a plain parameter, so no process-wide singleton
exists for a test to poke. The build reads exactly one of them, `GHDIFF_TARGET`,
and Cloudflare is the default runtime everywhere; Node is the branch that gets
named. An unset `GHDIFF_TARGET` is the Cloudflare build, and runtime code spells
the self-hosted server's special cases as `=== 'node'` — the log line's shape,
and which store the served counter gets in `src/lib/server/served/backend.ts`.
The check sits in code as a plain comparison against the target the build writes
into the bundle, so dead-code elimination drops the other half: the Cloudflare
build never sees the in-memory backend, and the Node build never sees
`cloudflareBackend()` or its `cloudflare:workers` and unstorage driver imports.
Tests name the target the same way the build does — vitest.config.ts defines it
`node` — so they run the in-memory half and the dynamic import never executes.

The `Dockerfile` builds with `pnpm build:node` behind a BuildKit cache mount for
the pnpm store; the bundle Nitro emits is self-contained, so the runtime stage
copies only `.output/` and runs as `USER node`.

## Commands

```bash
pnpm dev          # vite dev, on workerd
pnpm build        # vite build for Cloudflare: dist/client and dist/server
pnpm build:node   # vite build for Node (GHDIFF_TARGET=node)
pnpm build:cli    # two more vite builds: dist/cli/web and dist/cli/bin
pnpm preview      # vite preview, the built Worker on workerd
pnpm start        # node --env-file-if-exists=.dev.vars .output/server/index.mjs
pnpm deploy       # wrangler deploy
pnpm test         # every test: script, which is test:lib
pnpm test:lib     # vitest over src/lib and cli/src
pnpm typecheck    # wrangler types, then tsc --noEmit
pnpm lint         # i18n:check, then oxlint
pnpm fmt          # oxfmt, writes in place
pnpm fmt:check    # oxfmt, reports only
npx prek run --all-files
pnpm exec wrangler deploy --dry-run   # what CI runs, no credentials needed
cd dist/cli && npm pack               # the command, as the tarball npx fetches
```

## Layout

```
src/
  router.tsx               createRouter, and the `getRouter` export Start calls
  routeTree.gen.ts         generated by the build, committed, linted by nobody
  globals.css              imported by __root.tsx as a `?url` stylesheet link
  routes/
    __root.tsx             the document, then AppShell: the left bar, then the page
    index.tsx              home: a box for any GitHub URL, and the watch list
    setup.tsx              why a private diff will not load, as three steps
    healthz.ts             the liveness probe's one-word answer
    ghdiff[.]user[.]js.ts  the userscript, filled for this deployment
    $.tsx                  mirrors github.com paths: /owner/repo/pull/123
    gh/$.tsx               the old /gh prefix, redirected to the route above
    api/diff.ts            one unified diff, as text/plain
    api/file.ts            one whole file, as text/plain
    api/rpc/$.ts           the oRPC handler: every JSON call the app makes
    api/auth/start.ts      begins a sign-in: 302 to GitHub, handoff put aside
    api/auth/callback.ts   GitHub's answer: the code spent, the session sealed
    api/auth/refresh.ts    the one route that spends a refresh token
    api/auth/signout.ts    revokes at GitHub, then drops both cookies
  components/              the left bar, the review surface, and their chrome
  hooks/                   client state: the session, patch, comments, pulls,
                           the URL fragment, the files a hunk expansion reads,
                           and whether this is a phone
  hooks/preferences.ts     every remembered setting, as one jotai atom each
  lib/                     pure domain logic, unit tested
  lib/preferences.ts       what each of those settings is, and how it is stored
  lib/lenses/              a file kind the diff draws badly, read another way:
                           the frame, the per-repository store, and one lens,
                           localization, with its reader, model and checks
  components/lenses/       the panels a lens draws above the diff, the frame
                           around them, and each lens's settings dialog
  lib/github/urls.ts       every address on github.com this app links to
  lib/github/app.ts        every address the ghdiff GitHub App has there
  lib/github/error.ts      the sentence a GitHub failure carries
  lib/session.ts           the cookies, the two clocks, and where a redirect may go
  lib/installations.ts     how far an installation reaches, in words
  lib/fileLimit.ts         the cap on a whole file, where three hosts can read it
  lib/prePaintScripts.ts   the colour mode and the code font, as source text
  lib/authFetch.ts         every call to this Worker, with one retry behind it
  lib/deployments.ts       where each environment stands, and the Pages alias
  lib/queryCache/          the cache every tab shares: which tab fetches, the
                           channel between them, the store, and the account
                           its records belong to
  lib/rpc/contract.ts      the API, stated once: shared by both sides
  lib/rpc/router.ts        the Worker's half of it, server-only
  lib/rpc/client.ts        the browser's half of it
  lib/server/              server-only: the deployment's config, and the cipher
                           half of the session
  lib/server/session/      the JWE every cookie is sealed as, the claims it
                           carries, and the legacy seal it still reads
  lib/server/served/       the served counter: the batching, and the backend
                           the build-time target picks by dead-code elimination
  lib/server/origin.ts     where a request arrived from outside: the scheme
                           behind the proxy, and the origin the userscript
                           points at
  lib/server/ghdiff.user.js the userscript's template, generated from
                           src/userscript.js and committed
  lib/server/userscript.ts the template's filling, as one pure function
  lib/server/github/       the client, the App's own three calls, the patch
                           fallback, and where the App is installed
cli/
  package.json             the published manifest: name, bin, files
  src/args.ts              the command citty parses, and what it means
  src/gitRange.ts          the argument vectors handed to git
  src/guards.ts            the host check and the token check
  src/git.ts               one spawn, one ReadableStream, no shell
  src/repo.ts              the three questions asked before the socket binds
  src/server.ts            the Hono app: /api/diff, /api/file, the document
  src/main.ts              the bin: parse, resolve, listen, print, open
  web/index.html           the document the server fills in and serves
  web/main.tsx             ReviewScreen, its own router, and nothing else
  web/LocalAppData.tsx     what AppDataProvider is with no GitHub in the picture
  web/localFetch.ts        the run's token, onto every /api request
```

A route file holds one `Route` export. A page route sets `component`; an API
route sets `server.handlers` and no component, which is what keeps it off the
client. `@/*` resolves to `./src/*`, `@cli/*` to `./cli/*` and `@scripts/*` to
`./scripts/*`; the paths live only in `tsconfig.json`, which tsc, Vite, and
vitest (`resolve.tsconfigPaths`) all read.

`public/` is Vite's own directory and this app keeps nothing in it: the file
that used to answer `/ghdiff.user.js` from the asset store is a server route
now, because a self-hosted deployment's script has to point at that deployment,
which only the server knows. The route fills the template in
`src/lib/server/ghdiff.user.js` with the deployment's own origin — the button's
target and the script's update address — and the address is the one the script
has always had, so scripts already installed keep updating. The template is
generated: `scripts/build-userscript.mjs` bundles `src/userscript.js` with the
Paraglide messages it names and keeps its metadata block, as part of
`pnpm i18n:compile`, and it is committed, as the copy in `public/` was. Lint and
format the source, not the generated template. Bump the source's `@version` when
the installed script changes. See [I18N.md](I18N.md) for catalog ownership and
localization checks.

## How this project's docs are organized

This file is the pointer. The project's rules live in `docs/rules/`, split by
area, and **they are not auto-injected into your context**. Reading the
pointed-to document before editing in its area is mandatory — its rules are as
binding as the ones in this file.

- Touching the diff viewer, comments, the file tree, fragments and anchors,
  hydration and expansion, lenses, find-in-diff, panes, or the phone layout →
  read `docs/rules/review-surface.md`
- Touching the left bar, the watch list, the home page, the pull list, the
  status squares, the setup page, the routes, the shared query cache, or the
  userscript → read `docs/rules/app-shell.md`
- Touching `src/components/ui/`, `src/globals.css`, a dialog, fonts, the colour
  scheme, or any copy a reviewer reads → read `docs/rules/design-system.md`
- Touching the session, the auth routes, the GitHub client, the RPC contract,
  `/api/diff`, `/api/file`, verdicts, or error handling → read
  `docs/rules/auth-and-forges.md`
- Touching the Worker, `wrangler.jsonc`, `vite.config.ts`, the Dockerfile, the
  tests, or the build → read `docs/rules/platform-and-tests.md`
- Touching `cli/`, `LocalDiffTarget`, or the two `vite.cli-*.config.ts` builds →
  read `docs/rules/local-command.md`
- Touching `messages/`, a Paraglide call, or any copy a reviewer reads → read
  [I18N.md](I18N.md) and `.agents/skills/high-quality-i18n/SKILL.md`

## Rules every task must hold to

**Ground claims in the code.** This document set's statements about the code
were verified against it. Hold the same standard: no invented paths, symbol
names, figures, or repository facts — check before writing them down, and check
again before relying on them.

**Prove a change before handoff.** `pnpm lint`, `pnpm fmt:check`,
`pnpm typecheck`, and `pnpm test:lib` all pass. CI runs the same four.

**Every sentence on screen is a catalog message, in all twenty catalogs.** Copy
is a key in `messages/en.json` and the same key, in the same order, in each of
the other nineteen — `pnpm lint` runs `i18n:check`, which fails on a missing
key, a placeholder that differs, literal JSX text, or a message called while a
module initializes. Call `m.*()` at render or request time, through a getter in
an option table, never at module scope: a module-level call freezes one locale
across every request the process serves. GitHub and ghdiff are protected names
and stay as they are in every catalog.

**Imports are written for the bundler, and there is only the bundler.** No `../`
parent-relative import survives review — cross-directory imports go through `@/`
(`src/`), `@cli/` (`cli/`) or `@scripts/` (`scripts/`), whose single definition
is `tsconfig.json`'s `paths`, read by tsc, by Vite, and by vitest through
`resolve.tsconfigPaths` (oxlint's `import/no-relative-parent-imports` enforces
the ban). An import never carries a `.ts` extension or ends in `/index.ts` —
`allowImportingTsExtensions` is gone, so tsc itself rejects the suffix. A
same-directory `./x` import stays as it is.

## Environment

| Variable                   | Effect                                                      |
| -------------------------- | ----------------------------------------------------------- |
| `GITHUB_APP_CLIENT_ID`     | The App's client id. No App configured, no sign-in offered. |
| `GITHUB_APP_CLIENT_SECRET` | Signs the code exchange, the refresh, and the revocation.   |
| `GITHUB_APP_SLUG`          | The App's name in a URL, for the install link.              |
| `SESSION_SECRET`           | Seals the session cookie. A comma-separated keyring.        |
| `GITHUB_TOKEN`             | Fallback token when the request carries none.               |
| `GHDIFF_TARGET`            | Build-time: `node` builds the self-hosted server.           |
| `PORT` / `HOST`            | Node-only: where the self-hosted server listens.            |

Every one is absent-tolerant; what throws is a typo, because a loud failure is
what tells somebody so: `SESSION_SECRET` set to something that is not a key
(unset simply means no sign-in), and half a `GITHUB_APP_CLIENT_ID` /
`GITHUB_APP_CLIENT_SECRET` pair. Generate one with

```bash
node -e "console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'))"
```

Put them in `.dev.vars` for `pnpm dev` and `pnpm preview`, and in Worker secrets
(`pnpm exec wrangler secret put <NAME>`) for a deployment. `.dev.vars.example`
is the file to copy, and it says what each name is for.

`.gitignore` covers `.dev.vars` and `.dev.vars.*`, and then names
`!.dev.vars.example` as the one exception. The negation has to be that narrow: a
broader one would stop ignoring `.dev.vars.production` as well, and wrangler
reads `.dev.vars.<environment>` for real when `--env <environment>` is passed.
Nothing loads the example, since nobody passes `--env example`.

| Binding  | Effect                                             |
| -------- | -------------------------------------------------- |
| `GHDIFF` | This app's KV namespace. Holds the served counter. |

`pnpm dev` and `pnpm preview` give that binding a local store of their own under
`.wrangler`, so a development run never touches the deployed figure.

## CI

`.github/workflows/ci.yml` runs two jobs in parallel, both through the
`.github/actions/setup` composite action.

- **check** — oxlint, oxfmt, tsc, and the unit tests.
- **build** — `pnpm build`, then a check that the build did not change the
  committed `src/routeTree.gen.ts`, then `wrangler deploy --dry-run`. The dry
  run packages the Worker exactly as a deploy would and needs no Cloudflare
  credentials, so a change workerd cannot run fails the pull request instead of
  the deploy. Then `pnpm build:node`, so a change that breaks the self-hosted
  build fails the same way.

A third job, **deploy**, waits on both and runs only on a push to `main`. It
builds again before it calls `cloudflare/wrangler-action`, because
`wrangler deploy` builds nothing: the Vite build writes
`.wrangler/deploy/config.json`, which redirects wrangler to the generated
`dist/server/wrangler.json`, and wrangler errors without that file. The account
id is in `wrangler.jsonc`, so `CLOUDFLARE_API_TOKEN` is the only secret the job
carries. The workflow cancels a superseded run only on a pull request, and the
deploy job holds a concurrency group of its own, so no deploy is killed halfway.

`workflow_dispatch` starts the two checks by hand and never the deploy, which
stays gated on a push to main. It is there because a push was once the only way
to ask for a run at all: an Actions outage stranded the run for a merge to main
for three hours, and a run stuck in the queue holds the `main` concurrency group
against the next push as well. Cancel a stranded run before pushing again.

GitHub Actions reserves every secret name that opens with `GITHUB_`. A Worker
`GITHUB_TOKEN` therefore cannot travel as a repository secret of the same name.

## Lint rules that are off, and why

- `react/set-state-in-effect` — this app synchronizes React with two external
  systems (GitHub and browser storage). Reading browser storage after mount is
  also what keeps the server markup and the first client render equal.
- `react/react-in-jsx-scope` — React 19 uses the automatic JSX runtime.
- `no-underscore-dangle` — allowed for `_splat`, which is TanStack Router's own
  name for a wildcard path parameter, and for `__GHDIFF_VERSION__` and
  `__GHDIFF_LOCAL__`, which are the two names the local command's build and its
  server write into a bundle and a document. Both are conventions of the thing
  that writes them, not of this codebase.
- `import/no-relative-parent-imports` — off under `scripts/` and `.storybook/`,
  which Node and Storybook load as files rather than through the bundler, so the
  `@/` paths are not theirs to resolve.
- `sort-imports` — oxfmt owns import order through `experimentalSortImports`.
  The two tools disagreed on letter case.

`src/routeTree.gen.ts` is in the ignore list of both oxlint and oxfmt. The build
writes it, and a formatter that rewrote it would make CI's staleness check fail
on every run.

## Dependency note

`@pierre/trees` pins `@pierre/theming` 1.0.0 and `@pierre/diffs` pins 1.0.1. Two
copies give the two libraries two separate theme controllers, so the diff and
the tree drift apart. `pnpm-workspace.yaml` overrides both to 1.0.1. Do not
remove that override.

jotai is the one state library in the graph, and it holds the remembered
settings and nothing else. It cost about 9 KiB of the Worker's gzipped headroom,
new modules included, which is what a hand-written store over `localStorage`,
the `storage` event and a subscription per key would have cost anyway — with the
tab synchronization and the read-on-mount contract left to be got right here
rather than upstream. Everything else in this app is React state or a ref, and
adding a second store would be the change to argue for.

`@tanstack/react-query` holds the answers GitHub gives. Most of them go through
`useSharedQuery`, and the shared cache behind it is written by hand: small
modules over IndexedDB, `BroadcastChannel` and Web Locks, with no dependency
added. TanStack's own persister writes the whole client on every change and its
broadcast package is experimental and knows nothing of a lock, so neither was a
fit. In `useDeployments` the library is also a request scheduler: a poll that
stops, backs off, pauses in a hidden tab and never has two requests in flight is
what it does without being asked. In `useReviewPatch` it is the cache that lets
a prefetch and the screen that reads it share one download. The byte count rides
beside the patch under a key of its own, since a query reports no progress and
the screen may be waiting on a download another screen began. The server makes a
client per render in `AppShell`, for the same reason jotai's `Provider` sits
there; the browser makes one per document, because the document is the tab and
the tab is what the cache is shared between; and the local command makes one per
page. The browser client's defaults are the ones the hand-written hooks had — no
retry, no refetch on focus — because a failure from GitHub is usually an answer
and an anonymous reviewer has sixty requests an hour.

jose is the session cookie's seal: every cookie is a compact JWE — `dir` key
management, A256GCM content encryption — and it replaced a hand-rolled
AES-256-GCM seal of about the same shape. What that buys is a standard wire
format with the expiry in the claims, verified by a library whose whole job is
getting JWT right. Cookies sealed before the migration are still read —
`LegacyCipher` in `src/lib/server/session/`, gone 180 days after the deploy,
when the last of them has expired.

`vitest` runs the test workspace. It is a devDependency, so it never reaches a
bundle, and it reads `tsconfig.json`'s paths the way the build does.

## PR visual evidence

For reviewer-visible UI changes, use
[the PR visual evidence skill](.agents/skills/pr-visual-evidence/SKILL.md). Run
`pnpm storybook` for component fixtures and `pnpm storybook:shot` or
`pnpm storybook:video` for captures. Keep fixture stories beside components;
Storybook's separate Vite config must not load the app's Cloudflare/Start
plugins.
