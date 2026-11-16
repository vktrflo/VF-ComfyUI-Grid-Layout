import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../web/core/layout.js';
import {
  BOTTOM_TAB_BAR_HEIGHT,
  GROUP_TAB_HEADER_HEIGHT,
  classifyNodeSections,
  createAutoNodeTabs,
  syncNodeTabConfig,
  selectNodeBottomTab,
  renameNodeBottomTab,
  reorderNodeBottomTab,
  mergeNodeBottomTabs,
  addCustomNodeBottomTab,
  removeSingleNodeBottomTab,
  assignWidgetToNodeTab,
  setNodeTabsSizing,
  toggleGroupTabLayoutMode,
  setStackSizing,
  reorderStackTab,
  detachStackTab,
  validateBottomTabsData,
} from '../web/core/bottom-tabs.js';
import {
  updateWirePeekState,
  effectiveNodeTabIndex,
  drawClassicNodeWithBottomTabs,
  syncVueNodeSectionTabs,
  openConfigureBottomTabsDialog,
} from '../web/core/bottom-tabs-ui.js';
import { LayoutController } from '../web/core/controller.js';
import { LayoutOverlay, routeMinimizedEndpoints } from '../web/core/overlay.js';

function createTestGraph(nodes = [], groups = [], links = []) {
  const map = new Map(nodes.map(n => [String(n.id), n]));
  return {
    id: 'test-graph',
    extra: {},
    _nodes: nodes,
    _groups: groups,
    links,
    getNodeById(id) {
      return map.get(String(id)) ?? null;
    },
    setDirtyCanvas() {},
  };
}

function createTestApp(graph) {
  return {
    configuringGraph: false,
    graph,
    canvas: {
      graph,
      ds: { scale: 1, offset: [0, 0] },
      selected_nodes: {},
      canvas: {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }),
        parentElement: null,
      },
      setDirty() {},
      emitBeforeChange() {},
      emitAfterChange() {},
    },
  };
}

