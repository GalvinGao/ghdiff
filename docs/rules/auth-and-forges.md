# Auth and forges

Credentials and the GitHub boundary: the session cookie and its guards, refresh,
the GitHub App, the RPC contract, the diff and file routes, verdicts, and error
shapes.

**A failure GitHub explained must reach the reviewer explained.** GitHub answers
most failures with the useful sentence in the body's top-level `message` — "Not
Found", "Bad credentials", the rate limit's own line. A **validation** failure
is the exception: there `message` is only the status name, and the reason sits
in `errors[].message`. Reading the top level alone is what put **Unprocessable
Entity** in front of a reviewer who had tried to approve their own pull request,
which is a true sentence and the least useful one available.
`gitHubErrorMessage` in `src/lib/github/error.ts` takes the detail when there is
one and changes nothing otherwise, and `github/error.test.ts` pins both halves —
the 422 that has a reason, and the ordinary failures that must keep behaving as
they did.

**A review is a verdict, and it is one press.** `reviews.submit` posts to
`/pulls/{n}/reviews` with GitHub's own `event`, and `src/lib/reviewDecision.ts`
holds the three and the one rule that separates them: `REQUEST_CHANGES` and
`COMMENT` are nothing without words, and `canSubmitReview` is what disables
those buttons rather than letting a 422 arrive after the reviewer has written
them. `ReviewSubmitDialog` gives each event a button of its own instead of a
radio group and a Submit: GitHub asks twice because it has a batch of pending
line comments to send with the verdict, and this app has none — a line comment
is posted where it is written. A failure keeps the dialog open with GitHub's own
sentence in it, because GitHub is the one that knows a reviewer cannot approve
their own pull request. A verdict that lands reloads the open pull requests,
since the review half of every row's square has just changed.

**A grey button says why it is grey.** Two things stop a verdict, and they are
not the same kind of thing. A missing note is the reviewer's to fix and clears
the moment they type. Their own pull request never clears — GitHub refuses an
approval and a change request from whoever opened it, and answers 422 if asked,
which is how this was found: pressing **Approve** on your own pull request
returned a bare "Unprocessable Entity". So `reviewBlock` in
`src/lib/reviewDecision.ts` returns a reason rather than a boolean, and
`own-pull-request` is asked before `needs-note`: on your own pull request a note
would change nothing, and sending a reviewer to write one is sending them to do
work for no result. `isOwnPullRequest` compares logins without case and answers
no when either side is unknown, which is the safe default — it leaves all three
offered and lets GitHub decide.

The reason reaches the reviewer twice, because the two ways of reading a screen
need different things. A standing line beside the buttons is real text in the
DOM, so it is there without hovering and a screen reader gets it; only one
shows, and ownership wins over the note because it is the fact that cannot be
acted on. Per button, a `Tooltip` carries the precise sentence, and the button's
own `aria-label` becomes its label plus that sentence — the tooltip's text is
`aria-hidden`, so without that a screen reader is told a button is unavailable
and never why.

Two measurements shape those tooltips, and both were surprises. `buttonClass`
sets `disabled:pointer-events-none`, which sounds like it would kill a CSS-only
tooltip on a disabled control — it does not, because `Tooltip` hovers on the
wrapper it puts around the control and the pointer passes straight through to
it. And the buttons are the **last row of a scrolling dialog**, so `side`
matters twice over: a label below them is outside the content box and gets
clipped, and a centred label on the rightmost button hangs out the side — which
turns into a horizontal scrollbar across the whole dialog, because a box with
`overflow-y: auto` has an `overflow-x` of `auto` whether it asked for one or
not. `top-end` plus `wide` is what keeps a sixty-character reason inside a 480px
dialog, and it was verified by measuring all four edges rather than by looking.

**A verdict already given is what the button says.** `reviews.mine` asks GraphQL
for `viewerLatestReview`, the one field that answers "what did this token's own
user decide about this pull request" — REST answers with every review by
everybody, over as many pages as the pull request has collected, and the caller
would then have to ask GitHub who it is. `reviewVerdict` in
`src/lib/reviewDecision.ts` reads that state, and `PENDING` and `DISMISSED`
answer with nothing: a draft nobody sent and a verdict GitHub took back are not
decisions. `ReviewButton` then says **Approved** rather than **Review**, in the
tone `PullStatusMark` paints the same verdict in, so one green means one thing
in the header and in the left bar. The button still opens the same dialog,
because GitHub keeps every review and follows the newest — a second one is how a
reviewer changes their mind. Everything about this needs a token, since the
verdict is the token's own, and a failure to read it is reported nowhere: the
button falls back to the offer it would have made anyway.

