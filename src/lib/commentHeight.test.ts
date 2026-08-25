import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  commentPreviewText,
  measureCommentBody,
  measureThread,
} from './commentHeight.ts';

describe('measureCommentBody', () => {
  it('gives a one-line comment one line', () => {
    const spec = measureCommentBody('nit: typo');
    assert.equal(spec.size, 'one-line');
  });

  it('grows for a few lines of prose', () => {
    assert.equal(measureCommentBody('one\ntwo\nthree').size, 'short');
  });

  it('takes the tall bucket for long prose', () => {
    assert.equal(measureCommentBody('word '.repeat(120)).size, 'tall');
  });

  it('takes the tall bucket for any block markdown', () => {
    for (const body of [
      '```ts\nconst a = 1;\n```',
      '| a | b |\n| - | - |',
      '- one\n- two',
      '1. one',
      '> quoted',
      '## heading',
      '![badge](https://img.shields.io/badge/P2-yellow)',
    ]) {
      assert.equal(measureCommentBody(body).size, 'tall', body);
    }
  });

  it('takes the tall bucket for block html, which renders now', () => {
    for (const body of [
      '<img width="900" alt="a hint" src="https://example.test/a.png" />',
      '<details><summary>log</summary>lines</details>',
      '<table><tr><td>a</td></tr></table>',
      '<ul><li>one</li></ul>',
    ]) {
      assert.equal(measureCommentBody(body).size, 'tall', body);
    }
  });

  it('leaves an inline tag on one line', () => {
    assert.equal(measureCommentBody('press <kbd>a</kbd>').size, 'one-line');
  });

  it('is stable for the same input', () => {
    const body = 'some comment';
    assert.deepEqual(measureCommentBody(body), measureCommentBody(body));
  });

  it('never returns a height of zero', () => {
    for (const body of ['', ' ', '\n\n']) {
      assert.ok(measureCommentBody(body).bodyHeight > 0);
    }
  });
});

describe('commentPreviewText', () => {
  it('strips emphasis and code marks', () => {
    assert.equal(
      commentPreviewText('**bold** and `code` and _italic_'),
      'bold and code and italic'
    );
  });

  it('keeps link text and drops the target', () => {
    assert.equal(
      commentPreviewText('see [the docs](https://example.com/x)'),
      'see the docs'
    );
  });

  it('names an image rather than showing its URL', () => {
    assert.match(
      commentPreviewText('![P2 Badge](https://img.sh/x.svg)'),
      /image/
    );
  });

  it('replaces a fenced block with one word', () => {
    assert.equal(
      commentPreviewText('before\n```\nconst a = 1;\n```\nafter'),
      'before code after'
    );
  });

  it('strips headings, quotes, and list markers', () => {
    assert.equal(
      commentPreviewText('## Title\n> quote\n- item'),
      'Title quote item'
    );
  });

  it('strips raw html tags', () => {
    assert.equal(commentPreviewText('<sub><sub>text</sub></sub>'), 'text');
  });

  it('names an html image, which is often the whole comment', () => {
    assert.equal(
      commentPreviewText(
        '<img width="900" alt="the hint" src="https://example.test/a.png" />'
      ),
      'image'
    );
    assert.equal(
      commentPreviewText('before <img src="https://example.test/a.png"> after'),
      'before image after'
    );
  });

  it('collapses whitespace', () => {
    assert.equal(commentPreviewText('a\n\n\n   b'), 'a b');
  });
});

describe('measureThread', () => {
  it('uses the bucket of the root for a thread of one', () => {
    assert.deepEqual(
      measureThread(['nit: typo']),
      measureCommentBody('nit: typo')
    );
  });

  it('takes the tall bucket once there is a reply', () => {
    assert.equal(measureThread(['nit: typo', 'fixed']).size, 'tall');
  });

  it('never shrinks below the root when replies exist', () => {
    const root = 'word '.repeat(120);
    assert.ok(
      measureThread([root, 'ok']).bodyHeight >=
        measureCommentBody(root).bodyHeight
    );
  });

  it('handles a thread with no messages', () => {
    assert.ok(measureThread([]).bodyHeight > 0);
  });
});
