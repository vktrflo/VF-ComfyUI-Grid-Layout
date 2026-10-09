import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../web/core/layout.js';

const metrics = new Map([[1, { minWidth: 250, height: 100, titleHeight: 30 }], [2, { minWidth: 340, height: 200, titleHeight: 30 }]]);
const populated = () => {
  const frame = engine.createFrame([100, 200]);
  engine.gridCell(frame, frame.root.id, 1, 2);
  const [first, second] = engine.leaves(frame.root);
  engine.dropNodes([frame], frame.id, first.id, [1]);
  engine.dropNodes([frame], frame.id, second.id, [2]);
  engine.layoutFrame(frame, metrics);
  return frame;
};

test('validateFrame keeps frame collapsed true and drops everything else', () => {
  const frame = engine.createFrame([1, 2]);
  frame.collapsed = true;
  frame.lock = true;
  const validated = engine.validateFrame(frame);
  assert.equal(validated.collapsed, true);
  assert.equal(validated.lock, true, 'collapse and lock coexist');

  for (const bad of [false, 'yes', 1, null, undefined]) {
    const f = engine.createFrame([0, 0]);
    f.collapsed = bad;
    assert.equal('collapsed' in engine.validateFrame(f), false, `expected ${String(bad)} to be dropped`);
  }

  const cells = engine.createFrame([0, 0]);
  engine.splitCell(cells, cells.root.id, 'x');
  cells.root.collapsed = true; // frame-level only
  assert.equal('collapsed' in engine.validateFrame(cells).root, false);
});

test('collapsedNodes survives only while collapsed and never ships in a template', () => {
  const frame = populated();
  frame.collapsed = true;
  frame.collapsedNodes = [1, 2, 2, 'text-id', NaN, Infinity];
  // Ids are deduped and type-checked; whether an id resolves to a real node is
  // settled at unfold time, not here.
  assert.deepEqual(engine.validateFrame(frame).collapsedNodes, [1, 2, 'text-id'], 'ids are deduped and filtered');

  // An expanded frame has nothing folded, so the list must not survive.
  const expanded = engine.validateFrame({ ...frame, collapsed: false });
  assert.equal('collapsedNodes' in expanded, false);

  const bare = engine.validateFrame({ ...frame, collapsedNodes: undefined });
  assert.equal('collapsedNodes' in bare, false, 'no list means no entry');

  const template = engine.exportTemplate(frame);
  assert.equal('collapsedNodes' in template.frame, false, 'a template carries no node references');
});

test('a collapsed frame maintains column structure and column dividers', () => {
  const frame = populated();
  const titleHeight = metrics.get(1).titleHeight;
  const expanded = engine.layoutFrame(frame, metrics);
  assert.equal(expanded.placements.length, 2, 'the expanded grid has geometry');

  frame.collapsed = true;
  const collapsed = engine.layoutFrame(frame, metrics);
  assert.deepEqual(collapsed.cells, [], 'a collapsed frame offers no drop targets');
  assert.equal(collapsed.dividers.length, 1, 'a collapsed frame includes column dividers');
  assert.equal(collapsed.placements.length, 2, 'every contained node keeps a placement');

  // Nodes maintain column positions and widths from the grid layout
  assert.equal(collapsed.placements[0].x, expanded.placements[0].x, 'node 1 maintains column 1 x');
  assert.equal(collapsed.placements[0].width, expanded.placements[0].width, 'node 1 maintains column 1 width');
  assert.equal(collapsed.placements[1].x, expanded.placements[1].x, 'node 2 maintains column 2 x');
  assert.equal(collapsed.placements[1].width, expanded.placements[1].width, 'node 2 maintains column 2 width');
  assert.notEqual(collapsed.placements[0].x, collapsed.placements[1].x, 'nodes do not stack under 1 column flush left');

  // Both single-node columns start flush under the header
  const top = frame.pos[1] + engine.FRAME_TITLE;
  assert.equal(collapsed.placements[0].y, top + titleHeight);
  assert.equal(collapsed.placements[1].y, top + titleHeight);

  // The border wraps the tallest column: header + 1 title bar + pad
  assert.equal(frame.size[1], engine.FRAME_TITLE + titleHeight + engine.PAD);
  assert.equal(collapsed.dividers[0].rect[3], titleHeight, 'divider matches column height');
  assert.ok(frame.size[1] > engine.COLLAPSED_TITLE, 'the frame grows past its empty collapsed height');

  // An empty collapsed frame is just its header.
  const bare = engine.createFrame([0, 0]);
  bare.collapsed = true;
  assert.deepEqual(engine.layoutFrame(bare, metrics).placements, []);
  assert.equal(bare.size[1], engine.COLLAPSED_TITLE);
});

test('a collapsed frame stacks multiple nodes vertically within their column', () => {
  const multiMetrics = new Map([
    [1, { minWidth: 200, height: 100, titleHeight: 30 }],
    [2, { minWidth: 200, height: 100, titleHeight: 30 }],
    [3, { minWidth: 200, height: 100, titleHeight: 30 }],
  ]);
  const frame = engine.createFrame([100, 200]);
  engine.gridCell(frame, frame.root.id, 1, 2);
  const [first, second] = engine.leaves(frame.root);
  engine.dropNodes([frame], frame.id, first.id, [1, 3]);
  engine.dropNodes([frame], frame.id, second.id, [2]);

  frame.collapsed = true;
  const collapsed = engine.layoutFrame(frame, multiMetrics);
  const top = frame.pos[1] + engine.FRAME_TITLE;

  const node1 = collapsed.placements.find(p => p.nodeId === 1);
  const node3 = collapsed.placements.find(p => p.nodeId === 3);
  const node2 = collapsed.placements.find(p => p.nodeId === 2);

  // Column 1 has node 1 and node 3 stacked vertically
  assert.equal(node1.x, node3.x, 'column 1 nodes share x');
  assert.equal(node1.y, top + 30);
  assert.equal(node3.y, top + 60, 'node 3 stacks below node 1');

  // Column 2 has node 2
  assert.notEqual(node2.x, node1.x, 'column 2 has distinct x');
  assert.equal(node2.y, top + 30);

  // Frame height matches the tallest column (column 1: 2 nodes = 60px)
  assert.equal(frame.size[1], engine.FRAME_TITLE + 60 + engine.PAD);
  assert.equal(collapsed.dividers[0].rect[3], 60);
});

test('expanding restores the full geometry and content-derived height', () => {
  const frame = populated();
  frame.collapsed = true;
  engine.layoutFrame(frame, metrics);
  delete frame.collapsed;
  const { cells, placements } = engine.layoutFrame(frame, metrics);
  assert.equal(cells.length, 2);
  assert.equal(placements.length, 2);
  assert.ok(frame.size[1] > engine.COLLAPSED_TITLE, 'the frame grows back to fit its content');
});

test('a collapsed frame refuses operations that need a body', () => {
  const frame = populated();
  frame.collapsed = true;
  assert.throws(() => engine.addBottomRow(frame), /Expand the grid/);
});

test('frame collapse survives splits, grids, and template round trips', () => {
  const frame = engine.createFrame([10, 20]);
  frame.collapsed = true;
  engine.splitCell(frame, frame.root.id, 'x');
  engine.gridCell(frame, frame.root.children[1].id, 2, 2);
  assert.equal(frame.collapsed, true);
  const restored = engine.importTemplate(JSON.parse(JSON.stringify(engine.exportTemplate(frame))), [5, 6]);
  assert.equal(restored.collapsed, true);
});