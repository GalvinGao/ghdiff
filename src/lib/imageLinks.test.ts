import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findImageLinks } from './imageLinks.ts';

test('finds direct image links with exact source positions and signed queries', () => {
  const text =
    'const a = "https://cdn.example/a.PNG?token=a%2Fb#view"; const b = "http://localhost:3000/b.webp";';
  const links = findImageLinks(text);
  assert.equal(links.length, 2);
  assert.equal(links[0].url, 'https://cdn.example/a.PNG?token=a%2Fb#view');
  for (const link of links)
    assert.equal(text.slice(link.start, link.end), link.url);
  assert.equal(
    findImageLinks('"https://example.com/a.png?token=abc.)"')[0].url,
    'https://example.com/a.png?token=abc.)'
  );
});

test('handles Markdown delimiters without removing balanced filename parentheses', () => {
  assert.equal(
    findImageLinks('[image](https://example.com/photo(1).png).')[0].url,
    'https://example.com/photo(1).png'
  );
  assert.equal(
    findImageLinks('https://example.com/image%2Esvg,')[0].url,
    'https://example.com/image%2Esvg'
  );
});

test('ignores pages, non-web schemes, embedded credentials and malformed URLs', () => {
  for (const text of [
    'https://example.com/page?image=photo.png',
    'https://example.com/photo.png.html',
    'javascript:alert(1)',
    'data:image/png;base64,abc',
    'file:///tmp/photo.png',
    'https://user:secret@example.com/photo.png',
    'https://example.com:bad/photo.png',
    'https://example.com/%zz.png',
  ])
    assert.deepEqual(findImageLinks(text), []);
});

test('handles long runs of closing delimiters without repeated rescans', () => {
  const url = 'https://example.com/photo.png';
  assert.equal(findImageLinks(url + ')'.repeat(20000))[0].url, url);
});
