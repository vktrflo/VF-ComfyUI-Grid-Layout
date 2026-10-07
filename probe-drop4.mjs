// Probe 4: tall node dropped overlapping a small cell with its CENTER outside - the user's case.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const playwright = require('playwright');

const base = process.env.PROBE_URL ?? 'http://127.0.0.1:8188';
const browser = await playwright.chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.comfyAPI?.app?.app?.canvas, { timeout: 90000 });
  await page.waitForFunction(() => window.comfyAPI.app.app.extensions.some(e => e.name === 'VF.ComfyUI.LayoutTemplates'), { timeout: 30000 });
  await page.locator('.clt-overlay').waitFor({ state: 'attached', timeout: 60000 });

  const setup = await page.evaluate(async () => {
    const app = window.comfyAPI.app.app;
    await app.loadGraphData({ version: 0.4, nodes: [], links: [], groups: [], extra: {} });
    const { createFrame } = await import('/extensions/VF-ComfyUI-Layout-Templates/core/layout.js');
    const frame = createFrame([300, 200]);
    app.graph.extra.comfyui_layout_templates = { version: 1, frames: [frame] };
    const node = window.LiteGraph.createNode('TextMultiline') || window.LiteGraph.createNode('EmptyImage');
    node.pos = [40, 130];
    app.graph.add(node);
    node.setSize([node.size[0], Math.max(node.size[1], 400)]);
    window.__probeNode = node.id;
    return { frameSize: frame.size, nodeSize: node.size };
  });
  console.log('frame:', JSON.stringify(setup.frameSize), 'node:', JSON.stringify(setup.nodeSize));
  await page.waitForTimeout(900);

  const cellRect = await page.evaluate(async () => {
    const { LayoutController } = await import('/extensions/VF-ComfyUI-Layout-Templates/core/controller.js');
    const c = new LayoutController(window.comfyAPI.app.app, {});
    return c.geometry()[0].cells[0].rect;
  });
  console.log('cell rect:', JSON.stringify(cellRect.map(Math.round)));

  const worldPoint = async point => page.evaluate(point => {
    const p = window.comfyAPI.app.app.canvasPosToClientPos(point);
    return { x: p[0], y: p[1] };
  }, point);

  const dragNodeSoTopIs = async (tx, ty, label) => {
    const points = await page.evaluate(({ tx, ty }) => {
      const app = window.comfyAPI.app.app, node = app.graph.getNodeById(window.__probeNode);
      const vue = window.LiteGraph.vueNodesMode;
      return {
        source: [node.pos[0] + 70, node.pos[1] + (vue ? 15 : -15)],
        dest: [tx + 70, ty + (vue ? 15 : -15)],
      };
    }, { tx, ty });
    const from = await worldPoint(points.source), to = await worldPoint(points.dest);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.waitForTimeout(250);
    const hover = await page.locator('.clt-cell.clt-target').count();
    await page.mouse.up();
    await page.waitForTimeout(700);
    const state = await page.evaluate(() => {
      const app = window.comfyAPI.app.app;
      const frames = app.graph.extra.comfyui_layout_templates.frames;
      const leaves = cell => cell.children ? cell.children.flatMap(leaves) : [cell];
      const node = app.graph.getNodeById(window.__probeNode);
      return {
        attached: leaves(frames[0].root).some(c => c.nodes.map(String).includes(String(window.__probeNode))),
        pos: node.pos.map(Math.round), size: node.size.map(Math.round),
      };
    });
    const center = [state.pos[0] + state.size[0] / 2, state.pos[1] + state.size[1] / 2];
    const inside = center[0] >= cellRect[0] && center[0] <= cellRect[0] + cellRect[2] && center[1] >= cellRect[1] && center[1] <= cellRect[1] + cellRect[3];
    console.log(`${label}: highlight=${hover} node=${JSON.stringify(state.pos)}x${JSON.stringify(state.size)} center=[${center.map(Math.round)}] centerInsideCell=${inside} attached=${state.attached}`);
    return state.attached;
  };

  // Simulate the user's screenshot: node top edge near the cell top; tall node extends down.
  await dragNodeSoTopIs(cellRect[0] + 10, cellRect[1] + 5, 'drop A (top near cell top)');
  // If it attached, pull it out first: drag far away and re-drop below.
  const out = await page.evaluate(() => {
    const frames = window.comfyAPI.app.app.graph.extra.comfyui_layout_templates.frames;
    const leaves = cell => cell.children ? cell.children.flatMap(leaves) : [cell];
    return leaves(frames[0].root).some(c => c.nodes.map(String).includes(String(window.__probeNode)));
  });
  if (out) await dragNodeSoTopIs(40, 700, 'pull out');
  await dragNodeSoTopIs(cellRect[0] + 10, cellRect[1] + Math.round(cellRect[3] / 2), 'drop B (top at cell middle)');
  const out2 = await page.evaluate(() => {
    const frames = window.comfyAPI.app.app.graph.extra.comfyui_layout_templates.frames;
    const leaves = cell => cell.children ? cell.children.flatMap(leaves) : [cell];
    return leaves(frames[0].root).some(c => c.nodes.map(String).includes(String(window.__probeNode)));
  });
  if (out2) await dragNodeSoTopIs(40, 700, 'pull out 2');
  await dragNodeSoTopIs(cellRect[0] + 10, cellRect[1] + Math.round(cellRect[3] * 0.8), 'drop C (top near cell bottom)');
  await context.close();
} finally { await browser.close(); }
