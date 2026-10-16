# The review surface

The diff viewer and everything around it: file loading and hydration, expansion,
line marks, the comments UI, the file tree, fragments and anchors, panes, and
the phone layout.

**The bar's two widths travel; a drag does not.** `PullRail` transitions `width`
over 200 ms, so a collapse reads as the reviewer's own press. A drag must not
travel: `usePaneWidth` repaints the custom property on every pointermove, and a
transition would leave the bar behind the pointer. `PaneResizeHandle` carries
`data-resizing` for the length of a drag and is a child of the bar, so
`has-[[data-resizing]]:transition-none` is the whole test. The toolbar row under
the header clips for the same 200 ms: both buttons in it are `shrink-0`, and a
row narrower than the two of them would put them over the diff.

**The watch list and the reload sit at the top of the bar, not at its foot.**
They act on the list as a whole, and the top of the list is where a reviewer
starts to read it, so they are a second `h-9` row under the header and above the
rows. The phone sheet puts the same two controls above its list for the same
reason. The watch offer names that place in its sentence, so moving the row
means moving the words in every catalog with it.

**The unmodified lines cost one request, and only for the new side.** A patch
carries three lines of context around each change, and `@pierre/diffs` draws the
rest of a file only once it has both whole sides — which is what `loadDiffFiles`
hands it, and what puts the expand controls on a hunk separator in the first
place. `/api/file` fetches the new side, and `src/lib/diffHydration.ts` rebuilds
the old side from it: outside a hunk the two sides are the same lines by
definition, and inside one the patch holds the old lines itself, so the old file
is the new file with each hunk's new-side lines swapped back. That is a
reverse-apply, it is exact, and it needs no merge base — which is the whole
reason it is done this way. A pull request's diff runs from the merge base,
`pull.base.sha` is not that commit, and asking GitHub for it costs a compare
call whose answer carries up to 300 file patches with it.

Exact only against the file the patch describes, though. A branch that moved
between the diff and the press gives a new side the patch does not fit, and
reverse-applying that would print lines nobody wrote — worse, it would corrupt
the changes as well, because `hydratePartialDiff` re-reads a hunk's own lines
out of the two arrays too. `patchFitsNewFile` is asked before every rebuild and
`useDiffFileLoader` rethrows what it refuses, so the file stays partial and the
foot of the screen says why. Never hydrate a side that has not been checked.

**A file's commit is `refs/pull/{n}/head`, its own sha, or the range's head.**
`newSideRef` in `src/lib/server/forges/github.ts` answers for all three targets
without a second request, and the pull ref resolves in the base repository even
when the head belongs to a fork. A compare range typed across two forks
addresses its head as `owner:branch`, which no source can read, so that one
range gets no unmodified lines and says so.

**Which source answers turns on the credential, and only on that.** A caller
with none has sixty REST requests an hour and needs them for the comments and
the pull request list, so its file comes from `raw.githubusercontent.com`, the
host behind github.com's own **Raw** links, which spends none of them. A caller
with one has five thousand and may be reading a private repository, so its file
comes from the contents API, which is the only one of the two that answers for
one. One request per file either way, and the reviewer pays it once: the library
hydrates the metadata object in place, and `items` keeps the same `fileDiff`
reference through a filter change and a comment revision alike, so the lines
stay expanded.

**A big file is safe because the limits hold, which is why the header can offer
the whole of it.** The library reveals `expansionLineCount` lines — 100 — per
press on a region larger than that, and it hides its own **Expand all** control
on the separator, so the separator's visible affordance is the bounded one; a
shift-click is what asks for the whole region there. `ExpandFileButton` in
`ReviewViewer` is the unbounded press, beside the file's name where github.com
puts the same control: it sends the library's own shift-click call —
`expandHunk` with an infinite count, which each region clamps to its own size —
to every gap and to the tail, one file per press and never the diff. It appears
only where there is something to reveal, `change` and `rename-changed`: a new or
deleted file arrives whole, and a pure rename has no lines at all. Above 100 000
lines the library stops highlighting rather than tokenizing forever, and the
virtualizer lays out what it needs. So the only limit worth stating is the byte
one, and `MAX_FILE_BYTES` is 4 MiB.

**Both ends hold that limit, because neither one can hold it alone.**
`content-length` counts the bytes on the wire, and GitHub compresses: 4.8 MB of
word list arrives declaring 1.4 MB, and a chunked answer declares nothing. So
`statedSize` in `src/routes/api/file.ts` answers with nothing unless the header
is a figure about the file — no `content-encoding`, and a number — and the route
turns away only what it can prove. `useDiffFileLoader` counts the decoded bytes
as they arrive — `readStreamedText` with `maxBytes` — which is the guard that
always holds: the browser is where a file becomes a string, and the string is
the cost the limit is about. Both ends read `MAX_FILE_BYTES` and
`FILE_TOO_LARGE` from `src/lib/diffHydration.ts`, so they cannot come to differ
about the figure or the sentence.

**A changed line that says less than its colour claims is dimmed, and never
hidden.** `findLineMarks` in `src/lib/lineMarks.ts` reads each file's own change
blocks and names the pairs whose two sides differ only in whitespace — the
`git diff -w` rule — which are a formatting pass, so both sides go quiet. It is
text arithmetic over the patch, ready at parse time, and honest about its limit:
`0x80` against `128` still reads as a change. Dim and never hide, because a
hidden line would break the promise this app is built on — a comment anchored to
GitHub's own diff lines — where a dim one can still be read, selected and
commented on.

**The marks travel through the one per-line door the viewer has.**
`@pierre/diffs` draws each file in a shadow root and has no line-decoration
option, but `onPostRender` hands over the file's container after every render
pass, and `unsafeCSS` installs a stylesheet inside the root. So `applyLineMarks`
in `src/components/diffLineMarks.ts` stamps `data-ghdiff-quiet` onto the rows
each pass just built — matched by the library's own `data-line` and
`data-line-type`, in split and unified alike — and `LINE_MARKS_CSS` says what
the stamp looks like. A pass renders only the virtualized window, so a walk
touches tens of rows, and it re-runs because the next pass rebuilds them. The
display-menu switch costs no render at all: the stamps stay, and
`--ghdiff-quiet-opacity` — a custom property set beside the viewer and inherited
through the shadow boundary — is the whole toggle, the same trick `usePaneWidth`
plays. Marks are cached in a WeakMap per metadata object, which hydration
mutates in place and a filter change reuses, so an entry cannot go stale.
`CodeView` adds the current item context as `onPostRender`'s fourth argument, so
`ReviewViewer` passes `item.fileDiff` to every annotation pass through that
public contract rather than reaching into the renderer's protected cache.

One thing the forge decides rather than this app: a line comment written on an
expanded line of a **pull request** is a line outside the diff, and the review
comment API refuses one. The failure arrives as the forge's own sentence in the
strip along the foot of the screen, which is where every other comment failure
already lands. A commit and a compare range keep their comments in the browser
and take them anywhere.

