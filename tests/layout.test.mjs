import test from 'node:test';
import assert from 'node:assert/strict';

const engine = await import('../web/core/layout.js').catch(() => ({}));
const fixture = () => {
  assert.equal(typeof engine.createFrame, 'function', 'layout engine must be implemented');
  return engine.createFrame([100, 200]);
};
const metrics = new Map([[1, { minWidth: 250, height: 100, titleHeight: 30 }], [2, { minWidth: 340, height: 200, titleHeight: 30 }]]);

test('multiple nodes fill width and stack without clipping titles or controls', () => {
  const frame = fixture();
  frame.root.nodes = [1, 2];
  const { placements, cells } = engine.layoutFrame(frame, metrics);
  assert.equal(placements.length, 2);
  assert.equal(placements[0].width, cells[0].rect[2] - 24);
  assert.ok(placements[1].y - 30 >= placements[0].y + 100 + 12);
  assert.ok(placements[1].y + 200 <= cells[0].rect[1] + cells[0].rect[3] - 12);
});

test('nested split ratios grow the frame to respect every child minimum', () => {
  const frame = fixture();
  frame.root.nodes = [1, 2];
  engine.splitCell(frame, frame.root.id, 'x');
  frame.root.ratios = [0.2, 0.8];
  engine.splitCell(frame, frame.root.children[0].id, 'y');
  const result = engine.layoutFrame(frame, metrics);
  assert.ok(frame.size[0] >= (340 + 24) / 0.2);
  assert.equal(result.placements.length, 2);
  assert.equal(frame.root.children[0].children[1].nodes.length, 0);
});

test('grid preserves populated stack only in first cell and permits nested splits', () => {
  const frame = fixture();
  frame.root.nodes = [1, 2];
  engine.gridCell(frame, frame.root.id, 2, 3);
  let cells = engine.layoutFrame(frame, metrics).cells;
  assert.equal(cells.length, 6);
  assert.deepEqual(cells[0].cell.nodes, [1, 2]);
  assert.ok(cells.slice(1).every(({ cell }) => cell.nodes.length === 0));
  engine.splitCell(frame, cells[5].cell.id, 'x');
  assert.equal(engine.layoutFrame(frame, metrics).cells.length, 7);
});

test('drop transfers membership exactly once and respects insertion order', () => {
  const a = fixture(), b = fixture();
  a.root.nodes = [1]; b.root.nodes = [2];
  engine.dropNodes([a, b], b.id, b.root.id, [1], 0);
  assert.deepEqual(a.root.nodes, []);
  assert.deepEqual(b.root.nodes, [1, 2]);
  engine.dropNodes([a, b], b.id, b.root.id, [1], 1);
  assert.deepEqual(b.root.nodes, [2, 1]);
  engine.dropNodes([a, b], null, null, [1]);
  assert.deepEqual(b.root.nodes, [2]);
});

test('templates contain only empty structure and instantiate fresh IDs at chosen position', () => {
  const frame = fixture(); frame.root.nodes = [1, 2];
  engine.gridCell(frame, frame.root.id, 2, 2);
  const template = engine.exportTemplate(frame);
  assert.ok(engine.leaves(template.frame.root).every(c => c.nodes.length === 0));
  const restored = engine.importTemplate(JSON.parse(JSON.stringify(template)), [50, 60]);
  assert.notEqual(restored.id, frame.id);
  assert.deepEqual(restored.pos, [50, 60]);
  assert.equal(engine.leaves(restored.root).length, 4);
  assert.equal(JSON.stringify(frame).includes('"nodes":[1,2]'), true);
});

test('malformed, oversized, and future-version templates fail before modifying a workflow', () => {
  fixture();
  for (const value of [null, {}, { version: 999 }, { version: 1, kind: 'comfyui-layout-template', frame: { size: [1, 1], root: { axis: 'z' } } }]) {
    assert.throws(() => engine.importTemplate(value, [0, 0]));
  }
  const frame = fixture();
  assert.throws(() => engine.gridCell(frame, frame.root.id, 0, 2));
  assert.throws(() => engine.gridCell(frame, frame.root.id, 1000, 2));
});

test('missing nodes are pruned without losing other nodes; layout is idempotent', () => {
  const frame = fixture(); frame.root.nodes = [1, 999];
  const first = engine.layoutFrame(frame, metrics);
  assert.deepEqual(frame.root.nodes, [1]);
  assert.deepEqual(engine.layoutFrame(frame, metrics), first);
});

