import test from 'node:test';
import assert from 'node:assert/strict';
import * as effects from '../web/core/link-effects.js';
import * as overlay from '../web/core/overlay.js';

const nodes = [1, 2, 3, 4, 5].map(id => ({ id, inputs: [], outputs: [{ type: 'IMAGE', color_on: '#e34a93' }] }));
const links = [
  { id: 10, origin_id: 1, target_id: 2, origin_slot: 0, target_slot: 0, type: 'IMAGE' },
  { id: 11, origin_id: 2, target_id: 3, origin_slot: 0, target_slot: 0, type: 'IMAGE' },
  { id: 12, origin_id: 4, target_id: 2, origin_slot: 0, target_slot: 0, type: 'IMAGE' },
  { id: 13, origin_id: 3, target_id: 5, origin_slot: 0, target_slot: 0, type: 'IMAGE' },
  { id: 14, origin_id: 99, target_id: 2, origin_slot: 0, target_slot: 0, type: 'IMAGE' },
];
const graph = { links: Object.fromEntries(links.map(l => [l.id, l])), getNodeById: id => nodes.find(n => String(n.id) === String(id)) };

test('effects collect incoming/outgoing wires and only immediate unselected neighbors across a selection', () => {
  assert.equal(typeof effects.collectConnections, 'function');
  const result = effects.collectConnections(graph, [nodes[1], nodes[2]]);
  assert.deepEqual([...result.links].sort(), ['10', '11', '12', '13']);
  assert.deepEqual([...result.neighbors].sort(), ['1', '4', '5']);
});

test('empty or stale selection and deleted endpoints have no effects', () => {
  assert.equal(typeof effects.collectConnections, 'function');
  assert.equal(effects.collectConnections(graph, []).links.size, 0);
  assert.equal(effects.collectConnections(graph, [{ id: 2 }]).links.size, 0);
  const result = effects.collectConnections({ ...graph, links: new Map(links.map(l => [l.id,l])) }, [nodes[1]]);
  assert.deepEqual([...result.neighbors].sort(), ['1', '3', '4']);
  assert.ok(!result.links.has('14'));
});

test('wire color comes from the displayed output port before type and existing link colors', () => {
  assert.equal(typeof effects.outputPortColor, 'function');
  const canvas = { colourGetter: { getConnectedColor: () => '#91aabb' }, default_link_color: '#888' };
  const link = { ...links[0], color: '#ff0000' };
  const source = { outputs: [{ color_on: '#aabbcc', renderingColor: colors => colors.getConnectedColor('IMAGE') }] };
  const g = { getNodeById: () => source };
  assert.equal(effects.outputPortColor(g, canvas, link, { IMAGE: '#22cc44' }), '#91aabb');
  delete source.outputs[0].renderingColor;
  assert.equal(effects.outputPortColor(g, canvas, link, { IMAGE: '#22cc44' }), '#aabbcc');
  delete source.outputs[0].color_on;
  assert.equal(effects.outputPortColor(g, canvas, link, { IMAGE: '#22cc44' }), '#22cc44');
  assert.equal(effects.outputPortColor(g, canvas, link, {}), '#ff0000');
});

test('Nodes 2.0 uses the visible DOM output-port color instead of a classic-only override', () => {
  const old = { document: globalThis.document, LiteGraph: globalThis.LiteGraph, getComputedStyle: globalThis.getComputedStyle, CSS: globalThis.CSS };
  const dot = { tagName: 'DIV' };
  const node = { dataset: { nodeId: '1' }, querySelectorAll: () => [{ querySelector: () => dot }] };
  globalThis.LiteGraph = { vueNodesMode: true };
  globalThis.document = { querySelectorAll: () => [node] };
  globalThis.CSS = undefined;
  globalThis.getComputedStyle = () => ({ backgroundColor: 'rgb(85, 170, 255)' });
  try { assert.equal(effects.outputPortColor(graph, {}, links[0]), 'rgb(85, 170, 255)'); }
  finally { Object.assign(globalThis, old); }
});