**A lens reads one kind of file another way, and it is not a plugin.**
`src/lib/lenses/lenses.ts` lists every lens in `LENSES`, compiled in. A lens
claims files of the diff, builds a model of its own from their patches, and a
panel in `renderCodeViewHeader` draws that model above the first file, in the
diff's own scroll. A claimed file leaves the viewer's items and stays in the
tree, because it is still part of the review and the panel is where it is read:
a tree press on one scrolls to its panel, and a jump that names one of its lines
— a panel row, a comment, a fragment — puts the claimed files back into the diff
first and lands over the next frames through `runOnFrames`. The lenses run over
what the filter left, so a hidden file is in neither place. Add a lens by adding
its settings and model to `LensSettingsById` and `LensModelsById` and its entry
to `LENSES`; `applyLenses` gives a file to the first lens that claims it.

**A lens is per repository, kept in this browser, and one press turns it off.**
`ghdiff-repo-lenses` is one value keyed by `repoLensKey` — owner and name
without case, or `local:` and the root for the command — and nothing is read
from the repository itself: no `.gitattributes`, no committed file. That was
decided, not overlooked. Every panel sits in `LensFrame`, the tray whose strip
names it a beta lens and carries **Turn off** and a gear, and the display menu
has a **Lens** section with a switch per lens and a gear beside its name. **Turn
off** is one press and no dialog, and a `Toast` then says where the switch went
and offers Undo, because a panel that vanished with no word would leave the
reviewer hunting for it. There is no second way to hide a lens for the visit:
"show as files" and "turn off" read as the same press, so only turning off is
offered. A jump to a claimed line still draws the files, and a one-line bar
offers the table back.

The card holds content and nothing else. What a lens lets the reviewer tune —
the localization lens's languages — is in the strip's gear menu, and a clean
check says nothing: a line that reads "all good" on every diff is a line nobody
reads on the day it reads otherwise, so the header prints a count only when
there is a problem.

**The localization lens reads a catalogue from the patch alone.** Detection in
`localePaths.ts` wants three or more JSON files that differ only by a locale
segment, so `messages/en.json` and `locales/en/app.json` are both found and two
stray files named `id` and `it` are not. `readFlatCatalogue` reads
`"key": "value"` lines and **refuses the whole file** for any changed line it
cannot read, or one deeper than the shallowest entry: a refused file stays in
the diff, because a table that guessed would cost the reviewer a change they
never saw. Nested catalogues and plural variants are that refusal today; the
whole-file reader that would lift it can use the hydration path. The checks in
`model.ts` compare placeholder names with the base and run only on the locales
the diff touches — a catalogue the pull request left alone is not in the patch
to be checked. A translation equal to the base is a note, never a problem. The
reviewer's language choice is one list per repository; the base is always shown,
generated locales (`key`, `pseudo`) never are, and a hidden locale's problem is
still printed under the rows that are.

**A cron expression says when it runs beside the code.** `src/lib/cron.ts`
recognizes whole quoted literals, bare `cron` / `schedule` fields, and entries
in `crontab`, `*.cron`, and `cron.d/` files. A syntax gate keeps the input to
standard five-field cron, then `cron-schedule` validates and expands it into
sorted, distinct field values. The gate is necessary even with a parser:
`cron-schedule` accepts numeric prefixes such as `1W` as 1. `normalizeField`
turns the parsed values into concise input for the English-only `cronstrue`
descriptor, which does not validate schedules itself. Six- and seven-field
dialects are left alone rather than guessing whether a field is seconds or a
year. Named months and weekdays, lists, ranges, steps and standard aliases are
read; `@reboot` names startup rather than inventing a period.

Two readings need more than the library's default words. A step resets at the
field boundary, so `*/35` is minute 0 and 35 of each hour, not an interval of 35
minutes. Overlapping lists and Sunday aliases are deduplicated before a
description is written. Restricted day-of-month and day-of-week fields are OR in
standard cron, so their descriptions are explicitly joined with **or**. That
decision uses the original fields: Vixie cron records a leading star, not a star
anywhere in a list, and normalization must not erase that distinction. No
timezone is inferred from the reviewer's browser.

`diffCronSchedules.ts` uses the same `onPostRender` and `unsafeCSS` seam as the
whitespace marks. It reads only rendered rows and caches by node, text and path,
so highlighting, hydration and virtualized replacements get a fresh answer. The
hint is absolutely positioned generated content after the code: it changes
neither the source text selected for copying nor the virtualizer's line height.
A narrow pane clips the hint; the row's native tooltip holds the complete
expression, description and timezone caveat. Split and unified views use the
same path, including deleted lines.

**Effect code is read between its `yield*`s, and the read is an island parse.**
Behind `Effect.gen` nearly every line opens on `yield*`, and it means one thing
each time: take the value, or leave the generator on failure — Go's
`if err != nil { return err }`, which GoLand folds to `: err ↗`. So
`src/lib/lenses/effect/effectHints.ts` finds every `yield*` for the viewer to
quiet, and names the few expressions whose meaning the keyword hides: a failure
made on the spot (`fails · NotFound ↗`), a defect or an interruption, a bare
PascalCase operand read as a service (`needs · UserRepo`), and the handlers —
`catchTag`'s strings and `catchTags`' keys by name, and the catch-everything and
`orDie` family by kind. The arrow is claimed only behind a `yield*`: an
`Effect.fail(…)` inside a ternary in a callback is a value that fails later, not
an exit, and it is labelled without one. A member handed over uncalled —
`Effect.partition(values, Effect.fail)` — is labelled nothing.

A hunk is not a program, so there is no syntax tree: a real parser over a
fragment that opens halfway through a call is a tree of error nodes, and every
tolerant one would be a dependency for a readability hint. A tokenizer knows
comments, the three kinds of string and a regular expression, because those are
what would put a `yield*` where there is none, and the recognizers match their
shapes and skip everything else. Nothing needs the brackets to balance, so a
closer whose opener is off screen costs nothing and a call that runs past the
end of a hunk is read to the end of the hunk. A run is each hunk until the file
is hydrated and the whole file after it, keyed on `isPartial`, so expanding a
file improves the reading. A run that opens inside a JSDoc block is read as
comment only when its first line looks like one — a bare `*/` is also what
`"**/*.ts"` contains. The whole thing is gated on a script path that names
`Effect` in the lines the diff holds, because `yield*` is plain JavaScript and a
redux-saga file must not be told its `yield* Foo` is a service.

**A label stands in for the code it reads, and a press gives the code back.** A
reading whose expression sits on one line is an `EffectFold`: GoLand draws
`if err != nil { return err }` as `: err ↗`, and ghdiff draws
`yield* Effect.fail(new NotFound({ id }))` as one button reading
`fails · NotFound ↗`. The press shows the code on a faint ground, with a `−`
where the label was to fold it again, and the choice is kept per file by fold,
because a row is rebuilt every time it scrolls back into the window. The outer
fold wins, so `Effect.catchTag("E", (e) => Effect.die(e))` is one label and not
two. This is the one place the app hides text, against the rule the whitespace
dim follows, and three things make it a fold rather than a hide: one press opens
it, the tooltip quotes the code it stands for, and a fold over a changed word
wears the change's colour along its bottom edge.

A fold never crosses a line. The viewer lays a diff out one row per line, the
virtualizer counts them, and a split view holds the other side's rows level with
them — a row hidden in one column is a row the other column still draws. So
`return yield* Effect.fail(` with its argument on the next line keeps its label
after the code, where it was before folds existed.

