import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { cpus, platform, release, arch } from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { fixtureRecord, generateFixture, SHAPES } from './fixtures.mjs';

const { values } = parseArgs({
  options: {
    root: { type: 'string', default: '.' },
    output: { type: 'string' },
    fixture: { type: 'string' },
  },
});
const root = resolve(values.root);
const source = (name) =>
  import(pathToFileURL(resolve(root, `src/lib/${name}.ts`)));
const { buildReviewData } = await source('reviewData');
const { applyReviewFilter, EMPTY_FILTER_STATE, presetStats } =
  await source('reviewFilter');
const { FILTER_PRESETS } = await source('filterRules');
const { searchDiff, indexMatchesByLine } = await source('diffSearch');
const { findLineMarks } = await source('lineMarks');
const { buildTreeStatIndex } = await source('treeStats');
const manifest = JSON.parse(
  await readFile(new URL('./manifest.json', import.meta.url), 'utf8')
);
const results = [];
const percentile = (sorted, fraction) =>
  sorted[Math.ceil(sorted.length * fraction) - 1];

function measure(fixture, phase, run, validate, batch = 1, allowanceMs = 2) {
  // Validation is outside the timer, including warmups; missing data fails too.
  for (let i = 0; i < 2; i++) validate(run());
  const samplesMs = [];
  for (let sample = 0; sample < 7; sample++) {
    let answer;
    const start = performance.now();
    for (let i = 0; i < batch; i++) answer = run();
    samplesMs.push((performance.now() - start) / batch);
    validate(answer);
  }
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const record = {
    fixture,
    phase,
    samplesMs,
    batch,
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    budget: { relative: 0.25, allowanceMs },
  };
  results.push(record);
  console.error(`${fixture}/${phase}: ${record.medianMs.toFixed(3)} ms`);
}

for (const shape of SHAPES) {
  if (values.fixture != null && shape.id !== values.fixture) continue;
  const patch = generateFixture(shape);
  const expected = manifest.find((record) => record.id === shape.id);
  assert.deepEqual(fixtureRecord(shape, patch), expected);
  const validateData = (data) => {
    assert.equal(data.items.length, shape.files);
    assert.equal(data.entries.length, shape.files);
    assert.deepEqual(data.stats, {
      fileCount: shape.files,
      addedLines: expected.addedLines,
      deletedLines: expected.deletedLines,
      totalLines: expected.totalLines,
    });
  };
  measure(
    shape.id,
    'parse',
    () => buildReviewData(patch, 'perf'),
    validateData,
    1,
    10
  );
  const data = buildReviewData(patch, 'perf');
  const filtered = applyReviewFilter(data, {
    ...EMPTY_FILTER_STATE,
    query: 'src/',
  });
  measure(
    shape.id,
    'filter',
    () => applyReviewFilter(data, { ...EMPTY_FILTER_STATE, query: 'src/' }),
    (answer) => {
      assert.deepEqual(
        answer.entries.map((entry) => entry.itemId),
        filtered.entries.map((entry) => entry.itemId)
      );
      assert.deepEqual(answer.stats, {
        fileCount: Math.ceil(shape.files / 4),
        addedLines: Math.ceil(shape.files / 4) * shape.linesPerSide,
        deletedLines: Math.ceil(shape.files / 4) * shape.linesPerSide,
        totalLines: Math.ceil(shape.files / 4) * shape.linesPerSide * 2,
      });
      assert.equal(answer.treeSource.paths.length, answer.items.length);
    },
    30
  );
  const presetIds = FILTER_PRESETS.map((preset) => preset.id);
  const expectedPresets = presetStats(data.entries, presetIds);
  measure(
    shape.id,
    'presets',
    () => presetStats(data.entries, presetIds),
    (answer) => assert.deepEqual(answer, expectedPresets),
    10
  );
  const expectedTree = buildTreeStatIndex(data.entries);
  const expectedPaths = new Set();
  for (const entry of data.entries) {
    const parts = entry.treePath.split('/');
    expectedPaths.add(entry.treePath);
    for (let i = 1; i < parts.length; i++)
      expectedPaths.add(parts.slice(0, i).join('/') + '/');
  }
  assert.deepEqual(new Set(expectedTree.byPath.keys()), expectedPaths);
  for (const [path, stat] of expectedTree.byPath) {
    const entries = data.entries.filter((entry) =>
      path.endsWith('/')
        ? entry.treePath.startsWith(path)
        : entry.treePath === path
    );
    assert.deepEqual(stat, {
      fileCount: entries.length,
      addedLines: entries.length * shape.linesPerSide,
      deletedLines: entries.length * shape.linesPerSide,
    });
  }
  measure(
    shape.id,
    'tree',
    () => buildTreeStatIndex(data.entries),
    (answer) => assert.deepEqual(answer, expectedTree),
    10
  );
  for (const diffStyle of ['unified', 'split']) {
    for (const [phase, query, count] of [
      ['no-match', '__ABSENT_NEEDLE__', 0],
      ['late-match', '__TAIL_NEEDLE__', 1],
      ['cap-match', 'const', Math.min(10000, expected.totalLines - 1)],
    ]) {
      measure(
        shape.id,
        `search-${diffStyle}-${phase}`,
        () => searchDiff(data.items, query, { diffStyle }),
        (answer) => {
          assert.equal(answer.matches.length, count);
          assert.equal(
            answer.truncated,
            phase === 'cap-match' && expected.totalLines - 1 > 10000
          );
          if (phase === 'late-match')
            assert.equal(answer.matches[0].lineNumber, shape.linesPerSide);
        }
      );
    }
  }
  const matches = searchDiff(data.items, 'const', {
    diffStyle: 'unified',
  }).matches;
  measure(
    shape.id,
    'search-index',
    () => indexMatchesByLine(matches),
    (answer) =>
      assert.equal(
        [...answer.values()].reduce(
          (total, file) =>
            total +
            [...file.additions.values(), ...file.deletions.values()].reduce(
              (sum, spans) => sum + spans.length,
              0
            ),
          0
        ),
        matches.length
      )
  );
  measure(
    shape.id,
    'whitespace',
    () => data.items.map((item) => findLineMarks(item.fileDiff)),
    (answer) => assert.ok(answer.every((marks) => marks == null))
  );
}
assert.ok(results.length > 0, 'unknown fixture');
const report = {
  schema: 1,
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim(),
  environment: {
    node: process.version,
    platform: platform(),
    release: release(),
    arch: arch(),
    cpu: cpus()[0]?.model,
  },
  state:
    'warm CPU; two discarded warmups; serial phases; fixture generation and imports excluded',
  fixtures: manifest.filter(
    (record) => values.fixture == null || record.id === values.fixture
  ),
  results,
};
const json = `${JSON.stringify(report, null, 2)}\n`;
if (values.output != null) await writeFile(values.output, json);
else process.stdout.write(json);
