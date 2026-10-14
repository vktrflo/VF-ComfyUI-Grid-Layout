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
  assert.equal(template.kind, 'comfyui-grid-layout');
  assert.ok(engine.leaves(template.frame.root).every(c => c.nodes.length === 0));
  const restored = engine.importTemplate(JSON.parse(JSON.stringify(template)), [50, 60]);
  assert.notEqual(restored.id, frame.id);
  assert.deepEqual(restored.pos, [50, 60]);
  assert.equal(engine.leaves(restored.root).length, 4);
  assert.equal(JSON.stringify(frame).includes('"nodes":[1,2]'), true);
});

test('legacy templates (comfyui-layout-template) import successfully with backward compatibility', () => {
  const frame = fixture();
  engine.gridCell(frame, frame.root.id, 2, 2);
  const legacyTemplate = {
    kind: 'comfyui-layout-template',
    version: 1,
    frame: JSON.parse(JSON.stringify(frame))
  };
  const imported = engine.importTemplate(legacyTemplate, [70, 80]);
  assert.deepEqual(imported.pos, [70, 80]);
  assert.equal(engine.leaves(imported.root).length, 4);
});

test('malformed, oversized, and future-version templates fail before modifying a workflow', () => {
  fixture();
  for (const value of [null, {}, { version: 999 }, { version: 1, kind: 'unknown-template', frame: { size: [1, 1], root: { axis: 'z' } } }]) {
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
  assert.throws(() => engine.importTemplate({ kind: 'comfyui-grid-layout', version: 1, frame }, [0, 0]));
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

test('LayoutController migrates legacy comfyui_layout_templates to comfyui_grid_layout', async () => {
  const { LayoutController } = await import('../web/core/controller.js');
  const mockGraph = {
    extra: {
      comfyui_layout_templates: {
        version: 1,
        frames: [{ id: 'legacy-1', label: 'Legacy Grid', pos: [10, 20], size: [620, 500], root: { id: 'c1', label: '', nodes: [] } }]
      }
    },
    getNodeById: () => null,
  };
  const mockApp = { canvas: { graph: mockGraph } };
  const controller = new LayoutController(mockApp);
  
  // frames getter can read legacy frames
  assert.equal(controller.frames.length, 1);
  assert.equal(controller.frames[0].id, 'legacy-1');
  
  // ensureData() migrates to comfyui_grid_layout and cleans up legacy key
  const data = controller.ensureData();
  assert.equal(data.version, 1);
  assert.equal(data.frames.length, 1);
  assert.equal(data.frames[0].id, 'legacy-1');
  assert.equal(mockGraph.extra.comfyui_grid_layout, data);
  assert.equal(mockGraph.extra.comfyui_layout_templates, undefined);
});

test('targetCellForNode errs on caution and avoids aggressive grabs near controls or borders', () => {
  // Cell 1 at [100, 100, 200, 200], Cell 2 at [306, 100, 200, 200] (with 6px divider gap 300..306).
  // Cell header spans y: 100..126 (CELL_TITLE = 26).
  // Content area spans x: 100..300, y: 126..300.
  const cell1 = { cell: { id: 'c1' }, rect: [100, 100, 200, 200] };
  const cell2 = { cell: { id: 'c2' }, rect: [306, 100, 200, 200] };
  const layouts = [{ frame: { id: 'f1' }, cells: [cell1, cell2] }];
  const nodeSize = [150, 80];

  // 1. Clearly inside cell content area attaches cleanly
  const insideNode = { pos: [120, 150], size: nodeSize };
  assert.equal(engine.targetCellForNode(layouts, insideNode)?.cell.id, 'c1', 'node inside content area attaches');

  // 2. Placed to the left outside the cell (center is inside at x=50+75=125, but pos is outside)
  const leftNode = { pos: [50, 150], size: nodeSize };
  assert.equal(engine.targetCellForNode(layouts, leftNode), null, 'node placed outside left is not grabbed');

  // 3. Placed to the right outside the cell
  const rightNode = { pos: [520, 150], size: nodeSize };
  assert.equal(engine.targetCellForNode(layouts, rightNode), null, 'node placed outside right is not grabbed');

  // 4. Placed above cell / near frame header
  const aboveNode = { pos: [120, 80], size: nodeSize };
  assert.equal(engine.targetCellForNode(layouts, aboveNode), null, 'node placed above cell is not grabbed');

  // 5. Placed in the cell header control (y=110 < 100 + CELL_TITLE)
  const headerNode = { pos: [120, 110], size: nodeSize };
  assert.equal(engine.targetCellForNode(layouts, headerNode), null, 'node placed in cell header is not grabbed');

  // 6. Placed below the cell (y=320 > 100 + 200)
  const belowNode = { pos: [120, 320], size: nodeSize };
  assert.equal(engine.targetCellForNode(layouts, belowNode), null, 'node placed below cell is not grabbed');

  // 7. Placed in divider gap between cell 1 and cell 2 (x=302 in 300..306)
  const dividerNode = { pos: [302, 150], size: nodeSize };
  assert.equal(engine.targetCellForNode(layouts, dividerNode), null, 'node placed in divider gap is not grabbed');

  // 8. Node placed in column 2 attaches to column 2
  const col2Node = { pos: [350, 150], size: nodeSize };
  assert.equal(engine.targetCellForNode(layouts, col2Node)?.cell.id, 'c2', 'node in column 2 attaches to c2');

  // 9. Wide node (e.g. CLIPTextEncode 422px wide in a 200px cell) attaches cleanly
  const wideNode = { pos: [220, 150], size: [422, 164] };
  assert.equal(engine.targetCellForNode(layouts, wideNode)?.cell.id, 'c1', 'wide node placed in cell attaches');

  // 10. Tall node placed cleanly in cell attaches even if taller than cell
  const tallNode = { pos: [120, 140], size: [150, 300] };
  assert.equal(engine.targetCellForNode(layouts, tallNode)?.cell.id, 'c1', 'tall node placed in cell attaches');

  // 11. Ghost placement uses horizontal center (x + width / 2) as cursor anchor:
  // A 400px wide node centered on cursorX = 200 in cell 1 ([100, 100, 200, 200]) has x = 0 (< 100),
  // which attaches in ghost mode because cursorX = 200 is inside c1's content area.
  const ghostWideInC1 = { pos: [0, 150], size: [400, 200], flags: { ghost: true } };
  assert.equal(engine.targetCellForNode(layouts, ghostWideInC1)?.cell.id, 'c1', 'ghost wide node centered in c1 attaches to c1');

  // 12. A 315px node finalized after ghost placement in cell 2 (cursorX = 360 -> x = 202.5)
  // attaches to cell 2 (not cell 1, even though x = 202.5 falls inside cell 1).
  const ghostInC2 = { pos: [202.5, 150], size: [315, 200] };
  assert.equal(engine.targetCellForNode(layouts, ghostInC2, { ghost: true })?.cell.id, 'c2', 'ghost node centered in c2 attaches to c2');

  // 13. A ghost node whose cursor is outside the frame to the right (cursorX = 530 -> x = 330, overlapping c2)
  // is not grabbed because its cursor anchor is outside c2.
  const ghostOutsideRight = { pos: [330, 150], size: [400, 200] };
  assert.equal(engine.targetCellForNode(layouts, ghostOutsideRight, { ghost: true }), null, 'ghost node with cursor outside right is not grabbed');

  // 14. Locked frame is never targeted
  const lockedLayouts = [{ frame: { id: 'f1', lock: true }, cells: [cell1] }];
  assert.equal(engine.targetCellForNode(lockedLayouts, insideNode), null, 'locked frame is ignored');

  // 15. pickCell also ignores locked frames
  assert.equal(engine.pickCell(lockedLayouts, [120, 150, 50, 50]), null, 'pickCell ignores locked frame');
});

test('dropNodes with metrics preserves container and sibling column widths unless target column must grow for node minWidth', () => {
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
  const frame = engine.createFrame([0, 0]);
  frame.size[0] = 684;
  engine.gridCell(frame, frame.root.id, 1, 2);
  // Set Column 0 = 224px (inner 200), Column 1 = 424px (inner 400); total inner = 224 + 424 + 12 = 660; frame = 684
  frame.root.ratios = [224 / 648, 424 / 648];
  const [col0, col1] = frame.root.children;
  col0.nodes = [1];
  col1.nodes = [2];
  const metrics = new Map([
    [1, { minWidth: 180, height: 80, titleHeight: 30 }],
    [2, { minWidth: 200, height: 80, titleHeight: 30 }],
    [3, { minWidth: 200, height: 80, titleHeight: 30 }],
    [4, { minWidth: 260, height: 80, titleHeight: 30 }],
  ]);
  engine.layoutFrame(frame, metrics);
  close(frame.size[0], 684);

  // Dropping node 3 (minWidth 200 -> cell minWidth 224) into col0 (width 224) keeps container at 684
  engine.dropNodes([frame], frame.id, col0.id, [3], Infinity, metrics);
  const afterFit = engine.layoutFrame(frame, metrics);
  close(frame.size[0], 684);
  close(afterFit.cells[0].rect[2], 224);
  close(afterFit.cells[1].rect[2], 424);

  // Dropping node 4 (minWidth 260 -> cell minWidth 284) into col0 grows col0 by 60px (224 -> 284) and keeps col1 at 424px
  engine.dropNodes([frame], frame.id, col0.id, [4], Infinity, metrics);
  const afterGrow = engine.layoutFrame(frame, metrics);
  close(afterGrow.cells[0].rect[2], 284);
  close(afterGrow.cells[1].rect[2], 424);
  close(frame.size[0], 744);
});

