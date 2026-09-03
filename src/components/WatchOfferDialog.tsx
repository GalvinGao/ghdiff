import { useEffect, useState } from 'react';

import { useAppData } from '@/components/AppDataProvider';
import { PullStatusMark } from '@/components/PullStatusMark';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { usePreference, watchOfferPreference } from '@/hooks/preferences';
import { useIsPhone } from '@/hooks/useIsPhone';
import { describePullStatus, type PullReviewStatus } from '@/lib/pullStatus';

// The one time this app asks for something instead of waiting to be told.
//
// A reviewer who watches nothing gets no left bar — `PullRail` renders nothing
// rather than stand an empty column beside a diff — so the feature that makes
// ghdiff a place to stay rather than a page to visit is invisible to exactly
// the reviewer who has not found it yet. The home page has the editor in the
// open for them, and a reviewer who arrived from the userscript button has not
// seen the home page. So the offer comes to them, once, on the repository they
// are already reading.
//
// Three things keep it from being a nag.
//
// It is asked once per browser and never again. `watchOfferPreference` records
// that the offer happened, not what the reviewer answered, so Not now is final
// and emptying the list later does not bring the question back.
//
// It waits for the diff. `ready` is `patch.state === 'ready'`, which is the
// screen the reviewer came for. A diff that would not load draws
// `ReviewStatusPanel` — a failure with a fix in it, and usually the 404 that
// sends them to `/setup` — and a modal over that is a question stacked on a
// problem. It also spends the one offer on a repository they can actually read.
//
// And it names the repository it is about. The reviewer is one press from the
// answer, and the press says what it will do.
/**
 * What the bar is for, drawn rather than described.
 *
 * The offer asks a reviewer to take a step on the strength of a sentence, and
 * the sentence has to name a thing they have never seen. So the window shows
 * it: the square is the whole point of the bar — the review on the left half
 * and the checks on the right — and three of them say the three answers a
 * reviewer scans that column for. Approved and green. Somebody asked for
 * changes and a check failed. Nobody has looked yet and the checks are still
 * running.
 *
 * Five rows and not three, because the bar is a list and a list of exactly
 * three would read as all there is. The first and the last fade, which is what
 * says the column goes on past the window.
 *
 * The square is drawn far larger here than the 13px the real bar gives it, and
 * the words beside it stay small. In the bar the square is a mark on a row of
 * text; here it is the subject, and a mark at label size would read as a bullet
 * point in front of a list of sentences. This is the one place in the app that
 * enlarges it, and nothing about the bar's own figures follows from these.
 *
 * No panel behind it, and the block is centred rather than set against the left
 * margin. A bordered box would read as a control the reviewer could press, and
 * this is a picture. Every word in it is `describePullStatus`, the same
 * function that names the square for a screen reader on every row of the real
 * bar, so the advertisement cannot come to promise a state the app does not
 * paint.
 *
 * `aria-hidden`, because it is an illustration of the paragraph above it. Each
 * mark carries a `title` and a `role="img"` of its own, and five of those read
 * out in a row is noise in front of the two buttons.
 */
const PREVIEW_ROWS: PullReviewStatus[] = [
  // Faded, and deliberately not the row under it. Two rows reading the same
  // words is a repeat rather than a list going on.
  { check: 'failure', review: 'none' },
  { check: 'success', review: 'approved' },
  { check: 'failure', review: 'changes' },
  { check: 'pending', review: 'none' },
  // Faded.
  { check: 'pending', review: 'approved' },
];

/** The mark's own coordinate space, which is the size it was drawn for. */
const PREVIEW_MARK_SIZE = 30;

// Five rows, so a fifth and four fifths of the height are where the first row
// ends and the last one begins. That is the whole of "fade one, three solid,
// fade one". `#000` is opaque and `transparent` is not, and a mask reads the
// alpha and never the colour, so this one figure serves both colour schemes.
const PREVIEW_FADE =
  'linear-gradient(to bottom, transparent, #000 20%, #000 80%, transparent)';

