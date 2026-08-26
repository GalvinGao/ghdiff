import { IconDownload } from '@pierre/icons';

import { buttonClass } from '@/components/ui/buttonClass';

/**
 * The userscript, offered from the page that teaches the host swap.
 *
 * The two lines above the form on the home page are the whole instruction:
 * write `ghdiff` where `github` is. This is that instruction, already carried
 * out — a button in github.com's own chrome, in the pull request tab bar and in
 * the commit header. So it sits directly under the form, as the answer to
 * "and if I would rather not type it".
 *
 * The copy names both places, because a reviewer deciding whether to install
 * this is deciding whether it covers the pages they read. It names where the
 * button lands rather than which pages are matched: `Files changed` and
 * `Browse files` are two controls they can already picture.
 */

/** Served from `public/`, so `@downloadURL` in the script itself agrees. */
export const USERSCRIPT_PATH = '/ghdiff.user.js';

/**
 * The manager this names, out of the several that would do. Pressing Install
 * with no manager installed downloads a file the browser can do nothing with,
 * so the line above the button says what has to be there first, and links to
 * the one page that installs it for whichever browser is reading.
 */
const TAMPERMONKEY_URL = 'https://www.tampermonkey.net/';

export function UserscriptInstall() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-ink text-sm">Add a ghdiff button to github.com</p>
        <p className="text-ink-muted mt-0.5 text-xs">
          This adds a button next to Files changed on a pull request, and next
          to Browse files on a commit. It requires a userscript manager such as{' '}
          <a
            className="text-accent underline underline-offset-2"
            href={TAMPERMONKEY_URL}
            rel="noreferrer"
            target="_blank"
          >
            Tampermonkey
          </a>
          .
        </p>
      </div>
      {/* A plain anchor and not a Link. The userscript manager reads the
            response to this request, and a client-side navigation never makes
            one. */}
      <a className={buttonClass({ size: 'md' })} href={USERSCRIPT_PATH}>
        Install
        <IconDownload size={14} />
      </a>
    </div>
  );
}
