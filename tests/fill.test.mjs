import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../web/core/layout.js';
import { NodeAdapter } from '../web/core/adapter.js';

const { PAD, CELL_TITLE } = engine;
const metric = (minWidth, height, minHeight = height, extra = {}) => ({ minWidth, height, minHeight, collapsed: false, titleHeight: 30, ...extra });

const twoColumn = (fill) => {
  const frame = engine.createFrame([0, 0]);
  if (fill) frame.fill = true;
  engine.splitCell(frame, frame.root.id, 'x');
  const [left, right] = engine.leaves(frame.root);
  left.nodes = ['tall'];
  right.nodes = ['short'];
  return { frame };
};

test('validateFrame keeps frame and leaf cell fill true and drops everything else', () => {
  const frame = engine.createFrame([1, 2]);
  frame.fill = true;
  frame.color = '#abcdef';
  const validated = engine.validateFrame(frame);
  assert.equal(validated.fill, true);
  assert.equal(validated.color, '#abcdef');

  for (const bad of [false, 'yes', 1, null, undefined]) {
    const f = engine.createFrame([0, 0]);
    f.fill = bad;
    f.root.fill = bad;
    const clean = engine.validateFrame(f);
    assert.equal('fill' in clean, false, `expected ${String(bad)} on frame to be dropped`);
    assert.equal('fill' in clean.root, false, `expected ${String(bad)} on leaf to be dropped`);
  }

  const cells = engine.createFrame([0, 0]);
  engine.splitCell(cells, cells.root.id, 'x');
  cells.root.fill = true; // a fill on a split cell is dropped
  cells.root.children[0].fill = true; // a fill on a leaf cell is preserved
  const clean = engine.validateFrame(cells);
  assert.equal('fill' in clean.root, false);
  assert.equal(clean.root.children[0].fill, true);
  assert.equal('fill' in clean.root.children[1], false);
});

test('per-column (leaf cell) fill stretches only that column and carries to the first child on split', () => {
  const { frame } = twoColumn(false);
  const [left, right] = engine.leaves(frame.root);
  left.nodes = ['tall'];
  right.nodes = ['a', 'b'];
  right.fill = true;

  const metrics = new Map([['tall', metric(200, 300)], ['a', metric(200, 120)], ['b', metric(200, 100, 60)]]);
  const { cells, placements } = engine.layoutFrame(frame, metrics);
  const tall = placements.find(p => p.nodeId === 'tall');
  const b = placements.find(p => p.nodeId === 'b');
  const rightRect = cells.find(({ cell }) => cell.id === right.id).rect;
  assert.equal('fill' in tall, false, 'unfilled left column is not marked owned');
  assert.equal(b.fill, true, 'filled right column bottom node is owned');
  assert.equal(b.y + b.height, rightRect[1] + rightRect[3] - PAD, 'filled column stretches flush to floor');

  engine.splitCell(frame, right.id, 'y');
  assert.equal('fill' in right, false, 'split parent drops fill');
  assert.equal(right.children[0].fill, true, 'first child inherits fill');
});

test('frame fill survives splits and grids unchanged', () => {
  const frame = engine.createFrame([0, 0]);
  frame.fill = true;
  engine.splitCell(frame, frame.root.id, 'x');
  assert.equal(frame.fill, true);
  assert.equal('fill' in frame.root, false);
  engine.gridCell(frame, frame.root.children[1].id, 2, 2);
  assert.equal(engine.validateFrame(frame).fill, true);
});

test('template round trips preserve frame fill with fresh ids', () => {
  const frame = engine.createFrame([10, 20]);
  frame.fill = true;
  engine.gridCell(frame, frame.root.id, 1, 2);
  const template = engine.exportTemplate(frame);
  assert.equal(template.frame.fill, true);
  const restored = engine.importTemplate(JSON.parse(JSON.stringify(template)), [5, 6]);
  assert.notEqual(restored.id, frame.id);
  assert.equal(restored.fill, true);
});

test('frame fill stretches each bottom node flush to its cell floor', () => {
  const { frame } = twoColumn(true);
  const metrics = new Map([['tall', metric(200, 300)], ['short', metric(200, 100, 60)]]);
  const { cells, placements } = engine.layoutFrame(frame, metrics);
  const rect = cells.find(({ cell }) => cell.nodes[0] === 'short').rect;
  const short = placements.find(p => p.nodeId === 'short');
  const tall = placements.find(p => p.nodeId === 'tall');
  assert.equal(tall.height, 300, 'the taller column keeps its intrinsic height (anchor)');
  assert.equal(short.y, rect[1] + CELL_TITLE + PAD + 30);
  assert.equal(short.y + short.height, rect[1] + rect[3] - PAD, 'bottom edge lands on the content floor');
  assert.equal(short.height, rect[3] - CELL_TITLE - PAD * 2 - 30, 'height absorbs all spare space');
  assert.equal(short.fill, true, 'the ownership marker is set on the bottom placement');
  assert.equal(tall.fill, true, 'every filled-frame bottom node is owned');

  const plain = twoColumn(false);
  const off = engine.layoutFrame(plain.frame, metrics).placements.find(p => p.nodeId === 'short');
  assert.equal(off.height, 100, 'flag off leaves the intrinsic height (gap below)');
});

