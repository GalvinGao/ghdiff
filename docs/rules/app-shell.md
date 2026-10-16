# The app shell

The app's frame: routing and the userscript, the left bar, the watch list and
its offer, the home page, the pull list and its status squares, and the setup
page.

**The left bar belongs to the app, not to a screen.** `src/routes/__root.tsx`
mounts `AppShell`, which is the bar plus whatever page is open. Moving between
pull requests never unmounts it, so the list is fetched once per session. The
bar reads the pull request on screen out of `useLocation()` rather than being
told, which is what lets it sit above the home page, a review, and a 404 alike.

**A review URL is github.com's own path, at the root.** `src/routes/$.tsx` is a
splat over the whole path, so `ghdiff.com/owner/repo/pull/123` is the github.com
URL with the host swapped and nothing else. Every static route — `/` and each
`/api/...` handler — outranks the splat, so adding a static route is safe and
adding a top-level _page_ route is what would shadow a repository owner of that
name. `/setup` is the one static **page** route besides `/`, and it is the case
that rule is there to catch. `github.com/setup` is a real account — but ghdiff
has no route for a user profile and never did, so
`gitHubTargetFromSegments(['setup'])` answers with nothing and `/setup` was
already a 404. It claims a dead address rather than shadowing one a reviewer
could reach. Check that before adding another: a name GitHub serves a _diff_
under is a name this app cannot take.

`src/routes/gh/$.tsx` is the old prefix and holds no component: its loader
throws a `redirect`, which keeps every link already written alive. `PullRail`
reads through a leading `gh` segment for the one navigation the redirect takes.

**The userscript makes that host swap a button, and the tab bar is where it
goes.** `public/ghdiff.user.js` adds one link to github.com, beside **Files
changed** at the end of the pull request's own tab row. That row is the one part
of the page that both of GitHub's headers still draw and that the conversation
and the diff share, so a single insertion point covers all four combinations:
`nav[aria-label="Pull request navigation"]` is the React header and
`.tabnav-tabs` is the one it has not replaced yet. Neither selector is a
contract, so `findRowByLinkTo` says what the row _is_ — the row that holds the
link to this pull request's own `/files` page — and finds it again when the
names change. The title-row actions were the other candidate and lost: GitHub
puts the review state, **Code** and **Preview** there, and it needs a second
selector for the same button.

**A commit is the other page that is one diff, and its button goes beside Browse
files.** A commit header has no tab row, so `findHost` sends a commit to the
same `findRowByLinkTo` with a different question: the row that holds the link to
this commit's own `/tree/<sha>` page. That row holds nothing but **Browse
files** — twice, in fact, a wide one with the words and a narrow icon, one of
which is always hidden — so the search takes whichever is on screen and they
share the one row either way. No selector is named for a commit at all, because
every class on that header is hashed per build.

The button wears two skins, and both were read off the live page rather than
guessed. In the tab row it is another one of github.com's own tabs — the same
`TabNavLink` the row draws for **Files changed**: transparent and borderless in
its unselected shape, `8px 12px` of padding at `--text-body-size-medium` and
weight 400, stretched to the row's height, with a leading `link-external`
octicon in `--fgColor-muted` the way every tab in the row carries one, gone
under github.com's `sm` breakpoint the way theirs are. Beside **Browse files**
on a commit it is Primer React's own default `Button`, the component github.com
draws next to it there — `prc-Button-ButtonBase`, a medium control at
`--control-medium-size` and weight 500, the 80 ms colour transition, the hover
and active backgrounds, and the focus ring. The custom properties are Primer's
design tokens, set by github.com itself on the document element for both colour
schemes, so the button follows the reviewer's scheme without a stylesheet of its
own to keep in step; the fallbacks are the ones Primer ships, for the day a
token is renamed.

The two rows are not the same row, and `data-ghdiff-place` on the button is what
lets one stylesheet dress it for both. The tab row has no gap of its own, so the
tab skin sits flush against **Files changed** and reads as the next tab; the
commit header's action row is a flex row with an 8px gap of its own, so the
button skin carries no margin there. The old server-rendered `.tabnav-tabs`
draws its tabs wider and quieter than the React one — muted at rest, spacious
padding, a colour-only hover — and a descendant override under the same selector
github.com scopes its own rules with follows it. Everything else the two places
share is stated once, above them both.

A move from a pull request to a commit is a navigation GitHub makes without
reloading, and it reuses this one button. So `sync` writes the href, the place
and the title on every pass rather than at build time.

A compare range is the third target ghdiff has an address for, and it has no
button. Its header carries no control of its own to sit beside.

The script matches every page on github.com and not the pull request paths
alone, because GitHub moves between its own pages without reloading the
document, and a userscript manager starts a script once per document. So a
`MutationObserver` re-appends the button that React's next render drops, and a
50 ms timer — not `requestAnimationFrame`, which a background tab never runs —
turns a diff's thousands of mutations into one `sync` at a time. The button
carries the fragment over only when it is github.com's own `#diff-<64 hex>` form
with an optional line part, which is the one fragment `lookupDiffAnchor` can
resolve.

