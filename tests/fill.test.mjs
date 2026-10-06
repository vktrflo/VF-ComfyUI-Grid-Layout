import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../web/core/layout.js';

const { PAD, CELL_TITLE } = engine;
const metric = (minWidth, height, minHeight = height, extra = {}) => ({ minWidth, height, minHeight, collapsed: false, titleHeight: 30, ...extra });

const twoColumn = (fill) => {
  const frame = engine.createFrame([0, 0]);
  engine.splitCell(frame, frame.root.id, 'x');
  const [left, right] = engine.leaves(frame.root);
  left.nodes = ['tall'];
  right.nodes = ['short'];
  if (fill) right.fill = true;
  return { frame };
};

test('validateFrame keeps fill true on leaves and drops everything else', () => {
  const frame = engine.createFrame([1, 2]);
  frame.root.fill = true;
  frame.root.color = '#abcdef';
  const validated = engine.validateFrame(frame);
  assert.equal(validated.root.fill, true);
  assert.equal(validated.root.color, '#abcdef');

  for (const bad of [false, 'yes', 1, null, undefined]) {
    const f = engine.createFrame([0, 0]);
    f.root.fill = bad;
    assert.equal('fill' in engine.validateFrame(f), false, `expected ${String(bad)} to be dropped`);
  }

  const split = engine.createFrame([0, 0]);
  engine.splitCell(split, split.root.id, 'x');
  split.root.fill = true; // stray flag on a split node
  assert.equal('fill' in engine.validateFrame(split).root, false);
});

test('splitting or gridding a filled cell carries fill to the first leaf', () => {
  const split = engine.createFrame();
  split.root.fill = true;
  engine.splitCell(split, split.root.id, 'x');
  assert.equal('fill' in split.root, false);
  assert.equal(split.root.children[0].fill, true);
  assert.equal('fill' in split.root.children[1], false);

  const grid = engine.createFrame();
  grid.root.fill = true;
  engine.gridCell(grid, grid.root.id, 2, 2);
  assert.equal('fill' in grid.root, false);
  assert.equal(engine.leaves(grid.root)[0].fill, true);
});

test('template round trips preserve fill with fresh ids', () => {
  const frame = engine.createFrame([10, 20]);
  engine.gridCell(frame, frame.root.id, 1, 2);
  frame.root.children[1].fill = true;
  const template = engine.exportTemplate(frame);
  assert.equal(template.frame.root.children[1].fill, true);
  const restored = engine.importTemplate(JSON.parse(JSON.stringify(template)), [5, 6]);
  assert.notEqual(restored.id, frame.id);
  assert.equal(restored.root.children[1].fill, true);
});

test('a filled cell stretches its bottom node flush to the content floor', () => {
  const { frame } = twoColumn(true);
  const metrics = new Map([['tall', metric(200, 300)], ['short', metric(200, 100, 60)]]);
  const { cells, placements } = engine.layoutFrame(frame, metrics);
  const rect = cells.find(({ cell }) => cell.nodes[0] === 'short').rect;
  const short = placements.find(p => p.nodeId === 'short');
  const tall = placements.find(p => p.nodeId === 'tall');
  assert.equal(tall.height, 300, 'non-filled sibling column unchanged');
  assert.equal(short.y, rect[1] + CELL_TITLE + PAD + 30);
  assert.equal(short.y + short.height, rect[1] + rect[3] - PAD, 'bottom edge lands on the content floor');
  assert.equal(short.height, rect[3] - CELL_TITLE - PAD * 2 - 30, 'height absorbs all spare space');

  const plain = twoColumn(false);
  const off = engine.layoutFrame(plain.frame, metrics).placements.find(p => p.nodeId === 'short');
  assert.equal(off.height, 100, 'flag off leaves the measured height (gap below)');
});

test('only the bottom node grows in a filled cell', () => {
  const frame = engine.createFrame([0, 0]);
  engine.splitCell(frame, frame.root.id, 'x');
  const [left, right] = engine.leaves(frame.root);
  left.nodes = ['tall'];
  right.nodes = ['a', 'b'];
  right.fill = true;
  const metrics = new Map([['tall', metric(200, 300)], ['a', metric(200, 120)], ['b', metric(200, 100, 60)]]);
  const { cells, placements } = engine.layoutFrame(frame, metrics);
  assert.equal(placements.find(p => p.nodeId === 'a').height, 120, 'upper node keeps its measured height');
  const b = placements.find(p => p.nodeId === 'b');
  const rect = cells.find(({ cell }) => cell.nodes.length === 2).rect;
  assert.equal(b.y + b.height, rect[1] + rect[3] - PAD);
  assert.ok(b.height > 60, 'bottom node absorbs the spare space');
});

test('collapsed bottom nodes do not stretch and empty filled cells are no-ops', () => {
  const { frame } = twoColumn(true);
  const metrics = new Map([['tall', metric(200, 300)], ['short', metric(200, 0, 0, { collapsed: true })]]);
  const { placements } = engine.layoutFrame(frame, metrics);
  assert.equal(placements.find(p => p.nodeId === 'short').height, 0);

  const empty = engine.createFrame([0, 0]);
  empty.root.fill = true;
  const layout = engine.layoutFrame(empty, new Map());
  assert.equal(layout.cells.length, 1);
  assert.equal(layout.placements.length, 0);
});

test('repeated layouts are idempotent, including after re-measurement', () => {
  const { frame } = twoColumn(true);
  const metrics = new Map([['tall', metric(200, 300)], ['short', metric(200, 100, 60)]]);
  const first = engine.layoutFrame(frame, metrics);
  const second = engine.layoutFrame(frame, metrics);
  assert.deepEqual(second.placements, first.placements);
  const stretched = first.placements.find(p => p.nodeId === 'short').height;
  const remeasured = new Map([['tall', metric(200, 300)], ['short', metric(200, stretched, 60)]]);
  const third = engine.layoutFrame(frame, remeasured);
  assert.equal(third.placements.find(p => p.nodeId === 'short').height, stretched, 'no feedback growth');
});
