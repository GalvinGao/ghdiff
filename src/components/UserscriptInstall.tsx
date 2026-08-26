import { IconDownload } from '@pierre/icons';

import { buttonClass } from '@/components/ui/buttonClass';

/**
 * The userscript, offered from the page that teaches the host swap.
 *
 * The two lines above the form on the home page are the whole instruction:
 * write `ghdiff` where `github` is. This is that instruction, already carried
 * out — a button in github.com's own pull request tab bar, on the conversation
 * and on the diff alike. So it sits directly under the form, as the answer to
 * "and if I would rather not type it".
 *
 * The address is on screen because a userscript manager takes one: a reviewer
 * whose browser has no manager yet cannot press Install, and reads it instead.
 */

/** Served from `public/`, so `@downloadURL` in the script itself agrees. */
export const USERSCRIPT_PATH = '/ghdiff.user.js';

export function UserscriptInstall() {
  return (
    <>
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-ink text-sm">A ghdiff button on github.com</p>
          <p className="text-ink-muted mt-0.5 text-xs">
            In the pull request tab bar, beside Files changed. Tampermonkey or
            Violentmonkey runs it.
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
      <div className="border-line border-t px-4 py-2">
        <code className="text-ink-faint font-mono text-xs">
          ghdiff.com{USERSCRIPT_PATH}
        </code>
      </div>
    </>
  );
}
