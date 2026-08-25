'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { readStoredString, writeStoredString } from '@/hooks/useLocalStorage';
import {
  LOCAL_HEAD_STAGED,
  LOCAL_HEAD_WORKTREE,
  reviewTargetHref,
} from '@/lib/reviewTarget';
import { LAST_LOCAL_REPO_STORAGE_KEY } from '@/lib/storageKeys';

interface LocalRepoInfo {
  repoPath: string;
  currentBranch: string;
  defaultBase: string;
  branches: string[];
  hasStagedChanges: boolean;
  hasWorktreeChanges: boolean;
}

interface RepoResponse {
  enabled: boolean;
  root: string;
  info?: LocalRepoInfo;
  error?: string;
}

/**
 * Reads a real repository before it offers refs, so the reviewer picks from
 * branches that exist instead of typing a ref that git will reject.
 */
export function LocalRepoForm() {
  const router = useRouter();
  const [repoPath, setRepoPath] = useState('');
  const [response, setResponse] = useState<RepoResponse | undefined>(undefined);
  const [checking, setChecking] = useState(false);
  const [base, setBase] = useState('');
  const [head, setHead] = useState(LOCAL_HEAD_WORKTREE);

  useEffect(() => {
    const stored = readStoredString(LAST_LOCAL_REPO_STORAGE_KEY);
    if (stored != null) setRepoPath(stored);
  }, []);

  // Read the environment once so the form can say whether local review is on.
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const result = await fetch('/api/local/repo', {
          cache: 'no-store',
          signal: controller.signal,
        });
        setResponse((await result.json()) as RepoResponse);
      } catch {
        // The panel below reports the failure once the user reads a repo.
      }
    };
    void load();
    return () => controller.abort();
  }, []);

  const inspect = useCallback(async () => {
    if (repoPath.trim().length === 0) return;
    setChecking(true);
    try {
      const result = await fetch(
        `/api/local/repo?repo=${encodeURIComponent(repoPath.trim())}`,
        { cache: 'no-store' }
      );
      const body = (await result.json()) as RepoResponse;
      setResponse(body);
      if (body.info != null) {
        setBase(body.info.defaultBase);
        writeStoredString(LAST_LOCAL_REPO_STORAGE_KEY, repoPath.trim());
      }
    } catch {
      setResponse({
        enabled: true,
        root: '',
        error: 'Could not reach the server.',
      });
    } finally {
      setChecking(false);
    }
  }, [repoPath]);

  const info = response?.info;
  const enabled = response?.enabled ?? true;

  return (
    <section>
      <h2 className="text-ink-faint text-[11px] font-semibold tracking-wide uppercase">
        Local git
      </h2>

      {!enabled ? (
        <p className="text-ink-muted mt-2 text-sm">
          Local git review is off on this server. Set{' '}
          <code>REVIEWER_LOCAL_GIT=on</code> to turn it on.
        </p>
      ) : (
        <>
          <form
            className="mt-1 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void inspect();
            }}
          >
            <Input
              value={repoPath}
              placeholder="~/repos/owner/repo"
              onChange={(event) => setRepoPath(event.target.value)}
            />
            <Button
              type="submit"
              variant="outline"
              size="md"
              disabled={checking}
            >
              {checking ? 'Reading…' : 'Read repo'}
            </Button>
          </form>
          {response?.root != null && response.root.length > 0 && (
            <p className="text-ink-faint mt-1 text-xs">
              Repositories must sit under {response.root}.
            </p>
          )}
          {response?.error != null && (
            <p className="text-removed mt-2 text-xs">{response.error}</p>
          )}

          {info != null && (
            <form
              className="mt-4 flex flex-wrap items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                router.push(
                  reviewTargetHref({
                    kind: 'local',
                    repoPath: info.repoPath,
                    base,
                    head,
                  })
                );
              }}
            >
              <label className="flex flex-col gap-1">
                <span className="text-ink-faint text-xs">Base</span>
                <select
                  value={base}
                  onChange={(event) => setBase(event.target.value)}
                  className="border-line bg-raised text-ink h-8 rounded-md border px-2 text-sm"
                >
                  {info.branches.map((branch) => (
                    <option key={branch} value={branch}>
                      {branch}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-ink-faint text-xs">Head</span>
                <select
                  value={head}
                  onChange={(event) => setHead(event.target.value)}
                  className="border-line bg-raised text-ink h-8 rounded-md border px-2 text-sm"
                >
                  <option value={LOCAL_HEAD_WORKTREE}>
                    working tree{info.hasWorktreeChanges ? '' : ' (clean)'}
                  </option>
                  <option value={LOCAL_HEAD_STAGED}>
                    index{info.hasStagedChanges ? '' : ' (empty)'}
                  </option>
                  {info.branches.map((branch) => (
                    <option key={branch} value={branch}>
                      {branch}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" variant="solid" size="md">
                Open
              </Button>
              <p className="text-ink-faint w-full text-xs">
                On {info.repoPath}, currently on {info.currentBranch}. Comments
                on a local range stay in this browser.
              </p>
            </form>
          )}
        </>
      )}
    </section>
  );
}