**The team's verdicts sit above the reviewer's own.** `reviews.team` reads the
last fifty reviews through GraphQL, and `recentTeamReviews` in
`src/lib/reviewDecision.ts` keeps the five newest that are somebody else's
decision: not the viewer's own (`viewerDidAuthor`), not a bot's, not `PENDING`
or `DISMISSED`, and not a `COMMENTED` review with no body — that is how GitHub
files a reply in a line thread, and on a busy pull request those replies would
push every verdict off the list. `ReviewSubmitDialog` draws the list under its
title bar and draws nothing when it is empty. The rows are drawn on the
popover's first paint and only the ages wait for the open, because the ages sit
at the right edge of each row, where their arrival moves nothing. `VERDICT_ICON`
and `VERDICT_COLOR` in `src/components/reviewVerdictStyle.ts` are shared with
the header's button, so an approval is one glyph in one green in both places.

**Inside a stack, Approve is Approve and next.** A stack is reviewed in order,
so an approval ends one layer and starts the next, and the dialog makes that one
press. `stackPosition` in `src/lib/stackReview.ts` reads the place off the same
list the left bar draws — `flattenStacks` order, so the next layer is the row
under this one — which means a repository nobody watches has no stack here and
Approve behaves as it always did. The dialog names the next layer before the
press, by number and title, and on the last one it says why Approve stays put: a
reviewer who has pressed it three times expects a fourth to move. Request
changes and Comment never move, and a failure keeps the dialog open as before.
The line is not drawn on your own pull request, where Approve is not offered.

The screen is keyed by target, so the screen that pressed is gone before it
could say the verdict landed. `useStackHandoff` is a jotai atom that carries the
one fact across the navigation, and the screen it names takes it on mount and
shows a `Toast`; the last layer sets the same toast on itself. Nothing is
stored, because a reload is a new visit.

**And the next layer's patch is already downloading.** The patch is a React
Query query, `patchQueryOptions` in `src/hooks/useReviewPatch.ts`, keyed by
`reviewTargetKey`. The dialog opening on a stack prefetches the next layer's,
and that screen's own query finds the answer — or the download still on its way
— under the same key. The dialog and not the screen is the trigger, because a
patch fetched when a twenty-minute read began is twenty minutes old. A patch is
fresh and kept for five minutes, one figure for both: long enough for a note to
be written between the open and the press, short enough that the branch has not
moved under it, and short enough that tens of megabytes are not held for
nothing. It never refetches on focus or reconnect, since a diff must not change
under its reader, and never retries, since a 404 or a spent quota is an answer.
Only the text is cached: parsing a prefetch would freeze the tab under a
reviewer still typing a note, so the screen that reads the patch parses it. A
prefetch is a serve to the footer's counter whether or not it is read.

**The deployments sit first in the header's right group, and arrive last.**
`DeploymentMenu` reads GitHub's Deployments API and nothing else. That is where
GitHub's own **View deployment** button reads from, and it is provider-neutral:
Vercel, wrangler-action with a `gitHubToken`, and every workflow that calls
`createDeployment` land there. A provider that only posts a bot comment is not
read, because a parser per bot is a parser that breaks the day the bot rewords
itself. The button is drawn only once GitHub says there is something deployed,
and the group is pinned to the right edge, so arriving at its left end moves
nothing.

The menu answers two questions, in that order. **Latest** is one row per
environment, in name order so a poll never moves a row under the pointer, and
each row says where that environment stands against the head —
`latestByEnvironment` in `src/lib/deployments.ts` reads it as `current`,
`building`, `failed`, `waiting` (no build of the head yet, and its checks are
still running) or `outdated` (no build of the head, and nothing running that
will make one). A press opens the newest build that works, which is older than
the head for every reading but `current`, and the row prints that build's sha,
not the head's. **All** is every deployment, newest first, and an older commit's
row is drawn faint. It is left out when it would only repeat the rows above.

`inactive` is not a failure. GitHub marks a deployment inactive when a newer one
in the same environment succeeds, and a preview host keeps every build at its
own address, so the link still answers. A deployment with no status for an hour
is `unknown` rather than in progress forever, because Actions can create one and
be cancelled before it reports anything.

**A Cloudflare Pages branch alias is rebuilt, not read.** wrangler-action
records the build's own address, `<8 hex>.<project>.pages.dev`, and the alias
that follows the branch's newest build — the address a preview comment calls
**Branch (latest)** — reaches GitHub nowhere. `pagesBranchAlias` makes it from
the branch the deployment names by Cloudflare's rule: lower case, every
character that is not a letter or a digit replaced by `-`, cut at 28, and no `-`
left at the end. Four live aliases on troph-team/lilja pin it in the tests, one
cut mid-word and one cut on a `-`. Only the Latest row uses it; a row in All
opens its own build.

wrangler-action creates its deployment after the upload succeeds, with one
`success` status. A Pages build in progress or failed is therefore not a
deployment at all, and `waiting` and `outdated` are how the menu reports it: the
head's check rollup, read in the same query, says whether something is still
running.

**`environment_url` is untrusted.** Anybody who can create a deployment writes
it, and a `javascript:` address in an `href` runs in this origin.
`safeDeploymentUrl` keeps http and https and drops everything else, on the
server, before the address reaches a component.

