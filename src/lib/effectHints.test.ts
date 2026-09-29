import { parsePatchFiles } from '@pierre/diffs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type EffectLineHints,
  findEffectHints,
  scanEffectRun,
  tokenize,
} from './effectHints.ts';

function scan(source: string, firstLine = 1): EffectLineHints {
  const hints: EffectLineHints = new Map();
  scanEffectRun(source.split('\n'), firstLine, hints);
  return hints;
}

/** Every label on each line, folded or trailing, in column order. */
function labels(hints: EffectLineHints): Record<number, string> {
  const out: Record<number, string> = {};
  for (const [line, hint] of hints) {
    const all = [
      ...hint.folds.map((fold) => fold.label),
      ...(hint.label == null ? [] : [hint.label]),
    ];
    if (all.length > 0) out[line] = all.join('   ');
  }
  return out;
}

/** What each fold on one line hides. */
function folded(source: string): string[] {
  const hint = scan(source).get(1);
  return (hint?.folds ?? []).map((fold) => source.slice(fold.start, fold.end));
}

describe('yield*', () => {
  it('finds each one, with its columns', () => {
    const hints = scan(
      [
        'const program = Effect.gen(function* () {',
        '  const user = yield* getUser(id)',
        '  return yield *save(user)',
        '})',
      ].join('\n')
    );
    assert.deepEqual(hints.get(2)?.yields, [{ start: 15, end: 21 }]);
    assert.deepEqual(hints.get(3)?.yields, [{ start: 9, end: 16 }]);
    assert.equal(hints.get(2)?.label, undefined);
  });

  it('ignores `function*` and multiplication', () => {
    const hints = scan('Effect.gen(function* () { return a * b })');
    assert.equal(hints.size, 0);
  });

  it('ignores yield* inside strings, comments, templates and regexes', () => {
    const hints = scan(
      [
        'const a = "yield* x"',
        "const b = 'yield* x'",
        '// yield* x',
        '/* yield* x */',
        'const c = `yield* ${"x"}`',
        'const d = /yield* x/',
      ].join('\n')
    );
    assert.equal(hints.size, 0);
  });

  it('reads code inside a template interpolation', () => {
    const hints = scan('const a = `${yield* getName}`');
    assert.equal(hints.get(1)?.yields.length, 1);
  });
});

describe('what a line does', () => {
  it('names the error a failure is made from', () => {
    assert.deepEqual(
      labels(
        scan(
          [
            'if (row == null) return yield* Effect.fail(new NotFound({ id }))',
            'yield* new Unauthorized()',
            'Effect.fail("boom")',
          ].join('\n')
        )
      ),
      {
        1: 'fails · NotFound ↗',
        2: 'fails · Unauthorized ↗',
        3: 'fails',
      }
    );
  });

  it('claims an exit only behind a yield*', () => {
    assert.deepEqual(
      labels(
        scan(
          [
            'Effect.flatMap((n) => n > 0 ? Effect.succeed(n) : Effect.fail(new Negative()))',
            'yield* Effect.partition(values, Effect.fail)',
            'yield* Effect.dieMessage("unreachable")',
          ].join('\n')
        )
      ),
      { 1: 'fails · Negative', 3: 'dies ↗' }
    );
  });

  it('reads a failure across lines, on the line that fails', () => {
    assert.deepEqual(
      labels(
        scan(
          [
            '  return yield* Effect.fail(',
            '    new NotFound({',
            '      id,',
            '    })',
            '  )',
          ].join('\n'),
          40
        )
      ),
      { 40: 'fails · NotFound ↗' }
    );
  });

  it('calls a bare PascalCase operand a service', () => {
    assert.deepEqual(
      labels(
        scan(
          [
            'const repo = yield* UserRepo',
            'const config = yield* Config.string("HOST")',
            'const value = yield* Ref.get(ref)',
            'const users = yield* repo.list()',
          ].join('\n')
        )
      ),
      { 1: 'needs · UserRepo' }
    );
  });

  it('names the tags a handler catches', () => {
    assert.deepEqual(
      labels(
        scan(
          [
            'program.pipe(',
            '  Effect.catchTag("NotFound", () => Effect.succeed(null)),',
            '  Effect.catchTags({',
            '    Timeout: () => retry,',
            '    "ParseError": (e) => Effect.succeed({ fallback: e }),',
            '  }),',
            '  Effect.catchAll(() => Effect.void),',
            '  Effect.orDie,',
            ')',
          ].join('\n')
        )
      ),
      {
        2: 'catches · NotFound',
        3: 'catches · Timeout, ParseError',
        7: 'catches all',
        8: 'failure → defect',
      }
    );
  });

  it('names a defect and an interruption', () => {
    assert.deepEqual(
      labels(scan('yield* Effect.die(bug)\nyield* Effect.interrupt')),
      { 1: 'dies ↗', 2: 'interrupts ↗' }
    );
  });

  it('leaves type positions alone', () => {
    assert.equal(
      scan('const f = (): Effect.Effect<User, NotFound> => program').size,
      0
    );
  });
});

