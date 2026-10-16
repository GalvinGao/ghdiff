# The design system

How the app looks and speaks: the accent, tooltips, dialogs and their heights,
skeletons, fonts, the colour scheme, and the copy style.

**A control that is only a glyph says what it is.**
`src/components/ui/Tooltip.tsx` is CSS and no JavaScript, the way `Dialog` is
the platform's own `<dialog>`: the browser already tracks hover and focus, and a
library for them would be a dependency in a Worker graph with about 130 KiB left
in it. The delay belongs to the shown state alone — half a second before it
appears, and gone the moment the pointer leaves, because a tooltip that lingers
stands in front of the next press. The label is `aria-hidden` and the control
keeps its `aria-label`, or a screen reader says it twice, and the control loses
its `title`, or the browser draws a second tooltip beside this one.

**A row on a card hovers to `surface`, not to `raised`.** A card is `raised`
itself, so `hover:bg-raised` on a row inside one is the colour already under it
and nothing happens — which is what the examples list did for as long as it had
a hover. `surface` is the pair the `outline` button already uses for this. The
two tones are eight values apart, the whole distance this app keeps between a
card and the page, so a row that has more than a background to give should give
it: `ExampleTargets` lifts its size figures from `ink-faint` to `ink-muted` with
the same hover.

**The accent is ink, not a hue.** `--app-accent` is near-black in the light
scheme and near-white in the dark one, and `--app-accent-ink` is its opposite,
so the one filled control on a screen is the app's only colour and every other
colour on screen belongs to the diff. That is also why `--app-accent-hover`
exists: a `brightness` filter moves near-black and near-white by nothing, so the
`solid` variant in `src/components/ui/buttonClass.ts` names a second tone
instead. A link inside a comment body is `text-accent` and reads as body text;
its underline is what marks it.

`/setup` is the screen that tests this rule hardest: three steps, each with an
action of its own. Only the step that is actually next takes `solid`, and the
other two take `outline` — two filled controls on one screen was the first thing
a measurement of that page caught.

**The code font is a choice; the interface font is not.** A review is almost
entirely code, so `--app-font-mono` is the one typeface worth offering — it sets
the diff's own lines, the paths in the tree and the comment list, and every sha
on screen. `src/lib/codeFonts.ts` holds the choices and their whole stacks, and
`useCodeFont` applies one by setting that property on the document element,
which is the same element `:root` matches, so the inline value wins over the
stylesheet's default. `--app-font-mono-system` is the platform's own mono, and
every stack ends in it: a face that fails to download still leaves a monospace
behind it, and the system stack is written once. The control is a radio group in
the review header's display menu, where each row is drawn in the face it names,
because what a typeface looks like is the whole of what the choice is about.

**The diff has to be told, because it draws in a shadow root.** `@pierre/diffs`
reads `--diffs-font-family` and falls back to a stack of its own that happens to
be the same one, so changing `--app-font-mono` alone moved the chrome and left
the code as it was. `:root` in `src/globals.css` now points both of the
library's properties at the app's two, which carries the reviewer's choice into
the code and leaves one statement of each face rather than two free to drift.

**Every face the selector offers advances 0.6em, and that is load-bearing.** The
viewer measures the width of `0` once — `Metrics.init()` returns early on every
call after the first, and its `document.fonts.ready` re-measure is a one-shot —
so a face picked mid-review lays the diff out against the figure taken from the
face before it. SF Mono, JetBrains Mono, Geist Mono and Fira Code all measure
7.80px at 13px, which is why a switch needs no remount and why wrap points,
selection rectangles and the horizontal extent all stay correct. Verified on
ghostty-org/ghostty v1.3.0...v1.3.1, split and unified, wrapped and scrolled: no
element overflowed. **A candidate whose advance is not 0.6em cannot simply be
added to `CODE_FONTS`** — it needs the `CodeView` remounted on the change, and a
remount costs the reviewer their scroll position.

**Those three faces cost bytes only when one is picked.** Each is a fontsource
**variable** package, so one file covers the weight range shiki and the chrome
both draw from; a static package would cost a download per weight. `globals.css`
imports all three statically, which is a couple of kilobytes of `@font-face`
rules split by `unicode-range` and not one byte of woff2 until a face is chosen
— the browser fetches a subset only when it has a character to draw with it. A
face picked mid-review fetches exactly one file, the 40 KB latin subset. Lazily
importing a stylesheet per press was the other answer and it loses: it arrives
after the diff has already measured itself. None of it reaches the Worker, which
is built from the modules and never from this stylesheet.

