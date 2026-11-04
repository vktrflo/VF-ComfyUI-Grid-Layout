import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../web/core/layout.js';
import { LayoutController } from '../web/core/controller.js';
import { LayoutOverlay, MENU_ICONS } from '../web/core/overlay.js';

test('deleteEmptyCells removes only empty leaves and keeps surviving cells', () => {
  const f = engine.createFrame();
  engine.gridCell(f, f.root.id, 1, 3);
  const [a, b, c] = engine.leaves(f.root);
  a.nodes = [1];
  c.nodes = [3];
  assert.equal(b.nodes.length, 0);

  const removed = engine.deleteEmptyCells(f);

  assert.equal(removed, 1);
  const cells = engine.leaves(f.root);
  assert.deepEqual(cells.map(cell => cell.id), [a.id, c.id]);
  assert.deepEqual(cells.map(cell => cell.nodes), [[1], [3]]);
  assert.ok(Math.abs(f.root.ratios.reduce((sum, ratio) => sum + ratio, 0) - 1) < 1e-9);
  assert.doesNotThrow(() => engine.validateFrame(f));
});

test('deleteEmptyCells collapses nested splits that hold only empty leaves', () => {
  const f = engine.createFrame();
  engine.gridCell(f, f.root.id, 2, 2);
  const [topLeft] = engine.leaves(f.root);
  topLeft.nodes = [7];

  const removed = engine.deleteEmptyCells(f);

  assert.equal(removed, 3);
  const cells = engine.leaves(f.root);
  assert.equal(cells.length, 1);
  assert.equal(cells[0].id, topLeft.id);
  assert.deepEqual(cells[0].nodes, [7]);
  assert.equal(f.root.children, undefined);
});

test('deleteEmptyCells refuses a grid with no empty cells', () => {
  const f = engine.createFrame();
  engine.gridCell(f, f.root.id, 1, 2);
  for (const cell of engine.leaves(f.root)) cell.nodes = [1];

  assert.throws(() => engine.deleteEmptyCells(f), /no empty cells/);
});

test('deleteEmptyCells refuses to remove every cell', () => {
  const f = engine.createFrame();
  engine.gridCell(f, f.root.id, 1, 2);
  const before = JSON.stringify(f.root);

  assert.throws(() => engine.deleteEmptyCells(f), /no cells with nodes/);
  assert.equal(JSON.stringify(f.root), before, 'the tree is untouched');
});

test('cell menu exposes Delete Empty Cells and prunes through controller.edit', () => {
  const make = id => ({ id, pos: [id * 300, 0], size: [200, 100], mode: 0, computeSize: () => [200, 80], setSize(size) { this.size = size; } });
  const nodes = [make(1), make(2), make(3)];
  const graph = {
    extra: {},
    _nodes: nodes,
    getNodeById: id => nodes.find(node => String(node.id) === String(id)) ?? null,
    setDirtyCanvas() {},
  };
  const app = { configuringGraph: false, graph, canvas: { graph, ds: { scale: 1, offset: [0, 0] }, setDirty() {} } };
  const controller = new LayoutController(app);
  const frame = controller.createFromNodes([1, 2, 3], 'columns');
  const cells = engine.leaves(frame.root);
  cells[1].nodes = [];

  const overlay = Object.create(LayoutOverlay.prototype);
  Object.assign(overlay, { controller, app, safe: fn => fn(), menu: null });
  let actions = null;
  overlay.showMenu = (_event, list) => { actions = list; };
  overlay.cellMenu({ clientX: 0, clientY: 0 }, frame.id, cells[0].id);

  const entry = actions.find(([label]) => label === 'Delete Empty Cells');
  assert.ok(entry, 'expected a Delete Empty Cells menu entry');
  assert.ok(MENU_ICONS['Delete Empty Cells'], 'expected a MENU_ICONS entry');
  entry[1]();

  assert.deepEqual(engine.leaves(frame.root).map(cell => cell.nodes), [[1], [3]]);
});

test('grid menu exposes Delete Empty Cells and prunes the whole frame', () => {
  const make = id => ({ id, pos: [id * 300, 0], size: [200, 100], mode: 0, computeSize: () => [200, 80], setSize(size) { this.size = size; } });
  const nodes = [make(1), make(2), make(3)];
  const graph = {
    extra: {},
    _nodes: nodes,
    getNodeById: id => nodes.find(node => String(node.id) === String(id)) ?? null,
    setDirtyCanvas() {},
  };
  const app = { configuringGraph: false, graph, canvas: { graph, ds: { scale: 1, offset: [0, 0] }, setDirty() {} } };
  const controller = new LayoutController(app);
  const frame = controller.createFromNodes([1, 2, 3], 'columns');
  const cells = engine.leaves(frame.root);
  cells[2].nodes = [];

  const overlay = Object.create(LayoutOverlay.prototype);
  Object.assign(overlay, { controller, app, safe: fn => fn(), menu: null });
  const entry = overlay.frameActions(frame, { includeToggles: true }).find(([label]) => label === 'Delete Empty Cells');
  assert.ok(entry, 'expected a Delete Empty Cells entry in the grid menu');

  entry[1]();
  assert.deepEqual(engine.leaves(frame.root).map(cell => cell.nodes), [[1], [2]]);
});