**The poll is React Query's, and it stops.** `useDeployments` polls every 15
seconds while `deploymentsInFlight` says the answer is about to change — a build
of the head still going, or head checks running while an environment has no
build of the head — for ten minutes per head at most, backing off on failure,
and not at all while the tab is hidden. A pull request with no deployments is
never polled: most repositories deploy nothing, and every one of them has checks
that run. The schedule, the single request in flight, the retry and the answer
kept through a failure are all the library's. The share window is a little under
the poll, so two tabs on the same diff make one request per poll between them,
and nothing about a build is written to disk: last load's state of a build is
the one answer here certain to be wrong.

A caller with no token is asked once and never polled. GraphQL refuses it, so
the server reads REST instead — the head, its deployments, and one status per
environment, at most three — which is up to five of sixty requests an hour. It
gets the head's builds alone and no check rollup. A signed-in reviewer gets one
GraphQL query: the newest twenty commits of the pull request, ten deployments
each, and the head's rollup.

The App needs **Deployments: Read-only** for any of this, and an owner has to
accept the new permission before GitHub will answer. Until then GitHub answers
"Resource not accessible by integration", and `readDeployments` reads that as an
empty list: the header draws no menu, which is what a repository that deploys
nothing draws too, and a reviewer cannot fix somebody else's installation from a
diff.

**The API is one contract, and both sides read it.** `src/lib/rpc/contract.ts`
names every procedure, its input and its output, and imports nothing from a
server and nothing from a component. `router.ts` implements it and `client.ts`
calls it, so a field renamed in the contract fails to compile on both sides at
once. That split is also what keeps `@/lib/server/github` out of the client
bundle: the client is built from the **contract**, never from the router, so no
import path leads from a hook to the GitHub client.

No procedure takes a credential. The token is resolved once at the edge and
handed down as context, and on the client side there is no context at all: the
cookie is same-origin and the browser attaches it.

An input carries a zod schema, because it arrives from a browser and is not
trusted. An output carries `type<T>()`, which is a type and no runtime check:
`PullSummary`, `PullDetails` and `CommentPayload` each already have one home in
`src/lib`, and a second description of them in zod would be a copy free to
drift. Add a procedure by adding it to the contract first; the two
implementations will not compile until they agree with it.

**The diff is not a procedure.** `/api/diff` stays a plain route that answers
`text/plain`, because a patch runs to tens of megabytes — oven-sh/bun#30412 is
43 MB — and the route hands GitHub's own body straight to the browser. An RPC
envelope would make the Worker read all of it into memory and JSON-escape it
first, on a runtime with neither the memory nor the CPU time to spare. It is
also the one call whose HTTP status the client reads directly, for
`describeReviewFailure`. `/api/file` is a route for the same reason and answers
the same way; a source file is not much smaller than a patch.

**A private diff is capped, and the cap is GitHub App's fault.** github.com's
`.diff` host has no file or line limit and is the primary source — but it does
not authenticate a user-to-server token, which was measured rather than assumed:
a public pull request with no credential answers from `web-diff`, and the same
route with a live `ghu_` token on a private pull request answers from
`api-diff`. So a private diff gets the API's 300 files and 20000 lines, then
`synthesizePatch`, which is where GitHub omits `patch` on its larger files — a
162-file private pull request came back with 96 of them carrying no lines.

Public diffs are unaffected, and private diffs inside the cap are complete. What
a large private diff loses is content the personal access token used to fetch,
and `describeSynthesisGaps` is what says so on screen. That is a known and
accepted cost of shipping the App as the only credential path; the fallback for
it is a follow-up, and the seam it will use already exists — a `Bearer` header
still reaches the web host, and `resolveGitHubToken` honours one ahead of the
cookie. Whatever that follow-up does, it must not put a token form back in front
of a reviewer who has just finished authorizing an App: it asks only when a diff
has actually hit the limit, and nowhere else.

**A spent quota is one status, and the panel asks for a sign-in.** GitHub
reports the primary rate limit as 403 on `api.github.com` and as 429 on the web
diff host, and a 403 is also its answer to an invisible repository and to a
request that names no user agent. `rateLimitedStatus` in `src/lib/rateLimit.ts`
reads `retry-after` and `x-ratelimit-remaining: 0` to tell those apart, and
every throw in `src/lib/server/github/client.ts` reports 429 for a quota that is
gone, so nothing downstream has to ask which 403 it holds.
`describeReviewFailure` in `src/lib/reviewFailure.ts` then turns that status
into the panel's copy and its button: a signed-out browser over the limit leads
with **Sign in with GitHub**, because "Try again" against a spent anonymous
quota does nothing for the rest of the hour while signing in takes the ceiling
from 60 requests to 5000 on the next one. A signed-in reviewer over quota gets
the retry alone — there is no second account to add, and the hour is all that is
left. That button is one press and no dialog: `session.signIn()` leaves the
site, and `returnTo` carries the fragment, so the sign-in comes back to the very
lines the reviewer was reading.

