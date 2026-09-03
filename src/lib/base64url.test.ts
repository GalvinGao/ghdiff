import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fromBase64Url, toBase64Url } from './base64url.ts';

describe('toBase64Url', () => {
  it('uses the URL-safe alphabet and no padding', () => {
    // 0xfb 0xff picks out both substituted characters: standard base64 writes
    // this as `+/8=`.
    const encoded = toBase64Url(new Uint8Array([0xfb, 0xff]));
    assert.equal(encoded, '-_8');
  });

  it('answers an empty string for no bytes', () => {
    assert.equal(toBase64Url(new Uint8Array()), '');
  });

  it('keeps every byte value', () => {
    const bytes = new Uint8Array(256);
    for (let index = 0; index < 256; index += 1) bytes[index] = index;
    assert.deepEqual(fromBase64Url(toBase64Url(bytes)), bytes);
  });
});

describe('fromBase64Url', () => {
  it('reads back what the encoder wrote, at every remainder', () => {
    for (const length of [1, 2, 3, 4, 5, 31, 32, 33]) {
      const bytes = new Uint8Array(length).fill(0xa5);
      assert.deepEqual(fromBase64Url(toBase64Url(bytes)), bytes, `${length}`);
    }
  });

  it('refuses a character outside the alphabet', () => {
    // Standard base64's own two characters are the ones a cookie must not
    // carry: a value spelled that way was not written by this app.
    assert.equal(fromBase64Url('+_8'), undefined);
    assert.equal(fromBase64Url('-/8'), undefined);
    assert.equal(fromBase64Url('ab=c'), undefined);
    assert.equal(fromBase64Url('ab c'), undefined);
  });

  it('refuses a length that encodes no whole byte', () => {
    // Four characters carry three bytes, and one on its own carries none.
    assert.equal(fromBase64Url('a'), undefined);
    assert.equal(fromBase64Url('abcde'), undefined);
  });
});
