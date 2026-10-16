import { useState } from 'react';

import { useAppData } from '@/components/AppDataProvider';
import { GitLabMark } from '@/components/GitLabMark';
import { GitLabPatForm } from '@/components/GitLabPatForm';
import { Button } from '@/components/ui/Button';
import { buttonClass } from '@/components/ui/buttonClass';
import { Dialog } from '@/components/ui/Dialog';
import { useGitLabOAuth } from '@/hooks/useGitLabOAuth';
import { isGitLabTarget } from '@/lib/forges';
import { type ReviewTarget } from '@/lib/reviewTarget';
import { gitLabAuthStartUrl } from '@/lib/session';
import { m } from '@/paraglide/messages.js';

/**
 * Connects a GitLab account, in the two ways there are.
 *
 * OAuth leads when the host has an application registered on this deployment —
 * one press and the instance's own consent screen does the rest, which is why
 * it is the recommended path. A personal access token is the universal one:
 * every instance makes those by hand, and the form it asks for is shared with
 * the setup page. The token is proved against the instance before it is
 * sealed, so a bad one is answered with the instance's own sentence here and
 * not discovered diff by diff.
 *
 * When both are on screen, OAuth is the one filled control and the token
 * form's Connect drops to outline, because one screen gets one filled control.
 *
 * The host is a choice, not a field: the configured hosts are the only ones a
 * connection can reach, and a free-text host was a typo away from a connection
 * proved against the right instance and refused by this one.
 *
 * A successful connect reloads the page. The diff that would not load is the
 * whole reason to connect, the session re-reads on the way up, and the
 * fragment in the address bar restores the file and lines the reviewer was
 * on — the same trade a sign-in makes when it leaves the site and comes back.
 *
 * Nothing renders while the dialog is closed. Opening one is always a press in
 * a browser, so the `window` read below only ever runs in one — a server that
 * rendered the closed dialog would have no `window` to read — and reading it
 * live is what carries the fragment into `returnTo`.
 */
export function GitLabConnectDialog({
  host: initialHost,
  onClose,
  open,
}: {
  /** The host to preselect, usually the target's own. */
  host?: string;
  onClose(): void;
  open: boolean;
}) {
  const { instance } = useAppData();
  const hosts = instance.gitlab.hosts;
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  // The select's answer: the reviewer's own choice, then the target's host,
  // then the first configured one.
  const host =
    [chosen, initialHost, hosts[0]?.host].find(
      (candidate) =>
        candidate != null && hosts.some((entry) => entry.host === candidate)
    ) ?? '';

  // Whether this host has an OAuth application here decides which path leads.
  const oauth = useGitLabOAuth(open && host.length > 0 ? host : undefined);
  if (!open) return null;
  const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;

  return (
    <Dialog
      onClose={onClose}
      open={open}
      title={m.gitlab_connect_connect_gitlab()}
    >
      {hosts.length === 0 ? (
        <p className="text-ink-muted text-sm">
          {m.gitlab_connect_this_ghdiff_serves_no_gitlab_hosts()}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {oauth === true && (
            <>
              <a
                className={buttonClass({
                  className: 'self-start',
                  variant: 'solid',
                })}
                href={gitLabAuthStartUrl(host, returnTo)}
              >
                <GitLabMark aria-hidden="true" size={14} />
                {m.gitlab_connect_sign_in_with_gitlab_recommended()}
              </a>
              <p className="text-ink-faint text-xs">
                {m.gitlab_connect_one_press_on_the_instances_own_consent()}
              </p>
            </>
          )}

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink-muted">
              {m.gitlab_connect_instance_host()}
            </span>
            <select
              className="border-line bg-surface text-ink rounded-md border px-2 py-1.5 font-mono text-sm"
              onChange={(event) => setChosen(event.target.value)}
              value={host}
            >
              {hosts.map((entry) => (
                <option key={entry.host} value={entry.host}>
                  {entry.host}
                </option>
              ))}
            </select>
          </label>

          <GitLabPatForm
            connectVariant={oauth === true ? 'outline' : 'solid'}
            host={host}
            onCancel={onClose}
          />
        </div>
      )}
    </Dialog>
  );
}

/**
 * The failure panel's connect button, with the dialog it opens. It lives here
 * so the panel's own markup stays one line.
 */
export function GitLabConnectButton({ target }: { target: ReviewTarget }) {
  const [open, setOpen] = useState(false);
  // Keyed by the target's host: the dialog's own selection is state, and a
  // dialog kept mounted across a target change would otherwise carry the
  // previous target's host — or the reviewer's last pick — into the next.
  const host = isGitLabTarget(target) ? target.host : undefined;
  return (
    <>
      <Button onClick={() => setOpen(true)} variant="solid">
        {m.gitlab_connect_connect_gitlab()}
      </Button>
      <GitLabConnectDialog
        host={host}
        key={host ?? 'no-host'}
        onClose={() => setOpen(false)}
        open={open}
      />
    </>
  );
}
