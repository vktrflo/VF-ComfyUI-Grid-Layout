// Use a fresh browser context. COMFYUI_TEST_INSTALLED=1 verifies server-served
// package assets; otherwise inject this checkout for development checks.
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
const browser = await playwright.chromium.launch({ headless: true });
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
      await route.fulfill({ response, json: [...list.filter(path => !path.startsWith(prefix)), `${prefix}grid_layout.js`] });
    });
    await page.route(`**${prefix}**`, async route => {
      const relative = new URL(route.request().url()).pathname.slice(prefix.length);
      assert.ok(!relative.includes('..'));
      try {
        const body = await readFile(fileURLToPath(new URL(`../web/${relative}`, import.meta.url)));
        await route.fulfill({ contentType: 'text/javascript', body });
      } catch { await route.fulfill({ status: 404, body: 'Extension file not implemented' }); }
    });
  }
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.comfyAPI?.app?.app?.canvas, { timeout: 60000 });
  await page.waitForFunction(() => window.comfyAPI.app.app.extensions.some(e => e.name === 'VF.ComfyUI.GridLayout'), { timeout: 60000 });
  try { await page.locator('.clt-overlay').waitFor({ state: 'attached', timeout: 60000 }); }
  catch (error) {
    console.log('Startup errors:', errors);
    console.log(await page.evaluate(() => ({ ready: Boolean(window.comfyAPI?.app?.app?.canvas?.canvas), apiKeys: Object.keys(window.comfyAPI ?? {}) })));
    throw error;
  }
  assert.equal(await page.locator('.clt-overlay').count(), 1, 'extension overlay is initialized');
  const worldPoint = async point => page.evaluate(point => {
    const app = window.comfyAPI.app.app;
    const p = app.canvasPosToClientPos(point);
    return { x: p[0], y: p[1] };
  }, point);
  const drag = async (from, to) => {
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 15 }); await page.mouse.up();
    await page.waitForTimeout(250);
  };
  const box = locator => locator.evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const nodeDragTo = async (index, destination) => {
    const points = await page.evaluate(({ index, destination }) => {
      const app = window.comfyAPI.app.app, node = app.graph.getNodeById(window.testNodes[index]);
      const vue = window.LiteGraph.vueNodesMode;
      const source = [node.pos[0] + 70, node.pos[1] + (vue ? 15 : -15)];
      const dest = [destination[0] - node.size[0] / 2 + 70, destination[1] - node.size[1] / 2 + (vue ? 15 : -15)];
      return { source, dest };
    }, { index, destination });
    await drag(await worldPoint(points.source), await worldPoint(points.dest));
  };
  const membership = () => page.evaluate(() => {
    const data = window.comfyAPI.app.app.graph.extra.comfyui_grid_layout ?? window.comfyAPI.app.app.graph.extra.comfyui_layout_templates;
    const leaves = cell => cell.children ? cell.children.flatMap(leaves) : [cell];
    return data?.frames.flatMap(f => leaves(f.root).map(c => c.nodes.map(Number))) ?? [];
  });

 for(const vue of [false,true]) {
  await page.evaluate(async ({workflow,vue})=>{const app=window.comfyAPI.app.app;await app.ui.settings.setSettingValue('Comfy.VueNodes.Enabled',vue);await app.ui.settings.setSettingValue('Comfy.Canvas.SelectionToolbox',true);const data=structuredClone(workflow);delete data.extra.comfyui_grid_layout;delete data.extra.comfyui_layout_templates;await app.loadGraphData(data);app.canvas.selectNodes([app.graph._nodes[0]]);},{workflow:exampleWorkflow,vue});
  await page.locator('.p-blockui-mask-document').waitFor({state:'hidden'});await settle();

  // 1. Single-node selection: toolbar icon is default color, hamburger menu shows "Create grid layout from selected nodes" once (not duplicated) with VF logo
  const toolbarBtn = page.locator('.selection-toolbox').getByRole('button',{name:'Create grid layout from selected nodes',exact:true});
  await toolbarBtn.waitFor();
  assert.equal(await toolbarBtn.evaluate(el => el.classList.contains('clt-in-grid')), false, 'toolbar button is not marked in-grid before grid creation');
  await page.getByTestId('more-options-button').click();
  const singleMenuItem = page.getByRole('menuitem',{name:'Create grid layout from selected nodes',exact:true});
  await singleMenuItem.waitFor();
  assert.equal(await singleMenuItem.count(), 1, 'Create grid layout from selected nodes is not duplicated for single-node selection');
  assert.equal(await singleMenuItem.locator('.vf-brand-link img').count(), 1, 'single-selection hamburger menu item displays the VF logo');
  await singleMenuItem.click();
  await page.waitForFunction(()=>document.querySelectorAll('.clt-cell').length===1);
  assert.deepEqual(await membership(),[[1]]);

  // 2. Once selected node is inside a grid container: top toolbox icon turns logo purple (#8b5cf6 / rgb(139, 92, 246))
  await page.waitForFunction(() => {
    const icon = document.querySelector('.selection-toolbox [class~="icon-[lucide--panels-top-left]"]');
    return icon && getComputedStyle(icon).color === 'rgb(139, 92, 246)';
  });
  assert.equal(await toolbarBtn.evaluate(el => el.classList.contains('clt-in-grid')), true, 'toolbar button has clt-in-grid class when selected node is in grid');

  await page.keyboard.press('Control+z');await page.waitForFunction(()=>document.querySelectorAll('.clt-frame').length===0);

  // 3. Multi-node selection via top toolbox button
  await page.evaluate(()=>{const app=window.comfyAPI.app.app;app.canvas.selectNodes(app.graph._nodes);});
  await page.waitForFunction(() => {
    const btn = document.querySelector('.selection-toolbox [class~="icon-[lucide--panels-top-left]"]')?.closest('button');
    return btn && !btn.classList.contains('clt-in-grid');
  });
  await toolbarBtn.click();
  await page.waitForFunction(()=>document.querySelectorAll('.clt-cell').length===2);
  assert.deepEqual(await membership(),[[1],[2]]);

  // 4. Clicking the Grid button in the top toolbox while a grid node is selected opens the container controls menu
  await toolbarBtn.click();
  await page.getByRole('menuitem',{name:'Autohide grid',exact:true}).waitFor();
  await page.getByRole('menuitem',{name:'Lock frame',exact:true}).click();
  await page.waitForFunction(()=>window.comfyAPI.app.app.graph.extra.comfyui_grid_layout.frames[0]?.lock===true);

  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');await page.waitForFunction(()=>document.querySelectorAll('.clt-frame').length===0);

  // 5. Multi-node selection: hamburger menu shows "Create grid layout from selected nodes" once with VF logo
  await page.evaluate(()=>{const app=window.comfyAPI.app.app;app.canvas.selectNodes(app.graph._nodes);});
  await settle();
  await page.getByTestId('more-options-button').click();
  const multiMenuItem = page.getByRole('menuitem',{name:'Create grid layout from selected nodes',exact:true});
  await multiMenuItem.waitFor();
  assert.equal(await multiMenuItem.count(), 1, 'Create grid layout from selected nodes appears once for multi-selection');
  assert.equal(await multiMenuItem.locator('.vf-brand-link img').count(), 1, 'multi-selection hamburger menu item displays the VF logo');
  await multiMenuItem.click();
  await page.waitForFunction(()=>document.querySelectorAll('.clt-cell').length===2);
  assert.deepEqual(await membership(),[[1],[2]]);

  // 6. Hamburger menu does NOT show "Create grid layout from selected nodes" when selected node is already in a grid container
  await page.evaluate(()=>{const app=window.comfyAPI.app.app;app.canvas.selectNodes([app.graph._nodes[0]]);});
  await settle();
  await page.getByTestId('more-options-button').click();
  await page.locator('.p-contextmenu').waitFor({ state: 'visible' });
  await settle();
  assert.equal(await page.getByRole('menuitem',{name:'Create grid layout from selected nodes',exact:true}).count(), 0, 'hamburger menu hides Create grid layout from selected nodes when already in grid');
  await page.getByTestId('more-options-button').click();
  await page.locator('.p-contextmenu').waitFor({ state: 'hidden' });
  console.log(`Horizontal toolbar and vertical menu passed: ${vue?'Nodes 2.0':'Classic'}`);
 }
  assert.deepEqual(errors, [], 'no browser runtime errors');
} finally {await browser.close();}