`UserscriptInstall` offers it from the home page, under the form and above the
examples. The line above the button names one manager and links to its install
page, because Install pressed in a browser with no manager downloads a file that
browser can do nothing with. That link is what the address written out under the
card used to be for, and one of the two is enough. Its Install control is a
plain `<a>` and never a `Link`: a client-side navigation makes no request, and
the request is the whole point. Bump `@version` in the script when it changes,
or nobody who installed it gets the change — `@updateURL` is what every manager
re-reads, and the version is what it compares.

**The left bar is not there when it has nothing to list.** `PullRail` returns
`null` while the watch list is empty, because an empty column beside a diff is a
promise the app cannot keep. The test is
`watched.hydrated && repos.length === 0` and not `repos.length` alone: browser
storage is read after mount, so an unread watch list looks empty, and hiding the
bar on that reading would unmount it and re-mount it on every load. With the bar
away, `ReviewHeader` takes its `showBrand` prop and carries the way home, so no
screen is a dead end.

**The first paint of that bar is settled in the document head.** `hydrated` is
false for one paint, and the server already sent the bar's markup, so a reviewer
who watches nothing saw the column arrive and then leave. `WatchedReposScript`
reads the same key before the body is parsed and writes `data-watching` on the
document; `html[data-watching='no'] [data-app-rail]` in `src/globals.css` keeps
that paint empty, and React's answer lands after it and agrees. Every reading
that leaves `useWatchedRepos` empty has to reach `'no'` there — no key, a value
that is not an array, and storage that throws alike — or the flash returns the
other way round. `PullRequestList` takes `hydrated` for the same reason: an
empty `repos` before the read is the default, not an answer, so it draws
`PullListSkeleton` and does not tell a reviewer who watches five that they watch
none. It draws the same skeleton whenever a request is in flight and it has no
rows, which is the other half of that: the moment after the first repository is
watched, `useOpenPulls` still holds the empty answer it gives an empty watch
list, and "no open pull requests in it" is a wrong answer to a question GitHub
has not been asked yet.

The attribute belongs to the watch list from then on, and `AppDataProvider`
writes it on every change once `hydrated`. The head script settles the first
paint and nothing else, so a stale `'no'` would go on hiding the bar with the
CSS after the reviewer watched their first repository — which is exactly the
reviewer the rule is there for, and exactly the moment the bar has to arrive.

**The home page holds the watch list itself, not the pull requests it makes.**
The bar lists those on every page, this one included, so a second copy of the
bar down the home page was the same rows twice. What the home page has that the
bar has not is the way to change the list, and `WatchedReposEditor` is there in
the open rather than behind a button: the bar is not drawn at all for a reviewer
who watches nothing, so on their first visit this section is the only way in.
`PullRail` keeps `WatchedReposDialog` for the same editor, because a reviewer
reading a diff cannot lose it to a navigation home.

**A reviewer who watches nothing is asked once per repository.** `PullRail`
draws nothing while the watch list is empty, so the one feature that makes
ghdiff somewhere to stay is invisible to exactly the reviewer who has not found
it yet — and a reviewer who arrived from the userscript button has never seen
the home page, where the editor sits in the open. `WatchOfferDialog` goes to
them instead, on the repository they are already reading, and offers to watch it
in one press.

Three things keep that from being a nag, and each of them is why it is a
component rather than a condition inside `PullRail`.

It is asked once per repository. `watchOfferPreference` holds the repositories
the offer has been made for, so **Not now** is final for the repository on
screen and says nothing about the next one — declining is an answer about this
diff, not about the feature, and a reviewer who has not found the bar yet is
still worth asking when they open somebody else's code. It records the asking
and not the answer, so Add lands there beside Not now: that costs nothing, since
the offer only reaches a reviewer whose watch list is empty and Add is what
fills it, and it buys the case no `onClose` can cover — a reviewer who closes
the tab with the window open has been asked, and the write on open is what
remembers it. Nothing trims the list: forty bytes a row against a five megabyte
store is no reason for a cap whose only effect would be to ask somebody twice.

That key held a bare `true` or `false` for one deploy, and the codec refuses
anything that is not an array, so a browser from that afternoon reads as the
empty list and is offered the repository in front of it once more. One dialog,
once. It is the one place the encoding rule below has been broken on purpose,
and the alternative was a second key to remember a shape that outlived nothing.

It waits for the diff, which is why `ReviewScreen` mounts it and `AppShell` does
not — `ready` is `patch.state === 'ready'`. A diff that would not load draws
`ReviewStatusPanel`, a failure with a fix in it and usually the 404 that sends
the reviewer to `/setup`, and a modal over that is a question stacked on a
problem. It also keeps the one offer for a repository the reviewer can read: a
404 leaves the setting alone, and the next diff that loads is offered.

