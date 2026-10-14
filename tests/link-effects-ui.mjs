// Fresh browser context, checkout assets, and isolated settings persistence.
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const base = process.env.COMFYUI_URL ?? 'http://127.0.0.1:8188';
const prefix = '/extensions/VF-ComfyUI-Grid-Layout/';
const browser = await chromium.launch({ headless: true });
const saved = {};
await mkdir('test-results', { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 }, recordVideo: { dir: 'test-results/link-effects-video', size: { width: 1500, height: 950 } } });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') console.log('Browser:', message.text().slice(0, 400)); });
  await page.route('**/extensions', async route => {
    const response = await route.fetch();
    const list = await response.json();
    await route.fulfill({ response, json: [...list.filter(path => !path.startsWith(prefix)), `${prefix}grid_layout.js`] });
  });
  await page.route(`${base}${prefix}**`, async route => {
    const relative = new URL(route.request().url()).pathname.slice(prefix.length);
    assert.ok(!relative.includes('..'));
    try { await route.fulfill({ contentType: 'text/javascript', body: await readFile(new URL(`../web/${relative}`, import.meta.url)) }); }
    catch { await route.fulfill({ status: 404, body: 'Missing checkout asset' }); }
  });
  await page.route(/\/settings(?:\/[^/?]+)?(?:\?.*)?$/, async route => {
    const request = route.request();
    if (request.method() === 'GET') {
      const response = await route.fetch();
      const values = await response.json();
      for (const id of Object.keys(values)) if (id.startsWith('VF.LinkEffects.')) delete values[id];
      await route.fulfill({ response, json: { ...values, ...saved } });
    } else {
      const id = new URL(request.url()).pathname.split('/settings/')[1];
      if (id) saved[decodeURIComponent(id)] = request.postDataJSON();
      else Object.assign(saved, request.postDataJSON());
      await route.fulfill({ status: 200, json: {} });
    }
  });
  // Workflow edits belong to this test context, not the running user's files.
  await page.route('**/userdata/**', route => route.request().method() === 'GET' ? route.continue() : route.fulfill({ status: 200, json: {} }));
  const ready = async () => {
    await page.waitForFunction(() => window.comfyAPI?.app?.app?.canvas);
    await page.waitForFunction(() => window.comfyAPI?.app?.app?.extensions?.find(e => e.name === 'VF.ComfyUI.GridLayout')?.overlay);
  };
  const set = (id, value) => page.evaluate(async ({ id, value }) => {
    const s = window.comfyAPI.app.app.ui.settings;
    await (s.setSettingValueAsync?.(id, value) ?? s.setSettingValue(id, value));
  }, { id, value });
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const state = () => page.evaluate(() => {
    const e = window.comfyAPI.app.app.extensions.find(e => e.name === 'VF.ComfyUI.GridLayout');
    return { links: [...e.overlay.linkEffects.connections.links], neighbors: [...e.overlay.linkEffects.connections.neighbors], enabled: e.overlay.linkEffects.enabled };
  });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await ready();
  await page.locator('.p-blockui-mask-document').waitFor({ state: 'hidden' });
  assert.equal((await state()).enabled, true);
  assert.equal(await page.evaluate(() => window.comfyAPI.app.app.ui.settings.getSettingValue('VF.LinkEffects.Effect')), 'electricity');
  await set('VF.LinkEffects.Enabled', false);
  await settle();
  // Check real settings UI, including conditional visibility without reopening.
  await page.evaluate(() => window.comfyAPI.app.app.extensionManager.command.execute('Comfy.ShowSettingsDialog'));
  await page.getByPlaceholder(/search/i).first().fill('VF Link Effects');
  const master = page.locator('[data-setting-id="VF.LinkEffects.Enabled"]');
  await master.waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-setting-id="VF.LinkEffects.Effect"]').count(), 0);
  await master.getByRole('switch').click();
  await page.getByPlaceholder(/search/i).first().fill('');
  await page.locator('[data-setting-id="VF.LinkEffects.Effect"]').waitFor({ state: 'visible' });
  await page.locator('[data-setting-id="VF.LinkEffects.HighlightConnectedNodes"]').waitFor({ state: 'visible' });
  assert.match(await master.locator('xpath=..').innerText(), /Graph/);
  const rows = await master.locator('xpath=..').locator('[data-setting-id^="VF.LinkEffects."]').evaluateAll(els => els.map(el => el.dataset.settingId));
  assert.deepEqual(rows, ['VF.LinkEffects.Enabled', 'VF.LinkEffects.Effect', 'VF.LinkEffects.HighlightConnectedNodes']);
  await master.scrollIntoViewIfNeeded();
  await master.locator('xpath=..').screenshot({ path: 'test-results/link-effects-settings.png' });
  await master.getByRole('switch').click();
  await page.locator('[data-setting-id="VF.LinkEffects.Effect"]').waitFor({ state: 'hidden' });
  await page.keyboard.press('Escape');
  console.log('Settings placement and live conditional visibility passed');

  await page.evaluate(async () => {
    const app = window.comfyAPI.app.app, LG = window.LiteGraph;
    await app.loadGraphData({ last_node_id: 0, last_link_id: 0, nodes: [], links: [], groups: [], config: {}, extra: {}, version: 0.4 });
    const make = (type, title, pos) => { const n = LG.createNode(type); n.title = title; n.pos = pos; app.graph.add(n); return n; };
    const source = make('EmptyImage', 'Source • magenta port', [100, 190]);
    const selected = make('SaveImage', 'Selected node', [570, 190]);
    const other = make('SaveImage', 'Unrelated wire', [570, 520]);
    const source2 = make('EmptyImage', 'Source • blue port', [100, 520]);
    source.outputs[0].color_on = '#ee5599';
    source2.outputs[0].color_on = '#55aaff';
    const connectedLink = source.connect(0, selected, 0);
    const otherLink = source2.connect(0, other, 0);
    app.canvas.ds.scale = 1;
    app.canvas.ds.offset = [80, 30];
    app.canvas.selectNodes([selected]);
    window.linkTest = { source: source.id, selected: selected.id, other: other.id, source2: source2.id, connectedLink: connectedLink.id, otherLink: otherLink.id };
    window.linkSegments = [];
    const overlay = app.extensions.find(e => e.name === 'VF.ComfyUI.GridLayout').overlay;
    const originalLink = overlay.origRenderLink;
    overlay.origRenderLink = function (ctx, start, end, link, ...rest) {
      window.activeLinkId = link?.id ?? null;
      window.activeLinkSegment = rest[5]?.reroute?.id ?? null;
      if (window.recordLinkStrokes) window.linkSegments.push({ start: [...start], end: [...end], link: link?.id, reroute: window.activeLinkSegment });
      try { return originalLink.call(this, ctx, start, end, link, ...rest); }
      finally { window.activeLinkId = null; window.activeLinkSegment = null; }
    };
    window.linkCapture = [];
    const native = CanvasRenderingContext2D.prototype.stroke;
    const nativeAlpha = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'globalAlpha').get;
    CanvasRenderingContext2D.prototype.stroke = function (...args) {
      if (window.recordLinkStrokes) window.linkCapture.push({ color: this.strokeStyle, dash: this.getLineDash(), offset: this.lineDashOffset, blur: this.shadowBlur, width: this.lineWidth, link: window.activeLinkId, segment: window.activeLinkSegment, alpha: nativeAlpha.call(this) });
      return native.apply(this, args);
    };
    app.canvas.setDirty(true, true);
  });
  await set('Comfy.VueNodes.Enabled', false);
  await set('VF.LinkEffects.Enabled', true);
  await settle();
  const capture = () => page.evaluate(() => {
    window.linkCapture = []; window.linkSegments = []; window.recordLinkStrokes = true;
    window.comfyAPI.app.app.canvas.draw(true, true);
    window.recordLinkStrokes = false;
    return window.linkCapture;
  });
  const otherLinkId = await page.evaluate(() => window.linkTest.otherLink);
  const connectedLinkId = await page.evaluate(() => window.linkTest.connectedLink);
  let strokes = await capture();
  assert.ok(strokes.some(s => s.color === '#ee5599' && s.dash.length === 0), 'affected wire has output port color');
  assert.ok(strokes.some(s => s.dash[0] === 12 && s.offset < 0), 'electricity pulses animate on native strokes');
  assert.ok(strokes.some(s => s.color === 'rgba(120, 144, 156, 0.65)'), 'classic neighbor has muted border');
  assert.ok(!strokes.some(s => s.color === '#55aaff' && s.dash[0] === 12), 'unrelated wire has no link effects');
  assert.ok(strokes.filter(s => s.link === otherLinkId).every(s => Math.abs(s.alpha - 0.3) < 0.01), 'unrelated wire is dimmed to 30% alpha');
  assert.deepEqual((await state()).neighbors, [String(await page.evaluate(() => window.linkTest.source))]);
  const dimmedPixel = await page.evaluate(() => {
    const app = window.comfyAPI.app.app, ext = app.extensions.find(e => e.name === 'VF.ComfyUI.GridLayout');
    const ctx = document.createElement('canvas').getContext('2d');
    ext.overlay.linkEffects.renderNode(ctx, app.graph.getNodeById(window.linkTest.source2), () => {
      ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.fillRect(0,0,1,1);
    });
    const nodeAlpha = ctx.getImageData(0,0,1,1).data[3];
    ctx.clearRect(0,0,1,1);
    ext.overlay.linkEffects.renderLink(ctx, app.graph.getLink(window.linkTest.otherLink), () => {
      ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.fillRect(0,0,1,1);
    });
    return { alpha: nodeAlpha, linkAlpha: ctx.getImageData(0,0,1,1).data[3], restored: ctx.globalAlpha };
  });
  assert.ok(dimmedPixel.alpha >= 75 && dimmedPixel.alpha <= 78, 'classic unrelated node draw uses 30% alpha');
  assert.ok(dimmedPixel.linkAlpha >= 75 && dimmedPixel.linkAlpha <= 78, 'unrelated link draw uses 30% alpha');
  assert.equal(dimmedPixel.restored, 1);
  await page.screenshot({ path: 'test-results/link-effects-electricity.png' });
  await page.waitForTimeout(1200);
  await set('VF.LinkEffects.Effect', 'neon');
  await settle();
  strokes = await capture();
  assert.ok(strokes.some(s => s.color === '#ee5599' && s.blur === 12), 'neon halo uses port color');
  assert.ok(!strokes.some(s => s.dash[0] === 12), 'neon has no electricity pulses');
  await page.screenshot({ path: 'test-results/link-effects-neon.png' });

  for (const mode of [0, 1, 2, 3]) {
    await set('Comfy.LinkRenderMode', mode);
    await settle();
    const actual = await page.evaluate(() => ({ mode: window.comfyAPI.app.app.canvas.links_render_mode, hidden: window.LiteGraph.HIDDEN_LINK }));
    strokes = await capture();
    if (actual.mode !== actual.hidden) assert.ok(strokes.some(s => s.color === '#ee5599' && s.blur === 12), `port-colored neon in render mode ${mode}`);
  }
  await set('Comfy.LinkRenderMode', -1);
  await settle();
  strokes = await capture();
  assert.ok(strokes.some(s => s.link === connectedLinkId && s.color === '#ee5599' && s.blur === 12), 'hidden link mode shows connected link when VF Link Effects and Highlight connected nodes are enabled');
  assert.equal(strokes.filter(s => s.link === otherLinkId).length, 0, 'hidden link mode leaves unconnected links hidden');
  assert.ok(strokes.some(s => s.color === 'rgba(120, 144, 156, 0.65)'), 'hidden link mode still highlights connected neighbor node');
  await set('VF.LinkEffects.HighlightConnectedNodes', false);
  await settle();
  strokes = await capture();
  assert.equal(strokes.filter(s => s.link === connectedLinkId).length, 0, 'hidden link mode hides all links when Highlight connected nodes is disabled');
  await set('VF.LinkEffects.HighlightConnectedNodes', true);
  await settle();
  console.log('Native link modes (including Hidden), electricity, neon, port colors, and classic neighbor border passed');

  await set('Comfy.LinkRenderMode', 2);
  await set('VF.LinkEffects.Effect', 'electricity');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await settle();
  strokes = await capture();
  assert.ok(strokes.some(s => s.dash[0] === 12 && s.offset === 0), 'reduced motion keeps stationary electricity');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => {
    const app = window.comfyAPI.app.app;
    app.canvas.selectNodes([app.graph.getNodeById(window.linkTest.selected), app.graph.getNodeById(window.linkTest.other)]);
  });
  await settle();
  assert.equal((await state()).links.length, 2);
  assert.equal((await state()).neighbors.length, 2);
  await page.evaluate(() => window.comfyAPI.app.app.canvas.deselectAllNodes());
  await settle();
  assert.equal((await state()).links.length, 0);
  assert.equal(await page.evaluate(() => window.comfyAPI.app.app.extensions.find(e => e.name === 'VF.ComfyUI.GridLayout').overlay.linkEffects.isDimmed(window.linkTest.source2)), false);
  assert.equal(await page.evaluate(() => {
    const app = window.comfyAPI.app.app, ext = app.extensions.find(e => e.name === 'VF.ComfyUI.GridLayout');
    return ext.overlay.linkEffects.isLinkDimmed(app.graph.getLink(window.linkTest.otherLink));
  }), false);
  strokes = await capture();
  assert.ok(!strokes.some(s => s.dash[0] === 12), 'no selection means no effects');
  assert.ok(strokes.filter(s => s.link === otherLinkId).every(s => s.alpha === 1), 'no selection restores unrelated wire brightness');

  await set('VF.LinkEffects.Effect', 'neon');
  const rerouteId = await page.evaluate(() => {
    const app = window.comfyAPI.app.app, source = app.graph.getNodeById(window.linkTest.source), selected = app.graph.getNodeById(window.linkTest.selected);
    const first = app.graph.getLink(selected.inputs[0].link);
    const reroute = app.graph.createReroute([480,370], first);
    const branch = window.LiteGraph.createNode('SaveImage');
    branch.title = 'Selected branch'; branch.pos = [950,400]; app.graph.add(branch);
    const branchLink = source.connect(0, branch, 0);
    branchLink.parentId = reroute.id;
    app.graph.incrementVersion?.();
    window.linkTest.branch = branch.id;
    window.linkTest.reroute = reroute.id;
    app.canvas.selectNodes([branch]);
    return reroute.id;
  });
  await settle();
  strokes = await capture();
  assert.ok(strokes.some(s => s.segment === rerouteId && s.color === '#ee5599' && s.blur === 12), 'shared trunk gets effects when unselected branch draws it first');
  assert.ok(strokes.filter(s => s.link === connectedLinkId && s.segment === null).every(s => Math.abs(s.alpha - 0.3) < 0.01), 'unselected branch segment after shared reroute is dimmed');
  await page.screenshot({ path: 'test-results/link-effects-shared-reroute.png' });
  const frameEndpoints = await page.evaluate(() => {
    const app = window.comfyAPI.app.app, ext = app.extensions.find(e => e.name === 'VF.ComfyUI.GridLayout');
    const frame = ext.controller.createFromNodes([window.linkTest.source], 'columns');
    ext.overlay.toggleMinimize(frame.id);
    window.linkTest.frame = frame.id;
    return [frame.pos[0]+frame.size[0], frame.pos[1]+frame.size[1]/2];
  });
  await settle();
  await capture();
  const segments = await page.evaluate(() => window.linkSegments);
  const routedTrunk = segments.find(s => s.reroute === rerouteId);
  assert.deepEqual(routedTrunk.start, frameEndpoints);
  assert.deepEqual(routedTrunk.end, [480,370]);
  assert.ok(segments.some(s => s.reroute === null && s.start[0] === 480 && s.start[1] === 370), 'last segment still starts at reroute');
  await page.screenshot({ path: 'test-results/link-effects-minimized-reroute.png' });
  await page.evaluate(() => {
    const app = window.comfyAPI.app.app, ext = app.extensions.find(e => e.name === 'VF.ComfyUI.GridLayout');
    ext.overlay.toggleMinimize(window.linkTest.frame);
    app.graph.remove(app.graph.getNodeById(window.linkTest.branch));
    app.graph.removeReroute(window.linkTest.reroute);
    app.canvas.selectNodes([app.graph.getNodeById(window.linkTest.selected)]);
  });
  await settle();
  console.log('Reduced motion, multiple/empty selection, shared reroutes, and minimized routing passed');

  await set('Comfy.LinkRenderMode', 2);
  await set('Comfy.VueNodes.Enabled', true);
  await page.locator('.lg-node').first().waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelectorAll('.vf-link-neighbor').length === 1);
  await page.waitForFunction(() => document.querySelectorAll('.vf-link-dimmed').length === 2);
  const dimmedIds = await page.locator('.vf-link-dimmed').evaluateAll(els => els.map(el => el.dataset.nodeId).sort());
  assert.deepEqual(dimmedIds, await page.evaluate(() => [String(window.linkTest.source2), String(window.linkTest.other)].sort()));
  assert.equal(await page.locator('.vf-link-dimmed').first().evaluate(el => getComputedStyle(el).filter), 'opacity(0.3)');
  const portColor = await page.evaluate(() => getComputedStyle(document.querySelector(`.lg-node[data-node-id="${window.linkTest.source}"] .lg-slot--output .slot-dot`)).backgroundColor);
  const normalizedPortColor = await page.evaluate(color => { const ctx = document.createElement('canvas').getContext('2d'); ctx.strokeStyle = color; return ctx.strokeStyle; }, portColor);
  strokes = await capture();
  assert.ok(strokes.some(s => s.color === normalizedPortColor && s.blur === 12), 'Nodes 2.0 wire matches its actual DOM output-port color');
  assert.ok(strokes.filter(s => s.link === otherLinkId).every(s => Math.abs(s.alpha - 0.3) < 0.01), 'Nodes 2.0 unrelated wire is dimmed to 30% alpha');
  const selectedId = await page.evaluate(() => window.linkTest.selected);
  assert.equal(await page.locator(`.lg-node[data-node-id="${selectedId}"].vf-link-neighbor`).count(), 0);
  await page.screenshot({ path: 'test-results/link-effects-nodes2.png' });
  await page.evaluate(() => {
    const canvas = window.comfyAPI.app.app.canvas;
    canvas.ds.scale = 0.7; canvas.ds.offset = [220,120]; canvas.setDirty(true,true);
  });
  await settle();
  assert.ok((await capture()).some(s => s.color === normalizedPortColor && s.blur === 12), 'effect follows zoomed and panned native geometry');
  await page.evaluate(() => window.comfyAPI.app.app.graph.getNodeById(window.linkTest.source).disconnectOutput(0));
  await page.waitForFunction(() => window.comfyAPI.app.app.extensions.find(e => e.name === 'VF.ComfyUI.GridLayout').overlay.linkEffects.connections.links.size === 0);
  assert.equal(await page.locator('.vf-link-neighbor').count(), 0);
  await page.evaluate(() => {
    const app = window.comfyAPI.app.app;
    app.graph.getNodeById(window.linkTest.source).connect(0, app.graph.getNodeById(window.linkTest.selected), 0);
  });
  await page.waitForFunction(() => document.querySelectorAll('.vf-link-neighbor').length === 1);
  await set('VF.LinkEffects.HighlightConnectedNodes', false);
  await page.waitForFunction(() => document.querySelectorAll('.vf-link-neighbor').length === 0);
  await set('VF.LinkEffects.Enabled', false);
  await settle();
  assert.equal(await page.locator('.vf-link-dimmed').count(), 0);
  strokes = await capture();
  assert.ok(!strokes.some(s => s.blur === 12 || s.dash[0] === 12), 'disable restores native link rendering');
  assert.ok(strokes.filter(s => s.link === otherLinkId).every(s => s.alpha === 1), 'disable restores unrelated wire brightness');
  await set('VF.LinkEffects.Enabled', true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready();
  const preferences = await page.evaluate(() => {
    const s = window.comfyAPI.app.app.ui.settings;
    return [s.getSettingValue('VF.LinkEffects.Enabled'), s.getSettingValue('VF.LinkEffects.Effect'), s.getSettingValue('VF.LinkEffects.HighlightConnectedNodes')];
  });
  assert.deepEqual(preferences, [true, 'neon', false]);
  await page.evaluate(() => window.comfyAPI.app.app.extensions.find(e => e.name === 'VF.ComfyUI.GridLayout').overlay.dispose());
  assert.equal(await page.locator('.vf-link-neighbor').count(), 0);
  assert.equal(await page.locator('.vf-link-dimmed').count(), 0);
  assert.equal(await page.locator('.clt-overlay').count(), 0);
  assert.deepEqual(errors, [], 'no runtime errors');
  console.log('Nodes 2.0, clean disable, and persisted preferences passed');
  await page.unrouteAll({ behavior: 'wait' });
  await context.close();
} finally { await browser.close(); }

