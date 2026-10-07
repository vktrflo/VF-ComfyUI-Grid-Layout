// Probe: drag a node into a layout cell on the live instance and report whether it attaches.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const playwright = require('playwright');

const base = process.env.PROBE_URL ?? 'http://127.0.0.1:8188';
const browser = await playwright.chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`[console] ${m.text().slice(0, 200)}`); });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.comfyAPI?.app?.app?.canvas, { timeout: 90000 });
  await page.waitForFunction(() => window.comfyAPI.app.app.extensions.some(e => e.name === 'VF.ComfyUI.LayoutTemplates'), { timeout: 30000 });
  await page.locator('.clt-overlay').waitFor({ state: 'attached', timeout: 60000 });
  console.log('extension loaded; vueNodesMode =', await page.evaluate(() => window.LiteGraph.vueNodesMode));

  await page.evaluate(async () => {
    const app = window.comfyAPI.app.app;
    await app.loadGraphData({ version: 0.4, nodes: [], links: [], groups: [], extra: {} });
    const { createFrame } = await import('/extensions/VF-ComfyUI-Layout-Templates/core/layout.js');
    const frame = createFrame([300, 250]);
    app.graph.extra.comfyui_layout_templates = { version: 1, frames: [frame] };
    const types = Object.keys(window.LiteGraph.registered_node_types);
    window.__probeTypes = types.filter(t => /text/i.test(t)).slice(0, 12);
  });
  console.log('text-ish node types:', await page.evaluate(() => window.__probeTypes));
  await page.waitForTimeout(800);
  console.log('frames rendered:', await page.locator('.clt-frame').count(), 'cells:', await page.locator('.clt-cell').count());

  // Pick a node type: prefer a Text Multiline-like one, else EmptyImage.
  const picked = await page.evaluate(() => {
    const types = Object.keys(window.LiteGraph.registered_node_types);
    const name = types.find(t => /text.*multiline|multiline.*text/i.test(t)) || types.find(t => /^Text Multiline$/i.test(t)) || types.find(t => /text/i.test(t)) || 'EmptyImage';
    const node = window.LiteGraph.createNode(name);
    if (!node) return null;
    node.pos = [80, 120];
    window.comfyAPI.app.app.graph.add(node);
    window.__probeNode = node.id;
    return { name, id: node.id };
  });
  console.log('probe node:', JSON.stringify(picked));
  await page.waitForTimeout(600);

  const cellCenter = await page.evaluate(async () => {
    const { LayoutController } = await import('/extensions/VF-ComfyUI-Layout-Templates/core/controller.js');
    const c = new LayoutController(window.comfyAPI.app.app, {});
    const r = c.geometry()[0].cells[0].rect;
    return [r[0] + r[2] / 2, r[1] + r[3] / 2];
  });
  const worldPoint = async point => page.evaluate(point => {
    const p = window.comfyAPI.app.app.canvasPosToClientPos(point);
    return { x: p[0], y: p[1] };
  }, point);

  const points = await page.evaluate(destination => {
    const app = window.comfyAPI.app.app, node = app.graph.getNodeById(window.__probeNode);
    const vue = window.LiteGraph.vueNodesMode;
    const source = [node.pos[0] + 70, node.pos[1] + (vue ? 15 : -15)];
    const dest = [destination[0] - node.size[0] / 2 + 70, destination[1] - node.size[1] / 2 + (vue ? 15 : -15)];
    return { source, dest };
  }, cellCenter);
  const from = await worldPoint(points.source), to = await worldPoint(points.dest);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 8 });
  await page.waitForTimeout(150);
  const midHover = await page.locator('.clt-cell.clt-target').count();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.waitForTimeout(250);
  const endHover = await page.locator('.clt-cell.clt-target').count();
  await page.mouse.up();
  await page.waitForTimeout(800);

  const result = await page.evaluate(() => {
    const app = window.comfyAPI.app.app;
    const frames = app.graph.extra.comfyui_layout_templates.frames;
    const leaves = cell => cell.children ? cell.children.flatMap(leaves) : [cell];
    const cell = leaves(frames[0].root)[0];
    return {
      members: cell.nodes.map(String),
      hintShown: Boolean(document.querySelector('.clt-hint')),
      nodePos: app.graph.getNodeById(window.__probeNode).pos,
    };
  });
  console.log('mid-drag hover highlight:', midHover, '| near-drop highlight:', endHover);
  console.log('after drop:', JSON.stringify(result));
  console.log('membership attached:', result.members.includes(String(picked?.id)));
  if (errors.length) console.log('ERRORS:\n' + errors.slice(-8).join('\n'));
  else console.log('no page errors captured');
  await context.close();
} finally { await browser.close(); }