**And the first paint has to be the chosen face, not just the chosen colour.**
`CodeFontScript` sits beside `ColorModeScript` in the document head for a reason
the colour scheme does not have: the measurement above is taken from whatever is
on screen when the viewer initializes, so a face applied after mount is a layout
computed against the wrong one. The script and the hook both read their stacks
out of `codeFonts.ts`, so they cannot come to disagree about what a choice
means.

**The colour scheme arrives from the press, and not as a new frame.** A theme
swap is every pixel on screen changing at once, which reads as the page
reloading. `src/lib/colorSchemeWipe.ts` puts it inside a same-document view
transition instead: the outgoing scheme is held still as the
`::view-transition-old(root)` snapshot while the incoming one is revealed above
it by a feathered circle growing from the pointer, so the two schemes never
cross-fade as two flat pages. `--scheme-wipe-radius` is a registered property,
because a plain custom property is not animatable and the mask reads it — the
whole reveal is that one length growing, and every other figure in it is stated
once in `src/globals.css` under the `data-scheme-wipe` marker. The marker is
what scopes it: those pseudo-elements belong to the document rather than to a
component, so a navigation that is view-transitioned later must not inherit a
theme wipe. The circle has to reach the viewport corner farthest from the press,
or that corner never changes scheme, and the radius decelerates because the area
it covers grows with the square — a linear one reads as acceleration.

The wipe is `useColorMode`'s and not the control's, and `flushSync` inside it is
load-bearing. A view transition captures the page the moment the update callback
returns, and the scheme reaches two props by render — the tree's own scheme and
the viewer's `themeType` — so without the flush the code and the file list would
be captured in the old scheme and pop into place once the wipe had finished.
That callback writes `data-color-scheme` itself for the same reason, rather than
leave it to the effect that ordinarily maintains it; the effect then writes the
same value a second time, which changes nothing. And resolving a mode to a
scheme needs the platform's own answer, which the hook already holds: the
control knows which mode it is asking for and cannot know whether that changes
anything on screen.

Three presses get no wipe, and each of them is a press that would pay for one
and get nothing. A browser with no view transitions — Firefox ships none — and a
reviewer who asks for reduced motion both apply the mode instantly. So does
picking Light while Auto already resolves to light: the stored choice changes
and the screen does not, and half a second of blocked rendering between two
identical frames is the one cost with no reveal to show for it. Two generation
counters carry the rest, because a press can supersede a wipe without starting
one: `latestRequest` decides which press may still write the mode, and
`latestWipe` owns the marker and the three lengths. One counter cannot do both
jobs — an instant press would revoke the running wipe's claim on the cleanup and
leave all four stranded on the document element.

**Copy on screen is spoken, not written.** Every line a reviewer reads — the
error panels, the empty states, the account panel, the buttons, the server's own
failures — says the likely cause and the next step and then stops. The comments
in this repository are composed prose and stay that way; the interface is not. A
reviewer meets a message when something has gone wrong, or when they do not yet
know what to do, and a sentence they have to parse twice costs them more than it
tells them. `agy -p` wrote the current wording against that brief — every line
of `/setup`, the four failure panels, the four sign-in failures in
`github/app.ts`, the reach captions in `installations.ts`, and the three
entry-point labels. Write a new message the same way, not in the register of the
code around it.

Which is why no test asserts a whole sentence. `reviewFailure.test.ts` and
`installations.test.ts` check the decision — which button appears, that zero is
not a plural, that a signed-in reviewer is never told to sign in again — and
match the message only against the fragment that carries its meaning. A test
that pinned the prose would fail on every copy pass and would have said nothing
about whether the panel offers the right thing.

**A modal is the platform's `dialog`.** `src/components/ui/Dialog.tsx` drives
`showModal()` from React state, which brings the focus trap, Escape, the inert
background, and the top layer, so a dialog opened from inside a portaled menu is
not clipped and needs no z-index. Tailwind's preflight zeroes the margin on
every element and on `::backdrop`, so the centering (`m-auto`) and the backdrop
colour are set explicitly.

**What `showModal()` does not bring is a landing place.** It focuses the first
focusable thing it finds, and in every dialog here that is the close button in
the title bar — so the browser arrived with Enter bound to shutting the window
the reviewer had just opened. Two things outrank it, in order: the first field,
because a dialog with one is a dialog you came to type in, and then the control
the dialog names with `dialogPrimaryAction`.

That naming is the caller's and cannot be inferred, which is the whole reason
for the attribute. Reading it off the accent — this app draws one filled control
per screen — is right for the watch-list offer and wrong twice over:
`ReviewSubmitDialog` offers three verdicts and GitHub gives none of them a
default, and the account dialog's one button is **Sign out**. A rule that
guessed would bind Enter to signing the reviewer out. So a dialog with no
obvious default names nothing and keeps the close button, which is the right
answer for a window that is only there to be read.

