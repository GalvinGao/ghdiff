// The browser tab's favicon for a review: the app's own runner emoji, clipped
// to give the right side to two marks — the kind of diff at the top, the head
// commit's checks at the bottom — each glyph drawn bare, as large as its
// ground holds.
//
// The top mark says what the tab holds — a pull request or merge request, a
// commit, or a compare range — in the app's one accent colour, and it is
// always there: the kind is known from the URL, no forge answer needed. It
// has a fourth state: a draft pull request takes the draft octicon. The state
// is the glyph's shape alone — the mark's colour never changes, so a tab
// reads as ghdiff's before it reads as anything else.
//
// The bottom mark is the checks, in the watch list's colours so a colour
// means the same thing in the tab strip and beside a row: a green check when
// they pass, a red cross when they fail, and a solid amber dot while they
// run. That is github.com's own vocabulary for a pull request's favicon — a
// bare green check, a bare red cross, and a solid yellow dot
// (github.githubassets.com/favicons/favicon-{success,failure,pending}.svg).
// The mark keeps those colours on a draft too: the pipeline's answer is true
// whatever the change is called. And when the checks were never asked about
// — an anonymous read, a failed one — the mark stays off entirely rather
// than claim an answer, the same contract `PullSummary.status` keeps in the
// list.
//
// The clip is the legibility answer: a mark drawn over the busy emoji reads
// as noise at tab size, so the emoji gives ground instead — as much as the
// marks need and no more. Each glyph carries only a thin halo in the accent
// ink under its fill, because a bare near-white mark vanishes on a light tab
// strip and a bare near-black one on a dark.
//
// The glyphs are Primer octicons — `GitPullRequest`, `GitPullRequestDraft`,
// `GitCommit`, `GitCompare`, `Check`, `X` — their 16-grid path data inlined
// from `@primer/octicons` because a favicon is a string, not a component.

import type { CheckState } from './pullStatus';
import type { ReviewTabType } from './reviewTarget';

/** The hexes the hook reads off the document's CSS tokens, per scheme. */
export interface ReviewFaviconColors {
  accent: string;
  /** The halo's stroke: white in the light scheme, black in the dark one. */
  accentInk: string;
  success: string;
  pending: string;
  failure: string;
}

export interface ReviewFaviconInput {
  type: ReviewTabType;
  /** True when the merge request is a draft: the type glyph takes its fourth state. */
  draft?: boolean;
  /** The head commit's checks. Absent or `'none'` paints no status mark. */
  check?: CheckState;
  colors: ReviewFaviconColors;
}

const TYPE_PATH: Record<ReviewTabType, string> = {
  pull: 'M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z',
  commit:
    'M11.93 8.5a4.002 4.002 0 0 1-7.86 0H.75a.75.75 0 0 1 0-1.5h3.32a4.002 4.002 0 0 1 7.86 0h3.32a.75.75 0 0 1 0 1.5Zm-1.43-.75a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z',
  compare:
    'M9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM6 12v-1.646a.25.25 0 0 1 .427-.177l2.396 2.396a.25.25 0 0 1 0 .354l-2.396 2.396A.25.25 0 0 1 6 15.146V13.5H5A2.5 2.5 0 0 1 2.5 11V5.372a2.25 2.25 0 1 1 1.5 0V11a1 1 0 0 0 1 1ZM4 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0ZM12.75 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z',
};

/** The draft pull request, the type mark's fourth state. */
const DRAFT_PULL_PATH =
  'M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 14a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM14 7.5a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Zm0-4.25a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Z';

const STATUS_PATH = {
  success:
    'M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z',
  failure:
    'M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z',
} as const;

// The geometry, on the emoji favicon's own 100×100 box. The emoji keeps the
// left half; each glyph is the octicon's 16 grid scaled to 44 — as large as
// the right half holds — centred in its quadrant. The pending dot is the
// solid circle a running check gets on github.com, and the one mark with no
// halo: amber reads on either chrome, and github.com draws it bare too.
const EMOJI_CLIP = 50;
const GLYPH = 44;
const SCALE = GLYPH / 16;
const HALO_WIDTH = 1.5;
const DOT_R = 15;
const CENTER_X = 75;
const TOP = 25;
const BOTTOM = 75;

function glyph(cy: number, fill: string, halo: string, path: string): string {
  const offset = GLYPH / 2;
  return `<path transform="translate(${CENTER_X - offset} ${cy - offset}) scale(${SCALE})" fill="${fill}" stroke="${halo}" stroke-width="${HALO_WIDTH}" paint-order="stroke" d="${path}"/>`;
}

/** The favicon as a `data:` URL, ready to hand to `link[rel="icon"]`. */
export function reviewFaviconDataUri(input: ReviewFaviconInput): string {
  const { colors } = input;
  const status = input.check;
  const hasStatus =
    status === 'success' || status === 'failure' || status === 'pending';
  // The emoji exactly as the root route's static favicon draws it, clipped
  // rather than covered: a cover would read as the untouched runner beside
  // the marks, a clip as ground given up. The clip is only as wide as what
  // sits on it — the whole right half while there are two marks, just the
  // top quarter when the type mark stands alone, so a commit or a compare
  // keeps three quarters of the runner.
  const clip = hasStatus
    ? `<rect x="0" y="0" width="${EMOJI_CLIP}" height="100"/>`
    : `<path d="M0 0H${EMOJI_CLIP}V${EMOJI_CLIP}H100V100H0Z"/>`;
  let svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    `<defs><clipPath id="emoji-clip">${clip}</clipPath></defs>` +
    '<g clip-path="url(#emoji-clip)">' +
    '<text y=".9em" font-size="90">🏃‍♀️</text>' +
    '</g>';
  const draftPull = input.draft === true && input.type === 'pull';
  svg += glyph(
    TOP,
    colors.accent,
    colors.accentInk,
    draftPull ? DRAFT_PULL_PATH : TYPE_PATH[input.type]
  );
  if (hasStatus) {
    svg +=
      status === 'pending'
        ? `<circle cx="${CENTER_X}" cy="${BOTTOM}" r="${DOT_R}" fill="${colors.pending}"/>`
        : glyph(BOTTOM, colors[status], colors.accentInk, STATUS_PATH[status]);
  }
  svg += '</svg>';
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