And the press names the repository, so the label truncates rather than widen the
row. A name is as long as its owner made it, and this dialog scrolls vertically
— a box with `overflow-y: auto` takes an `overflow-x` of `auto` whether it asked
for one or not, so the overflow would arrive as a scrollbar across the window.
Nothing is lost to the clip, because the header above the diff names the
repository too.

The home page is offered nothing. It has the editor in the open already, and it
names no repository to offer.

**And the offer shows the bar rather than describe it.** A reviewer is being
asked to take a step on the strength of one sentence, and the sentence has to
name a thing they have never seen. So `WatchOfferPreview` draws it: the status
square is the whole point of the bar, and three of them say the three answers a
reviewer scans that column for — approved and green, changes requested with a
check failed, nobody looked yet and the checks still running.

The green square is the middle row of the five, and the middle of the three the
fade leaves legible. It is the answer a reviewer scans that column for, so it
sits where the eye lands first.

Five rows, because a list of exactly three reads as all there is. The first and
the last fade under one `mask-image` gradient whose stops sit at a fifth and
four fifths of the column, which is the whole of "fade one, three solid, fade
one" — and a mask reads alpha and never colour, so `transparent` to `#000`
serves both schemes with one figure. That is also why it is a mask rather than a
gradient painted over the rows: a paint would have to name the dialog's own
background and would drift the day that token moves.

The square is drawn at 30px where the real bar gives it 13, and the words beside
it stay at 12. In the bar the square is a mark on a row of text; here it is the
subject, and a mark at label size would read as a bullet in front of a list of
sentences. Nothing about the bar's figures follows from these two. No panel
behind it and the block centred, because a bordered box reads as a control to
press and this is a picture — `w-fit` on the column is what centres the block
while leaving every square on one pixel.

Every word in it comes from `describePullStatus`, the same function that names
the square for a screen reader on every row of the real bar, so the
advertisement cannot come to promise a state `PullStatusMark` does not paint.
The whole illustration is `aria-hidden`: it illustrates the paragraph above it,
and five marks each reading out their own `title` is noise in front of the two
buttons.

**The offer names a place, and a phone has a different one.** `PullRail` is
`max-phone:hidden` and `PullListButton` stands in for it, so "the bar on the
left" is false on the one screen that has no bar — a phone opens the same list
from the leftmost control in the review header, and the **Watched repos** button
sits at the head of that window instead of at the head of a bar. The offer names
the place twice, so complete phone and desktop catalog messages state both
readings and `useIsPhone` picks between them. A second caller of that hook costs
nothing: it is a media query and not a request.

**A field's border is its promise of a click target.** The card around the home
page's URL box is that border, and the `<input>` is only the middle of it: the
row's padding, the gap, and the space around **Review** are not the field, so a
click there did nothing. `focusTargetField` in `HomeScreen` puts the caret in
the field for any `mousedown` on the row that misses a control of its own, and
the guard has to name every control the row nests. It is `mousedown` and not
`click`, because by the time a click is reported the caret has already moved and
the selection is gone. The button is not overlaid on the input instead, which is
the other answer: its width is its label's, and the input would have to reserve
a fixed strip for a control free to outgrow it.

**The footer names the commit it was built from.** A reviewer looking at a
deployment has one right answer to "which version is this", and the page could
not give it. `vite.config.ts` asks git at config time and writes the sha into
both bundles as `import.meta.env.VITE_COMMIT_SHA` — nothing at runtime can ask a
Worker what it was built from. Git is asked before `GITHUB_SHA`, because
`actions/checkout` leaves the deploy job on the very commit it deploys and a
developer's own `pnpm dev` then reports what they are working from. A build with
no repository around it writes an empty string, and `BuildCommit` draws nothing
rather than link to a commit that may not exist. `GHDIFF_REPO` in
`src/lib/github/urls.ts` is this repository, so the two links in that footer
cannot name different ones.

That row reads as two pairs. **Source on GitHub** and **@imgggalvin** are
addresses off this site — the project, then the person who writes it — and the
sha and the served figure after them are about this deployment. Each of the two
links carries its own mark, and the X mark is drawn a pixel smaller than the
GitHub one: it fills its own box corner to corner where the GitHub mark keeps a
margin inside one, so equal boxes would not weigh the same. The X address is
written where it is used and not in `src/lib/github/urls.ts`, which holds
github.com and nothing else.

The sha opens that commit **in ghdiff**, not on github.com: this app reads
diffs, and its own build is a diff like any other. It is the one link in the app
that is a `Link` in this tab rather than a new one. `GitHubTextLink` opens a new
tab to keep a reviewer's scroll position, filter and fragment, and the home page
has none of the three to lose — so the rule that sends every other name to a new
tab has nothing to protect here.

