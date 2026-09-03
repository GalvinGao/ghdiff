import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CODE_FONT_PREFERENCE,
  COLOR_MODE_PREFERENCE,
  COMMENT_AUTHOR_FILTER_PREFERENCE,
  RAIL_COLLAPSED_PREFERENCE,
  RAIL_WIDTH_PREFERENCE,
  SIDEBAR_WIDTH_PREFERENCE,
  type PreferenceCodec,
  VIEWER_CONTROLS_PREFERENCE,
  WATCHED_REPOS_PREFERENCE,
} from './preferences.ts';
import { DEFAULT_VIEWER_CONTROLS } from './viewerControls.ts';

// Read as one kind, so a rule below is asked of every codec rather than of the
// nine separately. The two directions are methods, which TypeScript treats as
// bivariant, so one `unknown` codec stands for all of them.
const ALL: PreferenceCodec<unknown>[] = [
  CODE_FONT_PREFERENCE,
  COLOR_MODE_PREFERENCE,
  COMMENT_AUTHOR_FILTER_PREFERENCE,
  RAIL_COLLAPSED_PREFERENCE,
  RAIL_WIDTH_PREFERENCE,
  SIDEBAR_WIDTH_PREFERENCE,
  VIEWER_CONTROLS_PREFERENCE,
  WATCHED_REPOS_PREFERENCE,
];

describe('every preference', () => {
  it('names a key of its own', () => {
    const keys = ALL.map((codec) => codec.key);
    assert.equal(new Set(keys).size, keys.length);
  });

  it('never acts on a stored value that is not its own shape', () => {
    for (const codec of ALL) {
      // Two answers are correct and they mean the same thing to a reader: the
      // codec refuses outright, or it answers with the fallback it would have
      // been given anyway. A setting whose fallback is already `null` — a pane
      // nobody dragged, a control nobody touched — takes the second.
      assert.deepEqual(
        codec.decode('{"not":"this"}') ?? codec.fallback,
        codec.fallback,
        `${codec.key} accepted a foreign object`
      );
    }
  });

  it('reads back what it wrote', () => {
    for (const codec of ALL) {
      const written = codec.encode(codec.fallback);
      if (written == null) continue;
      assert.deepEqual(
        codec.decode(written),
        codec.fallback,
        `${codec.key} did not survive a round trip`
      );
    }
  });
});

describe('the colour mode', () => {
  it('reads the three words the toggle offers', () => {
    assert.equal(COLOR_MODE_PREFERENCE.decode('system'), 'system');
    assert.equal(COLOR_MODE_PREFERENCE.decode('light'), 'light');
    assert.equal(COLOR_MODE_PREFERENCE.decode('dark'), 'dark');
  });

  it('is written bare, which is what the pre-paint script reads', () => {
    assert.equal(COLOR_MODE_PREFERENCE.encode('dark'), 'dark');
  });

  it('refuses a word this build does not know', () => {
    assert.equal(COLOR_MODE_PREFERENCE.decode('sepia'), undefined);
  });
});

describe('the code font', () => {
  it('is written bare, the way the pre-paint script reads it', () => {
    assert.equal(CODE_FONT_PREFERENCE.encode('jetbrains'), 'jetbrains');
    assert.equal(CODE_FONT_PREFERENCE.decode('jetbrains'), 'jetbrains');
  });

  it('refuses a face this build no longer offers', () => {
    assert.equal(CODE_FONT_PREFERENCE.decode('comic'), undefined);
  });
});

describe('the watch list', () => {
  it('keeps the repositories in the order they were watched', () => {
    assert.deepEqual(
      WATCHED_REPOS_PREFERENCE.decode(
        '[{"owner":"a","repo":"one"},{"owner":"b","repo":"two"}]'
      ),
      [
        { owner: 'a', repo: 'one' },
        { owner: 'b', repo: 'two' },
      ]
    );
  });

  it('drops an entry that is not a repository', () => {
    assert.deepEqual(
      WATCHED_REPOS_PREFERENCE.decode(
        '[{"owner":"a","repo":"one"},null,7,{"owner":"b"},{"owner":"","repo":"x"}]'
      ),
      [{ owner: 'a', repo: 'one' }]
    );
  });

  it('drops a repository listed twice, whatever its case', () => {
    assert.deepEqual(
      WATCHED_REPOS_PREFERENCE.decode(
        '[{"owner":"a","repo":"One"},{"owner":"A","repo":"one"}]'
      ),
      [{ owner: 'a', repo: 'One' }]
    );
  });

  it('refuses a stored value that is not a list', () => {
    assert.equal(WATCHED_REPOS_PREFERENCE.decode('"a/one"'), undefined);
  });
});

describe('the viewer controls', () => {
  it('reads a stored set', () => {
    assert.deepEqual(
      VIEWER_CONTROLS_PREFERENCE.decode('{"diffStyle":"unified"}'),
      { ...DEFAULT_VIEWER_CONTROLS, diffStyle: 'unified' }
    );
  });

  it('answers null for a reviewer who has chosen nothing', () => {
    // The one reading that lets a phone apply its own default instead.
    assert.equal(VIEWER_CONTROLS_PREFERENCE.fallback, null);
    assert.equal(VIEWER_CONTROLS_PREFERENCE.decode('null'), null);
  });
});

describe('a pane width', () => {
  it('reads a number of pixels', () => {
    assert.equal(SIDEBAR_WIDTH_PREFERENCE.decode('420'), 420);
    assert.equal(RAIL_WIDTH_PREFERENCE.decode('301.6'), 302);
  });

  it('answers null for a width nobody chose', () => {
    assert.equal(SIDEBAR_WIDTH_PREFERENCE.fallback, null);
    assert.equal(SIDEBAR_WIDTH_PREFERENCE.decode('0'), null);
    assert.equal(SIDEBAR_WIDTH_PREFERENCE.decode('-40'), null);
    assert.equal(SIDEBAR_WIDTH_PREFERENCE.decode('"wide"'), null);
  });

  it('refuses a stored string that is not JSON at all', () => {
    assert.equal(SIDEBAR_WIDTH_PREFERENCE.decode('304px'), undefined);
  });
});

describe('the left bar and the comment filter', () => {
  it('reads the bar as collapsed or not', () => {
    assert.equal(RAIL_COLLAPSED_PREFERENCE.decode('true'), true);
    assert.equal(RAIL_COLLAPSED_PREFERENCE.decode('false'), false);
    assert.equal(RAIL_COLLAPSED_PREFERENCE.decode('1'), undefined);
  });

  it('reads the three author filters, as the JSON they were written as', () => {
    assert.equal(COMMENT_AUTHOR_FILTER_PREFERENCE.decode('"all"'), 'all');
    assert.equal(COMMENT_AUTHOR_FILTER_PREFERENCE.decode('"people"'), 'people');
    assert.equal(COMMENT_AUTHOR_FILTER_PREFERENCE.decode('"bots"'), 'bots');
    assert.equal(COMMENT_AUTHOR_FILTER_PREFERENCE.decode('all'), undefined);
  });
});
