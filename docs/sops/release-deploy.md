# SOP: release and deploy

What a change goes through, in order.

## 1. The gate (every commit)

```bash
pnpm test:lib && pnpm typecheck && pnpm lint && pnpm fmt:check \
  && pnpm build && pnpm exec wrangler deploy --dry-run \
  && pnpm build:node
```

The dry run prints the Worker's size, in the clear and gzipped. The platform
limit is 64 MiB uncompressed on every plan, and there is no compressed-size
limit — so a dependency conversation is about what the dependency buys, not
about whether it fits.

## 2. CI (every push and pull request)

- **check** — oxlint, oxfmt, tsc, unit tests.
- **build** — the Cloudflare build, the routeTree staleness check, the dry run,
  then `pnpm build:node` for the self-hosted shape.

A red `routeTree` step means `pnpm build` changed `src/routeTree.gen.ts`; commit
the regenerated file.

## 3. Deploy to Cloudflare (push to `main` only)

The deploy job builds again and calls `cloudflare/wrangler-action` with
`CLOUDFLARE_API_TOKEN`. `wrangler deploy` builds nothing itself — the Vite
build's `.wrangler/deploy/config.json` is what points it at the generated
`dist/server/wrangler.json`.

A superseded pull request's run cancels; a superseded deploy never cancels
mid-flight. If a run is stranded (an Actions outage), cancel it before pushing
again — a queued run holds the `main` concurrency group against the next push.

## 4. The self-hosted image

```bash
docker build -t ghdiff .
docker run -p 3000:3000 --env-file .dev.vars ghdiff
```

Tag and push it wherever your registry lives. There is no publish job; the image
is built where it is used. See `self-host-node.md` for verification and
upgrades.

## Roll back

`git revert` the commit and let CI redeploy. The Worker deploys the reverted
build like any other; the self-hosted image rebuilds from the same commit.
Nothing else rolls back — sessions are sealed cookies and the served counter is
an estimate.
