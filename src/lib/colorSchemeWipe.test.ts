import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { wipeOriginFromClick, wipeReach } from './colorSchemeWipe.ts';

// The two decisions in this module that need no browser: where the circle
// starts, and how far it has to go. The transition itself is checked in a
// browser — there is no view transition, and no viewport, in this runner.

function activation(
  fields: Partial<Parameters<typeof wipeOriginFromClick>[0]> & {
    rect?: { left: number; top: number; width: number; height: number };
  } = {}
) {
  const rect = fields.rect ?? { left: 0, top: 0, width: 0, height: 0 };
  return {
    detail: fields.detail ?? 1,
    clientX: fields.clientX ?? 0,
    clientY: fields.clientY ?? 0,
    currentTarget: { getBoundingClientRect: () => rect as DOMRect },
  };
}

describe('wipeOriginFromClick', () => {
  it('takes the pointer for a click', () => {
    assert.deepEqual(
      wipeOriginFromClick(activation({ clientX: 412, clientY: 68, detail: 1 })),
      { x: 412, y: 68 }
    );
  });

  it('takes the control centre when the keyboard activated it', () => {
    // Enter and Space report detail 0 and coordinates of 0,0, which would
    // otherwise start every keyboard-driven wipe in the top-left corner.
    assert.deepEqual(
      wipeOriginFromClick(
        activation({
          detail: 0,
          rect: { height: 28, left: 400, top: 60, width: 28 },
        })
      ),
      { x: 414, y: 74 }
    );
  });

  it('keeps a pointer at the origin of the viewport', () => {
    // 0,0 is a real press position, and only `detail` tells it apart from a
    // keyboard activation.
    assert.deepEqual(
      wipeOriginFromClick(
        activation({
          clientX: 0,
          clientY: 0,
          detail: 1,
          rect: { height: 28, left: 400, top: 60, width: 28 },
        })
      ),
      { x: 0, y: 0 }
    );
  });
});

describe('wipeReach', () => {
  it('reaches the corner farthest from the origin', () => {
    // A press in the top-right corner of a 400x300 viewport: the far corner is
    // the bottom-left one, 500 away.
    assert.equal(wipeReach({ x: 400, y: 0 }, 400, 300), 500);
  });

  it('answers the same for a press at either end of a side', () => {
    assert.equal(
      wipeReach({ x: 0, y: 0 }, 400, 300),
      wipeReach({ x: 400, y: 300 }, 400, 300)
    );
  });

  it('reaches every corner from the middle', () => {
    assert.equal(wipeReach({ x: 200, y: 150 }, 400, 300), 250);
  });
});
