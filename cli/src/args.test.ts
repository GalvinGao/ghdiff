import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  COMMAND_ARGS,
  DEFAULT_PORT,
  helpText,
  isUsableRevision,
  parseArgs,
} from './args.ts';

function run(...argv: string[]) {
  const parsed = parseArgs(argv);
  assert.equal(parsed.kind, 'run', JSON.stringify(parsed));
  return parsed.kind === 'run' ? parsed.run : undefined;
}

function refuse(...argv: string[]): string {
  const parsed = parseArgs(argv);
  assert.equal(parsed.kind, 'error', JSON.stringify(parsed));
  return parsed.kind === 'error' ? parsed.message : '';
}

describe('parseArgs', () => {
  it('reads the working tree with no arguments at all', () => {
    assert.deepEqual(run(), {
      range: { mode: 'worktree' },
      port: undefined,
      open: true,
    });
  });

  it('takes git’s own name for the index as well as its own', () => {
    assert.deepEqual(run('--staged')?.range, { mode: 'staged' });
    assert.deepEqual(run('--cached')?.range, { mode: 'staged' });
  });

  it('reads one revision as a branch on its base', () => {
    assert.deepEqual(run('main')?.range, { mode: 'branch', base: 'main' });
    assert.deepEqual(run('origin/main')?.range, {
      mode: 'branch',
      base: 'origin/main',
    });
  });

  it('reads both spellings of a range as the merge-base one', () => {
    const expected = { mode: 'range', base: 'main', head: 'feature' };
    assert.deepEqual(run('main..feature')?.range, expected);
    assert.deepEqual(run('main...feature')?.range, expected);
  });

  it('takes the port either way round, and the browser off', () => {
    assert.equal(run('--port', '4000')?.port, 4000);
    assert.equal(run('--port=4000')?.port, 4000);
    assert.equal(run('--no-open')?.open, false);
    assert.equal(run()?.open, true);
  });

  it('lets options and a revision arrive in any order', () => {
    assert.deepEqual(run('--no-open', 'main', '--port=1234'), {
      range: { mode: 'branch', base: 'main' },
      port: 1234,
      open: false,
    });
  });

  it('reads everything after -- as a revision, however it is spelled', () => {
    // Not a security boundary — `isUsableRevision` is — but it is the escape
    // hatch a branch called `--staged` would otherwise have none of.
    assert.deepEqual(parseArgs(['--', '-weird']), {
      kind: 'error',
      message:
        '"-weird" is not a revision. Name a branch, a tag or a commit, or a range as base..head.',
    });
  });

  it('answers help and version before anything else', () => {
    assert.deepEqual(parseArgs(['--help']), { kind: 'help' });
    assert.deepEqual(parseArgs(['-h']), { kind: 'help' });
    assert.deepEqual(parseArgs(['main', '--version']), { kind: 'version' });
    assert.deepEqual(parseArgs(['-v']), { kind: 'version' });
    assert.deepEqual(parseArgs(['-V']), { kind: 'version' });
    // Help outranks a version asked for in the same breath, and both outrank a
    // revision that would otherwise be an error.
    assert.deepEqual(parseArgs(['--version', '--help']), { kind: 'help' });
    assert.deepEqual(parseArgs(['--frobnicate', '--help']), { kind: 'help' });
  });

  it('refuses the four things it cannot make sense of', () => {
    assert.match(refuse('--frobnicate'), /not an option/);
    assert.match(refuse('--staged', 'main'), /takes no revision/);
    assert.match(refuse('main', 'feature'), /one revision or one range/);
    assert.match(refuse('--port', 'soon'), /from 1 to 65535/);
  });

  it('refuses an unknown option in every spelling citty lets through', () => {
    // citty asks `node:util.parseArgs` for `strict: false`, so an option this
    // command does not have arrives as a key rather than as an error. Each of
    // these is a different way into that object, and none of them may be
    // swallowed: a typo that ran anyway would serve a diff nobody asked for.
    assert.match(refuse('--frobnicate'), /^--frobnicate is not an option/);
    // Named as it was typed, value and all, rather than as the key it parsed
    // to: `--frobnicate=1` is what the developer has to go and find.
    assert.match(refuse('--frobnicate=1'), /^--frobnicate=1 is not an option/);
    assert.match(
      refuse('--no-frobnicate'),
      /^--no-frobnicate is not an option/
    );
    assert.match(refuse('-x'), /is not an option/);
  });

  it('reads --cached and --staged as the one range, together or apart', () => {
    assert.deepEqual(run('--cached', '--staged')?.range, { mode: 'staged' });
    assert.match(refuse('--cached', 'main'), /takes no revision/);
  });

  it('refuses a port outside the range, and one that is not a number', () => {
    assert.match(refuse('--port', '0'), /from 1 to 65535/);
    assert.match(refuse('--port', '65536'), /from 1 to 65535/);
    assert.match(refuse('--port'), /Got nothing/);
  });
});

