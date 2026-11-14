import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../web/core/layout.js';
import { LayoutController } from '../web/core/controller.js';

const metric = (minWidth = 200, height = 100, minHeight = 80, extra = {}) => ({
  minWidth,
  height,
  minHeight,
  collapsed: false,
  titleHeight: 30,
  ...extra,
});

test('tabbed panels: seamless promotion, max-of-all-tabs sizing, and hidden inactive tab placements', () => {
  const frame = engine.createFrame([100, 100]);
  delete frame.autohide;
  const cell = frame.root;
  cell.label = 'Primary';
  cell.nodes = [1];

  const metrics = new Map([
    [1, metric(200, 120)],
    [2, metric(340, 260)],
    [3, metric(180, 90)],
  ]);

  // Drop node 2 into cell as a new tab -> seamlessly promotes node 1 into Tab 1 and adds node 2 as Tab 2
  const createdTab = engine.dropNodesIntoTab([frame], frame.id, cell.id, [2], {
    tabLabel: 'KSampler',
    tabIcon: '🎲',
    metrics,
  });
  assert.ok(createdTab);
  assert.equal(cell.tabs.length, 2);
  assert.equal(cell.tabs[0].label, 'Primary');
  assert.deepEqual(cell.tabs[0].nodes, [1]);
  assert.equal(cell.tabs[1].label, 'KSampler');
  assert.equal(cell.tabs[1].icon, '🎲');
  assert.deepEqual(cell.tabs[1].nodes, [2]);
  assert.equal(cell.activeTab, 1, 'newly dropped tab becomes active');
  assert.deepEqual(cell.nodes, [1, 2], 'cell.nodes stays synced as union of all tabs');

  // Drop node 3 into the active tab's body -> stacks inside Tab 2 (multi-node tab support)
  engine.dropNodes([frame], frame.id, cell.id, [3], Infinity, metrics);
  assert.deepEqual(cell.tabs[1].nodes, [2, 3]);
  assert.deepEqual(cell.nodes, [1, 2, 3]);

  // Layout with Tab 2 active
  const layoutTab2 = engine.layoutFrame(frame, metrics);
  const frameSizeTab2 = [...frame.size];
  const p1InTab2 = layoutTab2.placements.find(p => p.nodeId === 1);
  const p2InTab2 = layoutTab2.placements.find(p => p.nodeId === 2);
  const p3InTab2 = layoutTab2.placements.find(p => p.nodeId === 3);
  assert.equal(p1InTab2.hidden, true, 'inactive tab node is parked with hidden: true');
  assert.equal(p1InTab2.height, 0);
  assert.equal(Boolean(p2InTab2.hidden), false, 'active tab node 2 is visible');
  assert.equal(Boolean(p3InTab2.hidden), false, 'active tab node 3 is visible');
  assert.ok(p3InTab2.y > p2InTab2.y + p2InTab2.height, 'node 3 stacks below node 2 in active tab');

  // Switch back to Tab 1 (smaller node 1): Max-of-All-Tabs sizing keeps frame size 100% stable!
  engine.selectCellTab(frame, cell.id, 0);
  assert.equal(cell.activeTab, 0);
  const layoutTab1 = engine.layoutFrame(frame, metrics);
  assert.deepEqual(frame.size, frameSizeTab2, 'switching tabs does not jump frame dimensions');
  const p1InTab1 = layoutTab1.placements.find(p => p.nodeId === 1);
  const p2InTab1 = layoutTab1.placements.find(p => p.nodeId === 2);
  assert.equal(Boolean(p1InTab1.hidden), false, 'node 1 is now visible');
  assert.equal(p2InTab1.hidden, true, 'node 2 is now hidden');

  // Rename and remove tab: when down to 1 tab, reverts to untabbed cell cleanly
  engine.renameCellTab(frame, cell.id, 0, 'Renamed Tab', '✨');
  assert.equal(cell.tabs[0].label, 'Renamed Tab');
  assert.equal(cell.tabs[0].icon, '✨');
  engine.removeCellTab(frame, cell.id, 1);
  assert.equal(cell.tabs, undefined, 'reverts to standard cell when 1 tab remains');
  assert.deepEqual(cell.nodes, [1]);
});

