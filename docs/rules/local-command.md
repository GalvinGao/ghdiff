# The local command

`ghdiff` is the second host for this frontend. It runs on a developer's own
machine, reads the git repository it was invoked in, and opens the review
surface against a diff no forge has ever been told about — the working tree, the
index, a branch against its base, or one commit. It ships from this repository,
as `cli/`, and `pnpm build:cli` is what produces it. `cli/README.md` is its own
user-facing documentation.

**The Worker cannot do this, and that is deliberate.** workerd spawns no
process, so `git` can never be executed there, and `node:fs` under
`nodejs_compat` resolves against a virtual filesystem holding bundled modules
rather than the host's disk. Both hold in `pnpm dev` as well, since the plugin
runs the server on workerd there too. The self-hosted Node build could spawn
`git`, but it serves a team, and a team's server has no business reading one
developer's working tree. So local support is a second host and never a feature
added to the first one.

**The contract between ghdiff and a diff source is one patch and one whole
file.** That is the whole of why this costs so little: `git diff` emits the
first and `git show` emits the second, so the viewer, hunk expansion, the
whitespace marks, the cron hints, the path filter, the tree's stat lanes, the
fragment grammar and the browser-stored comments all arrive working and
unmodified. `hydratePartialDiff` becomes **more** valuable here than it is
against a forge, not less: the working tree genuinely does move under the
reader, so `patchFitsNewFile` refusing a mismatched rebuild is everyday work
rather than an edge case.

**Both hosts are a `fetch` handler, and that is Hono's whole job here.** The
server answers web `Request`s with web `Response`s, and `cli/src/server.ts` does
the same over `@hono/node-server`: the guards are middleware, the two routes
return a `Response`, and a patch is a `ReadableStream` on either side. So the
resemblance the contract above describes is a resemblance in the code and not
only in what comes down the wire — and `git.ts` knows nothing about HTTP at all.

What the library is **not** asked to do is decide anything. `serveStatic` is
given a `path` rather than a `root`, because the containment test is this
command's: nothing a `vite build` writes is a symlink today, and a rule that
holds only while that stays true fails quietly. What it is left with — the type
off the extension, `HEAD`, `Last-Modified`, a byte range — is everything after
the path has already been resolved and proved to be inside the web root.

**The argument vector is citty's, and what it means is not.** `COMMAND_ARGS` in
`cli/src/args.ts` declares every option once; citty's `parseArgs` reads an
argument vector against it, and `renderUsage` renders the OPTIONS table from the
same declaration, so an option cannot come to be accepted and undocumented or
documented and refused. `--help` is that table and then four paragraphs citty
cannot know: the invocation table — `ghdiff main` meaning `main...HEAD` is a
decision this command made, not a shape of an option — and the three things a
reviewer otherwise finds out too late.

Two of its habits had to be answered rather than adopted. It parses loosely,
with `strict: false`, so an unknown option arrives as a key rather than an error
— `parseArgs` compares the parsed keys against the declaration and refuses the
first one that is not in it, naming the token as it was typed. And its `runMain`
owns exit codes, help dispatch and the position of `--version`; this command
drives the parser itself instead, so a usage error still exits 2, `-V` still
works, and `ghdiff main --version` still answers with a version. Adapting argv
to suit `runMain` would have been a hand-rolled tokenizer by another name, which
is the thing citty is here to remove.

**A local diff is the one `ReviewTarget` that is not a `ForgeTarget`, and the
two hosted routes turn it away.** `LocalDiffTarget` carries the absolute
repository root and one of its ranges. `reviewCapabilities` answers a local
target the way it answers a commit — comments in browser storage, no draft and
no verdict — so the comment surface needed no change for it. `reviewTargetKey`
keys off the **absolute path and the range** and off nothing the run decided —
the token is minted every time, so a key carrying it would lose a reviewer their
comments the moment they pressed Ctrl-C. `/api/diff` and `/api/file` on the
hosted server accept the local kind in their search schema only to answer
`LOCAL_TARGET_NOT_SERVED` with a 400: that target reaches them only from a link
pasted out of somebody's local run, and 400 with a sentence beats a 500 from a
`switch` that fell through.

