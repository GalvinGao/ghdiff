import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { entriesWithoutAttachments, withoutAttachments } from './persist.ts';
import {
  ANONYMOUS_NAMESPACE,
  CACHE_MAX_AGE_MS,
  CACHE_SCHEMA_VERSION,
  type CacheRecord,
  isLiveRecord,
  isWithinWindow,
  moment,
  queryHash,
  recordId,
  viewerNamespace,
} from './records.ts';

const NOW = 1_800_000_000_000;

function record(overrides: Partial<CacheRecord> = {}): CacheRecord {
  return {
    id: recordId('user:ada', '["pulls.list","acme/app"]'),
    namespace: 'user:ada',
    hash: '["pulls.list","acme/app"]',
    queryKey: ['pulls.list', 'acme/app'],
    version: CACHE_SCHEMA_VERSION,
    updatedAt: NOW - 1_000,
    complete: true,
    data: { pulls: [], failures: [] },
    ...overrides,
  };
}

describe('viewerNamespace', () => {
  it('files a signed-out session apart from every account', () => {
    assert.equal(viewerNamespace(undefined), ANONYMOUS_NAMESPACE);
  });

  it('reads a login without case, the way GitHub does', () => {
    assert.equal(viewerNamespace('Ada'), viewerNamespace('ada'));
    assert.notEqual(viewerNamespace('ada'), viewerNamespace('grace'));
  });
});

describe('queryHash', () => {
  it('tells keys apart by every part and its type', () => {
    assert.notEqual(
      queryHash(['pulls.get', 'acme', 'app', 1]),
      queryHash(['pulls.get', 'acme', 'app', '1'])
    );
    assert.equal(
      queryHash(['pulls.get', 'acme', 'app', 1]),
      queryHash(['pulls.get', 'acme', 'app', 1])
    );
  });
});

describe('recordId', () => {
  it('never lets two accounts share a record', () => {
    assert.notEqual(recordId('user:ada', 'k'), recordId('user:grace', 'k'));
  });
});

describe('isLiveRecord', () => {
  it('reads a record this build wrote within the day', () => {
    assert.equal(isLiveRecord(record(), NOW), true);
  });

  it('refuses a record an older build wrote', () => {
    assert.equal(
      isLiveRecord(record({ version: CACHE_SCHEMA_VERSION - 1 }), NOW),
      false
    );
  });

  it('refuses a record older than a day', () => {
    assert.equal(
      isLiveRecord(record({ updatedAt: NOW - CACHE_MAX_AGE_MS }), NOW),
      false
    );
  });

  it('refuses anything that is not the shape it claims', () => {
    assert.equal(isLiveRecord(null, NOW), false);
    assert.equal(isLiveRecord('record', NOW), false);
    assert.equal(isLiveRecord({ ...record(), queryKey: 'k' }, NOW), false);
    assert.equal(isLiveRecord({ ...record(), data: undefined }, NOW), false);
  });
});

describe('isWithinWindow', () => {
  it('takes an answer younger than the window', () => {
    assert.equal(isWithinWindow(NOW - 4_999, NOW, 5_000), true);
  });

  it('refuses one at the window or past it', () => {
    assert.equal(isWithinWindow(NOW - 5_000, NOW, 5_000), false);
  });

  it('refuses a time in the future', () => {
    assert.equal(isWithinWindow(NOW + 1, NOW, 5_000), false);
  });
});

describe('withoutAttachments', () => {
  it('takes the signed addresses out and keeps everything else', () => {
    const signed = {
      title: 'Fix',
      attachments: { byId: { a: { url: 'https://signed' } }, lifetimeMs: 1 },
    };
    assert.deepEqual(withoutAttachments(signed), { title: 'Fix' });
    assert.ok('attachments' in signed, 'the original is left as it was');
  });

  it('hands back an answer with no addresses unchanged', () => {
    const plain = { title: 'Fix' };
    assert.equal(withoutAttachments(plain), plain);
  });

  it('does the same for every entry of a list', () => {
    assert.deepEqual(
      entriesWithoutAttachments([
        { id: 1, attachments: { byId: {} } },
        { id: 2 },
      ]),
      [{ id: 1 }, { id: 2 }]
    );
  });
});

describe('moment', () => {
  it('never gives the same moment twice, however fast it is asked', () => {
    const moments = Array.from({ length: 1_000 }, () => moment());
    for (let index = 1; index < moments.length; index += 1) {
      assert.ok(moments[index] > moments[index - 1]);
    }
  });

  it('stays on the wall clock', () => {
    assert.ok(Math.abs(moment() - Date.now()) < 1_000);
  });
});