Not Found is the other failure with a fix, and the one that does not look like
it has one. GitHub answers 404 both for a diff that is not there and for a diff
the caller may not see, deliberately: an answer that told the two apart would
confirm that a private repository exists. So the panel guesses out loud, and the
guess turns on whether the reviewer is signed in.

Signed out, the answer is the repository is probably private, and the fix is to
sign in. Signed in, it is almost never the credential: the sign-in worked, and
telling that reviewer to sign in again sends them to redo a step that already
did what it could. It is the step a personal access token never had. A GitHub
App reaches only the repositories it is **installed** on, so a signed-in 404
means ghdiff is not installed on this one — `ReviewFailureAction` calls that
`install`, and it leads to `/setup` rather than to github.com.

**The credential never reaches the server's disk, and no script can read it.** A
reviewer signs in through the ghdiff GitHub App. What comes back is a
user-to-server access token, good for eight hours, and a refresh token good for
six months; both go into one `httpOnly` cookie the Worker seals with AES-256-GCM
and hands to the browser. There is no session table, no per-reviewer record, and
nothing kept between requests — a dump of everything this Worker persists is one
KV key holding an integer, so `SESSION_SECRET` on its own opens nothing, because
nothing sealed is stored anywhere for it to open.

`httpOnly` is what the personal access token could not have. This app renders
comment bodies that any GitHub user can write, through `rehype-sanitize`, and a
credential in `localStorage` is one hole in that filter away from being read.

`resolveGitHubToken` in `src/lib/server/github/client.ts` is where the three
sources meet, most specific first: a `Bearer` header, then the sealed cookie,
then `GITHUB_TOKEN`. The header wins because a caller that named a credential
meant that one — which is what keeps curl and a script working with a personal
access token even though nothing in the interface offers one. `GITHUB_TOKEN` is
last, and it is a single-user deployment's way to skip the browser step
entirely.

It also answers `fromSession`, and that is the only thing that reads it: a
viewer resolved from `GITHUB_TOKEN` has no sign-out to offer and one resolved
from the cookie does, so `viewer.get` forwards it and the account menu draws the
button from it rather than guessing from the viewer.

`accessTokenUsable` is asked there **without** the refresh skew, and
`accessTokenFresh` with it. They are two different questions. A token five
minutes from its expiry still works, so the first says yes; the second is what
the refresh route asks, and the skew is there because GitHub's clock and this
Worker's are not the same clock. Answering the first question with the skew
would drop a signed-in reviewer to anonymous for those five minutes.

**A sealed cookie is guarded by six things, and none of them is a store.** Each
is a few lines and none adds a dependency; `src/lib/session.ts` holds the ones
with no cipher in them and `src/lib/server/session.ts` the rest.

A **per-seal key**: `HKDF-SHA256` over `SESSION_SECRET` with sixteen fresh
random bytes as the salt, and the salt travels in the cookie. One key never
seals two cookies, so GCM's nonce-reuse cliff is not reachable even in
principle.

A **keyring, not a secret**: `SESSION_SECRET` parses as a comma-separated list.
The first seals and every one of them is tried on the way in. GCM authenticates
what it opens, so a wrong key simply fails and no key id has to travel — and a
rotation costs nobody their session, where one key would sign out every reviewer
at once. An unset secret answers with nothing, which is a deployment that serves
public diffs and cannot sign anybody in; a secret that is set and is not a key
throws, because that is a typo and a loud failure is what tells somebody so.

The **`__Host-` prefix** on both cookie names. The browser enforces it:
`Secure`, `Path=/`, and no `Domain` at all, so no subdomain of ghdiff.com can
write the session cookie and none can fix a session onto a reviewer.
`SameSite=Lax` plus `originAllowed` on every mutating route is the CSRF pair —
the first for every browser that honours it, the second for the check that does
not depend on one.

An **absolute lifetime**. The payload carries `issuedAt` and a refresh carries
it forward unchanged, so `SESSION_MAX_AGE_MS` is a ceiling and not a window that
rolls. 180 days, inside GitHub's own six months, so the ceiling and not GitHub
ends a session that is in use. It was thirty, and a month after each sign-in the
browser dropped the cookie with nothing on screen to say so: the next request
went to GitHub as nobody, and on ghdiff.com nobody is a Cloudflare address whose
anonymous quota other Workers have already spent, so the reviewer read "rate
limit reached" where they should have read "sign in again".

**Refresh reuse treated as theft.** Any failure but one clears the session.

**Revocation at GitHub on sign-out.** `DELETE /applications/{client_id}/token`
with the client id and secret as HTTP Basic, awaited inside the request rather
than in `waitUntil`: a sign-out that reported success before the revocation
landed would be reporting something it did not know. This is the answer to the
one thing a session table is genuinely good for — GitHub **is** the session
store, the reviewer can revoke ghdiff from their own settings page at any
moment, and every cookie dies with it. Both cookies go whatever GitHub says: a
revocation that failed leaves a token outliving its session, which is a shame,
where a cookie surviving the press would leave a reviewer signed in after asking
not to be.