describe('DEFAULT_PORT', () => {
  it('is the storage origin, so it is pinned rather than convenient', () => {
    // `localStorage` is keyed by origin and an origin includes the port, so
    // this number is where a reviewer's comments, viewed marks, colour mode and
    // code font live. Changing it moves all four somewhere nobody will look.
    assert.equal(DEFAULT_PORT, 7171);
  });

  it('sits clear of the servers a developer already runs', () => {
    for (const taken of [3000, 4000, 5000, 5173, 8000, 8080, 8888, 9000]) {
      assert.notEqual(DEFAULT_PORT, taken);
    }
  });

  it('sits below every ephemeral range, so the kernel cannot take it', () => {
    // Linux allocates outgoing ports from 32768, macOS and Windows from 49152.
    // A default inside either range could be handed to another connection while
    // a review was open.
    assert.ok(DEFAULT_PORT < 32768, String(DEFAULT_PORT));
    assert.ok(DEFAULT_PORT >= 1024, String(DEFAULT_PORT));
  });
});

describe('isUsableRevision', () => {
  it('takes what git’s own revision grammar allows', () => {
    for (const revision of [
      'main',
      'HEAD',
      'HEAD~2',
      'v1.0.0',
      'origin/release/1.x',
      'feature/JIRA-12',
      'abc1234',
    ]) {
      assert.equal(isUsableRevision(revision), true, revision);
    }
  });

  it('refuses anything git would read as a flag', () => {
    // The whole point: nothing here runs through a shell, so an argument that
    // opens with a dash is the one way a "branch name" becomes an option.
    assert.equal(isUsableRevision('--output=/tmp/x'), false);
    assert.equal(isUsableRevision('-M'), false);
  });

  it('refuses whitespace, control characters and the empty string', () => {
    assert.equal(isUsableRevision(''), false);
    assert.equal(isUsableRevision('main feature'), false);
    assert.equal(isUsableRevision(`main${String.fromCharCode(0)}x`), false);
    assert.equal(isUsableRevision(`main${String.fromCharCode(10)}`), false);
    assert.equal(isUsableRevision('a'.repeat(256)), false);
  });
});

describe('the declaration', () => {
  it('is the one statement of what this command takes', async () => {
    // The parser reads `command.args` and so does the usage below it, so an
    // option cannot come to be accepted and undocumented, or the other way
    // round. Each of these is read by `parseArgs` above; this is the list it
    // reads them from.
    assert.deepEqual(Object.keys(COMMAND_ARGS), [
      'revision',
      'staged',
      'cached',
      'port',
      'open',
      'help',
      'version',
    ]);
  });

  it('renders the options from that declaration, and the notes under them', async () => {
    const help = await helpText();
    // citty's half: every option, with the port's own default in its sentence.
    for (const flag of ['--staged', '--cached', '--port', '--no-open']) {
      assert.ok(help.includes(flag), `${flag} is missing from --help`);
    }
    // The half citty cannot know. `ghdiff main` meaning `main...HEAD` is this
    // command's decision, and the port paragraph is the one a reviewer finds
    // out too late otherwise.
    assert.ok(help.includes('git diff main...HEAD'), 'the table is missing');
    assert.ok(help.includes(String(DEFAULT_PORT)), 'the port is missing');
    assert.ok(help.includes('127.0.0.1'), 'what it does with the machine');
  });
});
