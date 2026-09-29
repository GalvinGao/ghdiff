import { IconCiWarningFill, IconRefresh } from '@pierre/icons';
import type { ErrorComponentProps } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { m } from '../paraglide/messages.js';
import { Button } from '@/components/ui/Button';
import { claimModuleReload, isModuleLoadError } from '@/lib/moduleRecovery';

/** Eagerly loaded with the router, so a missing route chunk cannot hide recovery. */
export function RouteError({ error }: ErrorComponentProps) {
  const [stopped, setStopped] = useState(false);

  useEffect(() => {
    if (!isModuleLoadError(error)) return;
    const frame = requestAnimationFrame(() => {
      try {
        if (claimModuleReload(window.sessionStorage)) {
          window.location.reload();
          return;
        }
      } catch {
        // Accessing sessionStorage itself can throw in restricted browsers.
      }
      setStopped(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [error]);

  const moduleFailure = isModuleLoadError(error);
  const refreshing = moduleFailure && !stopped;
  const Icon = refreshing ? IconRefresh : IconCiWarningFill;

  return (
    <main className="bg-surface flex flex-1 items-center justify-center p-8">
      <section
        className="max-w-sm text-center"
        role={refreshing ? 'status' : 'alert'}
        aria-live="polite"
      >
        <Icon
          aria-hidden="true"
          size={20}
          className={`text-ink-faint mx-auto mb-4 ${refreshing ? 'animate-spin motion-reduce:animate-none' : ''}`}
        />
        <h1 className="text-ink text-base font-medium">
          {refreshing
            ? m.route_error_refreshing_ghdiff()
            : moduleFailure
              ? m.route_error_the_page_could_not_load()
              : m.route_error_something_interrupted_this_page()}
        </h1>
        <p className="text-ink-muted mt-2 text-sm text-pretty">
          {refreshing
            ? m.route_refresh_version()
            : moduleFailure
              ? m.route_error_an_update_or_connection_problem_may_be_preventing_this()
              : m.route_error_refresh_the_page_to_try_again_your_review_url()}
        </p>
        <Button
          className="mt-5"
          variant="solid"
          onClick={() => window.location.reload()}
        >
          {m.route_error_refresh_page()}
        </Button>
      </section>
    </main>
  );
}
