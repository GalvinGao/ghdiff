import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  acceptReviewFilterStore,
  EMPTY_REVIEW_FILTER_STORE,
  MAX_STORED_REVIEW_FILTERS,
  type StoredReviewFilter,
  writeReviewFilter,
} from './reviewFilterStore.ts';

describe('acceptReviewFilterStore', () => {
  it('refuses a value that is not an object', () => {
    assert.equal(acceptReviewFilterStore(null), undefined);
    assert.equal(acceptReviewFilterStore([]), undefined);
    assert.equal(acceptReviewFilterStore('source'), undefined);
  });

  it('keeps the ids this build knows and drops the rest', () => {
    assert.deepEqual(
      acceptReviewFilterStore({
        'pull:a/b#1': {
          presets: ['source', 'nope', 'all', 'source', 7],
          statuses: ['added', 'untracked', 'gone'],
          hideUntracked: 'yes',
        },
      }),
      {
        'pull:a/b#1': {
          presets: ['source'],
          statuses: ['added'],
          hideUntracked: false,
        },
      }
    );
  });

  it('drops a row that hides nothing', () => {
    assert.deepEqual(
      acceptReviewFilterStore({
        a: { presets: ['nope'] },
        b: 'source',
        c: { hideUntracked: true },
      }),
      { c: { presets: [], statuses: [], hideUntracked: true } }
    );
  });
});

describe('writeReviewFilter', () => {
  const source: StoredReviewFilter = {
    presets: ['source'],
    statuses: [],
    hideUntracked: false,
  };
  const none: StoredReviewFilter = {
    presets: [],
    statuses: [],
    hideUntracked: false,
  };

  it('writes one diff and leaves the others alone', () => {
    const once = writeReviewFilter(EMPTY_REVIEW_FILTER_STORE, 'a', source);
    const twice = writeReviewFilter(once, 'b', source);
    assert.deepEqual(Object.keys(twice), ['a', 'b']);
    assert.equal(twice.a, once.a);
  });

  it('removes a filter that hides nothing', () => {
    const stored = writeReviewFilter(EMPTY_REVIEW_FILTER_STORE, 'a', source);
    assert.deepEqual(writeReviewFilter(stored, 'a', none), {});
  });

  it('drops the oldest write once the store is full', () => {
    let store = EMPTY_REVIEW_FILTER_STORE;
    for (let index = 0; index < MAX_STORED_REVIEW_FILTERS; index++) {
      store = writeReviewFilter(store, `k${index}`, source);
    }
    // Writing the first again makes it the newest, so k1 is the one to go.
    store = writeReviewFilter(store, 'k0', source);
    store = writeReviewFilter(store, 'new', source);
    const keys = Object.keys(store);
    assert.equal(keys.length, MAX_STORED_REVIEW_FILTERS);
    assert.equal(keys.includes('k1'), false);
    assert.equal(keys.includes('k0'), true);
    assert.equal(keys.at(-1), 'new');
  });
});