`diffEffectHints.ts` is the one module that changes the library's own nodes, and
it is safe for three reasons, all of them read out of the library. Rows are
built from HTML strings and a column's rows are counted by its children, so the
change stays inside a row. A scroll pass keeps the rows still in the window with
the change on them, so a row already painted for its hint is left alone. And the
change adds no text: the text nodes are split at the fold's edges and wrapped,
which leaves shiki's spans where they are, and the button's label is generated
content — so every column counted from the start of the line, by the search, the
cron hint and the `yield*` ranges, is the column it was. The button stops its
own `pointerdown` and `click`, because the viewer's click handler reads no
target and would take the press for a press on the line. It is 16px in a 20px
row, since out of wrap mode no row is measured. The search opens a fold that
hides its current match, and only that one: opening every fold a query touched
would unfold the file for a search for `Effect`. Two costs remain: a copy across
a closed fold leaves its text out, and opening one in wrap mode changes a height
the virtualizer measured on the pass before.

The keyword is a CSS custom highlight on `--app-effect-yield-ink`, and the
trailing label is generated content after the code, a chip exactly the row's
height. Every label's `content` carries an empty alternative after a `/`, or a
screen reader reads it as code; the button's `aria-label` and the row's `title`
say the reading instead.

**It is a lens, and the first one that claims nothing.** `effect` sits in
`LENSES` beside the localization lens, so it is on or off per repository, under
the same **Lens** heading of the display menu, in the same browser store. It
takes no file out of the diff and draws no panel — the reading happens on the
rows the diff already draws — so its model is empty and its row in the menu has
no gear, which is what `onOpenSettings` being absent means. The switch is the
whole of its settings, and the lens starts on: it only ever touches a script
that names `Effect`. `ReviewViewer` takes it as `effectLens` and walks the
rendered files through a ref when it flips, the way a search query does, so the
options object — and every file — is not rebuilt for it, and turning it off
unwraps every fold it made. A row with a cron schedule as well shows both in one
chip and keeps the schedule's tooltip.

**Cmd+F is answered by the app, because the browser's find reads the DOM and
most of the diff is not in it.** The viewer renders the files under the viewport
and nothing else, so a browser find lands on a word on screen and misses the
same word two files down, with nothing to say it did. `useDiffSearch` takes the
shortcut over on the review screen — Cmd+F on a Mac and Ctrl+F everywhere else,
since Ctrl+F in a field on a Mac moves the caret — and `searchDiff` in
`src/lib/diffSearch.ts` walks the patch instead of the page: every line of every
hunk, in the order the viewer draws them, case-insensitive and literal like the
browser's own. A match is a place on screen and the count is the count of
places, which is why the walk is told the diff style: a context line is drawn
once in a unified view and twice in a split one, under the old number on the
left and the new on the right, so it is one match or two by the same rule — and
Enter takes a split row left to right before it goes down, where unified prints
a block's deletions before its additions. Counting it once while both copies lit
was the first bug: two highlights, a count of one, and an Enter that went
nowhere. What the walk does not read is the unmodified lines a reviewer has
expanded around a hunk. Those live in the viewer's rendered instance, which
nothing outside it can read, and github.com's find never renders them either.
`MAX_SEARCH_MATCHES` is where the walk stops, and the bar prints the cap with a
plus after it.

It searches the filtered items, because a match in a hidden file cannot be
scrolled to, and the unannotated ones, because the annotated array is rebuilt
for every comment and every fold and a search that re-ran for each would re-pick
its match on every press of a chevron. A change of query jumps to the nearest
match — the first in the file on screen, or in the first file after it — the way
the browser's find moves while you type. A change of diff under the same query,
which is a filter moving or a new patch arriving, keeps the match the reviewer
was on if it is still there and jumps nowhere.

The marks go through the same door as the whitespace dim and are painted
differently. `applySearchMarks` in `src/components/diffSearchMarks.ts` walks the
rows each pass rendered, the way `applyLineMarks` does, and again from
`ReviewViewer` over every rendered file when the query or the current match
changes — read through a ref, because closing over the marks in `options` would
hand the viewer a new options object and re-render every item. The marks
themselves are CSS custom highlights, `StaticRange`s registered under
`ghdiff-search` and `ghdiff-search-current`, and never a `<mark>`: a match can
start in one of shiki's spans and end in the next, and splitting the library's
nodes is splitting what its next pass rebuilds and its selection code reads.
Static, because a live `Range` is moved by the engine on every insertion under
it and a render pass is nothing but insertions, where a static one over a node
the pass threw away simply paints nothing. A scroll pass keeps the rows still in
the window and adds the ones that arrived, so each row remembers the marks it
was painted for and a pass paints only the rows that lack them; the rows a pass
trimmed give their ranges back on the next, or the registry grows by a window's
worth per scroll. A change of query or of current match is a new marks object,
which is what repaints every rendered file. `::highlight()` is styled inside the
shadow root through `unsafeCSS`, on the four `--app-search-*` tokens — yellow
and orange with their own ink, which is the one hue the chrome owns besides the
diff's, because that is what a find highlight has meant in every browser.
`forEachRenderedRow` in `diffLineMarks.ts` names the side a row is drawn on
once, for both kinds of mark: its own column in a split view, and in a unified
view the old side for a deleted line and the new for everything else. A search
mark is then `lines[side].get(line)` and nothing more, since the walk indexed a
context row under each column it is drawn in. A browser without custom
highlights — none that still receives updates — marks nothing, and the count and
the jump still work.

The bar is a strip above the diff and not a panel over it, for the reason the
sidebar's path search is a strip: a panel at the top right would sit on the
sticky header's **Viewed** toggle for as long as it was open. A jump is centred
where an anchor is aligned to the start — a match is a place to look at, not a
place to start reading from — and instant, so a run of Enter steps rather than
glides. It opens a folded file on the way and asks for the line again over the
next frames through `runOnFrames`, the loop the range anchor already needed,
because the fold comes off on the render after the press.

Three keys are left to whoever owns them. The shortcut stands aside while a
dialog is open: a modal makes the rest of the document inert, the bar's field
with it, and the browser's own find is the one that reads a dialog. The field
ignores the Enter and Escape an IME sends to commit or drop a composition, or a
Chinese query would step the old search instead of landing. And opening the bar
takes a phone's file list away, which sits over the very column the bar is in.