describe('folds', () => {
  it('hides the whole expression a label reads, keyword included', () => {
    assert.deepEqual(
      folded(
        'if (row == null) return yield* Effect.fail(new NotFound({ id }))'
      ),
      ['yield* Effect.fail(new NotFound({ id }))']
    );
    assert.deepEqual(folded('const repo = yield* UserRepo'), [
      'yield* UserRepo',
    ]);
    assert.deepEqual(folded('if (!ok) yield* new Unauthorized({ viewer })'), [
      'yield* new Unauthorized({ viewer })',
    ]);
    assert.deepEqual(folded('  Effect.orDie,'), ['Effect.orDie']);
  });

  it('keeps the outermost of two nested folds', () => {
    const source = '  Effect.catchTag("SqlError", (e) => Effect.die(e)),';
    assert.deepEqual(folded(source), [
      'Effect.catchTag("SqlError", (e) => Effect.die(e))',
    ]);
    assert.equal(scan(source).get(1)?.label, undefined);
  });

  it('keeps two folds side by side', () => {
    assert.deepEqual(folded('const [a, b] = [yield* Db, yield* Cache]'), [
      'yield* Db',
      'yield* Cache',
    ]);
  });

  it('does not fold an expression that ends on another line', () => {
    const hint = scan(
      '  return yield* Effect.fail(\n    new NotFound({ id })\n  )'
    ).get(1);
    assert.deepEqual(hint?.folds, []);
    assert.equal(hint?.label, 'fails · NotFound ↗');
  });

  it('quotes the hidden code in the tooltip', () => {
    const [fold] = scan('const repo = yield* UserRepo').get(1)!.folds;
    assert.match(fold!.title, /yield\* UserRepo$/);
  });
});

describe('a run is a fragment', () => {
  it('reads a call whose closing parenthesis is past the end', () => {
    assert.deepEqual(labels(scan('  yield* Effect.fail(\n    new Gone({')), {
      1: 'fails · Gone ↗',
    });
  });

  it('survives closers whose openers are off screen', () => {
    const hints = scan(
      ['    })', '  }))', '  const a = yield* UserRepo'].join('\n')
    );
    assert.equal(labels(hints)[3], 'needs · UserRepo');
  });

  it('reads a run that opens inside a JSDoc block as comment', () => {
    const hints = scan(
      [' * const user = yield* UserRepo', ' */', 'const x = yield* Db'].join(
        '\n'
      )
    );
    assert.equal(hints.has(1), false);
    assert.equal(labels(hints)[3], 'needs · Db');
  });

  it('does not take a glob in a string for the end of a comment', () => {
    const tokens = tokenize(['const g = "**/*.ts"; yield* Db']);
    assert.ok(tokens.some((token) => token.text === 'Db'));
  });

  it('ends a string that is never closed at its own line', () => {
    const hints = scan(["const a = 'oops", 'const b = yield* Db'].join('\n'));
    assert.equal(labels(hints)[2], 'needs · Db');
  });
});

const PATCH = `diff --git a/src/users.ts b/src/users.ts
--- a/src/users.ts
+++ b/src/users.ts
@@ -10,3 +10,4 @@ export const getUser = (id: string) =>
   Effect.gen(function* () {
-    const row = yield* db.find(id)
+    const repo = yield* UserRepo
+    const row = yield* repo.find(id)
     if (row == null) return yield* Effect.fail(new NotFound({ id }))
@@ -40,2 +41,2 @@ export const main = program.pipe(
-  Effect.catchAll(() => Effect.void)
+  Effect.catchTag("NotFound", () => Effect.void)
 )
`;

describe('findEffectHints', () => {
  const [fileDiff] = parsePatchFiles(PATCH)[0]!.files;

  it('reads each hunk as a run of its own, on both sides', () => {
    const hints = findEffectHints(fileDiff!);
    assert.ok(hints);
    assert.deepEqual(labels(hints.additions), {
      11: 'needs · UserRepo',
      13: 'fails · NotFound ↗',
      41: 'catches · NotFound',
    });
    assert.deepEqual(labels(hints.deletions), {
      12: 'fails · NotFound ↗',
      40: 'catches all',
    });
    assert.equal(hints.deletions.get(11)?.yields.length, 1);
  });

  it('reads no file that is not a script', () => {
    assert.equal(
      findEffectHints({ ...fileDiff!, name: 'README.md', prevName: undefined }),
      undefined
    );
  });

  it('reads no script that never names Effect', () => {
    assert.equal(
      findEffectHints({
        ...fileDiff!,
        additionLines: ['function* saga() {', '  yield* call(api)', '}'],
        deletionLines: [],
        isPartial: false,
      }),
      undefined
    );
  });

  it('reads the whole file once it has been hydrated', () => {
    const hints = findEffectHints({
      ...fileDiff!,
      isPartial: false,
      additionLines: ['import { Effect } from "effect"', 'const a = yield* Db'],
      deletionLines: [],
    });
    assert.deepEqual(labels(hints!.additions), { 2: 'needs · Db' });
  });
});
