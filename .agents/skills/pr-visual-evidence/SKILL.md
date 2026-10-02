---
name: pr-visual-evidence
description:
  'Open or edit a pull request with a leading screenshot and scripted video
  evidence for animation, transitions, or multi-step interactions. Use for
  reviewer-visible frontend changes or requests for PR visual guidance,
  screenshots, before/after, or video evidence. Skip when the diff renders
  identically (backend, config, CI, tests, docs, tooling).'
---

# PR visual evidence

A PR that changes what someone sees opens with a picture of it. A PR that
doesn't gets no image. The test is what a reviewer would see, not the file
extension: a `messages/*.json` key changes on-screen copy, a Tailwind or theme
change touches every screen.

## Capture

Recipes and traps are in [CAPTURE.md](CAPTURE.md). Shoot the real component,
crop tight, caption each panel, use the app's default color scheme. A
before/after is one labeled image.

If the change involves animation, transitions, or a multi-step interaction, also
attach a video. Show only the relevant actions, with exactly 1 second idle
before the first action and exactly 1 second idle after the last action's
visible result has settled. Preserve the complete motion. Run the interaction in
one small automation script, not separate agent-driven browser calls: tool and
reasoning latency must never become pauses in the video. Follow
[VIDEO.md](VIDEO.md) for scripted recording, frame-accurate padding, and
verification.

## Attach

`gh` ≥ 2.99.0. Reference the shot as a **Markdown image** on line one of the
body and pass the same path to `--attach`; gh rewrites the reference to the
uploaded URL. An HTML `<img>` is not rewritten and the file gets appended to the
end instead.

```bash
pr_work=$(mktemp -d "${TMPDIR:-/tmp}/pr-evidence.XXXXXX")
# Save the screenshot as "$pr_work/pr-shot.png" and prose as "$pr_work/pr-prose.md".
printf '![Before/after of the changed component](%s)\n\n' "$pr_work/pr-shot.png" > "$pr_work/pr-body.md"
cat "$pr_work/pr-prose.md" >> "$pr_work/pr-body.md"
gh pr create --base main --title "..." \
  --body-file "$pr_work/pr-body.md" --attach "$pr_work/pr-shot.png"
```

Keep capture files and PR drafts in a unique directory per run. After verifying
the uploaded attachments, remove only that run's directory when its local
evidence is no longer needed.

Existing PR (re-running replaces the leading image):

```bash
.agents/skills/pr-visual-evidence/scripts/pr-attach-image.sh \
  --pr 526 --image ~/shots/pr-shot.png --alt "New x on the changed component"
```

Verify: `gh pr view N --json body --jq .body | head -1` shows a
`github.com/user-attachments/…` URL, not the local path.

## Before handing back

- The image is the first line of the description and shows the change.
- Motion, transitions, and multi-step changes also have a playable video near
  the screenshot. Watch the exported video and verify both one-second idle
  boundaries and the relevant actions.
- No stray `.png`, `.playwright-mcp/`, or temp page under `public/` left in the
  worktree.
- Dev servers started for the capture are stopped.
