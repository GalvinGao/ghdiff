# Platform and tests

The runtime and the tests: the Worker, Node, Vite, Docker, the served counter,
the test layers, and the fixtures and record scripts behind them.

**A serve is counted where the serve happens, and the figure is an estimate on
purpose.** The footer's **Served** line is one key, `served:total`, and
`src/lib/server/served/count.ts` is what stands between a counter and a store
that is not one. The store is a `ServedBackend` from
`src/lib/server/served/backend.ts`: Workers KV behind unstorage's binding driver
on workerd, an in-memory unstorage on Node. KV takes one write per second per
key and answers a second one with 429, and two writes that overlap overwrite
each other rather than add up. So a serve writes nothing. It adds one to a
number the process holds, and one flush later folds however many arrived into a
single read-add-write, kept alive past the response by the backend's `keepAlive`
— `waitUntil` on workerd, a floating promise on Node. A flush runs at most
`MAX_FLUSH_ROUNDS` — 5 — rounds, a second apart, because the flush runs behind
`keepAlive` and an unbounded loop would hold one request open for as long as
traffic lasts. `lastWritten` guards the read, because a read that came back
stale would take the figure backwards. What is still lost is a process that dies
with a flush outstanding, and two locations that write in the same moment. A
footer figure is allowed to be an estimate. The exact one costs a strongly
consistent store, which a footer line is not worth.

Which backend a bundle gets is answered at build time, never sniffed at runtime,
and dead-code elimination drops the other half: `servedBackend()` compares
`import.meta.env.VITE_GHDIFF_TARGET` against `'node'` — Cloudflare is the
default path, Node is the branch that gets named, the convention everywhere in
this app — so the Cloudflare build never sees the in-memory backend, and the
Node build never sees `cloudflareBackend()` or its `cloudflare:workers` and
unstorage driver imports. The imports are dynamic because a static one would
fail at bundle resolution time on the Node build; here they sit in the branch
DCE removes. vitest.config.ts defines the same target `node` for the tests, so
they run the in-memory half and the dynamic import never executes.

`/api/diff` takes the count and no other route does, because that route **is**
the serve: `recordServe` fires only after `forge.diff(target, cred, log)` has
answered, so a 404 and a spent quota are not serves, and a target the query
could not parse never reaches it. `stats.served` is the read half, and it is the
one procedure that asks GitHub nothing — it carries no token, and it lets a
store that cannot answer throw. `ServedCount` then prints no figure at all,
which is the right answer: `Served 0 diffs` is what a failed read would
otherwise say.

## The Worker

`wrangler.jsonc` sets `main` to `@tanstack/react-start/server-entry` and
`compatibility_flags: ["nodejs_compat"]`. The flag buys the populated
`process.env` that `parseDeploymentConfig` reads at each request boundary.
Locally those variables come from `.dev.vars`; on Cloudflare they come from
Worker secrets. The build reads one variable and no more — `GHDIFF_TARGET`,
straight from the process environment, which `pnpm build:node` sets inline — so
`.dev.vars` is a runtime file, never a build input. Every variable the server
reads is validated by the one zod schema in `src/lib/server/config.ts`.

`kv_namespaces` binds one namespace, `GHDIFF`, which is this app's own key-value
store. It holds one key today, the one the footer's **Served** counter reads and
writes, and it is named for the app rather than for that counter so the next
thing that needs a key has a place to go. The Worker reaches it through
`import { env } from 'cloudflare:workers'` rather than through a handler
argument, because the counter is called from a route and from an RPC procedure
and neither of them is handed a Cloudflare `env`. That import lives only in
`src/lib/server/served/backend.ts`, dynamically inside `cloudflareBackend()`, so
a static one would fail at bundle resolution time on the Node build; which
backend a bundle gets is answered at build time, never sniffed at runtime, and
dead-code elimination drops the other half — so no stub of the
`cloudflare:workers` specifier exists anywhere.

