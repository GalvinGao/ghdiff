# Platform and tests

The runtime and the tests: the Worker, Node, Vite, Docker, the served counter,
and the test layers.

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
the serve: `gitHubResponse` returns only when a source answered, so a 404 and a
spent quota are not serves, and a target the query could not parse never reaches
it. `stats.served` is the read half, and it is the one procedure that asks
GitHub nothing — it carries no token, and it lets a store that cannot answer
throw. `ServedCount` then prints no figure at all, which is the right answer:
`Served 0 diffs` is what a failed read would otherwise say.

## The Worker

`wrangler.jsonc` sets `main` to `@tanstack/react-start/server-entry` and
`compatibility_flags: ["nodejs_compat"]`. The flag buys two things this app
needs: `AsyncLocalStorage` for the request logger, and a populated
`process.env`, which is where `resolveGitHubToken` finds `GITHUB_TOKEN` and
`readKeyring` finds `SESSION_SECRET`. Locally that variable comes from
`.dev.vars`; on Cloudflare it comes from a Worker secret.

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
evaluated there.

A dependency that only a stylesheet imports is not in that graph. The three
fontsource packages are reached from `globals.css`, which `__root.tsx` links as
a `?url` stylesheet, so their woff2 files are written to `dist/client` and
uploaded as assets. They cost the script nothing.

## Tests

`pnpm test:lib` runs vitest over `src/lib/` and `cli/src/` — two projects in
`vitest.config.ts`, which vitest reads instead of `vite.config.ts`, so the app's
Cloudflare and Start plugins never load for a test. Only pure logic in
`src/lib/` is unit tested; the surface is checked in a browser. `pnpm test` is
the wildcard over every `test:` script.

Vitest resolves imports the way the bundler does, through `tsconfig.json`'s
`paths`, so a test imports exactly what the module beside it imports: `@/` for
`src/`, a same-directory `./x` for a sibling, and never a `.ts` suffix.

`cli/src/` is the `cli` project. Three of its modules are pure and tested — the
argument parser, the git argument vectors, and the host and token guards; the
path check it imports is `src/lib/filePath.ts`, tested in the `lib` project.
`git.ts`, `repo.ts`, `server.ts` and `main.ts` are not: they spawn processes and
bind sockets, and they are checked by running the command.

`args.test.ts` carries more than the decisions now, because citty parses
loosely: it asks `node:util.parseArgs` for `strict: false`, so an option this
command does not have arrives as a key on the parsed object rather than as an
error. The set `parseArgs` compares against is built from the declaration, and
the test that pins the declaration's own keys is what keeps the two from
drifting apart.