**A remembered setting is a jotai atom, and that is the whole of why it
travels.** `src/lib/preferences.ts` names every setting the browser keeps — the
colour mode, the code font, the token, the watch list, the repositories that
list has been offered for, the viewer's five controls, the bar's collapse, the
two pane widths, the comment author filter, and the pull request list's scope —
as a key, a fallback, and the two directions between the value and the one
string a browser can hold. `src/hooks/preferences.ts` turns each of those into
one `atomWithStorage`, and `usePreference` is how a hook reads it.

Three things follow, and each of them was a rule or a bug before it. The store
is the owner, so two callers of a setting cannot come to disagree. A `storage`
event is what one tab hears when another writes, so a reviewer with four tabs
open changes the code font once — verified live for the nine that were there
then, sign-out included. And a setting is `undefined` until the browser's copy
has been read, which is where `hydrated` comes from: storage is read on mount
and never during a render, so the server's markup and the first client render
agree, and an unread watch list is not an empty one.

Add a setting by adding its codec to `src/lib/preferences.ts` and its atom
beside the others, then reading it with `usePreference`. The encodings there are
the ones already deployed and are not free to change: a reviewer's stored value
has to go on reading across a deploy, and three of those keys are read before
the first paint by a script in the document head. `src/lib/preferences.test.ts`
is where a new codec proves it can refuse what an older build wrote. The
watch-list offer's key is the one exception on record, written up with the offer
itself above: it held a boolean for a single deploy, and refusing that boolean
is what carries the browsers still holding one.

Two settings are not settings and stay where they are. The comments and the
viewed-file marks a browser keeps are per target, they are content rather than a
preference, and `useReviewComments` and `useViewedFiles` go on reading their own
key through `readStoredJson`.

**One owner for the state the whole app shares.** `AppDataProvider` mounts
`useCodeFont`, `useColorMode`, `useGitHubToken`, `useWatchedRepos`, and
`useOpenPulls` once, above the bar and the page. Four of those now read an atom
and could safely be called anywhere. `useOpenPulls` and `useGitHubSession` are
shared queries now, so a second caller would join the first rather than ask
GitHub again — but it would also read the result through a different object, and
the rule costs nothing to keep. Call `useAppData()`, and do not call those five
hooks in a screen.

**A request to GitHub is a shared query, and every tab of the browser shares
it.** `useSharedQuery` in `src/hooks/useSharedQuery.ts` is React Query with one
`queryFn` behind it, `SharedCache.fetch` in `src/lib/queryCache/sharedCache.ts`,
and that is three things that each degrade on their own. A coordinator decides
which tab fetches a key when several want it; a `BroadcastChannel` carries the
answer to the others the moment it lands; and an IndexedDB store keeps it for
the next load, so a new tab draws what the last one had before GitHub has
answered it.

The coordinator is the strongest the browser offers, picked once by
`pickCoordinator`. Web Locks is exact, and it needs a secure context as well as
the API — a self-hosted deployment on plain http across a LAN has no
`navigator.locks` at all, which is the likely way to land on the next one. The
soft lease announces a fetch on the channel and has the other tabs wait for its
release, at most `LEASE_WAIT_MS`; two tabs that announce in the same moment both
fetch. With no channel either, every tab fetches for itself and still keeps its
answers on disk. None of them is trusted for correctness: a tab takes another's
answer only when it is younger than the query's share window and arrived without
this tab asking, so a coordinator that lets two tabs through costs a request,
never a wrong answer.

The browser grants a lock and delivers a message on two separate queues, so a
tab that waited on a lock can be granted it before the answer it waited for has
arrived. That is why a fetch writes its record **before** it lets the lock go,
why a tab that waited reads the store first, and why it then gives the channel
`CHANNEL_GRACE_MS` before it fetches after all. A tab that did not wait does
none of that and costs nothing.

**What leaves a tab belongs to one account, and the session query says which.**
GitHub answers the same question differently for a signed-in reviewer and for
nobody, so a record is filed under `viewerNamespace`, a broadcast names it, and
a tab reads and takes only its confirmed account's. The session query,
`SESSION_QUERY_KEY`, is what confirms the account. It asks with this tab's own
cookie every time — another tab's answer to "who is this" may predate the
sign-in this document is the result of — and it is never borrowed, broadcast or
stored. An answer it got across a change of session is asked again, since React
Query hands an invalidated request already in flight back as it is.

Nothing leaves a tab before that confirmation, to the other tabs or to the disk,
and nothing reaches it. So every request waits for the confirmation, at most
`CONFIRM_WAIT_MS`. React runs a child's effects before its parent's, so the
review screen's queries start before the session query above them, and without
the wait each would start under a session nobody has vouched for. The wait is
also what lets a stored answer save a request: the store's records are read at
startup and held back until the confirmation places its own account's. A wait
that runs out lets the request go ahead, and its answer stays in this tab alone.