`ForgeTarget` is the union of the six forge kinds, and it is what every function
about an address on a forge takes — `reviewTargetSplat`,
`reviewTargetFromSegments`, `forgeOfTarget`, `repoRefFromTarget`. A local target
cannot be passed to one, and that is checked by the compiler rather than by a
guard at each call site; `isForgeTarget` is the one narrowing a caller holding a
`ReviewTarget` uses.

**There is no capabilities handshake, and there was nearly one.** The concept
for this called for a `capabilities` procedure on the RPC contract, so that a
dozen components could stop inferring their situation from a broken request.
What it turned out to need is a host that does not draw what it cannot serve.
`cli/web/main.tsx` mounts `ReviewScreen` under the worker pool, a jotai store
and a query client, and mounts no `AppShell` and no `AppDataProvider` — so there
is no left bar, no watch list, no account menu, no `/setup`, no served counter,
and **not one request to a forge or to the RPC handler**. `LocalAppData`
supplies the forge-shaped fields of `AppData` inert — no session, an instance
that serves nothing — and every one of those states is one the app already
answers: an empty hydrated watch list is what `PullRail` and `PullListButton`
already draw nothing for, and a session with no viewer is the signed-out case.
Two fields are real, because they are settings rather than questions for a forge
— the colour mode and the code font are the same choice wherever the diff came
from, under the same keys, shared with every other ghdiff tab.

`ReviewScreen` then makes a few small allowances, each derived from
`isForgeTarget` and nothing else: the header draws no account control and no
link out, because there is no page the diff was taken from; `ReviewStatusPanel`
offers the retry without the way to `/setup`; and `WatchOfferDialog` is not
rendered, because there is no repository on a forge to offer.

**Security, and every line of it is required.** A loopback server that can read
a repository is an attack surface, and loopback is not a boundary — any page in
any other tab can issue a request to `http://127.0.0.1:<port>`.

- **The socket binds `127.0.0.1`.** Never `0.0.0.0`, and there is no flag that
  offers one.
- **A per-run token in a custom header.** 256 bits from `randomBytes`, minted at
  launch, carried once in the address the command opens and then put in
  `sessionStorage`. `cli/web/localFetch.ts` wraps `window.fetch` once for
  same-origin `/api` requests, which is why no hook and no component knows the
  token exists: on the hosted side the credential is a cookie the browser
  attaches by itself, and neither side carries one above the network layer.
- **No CORS header anywhere, and no preflight answered.** A custom header cannot
  be sent cross-origin without a preflight, so a hostile page is stopped before
  the token is even compared. `OPTIONS` answers 405.
- **A `Host` check.** Only `127.0.0.1:<port>`, `localhost:<port>` and
  `[::1]:<port>`, which is what closes DNS rebinding.
- **One repository, pinned at launch.** The root and the range come from the
  argument vector, never from a request. The query is compared against them and
  then thrown away, which is what turns a tab left open from an earlier run into
  one sentence instead of a patch from the wrong repository.
- **Paths resolved through git, not the filesystem.** The ranges that read an
  object go through `git show <rev>:<path>`, which resolves against the object
  database and can address nothing outside the tree. The working tree is the one
  that touches a real path, and it gets `isReadablePath` plus a `realpath`
  containment test, because a symlink inside the repository pointing outside it
  is a thing only `realpath` can see.

Nothing here goes through a shell: every call is `spawn('git', args)` with an
argument vector, so a branch name cannot become a second command. What it
_could_ become is a flag, which is the one thing `isUsableRevision` is for — an
argument opening with `-` is refused, and
`git rev-parse --verify <rev>^{commit}` is asked at launch so a typo fails in
the terminal rather than as a panel in a browser.

**The port is the storage origin, which is why it is fixed.** `localStorage` is
keyed by origin and an origin includes the port, so a server on whichever port
the kernel happened to offer got a storage area of its own — and every restart
threw away the reviewer's comments, their viewed marks, their colour mode and
their code font. `reviewTargetKey` was already careful to key off the absolute
path and the range and off nothing the run decided; the area holding that key
was not.