test('dependent settings hide with master disabled while preserving saved preferences', () => {
  assert.equal(typeof effects.createLinkEffectSettings, 'function');
  const values = new Map();
  const settings = { getSettingValue: (id, fallback) => values.get(id) ?? fallback };
  const defs = effects.createLinkEffectSettings(settings);
  const [master, effect, neighbors] = defs;
  assert.equal(master.defaultValue, true);
  values.set(master.id, false);
  assert.equal(effect.type, 'hidden');
  assert.equal(neighbors.type, 'hidden');
  values.set(master.id, true);
  assert.equal(effect.type, 'combo');
  assert.equal(neighbors.type, 'boolean');
  values.set(effect.id, 'neon');
  values.set(neighbors.id, false);
  values.set(master.id, false);
  assert.equal(effect.type, 'hidden');
  assert.equal(values.get(effect.id), 'neon');
  assert.equal(values.get(neighbors.id), false);
});

test('Graph settings present the master before its effect and neighbor controls', () => {
  const defs = effects.createLinkEffectSettings({ getSettingValue: () => true });
  const ordered = defs.toSorted((a,b) => (b.sortOrder ?? 0) - (a.sortOrder ?? 0) || a.name.localeCompare(b.name));
  assert.deepEqual(ordered.map(s => s.id), ['VF.LinkEffects.Enabled', 'VF.LinkEffects.Effect', 'VF.LinkEffects.HighlightConnectedNodes']);
});

function rendererFixture() {
  const values = new Map([[effects.LINK_EFFECT_SETTINGS.enabled, true]]);
  const canvas = {
    connections_width: 3, ds: { scale: 1 },
    setDirty: (...flags) => canvas.dirty.push(flags), dirty: [],
    renderedPaths: new Set([links[0]]),
  };
  const controller = { graph, app: { canvas, ui: { settings: { getSettingValue: (id, fallback) => values.get(id) ?? fallback } } }, selectedNodes: () => [nodes[1]] };
  return { values, canvas, controller };
}

test('selection dims only unrelated nodes and clearing selection restores brightness', () => {
  const { controller, values } = rendererFixture();
  const renderer = new effects.LinkEffects(controller);
  renderer.update(0);
  assert.equal(typeof renderer.isDimmed, 'function');
  assert.equal(renderer.isDimmed(2), false);
  assert.equal(renderer.isDimmed(1), false);
  assert.equal(renderer.isDimmed(3), false);
  assert.equal(renderer.isDimmed(4), false);
  assert.equal(renderer.isDimmed(5), true);
  values.set(effects.LINK_EFFECT_SETTINGS.neighbors, false);
  renderer.update(16);
  assert.equal(renderer.isDimmed(5), true, 'dimming is independent of neighbor border toggle');
  controller.selectedNodes = () => [];
  renderer.update(32);
  assert.equal(renderer.isDimmed(5), false);
  controller.selectedNodes = () => [nodes[4]];
  renderer.update(48);
  assert.equal(renderer.isDimmed(1), true);
  values.set(effects.LINK_EFFECT_SETTINGS.enabled, false);
  renderer.update(64);
  assert.equal(renderer.isDimmed(1), false);
  renderer.dispose();
});

test('classic dimming scales alpha even when native drawing resets it and restores the context', () => {
  const { controller } = rendererFixture();
  const renderer = new effects.LinkEffects(controller);
  renderer.update(0);
  assert.equal(typeof renderer.renderNode, 'function');
  let alpha = 0.8;
  const proto = { get globalAlpha() { return alpha; }, set globalAlpha(v) { if (v >= 0 && v <= 1) alpha = v; } };
  const ctx = Object.create(proto);
  renderer.renderNode(ctx, nodes[4], () => {
    ctx.globalAlpha = 1;
    assert.equal(alpha, 0.3);
    ctx.globalAlpha = 0.5;
    assert.equal(alpha, 0.15);
    ctx.globalAlpha = 2;
    assert.equal(alpha, 0.15, 'invalid native alpha assignments stay ignored');
  });
  assert.equal(alpha, 0.8);
  assert.equal(Object.hasOwn(ctx, 'globalAlpha'), false);
  assert.throws(() => renderer.renderNode(ctx, nodes[4], () => { throw Error('draw failure'); }), /draw failure/);
  assert.equal(alpha, 0.8);
  renderer.dispose();
});

