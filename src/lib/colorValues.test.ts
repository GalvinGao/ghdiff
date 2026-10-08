import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findColorValues } from './colorValues.ts';

test('finds several colors with their exact source offsets in any code', () => {
  const line = 'const colors = ["#FFFFFF", "#000", "rgb(12, 34, 56)"];';
  const colors = findColorValues(line);
  assert.deepEqual(
    colors.map((color) => color.hex),
    ['#FFFFFF', '#000000', '#0C2238']
  );
  for (const color of colors) {
    assert.equal(line.slice(color.start, color.end), color.source);
  }
});

test('expands short hex and decodes the last channel as alpha', () => {
  const colors = findColorValues('#aBc #abcd #11223380 #ffffff00');
  assert.deepEqual(
    colors.map((color) => color.hex),
    ['#AABBCC', '#AABBCCDD', '#11223380', '#FFFFFF00']
  );
  assert.equal(colors[1].alpha, 221 / 255);
  assert.equal(colors[2].alpha, 128 / 255);
  assert.equal(colors[3].alpha, 0);
  assert.equal(colors[3].opacity, '0%');
});

test('ignores hashes and identifiers that are not whole color literals', () => {
  for (const source of [
    '#ff',
    '#fffff',
    '#fffffff',
    '#fffffffff',
    '#FFFFFFoops',
    '#fff-id',
    '#1234567890abcdef',
    'item#fff',
    '##fff',
    'é#fff',
    'myrgb(1, 2, 3)',
    'rgba(1, 2, 3)name',
    'red blue transparent',
  ]) {
    assert.deepEqual(findColorValues(source), [], source);
  }
});

test('accepts legacy and modern RGB syntax, percentages, and function aliases', () => {
  for (const source of [
    'rgb(255, 0, 128)',
    'RGBA(255, 0, 128, 1)',
    'rgb(100%, 0%, 50.1960784314%)',
    'rgba(255 0 128)',
    'rgb(100% 0 128 / 100%)',
    'rgb(2.55e2 0 128)',
  ]) {
    assert.equal(findColorValues(source)[0]?.hex, '#FF0080', source);
  }
  assert.equal(findColorValues('rgba(255, 0, 128, .5)')[0]?.hex, '#FF008080');
  assert.equal(findColorValues('rgb(255 0 128 / 50%)')[0]?.opacity, '50%');
});

test('converts HSL hue units and wraps negative and overflowing angles', () => {
  for (const source of [
    'hsl(120, 100%, 50%)',
    'hsl(120deg 100% 50%)',
    'hsl(120 100 50)',
    'hsl(120 100% 50)',
    'hsla(-240deg 100% 50%)',
    'hsl(480 100% 50%)',
    'hsl(.333333333333turn 100% 50%)',
    'hsl(133.333333333grad 100% 50%)',
    `hsl(${(2 * Math.PI) / 3}rad 100% 50%)`,
  ]) {
    assert.equal(findColorValues(source)[0]?.hex, '#00FF00', source);
  }
  assert.equal(
    findColorValues('hsla(240, 100%, 50%, .25)')[0]?.hex,
    '#0000FF40'
  );
});

test('color information names the same RGB, HSL, and opacity as the swatch', () => {
  const white = findColorValues('#FFFFFF')[0];
  assert.equal(white.rgb, 'rgb(255 255 255)');
  assert.equal(white.hsl, 'hsl(0 0% 100%)');
  assert.equal(white.opacity, '100%');
  const red = findColorValues('#ff000080')[0];
  assert.equal(red.rgb, 'rgb(255 0 0 / 50.2%)');
  assert.equal(red.hsl, 'hsl(0 100% 50% / 50.2%)');
  assert.equal(findColorValues('#808080')[0].hsl, 'hsl(0 0% 50.2%)');
});

test('clamps channels and opacity as CSS does', () => {
  assert.equal(findColorValues('rgb(300 -20 128 / 150%)')[0]?.hex, '#FF0080');
  assert.equal(findColorValues('rgba(-1, 256, 0, -1)')[0]?.hex, '#00FF0000');
  assert.equal(findColorValues('hsl(0 150% 50%)')[0]?.hex, '#FF0000');
});

test('rejects malformed functions and unresolved expressions', () => {
  for (const source of [
    'rgb()',
    'rgb(1,2)',
    'rgb(1 2 3 4)',
    'rgb(1,2,3,)',
    'rgb(1,2,3,4,5)',
    'rgb(1, 2%, 3)',
    'rgb(1,2,3 / .5)',
    'rgb(1 2 3 / .5 / .7)',
    'rgb(1deg 2 3)',
    'rgb(1 2 3 / 2deg)',
    'rgb(1e999 2 3)',
    'hsl(20px 30% 40%)',
    'hsl(20, 30, 40)',
    'hsl(20% 30% 40%)',
    'rgba(NaN, 0, 0, 1)',
    'rgb(var(--red) 0 0)',
    'hsl(calc(20 + 30) 40% 50%)',
    'rgb(from red r g b)',
  ]) {
    assert.deepEqual(findColorValues(source), [], source);
  }
});

test('repeated scans do not share regex state or change the source', () => {
  const line = 'background: linear-gradient(#123, rgba(0, 0, 0, .5));';
  const first = findColorValues(line);
  assert.deepEqual(findColorValues(line), first);
  assert.equal(first.length, 2);
  assert.deepEqual(findColorValues('no colors'), []);
  assert.deepEqual(findColorValues(line), first);
});
