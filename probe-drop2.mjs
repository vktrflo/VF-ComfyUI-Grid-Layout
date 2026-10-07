// Probe 2: does dragging a SELECTED node (Selection Toolbox visible) break cell drops?
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const playwright = require('playwright');

const base = process.env.PROBE_URL ?? 'http://127.0.0.1:8188';
const browser = await playwright.chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', e => console.log('[pageerror]', String(e.message).slice(0, 300)));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.comfyAPI?.app?.app?.canvas, { timeout: 90000 });
  await page.waitForFunction(() => window.comfyAPI.app.app.extensions.some(e => e.name === 'VF.ComfyUI.LayoutTemplates'), { timeout: 30000 });
  await page.locator('.clt-overlay').waitFor({ state: 'attached', timeout: 60000 });

  await page.evaluate(async () => {
    const app = window.comfyAPI.app.app;
    await app.loadGraphData({ version: 0.4, nodes: [], links: [], groups: [], extra: {} });
    const { createFrame } = await import('/extensions/VF-ComfyUI-Layout-Templates/core/layout.js');
    const frame = createFrame([300, 250]);
    app.graph.extra.comfyui_layout_templates = { version: 1, frames: [frame] };
    const node = window.LiteGraph.createNode('TextMultiline') || window.LiteGraph.createNode('EmptyImage');
    node.pos = [60, 120];
    app.graph.add(node);
    window.__probeNode = node.id;
    app.canvas.ds.scale = 0.8; app.canvas.ds.offset = [0, 0];
  });
  await page.waitForTimeout(900);

  const worldPoint = async point => page.evaluate(point => {
    const p = window.comfyAPI.app.app.canvasPosToClientPos(point);
    return { x: p[0], y: p[1] };
  }, point);
  const state = () => page.evaluate(() => {
    const app = window.comfyAPI.app.app;
    const frames = app.graph.extra.comfyui_layout_templates.frames;
    const leaves = cell => cell.children ? cell.children.flatMap(leaves) : [cell];
    return {
      members: leaves(frames[0].root)[0].nodes.map(String),
      selected: (app.canvas.selected_nodes ? Object.keys(app.canvas.selected_nodes).length : 0),
      toolbox: Boolean(document.querySelector('[data-testid="selection-toolbox"]')),
      hint: Boolean(document.querySelector('.clt-hint')),
    };
  });
  const dragTo = async (destCenter, label) => {
    const points = await page.evaluate(destination => {
      const app = window.comfyAPI.app.app, node = app.graph.getNodeById(window.__probeNode);
      const vue = window.LiteGraph.vueNodesMode;
      return {
        source: [node.pos[0] + 70, node.pos[1] + (vue ? 15 : -15)],
        dest: [destination[0] - node.size[0] / 2 + 70, destination[1] - node.size[1] / 2 + (vue ? 15 : -15)],
      };
    }, destCenter);
    const from = await worldPoint(points.source), to = await worldPoint(points.dest);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.waitForTimeout(300);
    const hoverNow = await page.locator('.clt-cell.clt-target').count();
    await page.mouse.up();
    await page.waitForTimeout(700);
    const after = await state();
    console.log(`${label}: mid-drag highlight=${hoverNow} | attached=${after.members.includes(String(await page.evaluate(() => window.__probeNode)))} | selected=${after.selected} | toolbox=${after.toolbox} | hint=${after.hint}`);
    return after;
  };

  const cellCenter = await page.evaluate(async () => {
    const { LayoutController } = await import('/extensions/VF-ComfyUI-Layout-Templates/core/controller.js');
    const c = new LayoutController(window.comfyAPI.app.app, {});
    const r = c.geometry()[0].cells[0].rect;
    return [r[0] + r[2] / 2, r[1] + r[3] / 2];
  });

  await dragTo(cellCenter, 'drop 1 (unselected)');
  // Select the node by clicking it (classic: click its title bar)
  await page.mouse.click(...Object.values(await worldPoint(await page.evaluate(() => {
    const n = window.comfyAPI.app.app.graph.getNodeById(window.__probeNode);
    return [n.pos[0] + 70, n.pos[1] + (window.LiteGraph.vueNodesMode ? 10 : 10)];
  }))));
  await page.waitForTimeout(400);
  console.log('after click-select:', JSON.stringify(await state()));
  await dragTo([80, 640], 'drag out (selected)');
  await dragTo(cellCenter, 'drop 2 (selected)');
  await dragTo([80, 640], 'drag out again');
  await dragTo(cellCenter, 'drop 3 (deselected by canvas click?)');
  await context.close();
} finally { await browser.close(); }