So `DEFAULT_PORT` is 7171: clear of the servers a developer already runs — 3000,
4000, 5000, 5173, 8000, 8080, 8888, 9000 — and below every ephemeral range
(32768 on Linux, 49152 on macOS and Windows), so the kernel cannot hand it to an
outgoing connection while a review is open. `args.test.ts` pins all three of
those, because the number is not free to change: moving it moves four kinds of
the reviewer's own data somewhere nobody will look.

It is not a secret and was never doing that job. A hostile page cannot reach
these routes whether it knows the port or not — the token travels in a custom
header, no CORS header is sent, and no preflight is answered.

Fixing it makes one failure reachable that `listen(0)` never could, and the two
answers are not the same. A port the developer **named** and cannot have fails
in the terminal, because serving somewhere else without a word is the one answer
nobody asked for. The **default** being taken falls back to a free port and says
what that costs — notes from earlier runs are at the other address and will not
be in this tab — which is the whole reason the fallback is allowed to happen at
all, since silently opening an empty review is the failure this exists to
prevent. The `Host` check follows either way: `handle` reads the port off
`server.address()` and never off the option.

Two runs now ordinarily share an origin, so `sessionStorage` no longer keeps
their tokens apart — nothing gets through on a stale token, because
`checkApiRequest` compares against the one this process minted, which is where
the guarantee always actually lived. A security comment that has quietly become
false is worse than no comment.

**The command stays alive until Ctrl-C, and that is load-bearing.** Hunk
expansion fetches a whole file per press, so a server that exited after handing
over the patch would break the expand control on every file in the diff. A
`--once` flag is not offered.

**`git diff HEAD` cannot see an untracked file, so they are staged into an index
of their own.** Two spawns, whatever the count. `untrackedStageArgs` is
`git add -N --pathspec-from-file=- --pathspec-file-nul`, reading the paths off
stdin in the `-z` framing `untrackedListArgs` already asked for — stdin and not
an argument vector, because a repository with nothing ignored answers with
thousands. `untrackedDiffArgs` is then a bare `git diff`, needing no revision
and no pathspec because that index holds the untracked paths and nothing else.
Each file comes out as `new file mode` against an old side of `/dev/null`, which
is a patch the browser cannot tell from a file that was added and staged. A
symlink is diffed as a symlink — mode 120000 with its target as the one line —
so an untracked link pointing out of the repository leaks nothing but its own
text.

The index is **temporary and empty**, and both words carry weight. Empty, rather
than a copy of `.git/index`, is what keeps the diff to these paths without a
pathspec: a tracked file is not in that index, so its unstaged changes cannot
appear again under the ones `git diff HEAD` already reported. Temporary is
`GIT_INDEX_FILE`, and `GIT_OBJECT_DIRECTORY` beside it is the whole answer to
why this was once one spawn per file — `--intent-to-add` was turned down for
writing the empty blob into `.git/objects`, and that variable sends the blob to
a directory removed when the response ends. The repository's own object store is
untouched, which was measured rather than assumed.

`untrackedStageArgs` needs git 2.25 for `--pathspec-from-file`. Neither
untracked step is `required`, so an older git costs that block and never the
patch. `gitStream` takes all of them as its `steps` and puts them into one body,
and `GitStep` carries the `stdin` and `env` they need; the rule that the first
byte decides the status is unchanged and simply reaches across the sequence.

Nothing caps the list, on purpose. A repository with no `.gitignore` answers
with thousands, but a cap would be this command deciding which of a developer's
own files are worth looking at. `--exclude-standard` honours a `.gitignore` the
moment it exists, tracked or not, so the case this is really about is a fresh
`git init` over a directory that already has a dependency tree in it. The
untracked files land as one block after the tracked ones; the tree sorts by path
and does not notice, and the diff scroll keeps them together at the end.

Only `worktree` has them. `rangeShowsUntracked` is the whole of that rule:
`--staged` is what is about to land and a file git has never been told about is
not, and the other ranges are commits, where every file is tracked by
definition.

