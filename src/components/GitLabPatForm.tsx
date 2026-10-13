import { ParaglideMessage } from '@inlang/paraglide-js-react';
import { type ReactNode, useMemo, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { dialogPrimaryAction } from '@/components/ui/Dialog';
import { gitLabPatSettingsUrl } from '@/lib/gitlab/urls';
import { rpcErrorMessage } from '@/lib/rpc/client';
import { m } from '@/paraglide/messages.js';

/** The scope a token needs, set as code the way GitLab's own form names it. */
function patCode({ children }: { children?: ReactNode }) {
  return <code>{children}</code>;
}

/** The sentence's markup, with the scope as code and the instance's settings page as the link. */
function patMarkup(host: string) {
  return {
    code: patCode,
    link: ({ children }: { children?: ReactNode }) => (
      <a
        className="text-accent underline underline-offset-2"
        href={gitLabPatSettingsUrl(host)}
        rel="noreferrer"
        target="_blank"
      >
        {children}
      </a>
    ),
  };
}

/**
 * The personal access token way into a GitLab instance, shared by the connect
 * dialog and the GitLab setup page. A token is the universal path: every
 * instance makes those by hand, and the field is the whole of what the form
 * asks for. It is proved against the instance before it is sealed, so a bad
 * one is answered with the instance's own sentence here and not discovered
 * diff by diff.
 *
 * A successful connect reloads the page. The diff that would not load is the
 * whole reason to connect, the session re-reads on the way up, and the
 * fragment in the address bar restores the file and lines the reviewer was
 * on — the same trade a sign-in makes when it leaves the site and comes back.
 */
export function GitLabPatForm({
  connectVariant = 'solid',
  host,
  onCancel,
}: {
  /**
   * What the Connect button wears. Solid is the step's one filled control;
   * the setup page drops it to outline when an OAuth button above already
   * carries the accent, since one screen gets one filled control.
   */
  connectVariant?: 'outline' | 'solid';
  /** The instance the token belongs to, lowercased. */
  host: string;
  /** The dialog's way out. Absent on the setup page, which cancels nothing. */
  onCancel?(): void;
}) {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const normalizedHost = host.trim().toLowerCase();
  const markup = useMemo(() => patMarkup(normalizedHost), [normalizedHost]);

  const connect = async () => {
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch('/api/auth/gitlab/pat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ host: normalizedHost, token }),
      });
      if (!response.ok) {
        setError(
          rpcErrorMessage(
            new Error(await response.text()),
            m.gitlab_pat_could_not_connect_that_account()
          )
        );
        return;
      }
      // The diff is the reason to connect; reload so it is asked again with
      // the grant in the cookie, fragment and all.
      window.location.reload();
    } catch {
      setError(m.gitlab_pat_could_not_reach_this_ghdiff());
    } finally {
      setPending(false);
    }
  };

  const canConnect = normalizedHost.length > 0 && !pending;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void connect();
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink-muted">
          {m.gitlab_pat_personal_access_token()}
        </span>
        <input
          autoComplete="off"
          className="border-line bg-surface text-ink rounded-md border px-2 py-1.5 font-mono text-sm"
          onChange={(event) => setToken(event.target.value)}
          placeholder="glpat-…"
          required
          type="password"
          value={token}
        />
        <span className="text-ink-faint text-xs">
          {normalizedHost.length > 0 ? (
            <ParaglideMessage
              message={m.gitlab_pat_create_one}
              markup={markup}
            />
          ) : (
            <ParaglideMessage
              message={m.gitlab_pat_create_one_no_link}
              markup={{ code: patCode }}
            />
          )}
        </span>
      </label>

      {error != null && (
        <p className="text-removed text-sm" role="alert">
          {error}
        </p>
      )}

      <div className="mt-1 flex justify-end gap-2">
        {onCancel != null && (
          <Button onClick={onCancel} variant="outline">
            {m.comment_composer_cancel()}
          </Button>
        )}
        <Button
          {...dialogPrimaryAction}
          disabled={!canConnect}
          type="submit"
          variant={connectVariant}
        >
          {pending ? m.gitlab_pat_connecting() : m.gitlab_pat_connect()}
        </Button>
      </div>
    </form>
  );
}