test('draggable tabs: moveCellTab reorders tabs, moves tabs across cells, splits cells, and detaches', () => {
  const frame = engine.createFrame([0, 0]);
  delete frame.autohide;
  engine.gridCell(frame, frame.root.id, 1, 2);
  const [left, right] = engine.leaves(frame.root);
  left.nodes = [1];
  right.nodes = [3];
  const metrics = new Map([
    [1, metric(200, 100)],
    [2, metric(200, 100)],
    [3, metric(200, 100)],
  ]);

  engine.dropNodesIntoTab([frame], frame.id, left.id, [2], { tabLabel: 'Tab B', metrics });
  assert.equal(left.tabs.length, 2);
  assert.deepEqual(left.tabs.map(t => t.nodes), [[1], [2]]);

  // 1. Reorder within same cell tab bar
  engine.moveCellTab([frame], frame.id, left.id, 1, { kind: 'tab', frame, cell: left, tabIndex: 0 }, metrics);
  assert.deepEqual(left.tabs.map(t => t.nodes), [[2], [1]]);
  assert.equal(left.activeTab, 0);

  // 2. Move Tab 0 (node 2) from left cell to right cell's tab bar
  engine.moveCellTab([frame], frame.id, left.id, 0, { kind: 'tab', frame, cell: right }, metrics);
  assert.equal(left.tabs, undefined, 'left cell reverts to single untabbed node [1]');
  assert.deepEqual(left.nodes, [1]);
  assert.equal(right.tabs.length, 2, 'right cell now has 2 tabs');
  assert.deepEqual(right.tabs.map(t => t.nodes), [[3], [2]]);

  // 3. Drag Tab 1 (node 2) from right cell to split-bottom of left cell
  engine.moveCellTab([frame], frame.id, right.id, 1, { kind: 'split-bottom', frame, cell: left }, metrics);
  const allCells = engine.leaves(frame.root);
  assert.equal(allCells.length, 3);
  assert.deepEqual(allCells.map(c => c.nodes), [[1], [2], [3]]);
});

test('smart axis-aware collapsing panels: horizontal Activity Bar strip (36px) and vertical row header (26px)', () => {
  const frame = engine.createFrame([0, 0]);
  delete frame.autohide;
  frame.size[0] = 800;
  engine.gridCell(frame, frame.root.id, 1, 2);
  const [sidebar, main] = engine.leaves(frame.root);
  sidebar.nodes = [1];
  main.nodes = [2];
  const metrics = new Map([
    [1, metric(220, 180)],
    [2, metric(300, 240)],
  ]);

  const expanded = engine.layoutFrame(frame, metrics);
  const totalAvailableWidth = expanded.cells[0].rect[2] + expanded.cells[1].rect[2];

  // Collapse left sidebar in axis 'x' split -> shrinks to COLLAPSED_CELL_WIDTH (36px) and main expands!
  engine.toggleCellCollapse(frame, sidebar.id);
  assert.equal(sidebar.collapsed, true);
  const collapsedX = engine.layoutFrame(frame, metrics);
  assert.equal(collapsedX.cells[0].rect[2], engine.COLLAPSED_CELL_WIDTH);
  assert.ok(Math.abs((collapsedX.cells[0].rect[2] + collapsedX.cells[1].rect[2]) - totalAvailableWidth) < 1e-6, 'main column expands to reclaim collapsed sidebar width');
  const p1 = collapsedX.placements.find(p => p.nodeId === 1);
  assert.equal(p1.hidden, true, 'collapsed sidebar node is hidden');

  // Cannot collapse all siblings in the same split
  assert.throws(() => engine.toggleCellCollapse(frame, main.id), /At least one panel/);

  // Uncollapse sidebar -> restores original split width
  engine.toggleCellCollapse(frame, sidebar.id);
  assert.equal(sidebar.collapsed, undefined);
  const restored = engine.layoutFrame(frame, metrics);
  assert.ok(Math.abs(restored.cells[0].rect[2] - expanded.cells[0].rect[2]) < 1e-6);

  // Add bottom row (axis 'y') and collapse it -> shrinks to COLLAPSED_CELL_HEIGHT (26px)
  engine.addBottomRow(frame);
  const bottomCell = frame.root.children[1];
  bottomCell.nodes = [3];
  metrics.set(3, metric(200, 150));
  const withRow = engine.layoutFrame(frame, metrics);
  const bottomCellExpandedH = withRow.cells.find(c => c.cell.id === bottomCell.id).rect[3];
  assert.ok(bottomCellExpandedH > 150);

  engine.toggleCellCollapse(frame, bottomCell.id);
  const withCollapsedRow = engine.layoutFrame(frame, metrics);
  const bottomCellCollapsedH = withCollapsedRow.cells.find(c => c.cell.id === bottomCell.id).rect[3];
  assert.equal(bottomCellCollapsedH, engine.COLLAPSED_CELL_HEIGHT);
  assert.equal(withCollapsedRow.placements.find(p => p.nodeId === 3).hidden, true);
});