That import is typed by `worker-configuration.d.ts`, which `wrangler types`
generates from `wrangler.jsonc` and which is **not** committed — `.gitignore`
and both oxc tools already skip it. `pnpm typecheck` therefore runs
`wrangler types` first, so a fresh clone and CI both typecheck without a
separate step. Re-run it after any change to the bindings.

The GraphQL document types are the opposite arrangement: committed, with no CI
gate. `pnpm codegen:gql` runs `@graphql-codegen/client-preset` over the
`graphql()`-tagged documents in the forges' `<forge>.gql.ts` files against the
vendors' live schemas — the URLs in `codegen.ts`, so a run needs the network —
and writes `src/lib/server/forges/gqlgen/`, which both oxc tools skip like
`src/routeTree.gen.ts`.

`vite build` writes `dist/client` (the static assets, which the generated
`dist/server/wrangler.json` binds) and `dist/server` (the Worker). Nothing in
the build reads a GitHub token.

The Worker script is about 3 MiB gzipped, and size is no longer the constraint
it was: the platform limit is 64 MiB uncompressed on every plan, and Cloudflare
sets no compressed-size limit. `pnpm exec wrangler deploy --dry-run` prints both
figures. Almost all of it is shiki: `@pierre/diffs`'s own entry imports the bare
`shiki` specifier, which carries the lazy loader for all 300-odd grammars, so
importing anything from that package pulls the whole registry into whichever
bundle it lands in. The server never highlights, so none of those chunks is ever
evaluated there. Both forges ship in every build, because which hosts a
deployment serves is a runtime answer, not a build-time one.

A dependency that only a stylesheet imports is not in that graph. The three
fontsource packages are reached from `globals.css`, which `__root.tsx` links as
a `?url` stylesheet, so their woff2 files are written to `dist/client` and
uploaded as assets. They cost the script nothing.

## Tests

`pnpm test:lib` runs vitest's `lib` project over `src/lib/**/*.test.ts`, through
the same Vite pipeline the app builds with — imports carry no `.ts` extension
and no `/index.ts`, and cross-directory imports go through the `@/` and `@test/`
aliases, whose single definition is `tsconfig.json`'s `paths` (read by tsc,
Vite, and vitest's `resolve.tsconfigPaths` alike). oxlint's
`import/no-relative-parent-imports` holds the line on `../`.

A test that needs a particular deployment constructs it as a plain value:
`parseDeploymentConfig({ GITLAB_HOSTS: '[...]' })` parses one from env-shaped
input, and helpers like `corpConfig` in `src/lib/server/credentials.test.ts`
wrap that with defaults. Everything below the request boundaries takes the
config as a parameter — there is no process-wide cache, so there is nothing to
override and nothing to reset. Client modules take the host list as a parameter
the same way.

Three layers, and they answer different questions. Pure domain logic in
`src/lib/` is unit tested as it always was. The RPC procedures are tested
against an in-memory fake forge (`src/lib/rpc/router.test.ts`, through the
registry's `registerForge`): dispatch, credential forwarding, capability gates,
and the status mapping, with no network. The GitHub forge is tested against HTTP
itself, through msw handlers (`test/msw/`) whose fixtures are recorded from the
real API where anonymity allows (`test/fixtures/`), so a shape this repository
invented cannot pass for a real one.

The fixtures are recorded by the scripts in `test/fixtures/record/`, which share
one scaffold (`record/lib.mjs`): the retry, the file per source, and the
`_meta.json` manifest. A re-record keeps what it did not record:
`record/gitlab.mjs` preserves the `_meta.json` entries for fixtures it was not
asked to fetch. A recording touches real data, so
`record/gitlab-discussions.mjs` anonymizes what the private instance answers —
bodies, usernames, avatars, file paths and the instance's own ids are replaced
on the way out, and `sanitizeNote` drops `resolved_by` and `suggestions` — one
names a real person, the other quotes the source's own code. The real usernames
and instance ids the anonymization needs live in
`record/gitlab-discussions.local.json`, which is gitignored (the committed
`.example` shows the shape), and a username with no pseudonym stops the
recording rather than passing through.