None of this stops a stolen cookie, and nothing here pretends to. A cookie is a
bearer credential. What the six do is bound how long one lasts and give the
reviewer one press that kills it.

The split-key design — ciphertext in KV, half the key in a cookie and stored
nowhere — is the right answer the day ghdiff keeps anything server-side per
reviewer. Not before: there is nothing to keep, and KV is eventually consistent,
so a refresh written in one location can be invisible in another for up to a
minute. That is a session that breaks at random for a travelling reviewer, and
strong consistency means a Durable Object, which this file already turned down
for the served counter.

**One route spends a refresh token, and the cookie is the single-flight.**
GitHub's refresh token is single-use: spending it invalidates it and the access
token beside it, and a second caller spending the same one gets nothing. A
refresh folded into each request would race itself the first time a reviewer had
two tabs open. So `/api/auth/refresh` is the only place, and two of its answers
make the race harmless without a lock or a store.

A refresh that is **not needed** answers 204 and writes no cookie. The tab that
arrives a moment after another one refreshed finds a live token in the cookie
the browser now holds, and is told there is nothing to do.

A refresh GitHub refuses with `bad_refresh_token` **also** answers 204 and
writes no cookie. That answer means somebody already spent this refresh token,
and the overwhelmingly likely somebody is another tab whose new cookie the
browser is holding right now — a cookie this request cannot see, because the
browser sent the old one before the new one existed. So the route breaks nothing
and lets the caller retry, and the retry carries the newer cookie. In the other
case — a refresh token spent where this browser will never see the result,
revoked at github.com or taken — the retry carries the same dead cookie and gets
the same 401, and `withRefresh` ends the session on that second 401 through
`/api/auth/signout`, the route that already knows how to end one. It is the one
place that sees both answers: a 401 after a 204 is the proof the race had no
winner here, and without that press a cookie no refresh can mend would cost a
refresh and an error on every load for the rest of its 180 days. The wrong guess
costs one request; the opposite wrong guess would sign a reviewer out for having
two tabs open.

**A spent token is answered 401, because nothing else asks for a refresh.**
`withRefresh` calls the refresh route after a 401 and at no other time, and for
one deploy no read produced one: `resolveGitHubToken` found the dead token,
answered with no token, and every read went on anonymously — `viewer.get` said
nobody was signed in and a private diff came back Not Found, eight hours into a
sign-in good for 180 days. Only a write reached `requireToken`'s 401, so
pressing Approve mended a session a page load could not. `refreshDue` in
`src/lib/session.ts` names the one state — inside the ceiling, access token
spent, refresh token live — and the three routes that read the cookie answer it
with 401 before GitHub is asked: the RPC handler through one middleware over
every procedure, so the client decodes a sentence rather than a body it cannot
parse, and `/api/diff` and `/api/file` as `text/plain`. It outranks
`GITHUB_TOKEN`, or that reviewer's ninth hour would be spent as the deployment's
own account. A session past the ceiling or with no refresh token gets no 401 and
is anonymous, as it always was: there is nothing to send the browser to fetch.
`describeReviewFailure` gives the status the setup button, since by the time a
401 reaches the panel the refresh has failed and the session is gone.

Inside one tab the same job is a promise. `withRefresh` in
`src/lib/authFetch.ts` wraps every call this app makes to its own Worker: a 401
asks `/api/auth/refresh` once, through one module-level promise however many
requests hit 401 together, and then sends the request again. It takes a
**function** and not a request, because sending reads a body and a body is a
stream — the RPC link takes its `Request` apart and rebuilds it per attempt,
which also sidesteps `worker-configuration.d.ts` putting Cloudflare's own
generic `Request` in the global scope of a browser module.

**No hook carries a credential any more.** The cookie is same-origin and the
browser attaches it itself, so `useOpenPulls`, `usePullDetails`,
`useSubmitReview`, `useReviewComments`, `useReviewPatch` and `useDiffFileLoader`
each lost a `token` option, a dependency, and the chance of sending a stale one.
`RpcContext` on the client is gone with them.

`useGitHubSession` has no version counter either, and that is deliberate rather
than an omission. A sign-in leaves the site and comes back to a fresh document.
A sign-out calls `location.assign('/')` — the one moment when everything already
fetched under a credential should stop being on screen, rather than re-render a
private diff into an error panel. Neither press needs a hook told to re-run.

**The one redirect nobody asked for, and the gate that keeps it rare.** An older
build kept a reviewer's personal access token in browser storage under
`ghdiff-github-token`. Nothing sends it any more, so it authenticates nothing —
and honouring it for a release was the other plan and is wrong: the header beats
the cookie in `resolveGitHubToken`, so a browser still sending an old token
would go on using it after the reviewer had signed in, with no way to tell whose
account their comments carried.