**A line comment is posted where it is written, or staged as the forge's own
draft.** The composer on a pull request keys off whether the target holds a
draft review yet: before one it carries two actions — **Comment**, solid, posts
at once, and **Add review suggestion**, outline, starts the draft with this
comment — and once one exists the single **Add review suggestion** joins it, the
way github.com's own composer works once a review is pending. The draft lives on
the forge, not in this browser — a thread on the viewer's pending review on
GitHub — so it survives a reload and shows on the forge's own UI as pending, and
a draft started there lists here. Staging is a forge write and asks for a
credential, because the draft is the user's own: with none, **Add review
suggestion** is disabled and a Tooltip says to sign in to stage a comment.
Deleting a draft is the same kind of write, and Delete is withheld while any
write is on the wire — the card offers it again once the write settles — so a
create that has not landed cannot outlive its own card and wait for the verdict
to publish it. A commit and a compare range have no verdict to publish a draft
with, so their composer keeps the one action — **Save comment**, with the hint
that the comment lives in this browser — and the thread stays in this browser
under `ghdiff-comments:<targetKey>`. A draft thread can never be misread as
posted: its card draws a dashed accent border (`border-dashed border-accent/60`)
and a **Draft** chip where a pending one's **Posting…** sits, the sidebar's rows
draw the same chip, and the thread draws no reply form — a draft takes no
replies. A reply staged on github.com under a posted thread is a draft too, but
it belongs to that thread: it joins the posted thread's card, carries the
**Draft** chip on its own message and on the card, and keeps the posted thread's
solid border, since the rest of the thread is published. It also has a Delete of
its own, the draft's question and the drafts endpoint behind it, so dropping it
never deletes the published messages around it. The header's **Review** button
counts what is waiting — **Review (3)**, or the count beside the verdict already
on record — and a staged reply stays in that count while its posted thread's own
write is in flight or has failed, since a failed resolve leaves the reply on the
forge for the verdict to publish. The submit dialog lists the draft threads
above the note, `path:line` and the body's first line each. The note rule
relaxes for them: `needs-note` fires only when the body is empty and nothing is
drafted. On the submit the verdict publishes them all:
`POST …/reviews/{id}/events` on GitHub.

**A thread resolves on its forge, and the press is on the card.** A forge thread
that carries a `threadId` — every resolvable thread, so never a draft and never
a browser-only comment — offers **Resolve thread** in the open card's header
row, beside Delete and Close, and a resolved thread's collapsed one-line card
offers **Unresolve** in the same slot. The press flips the mark optimistically:
the card collapses or reopens at once, the sidebar row re-sorts with it, and the
button holds until the forge answers. A refusal rolls the flip back and puts the
forge's own sentence on the thread — who may resolve is the forge's answer, not
this app's (GitHub: write access). A resolved thread stays collapsed to one line
in the diff until it is pressed, and sorts after the open threads in the
comments list.