The session's answer says whose cookie it was when it was asked, so it vouches
for the fetches that began after it and for none that began before:
`confirmedFrom` is that moment. A fetch that began earlier and lands after the
confirmation is asked again, and an answer this tab already held from before it
is dropped and asked again at the confirmation. Every suspension and every
change of account raises the session's `generation`, and a fetch that lands
under a later one is asked again too — or handed back for React Query to drop,
when the reset cancelled it — and never shared. A confirmation of another
account resets every answer and deletes every record that is not this account's,
so the store holds one account at a time. A confirmed tab that hears another
confirm a different account drops every answer at once, the session's included;
an unconfirmed one takes it as a possible change and asks who it is.

**Answers are ordered by when their fetch began, never by when they landed.** A
read that began before a write can land after it, and a fetch another tab began
earlier can arrive later. `moment()` in `records.ts` is the clock: the wall
clock to a fraction of a millisecond, never the same value twice in one tab, so
two fetches that began in the same millisecond still have an order. Each answer
a tab holds notes its moment — its own fetch's, the broadcast's, or the moment
of a write it published — and a newer one is never replaced by an older one,
whether the older one arrives on the channel or lands from this tab's own fetch,
before its disk write or after it. A read that a reset cancelled notes nothing
at all, so it cannot lower the moment of an answer that replaced it. The store
keeps the same order: a record carries its fetch's moment, and a write never
replaces a record whose fetch began later — the read and the write are one
IndexedDB transaction, which another tab's write cannot interleave with. And a
stored answer keeps that moment when it comes back into memory, at startup and
when a tab that waited on the lock reads it, so a delayed broadcast of an older
fetch cannot replace it either. A write is a request like any other, so
`publish` takes the `ticket` the session had when the write was sent, and a
write that lands under a later session publishes nothing.

`useGitHubSession` is where the confirmation comes from, and signing out empties
the store. The press stops every write at once, and the store is cleared and the
other tabs told only **after** the Worker has ended the session: a tab told
earlier would ask who it is, be told the old account by the cookie still
standing, and write that account's answers straight back. The same happens when
`withRefresh` ends a session no refresh could mend — `onSessionEnded` in
`src/lib/authFetch.ts` is how the cache hears it.

The left bar's list is the answer this was built for. It is on every page of
every tab, so `useOpenPulls` keeps it for `PULLS_STALE_MS` and a new tab draws
the rows the last load left before GitHub has been asked. A change of watch list
keeps the old rows on screen until the new ones arrive, and only within one
session: a sign-out or a change of account resets every answer, and rows carried
across it would be the previous account's private ones.

Records expire after `CACHE_MAX_AGE_MS`, a day, and `CACHE_SCHEMA_VERSION` is
the one thing to raise when a procedure's output changes shape — never the
commit sha, which would empty every reviewer's cache on every deploy. An answer
may go to disk only in part, through a function such as `withoutAttachments`; a
record that lost something on the way is marked incomplete, drawn on arrival and
fetched behind at once, and never taken in place of a fetch. The same function
answers `undefined` for an answer that must not be kept at all — one that
carries a failure, which the next load would otherwise show before it had failed
at anything. The channel carries the whole answer, because a message is not
storage.

A signed attachment address never reaches the disk. `pulls.get` and
`comments.conversation` are stored through `withoutAttachments`, so a reload
draws the title and the conversation at once and fetches the signatures behind
them. A viewed mark made in another tab moves the box here and leaves every fold
alone: `useViewedFiles` seeds `loaded` once per diff, and a later answer moves
`viewed` only, with the presses still in flight laid over it. The marks are
shared between open tabs and never stored, because the first answer for a diff
decides what starts folded and a mark GitHub has since dismissed would fold a
file nobody has read again. A press asks GitHub for the list afresh once it
lands rather than patching the list it holds: two tabs patching the same old
list at once would each erase the other's mark. A verdict is the one write that
is published as it is — a single value with nothing to merge — and it carries
the session's `ticket` from the moment it was sent.

A pull request's line comments are shared the same way, and the merge is the
part to get right. `useReviewComments` seeds its threads from the first answer
for a diff, and every later one — a comment posted in another tab, a reload —
goes through `mergeGitHubThreads` in `src/lib/commentMerge.ts`. What only this
tab knows survives it: an open composer, a message still on its way, a failure
with the reviewer's text in it, and the issue link a thread holds in memory. A
thread GitHub already has keeps the key this tab gave it, so its card is not
mounted again. A message that never reached GitHub is laid after GitHub's own
messages in that thread, failure and all, rather than lost to a later reply that
did — and a thread deleted elsewhere stays as this tab drew it while it holds
such a message, since that text is the reviewer's and nowhere else. After a
write GitHub took — a post, a reply, a delete — the tab asks for the list afresh
instead of patching it and publishing the result: two tabs patching the same old
list at once would each erase the other's comment. The answer reaches every tab
on the pull request, and each merges it in, the writing tab included.

