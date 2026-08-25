import { createFileRoute, redirect } from '@tanstack/react-router';

// The old shape of a review URL. `/gh` is no longer a prefix anybody has to
// type, and the root splat reads the same path, so this route keeps every link
// already written and sends it one step to the right of the prefix.
export const Route = createFileRoute('/gh/$')({
  loader: ({ params }) => {
    const splat = params._splat ?? '';
    if (splat.length === 0) {
      throw redirect({ to: '/', replace: true });
    }
    throw redirect({ to: '/$', params: { _splat: splat }, replace: true });
  },
});