**Copy JSONL hands the staged review to an agent.** A quiet button in the submit
dialog's footer copies it as line-per-object JSON — `reviewToJsonl` in
`src/lib/reviewExport.ts` — in the grammar of
[hunk](https://github.com/modem-dev/hunk)'s `agent-context.json`: the review
first, then one object per comment, a comment's side stated as the range it
names — `newRange` on the additions side, `oldRange` on the deletions one — and
the body the markdown as written. No patch is embedded; the agent opens the
files itself. The button is disabled when there is nothing staged and no note,
because there would be nothing to copy.

```jsonl
{"type":"review","target":"github.com:owner/repo#123","url":"https://github.com/owner/repo/pull/123","title":"…","summary":"the note, when there is one"}
{"type":"comment","path":"src/lib/a.ts","newRange":[42,45],"author":"galvin","body":"…"}
{"type":"comment","path":"src/lib/b.ts","oldRange":[10,10],"author":"galvin","body":"…"}
```

**The wait says how much has arrived, and never how much is left.**
oven-sh/bun#30412 is 43.3 MB in 1,654 chunks over four seconds, so
`useReviewPatch` reads the body through `readStreamedText` and
`ReviewStatusPanel` prints the count. A count and not a percentage, because
there is no total to divide by: github.com's `.diff` answers chunked and states
no `content-length`, and where GitHub does state one it counts compressed bytes
while the stream yields decoded ones. What reaches React is decided by the
label, not the chunk: `formatBytes` is compared before the count is written,
which turned those 1,654 reports into about 450 renders of a four-line panel.
The figure is `tabular-nums`, and it is shown only while `state` is
`'fetching'`: the parse and the highlighters are not measured in bytes.

`readStreamedText` in `src/lib/streamText.ts` is the one decode loop, and both
things this app fetches use it — the patch with no ceiling, and a whole file
with `MAX_FILE_BYTES`. `TextDecoder` is fed `{ stream: true }`, or a character
split across two chunks decodes as two replacement characters. The parse is the
other wait and it is not measured yet: `buildReviewData` runs `parsePatchFiles`
over the whole patch in one synchronous call, so the tab is frozen for its
duration and no message can update.

**A review is a snapshot of the diff at load; the header's refresh takes a new
one.** Nothing polls, and no HTTP layer caches the patch, so a branch that moved
under an open review stays invisible until the reviewer asks. The press re-runs
the whole no-store read and asks for the pull request's details with it, and the
bar draws the button in every patch state, so an errored diff retries from there
too. What comes back is keyed off the entries the new patch names: the comments
and the read marks re-list on their own, and the fragment is applied again, so
the scroll holds.

**The tab belongs to the review on screen.** `useDocumentTitle` names it after
the change — `Fix the bug · github.com/owner/repo #123 · ghdiff`, the host
always in the path — which `reviewTabTitle` in `src/lib/reviewTarget.ts` builds,
falling back to the bare place while the pull request's details are still
arriving. `useReviewFavicon` clips the runner emoji and paints two octicon marks
on the ground that frees, from `reviewFaviconDataUri` in
`src/lib/reviewFavicon.ts`. The top mark is the kind of diff, always in the
accent — with a fourth state, the draft-PR octicon, where the state is the
glyph's shape and its colour never changes. The bottom mark is the head commit's
checks in the watch list's colours: green check, red cross, and a solid amber
dot while they run — github.com's own favicon vocabulary on a pull request, a
bare check, a bare cross, and a solid yellow dot — and the mark keeps those
colours on a draft too. The clip is only as wide as what sits on it: the whole
right half while two marks stand there, just the top quarter when the type mark
stands alone, so a commit and a compare keep three quarters of the runner. Each
glyph carries a thin halo in the accent ink under its fill — a bare near-white
mark vanishes on a light tab strip and a bare near-black one on a dark — and the
dot is the one mark that goes without. That check axis rides `pulls.get` as
`PullDetails.check` — GraphQL, because REST carries no rollup — and keeps the
watch list's contract: no token, no mark, and a failed read costs the mark
rather than the details. `'none'` paints no mark either: the branch has no
checks, and the marks only speak when there is something to say. Both hooks
write onto the document and restore what they found on unmount, so every other
page keeps the app's own title and favicon; the favicon's hexes are read off the
CSS tokens at paint time, and a watch on the scheme attribute repaints it
however the flip arrives — the toggle, the platform, or another tab.

**A phone gets one layout, and 480px is where it starts.** `--breakpoint-phone`
in `src/globals.css` is 30rem, and `useIsPhone` states the same figure for the
answers CSS cannot give. 480 sits above the widest phone held upright — an
iPhone 17 Pro Max reports 440 — and well under the 640 Tailwind calls `sm`.
Nothing below that line is a second design: each of the app's two columns
becomes a button, and the diff takes the width they were using.

`PullRail`'s own element is `max-phone:hidden` and `PullListButton` stands in
for it, from the leftmost control on the screen. Hidden and not unmounted, so
the width, the collapse and the scroll the bar was left at survive the window
widening again. The button asks `useAppData()` itself rather than being handed
the list, so the two cannot disagree about what is open; it reads the current
review off `useCurrentReviewTarget` and labels its glyph with the neutral
`pullNoun()` from `src/lib/forges.ts`. Both the review header and the home page
draw it: the home page has no header of its own, so it sits in the top corner
opposite the colour toggle.

The file list is over the diff on a phone rather than beside it —
`absolute inset-0` and `hidden` when closed, never unmounted, so the tab, the
filter and the scroll are all still there next time. It opens from the second
button in the header and closes on the file that is picked, because the list is
covering the thing that file was chosen to show. The viewer underneath keeps its
own box throughout, which is what keeps the diff from being measured again on
every toggle.

Two columns of code on a phone is about twenty characters each, so
`defaultViewerControls` in `src/lib/viewerControls.ts` starts one unified. It is
a default and nothing else: the control in the header writes the whole set to
storage, and from that press the screen is not consulted again. `null` is what
says nobody has pressed anything, which is why `acceptViewerControls` refuses an
object with none of the five fields in it rather than reading it as the default
set: those two answers differ on a phone.

**A portrait screen stacks the review: the file list is a band above the diff,
and the bar is a button.** The trigger is `orientation: portrait` stacked on the
`phone` variant — every rule is written `phone:portrait:` — so it is a media
query and no figure is stated anywhere: a portrait monitor and an upright tablet
match, a phone is already below the width the `phone` variant starts from, and a
landscape screen is untouched. The left bar takes the phone's answer —
`portrait:hidden`, with `PullListButton` standing in from the leftmost control,
its `phone:hidden` become `phone:landscape:hidden` — because the stacked review
takes the screen's whole width. The review grid's tracks are classes, not an
inline style: one column as the base, then `phone:landscape:` names the
sidebar's width property in a column and `phone:portrait:` the height property
in a row. The two are mutually exclusive media queries, so which template
applies never turns on the stylesheet's ordering. Classes rather than the
JavaScript ternary they replaced, because a class is drawn at the first paint: a
portrait monitor is the machine's own shape, and a template that arrived with
hydration would rearrange the screen under the reviewer on every load.

Both resize hooks stay mounted, and the stylesheet picks the seam.
`useSidebarHeight` is `usePaneWidth` on its `axis: 'y'` — the drag reads
`clientY`, the room reads `clientHeight`, the cursor is `row-resize` and the
arrows are Up and Down — behind its own `--ghdiff-sidebar-height` property and
its own stored choice (`ghdiff-sidebar-height`), so turning the monitor back
gives the desktop sidebar its width untouched. Both handles are rendered and the
visibility classes decide: `portrait:hidden` on the width seam,
`landscape:hidden` on the height one, `max-phone:hidden` on both. The band is
the sidebar's own `flex-col` in a shorter row, header and footer and all, with
its border moved from the side to the bottom; its figures are 144 minimum, 288
by default, 560 at most, and `VIEWER_MIN_HEIGHT` — 320 — is what the diff keeps.
The file-list toggle stays phone-only, because the tree is always on screen in
the band, and the viewer's default controls stay width-driven: two columns of
code read fine at a portrait monitor's full width.

**The pull request list on a phone is a sheet, not a card.** `Dialog` takes
`presentation="sheet"`, and `PullListButton` is the one caller that asks for it:
the window rises from the bottom edge, as wide as the screen, with a grabber and
a centred title, and the app behind it steps back — `[data-sheet-host]` on
`AppShell` scales to 94% and rounds its corners on a black document. The sheet
is in the top layer, so that transform never reaches it although the sheet sits
inside the host in the document. `useSheetDrag` lets it go on a swipe down:
pointer events on the title bar, which is `touch-action: none`, and touch events
on a list already at its top, because a scroll region ends the pointer stream in
`pointercancel` the moment a finger moves. The drag writes onto the nodes and
`--sheet-drag` onto the document element, so the backdrop and the page come
forward with the finger and React is told nothing until the release. A question
with two answers stays a card on every screen.

**The header scrolls sideways, and only a measurement may say so.** More
controls than 402px holds, so on a phone that row is `overflow-x-auto` and the
fade at an end says there is more that way. `useEdgeFade` writes
`data-fade-start` and `data-fade-end` and the stylesheet draws from them,
because whether a row overflows is a measurement and no CSS takes it: a scroll
timeline reports progress along a range and cannot say whether the range exists,
so at rest it draws one fade for "more to the right" and for "nothing to scroll"
alike — and the second is a claim about content that is not there. That is not
hypothetical: a commit target with a token signed in fits inside 402 and would
have carried a permanent fade. The hook writes onto the node and tells React
nothing, the way `usePaneWidth` does, so a gesture reported many times a second
costs no render. The pull request title takes `max-phone:min-w-44` for the same
row: it is the way in to what the pull request is for, and a control squeezed to
nothing is one nobody can read or aim at. The floor is 176px because the row
scrolls anyway — once it overflows, every pixel the title gives up is title lost
for no control gained.

**A menu opens on a tap, not on a touch.** Radix opens a `DropdownMenu` on
`pointerdown`, which is right for a mouse and wrong for a finger: a touch that
lands on a trigger starts a scroll as often as a tap, and the header above
scrolls sideways on a phone, so every swipe that began on the title opened its
card. `DropdownMenuTrigger` in `src/components/ui/DropdownMenu.tsx` calls
`preventDefault()` on a touch or pen `pointerdown` — Radix's own handler runs
only when the event is not default-prevented — and opens on `click`, which the
browser never sends for a touch that turned into a scroll. That needs the open
state, which Radix keeps out of reach, so `DropdownMenu` holds it and hands
Radix the controlled pair; a caller's own `open` still wins. A mouse and the
keyboard are unchanged.

**A field is 16px under a finger, or Safari zooms onto it.** Safari on iOS zooms
the page onto any field whose text is under 16px the moment the field takes
focus, and the page stays zoomed after. The line comment composer focuses itself
as it opens, so every comment zoomed the diff. One rule in `src/globals.css`
sets every text field to 16px under `(pointer: coarse)`, and it is unlayered on
purpose: Tailwind's utilities sit in a cascade layer, and an unlayered rule
outranks every layered one, so no `text-sm` on a field can undo it. A coarse
pointer and not a phone width, because an iPad zooms the same way at any width.
Do not answer this per field again — that is how the review popover had the fix
and the composer did not.

**The filter drives both panes.** `applyReviewFilter` returns the items for the
viewer and the paths for the tree from one pass. Never filter one without the
other.

**The path search is the filter's query, not the tree's search.**
`@pierre/trees` has a search box of its own, and it is off (`search: false`): it
narrowed the tree while the diff kept every file. `PathSearchField` in
`ReviewSidebar` writes `filter.query` instead, which `applyReviewFilter` tests
along with the preset and the statuses. Closing the field clears the query, so
no hidden control can hide files.

**Presets are pure predicates over a path.** Add a rule to `FILTER_PRESETS` in
`src/lib/filterRules.ts` and add its cases to `src/lib/filterRules.test.ts`. Do
not put path parsing in a component.

**The presets are kinds, and a reviewer reads all of them or picks some.** **All
files** is one answer; the six kinds — Source, Tests, Config, Docs, Generated
and Other — are the other, and the kinds picked add up. There is no "hide" rule.
"Hide tests" was one in the first version and it read wrongly beside the others,
because a picker that both adds and takes away has two grammars. `isOtherPath`
is what makes the kinds cover every path, so "all but the tests" is five boxes
ticked. Every kind ticked is the same as all of them, and `togglePreset` answers
it as **All files**. `matchesPresets` and `togglePreset` hold the whole rule.

The presets, the statuses and the untracked switch are kept per
`reviewTargetKey` in `ghdiff-review-filters`, so a pull request opens with the
filter it was left with. The path query is not kept: its field opens empty, and
a query nobody can see must not hide files. A stored status the diff no longer
contains is dropped on read, for the same reason — the branch moves between
visits, and the menu offers a status only when the diff has two. A filter that
hides nothing removes its row, and the store keeps the 500 newest writes.

**A mark folds the file, and the fold is its own state.** That is what the mark
is for: a diff read from the top gets shorter as the reviewer goes down it, and
a review reopened tomorrow shows the files nobody has read yet. So the mark
folds, taking the mark back opens, and the marks the store reported on load fold
on arrival. But the two are not one value. A file read and then opened again
from its chevron is still read, and a file folded from the chevron alone was
never marked — so `ReviewScreen` holds `collapsedItemIds` beside the marks
rather than reading one off the other.

`CollapseFileButton` is the chevron, and `renderHeaderPrefix` is the only slot
drawn to the left of the change-type icon, which is where github.com puts the
same control. Its word comes from the browser's own `title` and not from
`Tooltip`: the library lays each file out in a container it contains, and
containment makes a stacking context, so a label drawn below that button is
painted over by the next file whatever its z-index. A folded file is one header
tall, and everything under it belongs to the file after it — which is exactly
when this control is pressed. `ExpandFileButton` beside the name is not drawn on
a folded file at all: there is nothing to reveal into.

**That chevron is the hunk separator's expand column, continued up into the
header.** A file with collapsed context draws the separator's own expand button
one row below, in the same glyph, for the same kind of press, so the two are
read as one column and have to be one column. The chevron therefore takes 32px
around a 16px glyph and not the 28 around 13 every other icon button in this app
takes, and `HEADER_PREFIX_PULL` gives back the 8px by which the header's 16px
padding overshoots the separator's own inline inset. Both figures are the
library's defaults, and neither is a custom property this app can read, so a
change to either has to be answered in `ReviewViewer`. `HEADER_METADATA_PULL` is
the same idea at the other end of the row: a quiet button's horizontal padding
is its hover box and not its text, so `Viewed` stopped short of the line the
header's own padding draws — the button gives both back, and its hover box is
then the only thing that reaches past either.

**A jump opens the file it lands on, and one file is spared the fold.** A scroll
to a folded file lands on a header and shows nothing, so the tree, the comment
list and the URL fragment all go through `openFile`. That call also names the
file in `openedByJumpRef`, and the fold seed leaves that one open: the address
is applied the moment the diff is on screen, while the marks are a request that
answers a moment later, so without it a link to a line in a file already read
would fold itself shut under the reviewer.

`CodeView` keys an item update off `id` and `version`, and this screen now
writes two things onto an item — its comments and its fold. So the version is
`comments.revision * 2 + (collapsed ? 1 : 0)`: doubling the revision leaves the
low bit for the fold, and neither input can hide a change in the other. Only the
items that carry something are rebuilt. The viewer relays out from the first
item whose version moved, so rebuilding all of them would relay out the whole
diff on every press. Bump the version whenever annotations change.

**`CommentMetadata` is one interface, not a union.** `DiffLineAnnotation<T>`
resolves its metadata through a conditional type, so a union `T` distributes
into a union of annotation shapes the viewer rejects. `kind` discriminates
instead.

**Client hooks depend on strings, not on the target object.** The target comes
from the `/$` loader, so its identity changes on every re-run of that loader.
`useReviewComments` derives its storage keys, `targetKey`, and `pullRef` and
depends on those.

**Highlighting runs in workers.** `WorkerPoolProvider` wraps the whole app, and
the viewer waits for `useWorkerPoolReady`. Shiki on the main thread was the
whole cause of scroll stutter: on one large diff it gave a p99 frame of 135 ms
with 9% of frames dropped, and the pool took that to a p99 of 17 ms with none
dropped. Do not mount a `CodeView` outside the provider. Two settings keep that
worker alive under Vite. The `Worker` constructor names `{ type: 'module' }`,
because Vite otherwise builds a classic worker that rejects the entry's first
`import`. And `vite.config.ts` sets `worker.format: 'es'`, because Vite's
default `iife` flattens every grammar into the entry: 834 kB up front instead of
211 kB plus one chunk per language.

**A comment card never changes height.** `@pierre/diffs` watches each annotation
with a `ResizeObserver` and relays out the virtualized list when one resizes, so
`src/lib/commentHeight.ts` picks a height from the text before the first paint
and the card keeps it. Reading a long comment happens in `CommentExpansion`, a
portaled fixed-position layer that grows from the card's own rectangle, so the
card in the diff is untouched. A clipped body is `overflow: hidden`, which also
makes a late-loading image harmless. Never let a card grow in place. A reply is
the one thing that re-measures a card, because it adds a message to the thread
the height was taken from — one relayout for one deliberate act, the same
relayout posting the first comment on a line already costs.

**A comment says who wrote it with a picture, and the picture fits the row it
lands in.** `src/components/AuthorAvatar.tsx` is that one square: round for a
person, `rounded-sm` for an app, whose logo is drawn to fill a square and loses
its corners to a circle. Its box is a `size` in pixels on the style attribute
rather than a class, so a picture that arrives late or never arrives at all
cannot resize what holds it. The card in the diff takes **16px**, which fits
inside the 20px line box the login already draws, so a card that has picked its
height keeps it; the open thread takes 20px, and the sidebar's list takes 20px
against a row already fixed at `ROW_HEIGHT`. The login sits beside every one of
them, so the picture is `aria-hidden`. The panel's own heading carries none, and
neither does the composer: that heading says `4 comments` above four different
authors, so one picture there would name only the first of them. A comment the
reviewer has just written is shown before the forge answers, so
`useReviewComments` takes `viewerAvatarUrl` alongside `viewerLogin` and puts it
on that optimistic message — without it the message draws its initial and then
swaps to the picture a moment later, on the one comment the reviewer is watching
most closely.

**That layer is measured in the box it is about to have.** How tall a comment is
is a question about the column it is read in, and the panel opens two or three
times wider than the card. So `CommentExpansion` writes the target width and the
largest allowed height onto the panel, reads the height of the box that holds
the comments, and puts the panel back — all inside one layout effect, so the
browser paints none of it and the panel still travels from the card's rectangle.
Three things in that sequence are load-bearing. The panel's own transition is
turned off around it, or the box read back is the box it started from and the
answer is the card's tall wrap. The height goes on with the width, or the scroll
region carries a scrollbar it is about to lose and every paragraph wraps eight
pixels early. And what is measured is the padded box inside the scroll region,
never the region: the region is `h-full` of a panel still the height of the
card, so its `scrollHeight` can never report less than the card.

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

**A private GitHub attachment loads from the address GitHub signed, not the one
the body wrote.** `github.com/user-attachments/assets/<uuid>` answers only
github.com's own cookie, which a cross-site `<img>` never carries, so a private
description drew a broken picture. `pulls.get` asks for the `full` media type,
and `readSignedAttachments` in `src/lib/attachments.ts` reads `body_html` for
its `<img>` and `<video>` addresses — signed on
`private-user-images.githubusercontent.com`, keyed by the uuid both sides share.
The markdown is still what renders; `CommentBody` swaps a `src`, and turns a
bare attachment link into the `<video>` GitHub draws there. That player needs no
room in the schema: its `src` is GitHub's signed address, never text from the
body. A signature lasts five minutes and the card mounts only when opened, so a
signed file that fails once its signature is old asks `usePullDetails` to fetch
again; a young one never does, which is what keeps a real 404 from looping. The
age is measured from the answer's arrival against the token's own `exp - nbf`,
so no two clocks are compared. A body with no signed address falls back to the
media proxy below.

Review comments take the same path with one difference. `comments.list` asks for
the same media type and each `CommentPayload` carries its own `attachments`, but
`useReviewComments` merges them into one map held **beside** the annotations and
never inside them, and `AttachmentsProvider` hands it to every thread card
through the viewer's portals. A renewal asks for the list again and replaces
that map alone: putting fresh addresses into the annotations would bump every
commented item's version, and the viewer would relayout the diff under a
reviewer who only scrolled a picture into view. The map is never written to
browser storage, because every address in it is dead within minutes.

**An image the forge keeps behind its own sign-in goes through the media
proxy.** GitHub's form of it is the `/owner/repo/assets/…` attachment and the
raw host's file on a private repository, both of which demand github.com's own
session — and the reviewer's grant is sealed on the server. So `BodyImage`
passes every `src` it has no signed address for through `mediaSrc` in
`src/lib/mediaUrl.ts`, which points an assets or raw address at `/api/media` and
leaves everything else — a foreign host, a data URL, `user-images` and avatars,
which are public already — alone. The target comes from
`useCurrentReviewTarget()`, read off the path the way every other reader gets
it, so the diff card, the expansion overlay, the sidebar list and the
description all inherit the rewrite with no prop threading, and the hook living
in the image component keeps the memoized body parse out of it. What the proxy
does with the address — the host check, the redirect rule, the `image/*` gate —
is written up with the route in `docs/rules/auth-and-forges.md`.

**A task list's box is drawn, not a real checkbox.** A `- [x]` reaches
`CommentBody` as `<input type="checkbox" checked disabled>`, and a native
control is the wrong answer to it twice over: the browser paints one in the
platform's own blue, which is the single colour this app never uses, and it
offers a press that can change nothing — the body belongs to the forge, and
ghdiff posts no edit of it. `disabled` settles the press alone and leaves the
paint, so `TaskMarker` draws the box instead, in the tones the rest of a body
already uses. It hangs in the bullet's own lane: the box is 1em wide with 0.4em
after it and -1.4em before it, so its advance is zero and the item's first line
and every wrapped line start on the list's own content edge. That pull is stated
on the `li` and not on the box, because a checkbox written as raw HTML outside a
list has no bullet lane to hang in, and the `li` drops its marker in the same
breath so an item carries one box and not a bullet as well. The box has no
`<title>`: one tooltip per box would follow the pointer down a whole checklist,
and `role="img"` with `aria-label` names the state and draws nothing.

**The address names the file and the lines.** `src/lib/diffAnchor.ts` owns the
fragment and `src/hooks/useDiffAnchor.ts` owns the two directions. The grammar
follows github.com's: a file part, then an optional line part of one or two
points, each a side letter and a line number, `R` for the new file and `L` for
the old one.

```
#diff-src/lib/reviewFilter.ts           the file, scrolled to its own top
#diff-src/lib/reviewFilter.ts:R42       one line of the new file
#diff-src/lib/reviewFilter.ts:R42-R58   a range down the new file
#diff-src/lib/reviewFilter.ts:L18-R24   a range across the two sides
#diff-<64 hex digits>R42-R58            github.com's own form, read only
```

The file part differs. GitHub writes the SHA-256 of the path, which a reader
cannot read and nobody can type; ghdiff writes the item id, which is the path,
and separates the line part with a `:`. Because a path can end in something that
reads as a line part, and can hold a `:`, `lookupDiffAnchor` tries each reading
against the files of the diff on screen rather than trusting the text. A
github.com anchor is tried last and resolved by digesting every path, so a link
pasted from a pull request works and is then rewritten in place into the
readable form.

ghdiff writes the fragment when the reviewer opens a file, which keeps a history
entry, and when the selection moves, which replaces one: a drag reports every
line it crosses. Scrolling writes nothing, the way github.com writes nothing. A
fragment typed into the address bar raises `hashchange` and nothing else, and
TanStack Router listens for `popstate` alone, so `useDiffAnchor` forwards that
event to the router itself.

**A fragment belongs to the page it was written on.** No `Link` in the app
states a fragment, so the router empties the address the moment a reviewer
leaves a review — and the viewer is taken down after that, reporting its
selection away as it goes. `syncSelection` answers a selection of nothing with
the last file's own fragment, so that write used to land on the page the
reviewer had just arrived at. So `useDiffAnchor` drops the file it is holding
the moment the fragment goes empty: an empty fragment names no file, and a file
it does not hold is one it cannot write back.

**A range anchor takes more than one frame.** `CodeView.scrollTo` resolves a
range through `getLinePosition`, which answers only for a file the viewer has
already rendered, and it drops a target it cannot resolve without a word. The
file an anchor names is almost always far off screen when the anchor arrives, so
`ReviewScreen` scrolls to the item first — its top is in the layout, so that one
always lands — and then asks for the range again on the next few frames, which
is what catches it once the scroll has rendered the file. The range is aligned
to `start`, not `center`: the viewer puts it directly under its own sticky
header, so the file at the top of the screen is the file the fragment names, and
the tree, which reads the top, marks the same one.

**A jump names its own file.** A scroll the viewer was told to make raises no
scroll report, so `useActiveDiffItem` cannot see it. Every jump — a row in the
tree, a thread in the comment list, a fragment in the URL — calls `select` as
well, or the file list goes on marking whichever file the reviewer last scrolled
past.

**And it keeps that name until the diff gets there.** A smooth jump does raise
reports, one per frame, for every file it crosses. Each is a true answer to what
is under the anchor and a wrong answer to what the reviewer is reading. So
`select` holds the mark on the file it named, and `useActiveDiffItem` throws
away every measurement until one of three things ends the hold: the diff
arrives, the reviewer takes the scroll back with a gesture of their own, or the
reports stop for `JUMP_SETTLE_MS` — 200 ms. The four events the gesture watches
are `CodeView`'s own list — a smooth scroll there is the viewer's spring, not
the browser's, and `wheel`, `touchstart`, `pointerdown` and `keydown` are what
it abandons the spring on. The two lists have to stay the same list, or the mark
is left behind by a scroll that ended without the hold, or the crossed files
come back on a hold that ended without the scroll. The settle is the backstop
for the jump that never arrives: a scroll region that has bottomed out cannot
bring the last file's top up to the anchor, and the file the reviewer asked for
is still the right answer there.

**One row in the tree, not a trail.** `FileTreeItemHandle.select()` **adds** to
the selection, and the diff's scroll selects a row on every file it passes. So
`ReviewFileTree` deselects `getSelectedPaths()` before it selects the new row.
Without that the tree fills with every file already read, and
`onSelectionChange` stops answering a click, because it only acts on a selection
of one.

**A file whose name is its type needs `lang`.** `getFiletypeFromFileName` reads
the text after the last dot of the whole path, so `docker/Dockerfile` and
`.env.local` both resolve to plain text. `src/lib/diffLanguage.ts` answers for
those two families and `buildReviewData` sets the answer on the item as `lang`,
which the renderer prefers over its own guess. Add a family there, with its
cases in `src/lib/diffLanguage.test.ts`.

**A path is unquoted before anything reads it.** Git quotes a header path that
holds a `"`, a `\`, a control byte or — under the default `core.quotePath`,
which github.com's `.diff` host runs with — any byte above 0x7f, and writes each
as a C escape. `@pierre/diffs` strips the quotes and keeps the escapes, so
`docs/プライバシー.md` reached the tree, the header, the fragment and
`/api/file` as `docs/\343\203\227…`. `buildReviewData` puts every name through
`unquoteGitPath` in `src/lib/gitPath.ts`, once and only for a git patch: a path
git left bare holds no backslash, so a backslash there is always an escape.
`synthesizePatch` writes its headers through `quoteGitPath` for the same reason,
since a forge's file name with a backslash in it written bare would read back as
an escape.

**A pane drag renders nothing.** `src/hooks/usePaneWidth.ts` writes every
pointermove straight onto one custom property of the element that carries it,
and tells React once, on pointerup. The layout and the handle's own placement
both read that property, so the pane and the seam travel together while the
`CodeView` beside them is neither re-rendered nor re-measured. The drag's active
look comes from a `data-resizing` attribute on the handle for the same reason.
Two widths are kept apart on purpose: the width the reviewer chose, which goes
to browser storage, and the width on screen, which a window too narrow for both
panes squeezes. Widening the window gives the choice back, and a browser tab
reporting a viewport of zero — which happens while a page loads and while a tab
is hidden — is ignored rather than treated as a layout to shrink into.

**Three panes drag, and `room` is the whole of what separates them.**
`useSidebarWidth` is `room: 'self'`: the review sidebar is a grid column inside
the element that carries `--ghdiff-sidebar-width`, so that element is both what
the drag writes to and what says how much room there is. `useSidebarHeight` is
`room: 'self'` on the same element, reading its height for the band a portrait
screen makes of the sidebar. `useRailWidth` is `room: 'parent'`: the left bar
**is** the element the drag resizes, so its room is its parent's width —
measuring itself would chase its own tail, and the ResizeObserver would answer
its own drag. What each pane leaves behind is `reserve`: the diff's minimum for
the sidebar, and the sidebar's minimum plus the diff's for the bar, so a bar
dragged to its widest still leaves a review screen that fits. The collapsed bar
has no handle: it is the width of one square, and a square is not a thing to
resize.

**A file's diff stats belong to the tree's decoration lane.** `@pierre/trees`
draws `renderRowDecoration` after the name and before the git badge, so the
numbers land in a lane whose right edge does not move with the row's
indentation. `src/lib/treeStats.ts` sums each directory from its descendants and
reports the widest number in the diff; `ReviewFileTree` turns that into two
fixed column widths, so the additions of every row end on one pixel and the
deletions on another. The lane is `flex: 1 0 auto`: it grows into the space a
short name leaves and never shrinks, so a long name truncates and the figures
stay whole. **A directory row is keyed with a trailing slash**, because that is
how the tree names its own rows.

**Every row keeps the git badge's lane, badge or no badge.** The lane is the
library's, it is the last thing on a row, and `display: none` gave a directory
row its 12px and its flex gap back — so a directory's figures ended 17px right
of every file's. The stylesheet hides the folder dot inside the lane instead.
The lane also holds the regular font weight: a column measured in `ch` is the
width of a zero, and a directory row's heavier zero is a pixel wider.

**Whether that lane exists at all is the diff's answer, not ours.**
`@pierre/trees` resolves an empty git status list to nothing and leaves the lane
off every row, and `gitStatusEntries` skips `modified` — so a diff whose every
file is modified has no lane, and a diff with one added file has it on all of
them. `treeStatLaneInset(gitLaneActive)` is why the footer follows: it is the
scroll region's stable scrollbar gutter, the row's margin and padding, and then
the lane and its gap only when the lane is there. The two library defaults in
that sum are pinned as overrides in the same file, so a default that moved could
not take the footer out of the tree's columns without touching the number beside
it. A footer padded for a lane that no row has sits 17px inside the figures it
totals, which is the same error as the directory row, from the other side.

**A thread's opening author decides whether the sidebar lists it.** A review bot
writes most of the comments on a busy repository, so `src/lib/commentAuthors.ts`
splits them into People and Bots and the strip at the foot of the panel holds
one kind at a time. GitHub types an App's account as `Bot` and the comments
payload forwards that; `isBotLogin` is the fallback for a comment kept in
browser storage, which keeps the login and nothing else. A bot answering a
person leaves the thread under People.

**A path in the comment list is trimmed from its start.** The end of a path
identifies the file, and a column of `src/components/CommentThre…` against
`src/components/CommentsLi…` says nothing. `dir="rtl"` moves the ellipsis to the
other end while the letters stay left to right, and a leading U+200E keeps a
path that opens on a dot or a slash from being reordered around it. The pointer
on the row then reveals the rest of the path on the row's own line: the path is
anchored to the right edge of its box, so a box that grows to the right carries
every character already on screen right with it while the missing directories
arrive at the clip. The layer starts at the heading's own rectangle and grows by
exactly what the heading clips, which is what makes it read as the row
stretching rather than a second copy of it arriving, and it crosses the
sidebar's border and sits over the diff for the width it needs. That reach costs
a fixed layer in a portal: the list scrolls in a region that hides horizontal
overflow, and that region clips an absolute child of the heading just as hard.

**The footer strip belongs to the tab that is open.** The files tab has a size
to report and the comments tab has a filter to set, and neither has anything to
say about the other. The size it reports is `applyReviewFilter`'s own `stats`,
not the patch's: a footer that counted the whole patch while the tree listed a
third of it made the two panes disagree. Its two figures are the last row of the
tree's own columns, so it takes `treeStatLaneInset`, the tree's 5px gap, and the
tree's column widths as a **minimum** — a patch with two top-level directories
has a total wider than either of them, and a fixed width would spill. The right
padding belongs to each tab rather than the strip, because the filter bar runs
to the edge and the totals stop where the tree's figures stop.

**A strip states its height.** The review sidebar's foot and the left bar's
toolbar row both state `h-9` and neither takes its height from what is inside
it. A strip padded around its button measured 36px and the border took it to 37,
against the 36 an `h-9` strip counts its border inside. The two headers hold the
line across the seam between the panes the same way: `h-11` on each, stated
twice.
