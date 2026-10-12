import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  reviewFaviconDataUri,
  type ReviewFaviconColors,
} from './reviewFavicon';

const COLORS: ReviewFaviconColors = {
  accent: '#0a0a0a',
  accentInk: '#ffffff',
  success: '#1f883d',
  pending: '#bf8700',
  failure: '#cf222e',
};

function svg(input: Parameters<typeof reviewFaviconDataUri>[0]): string {
  const uri = reviewFaviconDataUri(input);
  assert.ok(uri.startsWith('data:image/svg+xml,'));
  return decodeURIComponent(uri.slice('data:image/svg+xml,'.length));
}

describe('reviewFaviconDataUri', () => {
  it('keeps the runner emoji as the base', () => {
    const out = svg({ type: 'pull', colors: COLORS });
    assert.ok(out.includes('<svg'));
    assert.ok(out.includes('🏃‍♀️'));
  });

  it('paints the glyphs bare but for a thin halo, on the emoji’s ground', () => {
    const out = svg({ type: 'pull', check: 'success', colors: COLORS });
    assert.ok(out.includes('clip-path="url(#emoji-clip)"'));
    // The halo is what keeps a near-white mark visible on a light tab strip
    // and a near-black one on a dark. The pending dot alone goes without.
    assert.ok(out.includes(`stroke="${COLORS.accentInk}"`));
    assert.ok(!out.includes('rx='));
  });

  it('paints the diff type in the accent, always', () => {
    for (const [type, fragment] of [
      ['pull', 'M1.5 3.25a2.25'],
      ['commit', 'M11.93 8.5a4.002'],
      ['compare', 'M9.573.677A.25.25'],
    ] as const) {
      const out = svg({ type, colors: COLORS });
      assert.ok(out.includes(`fill="${COLORS.accent}"`));
      assert.ok(out.includes(fragment));
    }
  });

  it('states a draft with the type mark’s shape, never its colour', () => {
    const out = svg({
      type: 'pull',
      draft: true,
      check: 'success',
      colors: COLORS,
    });
    // The draft-PR octicon, in the same accent every type mark takes...
    assert.ok(out.includes('M3.25 1A2.25'));
    assert.ok(out.includes(`fill="${COLORS.accent}"`));
    // ...and the checks keep their own colour: the pipeline's answer is true
    // whatever the change is called.
    assert.ok(out.includes(`fill="${COLORS.success}"`));
  });

  it('paints the checks as a green check, a red cross, and an amber dot', () => {
    const pass = svg({ type: 'pull', check: 'success', colors: COLORS });
    assert.ok(pass.includes(`fill="${COLORS.success}"`));
    assert.ok(pass.includes('M13.78 4.22'));

    const fail = svg({ type: 'pull', check: 'failure', colors: COLORS });
    assert.ok(fail.includes(`fill="${COLORS.failure}"`));
    assert.ok(fail.includes('M3.72 3.72a.75.75'));

    const running = svg({ type: 'pull', check: 'pending', colors: COLORS });
    assert.ok(
      running.includes(
        `<circle cx="75" cy="75" r="15" fill="${COLORS.pending}"/>`
      )
    );
  });

  it('clips the emoji to the top quarter when the type mark stands alone', () => {
    // No checks to report — a commit, a compare, an anonymous read — and the
    // runner keeps three quarters of the box.
    const alone = svg({ type: 'commit', colors: COLORS });
    assert.ok(alone.includes('<path d="M0 0H50V50H100V100H0Z"/>'));
    assert.ok(!alone.includes('width="50" height="100"'));

    const pair = svg({ type: 'pull', check: 'failure', colors: COLORS });
    assert.ok(pair.includes('width="50" height="100"'));
    assert.ok(!pair.includes('M0 0H50V50H100V100H0Z'));
  });

  it('paints no status mark when the checks were never asked or absent', () => {
    for (const check of [undefined, 'none'] as const) {
      const out = svg({ type: 'pull', check, colors: COLORS });
      assert.ok(!out.includes(`fill="${COLORS.success}"`));
      assert.ok(!out.includes(`fill="${COLORS.failure}"`));
      assert.ok(!out.includes(`fill="${COLORS.pending}"`));
      assert.ok(!out.includes('M13.78 4.22'));
      assert.ok(!out.includes('M3.72 3.72a.75.75'));
      assert.ok(!out.includes('<circle'));
    }
  });
});