So `useGitHubSession` deletes it. Not quietly, though, and this is the part
worth getting right: **deleting it from storage revokes nothing.** That token is
live at GitHub for whatever is left of the ninety days the old form asked for,
and a reviewer who is never told it was there will leave it valid. Wording that
called it cleared, revoked or safe would read as "the credential is dead" and
produce exactly that outcome. So the first load after this change sends them to
`/setup?migrated=true`, and `MigrationNotice` says the token is gone from this
browser **and** that GitHub still accepts it, with a link to
`personalAccessTokensUrl()`. Naming GitHub as the one that still accepts it is
what shuts the wrong reading down — "it has been removed" alone invites "so it
is dealt with".

A notice on that page rather than a dialog over it. The page exists to explain
this, so a modal would have to be dismissed before any of the three steps could
be read — and it would take the revoke link with it, which is the one thing in
there to act on.

The gate is `heldLegacyToken` in `src/lib/legacyToken.ts` and nothing else,
because ghdiff works signed out and an anonymous visitor pulled off the diff
they asked for is a plain regression. Four readings, one of which moves:

| The browser              | The key                                                             | What happens       |
| ------------------------ | ------------------------------------------------------------------- | ------------------ |
| never set a token        | absent                                                              | nothing            |
| set one, then cleared it | absent — the old `writeStoredString(key, null)` called `removeItem` | nothing            |
| set one and left it      | present                                                             | one redirect, ever |
| refuses storage          | unreadable, and the read throws                                     | nothing            |

An empty value is checked for as well, though nothing ever wrote one: the cost
is one condition and the failure it prevents is a navigation nobody asked for.
The key is deleted **before** the navigation, so a reviewer who presses back
arrives at a browser with nothing left to migrate. `legacyToken.test.ts` is what
holds all of that, and it is the anonymous rows it is really about.

**Nothing signs in except `/setup`.** The home page row, the header control and
the failure panel are all plain links to that page; `session.signIn()` has one
caller left, which is step one of the page itself.

That is one press more than going straight to GitHub, and it is the trade this
app wants. Signing in is only the first of two things GitHub needs, and a
control that jumped to GitHub left the second to be discovered later as a 404 —
the exact confusion `/setup` exists to remove. It is also why none of those
three says **Sign in with GitHub** any more: a button promising a redirect it
does not make is a small lie, so each says where it goes.

**The account popup manages accounts, not just the account.** A GitHub App keeps
two facts apart: who a reviewer signed in as, which decides whose name their
comments carry, and which accounts ghdiff is installed on, which decides what it
can read at all. `GitHubAccountPanel` shows both — the identity, then every
installation with its reach and a **Configure** link to GitHub's own settings
for it, then a way to add another, then **Sign out**. A panel that showed only
the first would answer the less useful of the two questions, and a reviewer
would have to leave the diff to answer the other.

It is only ever opened by somebody already signed in; both entries to it are
drawn from the viewer, and a signed-out reviewer gets a link to `/setup`
instead.

`active` is not decoration. The Radix menu it sits in is unmounted while closed,
so being rendered there is the same fact as being on screen — but `Dialog` is
the platform's `<dialog>` and keeps its children mounted either way, so the home
page's copy would spend two GitHub requests on every visit, opened or not. The
menu passes `active`, the dialog passes its own `open`.

Which row belongs to the diff on screen is read off the path by
`useCurrentAccount`, the way the left bar reads the pull request it marks —
nothing hands it down, and it is right over a review, the home page and a 404
alike. `useCurrentPull` answers only for pull requests; this one answers for any
target, because a commit and a compare range have owners too.

`InstallationRow` is shared with `/setup` and takes its wrapper's classes from
the caller. The page puts these on cards down a wide column and the popup puts
them bare in about 296px; everything inside is the same at both widths and the
box around them is not. Measured at 296px, a long organization name truncates
rather than pushing **Configure** off the row. The reach caption is allowed to
wrap to two lines there — "No repositories selected" is the line that explains a
404 nothing else explains, and clipping it to fit would hide the one thing the
row is for.

It names no permissions. GitHub's own consent screen names every one the App
asks for, it is the only authoritative statement of them, and a list here would
be free to drift from the registration it described. The registration is written
below instead.

A sign-in that fails has nowhere to draw a panel — the callback is a redirect —
so `authFailureUrl` puts the reason on the address as `ghdiff_auth`, the screen
reads it once and takes it back out with `replaceState`, and the line appears
under the home page's sign-in row or on the review screen's own notice strip.
`authFailureMessage` uses `Object.hasOwn` and not `in`: the value arrives in the
address bar where anybody can type one, and `in` walks the prototype chain, so
`?ghdiff_auth=toString` would otherwise put a function's source on screen as a
sentence.

**Comments belong to their target.** A GitHub pull request is the only target
with an upstream review thread, so only `supportsGitHubComments` targets post to
GitHub. Every other target keeps comments in browser storage, and the sidebar
says so.

