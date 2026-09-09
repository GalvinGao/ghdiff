# Capturing the screenshot

Use the first option that shows the change honestly. Render the real component,
use deterministic fixtures, crop to the subject, and caption each panel.

## Storybook

From the repository root:

```bash
pnpm storybook                         # http://localhost:6006
pnpm storybook --port 6017              # another worktree or concurrent capture
pnpm storybook:build                    # static output in storybook-static/
pnpm exec playwright install chromium  # once per machine
pnpm storybook:shot                     # pull status states, light scheme
pnpm storybook:shot ui-dialog--open dark
```

`STORYBOOK_URL=http://localhost:6017` points capture commands at another server.
The screenshot command prints a PNG path in a unique temporary directory. Its
viewport is 960 × 540 at 2× pixel density. Crop tighter for a small subject.

Story IDs are listed in `/index.json`. Render without Storybook chrome at
`/iframe.html?id=<id>&viewMode=story&globals=theme%3Alight`. The toolbar offers
the same light/dark schemes as the app. Stories import the app's stylesheet, but
run without Worker bindings, GitHub requests, or sign-in. Add story-specific
providers and fixture data when a component needs them.

A story's `play` function runs on load. Prefer a static story for screenshots
and an interaction story driven by a scenario for videos, avoiding competing
actions.

## Dev server

Use `pnpm dev` for full routes, real data, or authentication-dependent behavior
that a fixture cannot prove. Check the terminal for the actual origin and port.
Use the app's normal sign-in flow for private data; never embed tokens in
fixtures.

## Before/after

Compose two labeled panels into one image. A wrapper page may embed bare-story
iframes, but use absolute URLs so they resolve against the Storybook server.
Keep the wrapper in the run's temporary directory, outside production assets.
Match the wrapper and iframe backgrounds, use the same viewport and scheme for
both states, and crop away unrelated content. Preserve enough context to make
clear what changed. Use an element screenshot when the target bounds are enough;
use the viewport when a dialog, backdrop, or portaled control is the subject.

See [VIDEO.md](VIDEO.md) for scripted motion capture and exact idle boundaries.