test('electricity reuses native path strokes, moves toward input, and restores drawing state', () => {
  assert.equal(typeof effects.LinkEffects, 'function');
  const { controller } = rendererFixture();
  const renderer = new effects.LinkEffects(controller);
  renderer.update(1000);
  const path = {};
  const strokes = [];
  const states = [];
  const ctx = {
    lineWidth: 3, strokeStyle: '#000', globalAlpha: 1, shadowColor: 'transparent', shadowBlur: 0, lineDashOffset: 0, lineCap: 'butt', dash: [],
    save() { states.push({ lineWidth: this.lineWidth, strokeStyle: this.strokeStyle, globalAlpha: this.globalAlpha, shadowColor: this.shadowColor, shadowBlur: this.shadowBlur, lineDashOffset: this.lineDashOffset, lineCap: this.lineCap, dash: [...this.dash] }); },
    restore() { Object.assign(this, states.pop()); },
    setLineDash(dash) { this.dash = dash; },
    stroke(p) { strokes.push({ path: p, color: this.strokeStyle, alpha: this.globalAlpha, blur: this.shadowBlur, width: this.lineWidth, dash: [...this.dash], offset: this.lineDashOffset }); },
  };
  const nativeStroke = ctx.stroke;
  renderer.renderLink(ctx, links[0], () => { ctx.strokeStyle = '#aabbcc'; ctx.stroke(path); });
  assert.equal(ctx.stroke, nativeStroke);
  assert.equal(ctx.strokeStyle, '#aabbcc');
  assert.ok(strokes.some(s => s.color === '#e34a93' && !s.dash.length && s.blur >= 6));
  const firstPulse = strokes.find(s => s.dash.length);
  assert.ok(firstPulse);
  assert.equal(firstPulse.path, path, 'uses native geometry');
  assert.equal(firstPulse.alpha, 1, 'electricity pulse renders at full opacity');
  assert.ok(firstPulse.blur >= 8 && firstPulse.width >= 1.8, 'electricity pulse has brighter glow and core');
  renderer.update(1100);
  strokes.length = 0;
  renderer.renderLink(ctx, links[0], () => ctx.stroke(path));
  const secondPulse = strokes.find(s => s.dash.length);
  assert.ok(firstPulse.offset - secondPulse.offset >= 30, 'negative dash offset advances briskly output-to-input');
  assert.equal(ctx.lineDashOffset, 0);
  renderer.dispose();
});

test('unrelated wires dim without link effects and restore context state after draw or failure', () => {
  assert.equal(typeof effects.LinkEffects, 'function');
  const { controller, values } = rendererFixture();
  const renderer = new effects.LinkEffects(controller);
  renderer.update(0);
  assert.equal(typeof renderer.isLinkDimmed, 'function');
  assert.equal(renderer.isLinkDimmed(links[0]), false);
  assert.equal(renderer.isLinkDimmed(links[3]), true);
  assert.equal(renderer.isLinkDimmed(null), false);
  let alpha = 0.8;
  const proto = { get globalAlpha() { return alpha; }, set globalAlpha(v) { if (v >= 0 && v <= 1) alpha = v; }, stroke() {} };
  const ctx = Object.create(proto);
  const stroke = ctx.stroke;
  let called = 0;
  renderer.renderLink(ctx, links[3], () => {
    assert.equal(ctx.stroke, stroke);
    assert.ok(Math.abs(alpha - 0.24) < 1e-9, 'unconnected link starts dimmed to 30%');
    ctx.globalAlpha = 1;
    assert.equal(alpha, 0.3, 'alpha assignments inside link draw stay scaled');
    called++;
  });
  assert.equal(called, 1);
  assert.equal(alpha, 0.8);
  assert.equal(Object.hasOwn(ctx, 'globalAlpha'), false);
  assert.throws(() => renderer.renderLink(ctx, links[3], () => { throw Error('dimmed link failure'); }), /dimmed link failure/);
  assert.equal(alpha, 0.8);
  controller.selectedNodes = () => [];
  renderer.update(16);
  assert.equal(renderer.isLinkDimmed(links[3]), false);
  renderer.renderLink(ctx, links[3], () => { assert.equal(alpha, 0.8, 'clearing selection restores link brightness'); });
  controller.selectedNodes = () => [nodes[4]];
  renderer.update(32);
  assert.equal(renderer.isLinkDimmed(links[1], { linkIds: new Set([11, 13]) }), false, 'shared reroute trunk is not dimmed');
  assert.equal(renderer.isLinkDimmed(links[1]), true, 'unselected branch segment is dimmed');
  values.set(effects.LINK_EFFECT_SETTINGS.enabled, false);
  renderer.update(48);
  assert.equal(renderer.isLinkDimmed(links[1]), false);
  assert.throws(() => renderer.renderLink(ctx, links[0], () => { throw Error('native failure'); }), /native failure/);
  assert.equal(ctx.stroke, stroke);
  renderer.dispose();
});