**Which files those are reaches the browser through the document, not through
the patch.** An untracked file's diff says `new file` like any other, and
nothing in the text tells it apart from a staged addition — nor should it. So
`serveDocument` puts the paths into `window.__GHDIFF_LOCAL__` beside the
repository and the range, `buildReviewData` takes them as a set, and
`reviewFileStatus` turns a `new` file whose path is in it into `@pierre/trees`'
own `untracked` status, which the tree already draws a badge for.

A response header beside `x-ghdiff-notice` was the runner-up and it loses on
size: `/api/diff` holds the exact list it built the patch from, where the
document holds a second listing taken a moment earlier — but nothing bounds how
long that list is, and a repository with an unignored `node_modules` would put
megabytes into a header. What the millisecond between the two listings costs is
one file: written in that window, it is in the patch as an ordinary addition and
cannot be hidden until the page is loaded again.

**And the switch that hides them is the display menu's, while the state is the
filter's.** `ReviewFilterState.hideUntracked` sits beside the preset, the
statuses and the query, so `applyReviewFilter` drops those entries in the same
pass and both panes and the footer count agree by construction — and **Clear
filters** puts them back. `ReviewHeader` learns none of that: it takes
`untracked` as a count, a boolean and a callback, and draws nothing at all when
the count is zero, which is every diff a forge serves.

Untracked is exempt from the git status list, which is the one place the two
controls could contradict each other. `STATUS_ITEMS` in `FilterMenu` offers the
four statuses a patch can describe and never this one, so picking **Added**
would otherwise take the untracked files away with nothing left to bring them
back. One switch owns them.

**A commit is its own range, and it is `git show` rather than `git diff`.** A
bare revision already means a branch on its base — `ghdiff main` is
`main...HEAD` — so one commit's own changes are asked for with `--commit`, a
boolean flag beside the optional revision rather than a value, so
`--commit abc123` and `abc123 --commit` read the same and `--commit --no-open`
swallows nothing. Bare, it is HEAD. `show --format= --first-parent -m` is what
`diffArgs` hands git: a commit has no second endpoint to name, `rev~1` does not
exist for a root commit and picks a merge's first parent silently, and `show` on
a merge would otherwise print a combined `@@@` diff the parser cannot read.

`pinCommit` in `cli/src/repo.ts` resolves the name to its full sha before the
target is built. HEAD is a pointer the developer is about to move, and the key
`reviewTargetKey` holds is what the browser files comments and viewed marks
under — `commit HEAD` would hand this commit's notes to the next one. The header
prints the short sha for the same reason the label of a forge commit does.

**Which file the new side is depends on the range, and `staged` is the one that
catches people.** `git diff --cached` diffs the index against HEAD, so the new
side is the **index** — `git show :0:<path>` — and reading `HEAD:<path>` there
would show the side it diffed _from_. `worktree` is the only range whose new
side is a path on disk. `newSideSource` is where those answers live, and
`gitRange.test.ts` pins them.

**The size of a file is asked for before it is sent.** `git cat-file -s` and
`stat` both answer exactly, so a file over `MAX_FILE_BYTES` is turned away with
a 413 rather than truncated into a body the browser would then reverse-apply the
patch onto. This is the one host that can do that: a forge states a compressed
length or none at all. `src/lib/fileLimit.ts` holds that figure and its
sentence, because a third end reads them and the third has no business importing
`@pierre/diffs`.

**The status of a streamed answer is decided by the first chunk, and `gitStream`
resolving is that rule said out loud.** git writes its failures to stderr and
exits before it has written a byte of stdout, so a run that produced output is a
run that worked. `gitStream` therefore answers at the first of three moments — a
first chunk, with a `ReadableStream` that replays it and goes on; the whole
sequence done having written nothing, with an empty one; or a `required` step
failing having written nothing, by throwing. A failure _after_ that cannot be
reported — the status has gone — and the body ends early instead. A clean exit
with no output is not a failure: an empty diff means nothing has changed yet,
and the viewer draws its own empty state for it.