test('only the bottom node grows in a filled frame', () => {
  const frame = engine.createFrame([0, 0]);
  frame.fill = true;
  engine.splitCell(frame, frame.root.id, 'x');
  const [left, right] = engine.leaves(frame.root);
  left.nodes = ['tall'];
  right.nodes = ['a', 'b'];
  const metrics = new Map([['tall', metric(200, 300)], ['a', metric(200, 120)], ['b', metric(200, 100, 60)]]);
  const { cells, placements } = engine.layoutFrame(frame, metrics);
  assert.equal(placements.find(p => p.nodeId === 'a').height, 120, 'upper node keeps its height');
  const b = placements.find(p => p.nodeId === 'b');
  const rect = cells.find(({ cell }) => cell.nodes.length === 2).rect;
  assert.equal(b.y + b.height, rect[1] + rect[3] - PAD);
  assert.ok(b.height > 60, 'bottom node absorbs the spare space');
});

test('a lone filled cell keeps its node at its intrinsic height', () => {
  const frame = engine.createFrame([0, 0]);
  frame.fill = true;
  frame.root.nodes = ['solo'];
  const { cells, placements } = engine.layoutFrame(frame, new Map([['solo', metric(200, 200, 60)]]));
  const solo = placements.find(p => p.nodeId === 'solo');
  assert.equal(solo.height, 200, 'no collapse to the minimum when nothing is taller');
  assert.equal(solo.y + solo.height, cells[0].rect[1] + cells[0].rect[3] - PAD, 'still ends on the floor');
});

test('collapsed bottom nodes do not stretch and empty filled cells are no-ops', () => {
  const { frame } = twoColumn(true);
  const metrics = new Map([['tall', metric(200, 300)], ['short', metric(200, 0, 0, { collapsed: true })]]);
  const { placements } = engine.layoutFrame(frame, metrics);
  const short = placements.find(p => p.nodeId === 'short');
  assert.equal(short.height, 0);
  assert.equal('fill' in short, false);

  const empty = engine.createFrame([0, 0]);
  empty.fill = true;
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
  // A fresh measurement reports the intrinsic height again (the adapter masks
  // our stretch), so the layout must not grow tick over tick.
  const remeasured = new Map([['tall', metric(200, 300)], ['short', metric(200, 100, 60)]]);
  const third = engine.layoutFrame(frame, remeasured);
  assert.equal(third.placements.find(p => p.nodeId === 'short').height, stretched, 'no feedback growth');
});

let fakeId = 0;
const fakeNode = (width, height, minHeight) => ({
  id: `fake-${++fakeId}`,
  pos: [0, 0], size: [width, height], flags: {},
  computeSize: () => [width, minHeight],
});

test('adapter reports intrinsic height while a fill stretch is applied', () => {
  const adapter = new NodeAdapter({});
  const node = fakeNode(200, 100, 80);
  assert.equal(adapter.measure(node).height, 100, 'initial intrinsic is the node size');
  adapter.apply(node, { x: 0, y: 0, width: 200, height: 300, fill: true });
  assert.equal(node.size[1], 300, 'the stretch is applied to the node');
  assert.equal(adapter.measure(node).height, 100, 'measure still reports the intrinsic height');
  node.size = [200, 250]; // foreign change (the user resized)
  assert.equal(adapter.measure(node).height, 250, 'a foreign size becomes the new base');
});

test('releaseFill restores the base, respects foreign changes, and falls back to the minimum', () => {
  const adapter = new NodeAdapter({});
  const node = fakeNode(200, 100, 80);
  adapter.measure(node);
  adapter.apply(node, { x: 0, y: 0, width: 200, height: 300, fill: true });
  adapter.releaseFill(node);
  assert.equal(node.size[1], 100, 'stretch reverts to the pre-fill height');

  const pushed = fakeNode(200, 100, 80);
  adapter.measure(pushed);
  adapter.apply(pushed, { x: 0, y: 0, width: 200, height: 300, fill: true });
  pushed.size = [200, 250]; // the user changed it after the stretch
  adapter.measure(pushed);
  adapter.releaseFill(pushed);
  assert.equal(pushed.size[1], 250, 'a foreign change is left alone');

  const reloaded = fakeNode(200, 420, 80);
  adapter.measure(reloaded);
  adapter.releaseFill(reloaded);
  assert.equal(reloaded.size[1], 80, 'no tracked stretch -> falls back to the natural minimum');
});

test('tracking survives node instance swaps (undo/redo restores fresh objects)', () => {
  const adapter = new NodeAdapter({});
  const first = fakeNode(200, 100, 80);
  adapter.measure(first);
  adapter.apply(first, { x: 0, y: 0, width: 200, height: 300, fill: true });
  // Undo/redo re-creates the node object with the same id, carrying the
  // stretched size baked into the restored state.
  const second = fakeNode(200, 300, 80);
  second.id = first.id;
  assert.equal(adapter.measure(second).height, 100, 'the intrinsic base survives the swap');
  adapter.releaseFill(second);
  assert.equal(second.size[1], 100, 'release still reverts to the pre-stretch height');
});