test('redraws stop for neon, reduced motion, no visible affected wires, and master off', () => {
  assert.equal(typeof effects.LinkEffects, 'function');
  const { controller, canvas, values } = rendererFixture();
  const renderer = new effects.LinkEffects(controller);
  renderer.update(0);
  canvas.dirty.length = 0;
  renderer.update(16);
  assert.equal(canvas.dirty.length, 1);
  values.set(effects.LINK_EFFECT_SETTINGS.effect, 'neon');
  renderer.update(32);
  canvas.dirty.length = 0;
  renderer.update(48);
  assert.equal(canvas.dirty.length, 0);
  values.set(effects.LINK_EFFECT_SETTINGS.effect, 'electricity');
  renderer.update(64);
  renderer.motion = { matches: true };
  canvas.dirty.length = 0;
  renderer.update(80);
  canvas.dirty.length = 0;
  renderer.update(96);
  assert.equal(canvas.dirty.length, 0);
  renderer.motion = { matches: false };
  canvas.renderedPaths.clear();
  renderer.update(112);
  canvas.dirty.length = 0;
  renderer.update(128);
  assert.equal(canvas.dirty.length, 0);
  values.set(effects.LINK_EFFECT_SETTINGS.enabled, false);
  renderer.update(144);
  assert.equal(renderer.connections.links.size, 0);
  canvas.dirty.length = 0;
  renderer.update(160);
  assert.equal(canvas.dirty.length, 0);
  renderer.dispose();
});

test('a shared reroute receives effects even when its first rendered branch is unselected', () => {
  const { controller } = rendererFixture();
  controller.selectedNodes = () => [nodes[4]];
  const renderer = new effects.LinkEffects(controller);
  renderer.update(0);
  let decorated = false;
  const ctx = { stroke() {} }, native = ctx.stroke;
  renderer.renderLink(ctx, links[1], () => { decorated = ctx.stroke !== native; }, { linkIds: new Set([11, 13]) });
  assert.ok(decorated, 'shared trunk belongs to selected branch 13');
  renderer.dispose();
});

test('classic circle and card neighbor borders match their native shape geometry', () => {
  const original = globalThis.LiteGraph;
  globalThis.LiteGraph = { CIRCLE_SHAPE: 3, CARD_SHAPE: 4, BOX_SHAPE: 1, ROUND_RADIUS: 8, NODE_TITLE_HEIGHT: 30 };
  try {
    const { controller } = rendererFixture();
    const renderer = new effects.LinkEffects(controller);
    renderer.update(0);
    const calls = [];
    const ctx = { save() {}, restore() {}, beginPath() {}, stroke() {}, setLineDash() {}, arc: (...v) => calls.push(v), roundRect: (...v) => calls.push(v) };
    const node = { id: 1, pos: [100,100], size: [200,120], renderingSize: [200,120], boundingRect: [100,70,200,150], renderingShape: 3 };
    renderer.drawNodeBorder(node, ctx);
    assert.deepEqual(calls[0].slice(0,3), [100,60,100]);
    node.renderingShape = 4;
    renderer.drawNodeBorder(node, ctx);
    assert.deepEqual(calls[1], [0,-30,200,150,[8,8,0,0]]);
    renderer.dispose();
  } finally { globalThis.LiteGraph = original; }
});

test('minimized endpoints move only at the ends of a rerouted wire', () => {
  assert.equal(typeof overlay.routeMinimizedEndpoints, 'function');
  const source = { pos: [10,20], size: [200,40] }, target = { pos: [800,50], size: [200,40] };
  const hidden = { frames: new Map([['1', source], ['2', target]]) };
  const graph = { getReroute: id => id === 6 ? { pos: [400,100] } : undefined };
  const link = { origin_id: 1, target_id: 2 };
  const first = overlay.routeMinimizedEndpoints(hidden, graph, link, [20,30], [400,100], { reroute: { id: 6 } });
  assert.deepEqual(first, [[210,40],[400,100]]);
  const middle = overlay.routeMinimizedEndpoints(hidden, graph, link, [400,100], [500,100], { reroute: { id: 7, parentId: 6 }, startControl: [15,0] });
  assert.deepEqual(middle, [[400,100],[500,100]]);
  const last = overlay.routeMinimizedEndpoints(hidden, graph, link, [500,100], [810,60], { startControl: [15,0] });
  assert.deepEqual(last, [[500,100],[800,70]]);
  assert.equal(overlay.routeMinimizedEndpoints({ frames: new Map([['1', source], ['2', source]]) }, graph, link, [20,30], [30,30]), null);
});