**A patch and a whole file are kept too, and GitHub says whether they are still
right.** They are too large for the channel and too large to trust by age, so
they go to a store of their own, `blobs`, under the same account rules and a
budget of `BLOB_BUDGET_BYTES`, oldest use first out. The next ask sends the
stored ETag as `If-None-Match`; `/api/diff` and `/api/file` hand it to GitHub,
and a 304 comes back as a 304 with no body, which is the stored text confirmed
and none of the quota spent. Both the web diff host and the raw file host answer
it, and so does the API. A synthesized patch has no ETag and is never stored. A
tab that waited on another's download takes the stored text if it is younger
than the share window, and does not ask GitHub at all. A stored copy is read
under the confirmed account and no other, and a download waits for the
confirmation the way every request does. The whole read — the store, GitHub, and
the store again — is asked again when the session moves under it, and never
answers with a copy or a text from a session that is not the one on screen: a
file load runs outside React Query, and nothing would cancel it. A newer answer
that cannot be kept — no ETag, or over `MAX_BLOB_BYTES` — deletes the stored
one, so a tab waiting on the download never takes the copy it replaced. Every
write sweeps the expired blobs as well as the ones over budget, because a tab
left open past a day keeps writing and startup is not the only sweep it gets.

`patchQueryOptions` finds the cache through `sharedCacheOf(client)`, the client
its `queryFn` is handed, so the review dialog's prefetch of the next layer is
stored and checked the same way as the screen's own read, with no hook in reach.
React Query still holds the text for its five minutes; the blob store is what
the next load and the other tabs start from.

jotai's own `Provider` sits above all of it, in `AppShell`, and it is there for
the Worker rather than for the browser. Without it every atom would resolve
against one store held by the module, and a Worker isolate serves many requests
in turn: a value written while one page rendered would be a value the next
reader inherited.

**The pull request list is repository, then author, then stack.**
`groupPullsByRepo` in `src/lib/pulls.ts` produces that shape, `buildPullStacks`
in `src/lib/pullStacks.ts` produces the stacks, and everything still level with
something else goes by pull request number, newest first. GitHub has no stack
object to ask for, so a stack is read off the branches: one open pull request
whose base branch is another open pull request's head branch is stacked on it.
Stacks are built inside an author group, so two people never share one chain.

**The list has one scope, and the bar's header is where it is set.**
`PullScopeSwitch` sits between the name and the collapse button. It is a set of
tabs with a count each, and one is always chosen: All, Mine and Others share one
frame, because Mine and Others split All between them, and This Stack sits
apart, because it is a question about the pull request on screen and is drawn
only while that pull request has a stack of more than one. All is a tab of its
own and not the absence of a press: the first version was toggles that undid
themselves on a second press, and a row of unpressed buttons meaning everything
was a thing the reviewer had to work out. The tabs are one `tablist`, with the
arrow keys, Home and End, and a tab with nothing in it is disabled unless it is
the one chosen. With one tab to offer — signed out, and no stack on screen — the
switch draws nothing. `src/lib/pullScope.ts` holds the rules, and
`effectivePullScope` turns a stored scope the moment cannot honour — `stack` on
the home page, `mine` signed out — into `all` rather than into an empty list.
The list, the narrow bar and the switch all read that answer through
`usePullScope`, so the tab chosen can never be one the list is not drawing. The
narrow bar has no room for the switch and follows it anyway.

On a phone the switch is the `toolbar` of the sheet `PullListButton` opens: a
row under the title, the way iOS puts a segmented control under a navigation
title, inside the sticky bar that does not scroll away. It is part of the bar's
height, which `Dialog` states as `--app-sticky-top`, so the repository headings
the list pins under the bar pin under the toolbar too. It is part of the drag
handle as well, and `useSheetDrag` already leaves a press on a button to the
button. Its tabs are 32px tall. The sheet's title is the chosen tab's name, so
it names the list on screen rather than "Open pull requests" over Mine alone.

**The sheet does not move while it fills.** Three things used to move it, and
each was a fix of its own. A sheet is always at its full height — iOS's large
detent — so a skeleton a third of the screen tall no longer shoots up to the
full height when the answer lands. The switch has a skeleton of its own,
`ScopeSkeleton`, drawn from `expectedPullScopes`: the tabs a signed-in reviewer
will get, the stored tab already chosen, and the stack only when the stored tab
was the stack, because whether the pull request on screen has one is part of the
answer still on its way. The title follows the same guess. And a sheet's body is
not inside `AnimatedHeight`: that box clips with `overflow: hidden` while it
travels, which makes it the scroll container of anything sticky inside it, so
for every frame a tab change spent travelling the repository heading was pinned
`--app-sticky-top` below the top of the box, over a row. A card keeps the box,
and nothing sticky inside a card's body may rely on the dialog's scroll while it
does.

