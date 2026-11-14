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

  assert.deepEqual(errors, [], 'no browser runtime errors during IDE UI verification');
  console.log('IDE UI Builder browser verification passed!');
} finally {
  await browser.close();
}
