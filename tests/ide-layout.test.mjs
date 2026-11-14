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

test('LayoutOverlay renders tabs, Activity Bar, 5-way Docking Compass Rose, and hides inactive tab nodes', async () => {
  const { LayoutOverlay } = await import('../web/core/overlay.js');
  const prevDoc = globalThis.document;
  const domNodes = new Map();
  const makeEl = tag => {
    const classes = new Set();
    const attrs = new Map();
    const node = {
      tagName: tag.toUpperCase(),
      className: '',
      dataset: {},
      style: {},
      children: [],
      classList: {
        add(...names) { names.forEach(n => classes.add(n)); },
        remove(...names) { names.forEach(n => classes.delete(n)); },
        contains(n) { return classes.has(n) || node.className.split(/\s+/).includes(n); },
        toggle(n, force) {
          const on = force === undefined ? !classes.has(n) : Boolean(force);
          if (on) classes.add(n); else classes.delete(n);
          return on;
        },
      },
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.get(k) ?? null; },
      addEventListener() {},
      append(...items) {
        for (const item of items) {
          if (item?.tagName === 'FRAGMENT') node.children.push(...item.children);
          else if (item) node.children.push(item);
        }
      },
      replaceChildren(...items) {
        node.children = [];
        node.append(...items);
      },
    };
    return node;
  };
  for (const id of [1, 2, 3]) {
    const el = makeEl('div');
    el.dataset.nodeId = String(id);
    domNodes.set(id, el);
  }
  try {
    globalThis.document = {
      createElement(tag) { return makeEl(tag); },
      createDocumentFragment() { return makeEl('fragment'); },
      querySelectorAll(sel) {
        if (sel === '.lg-node') return [...domNodes.values()];
        return [];
      },
    };
    const n1 = { id: 1, title: 'ExplorerNode', pos: [100, 150], size: [220, 120], mode: 0, computeSize: () => [200, 80], setSize(s) { this.size = s; } };
    const n2 = { id: 2, title: 'SearchNode', pos: [100, 300], size: [220, 120], mode: 0, computeSize: () => [200, 80], setSize(s) { this.size = s; } };
    const n3 = { id: 3, title: 'EditorNode', pos: [450, 150], size: [300, 200], mode: 0, computeSize: () => [200, 80], setSize(s) { this.size = s; } };
    const graph = {
      extra: {},
      _nodes: [n1, n2, n3],
      getNodeById: id => [n1, n2, n3].find(n => String(n.id) === String(id)) ?? null,
      setDirtyCanvas() {},
    };
    const app = { canvas: { graph, selected_nodes: {}, ds: { scale: 1, offset: [0, 0] }, setDirty() {} }, graph, configuringGraph: false };
    const controller = new LayoutController(app, { defaultColumns: 2 });
    const frame = controller.createFromNodes([1, 3], 'columns');
    delete frame.autohide;
    const [leftCell, rightCell] = engine.leaves(frame.root);
    controller.drop([2], [150, 160], { kind: 'tab', frame, cell: leftCell });

    const overlay = Object.create(LayoutOverlay.prototype);
    const plane = makeEl('div');
    Object.assign(overlay, {
      controller,
      app,
      plane,
      hidden: { ids: new Set(), frames: new Map(), appModeFrames: new Map() },
      editing: null,
      drag: null,
      headerPreview: null,
      hover: null,
      dropPreview: null,
      nativeNode: null,
      nativeDrag: null,
      isGhostActive: () => false,
      safe: fn => fn(),
    });

    // 1. Refresh hidden: n1 is in inactive Tab 0, n2 is in active Tab 1, n3 is in rightCell
    overlay.refreshHidden();
    assert.equal(overlay.hiddenNodeIds.has('1'), true, 'inactive tab node 1 is marked hidden');
    assert.equal(overlay.hiddenNodeIds.has('2'), false, 'active tab node 2 is visible');
    assert.equal(overlay.hiddenNodeIds.has('3'), false, 'sibling cell node 3 is visible');

    let layouts = controller.geometry();
    overlay.render(layouts);
    assert.equal(domNodes.get(1).classList.contains('clt-node-hidden'), true, 'DOM node 1 receives .clt-node-hidden');
    assert.equal(domNodes.get(2).classList.contains('clt-node-hidden'), false, 'DOM node 2 is visible');

    const renderedLeftCell = plane.children.find(c => c.dataset?.cellId === leftCell.id);
    assert.ok(renderedLeftCell, 'left cell is rendered');
    const tabBar = renderedLeftCell.children[0].children.find(c => c.classList.contains('clt-tab-bar'));
    assert.ok(tabBar, 'tab bar is rendered inside left cell header');
    assert.equal(tabBar.children.length, 2, 'two tab pills rendered');

    // 2. Collapse leftCell into Activity Bar strip and re-render
    engine.toggleCellCollapse(frame, leftCell.id);
    overlay.refreshHidden();
    assert.equal(overlay.hiddenNodeIds.has('2'), true, 'collapsing left cell hides active tab node 2 as well');
    layouts = controller.geometry();
    overlay.render(layouts);
    const collapsedCellEl = plane.children.find(c => c.dataset?.cellId === leftCell.id);
    assert.equal(collapsedCellEl.classList.contains('clt-cell-collapsed-x'), true, 'collapsed column cell has .clt-cell-collapsed-x');
    const activityBar = collapsedCellEl.children.find(c => c.classList.contains('clt-activity-bar'));
    assert.ok(activityBar, 'Activity Bar strip is rendered inside collapsed cell');
    const activityIcons = activityBar.children.filter(c => c.classList.contains('clt-activity-icon'));
    assert.equal(activityIcons.length, 2, 'Activity Bar renders pinned icons for both tabs');

    // Click first activity icon -> expands sidebar and switches to Tab 0!
    activityIcons[0].onclick({ stopPropagation() {} });
    assert.equal(leftCell.collapsed, undefined, 'clicking activity icon uncollapses sidebar');
    assert.equal(leftCell.activeTab, 0, 'clicking first activity icon activates Tab 0');
    assert.equal(overlay.hiddenNodeIds.has('1'), false, 'node 1 in Tab 0 is now visible');
    assert.equal(overlay.hiddenNodeIds.has('2'), true, 'node 2 in Tab 1 is now hidden');

    // 3. Render 5-way Docking Compass Rose during drag over rightCell
    layouts = controller.geometry();
    const rightRect = layouts[0].cells.find(c => c.cell.id === rightCell.id).rect;
    const compassRect = engine.computeCompassRect(rightRect, engine.CELL_TITLE);
    const cx = compassRect[0] + compassRect[2] / 2;
    const cy = compassRect[1] + compassRect[3] / 2;
    overlay.dropPreview = engine.resolveDropTarget(layouts, [cx - 50, cy - 30, 100, 60], { pointer: [cx, cy] });
    overlay.render(layouts);
    const compassEl = plane.children.find(c => c.classList.contains('clt-compass'));
    assert.ok(compassEl, '5-way Docking Compass Rose HUD is rendered');
    const centerZone = compassEl.children.find(c => c.dataset?.compassZone === 'center');
    assert.equal(centerZone.classList.contains('active'), true, 'center compass zone is highlighted');
    const ghostTab = plane.children.find(c => c.classList.contains('clt-drop-preview'));
    assert.equal(ghostTab.classList.contains('clt-ghost-tab'), true, 'renders .clt-ghost-tab preview');
  } finally {
    globalThis.document = prevDoc;
  }
});

