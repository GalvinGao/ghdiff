import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function compareReports(base, head) {
  assert.equal(base.schema, 1, 'unsupported report schema');
  assert.equal(base.schema, head.schema, 'report schema differs');
  assert.deepEqual(
    base.environment,
    head.environment,
    'compare on the same runner/toolchain'
  );
  assert.deepEqual(base.fixtures, head.fixtures, 'fixture manifest differs');
  assert.equal(base.state, head.state, 'measurement state differs');
  assert.ok(base.results.length > 0, 'no measurements');
  assert.equal(base.results.length, head.results.length, 'phase count differs');
  const previous = new Map(
    base.results.map((metric) => [`${metric.fixture}/${metric.phase}`, metric])
  );
  assert.equal(previous.size, base.results.length, 'duplicate base metric');
  const seen = new Set();
  return head.results.map((metric) => {
    const id = `${metric.fixture}/${metric.phase}`;
    assert.ok(!seen.has(id), `duplicate head metric ${id}`);
    seen.add(id);
    const old = previous.get(id);
    assert.ok(old != null, `missing base phase ${id}`);
    assert.ok(Number.isFinite(old.medianMs) && old.medianMs >= 0);
    assert.ok(Number.isFinite(metric.medianMs) && metric.medianMs >= 0);
    assert.ok(
      Number.isFinite(old.budget.allowanceMs) && old.budget.allowanceMs >= 0
    );
    assert.ok(Number.isFinite(old.budget.relative) && old.budget.relative >= 0);
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
  assert.equal(
    process.argv.length,
    4,
    'usage: compare.mjs base.json head.json'
  );
  const [base, head] = await Promise.all(
    process.argv
      .slice(2)
      .map(async (path) => JSON.parse(await readFile(path, 'utf8')))
  );
  const compared = compareReports(base, head);
  console.table(compared);
  if (compared.some((metric) => metric.failed)) process.exitCode = 1;
}
