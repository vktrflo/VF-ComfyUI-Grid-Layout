import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../web/core/layout.js';

test('normalizeColor normalizes valid forms and drops junk without throwing', () => {
  assert.equal(engine.normalizeColor('#A1B2C3'), '#a1b2c3');
  assert.equal(engine.normalizeColor('a1b2c3'), '#a1b2c3');
  assert.equal(engine.normalizeColor('#abc'), '#aabbcc');
  assert.equal(engine.normalizeColor('ABC'), '#aabbcc');
  for (const bad of [undefined, null, 42, 'red', '#12', '#1234567', '#gggggg', '', 'rgb(0,0,0)']) {
    assert.equal(engine.normalizeColor(bad), undefined, `expected ${String(bad)} to be rejected`);
  }
});

test('validateFrame keeps valid frame and cell colors and drops invalid ones', () => {
  const frame = engine.createFrame([10, 20]);
  frame.color = '#123AbC';
  engine.splitCell(frame, frame.root.id, 'x');
  frame.root.children[0].color = 'ff0000';
  frame.root.children[1].color = 'not-a-color';
  const validated = engine.validateFrame(frame);
  assert.equal(validated.color, '#123abc');
  assert.equal(validated.root.children[0].color, '#ff0000');
  assert.equal('color' in validated.root.children[1], false);

  const plain = engine.createFrame([0, 0]);
  plain.color = 'red';
  assert.equal('color' in engine.validateFrame(plain), false);
});

test('template round trips preserve frame and cell colors with fresh ids', () => {
  const frame = engine.createFrame([10, 20]);
  frame.color = '#112233';
  engine.gridCell(frame, frame.root.id, 1, 2);
  frame.root.children[0].color = '#AABBCC';
  const template = engine.exportTemplate(frame);
  assert.equal(template.frame.color, '#112233');
  assert.equal(template.frame.root.children[0].color, '#aabbcc');
  const restored = engine.importTemplate(JSON.parse(JSON.stringify(template)), [5, 6]);
  assert.notEqual(restored.id, frame.id);
  assert.equal(restored.color, '#112233');
  assert.equal(restored.root.children[0].color, '#aabbcc');
});

test('splitting or gridding a colored cell moves the color to the first leaf', () => {
  const split = engine.createFrame();
  split.root.color = '#abcdef';
  engine.splitCell(split, split.root.id, 'x');
  assert.equal('color' in split.root, false);
  assert.equal(split.root.children[0].color, '#abcdef');
  assert.equal('color' in split.root.children[1], false);

  const grid = engine.createFrame();
  grid.root.color = '#abcdef';
  engine.gridCell(grid, grid.root.id, 2, 2);
  assert.equal('color' in grid.root, false);
  assert.equal(engine.leaves(grid.root)[0].color, '#abcdef');
});
