# Scripted video evidence

Use the real component or route on the PR's current branch. A Storybook fixture
is suitable for component motion; label it as a fixture, and use the real route
for workflows it cannot prove. Keep the viewport focused on the changed controls
and their visible results.

## Record

Create a unique workspace for each capture with `mktemp -d`. Keep the scenario,
frames, clips, and PR body files inside it; never use shared fixed paths under
`/tmp`. Retain evidence until it has been reviewed or attached, then remove only
that run's directory.

Write a small scenario module with `setup(page)` and `run(page)` exports.
Inspect the page to choose selectors before recording. In `setup`, navigate,
arrange the initial state, and wait for fonts, images, and controls to be ready.
In `run`, execute only the relevant clicks, typing, hovering, or dragging, using
semantic locators and assertions on the resulting states.

Run the whole scenario in one process. Use short, deliberate pauses only when
needed to see the actual transition; never step through the recording with
separate agent tool calls. Keep real animation speed, preserve loading states
that are part of the change, and wait for the last action's visible result to
settle. Do not hide a slow application by speeding up video. If a run contains
unrelated actions or accidental waits, fix the script and record again.

The runner uses the checkout's existing Playwright dependency. From the
repository root:

```bash
capture_work=$(mktemp -d "${TMPDIR:-/tmp}/pr-evidence.XXXXXX")
# Write the scenario module to "$capture_work/scenario.mjs" before running it.
raw_video=$(pnpm exec node /absolute/path/to/pr-visual-evidence/scripts/record-interaction.mjs \
  "$capture_work/scenario.mjs" "$capture_work")
recording_dir=$(dirname "$raw_video")
```

The runner creates a random child directory on every invocation, even when
concurrent recordings share the same parent. The optional parent must already
exist; omitting it uses the system temp directory. On success, stdout contains
only the raw video path; send scenario logs to stderr. Both scenario functions
receive `{ outputDir }` as a second argument; use it for any screenshots or
other files created by the scenario. The runner reports the directory on stderr
before capture so failed recordings can also be inspected and cleaned up.

The scenario may export `viewport` (defaults to 960 × 540). Keep normal motion
enabled. The runner uses a visible browser by default; set `HEADLESS=1` for
automated environments. A hidden app pane can freeze animation. The raw
recording includes setup and safety margins; those are removed from the final
video. Keep the scenario with the local evidence so it can be rerun, and
identify the branch/commit and fixture or route in the handoff.

## Finish with exact idle boundaries

Normalize to 30 fps and inspect frames around the first action and the final
settled result:

```bash
ffmpeg -i "$raw_video" -vf fps=30 "$recording_dir/frame-%06d.png"
```

Frame indices for the helper are zero-based (PNG `frame-000001.png` is index 0).
Choose `--start-frame` as the **last still frame immediately before the first
relevant action** and `--end-frame` as the **first fully settled frame after the
last action's visible result**. Include pointer movement when it is part of the
interaction. Do not cut the transition tail. Do not include existing idle frames
inside these boundaries: the helper holds each boundary frame for exactly 30
frames, giving exactly 1 second idle on each side at 30 fps.

```bash
python3 /absolute/path/to/pr-visual-evidence/scripts/finish-video.py \
  "$raw_video" "$recording_dir/evidence.mp4" \
  --start-frame 90 --end-frame 210
```

The numbers above are placeholders; derive them from the actual recording. The
helper cannot infer which action is relevant or whether the final animation has
settled. It removes setup and teardown, preserves the middle at normal speed,
and encodes a silent H.264 MP4. Verify missing/incorrect boundaries by
inspecting frames; a one-second sleep in a script does not establish a
one-second boundary in the encoded video.

Watch the final MP4, including the start and end. Confirm all relevant actions
are visible, no unrelated activity remains, the final state is readable, and
both idle intervals are exactly 30 frames. Boundary stills plus 29 cloned frames
on each side avoid an extra idle frame.

## Attach

Keep the screenshot on line one. Place the video immediately below it with a
short caption describing the demonstrated interaction. Upload the MP4 as a
native GitHub attachment using the available attachment workflow, then fetch the
PR body and open the uploaded video to verify playback. Do not pass video to
`pr-attach-image.sh`, which manages the leading screenshot. If upload is
unavailable, return the local video and explicitly report the missing PR
attachment. Keep raw recordings, extracted frames, and temporary scenarios
outside the repository, and stop any servers started for capture.