test('5-way Docking Compass Rose and cell header tab hotspots resolve accurately', () => {
  const frame = engine.createFrame([100, 100]);
  delete frame.autohide;
  frame.root.nodes = [1];
  const metrics = new Map([[1, metric(300, 260)]]);
  const layout = { frame, ...engine.layoutFrame(frame, metrics) };
  const cellRect = layout.cells[0].rect;
  const compass = engine.computeCompassRect(cellRect, engine.CELL_TITLE);
  assert.ok(compass, 'compass rect is computed for normal cell');
  const [rx, ry, rw, rh] = compass;
  const cx = rx + rw / 2;
  const cy = ry + rh / 2;

  // Center of compass -> 'tab'
  const centerDrop = engine.resolveDropTarget([layout], [cx - 50, cy - 40, 100, 80], { pointer: [cx, cy] });
  assert.equal(centerDrop?.kind, 'tab');
  assert.equal(centerDrop?.compassZone, 'center');
  assert.equal(centerDrop?.ghostType, 'tab');

  // Top of compass -> 'split-top'
  const topDrop = engine.resolveDropTarget([layout], [cx - 50, cy - 40, 100, 80], { pointer: [cx, ry + 8] });
  assert.equal(topDrop?.kind, 'split-top');
  assert.equal(topDrop?.compassZone, 'top');

  // Bottom of compass -> 'split-bottom'
  const bottomDrop = engine.resolveDropTarget([layout], [cx - 50, cy - 40, 100, 80], { pointer: [cx, ry + rh - 8] });
  assert.equal(bottomDrop?.kind, 'split-bottom');
  assert.equal(bottomDrop?.compassZone, 'bottom');

  // Left of compass -> 'split-left'
  const leftDrop = engine.resolveDropTarget([layout], [cx - 50, cy - 40, 100, 80], { pointer: [rx + 8, cy] });
  assert.equal(leftDrop?.kind, 'split-left');
  assert.equal(leftDrop?.compassZone, 'left');

  // Right of compass -> 'split-right'
  const rightDrop = engine.resolveDropTarget([layout], [cx - 50, cy - 40, 100, 80], { pointer: [rx + rw - 8, cy] });
  assert.equal(rightDrop?.kind, 'split-right');
  assert.equal(rightDrop?.compassZone, 'right');

  // Cell Header / Tab Bar -> 'tab'
  const headerDrop = engine.resolveDropTarget([layout], [cellRect[0] + 40, cellRect[1], 100, 80], {
    pointer: [cellRect[0] + 80, cellRect[1] + 12],
  });
  assert.equal(headerDrop?.kind, 'tab');
  assert.equal(headerDrop?.ghostType, 'tab');
});

test('Zen Focus (toggleMaximizeCell) expands target cell to full frame body and hides sibling nodes', () => {
  const frame = engine.createFrame([100, 100]);
  delete frame.autohide;
  engine.gridCell(frame, frame.root.id, 1, 2);
  const [c1, c2] = engine.leaves(frame.root);
  c1.nodes = [1];
  c2.nodes = [2];
  const metrics = new Map([[1, metric(220, 150)], [2, metric(260, 180)]]);

  engine.toggleMaximizeCell(frame, c1.id);
  assert.equal(frame.maximizedCellId, c1.id);
  const maxLayout = engine.layoutFrame(frame, metrics);
  assert.equal(maxLayout.cells.length, 1);
  assert.equal(maxLayout.cells[0].cell.id, c1.id);
  assert.equal(maxLayout.cells[0].maximized, true);
  assert.equal(maxLayout.cells[0].rect[2], frame.size[0] - engine.PAD * 2);
  assert.equal(maxLayout.dividers.length, 0);
  assert.equal(maxLayout.placements.find(p => p.nodeId === 1).hidden, undefined);
  assert.equal(maxLayout.placements.find(p => p.nodeId === 2).hidden, true);

  // Second toggle restores normal split layout
  engine.toggleMaximizeCell(frame, c1.id);
  assert.equal(frame.maximizedCellId, undefined);
  const restored = engine.layoutFrame(frame, metrics);
  assert.equal(restored.cells.length, 2);
  assert.equal(restored.placements.find(p => p.nodeId === 2).hidden, undefined);
});

