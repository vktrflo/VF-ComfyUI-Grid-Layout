// Verifies the IDE UI Builder features end-to-end in live ComfyUI:
// - 1-click IDE Presets (VS Code IDE layout: Sidebar + Editor + Bottom Panel)
// - Tabbed panels: seamless promotion, switching tabs, hiding inactive tab nodes, renaming tabs, and stable Max-of-All-Tabs sizing
// - Smart axis-aware collapsing panels: 36px Activity Bar strip for columns (with clickable tab icons) and 26px header strip for rows
// - 5-Way Docking Compass Rose HUD & ghost tab/split previews during node drag
// - Zen Focus (Maximize panel) and Clean App View (compact 1px splitters & internal wire hiding)
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch {
  const path = process.env.PLAYWRIGHT_MODULE;
  if (!path) throw new Error('Install playwright or set PLAYWRIGHT_MODULE to its module directory.');
  playwright = require(path);
}

const base = process.env.COMFYUI_URL ?? 'http://127.0.0.1:8188';
const exampleWorkflow = JSON.parse(await readFile(new URL('../examples/two-column.workflow.json', import.meta.url), 'utf8'));
const prefix = '/extensions/VF-ComfyUI-Grid-Layout/';

const browser = await playwright.chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
});
await mkdir('test-results', { recursive: true });