That inversion is what Hono needs and what `node:http` did not: a `Response`
carries its status before its body, where a `ServerResponse` let the first
`write` send one. It also moved two things off the socket and onto the stream.
Backpressure is `desiredSize` and `pull` rather than `write` and `drain` —
node-server reads one chunk at a time and stops while the socket is full, so a
43 MB patch waits in the pipe and never in this process. And a reviewer who
navigates away cancels the stream, which is what kills the child: node-server
cancels the reader on `close`, so nothing in `server.ts` has to watch the
request.

`gitStream` takes its own `cleanup`, and that is not tidiness. It answers at the
**first** byte and the two untracked steps run after that, so a caller that
discarded the temporary index when the promise resolved would pull it out from
under the steps still using it.

**Two more builds, and neither one reaches the Worker.**
`vite.cli-web.config.ts` builds the client — a plain single-page build with its
own `index.html`, because `pnpm build` produces a document TanStack Start's
server entry renders and there is no server here to render it.
`vite.cli-bin.config.ts` builds the command as one file with no runtime
dependencies, so `npx` has nothing to resolve and an install cannot be broken by
a transitive dependency. `ssr: { noExternal: true }` is what makes that true:
Vite externalizes a dependency in an SSR build by default, and without it the
output would carry `import { Hono } from 'hono'` into a file installed with
nothing beside it. Both write under `dist/cli`, and the manifest plugin puts
`cli/package.json` and `cli/README.md` beside them, so `dist/cli` is a directory
`npm pack` and `npm install -g` both accept as it stands.

The client build carries no sourcemap and the command's does: `npx` downloads
the client's map before the command can run at all, and a stack trace in a
terminal is the one that gets read.

The command imports a few things out of `src/` and they are all pure — the
target model, the two pre-paint scripts, the file-size cap, and the compiled
messages. None of them reaches for a browser API or for `@pierre/diffs`, and the
three packages it does carry are small and have no dependencies of their own.
Adding an import to `cli/src/` that pulls in the viewer would be the change to
argue against.

Those three are `hono`, `@hono/node-server` and `citty`, and they are the
command's alone: nothing in `src/` imports one, so the Worker's graph is
untouched. They sit in the root `dependencies` beside everything else this
repository bundles; `cli/package.json`, which is the manifest that actually gets
published, still declares none.

**The document is filled in when it is served, not when it is built.**
`serveDocument` puts three scripts into the head. Two are the app's own
pre-paint scripts out of `src/lib/prePaintScripts.ts` — the same text
`__root.tsx` renders, so a reviewer's colour scheme and code font settle here
exactly as they do on the hosted side, with one statement of each rather than
two free to drift. The third is the repository and the range, which the client
would otherwise have to ask for in a request it cannot make until it knows them.
The token is not among them: it arrives in the address and nowhere else.

**Tailwind's sources are stated in `globals.css` rather than detected.**
Automatic detection starts from the Vite root, and the two builds have different
roots — left to itself the client build scans `cli/web` alone and every utility
in `src/` is missing from the stylesheet it serves, which is a page that renders
and is not styled. `@source '../src'` and `@source '../cli'` are relative to
that file, so both builds scan the same two directories.

## Its tests

`cli/src/` is the vitest project `cli`, run by `pnpm test:lib` beside `lib`, and
it holds to the same import rule as everything else: `@/` for `src/`, no `.ts`
suffix. Three of its modules are pure and tested — the argument parser, the git
argument vectors, and the host and token guards; the path check they import is
`src/lib/filePath.ts`, tested in the `lib` project. `git.ts`, `repo.ts`,
`server.ts` and `main.ts` are not: they spawn processes and bind sockets, and
they are checked by running the command.

`args.test.ts` carries more than the decisions, because citty parses loosely: it
asks `node:util.parseArgs` for `strict: false`, so an option this command does
not have arrives as a key on the parsed object rather than as an error. The set
`parseArgs` compares against is built from the declaration, and the test that
pins the declaration's own keys is what keeps the two from drifting apart.