The sheet mounts only past hydration, through `useHydrated`. `PullListButton`
sits in the review route, which hydrates as a lazy chunk after the bar has
already read the stored scope, so a sheet rendered on that pass titled itself
with the stored tab where the server had the fallback, and React rebuilt the
route over the difference. The sheet is closed on the server and on the first
paint, so the wait is invisible.

Every tab has a `Tooltip` with its name, in the bar and in the sheet alike: the
glyph and the count are all a tab draws, and a narrow desktop window gets the
sheet as well. A tap on a phone leaves no label on screen, because Tailwind
applies `hover:` and `group-hover:` only under `(hover: hover)`. The name is
also in each tab as `sr-only` text, so the tooltip, which is `aria-hidden`, is
not the only place it is.

GitHub has no glyph for "my pull requests", so Mine and Others are composed from
octicons: the pull request glyph with a solid person or the outlined pair in its
lower right corner. All is the pull request glyph alone. The corner is cut out
of the pull request glyph with a `mask-image`, never with a ring painted in a
background colour, because the tab behind it changes colour when it is chosen.

**The bar's header measures itself, because what is in it decides whether it
fits.** The name, four tabs and the collapse press do not fit the default 272px
once a count has three digits, and a container query answers for the row's width
and knows nothing of the counts. So `useRowFit` takes the steps in `HEADER_FIT`
until the row fits and writes the steps taken into `data-fit`, which the classes
read as `data-fit~=step`. The name gives way to a home glyph first, because a
name truncated to one letter is no name and the way home has to stay; then the
tabs take their padding in; then All's count goes, because Mine and Others add
up to it; and last the other counts go and the row takes in its own padding. A
count that is not drawn is still in the tab's accessible name. Measured with
counts of 100: at 480px the row draws everything, at 320px the name is a home
glyph, at 272px the tabs are tight as well, and the row ends inside the bar down
to 200px.

The scope is stored under `ghdiff-show-own-pulls`, which held a boolean when the
one choice was whether to show the viewer's own. Both of its values still read —
`true` as `all`, `false` as `others` — so a reviewer who hid their own pull
requests is not shown them again by a deploy.

**A stack is a block, and both bar widths draw it.** A chain of more than one
pull request sits on a background of its own under `PullStackBadge`, the layers
glyph and the count. A pull request that stands alone gets neither, so the
background means one thing. The narrow bar draws the same block around the same
squares: which pull requests were chained, and whose they were, were the two
things collapsing the bar used to throw away. The block is an **inset ring**,
not a border — a border would indent the rows inside it by a pixel, and a
stacked row's square must land where a plain row's square lands.

The wide bar names the block. `Stack` sits at the left of the caption row and
the badge at the right, in the badge's own size and colour, so the two read as
one quiet line rather than a heading over the rows. The count alone left a
reader to work out what a background and a layers glyph meant, against an empty
half-row. The word is `PullRequestList`'s and never `PullStackBadge`'s: the
collapsed bar is the width of one square, and it draws the badge alone.

**A stack's caption opens the whole stack as one diff.** Beside the word,
`StackCompareLink` reads **Compare with main** — the base the stack lands on,
whatever its name — and opens the compare range from that base to the head of
the stack's last pull request, in ghdiff rather than on github.com. A row opens
one layer; this answers what all of them do to main before the first one merges.
The range is a merge-base range, so main's own later commits are not in it.
`stackCompareRange` in `src/lib/pullStacks.ts` draws nothing for a stack that
branches: two tips have no one head. The tip's head is read as a branch of the
base repository; a tip opened from a fork would need `owner:branch`, which
`PullSummary` does not carry.

**A group boundary is a rule, not a heading.** A heading sits closer to the rows
under it than the rows sit to each other, which is what a heading is for and why
it cannot also be the boundary: two authors read as one run. Both lists rule off
between repositories and between authors, and the rule is drawn from the index
rather than `:first-child`, because an author group is never the first child of
its section — the repository heading is.