test('hidden native link render mode shows only connected links when VF Link Effects and Highlight connected nodes are enabled', () => {
  const original = globalThis.LiteGraph;
  globalThis.LiteGraph = { HIDDEN_LINK: -1, SPLINE_LINK: 2 };
  try {
    const { controller, canvas, values } = rendererFixture();
    canvas.links_render_mode = -1;
    const segmented = [];
    const origSegments = function (ctx, link) { segmented.push(link.id); };
    canvas._renderAllLinkSegments = origSegments;
    const renderer = new effects.LinkEffects(controller);
    renderer.update(100);

    assert.equal(typeof renderer.drawConnections, 'function');
    const drawnLinks = [];
    const ctx = {
      lineWidth: 3, strokeStyle: '#000', globalAlpha: 1, shadowColor: 'transparent', shadowBlur: 0, lineDashOffset: 0, lineCap: 'butt',
      save() {}, restore() {}, setLineDash() {}, stroke() {},
    };

    renderer.drawConnections(ctx, () => {
      assert.equal(canvas.links_render_mode, 2, 'temporarily switches from HIDDEN_LINK to SPLINE_LINK during drawConnections');
      canvas._renderAllLinkSegments(ctx, links[0]);
      canvas._renderAllLinkSegments(ctx, links[3]);
      renderer.renderLink(ctx, links[0], () => { drawnLinks.push(links[0].id); ctx.stroke({}); });
      renderer.renderLink(ctx, links[3], () => { drawnLinks.push(links[3].id); ctx.stroke({}); });
    });

    assert.equal(canvas.links_render_mode, -1, 'restores HIDDEN_LINK after drawConnections');
    assert.equal(canvas._renderAllLinkSegments, origSegments, 'restores _renderAllLinkSegments after drawConnections');
    assert.deepEqual(segmented, [10], 'only connected link runs _renderAllLinkSegments');
    assert.deepEqual(drawnLinks, [10], 'connected link is rendered while unconnected link stays hidden');
    assert.equal(renderer.isDimmed(1), false, 'connected neighbor node is shown at full brightness');
    assert.equal(renderer.isDimmed(5), true, 'unconnected node is dimmed');

    canvas.dirty.length = 0;
    renderer.update(116);
    assert.equal(canvas.dirty.length, 1, 'electricity animation continues redrawing revealed hidden links');

    assert.throws(() => renderer.drawConnections(ctx, () => { throw Error('conn failure'); }), /conn failure/);
    assert.equal(canvas.links_render_mode, -1, 'restores HIDDEN_LINK even if drawConnections throws');
    assert.equal(canvas._renderAllLinkSegments, origSegments);

    // When Highlight connected nodes is disabled, hidden link mode keeps all links hidden
    values.set(effects.LINK_EFFECT_SETTINGS.neighbors, false);
    renderer.update(132);
    drawnLinks.length = 0;
    renderer.drawConnections(ctx, () => {
      assert.equal(canvas.links_render_mode, -1, 'leaves links_render_mode as HIDDEN_LINK when Highlight connected nodes is off');
      renderer.renderLink(ctx, links[0], () => drawnLinks.push(links[0].id));
    });
    assert.deepEqual(drawnLinks, [], 'no links are drawn when Highlight connected nodes is off in hidden mode');
    canvas.dirty.length = 0;
    renderer.update(148);
    assert.equal(canvas.dirty.length, 0, 'no electricity redraws when hidden links are not revealed');

    // When Highlight connected nodes is re-enabled but no nodes are selected, all links stay hidden
    values.set(effects.LINK_EFFECT_SETTINGS.neighbors, true);
    controller.selectedNodes = () => [];
    renderer.update(164);
    renderer.drawConnections(ctx, () => {
      assert.equal(canvas.links_render_mode, -1, 'leaves links_render_mode as HIDDEN_LINK when nothing is selected');
    });

    renderer.dispose();
  } finally {
    globalThis.LiteGraph = original;
  }
});