function makeMockDom() {
  const makeNode = tag => {
    const classes = new Set();
    const attrs = new Map();
    const listeners = new Map();
    const el = {
      tagName: String(tag).toUpperCase(),
      className: '',
      textContent: '',
      value: '',
      type: '',
      checked: false,
      hidden: false,
      dataset: {},
      style: {
        setProperty(k, v) { this[k] = v; },
      },
      children: [],
      offsetLeft: 8,
      offsetTop: 3,
      offsetWidth: 68,
      offsetHeight: 21,
      classList: {
        add: (...cs) => cs.forEach(c => c && classes.add(c)),
        remove: (...cs) => cs.forEach(c => classes.delete(c)),
        toggle: (c, force) => {
          const add = force === undefined ? !classes.has(c) : Boolean(force);
          if (add) classes.add(c);
          else classes.delete(c);
          return add;
        },
        contains: c => classes.has(c),
      },
      setAttribute(k, v) {
        attrs.set(k, String(v));
        if (k.startsWith('data-')) {
          const camel = k.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
          this.dataset[camel] = String(v);
        }
      },
      getAttribute(k) {
        if (attrs.has(k)) return attrs.get(k);
        if (k.startsWith('data-')) {
          const camel = k.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
          if (camel in this.dataset) return String(this.dataset[camel]);
        }
        return null;
      },
      addEventListener: (ev, fn) => listeners.set(ev, fn),
      append(...items) {
        for (const item of items) {
          if (!item) continue;
          if (typeof item === 'string') {
            const t = makeNode('#text');
            t.textContent = item;
            this.children.push(t);
          } else {
            item.parentElement = this;
            this.children.push(item);
          }
        }
      },
      replaceChildren(...items) {
        this.children = [];
        for (const item of items) {
          if (!item) continue;
          if (item.tagName === 'FRAGMENT') {
            for (const c of item.children) {
              c.parentElement = this;
              this.children.push(c);
            }
          } else {
            item.parentElement = this;
            this.children.push(item);
          }
        }
      },
      remove() {
        if (!this.parentElement) return;
        this.parentElement.children = this.parentElement.children.filter(c => c !== this);
        this.parentElement = null;
      },
      close() {
        const fn = listeners.get('close');
        if (fn) fn();
      },
      showModal() {
        this.open = true;
      },
      closest(sel) {
        let cur = this;
        while (cur) {
          if (matchesSimple(cur, sel)) return cur;
          cur = cur.parentElement ?? null;
        }
        return null;
      },
      findAll(pred) {
        const res = [];
        if (pred(this)) res.push(this);
        for (const c of this.children) {
          if (c?.findAll) res.push(...c.findAll(pred));
        }
        return res;
      },
      querySelectorAll(selector) {
        const parts = selector.split(',').map(s => s.trim()).filter(Boolean);
        return this.findAll(node => node !== this && parts.some(part => matchesChain(node, part)));
      },
      querySelector(selector) {
        return this.querySelectorAll(selector)[0] ?? null;
      },
    };
    return new Proxy(el, {
      set(target, prop, value) {
        if (prop === 'className' && typeof value === 'string') {
          value.split(/\s+/).filter(Boolean).forEach(c => target.classList.add(c));
        }
        target[prop] = value;
        return true;
      },
    });
  };

  function matchesSimple(node, sel) {
    if (!node || !node.tagName || node.tagName === '#TEXT' || node.tagName === 'FRAGMENT') return false;
    let rest = sel.trim();
    const attrMatches = [...rest.matchAll(/\[([^\]=*~^$|]+)(?:(\*=|=)"([^"]*)")?\s*i?\]/g)];
    rest = rest.replace(/\[[^\]]+\]/g, '');
    const classMatches = [...rest.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map(m => m[1]);
    const tagPart = rest.replace(/\.[a-zA-Z0-9_-]+/g, '').trim();
    if (tagPart && node.tagName !== tagPart.toUpperCase()) return false;
    for (const cls of classMatches) {
      if (!node.classList?.contains?.(cls)) return false;
    }
    for (const m of attrMatches) {
      const [, attrName, op, expected] = m;
      const actual = node.getAttribute?.(attrName);
      if (actual == null) return false;
      if (op === '=' && actual !== expected) return false;
      if (op === '*=' && !actual.toLowerCase().includes(expected.toLowerCase())) return false;
    }
    return true;
  }

  function matchesChain(node, chain) {
    const tokens = chain.trim().split(/\s+/);
    if (!matchesSimple(node, tokens.at(-1))) return false;
    let cur = node.parentElement;
    for (let i = tokens.length - 2; i >= 0; i--) {
      while (cur && !matchesSimple(cur, tokens[i])) cur = cur.parentElement;
      if (!cur) return false;
      cur = cur.parentElement;
    }
    return true;
  }

  const head = makeNode('head');
  const body = makeNode('body');
  const doc = {
    head,
    body,
    createElement: tag => makeNode(tag),
    createDocumentFragment: () => makeNode('fragment'),
    querySelectorAll: sel => body.querySelectorAll(sel),
    querySelector: sel => body.querySelector(sel),
    addEventListener() {},
  };
  return { doc, makeNode };
}

test('Example 1 & 2: LoadImage and VF Load Video auto-split into Ports, Widgets, Preview and default to Preview', () => {
  const loadImage = {
    id: 1,
    type: 'LoadImage',
    title: 'Load Image',
    pos: [100, 100],
    size: [260, 340],
    outputs: [{ name: 'IMAGE', type: 'IMAGE' }, { name: 'MASK', type: 'MASK' }],
    widgets: [
      { name: 'image', type: 'combo', value: 'portrait.png' },
      { name: 'upload', type: 'button' },
    ],
    imgs: [{}],
  };

  const autoSimple = createAutoNodeTabs(loadImage);
  assert.deepEqual(autoSimple.tabs.map(t => t.label), ['Ports', 'Widgets', 'Preview']);
  assert.equal(autoSimple.activeTab, 2, 'defaults to Preview tab when present');
  assert.equal(autoSimple.sizing, 'max');

  // Complex VF Load Video node with ports, 7 parameter widgets, and custom crop/video preview widget
  const vfLoadVideo = {
    id: 2,
    type: 'VF_LoadVideo',
    title: 'VF Load Video',
    pos: [420, 100],
    size: [340, 660],
    inputs: [{ name: 'meta_batch', type: 'VHS_BatchManager' }, { name: 'vae', type: 'VAE' }],
    outputs: [
      { name: 'IMAGE', type: 'IMAGE' },
      { name: 'frame_count', type: 'INT' },
      { name: 'audio', type: 'AUDIO' },
      { name: 'video_info', type: 'VHS_VIDEOINFO' },
      { name: 'LATENT', type: 'LATENT' },
    ],
    widgets: [
      { name: 'video', type: 'combo' },
      { name: 'force_rate', type: 'number' },
      { name: 'custom_width', type: 'number' },
      { name: 'custom_height', type: 'number' },
      { name: 'frame_load_cap', type: 'number' },
      { name: 'skip_first_frames', type: 'number' },
      { name: 'select_every_nth', type: 'number' },
      { name: 'crop_preview', type: 'custom', computeSize: () => [320, 290] },
    ],
  };

  const sections = classifyNodeSections(vfLoadVideo);
  assert.equal(sections.hasPorts, true);
  assert.equal(sections.standardWidgets.length, 7);
  assert.deepEqual(sections.previewWidgets, ['crop_preview']);
  assert.equal(sections.hasPreview, true);

  const graph = createTestGraph([loadImage, vfLoadVideo]);
  const app = createTestApp(graph);
  const controller = new LayoutController(app);

  controller.enableNodeTabs(2);
  const cfg = controller.nodeTabs['2'];
  assert.ok(cfg);
  assert.equal(cfg.originalHeight, 660);
  assert.equal(cfg.tabs[cfg.activeTab].label, 'Preview');
  const maxTabbedHeight = vfLoadVideo.size[1];
  assert.ok(maxTabbedHeight < 500, `expected tabbed Max-of-Tabs height (${maxTabbedHeight}) to be significantly shorter than 660`);

  // Switching tabs in 'max' mode keeps node height stationary so bottom bar never jumps
  controller.edit(() => selectNodeBottomTab(controller.ensureData(), 2, 0)); // Ports
  assert.equal(vfLoadVideo.size[1], maxTabbedHeight, 'Max-of-Tabs keeps height stationary across tabs');

  // Switching to 'compact' shrinks Ports tab to just its 5 output / 2 input slots
  controller.edit(() => setNodeTabsSizing(controller.ensureData(), 2, 'compact'));
  assert.ok(vfLoadVideo.size[1] < maxTabbedHeight, `Compact Fit shrinks Ports tab (${vfLoadVideo.size[1]} < ${maxTabbedHeight})`);

  // Drag-tab-onto-tab merges Ports (0) into Widgets (1) -> "Widgets + Ports"
  controller.edit(() => mergeNodeBottomTabs(controller.ensureData(), 2, 0, 1));
  assert.equal(cfg.tabs.length, 2);
  assert.equal(cfg.tabs[0].label, 'Widgets + Ports');
  assert.equal(cfg.tabs[0].includePorts, true);
  assert.equal(cfg.tabs[0].widgets.length, 7);

  // Add custom tab, assign a widget to it, rename, reorder, and close custom tab
  controller.edit(() => {
    addCustomNodeBottomTab(controller.ensureData(), 2, 'Trimming');
    assignWidgetToNodeTab(controller.ensureData(), 2, 'frame_load_cap', 2);
    assignWidgetToNodeTab(controller.ensureData(), 2, 'skip_first_frames', 2);
    renameNodeBottomTab(controller.ensureData(), 2, 2, 'Trim Controls');
    reorderNodeBottomTab(controller.ensureData(), 2, 2, 1);
  });
  assert.equal(cfg.tabs[1].label, 'Trim Controls');
  assert.deepEqual(cfg.tabs[1].widgets, ['frame_load_cap', 'skip_first_frames']);
  assert.equal(cfg.tabs[0].widgets.includes('frame_load_cap'), false);

  controller.edit(() => removeSingleNodeBottomTab(controller.ensureData(), 2, 1));
  assert.equal(cfg.tabs.length, 2);
  assert.equal(cfg.tabs[0].widgets.includes('frame_load_cap'), true, 'closing tab returns orphaned widgets to fallback tab');

  // Runtime dynamic widget sync assigns newly added widget automatically
  vfLoadVideo.widgets.push({ name: 'audio_gain', type: 'number' });
  syncNodeTabConfig(cfg, vfLoadVideo);
  assert.equal(cfg.tabs[0].widgets.includes('audio_gain'), true);

  // Removing bottom tabs restores original pre-tabbed height
  controller.removeNodeTabs(2);
  assert.equal(controller.nodeTabs['2'], undefined);
  assert.equal(vfLoadVideo.size[1], 660);
});

test('Example 3: Single ComfyUI Group converts member nodes into bottom tabs and restores LGraphGroup on unpack', () => {
  const n1 = { id: 10, title: 'CLIP Positive', pos: [120, 160], size: [260, 140], mode: 0 };
  const n2 = { id: 11, title: 'CLIP Negative', pos: [120, 350], size: [260, 120], mode: 0 };
  const n3 = { id: 12, title: 'Empty Latent', pos: [120, 520], size: [240, 100], mode: 0 };
  const group = {
    title: 'Prompt Conditioning',
    color: '#2b5b84',
    font_size: 24,
    _bounding: [100, 100, 300, 560],
  };

  const graph = createTestGraph([n1, n2, n3], [group]);
  const controller = new LayoutController(createTestApp(graph));

  const stack = controller.tabifySingleGroup(group);
  assert.ok(stack);
  assert.equal(graph._groups.length, 0, 'consumed native ComfyUI Group is removed while stacked');
  assert.equal(stack.tabs.length, 3);
  assert.deepEqual(stack.tabs.map(t => t.label), ['CLIP Positive', 'CLIP Negative', 'Empty Latent']);
  assert.ok(stack.tabs.every(t => t.kind === 'node' && t.color === '#2b5b84'));

  // Visual organization only: inactive nodes are NEVER bypassed
  assert.equal(n1.mode, 0);
  assert.equal(n2.mode, 0);
  assert.equal(n3.mode, 0);

  // Moving the active node drags the whole stack with it
  const before = controller.snapshot();
  n1.pos = [300, 250];
  controller.finishNativeDrag(before, [350, 280]);
  assert.deepEqual(stack.pos, [300, 220]);

  // Unpacking restores all nodes and recreates the native ComfyUI Group
  controller.unpackBottomStack(stack.id);
  assert.equal(controller.tabStacks.length, 0);
  assert.equal(graph._groups.length, 1);
  assert.equal(graph._groups[0].title, 'Prompt Conditioning');
  assert.equal(graph._groups[0].color, '#2b5b84');
});

test('Example 4: Multi-Group + standalone node stack preserves relative group offsets, toggles vertical stack, and handles nested 2-row footers', () => {
  const g1n1 = { id: 21, title: 'KSampler Base', pos: [120, 160], size: [240, 180], mode: 0 };
  const g1n2 = { id: 22, title: 'VAE Decode', pos: [390, 200], size: [180, 100], mode: 0 };
  const grp1 = { title: 'Base Pass', color: '#3f789e', _bounding: [100, 100, 500, 320] };

  const g2n1 = { id: 31, title: 'Upscale Latent', pos: [120, 520], size: [220, 110], mode: 0 };
  const g2n2 = { id: 32, title: 'KSampler HiRes', pos: [370, 520], size: [240, 190], mode: 0 };
  const grp2 = { title: 'HiRes Fix', color: '#6b4c9a', _bounding: [100, 460, 530, 310] };

  const saveNode = {
    id: 40,
    type: 'SaveImage',
    title: 'Save Output',
    pos: [700, 200],
    size: [280, 310],
    inputs: [{ name: 'images', type: 'IMAGE' }],
    widgets: [{ name: 'filename_prefix', type: 'string' }],
    imgs: [{}],
  };

  const graph = createTestGraph([g1n1, g1n2, g2n1, g2n2, saveNode], [grp1, grp2]);
  const controller = new LayoutController(createTestApp(graph));

  // Also enable intra-node bottom tabs on Save Output to verify 2-row nested footer!
  controller.enableNodeTabs(40);

  const stack = controller.combineIntoBottomStack({ groups: [grp1, grp2], nodes: [saveNode] });
  assert.equal(graph._groups.length, 0);
  assert.equal(stack.tabs.length, 3);
  assert.equal(stack.tabs[0].kind, 'group');
  assert.equal(stack.tabs[0].layoutMode, 'relative');
  assert.equal(stack.tabs[1].kind, 'group');
  assert.equal(stack.tabs[2].kind, 'node');

  // Relative positions inside Base Pass are preserved (g1n2 remains to the right of g1n1)
  assert.ok(g1n2.pos[0] > g1n1.pos[0] + 200, 'relative side-by-side node layout preserved inside Group tab');

  // Toggle Base Pass to vertical stack mode -> nodes align to same X column
  controller.edit(() => toggleGroupTabLayoutMode(controller.ensureData(), stack.id, 0));
  assert.equal(g1n1.pos[0], g1n2.pos[0], 'vertical stack mode aligns group nodes into single column');
  assert.ok(g1n2.pos[1] > g1n1.pos[1] + g1n1.size[1]);

  // Switch to Save Output tab (index 2) which also has intra-node section tabs -> 2-row nested footer!
  controller.edit(() => { stack.activeTab = 2; });
  const [sl] = controller.stackGeometry();
  assert.ok(sl.innerNodeTabBar, 'emits innerNodeTabBar for node with intra-node tabs inside a stack');
  assert.equal(sl.tabBarRect[1], sl.innerNodeTabBar.rect[1] + BOTTOM_TAB_BAR_HEIGHT, 'outer stack bar docks cleanly below inner node bar');

  // Reorder and detach HiRes Fix group tab onto canvas -> restores only HiRes Fix as native LGraphGroup
  controller.edit(() => {
    reorderStackTab(controller.ensureData(), stack.id, 1, 0);
    setStackSizing(controller.ensureData(), stack.id, 'compact');
  });
  assert.equal(stack.tabs[0].label, 'HiRes Fix');

  controller.edit(() => detachStackTab(controller.ensureData(), graph, stack.id, 0, [800, 120], 30));
  assert.equal(stack.tabs.length, 2);
  assert.equal(graph._groups.length, 1);
  assert.equal(graph._groups[0].title, 'HiRes Fix');

  // Dropping an external node onto the stack's bottom bar appends it as a tab
  const extraNode = { id: 55, title: 'Preview Bridge', pos: [900, 500], size: [220, 120], mode: 0 };
  graph._nodes.push(extraNode);
  const origGet = graph.getNodeById.bind(graph);
  graph.getNodeById = id => (String(id) === '55' ? extraNode : origGet(id));

  const snapBefore = controller.snapshot();
  extraNode.pos = [stack.pos[0] + 20, stack.pos[1] + stack.size[1]];
  controller.finishNativeDrag(snapBefore, [stack.pos[0] + 40, stack.pos[1] + stack.size[1] + 10], {
    bottomBarHit: { stackId: stack.id, insertIndex: 2 },
  });
  assert.equal(stack.tabs.length, 3);
  assert.equal(stack.tabs[2].label, 'Preview Bridge');

  // Validate bottom-tabs serialization sanitizes cleanly
  validateBottomTabsData(controller.ensureData(), graph);
  assert.equal(controller.tabStacks.length, 1);
});

test('Grid Frame cell reserves BOTTOM_TAB_BAR_HEIGHT below bottom-tabbed nodes (including frame.fill)', () => {
  const nTop = {
    id: 1,
    type: 'LoadImage',
    title: 'Load Image',
    pos: [0, 0],
    size: [240, 300],
    outputs: [{ name: 'IMAGE', type: 'IMAGE' }],
    widgets: [{ name: 'image', type: 'combo' }],
    imgs: [{}],
  };
  const nBottom = {
    id: 2,
    type: 'KSampler',
    title: 'KSampler',
    pos: [0, 400],
    size: [240, 150],
  };

  const graph = createTestGraph([nTop, nBottom]);
  const controller = new LayoutController(createTestApp(graph));
  controller.enableNodeTabs(1);
  const frame = controller.createFromNodes([1, 2], 'stack');
  frame.fill = true;
  controller.reflow();

  const topBottomBarFloor = nTop.pos[1] + nTop.size[1] + BOTTOM_TAB_BAR_HEIGHT;
  const secondNodeHeaderTop = nBottom.pos[1] - controller.adapter.classicTitle;
  assert.ok(
    secondNodeHeaderTop >= topBottomBarFloor,
    `expected KSampler top (${secondNodeHeaderTop}) >= LoadImage bottom bar floor (${topBottomBarFloor})`
  );

  // Also test when the bottom-most node in a filled cell has bottom tabs
  controller.removeNodeTabs(1);
  controller.enableNodeTabs(2);
  const sibling = { id: 3, title: 'Tall Column', pos: [400, 0], size: [240, 520] };
  graph._nodes.push(sibling);
  const origGet = graph.getNodeById.bind(graph);
  graph.getNodeById = id => (String(id) === '3' ? sibling : origGet(id));
  const [firstLeaf] = engine.leaves(frame.root);
  controller.edit(() => {
    engine.splitCell(frame, firstLeaf.id, 'x', controller.metrics());
    const [, rightLeaf] = engine.leaves(frame.root);
    rightLeaf.nodes = [3];
    frame.fill = true;
  });
  const [layout] = controller.geometry();
  const leftCellRect = layout.cells[0].rect;
  const cellFloor = leftCellRect[1] + leftCellRect[3] - engine.PAD;
  assert.equal(
    nBottom.pos[1] + nBottom.size[1] + BOTTOM_TAB_BAR_HEIGHT,
    cellFloor,
    'filled bottom-tabbed node stops exactly BOTTOM_TAB_BAR_HEIGHT above cell floor'
  );
});

test('Classic drawNode filtering, Vue Nodes 2.0 DOM section hiding, wire routing, Configure modal, and live wire-drag Ports auto-peek', () => {
  const { doc } = makeMockDom();
  const prevDoc = globalThis.document;
  const prevWindow = globalThis.window;
  const prevComputed = globalThis.getComputedStyle;
  const prevRAF = globalThis.requestAnimationFrame;
  const prevCAF = globalThis.cancelAnimationFrame;
  const prevLG = globalThis.LiteGraph;

  try {
    globalThis.document = doc;
    globalThis.window = { addEventListener() {} };
    globalThis.getComputedStyle = () => ({ position: 'relative' });
    globalThis.requestAnimationFrame = () => 1;
    globalThis.cancelAnimationFrame = () => {};
    globalThis.LiteGraph = { vueNodesMode: false };

    const container = doc.createElement('div');
    doc.body.append(container);

    const node1 = {
      id: 1,
      type: 'LoadImage',
      title: 'Load Image',
      pos: [100, 120],
      size: [260, 300],
      inputs: [],
      outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [99] }],
      widgets: [
        { name: 'image', type: 'combo' },
        { name: 'crop_preview', type: 'custom', computeSize: () => [240, 200] },
      ],
      imgs: [{ src: 'test.png' }],
    };
    const node2 = {
      id: 2,
      type: 'PreviewImage',
      title: 'Preview',
      pos: [480, 120],
      size: [240, 220],
      inputs: [{ name: 'images', type: 'IMAGE', link: 99 }],
      outputs: [],
      widgets: [],
    };
    const link99 = { id: 99, origin_id: 1, target_id: 2, type: 'IMAGE' };

    const graph = createTestGraph([node1, node2], [], [link99]);
    const app = createTestApp(graph);
    app.canvas.canvas.parentElement = container;

    let observedDuringDraw = null;
    app.canvas.drawNode = n => {
      observedDuringDraw = {
        outputsLen: n.outputs.length,
        widgetNames: n.widgets.map(w => w.name),
        hasImgs: Boolean(n.imgs),
      };
    };

    const controller = new LayoutController(app);
    const overlay = new LayoutOverlay(controller);

    controller.enableNodeTabs(1); // Active tab defaults to Preview (idx 2 -> Ports hidden!)
    overlay.render(controller.geometry(), controller.stackGeometry());
    overlay.refreshHidden();

    // 1. Bottom bar rendered in overlay plane with 3 pills + port dot on inactive Ports pill
    const bars = overlay.plane.querySelectorAll('.clt-bottom-tab-bar');
    assert.equal(bars.length, 1);
    const pills = bars[0].querySelectorAll('.clt-bottom-tab');
    assert.equal(pills.length, 3);
    assert.equal(pills[0].querySelectorAll('.clt-bottom-port-dot').length, 1, 'inactive Ports tab displays glowing connection dot');

    // 2. Classic drawNode filters hidden ports & non-active widgets without mutating graph state
    app.canvas.drawNode(node1, {});
    assert.deepEqual(observedDuringDraw, {
      outputsLen: 0,
      widgetNames: ['crop_preview'],
      hasImgs: true,
    });
    assert.equal(node1.outputs.length, 1, 'node.outputs restored intact after drawNode');
    assert.equal(node1.widgets.length, 2, 'node.widgets restored intact after drawNode');
    assert.equal(node1.widgets[0].last_y, -99999, 'hidden classic widget moved offscreen for hit-testing');

    // Even if drawFn throws, node arrays are restored
    assert.throws(() => {
      drawClassicNodeWithBottomTabs(node1, controller.nodeTabs['1'], 1, () => {
        throw new Error('boom');
      });
    }, /boom/);
    assert.equal(node1.outputs.length, 1);
    assert.equal(node1.widgets.length, 2);

    // 3. Wire routing routes node1's hidden output port to its Ports bottom tab pill
    const routed = routeMinimizedEndpoints(overlay.hidden, graph, link99, [360, 140], [480, 140]);
    assert.ok(routed);
    assert.notDeepEqual(routed[0], [360, 140], 'origin wire endpoint reroutes to Ports bottom tab pill');
    assert.deepEqual(routed[1], [480, 140], 'visible target endpoint stays on target slot');

    // 4. Live wire-drag auto-peek reveals Ports tab when dragging a wire over node1!
    app.canvas.connecting_links = [{ node: node2 }];
    const peekChanged = updateWirePeekState(controller, app.canvas, [180, 200]);
    assert.equal(peekChanged, true);
    assert.equal(effectiveNodeTabIndex(controller, 1, controller.nodeTabs['1']), 0, 'effective tab auto-peeks to Ports (index 0)');
    overlay.refreshHidden();
    assert.equal(overlay.hidden.portTargets.has('1'), false, 'ports are live and un-rerouted during wire-drag auto-peek');

    // Clearing wire drag restores Preview tab
    app.canvas.connecting_links = [];
    updateWirePeekState(controller, app.canvas, [180, 200]);
    assert.equal(effectiveNodeTabIndex(controller, 1, controller.nodeTabs['1']), 2);

    // 5. Nodes 2.0 (Vue DOM) section toggling
    globalThis.LiteGraph.vueNodesMode = true;
    const vueCard = doc.createElement('div');
    vueCard.className = 'lg-node';
    vueCard.setAttribute('data-node-id', '1');
    const slotWrap = doc.createElement('div');
    slotWrap.className = 'lg-node-slots';
    const w1Wrap = doc.createElement('div');
    w1Wrap.className = 'lg-node-widget';
    w1Wrap.setAttribute('data-widget-name', 'image');
    const w2Wrap = doc.createElement('div');
    w2Wrap.className = 'lg-node-widget';
    w2Wrap.setAttribute('data-widget-name', 'crop_preview');
    vueCard.append(slotWrap, w1Wrap, w2Wrap);
    doc.body.append(vueCard);

    syncVueNodeSectionTabs(doc, controller, new Set());
    assert.equal(vueCard.classList.contains('clt-has-bottom-tabs'), true);
    assert.equal(slotWrap.classList.contains('clt-section-hidden'), true, 'slots hidden on Preview tab in Vue mode');
    assert.equal(w1Wrap.classList.contains('clt-section-hidden'), true, 'combo widget hidden on Preview tab in Vue mode');
    assert.equal(w2Wrap.classList.contains('clt-section-hidden'), false, 'crop_preview visible on Preview tab in Vue mode');

    // 6. Configure Bottom Tabs modal opens and builds controls cleanly
    const dialog = openConfigureBottomTabsDialog(overlay, { nodeId: 1 }, doc);
    assert.ok(dialog);
    assert.equal(dialog.open, true);
    dialog.close();

    overlay.dispose();
    assert.equal(vueCard.classList.contains('clt-has-bottom-tabs'), false, 'dispose cleans up Vue bottom-tab classes');
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWindow;
    globalThis.getComputedStyle = prevComputed;
    globalThis.requestAnimationFrame = prevRAF;
    globalThis.cancelAnimationFrame = prevCAF;
    globalThis.LiteGraph = prevLG;
  }
});