**A name on screen that GitHub has a page for is a link to it, in a new tab.**
`src/lib/github/urls.ts` builds every one of those addresses, so a query string
assembled at one call site cannot differ from the next: the repository heading
goes to the repository, the count beside it goes to the same rows on GitHub
(`is:pr is:open`, which is what GitHub's own Pull requests tab applies), the
author heading's arrow adds `author:` to that query, and the label in
`ReviewHeader` goes to the pull request, commit or compare range under review.
`GitHubTextLink` and `GitHubIconLink` in `src/components/GitHubLink.tsx` are the
two shapes: text that reads as itself until the pointer arrives, and a glyph
that is not there until the row is hovered. Both carry `target="_blank"` and
`rel="noreferrer"`, because ghdiff is a place a reviewer stays — a link that
replaced the diff would cost them the scroll position, the filter and the
fragment they had built up. An author's arrow keeps its space while it is
invisible, or every heading would move as the pointer crossed the list.

**A repository answers with at most 100 open pull requests.**
`MAX_PULLS_PER_REPO` in `src/lib/rpc/router.ts` is 100 because that is the
largest single page GitHub gives: REST caps `per_page` there and GraphQL caps
`first`. Both queries sort by most recently updated, so what a busier repository
loses is what nobody has touched. Raising it past 100 buys nothing without
pagination.

**The review and the check axes need a credential.** `pulls.list` asks GraphQL
for `latestOpinionatedReviews`, `reviewDecision` and the head commit's
`statusCheckRollup`, none of which REST carries. GraphQL refuses an anonymous
caller, so a signed-out caller gets the REST list and `PullSummary.status` stays
**absent** — not `none`. Absent means "never asked", and `PullRow` leaves the
square off the row rather than claim there is no review and no CI. The lane the
square sits in is the list's to keep or drop, never one row's: one answer is
asked with a token or without one, so every row in it has the axes or none does.
A signed-out list drops the lane on every row and gives the titles its width; a
signed-in one keeps it on every row, so every number starts on the same pixel.

**The review axis is the reviews, and `reviewDecision` only adds to them.** That
field was the whole of the axis once, and it answers a different question:
GitHub computes it against the base branch's own rule about who has to approve,
so an unprotected repository answers `null` for every pull request it has, and
even a protected one goes stale — two pull requests on one branch each carried
one approval, in the same minute, and GitHub reported `APPROVED` for the first
and `null` for the second. So `reviewFromSource` in `src/lib/pullStatus.ts`
reads `latestOpinionatedReviews`, which is the newest verdict from each
reviewer, and lets `reviewDecision` contribute `APPROVED` or `CHANGES_REQUESTED`
on top. `REVIEW_REQUIRED` contributes nothing: it says a rule is unsatisfied,
and one approval out of the two a rule wants is still somebody's approval.
`DISMISSED` is the one state in that list which is not an opinion, and it counts
as unread. A grey square under a header that read **Approved** was the whole
complaint — `ReviewButton` asks `viewerLatestReview`, which is a review, and the
two now agree.

**`/setup` is where a 404 gets answered instead of described.** A panel can say
one sentence and offer one button. What it cannot do is answer the question
behind the sentence, which is not "what went wrong" but "what is still missing"
— and under a GitHub App two things can be, in a fixed order. Signed in with no
installation reads exactly like signed out. An installation on the wrong account
reads exactly like no installation at all. An installation whose chosen list is
empty reads like success from every angle and still answers 404 for everything.

So the page checks each in turn, and every step reports its own state from what
GitHub answered rather than from what the reviewer was told to do — a step is
done because it is done, and the rail cannot claim progress the App does not
have. `installations.list` is what it asks: `GET /user/installations` is a
user-to-server endpoint, so it answers for this token's own user and this App
with no App-level JWT, and `src/lib/server/github/installations.ts` counts the
reach of each chosen list with one further request apiece. That count is the
whole point of the row — "installed" is the fact the reviewer already believes
by the time they are reading it, and the figure beside it is what explains the
404 they are still getting. `describeInstallationReach` gives zero its own
sentence for the same reason.

Two callers, and they know different things. The review panel knows the path the
diff would not load from and sends `from`, which also gives step three somewhere
to go back to. `PullRequestList` knows only that a repository would not list and
sends `account` — that list used to print GitHub's own "Could not resolve to a
Repository" and stop, which was the least useful message in the app for the one
condition a reviewer meets most. It still cannot say whether the repository is
absent or merely unreachable, because GitHub deliberately answers both the same
way, and it does not pretend to: it names the one cause that can be acted on. It
offers that once, and only when signed in, and only when every failing row
shares one owner — two accounts failing is a general question, and `undefined`
is what asks it.

Step three is a plain `<a>` and a whole page load, not a `Link`. The point of
going back is a fresh request to GitHub under an installation that did not exist
a minute ago. And nothing polls for step two: a reviewer installs in the other
tab, comes back knowing they have finished, and presses **Check again**.

**The square is the only glyph on a row.** The lifecycle octicon that stood
beside it repeated what the list already says — every pull request in the list
is open — and it took half the leading lane from the one glyph that carries new
information. `PullStateIcon` survives for `PullDetailsCard`, where the state is
named in words next to it. The one thing the square cannot carry is draft, so a
draft row gets a `Draft` chip and an open row pays nothing for it.

**The status square is GalvinGao/floodgate's, deliberately.** Left half review,
right half checks, white `+` when the author pushed after somebody asked for
changes. The colours are Primer's, defined per scheme as `--app-status-*` in
`src/globals.css`. floodgate paints the same square into the favicon of every
pull request tab, so a colour must keep meaning the same thing in both places:
change `src/lib/pullStatus.ts` and floodgate's `lib/pr-status.ts` together, or
not at all. floodgate's `normalize` still reads `reviewDecision` alone, so its
favicon is grey for the approved pull request whose square here is green. Carry
`latestOpinionatedReviews` over there.
