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
      await route.fulfill({ response, json: [...list, `${prefix}grid_layout.js`] });
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
  await page.waitForFunction(() => window.comfyAPI.app.app.extensions.some(e => e.name === 'VF.ComfyUI.GridLayout'), { timeout: 15000 });
  try { await page.locator('.clt-overlay').waitFor({ state: 'attached', timeout: 15000 }); }
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

  for (const vue of [false, true]) {
    await page.evaluate(async ({ vue, workflow }) => {
      const app = window.comfyAPI.app.app;
      await app.ui.settings.setSettingValue('Comfy.VueNodes.Enabled', vue);
      await app.handleFile(new File([JSON.stringify(workflow)], 'two-column.workflow.json', { type: 'application/json' }));
    }, { vue, workflow: exampleWorkflow });
    await page.waitForFunction(() => document.querySelectorAll('.clt-cell').length === 2 && window.comfyAPI.app.app.graph._nodes.length === 2);
    await page.locator('.p-blockui-mask-document').waitFor({ state: 'hidden' });
    await settle();
    assert.deepEqual(await membership(), [[1], [2]], 'normal workflow open restores the example layout and nodes');
    await page.locator('.clt-frame-header .clt-label').dblclick();
    assert.equal(await page.getByRole('textbox', {name:'Frame title', exact:true}).inputValue(), 'Two columns', 'frame rename prefills the raw label without the emoji');
    await page.getByRole('textbox', {name:'Frame title', exact:true}).fill('Inline layout');
    await page.getByRole('textbox', {name:'Frame title', exact:true}).press('Enter');
    await page.waitForFunction(() => document.querySelector('.clt-frame-header .clt-label')?.textContent === 'Inline layout');
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => document.querySelector('.clt-frame-header .clt-label')?.textContent === 'Two columns');
    await page.keyboard.press('Control+Shift+z');
    await page.waitForFunction(() => document.querySelector('.clt-frame-header .clt-label')?.textContent === 'Inline layout');
    await page.locator('.clt-cell-header .clt-label').first().dblclick();
    await page.getByRole('textbox', {name:'Cell title', exact:true}).fill('Inline inputs');
    await page.getByRole('textbox', {name:'Cell title', exact:true}).press('Tab');
    await page.waitForFunction(() => document.querySelector('.clt-cell-header .clt-label')?.textContent === 'Inline inputs');
    await page.locator('.clt-cell-header .clt-label').first().dblclick();
    await page.getByRole('textbox', {name:'Cell title', exact:true}).fill('Cancelled title');
    await page.getByRole('textbox', {name:'Cell title', exact:true}).press('Escape');
    await page.waitForFunction(() => document.querySelector('.clt-cell-header .clt-label')?.textContent === 'Inline inputs');
    const examplePrompt = await page.evaluate(async () => (await window.comfyAPI.app.app.graphToPrompt()).output);
    assert.equal(examplePrompt['1'].class_type, 'EmptyImage');
    assert.deepEqual(examplePrompt['2'].inputs.images, ['1', 0]);
    const edge = await box(page.locator('.clt-resize-x'));
    const leftBeforeResize = await page.evaluate(() => { const n=window.comfyAPI.app.app.graph.getNodeById(1); return [...n.pos,...n.size]; });
    const widthBefore = await page.evaluate(() => window.comfyAPI.app.app.graph.extra.comfyui_grid_layout.frames[0].size[0]);
    await drag({ x: edge.x + edge.width / 2, y: edge.y + edge.height / 2 }, { x: edge.x + edge.width / 2 + 40, y: edge.y + edge.height / 2 });
    assert.ok(await page.evaluate(before => window.comfyAPI.app.app.graph.extra.comfyui_grid_layout.frames[0].size[0] > before + 45, widthBefore), 'right edge resizes outermost cells');
    assert.deepEqual(await page.evaluate(() => { const n=window.comfyAPI.app.app.graph.getNodeById(1); return [...n.pos,...n.size]; }), leftBeforeResize, 'right edge leaves left column unchanged');
    await page.keyboard.press('Control+z');
    await page.waitForFunction(before => Math.abs(window.comfyAPI.app.app.graph.extra.comfyui_grid_layout.frames[0].size[0] - before) < 1, widthBefore);
    await settle();
    const beforeDelete = await page.evaluate(() => {const n=window.comfyAPI.app.app.graph.getNodeById(2);return [...n.pos,...n.size];});
    await page.getByRole('button', { name: 'Cell options', exact: true }).nth(1).click();
    await page.getByRole('menuitem', { name: 'Delete cell (keep nodes)', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.clt-cell').length === 1);
    assert.deepEqual(await membership(), [[1]]);
    assert.deepEqual(await page.evaluate(() => {const n=window.comfyAPI.app.app.graph.getNodeById(2);return [...n.pos,...n.size];}), beforeDelete, 'released node unchanged');
    assert.deepEqual(await page.evaluate(async () => (await window.comfyAPI.app.app.graphToPrompt()).output), examplePrompt, 'connections unchanged');
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => document.querySelectorAll('.clt-cell').length === 2);
    assert.deepEqual(await membership(), [[1],[2]]);
    await page.keyboard.press('Control+Shift+z');
    await page.waitForFunction(() => document.querySelectorAll('.clt-cell').length === 1);
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => document.querySelectorAll('.clt-cell').length === 2);
    await settle();
    const positionsBeforeRow = await page.evaluate(() => window.comfyAPI.app.app.graph._nodes.map(n => [...n.pos]));
    await page.getByRole('button', { name: 'Grid options', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Add bottom row', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.clt-cell').length === 3);
    assert.deepEqual(await membership(), [[1], [2], []]);
    assert.deepEqual(await page.evaluate(() => window.comfyAPI.app.app.graph._nodes.map(n => [...n.pos])), positionsBeforeRow, 'adding bottom row keeps existing nodes in place');
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => document.querySelectorAll('.clt-cell').length === 2);
    await page.keyboard.press('Control+Shift+z');
    await page.waitForFunction(() => document.querySelectorAll('.clt-cell').length === 3);
    await settle();
    assert.equal(await page.locator('.clt-resize-y,.clt-resize').count(), 0, 'height resize handles removed');
    await page.screenshot({ path: `test-results/example-${vue ? 'nodes-2' : 'classic'}.png` });
    await page.evaluate(async vue => {
      const app = window.comfyAPI.app.app;
      await app.ui.settings.setSettingValue('Comfy.VueNodes.Enabled', vue);
      await app.loadGraphData({ version: 0.4, nodes: [], links: [], groups: [], extra: {} });
      const image = window.LiteGraph.createNode('EmptyImage'); image.pos = [100, 160]; app.graph.add(image);
      image.widgets.find(w => w.name === 'width').value = 64; image.widgets.find(w => w.name === 'height').value = 64;
      const save = window.LiteGraph.createNode('SaveImage'); save.pos = [100, 420]; app.graph.add(save);
      save.widgets.find(w => w.name === 'filename_prefix').value = 'layout-test';
      image.connect(0, save, 0);
      app.canvas.ds.scale = 0.8; app.canvas.ds.offset = [0, 0];
      window.testNodes = [image.id, save.id];
    }, vue);
    await page.waitForFunction(vue => window.LiteGraph.vueNodesMode === vue, vue);
    await page.waitForTimeout(400);
    const promptBefore = await page.evaluate(async () => (await window.comfyAPI.app.app.graphToPrompt()).output);
    const creation = await worldPoint([550, 80]);
    await page.mouse.click(creation.x, creation.y, { button: 'right' });
    await page.getByText('🌀 Add Grid Frame', { exact: true }).click();
    await page.locator('.clt-frame').waitFor();
    assert.deepEqual(await membership(), [[], []], 'new frame has two empty cells');
    assert.deepEqual(await page.evaluate(() => window.comfyAPI.app.app.graph.extra.comfyui_grid_layout.frames[0].root.ratios), [0.5, 0.5]);
    // Continue the single-cell split scenarios using the normal delete action.
    await page.getByRole('button', {name:'Cell options',exact:true}).last().click();
    await page.getByRole('menuitem', {name:'Delete cell (keep nodes)',exact:true}).click();
    await page.waitForFunction(() => document.querySelectorAll('.clt-cell').length === 1);

    assert.equal(await page.evaluate(() => document.querySelector('.clt-frame-header .clt-emoji')?.textContent), '🌀', 'frame header shows the cyclone emoji');
    await nodeDragTo(0, [850, 185]);
    assert.deepEqual(await membership(), [[1]], `${vue ? 'Vue' : 'Classic'} drop attaches first node`);
    if (vue) {
      const bounds = await page.evaluate(() => {
        const node = document.querySelector('[data-node-id="1"]');
        const header = document.querySelector('.clt-cell-header');
        return { nodeTop: node.getBoundingClientRect().top, headerBottom: header.getBoundingClientRect().bottom, html: node.innerHTML.slice(0, 900) };
      });
      assert.ok(bounds.nodeTop >= bounds.headerBottom, 'Nodes 2.0 title must be below the cell header');
    }
    await nodeDragTo(1, await page.evaluate(() => { const n=window.comfyAPI.app.app.graph.getNodeById(1); return [850,n.pos[1]+n.size[1]+6]; }));
    assert.deepEqual(await membership(), [[1, 2]], 'multiple nodes share cell');

    await page.getByRole('button', { name: 'Cell options', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Split into left / right', exact: true }).click();
    await page.waitForFunction(() => window.comfyAPI.app.app.graph.extra.comfyui_grid_layout.frames[0].root.children?.length === 2);
    assert.deepEqual(await membership(), [[1, 2], []]);
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => !window.comfyAPI.app.app.graph.extra.comfyui_grid_layout.frames[0].root.children);
    assert.deepEqual(await membership(), [[1, 2]], 'split undo restores membership');
    await page.keyboard.press('Control+Shift+z');
    await page.waitForFunction(() => window.comfyAPI.app.app.graph.extra.comfyui_grid_layout.frames[0].root.children?.length === 2);

    const rightCenter = await page.evaluate(async () => {
      const { LayoutController } = await import('/extensions/VF-ComfyUI-Grid-Layout/core/controller.js');
      const c = new LayoutController(window.comfyAPI.app.app, { isVue: () => window.LiteGraph.vueNodesMode });
      const r = c.geometry()[0].cells[1].rect;
      return [r[0] + r[2] / 2, r[1] + r[3] / 2];
    });
    await nodeDragTo(1, rightCenter);
    assert.deepEqual(await membership(), [[1], [2]], 'dragging between cells transfers membership');
    await nodeDragTo(1, [200, 550]);
    assert.deepEqual(await membership(), [[1], []], 'dragging out releases node');
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => window.comfyAPI.app.app.graph.extra.comfyui_grid_layout.frames[0].root.children[1].nodes.length === 1);
    await settle();

    // Frame movement uses the overlay; the nodes remain ordinary graph nodes.
    const initialPositions = await page.evaluate(() => window.testNodes.map(id => [...window.comfyAPI.app.app.graph.getNodeById(id).pos]));
    const header = await box(page.locator('.clt-frame-header'));
    await drag({ x: header.x + 70, y: header.y + 12 }, { x: header.x + 110, y: header.y + 52 });
    const finalPositions = await page.evaluate(() => window.testNodes.map(id => [...window.comfyAPI.app.app.graph.getNodeById(id).pos]));
    for (let i = 0; i < 2; i++) {
      assert.ok(Math.abs(finalPositions[i][0] - initialPositions[i][0] - 50) < 1);
      assert.ok(Math.abs(finalPositions[i][1] - initialPositions[i][1] - 50) < 1);
    }
    const divider = await box(page.locator('.clt-divider').first());
    await drag({ x: divider.x + divider.width / 2, y: divider.y + 100 }, { x: divider.x + divider.width / 2 + 35, y: divider.y + 100 });
    assert.ok(await page.evaluate(() => window.comfyAPI.app.app.graph.extra.comfyui_grid_layout.frames[0].root.ratios[0] > 0.5));

    const widthBeforeClamp = await page.evaluate(() => window.comfyAPI.app.app.graph.extra.comfyui_grid_layout.frames[0].size[0]);
    const clampDivider = await box(page.locator('.clt-divider').first());
    await drag({x:clampDivider.x+clampDivider.width/2,y:clampDivider.y+70}, {x:clampDivider.x+clampDivider.width/2+700,y:clampDivider.y+70});
    assert.ok(await page.evaluate(width => Math.abs(window.comfyAPI.app.app.graph.extra.comfyui_grid_layout.frames[0].size[0]-width)<1, widthBeforeClamp), 'extreme divider drag cannot expand the frame');
    await page.keyboard.press('Control+z');
    await settle();

    const beforeShrink = await page.evaluate(() => window.comfyAPI.app.app.graph.extra.comfyui_grid_layout.frames[0].size[0]);
    await page.getByRole('button', {name:'Grid options',exact:true}).click();
    await page.getByRole('menuitem', {name:'Shrink grid to content',exact:true}).click();
    assert.ok(await page.evaluate(width => window.comfyAPI.app.app.graph.extra.comfyui_grid_layout.frames[0].size[0] < width, beforeShrink), 'shrink menu fits controls');
    await page.keyboard.press('Control+z');
    await page.waitForFunction(width => Math.abs(window.comfyAPI.app.app.graph.extra.comfyui_grid_layout.frames[0].size[0]-width)<1, beforeShrink);
    await settle();

    // Grid UI, a nested split, export via download, and import via file picker.
    await page.getByRole('button', { name: 'Cell options', exact: true }).last().click();
    await page.getByRole('menuitem', { name: 'Create grid…' }).click();
    await page.getByLabel('Rows', { exact: true }).fill('2');
    await page.getByLabel('Columns', { exact: true }).fill('2');
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.clt-cell').length === 5);
    await page.getByRole('button', { name: 'Cell options', exact: true }).last().click();
    await page.getByRole('menuitem', { name: 'Split into top / bottom' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.clt-cell').length === 6);
    await settle();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Grid options', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Export empty template', exact: true }).click();
    const download = await downloadPromise;
    const file = await download.path();
    const template = JSON.parse(await readFile(file, 'utf8'));
    const templateLeaves = cell => cell.children ? cell.children.flatMap(templateLeaves) : [cell];
    assert.ok(templateLeaves(template.frame.root).every(c => c.nodes.length === 0));

    const saved = await page.evaluate(() => JSON.parse(JSON.stringify(window.comfyAPI.app.app.graph.serialize())));
    await page.evaluate(async saved => { await window.comfyAPI.app.app.loadGraphData(saved); }, saved);
    await page.waitForFunction(() => document.querySelectorAll('.clt-cell').length === 6);
    assert.equal((await membership()).flat().length, 2, 'workflow round trip retains members');
    assert.deepEqual(await page.evaluate(async () => (await window.comfyAPI.app.app.graphToPrompt()).output), promptBefore, 'layout leaves API execution prompt unchanged');

    const resize = await box(page.locator('.clt-resize-x'));
    const previousSize = await page.evaluate(() => [...window.comfyAPI.app.app.graph.extra.comfyui_grid_layout.frames[0].size]);
    await drag({ x: resize.x + 5, y: resize.y + 50 }, { x: resize.x + 45, y: resize.y + 90 });
    const resizedSize = await page.evaluate(() => [...window.comfyAPI.app.app.graph.extra.comfyui_grid_layout.frames[0].size]);
    assert.ok(resizedSize[0] >= previousSize[0] + 49 && Math.abs(resizedSize[1] - previousSize[1]) < 1, 'width handle preserves content height even with diagonal drag');
    await page.keyboard.press('Control+z');
    await page.waitForFunction(previous => {
      const size = window.comfyAPI.app.app.graph.extra.comfyui_grid_layout.frames[0].size;
      return Math.abs(size[0] - previous[0]) < 1 && Math.abs(size[1] - previous[1]) < 1;
    }, previousSize);

    const importPoint = await worldPoint([100, 750]);
    await page.mouse.click(importPoint.x, importPoint.y, { button: 'right' });
    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByText('🌀 Import Grid Template…', { exact: true }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({ name: 'test.grid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(template)) });
    await page.waitForFunction(() => window.comfyAPI.app.app.graph.extra.comfyui_grid_layout.frames.length === 2);
    assert.equal((await membership()).slice(6).flat().length, 0, 'imported template has no nodes');
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => window.comfyAPI.app.app.graph.extra.comfyui_grid_layout.frames.length === 1);

    // A real model-free generation verifies that ordinary node execution works.
    const queued = await page.request.post(`${base}/prompt`, { data: { prompt: promptBefore, extra_data: { extra_pnginfo: { workflow: saved } } } });
    assert.equal(queued.status(), 200);
    const { prompt_id } = await queued.json();
    let history;
    for (let attempt = 0; attempt < 50; attempt++) {
      history = await (await page.request.get(`${base}/history/${prompt_id}`)).json();
      if (history[prompt_id]) break;
      await page.waitForTimeout(100);
    }
    assert.equal(history[prompt_id]?.status?.status_str, 'success', 'image generation completes after layout edits');
    assert.ok(Object.values(history[prompt_id].outputs).some(output => output.images?.length > 0));

    await page.evaluate(() => { const ds = window.comfyAPI.app.app.canvas.ds; ds.scale = 0.6; ds.offset = [-350, 100]; });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `test-results/${vue ? 'nodes-2' : 'classic'}-layout.png` });
    assert.equal(await page.locator('.clt-frame').count(), 1);
    const countBeforeRemove = await page.evaluate(() => window.comfyAPI.app.app.graph._nodes.length);
    await page.getByRole('button', { name: 'Grid options', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Remove grid (keep nodes)', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.clt-frame').length === 0);
    assert.equal(await page.evaluate(() => window.comfyAPI.app.app.graph._nodes.length), countBeforeRemove);
    assert.deepEqual(await page.evaluate(async () => (await window.comfyAPI.app.app.graphToPrompt()).output), promptBefore);
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => document.querySelectorAll('.clt-frame').length === 1);
    await settle();
    const newlyAdded = await page.evaluate(() => {
      const app = window.comfyAPI.app.app;
      const existing = app.graph.getNodeById(window.testNodes[0]);
      const node = window.LiteGraph.createNode('EmptyLatentImage');
      node.pos = [...existing.pos]; app.graph.add(node);
      return Number(node.id);
    });
    await page.waitForFunction(id => {
      const frames = window.comfyAPI.app.app.graph.extra.comfyui_grid_layout.frames;
      const leaves = cell => cell.children ? cell.children.flatMap(leaves) : [cell];
      return frames.some(f => leaves(f.root).some(c => c.nodes.some(n => Number(n) === id)));
    }, newlyAdded, { timeout: 3000 });

    // Appearance controls: inheritance, persistence, history, and panel reset.
    const openAppearance = async (cell = false) => {
      const button = page.getByRole('button', { name: cell ? 'Cell options' : 'Grid options', exact: true });
      await button.first().click();
      await page.getByRole('menuitem', { name: 'Change Appearance…', exact: true }).click();
      return page.locator('.clt-dialog');
    };
    const setAppearance = async (panel, label, value) => panel.getByLabel(label, { exact: true }).evaluate((el, value) => {
      el.value = value; el.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
    let panel = await openAppearance();
    await setAppearance(panel, 'Background color', '#70d8be');
    await panel.getByLabel('Auto (contrast)', { exact: true }).uncheck();
    await setAppearance(panel, 'Text color', '#112233');
    await setAppearance(panel, 'Font size', '18');
    await panel.getByRole('button', { name: 'OK', exact: true }).click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.clt-frame-header')).fontSize === '18px');
    const inherited = await page.locator('.clt-cell-header').evaluateAll(els => els.map(el => ({color:getComputedStyle(el).backgroundColor,size:getComputedStyle(el).fontSize})));
    assert.ok(inherited.length >= 2 && inherited.every(c => c.color === 'rgb(112, 216, 190)' && c.size === '18px'));
    panel = await openAppearance(true);
    assert.equal(await panel.getByLabel('Background color', { exact: true }).inputValue(), '#70d8be');
    await setAppearance(panel, 'Background color', '#112233');
    await setAppearance(panel, 'Font size', '12');
    await panel.getByRole('button', { name: 'OK', exact: true }).click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.clt-cell-header')).fontSize === '12px');
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.clt-cell-header')).fontSize === '18px');
    await page.keyboard.press('Control+Shift+z');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.clt-cell-header')).fontSize === '12px');
    const configured = await page.evaluate(() => JSON.parse(JSON.stringify(window.comfyAPI.app.app.graph.serialize())));
    await page.evaluate(async saved => window.comfyAPI.app.app.loadGraphData(saved), configured);
    await settle();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.clt-cell-header')).fontSize === '12px');
    const persisted = await page.evaluate(() => {
      const frame = window.comfyAPI.app.app.graph.extra.comfyui_grid_layout.frames[0];
      const leaves = c => c.children ? c.children.flatMap(leaves) : [c];
      const cell = leaves(frame.root)[0];
      return [frame.color, frame.textColor, frame.fontSize, cell.color, cell.fontSize];
    });
    assert.deepEqual(persisted, ['#70d8be', '#112233', 18, '#112233', 12]);
    panel = await openAppearance(true);
    await panel.getByRole('button', {name:'Reset appearance configuration',exact:true}).click();
    await panel.getByRole('button', {name:'OK',exact:true}).click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.clt-cell-header')).fontSize === '18px');
    panel = await openAppearance();
    await panel.getByRole('button', {name:'Reset appearance configuration',exact:true}).click();
    await panel.getByRole('button', {name:'OK',exact:true}).click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.clt-frame-header')).fontSize === '13px');

    // Fill cell height: the bottom node stretches flush with the cell's content floor.
    await page.evaluate(async () => {
      const app = window.comfyAPI.app.app;
      await app.loadGraphData({ version: 0.4, nodes: [], links: [], groups: [], extra: {} });
      const image = window.LiteGraph.createNode('EmptyImage'); image.pos = [100, 160]; app.graph.add(image);
      image.widgets.find(w => w.name === 'width').value = 64; image.widgets.find(w => w.name === 'height').value = 64;
      const save = window.LiteGraph.createNode('SaveImage'); save.pos = [100, 420]; app.graph.add(save);
      save.widgets.find(w => w.name === 'filename_prefix').value = 'layout-fill';
      image.connect(0, save, 0);
      app.canvas.ds.scale = 0.8; app.canvas.ds.offset = [0, 0];
      window.testNodes = [image.id, save.id];
    });
    await page.waitForTimeout(400);
    const fillCreation = await worldPoint([550, 80]);
    await page.mouse.click(fillCreation.x, fillCreation.y, { button: 'right' });
    await page.getByText('🌀 Add Grid Frame', { exact: true }).click();
    await page.locator('.clt-frame').waitFor();
    await nodeDragTo(0, [850, 185]);
    assert.deepEqual(await membership(), [[1], []], 'fill scenario attaches the tall-column node');
    await page.evaluate(() => { const n = window.comfyAPI.app.app.graph.getNodeById(window.testNodes[0]); n.setSize([n.size[0], 420]); });
    await settle();
    await page.waitForTimeout(250);
    await page.waitForFunction(() => document.querySelectorAll('.clt-cell').length === 2);
    await settle();
    const fillRight = await page.evaluate(async () => {
      const { LayoutController } = await import('/extensions/VF-ComfyUI-Grid-Layout/core/controller.js');
      const c = new LayoutController(window.comfyAPI.app.app, {});
      const r = c.geometry()[0].cells[1].rect;
      const node = window.comfyAPI.app.app.graph.getNodeById(window.testNodes[1]);
      return [r[0] + node.size[0] / 2 + 10, r[1] + node.size[1] / 2 + 5];
    });
    await nodeDragTo(1, fillRight);
    assert.deepEqual(await membership(), [[1], [2]], 'fill scenario columns hold one node each');
    await settle();
    const fillBefore = await page.evaluate(async () => {
      const { LayoutController } = await import('/extensions/VF-ComfyUI-Grid-Layout/core/controller.js');
      const { PAD } = await import('/extensions/VF-ComfyUI-Grid-Layout/core/layout.js');
      const app = window.comfyAPI.app.app;
      const c = new LayoutController(app, {});
      const layout = c.geometry()[0];
      const saved = String(window.testNodes[1]);
      const entry = layout.cells.find(({ cell }) => cell.nodes.some(n => String(n) === saved));
      const placement = layout.placements.find(p => String(p.nodeId) === saved);
      const node = app.graph.getNodeById(window.testNodes[1]);
      const tallNode = app.graph.getNodeById(window.testNodes[0]);
      return { size: node.size[1], tallSize: tallNode.size[1], target: (entry.rect[1] + entry.rect[3] - PAD) - placement.y };
    });
    assert.ok(fillBefore.size < fillBefore.target - 40, 'scenario: the short column has spare height to fill');
    // The drag left the node selected, which summons ComfyUI's Selection Toolbox over the chrome.
    const openFrameMenu = async () => {
      await page.evaluate(() => window.comfyAPI.app.app.canvas.deselectAllNodes());
      await page.getByRole('button', { name: 'Grid options', exact: true }).click();
    };
    await openFrameMenu();
    assert.equal(await page.getByRole('menuitem', { name: 'Undo Fill cell height', exact: true }).count(), 0, 'fit entry hidden before filling');
    await page.getByRole('menuitem', { name: 'Fill cell height', exact: true }).click();
    const waitForFlush = () => page.waitForFunction(async () => {
      const { LayoutController } = await import('/extensions/VF-ComfyUI-Grid-Layout/core/controller.js');
      const { PAD } = await import('/extensions/VF-ComfyUI-Grid-Layout/core/layout.js');
      const app = window.comfyAPI.app.app;
      const c = new LayoutController(app, {});
      const layout = c.geometry()[0];
      const saved = String(window.testNodes[1]);
      const entry = layout.cells.find(({ cell }) => cell.nodes.some(n => String(n) === saved));
      if (!entry) return false;
      const placement = layout.placements.find(p => String(p.nodeId) === saved);
      if (!placement) return false;
      const node = app.graph.getNodeById(window.testNodes[1]);
      return Math.abs((placement.y + placement.height) - (entry.rect[1] + entry.rect[3] - PAD)) < 1.5 && Math.abs(node.size[1] - placement.height) < 1.5;
    }, undefined, { timeout: 5000 });
    await waitForFlush();
    const fillAfter = await page.evaluate(() => {
      const app = window.comfyAPI.app.app;
      const frames = app.graph.extra.comfyui_grid_layout.frames;
      const node = app.graph.getNodeById(window.testNodes[1]);
      const tallNode = app.graph.getNodeById(window.testNodes[0]);
      return { height: node.size[1], tallHeight: tallNode.size[1], flag: frames[0].fill === true };
    });
    assert.equal(fillAfter.flag, true, 'fill flag is set on the frame');
    assert.ok(Math.abs(fillAfter.height - fillBefore.target) < 1.5, 'stretched node matches the computed fill height');
    assert.ok(Math.abs(fillAfter.tallHeight - fillBefore.tallSize) < 1.5, 'the taller column node is unchanged (anchor preserved)');
    await openFrameMenu();
    assert.equal(await page.getByRole('menuitem', { name: 'Fill cell height', exact: true }).count(), 0, 'fill entry hidden while filling');
    assert.equal(await page.getByRole('menuitem', { name: 'Undo Fill cell height', exact: true }).count(), 1);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+z');
    await page.waitForFunction(size => Math.abs(window.comfyAPI.app.app.graph.getNodeById(window.testNodes[1]).size[1] - size) < 1.5, fillBefore.size);
    await page.keyboard.press('Control+Shift+z');
    await waitForFlush();
    await openFrameMenu();
    await page.getByRole('menuitem', { name: 'Undo Fill cell height', exact: true }).click();
    await page.waitForFunction(size => Math.abs(window.comfyAPI.app.app.graph.getNodeById(window.testNodes[1]).size[1] - size) < 1.5, fillBefore.size);
    await openFrameMenu();
    assert.equal(await page.getByRole('menuitem', { name: 'Fill cell height', exact: true }).count(), 1, 'fill entry returns after release');
    await page.getByRole('menuitem', { name: 'Fill cell height', exact: true }).click();
    await waitForFlush();
    const filledSave = await page.evaluate(() => JSON.parse(JSON.stringify(window.comfyAPI.app.app.graph.serialize())));
    await page.evaluate(async saved => { await window.comfyAPI.app.app.loadGraphData(saved); }, filledSave);
    await settle();
    const fillPersisted = await page.evaluate(() => window.comfyAPI.app.app.graph.extra.comfyui_grid_layout.frames[0].fill === true);
    assert.equal(fillPersisted, true, 'frame fill persists through a workflow save/load round trip');
    await waitForFlush();
    // Force a canvas repaint; screenshotting right after a layout change can
    // otherwise capture a stale bitmap in headless runs.
    await page.evaluate(() => window.comfyAPI.app.app.canvas.setDirty(true, true));
    await page.waitForTimeout(400);
    await page.screenshot({ path: `test-results/fill-${vue ? 'nodes-2' : 'classic'}.png` });
    console.log(`Fill cell height checks passed (${vue ? 'Nodes 2.0' : 'Classic'})`);

    // Lock scenario: the frame gains a lock icon, ignores header drags, and moves again after unlocking.
    await openFrameMenu();
    await page.getByRole('menuitem', { name: 'Lock frame', exact: true }).click();
    await settle();
    await page.locator('.clt-lock').waitFor({ state: 'attached', timeout: 3000 });
    assert.equal(await page.locator('.clt-lock').textContent(), '🔒', 'lock icon appears in the frame header');
    const lockedPos = await page.evaluate(() => [...window.comfyAPI.app.app.graph.extra.comfyui_grid_layout.frames[0].pos]);
    const headerBox = await page.locator('.clt-frame-header').first().boundingBox();
    await page.mouse.move(headerBox.x + headerBox.width / 2, headerBox.y + headerBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(headerBox.x + headerBox.width / 2 + 60, headerBox.y + headerBox.height / 2 + 40, { steps: 5 });
    await page.mouse.up();
    await settle();
    const lockedAfter = await page.evaluate(() => [...window.comfyAPI.app.app.graph.extra.comfyui_grid_layout.frames[0].pos]);
    assert.deepEqual(lockedAfter, lockedPos, 'a locked frame ignores header drags');
    await page.evaluate(() => window.comfyAPI.app.app.canvas.setDirty(true, true));
    await page.waitForTimeout(400);
    await page.screenshot({ path: `test-results/lock-${vue ? 'nodes-2' : 'classic'}.png` });
    await openFrameMenu();
    await page.getByRole('menuitem', { name: 'Unlock frame', exact: true }).click();
    await settle();
    assert.equal(await page.locator('.clt-lock').count(), 0, 'lock icon disappears after unlocking');
    await page.mouse.move(headerBox.x + headerBox.width / 2, headerBox.y + headerBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(headerBox.x + headerBox.width / 2 + 60, headerBox.y + headerBox.height / 2 + 40, { steps: 5 });
    await page.mouse.up();
    await page.waitForFunction(pos => {
      const p = window.comfyAPI.app.app.graph.extra.comfyui_grid_layout.frames[0].pos;
      return Math.abs(p[0] - pos[0]) > 20 || Math.abs(p[1] - pos[1]) > 20;
    }, lockedPos);
    console.log(`Frame lock checks passed (${vue ? 'Nodes 2.0' : 'Classic'})`);

    // Regression: a tall node dropped onto a small empty cell attaches by overlap,
    // even though its center falls outside the cell rect.
    const tallTarget = await page.evaluate(async () => {
      const app = window.comfyAPI.app.app;
      app.canvas.ds.scale = 1; app.canvas.ds.offset = [0, 0];
      const { createFrame } = await import('/extensions/VF-ComfyUI-Grid-Layout/core/layout.js');
      const frame = createFrame([120, 640]);
      app.graph.extra.comfyui_grid_layout.frames.push(frame);
      const node = window.LiteGraph.createNode('EmptyImage');
      node.pos = [40, 200]; app.graph.add(node);
      node.setSize([node.size[0], 420]);
      window.__tallNode = node.id; window.__tallFrame = frame.id;
      return { node: node.id, frame: frame.id };
    });
    await page.waitForTimeout(700);
    const tallDrop = await page.evaluate(async () => {
      const { LayoutController } = await import('/extensions/VF-ComfyUI-Grid-Layout/core/controller.js');
      const app = window.comfyAPI.app.app;
      const c = new LayoutController(app, {});
      const layout = c.geometry().find(l => String(l.frame.id) === String(window.__tallFrame));
      const rect = layout.cells[0].rect;
      const node = app.graph.getNodeById(window.__tallNode);
      const vue2 = window.LiteGraph.vueNodesMode;
      return {
        source: [node.pos[0] + 70, node.pos[1] + (vue2 ? 15 : -15)],
        dest: [rect[0] + 10 + 70, rect[1] + 5 + (vue2 ? 15 : -15)],
        nodeSize: [...node.size], rect,
      };
    });
    const tallCenter = [tallDrop.rect[0] + 10 + tallDrop.nodeSize[0] / 2, tallDrop.rect[1] + 5 + tallDrop.nodeSize[1] / 2];
    assert.ok(
      !(tallCenter[0] >= tallDrop.rect[0] && tallCenter[0] <= tallDrop.rect[0] + tallDrop.rect[2] && tallCenter[1] >= tallDrop.rect[1] && tallCenter[1] <= tallDrop.rect[1] + tallDrop.rect[3]),
      'scenario: the tall node center lands outside the small cell'
    );
    await drag(await worldPoint(tallDrop.source), await worldPoint(tallDrop.dest));
    await page.waitForFunction(id => {
      const frames = window.comfyAPI.app.app.graph.extra.comfyui_grid_layout.frames;
      const leaves = cell => cell.children ? cell.children.flatMap(leaves) : [cell];
      const frame = frames.find(f => String(f.id) === String(window.__tallFrame));
      return leaves(frame.root).some(c => c.nodes.map(String).includes(String(id)));
    }, tallTarget.node, { timeout: 5000 });
    await page.evaluate(() => window.comfyAPI.app.app.canvas.setDirty(true, true));
    await page.waitForTimeout(400);
    await page.screenshot({ path: `test-results/drop-tall-${vue ? 'nodes-2' : 'classic'}.png` });
    console.log(`Tall-node drop checks passed (${vue ? 'Nodes 2.0' : 'Classic'})`);

    console.log(`${vue ? 'Nodes 2.0' : 'Classic'} interaction, history, persistence, geometry and prompt checks passed`);
  }
  if (process.env.EXPECT_INSECURE_ORIGIN === '1') {
    assert.deepEqual(await page.evaluate(() => ({ secure: isSecureContext, uuid: typeof crypto.randomUUID })), { secure: false, uuid: 'undefined' }, 'browser reproduced the HTTP LAN environment');
    console.log('HTTP LAN compatibility verified without crypto.randomUUID');
  }
  assert.deepEqual(errors, [], 'no browser runtime errors');
  await context.close();
} finally { await browser.close(); }