function WatchOfferPreview() {
  return (
    <div
      aria-hidden
      className="my-4 flex justify-center"
      style={{ maskImage: PREVIEW_FADE, WebkitMaskImage: PREVIEW_FADE }}
    >
      {/* `w-fit`, so the block is as wide as its widest row and the squares
          line up in one column inside it. Centring the rows themselves would
          put every square on a different pixel. */}
      <div className="flex w-fit flex-col gap-2.5">
        {PREVIEW_ROWS.map((status, index) => (
          <div
            // The list is a fixed illustration, so the index is its own
            // identity: no row of it is ever added, removed or reordered.
            key={index}
            className="flex items-center gap-2.5"
          >
            <PullStatusMark size={PREVIEW_MARK_SIZE} status={status} />
            <span className="text-ink-muted text-xs">
              {describePullStatus(status)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Where the pull requests turn up, which is not one place.
 *
 * `PullRail` is `max-phone:hidden` and `PullListButton` stands in for it, so
 * "the bar on the left" is false on the one screen that has no bar — a phone
 * opens the same list from the leftmost control in the review header. Both
 * readings sit here rather than at the sentences that need them, because the
 * offer names the place twice and two copies would drift.
 */
const WHERE_PULLS_ARE = {
  phone: 'the pull request list at the top left',
  wide: 'the bar on the left',
};

/** What the window is about, which is what its title is written from. */
interface OfferState {
  added: boolean;
  subject?: string;
}

/**
 * The title, for both states and for the window nobody has opened.
 *
 * `Dialog` keeps its children mounted whether it is open or not, so the closed
 * window needs a title that is not the word `undefined`. Nobody reads that
 * one: the reviewer has not been offered anything yet.
 */
function dialogTitle({ added, subject }: OfferState): string {
  if (subject == null) return 'Watch this repository?';
  return added ? `${subject} is now watched` : `Watch ${subject}?`;
}

export function WatchOfferDialog({
  owner,
  ready,
  repo,
}: {
  owner: string;
  /** True once the diff is on screen. Nothing is asked before that. */
  ready: boolean;
  repo: string;
}) {
  const { watched } = useAppData();
  // Which sentence the offer tells. `useIsPhone` is a media query and no
  // request, so a second caller of it costs nothing.
  const isPhone = useIsPhone();
  const where = isPhone ? WHERE_PULLS_ARE.phone : WHERE_PULLS_ARE.wide;
  const {
    hydrated: offerHydrated,
    setValue: setOffered,
    value: offered,
  } = usePreference(watchOfferPreference);
  // The repository this window is about, latched as it opens, and the whole of
  // whether it is open. Every condition that opened it stops holding the moment
  // the reviewer presses Watch — the list is no longer empty — and the window
  // still has an answer to give after that press.
  const [subject, setSubject] = useState<string | undefined>(undefined);
  const [added, setAdded] = useState(false);
  // Destructured, so nothing reads a property of the state object while this
  // component renders.
  const { hydrated: watchedHydrated, repos } = watched;

  useEffect(() => {
    if (!ready) return;
    // Both settings are read after mount, and an unread one is not an empty
    // one: without these two tests every reviewer is asked for the one paint
    // before storage answers.
    if (!offerHydrated || offered) return;
    if (!watchedHydrated || repos.length > 0) return;
    setSubject(`${owner}/${repo}`);
    // Written as the offer is made and not as it is answered. A reviewer who
    // closes the window, reloads the page, or never comes back has been asked,
    // and this is the write that says so.
    setOffered(true);
  }, [
    offerHydrated,
    offered,
    owner,
    ready,
    repo,
    repos.length,
    setOffered,
    watchedHydrated,
  ]);

  const state: OfferState = { added, subject };
  const close = () => setSubject(undefined);

  return (
    <Dialog onClose={close} open={subject != null} title={dialogTitle(state)}>
      {added ? (
        <>
          <p className="text-ink-muted text-sm">
            Its open pull requests are now in {where}.
          </p>
          {/* The way back to the editor is in the same two places the list is,
              so this sentence follows the screen as well: on a phone the
              button sits at the foot of that list rather than at the foot of
              a bar that is not drawn. */}
          <p className="text-ink-faint mt-2 text-xs">
            To watch more repositories,{' '}
            {isPhone ? (
              <>
                open that list and use{' '}
                <span className="text-ink font-medium">Watched repos</span>, or
                go
              </>
            ) : (
              <>
                use <span className="text-ink font-medium">Watched repos</span>{' '}
                at the bottom of the bar or go
              </>
            )}{' '}
            to the ghdiff home page.
          </p>
          <div className="mt-4 flex justify-end">
            <Button size="md" variant="solid" onClick={close}>
              Keep reviewing
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-ink-muted text-sm">
            See its open pull requests in {where}, each with its review and its
            checks. Move between them without returning to GitHub.
          </p>
          <WatchOfferPreview />
          <p className="text-ink-faint text-xs">
            Your watch list stays in this browser.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button size="md" variant="outline" onClick={close}>
              Not now
            </Button>
            {/* The label carries a repository name, and a name is as long as
                its owner made it. `shrink` undoes the `shrink-0` every button
                in this app carries — tailwind-merge resolves the pair — so a
                long one truncates here rather than widen the row past the
                dialog. A dialog scrolls vertically, and a box with
                `overflow-y: auto` takes an `overflow-x` of `auto` whether it
                asked for one or not, so the overflow would arrive as a
                scrollbar across the whole window. Nothing is lost to the clip:
                the title above carries the same name, and it wraps. */}
            <Button
              className="min-w-0 shrink"
              size="md"
              variant="solid"
              onClick={() => {
                // The two names came out of the path, which validated them
                // against the same characters `parseWatchedRepo` accepts, so
                // this cannot refuse. If it ever did, the window stays on the
                // question, which is the true answer.
                if (subject != null && watched.add(subject)) setAdded(true);
              }}
            >
              <span className="truncate">Watch {subject}</span>
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