Which means the rest of the comment surface has to ask the store rather than
assume GitHub. `CommentThreadCard` names GitHub in its delete confirmation only
when the comment is actually there — asking a reviewer to confirm deleting
something on GitHub that was never on GitHub is the wrong sentence in the one
place a wrong sentence costs the most. `CommentAuthorFilterBar` is not drawn at
all over a browser store: those threads are one reviewer's own notes and can
hold no bot, so two of its three segments could never do anything. The strip
stays behind it, because its height is what keeps that foot level with the left
bar's.

**A pull request's conversation leads the comment list.** Line threads were all
the list held, so a summary written above the lines, or a remark under the
description, could not be read here at all. `comments.conversation` reads
GitHub's two lists — `/issues/{n}/comments` and `/pulls/{n}/reviews` — and
`buildConversation` in `src/lib/pullConversation.ts` makes one timeline of them,
oldest first, the way github.com reads. A verdict with no words is an entry and
a remark with no words is not, for the same reason the dialog drops one: its
words are line comments, and those are threads in the diff already. The section
has no line to scroll to, so a press opens the whole body in place under its
fixed-height row. The People and Bots filter and its counts cover the section as
well. A commit and a compare range have no conversation, and
`usePullConversation` asks for nothing there.

**A browser-stored comment is a note to a coding agent, and that is the way out
of the browser.** A comment that only one browser can see used to be a dead end
— a reviewer read their own working tree, wrote a note on a line, closed the tab
and that was that. `src/lib/agentPrompt.ts` is the exit: the whole review as one
block of markdown, a `##` per file in diff order and a `###` per thread, each
note under the lines it is about, fenced and tagged from the path's own
extension. The copy button sits at the end of the sidebar's top row, which is
the slot that already holds one control per tab — the path search belongs to the
files tab and this belongs to the comments tab — and never in the footer strip,
where the author filter is already fighting for room on a pull request.

It is offered on every target that has comments and not on local diffs alone,
because handing a review to an agent is at least as useful when the notes are
somebody else's. Two things turn on the store rather than the host: a GitHub
thread is a conversation, so every message is named, and a browser thread is one
reviewer talking to themselves, where a name in front of each note is noise.

`commentLineText` in `commentLine.ts` is what finds the code, and it is the
sibling of `classifyCommentLineType` — the same walk over a hunk's blocks,
reading the index into `FileDiffMetadata.additionLines` rather than the block's
type. Two traps in there, both found by checking the walk against the file on
disk rather than by reading the types. `Hunk.additionLines` is a **count** of
`+` lines and `FileDiffMetadata.additionLines` is the **array of text**, and
this reads the second through the first's indices. And those strings carry the
line terminator the patch gave them, so quoting several back to back put a blank
line between every pair until `commentLineText` took it off. Verified against
`src/lib/reviewFilter.ts`: all 51 reachable addition lines equal to the working
tree, all 27 deletion lines equal to `git show HEAD:`.

`MAX_QUOTED_LINES` is 20, and a cap is right here where it is wrong for the
untracked list: the output is an agent's context window, and a drag across four
hundred lines would spend it on a quotation nobody reads. What is cut is counted
and said, so the `### lines 2-58` heading always names what the reviewer
selected while the fence says what it left out. A selection whose two ends sit
on opposite sides of a split diff has no one side to quote, so it falls back to
the line the annotation is anchored to — the line GitHub would file the comment
against.

The prompt is built on the press and never before: it walks every thread's hunks
for the lines it quotes, and a reviewer who never presses it pays nothing. It
reads the whole comment list and not the author-filtered one, because that
filter is about what is comfortable to read in the panel and says nothing about
which notes are worth acting on. `navigator.clipboard` can simply refuse, so the
button reports that where it reports success, rather than leaving a reviewer to
paste and find out.

**A note can be filed as an issue, and the comment left behind points at it.**
The composer's **Create issue** toggle, top right, sends the text to
`issues.create` instead of `comments.create`. The issue gets the text, a
permalink to the selected lines on a line of its own, and the review's own
address; the comment on the line then says `see #N`. GitHub cross-references
both mentions, so each end shows the other and nothing here has to remember the
pair. The card's link to the issue is held in memory and nowhere else — a reload
keeps `see #N` and drops the button, because finding the issue again would be a
search and the comment already names it.

The permalink is the part that has to be exact. GitHub embeds a snippet only for
a `blob` URL in the same repository, with a **full** sha and a `#L` anchor, and
a rendered document such as a README needs `?plain=1` as well —
`blobPermalinkUrl` in `src/lib/github/urls.ts` builds all of that. The browser
holds a pull request number, a short sha or a branch, so `resolveSideCommit` in
`src/lib/server/commentIssue.ts` asks: the head for the new side, and for the
old side the commit the diff was taken against — a commit's first parent, or the
merge base of a pull request or range, never `base.sha`, which stops being the
merge base the moment the base branch moves. A note on removed lines of a
renamed file links the old name, which is why `ReviewFileEntry` carries
`previousPath`.

The toggle is offered on the three GitHub targets and only with a viewer, and
the App registration has to grant **Issues**. Without it GitHub answers 403
"Resource not accessible by integration", which names nothing, so the router
replaces that sentence with one that names the permission. A failed issue leaves
the typed text on the line, marked failed, the way a failed comment does.