try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  if (process.env.COMFYUI_TEST_INSTALLED !== '1') {
    await page.route('**/extensions', async route => {
      const response = await route.fetch();
      const list = await response.json();
      await route.fulfill({ response, json: [...list, `${prefix}grid_layout.js`] });
    });
    await page.route(`**${prefix}**`, async route => {
      const relative = new URL(route.request().url()).pathname.slice(prefix.length);
      assert.ok(!relative.includes('..'));
      try {
        const body = await readFile(fileURLToPath(new URL(`../web/${relative}`, import.meta.url)));
        await route.fulfill({ contentType: 'text/javascript', body });
      } catch {
        await route.fulfill({ status: 404, body: 'Extension file not implemented' });
      }
    });
  }

  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.comfyAPI?.app?.app?.canvas, { timeout: 60000 });
  await page.waitForFunction(() => window.comfyAPI.app.app.extensions.some(e => e.name === 'VF.ComfyUI.GridLayout'), { timeout: 15000 });
  await page.locator('.clt-overlay').waitFor({ state: 'attached', timeout: 15000 });

  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const normalize = () => page.evaluate(() => {
    const app = window.comfyAPI.app.app;
    app.canvas.ds.scale = 1;
    app.canvas.ds.offset = [0, 0];
    app.canvas.setDirty(true, true);
  });

  await page.evaluate(async ({ workflow }) => {
    const app = window.comfyAPI.app.app;
    await app.ui.settings.setSettingValue('Comfy.VueNodes.Enabled', true);
    await app.loadGraphData(workflow);
  }, { workflow: exampleWorkflow });
  await page.locator('.p-blockui-mask-document').waitFor({ state: 'hidden' });
  await settle();
  await normalize();
  await settle();

  // Disable autohide if set so header and cell buttons are directly interactive
  await page.evaluate(() => {
    const app = window.comfyAPI.app.app;
    const ext = app.extensions.find(e => e.name === 'VF.ComfyUI.GridLayout');
    ext.controller.edit(() => {
      for (const f of ext.controller.frames) delete f.autohide;
    });
  });
  await settle();

  // 1. Test Tab Promotion & Tab Switching in Left Column Cell
  const firstCell = page.locator('.clt-cell').first();
  await firstCell.getByRole('button', { name: 'Add tab', exact: true }).click();
  await settle();
  assert.equal(await firstCell.locator('.clt-cell-tab').count(), 2, 'clicking + promotes untabbed cell to 2 tabs');

  // Drop second node of first cell (or create/move a node) into Tab 2 and verify inactive tab hiding
  const tabSwitchingState = await page.evaluate(() => {
    const app = window.comfyAPI.app.app;
    const ext = app.extensions.find(e => e.name === 'VF.ComfyUI.GridLayout');
    const frame = ext.controller.frames[0];
    const cell = frame.root.children[0];
    const allNodeIds = [...cell.nodes];
    if (allNodeIds.length >= 2) {
      ext.controller.edit(() => {
        cell.tabs[0].nodes = [allNodeIds[0]];
        cell.tabs[1].nodes = allNodeIds.slice(1);
        cell.activeTab = 0;
      });
    }
    ext.overlay.refreshHidden();
    return {
      tab0Node: cell.tabs[0].nodes[0],
      tab1Node: cell.tabs[1].nodes[0],
      hiddenWhenTab0: [...ext.overlay.hiddenNodeIds],
      frameSizeTab0: [...frame.size],
    };
  });
  await settle();

  if (tabSwitchingState.tab1Node != null) {
    assert.equal(
      tabSwitchingState.hiddenWhenTab0.includes(String(tabSwitchingState.tab1Node)),
      true,
      'node in inactive Tab 2 is hidden when Tab 1 is active'
    );
    // Click Tab 2 pill in UI
    await firstCell.locator('.clt-cell-tab').nth(1).click();
    await settle();
    const afterSwitch = await page.evaluate(() => {
      const app = window.comfyAPI.app.app;
      const ext = app.extensions.find(e => e.name === 'VF.ComfyUI.GridLayout');
      const frame = ext.controller.frames[0];
      return {
        activeTab: frame.root.children[0].activeTab,
        hiddenWhenTab1: [...ext.overlay.hiddenNodeIds],
        frameSizeTab1: [...frame.size],
      };
    });
    assert.equal(afterSwitch.activeTab, 1, 'clicking Tab 2 activates Tab 2');
    assert.equal(
      afterSwitch.hiddenWhenTab1.includes(String(tabSwitchingState.tab0Node)),
      true,
      'node in Tab 1 is now hidden when Tab 2 is active'
    );
    assert.deepEqual(
      afterSwitch.frameSizeTab1,
      tabSwitchingState.frameSizeTab0,
      'Max-of-All-Tabs sizing keeps frame size identical across tab switches'
    );
  }

  // 2. Test Smart Axis-Aware Panel Collapse -> 36px Activity Bar Strip
  await firstCell.getByRole('button', { name: 'Collapse panel', exact: true }).click();
  await settle();
  const collapsedSidebarRect = await firstCell.boundingBox();
  assert.ok(Math.abs(collapsedSidebarRect.width - 36) <= 2, `collapsed column renders as 36px Activity Bar strip (got ${collapsedSidebarRect.width})`);
  assert.equal(await firstCell.locator('.clt-activity-bar').count(), 1, 'renders .clt-activity-bar inside collapsed column');
  assert.equal(await firstCell.locator('.clt-activity-icon').count(), 2, 'renders 2 pinned tab icons on the Activity Bar');

  await page.screenshot({ path: 'test-results/ide-activity-bar.png' });

  // Click the first tab icon on the collapsed Activity Bar -> expands directly to Tab 1!
  await firstCell.locator('.clt-activity-icon').first().click();
  await settle();
  const expandedSidebarState = await page.evaluate(() => {
    const app = window.comfyAPI.app.app;
    const frame = app.graph.extra.comfyui_grid_layout.frames[0];
    const cell = frame.root.children[0];
    return { collapsed: Boolean(cell.collapsed), activeTab: cell.activeTab };
  });
  assert.equal(expandedSidebarState.collapsed, false, 'clicking Activity Bar tab icon expands the sidebar');
  assert.equal(expandedSidebarState.activeTab, 0, 'clicking first Activity Bar tab icon switches directly to Tab 1');

  // 3. Test Zen Focus (Maximize Panel)
  await firstCell.getByRole('button', { name: 'Maximize panel', exact: true }).click();
  await settle();
  assert.equal(await page.locator('.clt-cell').count(), 1, 'Zen Focus maximizes target panel and hides sibling panels');
  await page.screenshot({ path: 'test-results/ide-zen-focus.png' });

  // Restore panel from Zen Focus
  await page.getByRole('button', { name: 'Restore panel', exact: true }).click();
  await settle();
  assert.ok(await page.locator('.clt-cell').count() >= 2, 'restoring Zen Focus brings back all split panels');

  // 4. Test 1-Click IDE Preset (VS Code IDE) & Clean App View
  await page.getByRole('button', { name: 'IDE presets', exact: true }).click();
  await settle();
  await page.getByRole('menuitem', { name: 'Preset: VS Code IDE' }).click();
  await settle();
  assert.equal(await page.locator('.clt-cell').count(), 3, 'VS Code IDE preset creates Sidebar, Editor, and Bottom Panel');

  // Collapse the bottom panel (axis: 'y') into a 26px horizontal strip
  const bottomCell = page.locator('.clt-cell').nth(2);
  await bottomCell.getByRole('button', { name: 'Collapse panel', exact: true }).click();
  await settle();
  const collapsedBottomRect = await bottomCell.boundingBox();
  assert.ok(Math.abs(collapsedBottomRect.height - 26) <= 2, `collapsed row panel renders as 26px header bar (got ${collapsedBottomRect.height})`);
  await bottomCell.getByRole('button', { name: 'Expand panel', exact: true }).click();
  await settle();

  // Enable Clean App View
  await page.getByRole('button', { name: 'Enable App View', exact: true }).click();
  await settle();
  assert.equal(await page.locator('.clt-frame.clt-app-mode').count(), 1, 'Clean App View adds .clt-app-mode to frame');
  await page.screenshot({ path: 'test-results/ide-vscode-appview.png' });

  // 5. Test Tab Reordering via Drag-and-Drop and Context Menu
  const editorCell = page.locator('.clt-cell').nth(1);
  // Add a 3rd tab so we have 3 tabs in Editor: Main View, Pipeline, Tab 3
  await editorCell.getByRole('button', { name: 'Add tab', exact: true }).click();
  await settle();
  const initialTabLabels = await editorCell.locator('.clt-cell-tab-label').allTextContents();
  assert.equal(initialTabLabels.length, 3, 'Editor panel has 3 tabs');

  // Drag 3rd tab pill onto the left side of the 1st tab pill to reorder it to index 0
  const firstTabBox = await editorCell.locator('.clt-cell-tab').nth(0).boundingBox();
  const thirdTabBox = await editorCell.locator('.clt-cell-tab').nth(2).boundingBox();
  await page.mouse.move(thirdTabBox.x + 12, thirdTabBox.y + thirdTabBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(firstTabBox.x + 6, firstTabBox.y + firstTabBox.height / 2, { steps: 6 });
  await page.mouse.up();
  await settle();

  const reorderedTabLabels = await editorCell.locator('.clt-cell-tab-label').allTextContents();
  assert.equal(reorderedTabLabels[0], initialTabLabels[2], 'dragging 3rd tab to first position reorders tabs in place');

  // Right-click first tab pill -> Move tab right
  await editorCell.locator('.clt-cell-tab').nth(0).click({ button: 'right' });
  await settle();
  await page.getByRole('menuitem', { name: 'Move tab right' }).click();
  await settle();
  const afterMenuMoveLabels = await editorCell.locator('.clt-cell-tab-label').allTextContents();
  assert.equal(afterMenuMoveLabels[1], initialTabLabels[2], 'context menu Move tab right shifts the tab to index 1');

  // 6. Test dragging a Vue 2.0 node (via its inner <button> widget or body) into an empty tab body and onto an existing tab pill
  const outsideNodeId = await page.evaluate(() => {
    const app = window.comfyAPI.app.app;
    const node = window.LiteGraph.createNode('CLIPTextEncode');
    node.title = 'Load CLIP Test';
    node.pos = [1250, 260];
    node.size = [260, 130];
    app.graph.add(node);
    app.canvas.setDirty(true, true);
    return node.id;
  });
  await settle();

  // Switch Editor to empty "Tab 3" (now at index 1)
  await editorCell.locator('.clt-cell-tab').nth(1).click();
  await settle();

  const editorBox = await editorCell.boundingBox();
  const nodeLoc = page.locator(`.lg-node[data-node-id="${outsideNodeId}"]`);
  await nodeLoc.waitFor({ state: 'visible', timeout: 5000 });
  const nodeBox = await nodeLoc.boundingBox();

  // Drag the node into the center of the empty Tab 3 body
  await page.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + 14);
  await page.mouse.down();
  await page.mouse.move(editorBox.x + editorBox.width / 2, editorBox.y + editorBox.height / 2, { steps: 8 });
  await page.mouse.up();
  await settle();

  const tabBodyDropState = await page.evaluate(id => {
    const app = window.comfyAPI.app.app;
    const frame = app.graph.extra.comfyui_grid_layout.frames[0];
    const editor = frame.root.children[1].children[0];
    return {
      activeTab: editor.activeTab,
      tabNodes: editor.tabs[editor.activeTab].nodes.map(String),
      expected: String(id),
    };
  }, outsideNodeId);
  assert.equal(tabBodyDropState.tabNodes.includes(tabBodyDropState.expected), true, 'dragging node into empty tab body snaps it into the active tab');

  // Drag the same node onto the "Pipeline" tab pill (index 2) to move it into that existing tab
  const nodeBoxAfter = await nodeLoc.boundingBox();
  const pipelineTabBox = await editorCell.locator('.clt-cell-tab').nth(2).boundingBox();
  await page.mouse.move(nodeBoxAfter.x + nodeBoxAfter.width / 2, nodeBoxAfter.y + 14);
  await page.mouse.down();
  await page.mouse.move(pipelineTabBox.x + pipelineTabBox.width / 2, pipelineTabBox.y + pipelineTabBox.height / 2, { steps: 8 });
  await page.mouse.up();
  await settle();

  const tabPillDropState = await page.evaluate(id => {
    const app = window.comfyAPI.app.app;
    const frame = app.graph.extra.comfyui_grid_layout.frames[0];
    const editor = frame.root.children[1].children[0];
    return {
      activeTab: editor.activeTab,
      pipelineNodes: editor.tabs[2].nodes.map(String),
      expected: String(id),
    };
  }, outsideNodeId);
  assert.equal(tabPillDropState.activeTab, 2, 'dropping node onto existing tab pill activates that tab');
  assert.equal(tabPillDropState.pipelineNodes.includes(tabPillDropState.expected), true, 'dropping node onto existing tab pill moves node into that tab');

  // 7. Verify inactive-tab link routing, collapsed node width preservation, and removal of custom node/group bypass & Enabled ports
  const visualsCheck = await page.evaluate(async () => {
    const app = window.comfyAPI.app.app;
    const ext = app.extensions.find(e => e.name === 'VF.ComfyUI.GridLayout');
    const frame = ext.controller.frames[0];
    const editor = frame.root.children[1].children[0];
    // Ensure we have a node in Tab 0 and a node in Tab 2, with a link between them
    const tab0Id = editor.tabs[0]?.nodes?.[0];
    const tab2Id = editor.tabs[2]?.nodes?.[0];
    let routedLink = null;
    if (tab0Id != null && tab2Id != null) {
      ext.controller.edit(() => {
        editor.activeTab = 2; // Tab 2 active, Tab 0 inactive
      });
      ext.overlay.render(ext.controller.geometry());
      const hidden = ext.overlay.refreshHidden();
      routedLink = hidden.targets.get(String(tab0Id)) ?? null;
    }

    // Collapse the active node in Tab 2 and verify its width matches the cell content width
    let collapsedDomWidth = 0;
    let expectedCellContentWidth = 0;
    let collapsedClassicWidth = 0;
    if (tab2Id != null) {
      const node = app.graph.getNodeById(tab2Id);
      node.flags ??= {};
      node.flags.collapsed = true;
      ext.controller.reflow();
      ext.overlay.render(ext.controller.geometry());
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const placement = ext.controller.geometry()[0].placements.find(p => String(p.nodeId) === String(tab2Id));
      expectedCellContentWidth = placement?.width ?? 0;
      collapsedClassicWidth = node._collapsed_width ?? 0;
      const el = document.querySelector(`.lg-node[data-node-id="${CSS.escape(String(tab2Id))}"]`);
      collapsedDomWidth = el ? el.getBoundingClientRect().width : 0;
      delete node.flags.collapsed;
      ext.controller.reflow();
    }

    return {
      routedLink,
      collapsedDomWidth,
      expectedCellContentWidth,
      collapsedClassicWidth,
      hasFrameBypassBtn: document.querySelectorAll('.clt-frame-bypass').length > 0,
      nodeBypassBars: document.querySelectorAll('.vf-nb-node-bar').length,
      groupBypassBars: document.querySelectorAll('.vf-nb-group-bar').length,
      enabledPorts: document.querySelectorAll('.vf-nb-port').length,
    };
  });
  assert.ok(visualsCheck.routedLink?.inPos && visualsCheck.routedLink?.outPos, 'inactive tab node has routed link anchor on its tab pill');
  assert.ok(
    Math.abs(visualsCheck.collapsedDomWidth - visualsCheck.expectedCellContentWidth) <= 2,
    `collapsed node in Nodes 2.0 maintains full cell width (${visualsCheck.collapsedDomWidth} vs ${visualsCheck.expectedCellContentWidth})`
  );
  assert.ok(
    Math.abs(visualsCheck.collapsedClassicWidth - visualsCheck.expectedCellContentWidth) <= 1,
    `collapsed node _collapsed_width maintains full cell width (${visualsCheck.collapsedClassicWidth} vs ${visualsCheck.expectedCellContentWidth})`
  );
  assert.equal(visualsCheck.hasFrameBypassBtn, true, 'Grid header has native .clt-frame-bypass button');
  assert.equal(visualsCheck.nodeBypassBars, 0, 'custom bypass icon removed from individual nodes');
  assert.equal(visualsCheck.groupBypassBars, 0, 'custom bypass icon removed from groups');
  assert.equal(visualsCheck.enabledPorts, 0, 'custom Enabled input ports removed from UI');

  assert.deepEqual(errors, [], 'no browser runtime errors during IDE UI verification');
  console.log('IDE UI Builder browser verification passed!');
} finally {
  await browser.close();
}