**And every dialog travels between its content heights.** A dialog is centred by
`m-auto`, so a jump moves all four edges at once and reads as a second window
arriving in place of the first — the offer going from its question to its
answer, a row leaving the watch list, a list of pull requests landing where a
skeleton was. `Dialog` wraps its body in `AnimatedHeight` for all of them, and
the sticky title bar stays outside that box: the height being measured is the
body's.

One `AnimatedHeight` inside another is the ordinary case now, because
`GitHubAccountPanel` keeps its own around the installations alone — the identity
line above it and **Sign out** below it should not move for an answer that
arrives between them. The inner box owns the travel. The outer would otherwise
chase it, since a ResizeObserver reports the inner height on every frame of its
transition and the outer would restart its own each time, easing an ease. So a
box with an animating descendant drops its transition and follows frame by
frame, which is `has-[[data-animating]]` — `:has()` looks at descendants and
never at self, so the attribute a box sets on itself does not turn its own
travel off. It is the division `PullRail` already makes for a drag: the gesture
writes the figure and the transition stands aside.

**A skeleton is a guess at the answer's own shape, and the account panel guesses
three.** The identity at the top of `GitHubAccountPanel` is on screen the moment
the panel is, because the session already holds it; everything under the rule is
a request to GitHub, and that region is the one that waits. It used to wait as
one line of text — **Checking GitHub accounts…** — which is the wrong length for
every answer that follows it, so the panel jumped twice: once to the list and
once again as the reviewer read it. `InstallationsSkeleton` draws the answer's
shape instead: the two static lines of copy printed for real, three row
placeholders, and the install control reserved.

Three, because three is the shape this panel most often takes — a reviewer
reading it is signed in, so their own account is installed, and the
organizations they review for are the rest. A reviewer installed on three pays
nothing at all for the guess: the region is already the height it needs, no
transition runs, and every row lands on the pixel the placeholder was on.
Measured, in the dialog and at the popup's 296px alike: a real row and a
skeleton row are both 48px, and the whole region is 216.5px either way.

That equality is a shared structure and not two sets of matching figures.
`InstallationRow` and `InstallationRowSkeleton` sit in one file and share
`ROW_CLASS`, `NAME_CLASS` and `REACH_CLASS`, because a skeleton whose numbers
were copied would drift from the row it stands in for — and the drift is exactly
the layout shift it exists to prevent. Each bar is an `inline-block` inside the
row's own paragraph rather than a block in place of it, so the paragraph keeps
the line box its sentence would have had: `0.75em` tall, `align-middle`, and
20px and 16px of paragraph whichever it is.

`answered` on `InstallationsState` is what chooses between the two. Empty
`installations` means "GitHub has not answered" before the first answer and
"installed nowhere" after it, and those are the two most different sentences in
this panel — one is a wait and the other is the state that explains every 404.
`loading` cannot stand in for it: it is false for the first paint of a panel
that has not asked yet, which is how the "isn't installed on any account" line
used to flash. It stays true through a `reload`, so a re-check keeps the list it
is re-checking on screen.

**A box whose content changes travels to its new height.** Three of the four
answers above are not 216.5px — one account, five, none, or a failure — so
`src/components/ui/AnimatedHeight.tsx` carries the region between them over
200ms rather than snapping the dialog to a new size. `height: auto` is not an
interpolable value, so CSS holds the timing here and never the two figures: a
`ResizeObserver` measures the content and writes the px height onto the box, and
React is told nothing, the way `useEdgeFade` and `usePaneWidth` write onto their
own nodes.

Four things in that are load-bearing. The **first** write needs no special case:
it replaces `auto`, which a transition cannot start from, so a box arrives at
the height of its first content in one frame. The box **clips only while a
height is in flight** — a box shorter than its content is the whole of what a
reveal is, and a permanent clip would cut the `focus-visible` ring off the last
control in the panel, which is drawn outside its own box. A measurement of a box
that is **not being displayed is thrown away**: `display: none` reports zero
here, a closed `<dialog>` keeps its children mounted, and a pane hidden on a
phone is hidden rather than unmounted — so without that test the region animated
up from nothing on every open. And the clip has a **timer behind the
`transitionend`**, because a transition that never runs never reports one.

The easing is the pop-in curve and not the left bar's. `RAIL_TRANSITION_EASING`
crests past 1, which on a width is a spring and on a clipping height is a strip
of empty box opening below the content it is revealing.
