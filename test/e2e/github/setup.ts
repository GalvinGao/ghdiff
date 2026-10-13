// The GitHub leg's global setup: the shared preflight, then the fixture
// reset. Runs once per project, so the reset tolerates racing a sibling
// project's run.
import { assertAppReady } from '@test/e2e/lib/preflight';

import { resetFixture } from './helpers';

export default async function setup(): Promise<void> {
  await assertAppReady();
  await resetFixture();
}
