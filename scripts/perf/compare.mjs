import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function compareReports(base, head) {
  assert.equal(base.schema, head.schema, 'report schema differs');
  assert.deepEqual(
    base.environment,
    head.environment,
    'compare on the same runner/toolchain'
  );
  assert.deepEqual(base.fixtures, head.fixtures, 'fixture manifest differs');
  assert.equal(base.results.length, head.results.length, 'phase count differs');
  const previous = new Map(
    base.results.map((metric) => [`${metric.fixture}/${metric.phase}`, metric])
  );
  return head.results.map((metric) => {
    const id = `${metric.fixture}/${metric.phase}`;
    const old = previous.get(id);
    assert.ok(old != null, `missing base phase ${id}`);
    assert.ok(Number.isFinite(old.medianMs) && old.medianMs >= 0);
    assert.ok(Number.isFinite(metric.medianMs) && metric.medianMs >= 0);
    const deltaMs = metric.medianMs - old.medianMs;
    // Read policy from the base report, so a candidate cannot loosen its gate.
    const failed =
      deltaMs > old.budget.allowanceMs &&
      deltaMs > old.medianMs * old.budget.relative;
    return {
      id,
      baseMs: old.medianMs,
      headMs: metric.medianMs,
      deltaMs,
      failed,
    };
  });
}

if (
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [base, head] = await Promise.all(
    process.argv
      .slice(2)
      .map(async (path) => JSON.parse(await readFile(path, 'utf8')))
  );
  const compared = compareReports(base, head);
  console.table(compared);
  if (compared.some((metric) => metric.failed)) process.exitCode = 1;
}
