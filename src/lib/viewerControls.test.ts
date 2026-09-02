import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  acceptViewerControls,
  DEFAULT_VIEWER_CONTROLS,
  defaultViewerControls,
} from './viewerControls.ts';

describe('defaultViewerControls', () => {
  it('reads split on anything wider than a phone', () => {
    assert.equal(defaultViewerControls(false).diffStyle, 'split');
  });

  it('reads unified on a phone', () => {
    assert.equal(defaultViewerControls(true).diffStyle, 'unified');
  });

  it('changes nothing else for a phone', () => {
    const phone = defaultViewerControls(true);
    assert.equal(phone.diffIndicators, DEFAULT_VIEWER_CONTROLS.diffIndicators);
    assert.equal(phone.overflow, DEFAULT_VIEWER_CONTROLS.overflow);
    assert.equal(phone.lineNumbers, DEFAULT_VIEWER_CONTROLS.lineNumbers);
    assert.equal(phone.backgrounds, DEFAULT_VIEWER_CONTROLS.backgrounds);
  });
});

describe('acceptViewerControls', () => {
  it('takes a whole set back', () => {
    const stored = {
      diffStyle: 'unified',
      diffIndicators: 'classic',
      overflow: 'wrap',
      lineNumbers: false,
      backgrounds: false,
    };
    assert.deepEqual(acceptViewerControls(stored), stored);
  });

  it('keeps the fields it recognizes and defaults the rest', () => {
    assert.deepEqual(acceptViewerControls({ diffStyle: 'unified' }), {
      ...DEFAULT_VIEWER_CONTROLS,
      diffStyle: 'unified',
    });
  });

  it('defaults a field whose stored value this build does not know', () => {
    const controls = acceptViewerControls({
      diffStyle: 'columns',
      diffIndicators: 'none',
      overflow: 42,
      lineNumbers: 'yes',
    });
    assert.deepEqual(controls, {
      ...DEFAULT_VIEWER_CONTROLS,
      diffIndicators: 'none',
    });
  });

  it('refuses anything that is not an object', () => {
    assert.equal(acceptViewerControls(null), undefined);
    assert.equal(acceptViewerControls(undefined), undefined);
    assert.equal(acceptViewerControls('split'), undefined);
    assert.equal(acceptViewerControls(7), undefined);
  });

  it('refuses an object that says nothing about any of the five', () => {
    // A reviewer who has chosen nothing is not a reviewer who chose the
    // defaults: the screen still gets to pick, and a phone picks unified.
    assert.equal(acceptViewerControls({}), undefined);
    assert.equal(acceptViewerControls([]), undefined);
    assert.equal(acceptViewerControls({ diffStyle: 'columns' }), undefined);
  });
});
