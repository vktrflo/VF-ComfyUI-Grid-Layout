import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../web/core/layout.js';
import { contrastColor } from '../web/core/overlay.js';

test('normalizeColor normalizes valid forms and drops junk without throwing', () => {
  assert.equal(engine.normalizeColor('#A1B2C3'), '#a1b2c3');
  assert.equal(engine.normalizeColor('a1b2c3'), '#a1b2c3');
  assert.equal(engine.normalizeColor('#abc'), '#aabbcc');
  assert.equal(engine.normalizeColor('ABC'), '#aabbcc');
  for (const bad of [undefined, null, 42, 'red', '#12', '#1234567', '#gggggg', '', 'rgb(0,0,0)', ' #abc', '#abc ']) {
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
  assert.ok(engine.leaves(grid.root).slice(1).every(leaf => !('color' in leaf)));
});

test('validateFrame drops a stray color on a split node', () => {
  const frame = engine.createFrame();
  engine.splitCell(frame, frame.root.id, 'x');
  frame.root.color = '#ffffff';
  assert.equal('color' in engine.validateFrame(frame).root, false);
});

test('deleting a cell keeps survivor colors and drops the deleted color', () => {
  const frame = engine.createFrame();
  engine.splitCell(frame, frame.root.id, 'x');
  const [keeper, doomed] = frame.root.children;
  keeper.color = '#aabbcc';
  doomed.color = '#dead00';
  engine.deleteCell(frame, doomed.id);
  assert.equal(frame.root, keeper);
  assert.equal(frame.root.color, '#aabbcc');
});

test('contrastColor picks readable label text for header colors', () => {
  assert.equal(contrastColor('#ffffff'), '#101418');
  assert.equal(contrastColor('#000000'), '#f4f6f7');
  assert.equal(contrastColor('#70d8be'), '#101418');
  assert.equal(contrastColor('#20282c'), '#f4f6f7');
});

test('contrastColor picks the higher-contrast label for saturated colors', () => {
  assert.equal(contrastColor('#00ff00'), '#101418');
  assert.equal(contrastColor('#999999'), '#101418');
  assert.equal(contrastColor('#ff6600'), '#101418');
});

test('validateFrame keeps text color and clamps font size, dropping junk', () => {
  const frame = engine.createFrame([10, 20]);
  frame.color = '#123abc';
  frame.fill = true;
  frame.lock = true;
  frame.textColor = '#AB12CD';
  frame.fontSize = 40;
  engine.splitCell(frame, frame.root.id, 'x');
  frame.root.children[0].textColor = 'ff0000';
  frame.root.children[0].fontSize = 9.6;
  frame.root.children[1].textColor = 'nope';
  frame.root.children[1].fontSize = 'big';
  const validated = engine.validateFrame(frame);
  assert.equal(validated.textColor, '#ab12cd');
  assert.equal(validated.fontSize, 24, 'out-of-range sizes clamp');
  assert.equal(validated.color, '#123abc');
  assert.equal(validated.fill, true);
  assert.equal(validated.lock, true);
  assert.equal(validated.root.children[0].textColor, '#ff0000');
  assert.equal(validated.root.children[0].fontSize, 10, 'sizes round');
  assert.equal('textColor' in validated.root.children[1], false);
  assert.equal('fontSize' in validated.root.children[1], false);

  const plain = engine.createFrame([0, 0]);
  assert.equal('textColor' in engine.validateFrame(plain), false);
  assert.equal('fontSize' in engine.validateFrame(plain), false);
});

test('text color and font size survive splits, grids, and template round trips', () => {
  const frame = engine.createFrame([10, 20]);
  frame.root.textColor = '#112233';
  frame.root.fontSize = 18;
  engine.splitCell(frame, frame.root.id, 'x');
  assert.equal('textColor' in frame.root, false);
  assert.equal('fontSize' in frame.root, false);
  assert.equal(frame.root.children[0].textColor, '#112233');
  assert.equal(frame.root.children[0].fontSize, 18);
  assert.equal('textColor' in frame.root.children[1], false);

  const grid = engine.createFrame();
  grid.root.textColor = '#abcdef';
  grid.root.fontSize = 10;
  engine.gridCell(grid, grid.root.id, 2, 2);
  assert.equal(engine.leaves(grid.root)[0].textColor, '#abcdef');
  assert.equal(engine.leaves(grid.root)[0].fontSize, 10);
  assert.ok(engine.leaves(grid.root).slice(1).every(leaf => !('textColor' in leaf) && !('fontSize' in leaf)));

  const travel = engine.createFrame([10, 20]);
  travel.textColor = '#112233';
  travel.fontSize = 18;
  engine.splitCell(travel, travel.root.id, 'x');
  travel.root.children[0].fontSize = 12;
  const template = engine.exportTemplate(travel);
  assert.equal(template.frame.textColor, '#112233');
  assert.equal(template.frame.fontSize, 18);
  assert.equal(template.frame.root.children[0].fontSize, 12);
  const restored = engine.importTemplate(JSON.parse(JSON.stringify(template)), [5, 6]);
  assert.equal(restored.textColor, '#112233');
  assert.equal(restored.fontSize, 18);
  assert.equal(restored.root.children[0].fontSize, 12);
});