test('IDE presets (vscode, dual-sidebar, tabbed-dashboard), appMode, and template round-trip', () => {
  const frame = engine.createFrame([50, 60]);
  frame.root.nodes = [10];
  const metrics = new Map([[10, metric(280, 160)]]);

  engine.applyIdePreset(frame, 'vscode', metrics);
  frame.appMode = true;
  const leaves = engine.leaves(frame.root);
  assert.equal(leaves.length, 3, 'VS Code preset has Sidebar, Editor, and Bottom Panel');
  assert.deepEqual(leaves[1].nodes, [10], 'existing node is preserved in main Editor panel');
  assert.equal(leaves[0].tabs.length, 2);
  assert.equal(leaves[1].tabs.length, 2);
  assert.equal(leaves[2].tabs.length, 2);

  const validated = engine.validateFrame(frame);
  assert.equal(validated.appMode, true);
  assert.equal(engine.leaves(validated.root)[0].tabs.length, 2);

  // Export and re-import template preserves tabs, icons, labels, and appMode with empty node lists
  const exported = engine.exportTemplate(frame);
  assert.equal(exported.frame.appMode, true);
  const imported = engine.importTemplate(exported, [200, 300]);
  assert.equal(imported.appMode, true);
  const importedLeaves = engine.leaves(imported.root);
  assert.equal(importedLeaves.length, 3);
  assert.equal(importedLeaves[0].tabs.length, 2);
  assert.deepEqual(importedLeaves[1].nodes, []);
  assert.notEqual(importedLeaves[0].tabs[0].id, leaves[0].tabs[0].id, 'fresh tab IDs generated on import');

  // Test dual-sidebar and tabbed-dashboard presets
  engine.applyIdePreset(frame, 'dual-sidebar', metrics);
  assert.equal(engine.leaves(frame.root).length, 3);
  engine.applyIdePreset(frame, 'tabbed-dashboard', metrics);
  assert.equal(engine.leaves(frame.root).length, 2);
});

test('LayoutController.drop routes tab, split-top, split-bottom, and createPreset', () => {
  const n1 = { id: 1, title: 'Load Checkpoint', pos: [0, 0], size: [220, 100], computeSize: () => [200, 80], setSize(s) { this.size = s; } };
  const n2 = { id: 2, title: 'CLIP Text Encode', pos: [300, 0], size: [240, 120], computeSize: () => [200, 80], setSize(s) { this.size = s; } };
  const n3 = { id: 3, title: 'Preview Image', pos: [600, 0], size: [220, 140], computeSize: () => [200, 80], setSize(s) { this.size = s; } };
  const graph = {
    extra: {},
    _nodes: [n1, n2, n3],
    getNodeById: id => [n1, n2, n3].find(n => String(n.id) === String(id)) ?? null,
    setDirtyCanvas() {},
  };
  const app = { canvas: { graph, selected_nodes: {}, ds: { scale: 1, offset: [0, 0] }, setDirty() {} }, graph, configuringGraph: false };
  const controller = new LayoutController(app, { defaultColumns: 1 });

  const frame = controller.createFromNodes([1], 'columns');
  const cell = frame.root;

  // Drop n2 as a tab -> uses n1 and n2 titles automatically
  controller.drop([2], [150, 110], { kind: 'tab', frame, cell });
  assert.equal(cell.tabs.length, 2);
  assert.equal(cell.tabs[0].label, 'Load Checkpoint');
  assert.equal(cell.tabs[1].label, 'CLIP Text Encode');

  // Drop n3 as split-bottom on cell
  controller.drop([3], [150, 300], { kind: 'split-bottom', frame, cell });
  assert.equal(engine.leaves(frame.root).length, 2);
  assert.deepEqual(engine.leaves(frame.root)[1].nodes, [3]);

  // createPreset creates an IDE workspace frame
  const ideFrame = controller.createPreset([500, 500], 'vscode');
  assert.equal(ideFrame.label, 'IDE Workspace');
  assert.equal(engine.leaves(ideFrame.root).length, 3);
});