test('Tab body drops, tab-into drops, tab reordering, and hidden node size preservation', async () => {
  const { NodeAdapter } = await import('../web/core/adapter.js');
  const frame = engine.createFrame([100, 100]);
  delete frame.autohide;
  const cell = frame.root;
  cell.tabs = [
    { id: 't_define', label: 'Define', nodes: [1] },
    { id: 't_models', label: 'Models', nodes: [] },
    { id: 't_enhancers', label: 'Enhancers', nodes: [] },
  ];
  cell.activeTab = 1; // 'Models' tab is active and empty
  engine.syncCellTabs(cell);
  const metrics = new Map([
    [1, metric(240, 160)],
    [2, metric(260, 140)],
    [3, metric(220, 120)],
  ]);

  const layout = { frame, ...engine.layoutFrame(frame, metrics) };
  const cellRect = layout.cells[0].rect;
  const cx = cellRect[0] + cellRect[2] / 2;
  const cy = cellRect[1] + cellRect[3] / 2;

  // 1. Dragging a node into the center of a tabbed panel body drops directly into the active tab ('Models')
  // rather than showing the 5-way Docking Compass Rose
  const bodyDrop = engine.resolveDropTarget([layout], [cx - 80, cy - 40, 160, 80], { pointer: [cx, cy] });
  assert.equal(bodyDrop?.kind, 'cell', 'dropping into an empty active tab body resolves to kind="cell"');
  assert.equal(bodyDrop?.ghostType, 'node', 'previews node slot in active tab');

  engine.dropNodes([frame], frame.id, cell.id, [2], null, metrics);
  assert.deepEqual(cell.tabs[1].nodes, [2], 'node 2 is placed inside active Models tab');
  assert.deepEqual(cell.nodes, [1, 2], 'cell.nodes tracks all tab nodes in the cell');

  // 2. Dragging a node onto an existing tab pill resolves to kind="tab-into" and drops into that tab
  const layoutAfter = { frame, ...engine.layoutFrame(frame, metrics) };
  const rectAfter = layoutAfter.cells[0].rect;
  const tabIntoDrop = engine.resolveDropTarget([layoutAfter], [rectAfter[0] + 40, rectAfter[1], 140, 60], {
    pointer: [rectAfter[0] + 50, rectAfter[1] + 12],
    tabHit: { cellId: cell.id, onTabPill: true, tabIndex: 2, reorderIndex: 2 },
  });
  assert.equal(tabIntoDrop?.kind, 'tab-into', 'hovering an existing tab pill with a node resolves to tab-into');
  assert.equal(tabIntoDrop?.tabIndex, 2);

  engine.dropNodesIntoExistingTab([frame], frame.id, cell.id, [3], 2, metrics);
  assert.deepEqual(cell.tabs[2].nodes, [3], 'node 3 is dropped into Enhancers tab (index 2)');
  assert.equal(cell.activeTab, 2, 'Enhancers tab becomes active after dropping node into it');

  // 3. Reordering tabs via tab drag (isTabDrag: true) and moveCellTab
  const reorderDrop = engine.resolveDropTarget([layoutAfter], [rectAfter[0] + 10, rectAfter[1], 80, 24], {
    pointer: [rectAfter[0] + 15, rectAfter[1] + 12],
    isTabDrag: true,
    enableCompass: true,
    tabHit: { cellId: cell.id, onTabPill: true, tabIndex: 0, reorderIndex: 0, insertBefore: true },
  });
  assert.equal(reorderDrop?.kind, 'tab');
  assert.equal(reorderDrop?.tabIndex, 0, 'tab drag over first tab pill resolves to tabIndex 0');

  // Even if cursor drifts slightly into cell body during tab drag, moveCellTab on same cell reorders rather than deleting the tab
  engine.moveCellTab([frame], frame.id, cell.id, 2, { kind: 'cell', frame, cell, tabIndex: 0 }, metrics);
  assert.equal(cell.tabs.length, 3, 'tab count is preserved when reordering within same cell');
  assert.deepEqual(cell.tabs.map(t => t.label), ['Enhancers', 'Define', 'Models'], 'Enhancers tab moved to index 0');
  assert.equal(cell.activeTab, 0, 'moved tab remains active at index 0');

  // 4. NodeAdapter.apply preserves node.size when placement.hidden is true
  const app = { canvas: { ds: { scale: 1, offset: [0, 0] } } };
  const adapter = new NodeAdapter(app);
  const hiddenNode = {
    id: 1,
    pos: [0, 0],
    size: [240, 160],
    computeSize: () => [200, 80],
    setSize(s) { this.size = s; },
  };
  const hiddenPlacement = layoutAfter.placements.find(p => p.nodeId === 1);
  assert.equal(hiddenPlacement.hidden, true);
  adapter.apply(hiddenNode, hiddenPlacement);
  assert.deepEqual(hiddenNode.size, [240, 160], 'hidden inactive-tab node retains its size instead of being zeroed out');
  assert.equal(adapter.measure(hiddenNode).height, 160, 'subsequent measure retains full node height');
});

