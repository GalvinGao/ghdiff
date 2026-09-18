import { createFileRoute } from '@tanstack/react-router';

// The liveness answer, for the probe a platform fires every few seconds. It
// depends on nothing but this server being up — no config, no credential, no
// forge or store call — so a dependency's outage cannot read as this process
// being down. It is also the one route with no request log: an event per
// probe is noise, and the handler never asks for one.
//
// `/healthz` claims a dead address: one colon-less segment parses as no
// target on either forge's grammar, the same reading `/setup` already holds.

const getHealth = (): Response =>
  new Response('ok', {
    headers: { 'cache-control': 'no-store', 'content-type': 'text/plain' },
  });

export const Route = createFileRoute('/healthz')({
  server: { handlers: { GET: getHealth } },
});
