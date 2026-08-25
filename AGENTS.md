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
  layout.tsx               the app shell: the permanent left bar, then the page
  page.tsx                 home: the open pull requests, and a box for any GitHub URL
  gh/[...segments]/        mirrors github.com paths: /gh/owner/repo/pull/123
  api/diff/                one unified diff
  api/comments/            GitHub pull request review comments: read, post, reply, delete
  api/github/pull/         one pull request's own details, for the header card
  api/github/pulls/        open pull requests for the watched repositories
  api/github/viewer/       who the token belongs to
components/                the left bar, the review surface, and their chrome
hooks/                     client state: token, color mode, patch, comments,
                           pulls, sidebar width
lib/                       pure domain logic, unit tested
lib/server/                server-only: the GitHub client
```

## Rules this project holds to

**The left bar belongs to the app, not to a screen.** `app/layout.tsx` mounts
`AppShell`, which is the bar plus whatever page is open. Moving between pull
requests never unmounts it, so the list is fetched once per session. The bar
reads the pull request on screen out of `usePathname()` rather than being told,
which is what lets it sit above the home page, a review, and a 404 alike.

**One owner for the state the whole app shares.** `AppDataProvider` mounts
`useColorMode`, `useGitHubToken`, `useWatchedRepos`, and `useOpenPulls` once,
above the bar and the page. Each of those reads browser storage, and a hook that
reads storage owns a copy of what it read: two instances would let the bar and
the page disagree about the token or the watch list. Call `useAppData()`; never
call those four hooks in a screen.

**The pull request list is repository, then author, then stack.**
`groupPullsByRepo` in `lib/pulls.ts` produces that shape, `buildPullStacks` in
`lib/pullStacks.ts` produces the stacks, and everything still level with
something else goes by pull request number, newest first. GitHub has no stack
object to ask for, so a stack is read off the branches: one open pull request
whose base branch is another open pull request's head branch is stacked on it.
Stacks are built inside an author group, so two people never share one chain.

**The review and the check axes need a token.** `/api/github/pulls` asks GraphQL
for `reviewDecision` and the head commit's `statusCheckRollup`, which REST does
not carry. GraphQL refuses an anonymous caller, so a reviewer with no token gets
the REST list and `PullSummary.status` stays **absent** — not `none`. Absent
means "never asked", and `PullStatusIcon` leaves the square off the row rather
than claim there is no review and no CI.

**The status square is GalvinGao/floodgate's, deliberately.** Left half review,
right half checks, white `+` when the author pushed after somebody asked for
changes. The colours are Primer's, defined per scheme as `--app-status-*` in
`globals.css`. floodgate paints the same square into the favicon of every pull
request tab, so a colour must keep meaning the same thing in both places: change
`lib/pullStatus.ts` and floodgate's `lib/pr-status.ts` together, or not at all.

**The filter drives both panes.** `applyReviewFilter` returns the items for the
viewer and the paths for the tree from one pass. Never filter one without the
other.

**The path search is the filter's query, not the tree's search.**
`@pierre/trees` has a search box of its own, and it is off (`search: false`). It
rendered inside the tree's scroll region, below the sidebar's own controls, and
it narrowed the tree while the diff kept every file. `PathSearchField` in
`ReviewSidebar` writes `filter.query` instead, which `applyReviewFilter` tests
along with the preset and the statuses. Closing the field clears the query, so
no hidden control can hide files.

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

A reply is the one thing that re-measures a card, because it adds a message to
the thread the height was taken from. That is one relayout for one deliberate
act, and it is the same relayout posting the first comment on a line already
costs. Everything else stays fixed.

**A comment body is untrusted, and the schema is what makes it safe.**
`CommentBody` parses raw HTML with `rehype-raw` and then filters it with
`rehype-sanitize` on its **default** schema, which follows GitHub's own
sanitation: `img`, `details`, `kbd`, the table elements and the layout
attributes survive, `script`, `style`, `iframe`, every `on*` handler, and any
`src` or `href` outside http and https do not. GitHub's editor writes HTML into
bodies — an attached screenshot is an `<img>` with a width — so dropping it left
descriptions full of holes. Widening that schema means deciding a tag is safe
against a body any GitHub user can write, so do not widen it without saying here
why the addition cannot carry script or a navigation.

**One row in the tree, not a trail.** `FileTreeItemHandle.select()` **adds** to
the selection, and the diff's scroll selects a row on every file it passes. So
`ReviewFileTree` deselects `getSelectedPaths()` before it selects the new row.
Without that the tree fills with every file already read, and
`onSelectionChange` stops answering a click, because it only acts on a selection
of one.

**A file whose name is its type needs `lang`.** `getFiletypeFromFileName` reads
the text after the last dot of the whole path, so `docker/Dockerfile` and
`.env.local` both resolve to plain text. `lib/diffLanguage.ts` answers for those
two families and `buildReviewData` sets the answer on the item as `lang`, which
the renderer prefers over its own guess. Add a family there, with its cases in
`lib/diffLanguage.test.ts`.

**A modal is the platform's `dialog`.** `components/ui/Dialog.tsx` drives
`showModal()` from React state, which brings the focus trap, Escape, the inert
background, and the top layer, so a dialog opened from inside a portaled menu is
not clipped and needs no z-index. Tailwind's preflight zeroes the margin on
every element and on `::backdrop`, so the centering (`m-auto`) and the backdrop
colour are set explicitly.

**A sidebar drag renders nothing.** `hooks/useSidebarWidth.ts` writes every
pointermove straight onto `--reviewer-sidebar-width` on the layout element, and
tells React once, on pointerup. The grid column and the handle's own `left` both
read that property, so the pane and the seam travel together while the
`CodeView` beside them is neither re-rendered nor re-measured. The drag's active
look comes from a `data-resizing` attribute on the handle for the same reason.
Two widths are kept apart on purpose: the width the reviewer chose, which goes
to browser storage, and the width on screen, which a window too narrow for both
panes squeezes. Widening the window gives the choice back, and a browser tab
reporting a viewport of zero — which happens while a page loads and while a tab
is hidden — is ignored rather than treated as a layout to shrink into.

**A file's diff stats belong to the tree's decoration lane.** `@pierre/trees`
draws `renderRowDecoration` after the name and before the git badge, so the
numbers land in a lane whose right edge does not move with the row's
indentation. `lib/treeStats.ts` sums each directory from its descendants and
reports the widest number in the diff; `ReviewFileTree` turns that into two
fixed column widths, so the additions of every row end on one pixel and the
deletions on another. The lane is `flex: 1 0 auto`: it grows into the space a
short name leaves and never shrinks, so a long name truncates and the figures
stay whole. **A directory row is keyed with a trailing slash**, because that is
how the tree names its own rows.

**A thread's opening author decides whether the sidebar lists it.** A review bot
writes most of the comments on a busy repository, so `lib/commentAuthors.ts`
splits them into People and Bots and the strip at the foot of the panel holds
one kind at a time. GitHub types an App's account as `Bot` and `/api/comments`
forwards that; `isBotLogin` is the fallback for a comment kept in browser
storage, which keeps the login and nothing else. A bot answering a person leaves
the thread under People.

**A path in the comment list is trimmed from its start.** The end of a path
identifies the file, and a column of `components/CommentThre…` against
`components/CommentsLi…` says nothing. `dir="rtl"` moves the ellipsis to the
other end while the letters stay left to right, and a leading U+200E keeps a
path that opens on a dot or a slash from being reordered around it. The hover
layer that shows the whole path wraps at U+200B after each separator, so it
breaks between directories rather than through one.

**The footer strip belongs to the tab that is open.** The files tab has a size
to report and the comments tab has a filter to set, and neither has anything to
say about the other. The size it reports is `applyReviewFilter`'s own `stats`,
not the patch's: a footer that counted the whole patch while the tree listed a
third of it made the two panes disagree.

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