test('LayoutOverlay bottom-tab pointer interactions: click switch, drag-to-merge, bottom-bar move, and stack wire routing', () => {
  const { doc } = makeMockDom();
  const prevDoc = globalThis.document;
  const prevWindow = globalThis.window;
  const prevComputed = globalThis.getComputedStyle;
  const prevRAF = globalThis.requestAnimationFrame;
  const prevCAF = globalThis.cancelAnimationFrame;

  try {
    globalThis.document = doc;
    globalThis.window = { addEventListener() {} };
    globalThis.getComputedStyle = () => ({ position: 'relative' });
    globalThis.requestAnimationFrame = () => 1;
    globalThis.cancelAnimationFrame = () => {};

    const container = doc.createElement('div');
    doc.body.append(container);

    const nA = {
      id: 10,
      type: 'LoadImage',
      title: 'Image A',
      pos: [100, 130],
      size: [260, 280],
      outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [501] }],
      widgets: [{ name: 'image', type: 'combo' }],
      imgs: [{}],
    };
    const nB = {
      id: 11,
      type: 'KSampler',
      title: 'Sampler B',
      pos: [100, 460],
      size: [260, 180],
      inputs: [{ name: 'latent', type: 'LATENT' }],
      outputs: [{ name: 'LATENT', type: 'LATENT', links: [502] }],
      widgets: [{ name: 'steps', type: 'number' }],
    };
    const nExt = {
      id: 12,
      type: 'SaveImage',
      title: 'Save',
      pos: [520, 200],
      size: [240, 200],
      inputs: [{ name: 'images', type: 'IMAGE', link: 502 }],
      outputs: [],
      widgets: [],
    };
    const link501 = { id: 501, origin_id: 10, target_id: 11, type: 'IMAGE' };
    const link502 = { id: 502, origin_id: 11, target_id: 12, type: 'LATENT' };

    const graph = createTestGraph([nA, nB, nExt], [], [link501, link502]);
    const app = createTestApp(graph);
    app.canvas.canvas.parentElement = container;

    const controller = new LayoutController(app);
    const overlay = new LayoutOverlay(controller);

    // 1. Click & drag-to-merge on intra-node bottom tabs
    controller.enableNodeTabs(10);
    overlay.render(controller.geometry(), controller.stackGeometry());

    let bar = overlay.plane.querySelector('.clt-bottom-tab-bar');
    let pills = bar.querySelectorAll('.clt-bottom-tab');
    assert.equal(pills.length, 3);
    const barY = parseFloat(bar.style.top) + 12;

    // Click pill 0 (Ports) and drag onto center merge zone of pill 1 (Widgets: x ~ 82..154 -> center ~ 118 + barLeft 100 = 218)
    pills[0].onpointerdown({
      button: 0,
      pointerId: 1,
      clientX: 120,
      clientY: barY,
      target: pills[0],
      preventDefault() {},
      stopPropagation() {},
    });
    assert.equal(controller.nodeTabs['10'].activeTab, 0, 'pointerdown immediately switches active bottom tab');

    overlay.move({
      pointerId: 1,
      clientX: 218,
      clientY: barY,
      preventDefault() {},
      stopPropagation() {},
    });
    assert.equal(overlay.bottomTabPreview?.mode, 'merge-node');
    assert.equal(overlay.bottomTabPreview?.targetIndex, 1);

    overlay.up({ pointerId: 1, clientX: 218, clientY: barY });
    assert.equal(controller.nodeTabs['10'].tabs.length, 2, 'Ports merged into Widgets');
    assert.equal(controller.nodeTabs['10'].tabs[0].label, 'Widgets + Ports');

    // 2. Stack wire routing & dragging stack bottom bar to move stack
    controller.removeNodeTabs(10);
    const stack = controller.combineIntoBottomStack({ nodes: [nA, nB] });
    overlay.render(controller.geometry(), controller.stackGeometry());
    overlay.refreshHidden();

    assert.equal(overlay.hidden.ids.has('11'), true, 'inactive stack tab node nB is hidden');
    const routedExternal = routeMinimizedEndpoints(overlay.hidden, graph, link502, [360, 480], [520, 220]);
    assert.ok(routedExternal);
    assert.notDeepEqual(routedExternal[0], [360, 480], 'external wire from hidden stack tab node routes to its bottom tab pill');

    // Dragging stack bottom bar background moves the stack and its active node
    const stackBar = overlay.plane.querySelector(`.clt-bottom-tab-bar[data-stack-id="${stack.id}"]`);
    const origStackPos = [...stack.pos];
    stackBar.onpointerdown({
      button: 0,
      pointerId: 2,
      clientX: origStackPos[0] + 200,
      clientY: parseFloat(stackBar.style.top) + 14,
      target: stackBar,
      preventDefault() {},
      stopPropagation() {},
    });
    overlay.move({
      pointerId: 2,
      clientX: origStackPos[0] + 260,
      clientY: parseFloat(stackBar.style.top) + 54,
      preventDefault() {},
      stopPropagation() {},
    });
    overlay.up({ pointerId: 2, clientX: origStackPos[0] + 260, clientY: parseFloat(stackBar.style.top) + 54 });
    assert.deepEqual(stack.pos, [origStackPos[0] + 60, origStackPos[1] + 40]);

    overlay.dispose();
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWindow;
    globalThis.getComputedStyle = prevComputed;
    globalThis.requestAnimationFrame = prevRAF;
    globalThis.cancelAnimationFrame = prevCAF;
  }
});