test('refreshHidden wraps graph.getNodeOnPos only once even across thousands of ticks', async () => {
  const { LayoutOverlay } = await import('../web/core/overlay.js');
  let callCount = 0;
  const origFn = function (x, y, list) {
    callCount++;
    return (list ?? this._nodes)?.[0] ?? null;
  };
  const graph = {
    _nodes: [{ id: 1 }, { id: 2 }],
    getNodeOnPos: origFn,
  };
  const fakeOverlay = {
    controller: { frames: [], graph },
    nativeNode: null,
    draggedNodes: () => [],
    hidden: { ids: new Set(), frames: new Map() },
  };
  for (let i = 0; i < 20000; i++) {
    LayoutOverlay.prototype.refreshHidden.call(fakeOverlay);
  }
  const firstWrapped = graph.getNodeOnPos;
  assert.equal(firstWrapped._cltWrappedGetNodeOnPos, true);
  assert.equal(firstWrapped._cltOrigGetNodeOnPos, origFn, 'original getNodeOnPos is preserved without chaining');
  fakeOverlay.hidden.ids.add('1');
  const hit = graph.getNodeOnPos(0, 0);
  assert.equal(hit?.id, 2, 'hidden node 1 is filtered out');
  assert.equal(callCount, 1, 'underlying getNodeOnPos called exactly once without stack overflow');
});

