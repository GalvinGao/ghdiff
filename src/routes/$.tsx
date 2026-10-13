import { IconCiWarningFill, IconRefresh } from '@pierre/icons';
import {
  createFileRoute,
  Link,
  notFound,
  redirect,
  useNavigate,
} from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';

import { ReviewScreen } from '@/components/ReviewScreen';
import { Button } from '@/components/ui/Button';
import { buttonClass } from '@/components/ui/buttonClass';
import type { FailureMeta } from '@/lib/failure';
import { type FailedResolve, resolveHostlessPath } from '@/lib/resolveHost';
import { classifyRouteSegments, reviewTargetKey } from '@/lib/reviewTarget';
import { m } from '@/paraglide/messages.js';

// Mirrors the forges' own paths at the root of the site, so a pull request or
// merge request URL becomes a ghdiff URL by swapping the host and nothing
// else. The splat holds the whole path, already percent-decoded by the
// router. The canonical form glues the forge host to the first segment with
// a colon; hostless paths are entry points — a GitHub-shaped one redirects
// trivially (one GitHub host today), and a bare GitLab one renders a resolve
// marker: the browser asks `/api/resolve` which configured host holds the
// project and navigates to the canonical address itself, so the answer passes
// through `fetchWithRefresh` — a spent grant is refreshed and the resolve
// retried, where a document redirect dead-ended on a text/plain 401.
//
// Every static route in the app — `/` and each `/api/...` handler — outranks
// this one, so the splat only sees a path nothing else claimed. A path that
// is not a target on a forge is a 404 rather than an empty review.
//
// The loader runs on the server for document requests and in the browser for
// navigations, so it stays client-safe: no server imports (they would leak
// into the client bundle) and no fetch of this same origin (workerd cannot
// fetch its own zone). Classification is pure — `classifyRouteSegments`.
export const Route = createFileRoute('/$')({
  loader: ({ params }) => {
    const parsed = classifyRouteSegments(params._splat?.split('/') ?? []);
    switch (parsed.kind) {
      case 'target':
        return parsed.target;
      case 'redirect':
        throw redirect({
          to: '/$',
          params: { _splat: parsed.splat },
          statusCode: parsed.status,
        });
      case 'resolve':
        // A marker for the browser to act on, not a redirect: `/api/resolve`
        // is a server route with no place in the router's tree, and a
        // document hop to it could never carry the session's refresh.
        return { kind: 'resolve' as const, splat: parsed.splat };
      case 'none':
        throw notFound();
    }
  },
  component: ReviewRoute,
});

// Keyed by the target, because every piece of state on that screen belongs to
// one diff: the pull request's details, the reviewer's verdict, the filter,
// the folds. A move to the next pull request reuses this route, and without a
// key the header went on naming the last one until the forge answered for the
// new one — and an async completion still in flight from the last one would
// write itself into this one.
function ReviewRoute() {
  const data = Route.useLoaderData();
  if (data.kind === 'resolve') {
    return <ResolveMarker splat={data.splat} />;
  }
  return <ReviewScreen key={reviewTargetKey(data)} target={data} />;
}

/**
 * What a bare GitLab path shows while its host is found, and what it says
 * when no host answers. The resolving is `resolveHostlessPath`'s — this is
 * only its two faces. The fragment the address arrived with rides the
 * navigation, so a link to a file and lines lands on them once the host is
 * known.
 */
function ResolveMarker({ splat }: { splat: string }) {
  const navigate = useNavigate();
  const [failure, setFailure] = useState<FailedResolve | null>(null);

  const resolve = useCallback(async () => {
    setFailure(null);
    const outcome = await resolveHostlessPath({
      hash: window.location.hash.replace(/^#/, ''),
      navigate,
      path: splat,
    });
    // On the win the router navigates to the canonical address and this
    // component unmounts; there is nothing left to report here.
    if (outcome.kind === 'failed') setFailure(outcome);
  }, [navigate, splat]);

  useEffect(() => {
    void resolve();
  }, [resolve]);

  if (failure != null) {
    return (
      <ResolveFailure
        failure={failure}
        onRetry={() => void resolve()}
        splat={splat}
      />
    );
  }
  return (
    <main className="bg-surface flex flex-1 items-center justify-center p-8">
      <section
        aria-busy="true"
        aria-live="polite"
        role="status"
        className="max-w-md text-center"
      >
        <IconRefresh
          aria-hidden="true"
          className="text-ink-faint mx-auto mb-3 -scale-x-100 animate-spin [animation-direction:reverse] [animation-duration:1.2s] motion-reduce:animate-none"
          size={20}
        />
        <h1 className="text-ink text-sm font-medium">
          {m.route_finding_the_gitlab_host()}
        </h1>
        <p className="text-ink-muted mt-1 text-sm text-pretty">
          {m.route_asking_each_gitlab_host()}
        </p>
      </section>
    </main>
  );
}

/** The title the failure face leads with, by the typed reason when there is one. */
function resolveFailureTitle(failure: FailureMeta | null): string {
  switch (failure?.reason) {
    case 'auth-expired':
      return m.route_your_sign_in_is_no_longer_valid();
    case 'bad-request':
      return m.route_that_address_is_not_a_gitlab_one();
    case 'not-found':
      return m.route_no_gitlab_host_shows_that_project();
    case 'not-served':
      return m.route_this_ghdiff_serves_no_gitlab_hosts();
    default:
      return m.route_could_not_open_that_address();
  }
}

/** What the marker says when the resolve came back a failure. */
function ResolveFailure({
  failure,
  onRetry,
  splat,
}: {
  failure: FailedResolve;
  onRetry(): void;
  splat: string;
}) {
  return (
    <main className="bg-surface flex flex-1 items-center justify-center p-8">
      <section aria-live="polite" role="alert" className="max-w-md text-center">
        <IconCiWarningFill
          aria-hidden="true"
          className="text-removed mx-auto mb-3"
          size={20}
        />
        <h1 className="text-ink text-sm font-medium">
          {resolveFailureTitle(failure.failure)}
        </h1>
        <p className="text-ink-muted mt-1 text-sm text-pretty">
          {failure.message}
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          {/* A spent grant the refresh could not mend: the fix is the setup
              page, and `from` leads its last step back to this address. */}
          {failure.failure?.reason === 'auth-expired' && (
            <Link
              className={buttonClass({ variant: 'solid' })}
              search={{
                account: undefined,
                from: `/${splat}`,
                migrated: undefined,
              }}
              to="/setup"
            >
              {m.route_set_up_access()}
            </Link>
          )}
          <Button onClick={onRetry} variant="outline">
            {m.review_status_panel_try_again()}
          </Button>
        </div>
      </section>
    </main>
  );
}
