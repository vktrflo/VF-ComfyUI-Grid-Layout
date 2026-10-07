// Probe 3: instrument nativeDown/move/up + controller drag methods, test drop with different view transforms.
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
    window.__vue = window.LiteGraph.vueNodesMode;
  });
  await page.waitForTimeout(1000);

  // Instrument the overlay + controller prototypes.
  await page.evaluate(async () => {
    const { LayoutOverlay } = await import('/extensions/VF-ComfyUI-Layout-Templates/core/overlay.js');
    const { LayoutController } = await import('/extensions/VF-ComfyUI-Layout-Templates/core/controller.js');
    window.__log = [];
    const L = t => { if (window.__log.length < 400) window.__log.push(t); };
    const origDown = LayoutOverlay.prototype.nativeDown;
    LayoutOverlay.prototype.nativeDown = function (e) {
      let excluded = null;
      try { excluded = Boolean(e.target.closest?.('.clt-overlay,.clt-menu,.clt-dialog,input,textarea,button,select,[contenteditable="true"]')); } catch {}
      L(`nativeDown button=${e.button} excluded=${excluded} target=${e.target?.tagName}${e.target?.className ? '.' + String(e.target.className).split(' ')[0] : ''}`);
      return origDown.call(this, e);
    };
    const origMove = LayoutOverlay.prototype.move;
    LayoutOverlay.prototype.move = function (e) {
      if (this.nativeDrag) {
        const p = this.controller.adapter.point(e);
        const t = this.controller.target(p);
        L(`move(nativeDrag) point=[${p.map(Math.round)}] target=${t ? String(t.cell.id) : 'null'}`);
      } else if (this.drag) L('move(frameDrag)');
      return origMove.call(this, e);
    };
    const origUp = LayoutOverlay.prototype.up;
    LayoutOverlay.prototype.up = function (e, cancelled) {
      L(`up hasDrag=${Boolean(this.drag)} hasNative=${Boolean(this.nativeDrag)} cancelled=${Boolean(cancelled)}`);
      return origUp.call(this, e, cancelled);
    };
    for (const name of ['begin', 'end', 'finishNativeDrag', 'drop']) {
      const orig = LayoutController.prototype[name];
      LayoutController.prototype[name] = function (...a) {
        const out = orig.apply(this, a);
        if (name === 'finishNativeDrag') L(`finishNativeDrag -> ${JSON.stringify(out)}`);
        if (name === 'drop') L(`drop -> ${JSON.stringify(out)}`);
        return out;
      };
    }
  });

  const worldPoint = async point => page.evaluate(point => {
    const p = window.comfyAPI.app.app.canvasPosToClientPos(point);
    return { x: p[0], y: p[1] };
  }, point);
  const cellCenter = async () => page.evaluate(async () => {
    const { LayoutController } = await import('/extensions/VF-ComfyUI-Layout-Templates/core/controller.js');
    const c = new LayoutController(window.comfyAPI.app.app, {});
    const r = c.geometry()[0].cells[0].rect;
    return [r[0] + r[2] / 2, r[1] + r[3] / 2];
  });
  const attachState = () => page.evaluate(() => {
    const frames = window.comfyAPI.app.app.graph.extra.comfyui_layout_templates.frames;
    const leaves = cell => cell.children ? cell.children.flatMap(leaves) : [cell];
    return leaves(frames[0].root)[0].nodes.map(String).includes(String(window.__probeNode));
  });
  const dragTo = async (center, label) => {
    await page.evaluate(() => { window.__log.length = 0; });
    const points = await page.evaluate(destination => {
      const app = window.comfyAPI.app.app, node = app.graph.getNodeById(window.__probeNode);
      const vue = window.LiteGraph.vueNodesMode;
      return {
        source: [node.pos[0] + 70, node.pos[1] + (vue ? 15 : -15)],
        dest: [destination[0] - node.size[0] / 2 + 70, destination[1] - node.size[1] / 2 + (vue ? 15 : -15)],
      };
    }, center);
    const from = await worldPoint(points.source), to = await worldPoint(points.dest);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.waitForTimeout(250);
    const hover = await page.locator('.clt-cell.clt-target').count();
    await page.mouse.up();
    await page.waitForTimeout(700);
    const attached = await attachState();
    const log = await page.evaluate(() => window.__log.slice(0, 14));
    console.log(`\n### ${label}: hover=${hover} attached=${attached}`);
    console.log(log.join('\n'));
  };

  console.log('vueNodesMode =', await page.evaluate(() => window.__vue));
  const center = await cellCenter();
  await dragTo(center, 'drag 1 (no transform set)');
  await page.evaluate(() => { const ds = window.comfyAPI.app.app.canvas.ds; ds.scale = 0.8; ds.offset = [0, 0]; });
  await page.waitForTimeout(400);
  await dragTo([80, 660], 'drag out (scale .8)');
  await dragTo(center, 'drag 2 (scale .8)');
  await context.close();
} finally { await browser.close(); }
