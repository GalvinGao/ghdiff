import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { gitStatusFromChangeType, reviewFileStatus } from './reviewData.ts';

describe('gitStatusFromChangeType', () => {
  it('folds both rename variants into one badge', () => {
    assert.equal(gitStatusFromChangeType('rename-pure'), 'renamed');
    assert.equal(gitStatusFromChangeType('rename-changed'), 'renamed');
  });

  it('names the other three', () => {
    assert.equal(gitStatusFromChangeType('new'), 'added');
    assert.equal(gitStatusFromChangeType('deleted'), 'deleted');
    assert.equal(gitStatusFromChangeType('change'), 'modified');
  });
});

describe('reviewFileStatus', () => {
  const untracked = new Set(['scratch.ts', 'notes/todo.md']);

  it('answers as it always did when nothing was listed', () => {
    // Which is every diff GitHub serves: a commit holds no untracked file, so
    // the set is absent and this must behave exactly as the mapping above.
    assert.equal(reviewFileStatus('new', 'src/a.ts'), 'added');
    assert.equal(reviewFileStatus('change', 'src/a.ts'), 'modified');
    assert.equal(reviewFileStatus('deleted', 'src/a.ts'), 'deleted');
  });

  it('marks a new file git is not tracking', () => {
    assert.equal(reviewFileStatus('new', 'scratch.ts', untracked), 'untracked');
    assert.equal(
      reviewFileStatus('new', 'notes/todo.md', untracked),
      'untracked'
    );
  });

  it('leaves every other new file added', () => {
    assert.equal(reviewFileStatus('new', 'src/added.ts', untracked), 'added');
  });

  it('trusts the patch over the listing', () => {
    // A path in both is a path whose patch says it is a change to something
    // that is already committed, and the patch is the authority on that. The
    // listing is a snapshot taken a moment earlier and can be behind.
    assert.equal(
      reviewFileStatus('change', 'scratch.ts', untracked),
      'modified'
    );
    assert.equal(
      reviewFileStatus('deleted', 'scratch.ts', untracked),
      'deleted'
    );
  });

  it('takes an empty listing as none', () => {
    assert.equal(reviewFileStatus('new', 'scratch.ts', new Set()), 'added');
  });
});
