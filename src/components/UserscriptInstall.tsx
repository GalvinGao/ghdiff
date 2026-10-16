import { ParaglideMessage } from '@inlang/paraglide-js-react';
import { IconDownload } from '@pierre/icons';
import type { ReactNode } from 'react';

import { useAppData } from '@/components/AppDataProvider';
import { buttonClass } from '@/components/ui/buttonClass';
import { gitLabHostNames } from '@/lib/forges';
import { formatList } from '@/lib/locale';
import { m } from '@/paraglide/messages.js';

const managerMarkup = {
  manager: ({ children }: { children?: ReactNode }) => (
    <a
      className="text-accent underline underline-offset-2"
      href={TAMPERMONKEY_URL}
      rel="noreferrer"
      target="_blank"
    >
      {children}
    </a>
  ),
};

/**
 * The userscript, offered from the page that teaches the host swap.
 *
 * The two lines above the form on the home page are the whole instruction:
 * write this deployment's host where the forge's is. This is that instruction,
 * already carried out — a button in the forge's own chrome, in the review's
 * tab bar and in the commit header. So it sits directly under the form, as the
 * answer to "and if I would rather not type it".
 *
 * The copy names the places the button lands, because a reviewer deciding
 * whether to install this is deciding whether it covers the pages they read:
 * `Files changed` and `Changes` and `Browse files` are controls they can
 * already picture. Which of them are named comes from what this deployment
 * serves — an offer that named a forge it has no route for would be one this
 * script could not keep.
 */

/** Served by the route of the same name, so `@downloadURL` in the script agrees. */
export const USERSCRIPT_PATH = '/ghdiff.user.js';

/**
 * The manager this names, out of the several that would do. Pressing Install
 * with no manager installed downloads a file the browser can do nothing with,
 * so the line above the button says what has to be there first, and links to
 * the one page that installs it for whichever browser is reading.
 */
const TAMPERMONKEY_URL = 'https://www.tampermonkey.net/';

export function UserscriptInstall() {
  const { instance } = useAppData();
  const githubServed = instance.github.served;
  const gitlabHosts = gitLabHostNames(instance);
  const hosts = [...(githubServed ? ['github.com'] : []), ...gitlabHosts];

  return (
    <div className="max-phone:flex-col max-phone:items-start flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-ink text-sm">
          {m.userscript_install_add_a_ghdiff_button_to_hosts({
            hosts: formatList(hosts),
          })}
        </p>
        <p className="text-ink-muted mt-0.5 text-xs">
          <ParaglideMessage
            message={
              githubServed && gitlabHosts.length > 0
                ? m.userscript_manager_description_both
                : githubServed
                  ? m.userscript_manager_description
                  : m.userscript_manager_description_gitlab
            }
            markup={managerMarkup}
          />
        </p>
      </div>
      {/* A plain anchor and not a Link. The userscript manager reads the
            response to this request, and a client-side navigation never makes
            one. */}
      <a className={buttonClass({ size: 'md' })} href={USERSCRIPT_PATH}>
        {m.userscript_install_install()}
        <IconDownload size={14} />
      </a>
    </div>
  );
}