test('routeMinimizedEndpoints routes inactive tab and collapsed cell links to their visible anchors and suppresses same-tab internal wires', async () => {
  const { LayoutOverlay, routeMinimizedEndpoints } = await import('../web/core/overlay.js');
  const frame = engine.createFrame([100, 100]);
  delete frame.autohide;
  engine.gridCell(frame, frame.root.id, 1, 2);
  const [leftCell, rightCell] = engine.leaves(frame.root);
  leftCell.tabs = [
    { id: 't0', label: 'Tab 1', nodes: [1, 4] },
    { id: 't1', label: 'Tab 2', nodes: [2] },
  ];
  leftCell.activeTab = 1; // Tab 2 (node 2) is active; Tab 1 (nodes 1 and 4) is inactive
  engine.syncCellTabs(leftCell);
  rightCell.nodes = [3];

  const graph = {
    extra: { [engine.KEY]: { version: engine.VERSION, frames: [frame] } },
    _nodes: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
    getNodeById(id) { return this._nodes.find(n => String(n.id) === String(id)) ?? null; },
  };
  const fakeOverlay = {
    controller: { frames: [frame], graph },
    nativeNode: null,
    draggedNodes: () => [],
    plane: {
      querySelector(sel) {
        if (sel === `.clt-cell[data-cell-id="${leftCell.id}"]`) {
          return {
            style: { left: '112px', top: '148px', width: '280px', height: '300px' },
            querySelector(tabSel) {
              if (tabSel === '.clt-cell-tab[data-tab-index="0"]') {
                return { offsetLeft: 8, offsetTop: 3, offsetWidth: 74, offsetHeight: 20 };
              }
              return null;
            },
          };
        }
        if (sel === `.clt-cell[data-cell-id="${rightCell.id}"]`) {
          return { style: { left: '404px', top: '148px', width: '280px', height: '300px' } };
        }
        return null;
      },
    },
    hidden: { ids: new Set(), frames: new Map(), targets: new Map() },
  };

  const hidden = LayoutOverlay.prototype.refreshHidden.call(fakeOverlay);
  assert.equal(hidden.ids.has('1'), true, 'node 1 in inactive Tab 1 is hidden');
  assert.equal(hidden.ids.has('4'), true, 'node 4 in inactive Tab 1 is hidden');
  assert.equal(hidden.ids.has('2'), false, 'node 2 in active Tab 2 is visible');
  assert.equal(hidden.ids.has('3'), false, 'node 3 in rightCell is visible');

  // Wire from inactive Tab 1 (node 1) to visible rightCell (node 3) stays visible and anchors startPos to Tab 1 pill
  const linkOut = { id: 10, origin_id: 1, target_id: 3 };
  const routedOut = routeMinimizedEndpoints(hidden, graph, linkOut, [150, 220], [420, 220]);
  assert.ok(routedOut, 'wire from inactive tab to visible node is not suppressed');
  assert.deepEqual(routedOut[0], [112 + 8 + 74, 148 + 3 + 10], 'origin endpoint snaps to right edge of Tab 1 pill');
  assert.deepEqual(routedOut[1], [420, 220], 'visible target endpoint is unchanged');

  // Wire from visible node 2 (active Tab 2) to inactive Tab 1 (node 1) stays visible and anchors endPos to Tab 1 pill
  const linkIn = { id: 11, origin_id: 2, target_id: 1 };
  const routedIn = routeMinimizedEndpoints(hidden, graph, linkIn, [350, 220], [150, 220]);
  assert.ok(routedIn, 'wire from active tab to inactive tab in same cell is not suppressed');
  assert.deepEqual(routedIn[0], [350, 220], 'visible origin endpoint is unchanged');
  assert.deepEqual(routedIn[1], [112 + 8, 148 + 3 + 10], 'target endpoint snaps to left edge of Tab 1 pill');

  // Wire between two nodes (1 -> 4) both inside the same inactive Tab 1 is suppressed
  const linkInternal = { id: 12, origin_id: 1, target_id: 4 };
  assert.equal(routeMinimizedEndpoints(hidden, graph, linkInternal, [150, 200], [150, 260]), null, 'internal wire within same inactive tab is suppressed');

  // Collapsing rightCell routes wires connected to node 3 to the collapsed cell rect
  engine.toggleCellCollapse(frame, rightCell.id);
  const hiddenCollapsed = LayoutOverlay.prototype.refreshHidden.call(fakeOverlay);
  assert.equal(hiddenCollapsed.ids.has('3'), true);
  const routedCollapsed = routeMinimizedEndpoints(hiddenCollapsed, graph, { id: 13, origin_id: 2, target_id: 3 }, [350, 220], [420, 220]);
  assert.ok(routedCollapsed, 'wire to collapsed panel stays visible');
  assert.deepEqual(routedCollapsed[1], [404, 148 + 150], 'target endpoint snaps to collapsed cell left edge');
});

