import { createFileRoute } from '@tanstack/react-router';

import { SetupScreen } from '@/components/SetupScreen';

// The one page in this app that is not a diff and not the home page.
//
// It is a top-level route, which is the thing `/$` makes worth checking: the
// splat mirrors github.com's own paths, so every static route at the root takes a
// name a repository owner could have. `github.com/setup` **is** a real account —
// but ghdiff has no route for a user profile at all, and never did.
// `gitHubTargetFromSegments(['setup'])` answers with nothing, so `/setup` was a
// 404 before this file existed. It claims a dead address and shadows nothing a
// reviewer could have reached.
//
// Two search parameters, because two places send a reviewer here and they know
// different things. The review panel knows the path a diff would not load from,
// so it sends `from` — which also gives step three somewhere to go back to. The
// left bar knows only that a repository would not list, so it sends `account`.
// The screen reads the account out of `from` when only `from` came, so neither
// caller has to work out the other's answer.
//
// `migrated` is the third, and it is written by nothing a reviewer can press:
// `useGitHubSession` sets it on the one redirect it makes, when it finds a
// personal access token this browser was still holding from before the GitHub
// App. It only changes what the page says, never what it does.
//
// All three arrive as search parameters rather than being remembered, so the
// address is the whole state and this page can be sent to somebody else and
// still know which repository the question is about. `from` goes through
// `safeReturnTo` before anything is built from it, since it ends up in an
// `href`.

export const Route = createFileRoute('/setup')({
  validateSearch: (search: Record<string, unknown>) => ({
    from: typeof search.from === 'string' ? search.from : undefined,
    account: typeof search.account === 'string' ? search.account : undefined,
    // `true` or absent, never `false`. It is read from both the boolean the
    // router writes and the string a reload sends back, and a flag that is only
    // ever set keeps `migrated=false` out of the address bar.
    migrated:
      search.migrated === true || search.migrated === 'true'
        ? (true as const)
        : undefined,
  }),
  component: SetupRoute,
});

function SetupRoute() {
  const { account, from, migrated } = Route.useSearch();
  return <SetupScreen account={account} from={from} migrated={migrated} />;
}
