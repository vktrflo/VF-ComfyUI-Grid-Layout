// Use a new browser context and intercept extension assets: no installation,
// server restart, or changes to the user's open workflow are needed.
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
const prefix = '/extensions/VF-ComfyUI-Layout-Templates/';
const browser = await playwright.chromium.launch({ headless: true });
await mkdir('test-results', { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/extensions', async route => {
    const response = await route.fetch();
    const list = await response.json();
    await route.fulfill({ response, json: [...list, `${prefix}layout_templates.js`] });
  });
  await page.route(`**${prefix}**`, async route => {
    const relative = new URL(route.request().url()).pathname.slice(prefix.length);
    assert.ok(!relative.includes('..'));
    try {
      const body = await readFile(fileURLToPath(new URL(`../web/${relative}`, import.meta.url)));
      await route.fulfill({ contentType: 'text/javascript', body });
    } catch { await route.fulfill({ status: 404, body: 'Extension file not implemented' }); }
  });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.comfyAPI?.app?.app?.canvas, { timeout: 60000 });
  await page.waitForFunction(() => window.comfyAPI.app.app.extensions.some(e => e.name === 'VF.ComfyUI.LayoutTemplates'), { timeout: 15000 });
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
    const data = window.comfyAPI.app.app.graph.extra.comfyui_layout_templates;
    const leaves = cell => cell.children ? cell.children.flatMap(leaves) : [cell];
    return data?.frames.flatMap(f => leaves(f.root).map(c => c.nodes.map(Number))) ?? [];
  });




 for(const vue of [false,true]) {
 await page.evaluate(async ({vue,workflow})=>{const app=window.comfyAPI.app.app;await app.ui.settings.setSettingValue('Comfy.VueNodes.Enabled',vue);await app.loadGraphData(workflow);app.canvas.ds.scale=.75;app.canvas.ds.offset=[20,15];},{vue,workflow:exampleWorkflow});
 await page.locator('.p-blockui-mask-document').waitFor({state:'hidden'});await page.waitForTimeout(500);
 await page.getByRole('button',{name:'Layout options',exact:true}).click();await page.getByRole('menuitem',{name:'Shrink layout to content',exact:true}).click();await page.waitForTimeout(500);
 const widths=await page.evaluate(()=>{const app=window.comfyAPI.app.app;return app.graph._nodes.map(n=>n.size[0]);});
 if(vue){
 assert.ok(widths.every(w=>w>=225));
 const contained=await page.evaluate(()=>{const cells=[...document.querySelectorAll('.clt-cell')];return window.comfyAPI.app.app.graph._nodes.every(n=>{const el=document.querySelector(`.lg-node[data-node-id="${n.id}"]`);const r=el.getBoundingClientRect();return cells.some(c=>{const b=c.getBoundingClientRect();return r.left>=b.left&&r.right<=b.right+.5&&r.bottom<=b.bottom+.5;});});});assert.ok(contained,'Nodes 2.0 rendered nodes remain inside their cells');
 }
 console.log(`Shrink and rendered bounds passed: ${vue?'Nodes 2.0':'Classic'}`);
 }
}finally{await browser.close();}