test('small imported split ratios remain positive after divider movement and round trip', () => {
  const frame = fixture(); engine.gridCell(frame, frame.root.id, 1, 3);
  frame.root.ratios = [0.01, 0.01, 1];
  const imported = engine.importTemplate(engine.exportTemplate(frame), [0, 0]);
  assert.equal(typeof engine.resizeDivider, 'function');
  engine.resizeDivider(imported.root, 0, 0.5);
  assert.ok(imported.root.ratios.every(r => r > 0));
  assert.ok(engine.layoutFrame(imported, new Map()).cells.every(c => c.rect[2] > 0));
  assert.doesNotThrow(() => engine.exportTemplate(imported));
});

test('nested split and grid construction obey the same depth limit as export', () => {
  const frame = fixture();
  let cell = frame.root;
  for (let depth = 0; depth < 16; depth++) {
    engine.splitCell(frame, cell.id, depth % 2 ? 'y' : 'x'); cell = cell.children[0];
  }
  assert.doesNotThrow(() => engine.exportTemplate(frame));
  assert.throws(() => engine.splitCell(frame, cell.id, 'y'), /depth|nested/i);
  assert.throws(() => engine.gridCell(frame, cell.id, 2, 2), /depth|nested/i);
});

test('extreme ratios and growth fail without persisting infinite dimensions', () => {
  const frame = fixture(); engine.splitCell(frame, frame.root.id, 'x');
  frame.root.ratios = [1e-320, 1];
  const initialSize = [...frame.size];
  assert.throws(() => engine.layoutFrame(frame, new Map()), /dimensions|large|finite/i);
  assert.deepEqual(frame.size, initialSize);
  assert.throws(() => engine.importTemplate({ kind: 'comfyui-layout-template', version: 1, frame }, [0, 0]));
});

test('adding a bottom row preserves existing cells, nodes, and their geometry', () => {
  const frame = fixture(); frame.root.nodes = [1, 2];
  engine.splitCell(frame, frame.root.id, 'x');
  const before = engine.layoutFrame(frame, metrics);
  const rootId = frame.root.id, size = [...frame.size];
  assert.equal(typeof engine.addBottomRow, 'function');
  engine.addBottomRow(frame);
  const after = engine.layoutFrame(frame, metrics);
  assert.equal(frame.root.axis, 'y');
  assert.equal(frame.root.children[0].id, rootId);
  assert.deepEqual(after.placements, before.placements);
  assert.deepEqual(after.cells.slice(0, 2).map(c => c.rect), before.cells.map(c => c.rect));
  assert.equal(after.cells[2].rect[2], frame.size[0] - 24);
  assert.deepEqual(after.cells[2].cell.nodes, []);
  assert.ok(frame.size[1] > size[1]);
  engine.splitCell(frame, after.cells[2].cell.id, 'x');
  assert.equal(engine.layoutFrame(frame, metrics).cells.length, 4);
});

test('repeated bottom rows preserve prior row heights and survive template round trip', () => {
  const frame = fixture();
  assert.equal(typeof engine.addBottomRow, 'function');
  engine.addBottomRow(frame);
  const before = engine.layoutFrame(frame, new Map());
  engine.addBottomRow(frame);
  const after = engine.layoutFrame(frame, new Map());
  assert.equal(frame.root.children.length, 3);
  assert.deepEqual(after.cells.slice(0, 2).map(c => c.rect), before.cells.map(c => c.rect));
  assert.equal(engine.leaves(engine.importTemplate(engine.exportTemplate(frame), [0, 0]).root).length, 3);
});

test('pickCell prefers the cell containing the rect center, then the largest overlap', () => {
  const cellA = { cell: { id: 'a' }, rect: [0, 0, 100, 100] };
  const cellB = { cell: { id: 'b' }, rect: [100, 0, 100, 100] };
  const layouts = [{ frame: { id: 'f' }, cells: [cellA, cellB] }];
  assert.equal(engine.pickCell(layouts, [40, 40, 20, 20]).cell.id, 'a', 'center inside wins');
  assert.equal(engine.pickCell(layouts, [-80, -80, 40, 40]), null, 'no overlap at all');
  assert.equal(engine.pickCell(layouts, [20, 90, 60, 60]).cell.id, 'a', 'center outside, overlap still picks the cell');
  assert.equal(engine.pickCell(layouts, [60, -80, 90, 120]).cell.id, 'b', 'the largest overlap wins');
  const stacked = [
    { frame: { id: 'low' }, cells: [{ cell: { id: 'lowCell' }, rect: [0, 0, 100, 100] }] },
    { frame: { id: 'top' }, cells: [{ cell: { id: 'topCell' }, rect: [0, 0, 100, 100] }] },
  ];
  assert.equal(engine.pickCell(stacked, [40, 40, 20, 20]).cell.id, 'topCell', 'the topmost frame wins a tie');
});