test('collapsed nodes docked in a grid maintain full cell width across Classic and Nodes 2.0 modes and release when detached', async () => {
  const { NodeAdapter } = await import('../web/core/adapter.js');
  const prevLiteGraph = globalThis.LiteGraph;
  const prevDoc = globalThis.document;
  const prevCSS = globalThis.CSS;
  try {
    const styleProps = new Map();
    const fakeDomNode = {
      style: {
        setProperty(k, v) { styleProps.set(k, v); },
        removeProperty(k) { styleProps.delete(k); },
      },
    };
    globalThis.LiteGraph = { vueNodesMode: true };
    globalThis.CSS = { escape: s => String(s) };
    globalThis.document = {
      querySelector(sel) {
        if (sel === '.lg-node[data-node-id="1"]') return fakeDomNode;
        return null;
      },
    };

    const app = { canvas: { ds: { scale: 1, offset: [0, 0] } } };
    const adapter = new NodeAdapter(app);
    const node = {
      id: 1,
      pos: [100, 100],
      size: [220, 180],
      flags: { collapsed: true },
      computeSize: () => [200, 80],
      setSize(s) { this.size = s; },
    };

    // Apply docked placement with cell width 420 while node is collapsed
    adapter.apply(node, { nodeId: 1, x: 112, y: 178, width: 420, height: 0 });
    assert.equal(node.size[0], 420, 'collapsed node width updates to full cell width (420)');
    assert.equal(node.size[1], 180, 'collapsed node preserves pre-collapse body height (180)');
    assert.equal(node._collapsed_width, 420, 'Classic LiteGraph _collapsed_width equals cell width');
    // Classic LiteGraph drawNode attempts to overwrite node._collapsed_width with title text width (~115)
    node._collapsed_width = 115;
    assert.equal(node._collapsed_width, 420, 'locked _collapsed_width resists Classic LiteGraph drawNode shrinking');
    assert.equal(styleProps.get('--node-width'), '420px', 'Nodes 2.0 DOM wrapper receives --node-width: 420px');

    // Detaching node releases the docked width lock
    adapter.releaseDockedWidth(node);
    node._collapsed_width = 115;
    assert.equal(node._collapsed_width, 115, 'detached node restores normal mutable _collapsed_width');
    assert.equal(styleProps.has('--node-width'), false, 'detached collapsed node removes --node-width override');
  } finally {
    globalThis.LiteGraph = prevLiteGraph;
    globalThis.document = prevDoc;
    globalThis.CSS = prevCSS;
  }
});

test('toggleFrameBypass toggles node.mode across all cells in the grid frame', async () => {
  const { LayoutOverlay } = await import('../web/core/overlay.js');
  const n1 = { id: 1, mode: 0, pos: [0, 0], size: [200, 100], computeSize: () => [200, 100], setSize(s) { this.size = s; } };
  const n2 = { id: 2, mode: 0, pos: [300, 0], size: [200, 100], computeSize: () => [200, 100], setSize(s) { this.size = s; } };
  const graph = {
    extra: {},
    _nodes: [n1, n2],
    getNodeById: id => [n1, n2].find(n => String(n.id) === String(id)) ?? null,
    setDirtyCanvas() {},
  };
  const app = { canvas: { graph, selected_nodes: {}, ds: { scale: 1, offset: [0, 0] }, setDirty() {} }, graph, configuringGraph: false };
  const controller = new LayoutController(app, { defaultColumns: 2 });
  const frame = controller.createFromNodes([1, 2], 'columns');
  const overlay = Object.create(LayoutOverlay.prototype);
  Object.assign(overlay, { controller, app, safe: fn => fn() });

  assert.equal(overlay.isFrameBypassed(frame), false);
  overlay.toggleFrameBypass(frame.id);
  assert.equal(n1.mode, 4);
  assert.equal(n2.mode, 4);
  assert.equal(overlay.isFrameBypassed(frame), true);

  overlay.toggleFrameBypass(frame.id);
  assert.equal(n1.mode, 0);
  assert.equal(n2.mode, 0);
  assert.equal(overlay.isFrameBypassed(frame), false);
});