**A file the reviewer has read is marked in its own header, and GitHub keeps
that mark.** `markFileAsViewed` and `unmarkFileAsViewed` are the two mutations,
`PullRequestChangedFile.viewerViewedState` reads it back, and all three are
GraphQL only — REST answers with the patch and the counts and says nothing about
who has read what. So a mark made here is the same mark github.com's own
**Viewed** box draws, and a reviewer can start in one and finish in the other.
The mark divides by target the way a comment does: a pull request's goes
upstream, and a commit's or a compare range's stays in this browser, because
GitHub holds no such state for either. Those two records never merge — a browser
mark is about a diff GitHub is not tracking, and the pull request's is GitHub's
own — so `useViewedFiles` reads one store and writes the same one.

`viewedFiles.list` is what fills the boxes on arrival, and it needs a token,
since the mark is the token's own user's. A caller with no token gets an empty
list rather than an error, the way `reviews.mine` gets no review, and its press
then fails with the sentence `requireToken` writes. A read that fails is
reported nowhere: an unread mark and no mark draw the same empty box, and a
press still lands, because `viewedFiles.set` names the file by its path alone.
That is also why the router resolves the pull request's node id itself on every
press rather than have the browser hold it — a browser that held it would have
nothing to send for a press that arrived before the list did.

`DISMISSED` is the third state and it counts as unread. GitHub writes it when a
file changed after the reviewer marked it, and GitHub's own screen takes the
tick off at that point: the mark was about lines that are no longer there.

The box is drawn and not an `<input type="checkbox">`, for the reason
`TaskMarker` draws its own: the browser paints a native one in the platform's
blue, which is the single colour this app never uses. It goes in
`renderHeaderMetadata`, which is the last child of the header's metadata row, so
it lands to the right of the file's own `-N +N` and takes that row's gap.

**Every GitHub request names itself.** `src/lib/server/github/client.ts` sends a
`user-agent` header on every call, to `api.github.com` and to the web diff host
alike. Node's `fetch` supplies one; workerd supplies none, and GitHub answers a
header-less request with 403 "Request forbidden by administrative rules". A new
call path that bypasses `headers()` gets that 403 and nothing else.

**One wide event per request, through a hand-rolled integration.** evlog ships
adapters for Next, Nitro, and Hono, but not for a TanStack Start server route,
so `src/lib/logger.ts` builds one from `defineFrameworkIntegration` in
`evlog/toolkit`. `withEvlog` wraps a handler and `requestLog()` reads the logger
out of an `AsyncLocalStorage`, which is why `nodejs_compat` is not optional. The
diff route streams, so `withEvlog` finishes through `finishResponse`, which
holds the emit until the body ends. A handler that skips `withEvlog` throws from
`requestLog()`.

## The GitHub App

Two registrations, production and dev, so a laptop never holds the production
secret. Each is registered with these **repository** permissions and no others.
Metadata is mandatory on any App and GitHub grants it without being asked.

| Permission      | Level          | What it is for                                       |
| --------------- | -------------- | ---------------------------------------------------- |
| Contents        | Read-only      | A commit or compare diff, and one file's whole text. |
| Pull requests   | Read and write | A pull request's diff, its comments, its reviews.    |
| Commit statuses | Read-only      | The check half of the status square.                 |
| Checks          | Read-only      | The other half of it, via `statusCheckRollup`.       |
| Issues          | Read and write | A note filed as an issue from the comment composer.  |
| Deployments     | Read-only      | The header's deployment menu.                        |

This table is the whole of what a sign-in grants, and nothing in the code
enforces it: a permission added at github.com and not added here is a permission
granted with nothing written about it. The interface names none of them, on
purpose — GitHub's consent screen is the authoritative statement, and a copy in
a component would be free to drift from this one too.

Two settings matter. **Request user authorization (OAuth) during installation**
is on, so one press installs and authorizes together rather than making the
reviewer do both. **User-to-server token expiration** is on, which is GitHub's
default and its recommendation, and it is why `/api/auth/refresh` exists at all
— turning it off would make GitHub answer with a token that states no life and
no refresh token beside it, and `accessExpiresAt` absent is exactly that case.

The callback URL is not configured here. `callbackUrl` derives it from the
origin the request arrived on, so one App registered with both addresses serves
ghdiff.com and a laptop alike and neither can be sent to the other's. Register
`https://ghdiff.com/api/auth/callback` on the production App and
`http://localhost:3000/api/auth/callback` on the dev one. GitHub compares the
value against its own list, so an unregistered origin fails at GitHub with a
sentence about the redirect URI rather than landing somewhere unexpected.

PKCE is sent even though the exchange also carries the client secret. The code
travels back through the reviewer's own browser and whatever sits in front of
it, and `code_verifier` is the half of the pair that never leaves the Worker —
so a code lifted out of a redirect, a log or a referrer cannot be spent by
whoever lifted it.
