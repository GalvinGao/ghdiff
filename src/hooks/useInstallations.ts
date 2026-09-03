import { useCallback, useEffect, useRef, useState } from 'react';

import type { AppInstallation } from '@/lib/installations';
import { rpc, rpcErrorMessage } from '@/lib/rpc/client';

export interface InstallationsState {
  installations: readonly AppInstallation[];
  /** Where to install ghdiff, when this deployment has an App to install. */
  installUrl?: string;
  loading: boolean;
  error?: string;
  /** Asks GitHub again, for the reviewer who has just installed it. */
  reload(): void;
}

/**
 * Where ghdiff is installed, for the setup page and nothing else.
 *
 * It is not in `AppDataProvider` on purpose. Every hook that lives up there runs
 * for the whole session on every page, and this one answers a question only one
 * screen asks — two GitHub requests per reviewer who never opens that screen
 * would be two requests spent on nothing.
 *
 * `reload` is the point of the page. A reviewer installs ghdiff in another tab
 * and comes back to this one, and the step that was waiting for them has to be
 * able to notice. Nothing polls: the reviewer presses.
 *
 * One `load`, called from the effect and from `reload` alike, with the abort in a
 * ref — the shape `useReviewPatch` already uses. A counter in the dependency
 * array would do the same job and read as a dependency that means nothing.
 */
export function useInstallations(options: {
  ready: boolean;
}): InstallationsState {
  const { ready } = options;
  const [installations, setInstallations] = useState<
    readonly AppInstallation[]
  >([]);
  const [installUrl, setInstallUrl] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!ready) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);

    try {
      const result = await rpc.installations.list(undefined, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setInstallations(result.installations);
      setInstallUrl(result.installUrl);
      setError(undefined);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(
        rpcErrorMessage(cause, 'Could not read where ghdiff is installed.')
      );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [ready]);

  useEffect(() => {
    void load();
    return () => controllerRef.current?.abort();
  }, [load]);

  return { installations, installUrl, loading, error, reload: load };
}
