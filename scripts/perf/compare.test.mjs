import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareReports } from './compare.mjs';

const report = (medianMs) => ({
  schema: 1,
  environment: { node: 'same' },
  fixtures: [{ sha256: 'same' }],
  results: [
    {
      fixture: 'huge-file',
      phase: 'parse',
      medianMs,
      budget: { relative: 0.25, allowanceMs: 10 },
    },
  ],
});

test('requires both the relative and absolute regression allowances', () => {
  assert.equal(compareReports(report(100), report(124))[0].failed, false);
  assert.equal(compareReports(report(100), report(126))[0].failed, true);
  assert.equal(compareReports(report(1), report(5))[0].failed, false);
  assert.equal(compareReports(report(100), report(50))[0].failed, false);
});
test('injected slowdown fails even if the candidate loosens its policy', () => {
  const head = report(200);
  head.results[0].budget.allowanceMs = 10000;
  assert.equal(compareReports(report(100), head)[0].failed, true);
});
test('refuses incomparable or missing measurements', () => {
  const head = report(100);
  head.environment.node = 'other';
  assert.throws(() => compareReports(report(100), head));
  assert.throws(() =>
    compareReports(report(100), { ...report(100), results: [] })
  );
});

test('a duplicated phase cannot replace a missing phase in either report', () => {
  const base = report(100);
  base.results.push({ ...base.results[0], phase: 'filter' });
  const duplicate = { ...base, results: [base.results[0], base.results[0]] };
  assert.throws(() => compareReports(base, duplicate), /duplicate head metric/);
  assert.throws(() => compareReports(duplicate, base), /duplicate base metric/);
});

test('rejects empty measurements, changed state and invalid baseline budgets', () => {
  assert.throws(() =>
    compareReports(
      { ...report(100), results: [] },
      { ...report(100), results: [] }
    )
  );
  assert.throws(() =>
    compareReports(
      { ...report(100), state: 'cold' },
      { ...report(100), state: 'warm' }
    )
  );
  const base = report(100);
  base.results[0].budget.relative = NaN;
  assert.throws(() => compareReports(base, report(100)));
});
