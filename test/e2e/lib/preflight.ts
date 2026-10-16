// The preflight both e2e legs share: the app must answer, and it must not
// answer anonymous calls as a signed-in viewer — the GITHUB_TOKEN fallback
// would defeat the anonymous-path tests.
import { ORIGIN, rpc, type ViewerGetAnswer } from './client';

export async function assertAppReady(): Promise<void> {
  const health = await fetch(`${ORIGIN}/healthz`).catch(() => null);
  if (!health?.ok) {
    throw new Error(
      `ghdiff is not answering on ${ORIGIN} — start the server first.`
    );
  }
  const anon = await rpc<ViewerGetAnswer>('viewer/get', {});
  if (anon.json?.viewer != null) {
    throw new Error(
      `${ORIGIN} answers anonymous calls as a signed-in viewer — restart the server without GITHUB_TOKEN for the e2e run.`
    );
  }
}
