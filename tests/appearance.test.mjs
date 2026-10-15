import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../web/core/layout.js';
import { applyHeaderStyle, applyHeaderConfig, LayoutOverlay, LOGO_PURPLE, syncSelectionMenuDom } from '../web/core/overlay.js';


test('validateFrame validates container appearance properties on frames', () => {
  const frame = engine.createFrame([0, 0]);
  frame.containerColor = '#182024';
  frame.containerOpacity = 0.75;
  frame.containerPattern = 'dots';
  frame.containerImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  frame.containerImageMode = 'cover';

  const validated = engine.validateFrame(frame);
  assert.equal(validated.containerColor, '#182024');
  assert.equal(validated.containerOpacity, 0.75);
  assert.equal(validated.containerPattern, 'dots');
  assert.equal(validated.containerImage, frame.containerImage);
  assert.equal(validated.containerImageMode, 'cover');

  // Bad values are sanitized or dropped
  const bad = engine.createFrame([0, 0]);
  bad.containerColor = 'invalid-color';
  bad.containerOpacity = 'not-a-number';
  bad.containerPattern = 'nonexistent-pattern';
  bad.containerImage = 12345;
  bad.containerImageMode = 'unknown-mode';

  const sanitized = engine.validateFrame(bad);
  assert.equal('containerColor' in sanitized, false);
  assert.equal('containerOpacity' in sanitized, false);
  assert.equal('containerPattern' in sanitized, false);
  assert.equal('containerImage' in sanitized, false);
  assert.equal('containerImageMode' in sanitized, false);
});

test('container appearance is frame-level only and never attaches to cells', () => {
  const frame = engine.createFrame([0, 0]);
  frame.root.containerColor = '#182024';
  frame.root.containerOpacity = 0.5;
  frame.root.containerPattern = 'grid';

  const validated = engine.validateFrame(frame);
  assert.equal('containerColor' in validated.root, false);
  assert.equal('containerOpacity' in validated.root, false);
  assert.equal('containerPattern' in validated.root, false);
});

test('container appearance survives export and template import', () => {
  const frame = engine.createFrame([10, 20]);
  frame.containerColor = '#223344';
  frame.containerOpacity = 0.6;
  frame.containerPattern = 'hexagons';
  frame.containerImageMode = 'repeat';

  const template = engine.exportTemplate(frame);
  assert.equal(template.frame.containerColor, '#223344');
  assert.equal(template.frame.containerOpacity, 0.6);
  assert.equal(template.frame.containerPattern, 'hexagons');
  assert.equal(template.frame.containerImageMode, 'repeat');

  const restored = engine.importTemplate(template, [100, 200]);
  assert.equal(restored.containerColor, '#223344');
  assert.equal(restored.containerOpacity, 0.6);
  assert.equal(restored.containerPattern, 'hexagons');
  assert.equal(restored.containerImageMode, 'repeat');
});

test('appearance normalization helpers sanitize inputs correctly', () => {
  // normalizePattern
  assert.equal(engine.normalizePattern('DOTS'), 'dots');
  assert.equal(engine.normalizePattern('grid'), 'grid');
  assert.equal(engine.normalizePattern('none'), undefined);
  assert.equal(engine.normalizePattern('unknown'), undefined);
  assert.equal(engine.normalizePattern(123), undefined);

  // normalizeOpacity
  assert.equal(engine.normalizeOpacity(0.5), 0.5);
  assert.equal(engine.normalizeOpacity('0.75'), 0.75);
  assert.equal(engine.normalizeOpacity(1.5), 1);
  assert.equal(engine.normalizeOpacity(-0.5), 0);
  assert.equal(engine.normalizeOpacity(0.3333), 0.33);
  assert.equal(engine.normalizeOpacity('invalid'), undefined);

  // normalizeImage
  assert.equal(engine.normalizeImage('  data:image/png;base64,abc  '), 'data:image/png;base64,abc');
  assert.equal(engine.normalizeImage('https://example.com/test.png'), undefined, 'remote images are not fetched');
  assert.equal(engine.normalizeImage('ftp://example.com/test.png'), undefined);
  assert.equal(engine.normalizeImage('not-an-image'), undefined);

  // normalizeImageMode
  assert.equal(engine.normalizeImageMode('REPEAT'), 'repeat');
  assert.equal(engine.normalizeImageMode('cover'), 'cover');
  assert.equal(engine.normalizeImageMode('contain'), undefined);

  // normalizeContainerMode
  assert.equal(engine.normalizeContainerMode('COLOR'), 'color');
  assert.equal(engine.normalizeContainerMode('image'), 'image');
  assert.equal(engine.normalizeContainerMode('pattern'), undefined);
  assert.equal(engine.normalizeContainerMode(123), undefined);
});

test('containerMode validates and round-trips correctly', () => {
  const frame = engine.createFrame([0, 0]);
  frame.containerMode = 'image';
  const validated = engine.validateFrame(frame);
  assert.equal(validated.containerMode, 'image');

  const template = engine.exportTemplate(frame);
  assert.equal(template.frame.containerMode, 'image');

  const restored = engine.importTemplate(template, [10, 20]);
  assert.equal(restored.containerMode, 'image');
});

test('a background image at the upload limit survives saving', () => {
  const base64Length = n => Math.ceil(n / 3) * 4;
  const atLimit = `data:image/png;base64,${'A'.repeat(base64Length(engine.MAX_IMAGE_BYTES))}`;
  assert.equal(engine.normalizeImage(atLimit), atLimit, 'a 2 MB file encodes to a value that is kept');
  const tooBig = `data:image/png;base64,${'A'.repeat(base64Length(engine.MAX_IMAGE_BYTES) + 1024)}`;
  assert.equal(engine.normalizeImage(tooBig), undefined);
});

test('headerOpacity validates on frames and leaf cells, transfers on split/grid, and survives template round-trip', () => {
  const frame = engine.createFrame([10, 20]);
  frame.headerOpacity = 0.65;
  frame.root.headerOpacity = 1;
  engine.splitCell(frame, frame.root.id, 'x');
  assert.equal('headerOpacity' in frame.root, false, 'split node does not keep headerOpacity');
  assert.equal(frame.root.children[0].headerOpacity, 1, 'first leaf receives headerOpacity');
  assert.equal('headerOpacity' in frame.root.children[1], false);

  frame.root.children[1].headerOpacity = 'invalid';
  const validated = engine.validateFrame(frame);
  assert.equal(validated.headerOpacity, 0.65);
  assert.equal(validated.root.children[0].headerOpacity, 1);
  assert.equal('headerOpacity' in validated.root.children[1], false);

  const template = engine.exportTemplate(validated);
  const restored = engine.importTemplate(template, [0, 0]);
  assert.equal(restored.headerOpacity, 0.65);
  assert.equal(restored.root.children[0].headerOpacity, 1);
});

test('validateFrame keeps frame autohide true, drops invalid or cell values, and strips autohide from exported templates', () => {
  const frame = engine.createFrame([0, 0]);
  frame.autohide = true;
  frame.root.autohide = true;
  const validated = engine.validateFrame(frame);
  assert.equal(validated.autohide, true);
  assert.equal('autohide' in validated.root, false);

  for (const bad of [false, 'yes', 1, null, undefined]) {
    const f = engine.createFrame([0, 0]);
    f.autohide = bad;
    assert.equal('autohide' in engine.validateFrame(f), false);
  }

  const template = engine.exportTemplate(frame);
  assert.equal('autohide' in template.frame, false, 'empty template does not ship autohide');
});

test('applyHeaderStyle and applyHeaderConfig handle headerOpacity for default and custom colors, cell overrides, and reset', () => {
  const makeEl = () => {
    const classes = new Set();
    return {
      style: {},
      classList: {
        add: c => classes.add(c),
        remove: c => classes.delete(c),
        toggle: (c, force) => force ? classes.add(c) : classes.delete(c),
        contains: c => classes.has(c),
      },
    };
  };

  // Default color with custom opacity < 1 uses #20282c rgba
  const elDefault = makeEl();
  applyHeaderStyle(elDefault, { headerOpacity: 0.4 });
  assert.equal(elDefault.style.background, 'rgba(32, 40, 44, 0.4)');
  assert.equal(elDefault.classList.contains('clt-custom-bg'), false);

  // Custom color with opacity < 1 uses custom color rgba
  const elCustom = makeEl();
  applyHeaderStyle(elCustom, { color: '#ff0000', headerOpacity: 0.5, fontSize: 16 });
  assert.equal(elCustom.style.background, 'rgba(255, 0, 0, 0.5)');
  assert.equal(elCustom.classList.contains('clt-custom-bg'), true);
  assert.equal(elCustom.style.fontSize, '16px');

  // Resetting to default clears inline background
  applyHeaderStyle(elCustom, { headerOpacity: 1 });
  assert.equal(elCustom.style.background, '');
  assert.equal(elCustom.classList.contains('clt-custom-bg'), false);

  // applyHeaderConfig stores headerOpacity (including 1 for cell override) and deletes on reset
  const frameTarget = {};
  applyHeaderConfig(frameTarget, { color: '#112233', headerOpacity: 0.35, fontSize: 14, auto: true });
  assert.equal(frameTarget.headerOpacity, 0.35);

  const cellTarget = {};
  applyHeaderConfig(cellTarget, { cellId: 'c1', headerOpacity: 1, auto: true });
  assert.equal(cellTarget.headerOpacity, 1, 'cell override of 100% opacity is preserved');

  applyHeaderConfig(frameTarget, { resetAppearance: true });
  assert.equal('headerOpacity' in frameTarget, false);
});

test('autohide hides expanded frames even when nested nodes are selected and only reveals for drop zone activity', () => {
  const frame = engine.createFrame([0, 0]);
  engine.gridCell(frame, frame.root.id, 1, 2);
  const [first, second] = engine.leaves(frame.root);
  first.nodes = [10];
  second.nodes = [20];

  const node10 = { id: 10, pos: [20, 80], size: [200, 100], is_selected: true };
  const node99 = { id: 99, pos: [800, 800], size: [200, 100], is_selected: true };
  let selected = [node10, node99];

  const fakeOverlay = Object.create(LayoutOverlay.prototype);
  fakeOverlay.editing = null;
  fakeOverlay.drag = null;
  fakeOverlay.headerPreview = null;
  fakeOverlay.hover = null;
  fakeOverlay.nativeDrag = null;
  fakeOverlay.nativeNode = null;
  fakeOverlay.ghostNodeId = null;
  fakeOverlay.safe = fn => fn();
  fakeOverlay.app = {
    canvas: {
      selected_nodes: { 10: node10, 99: node99 },
      deselect(n) {
        selected = selected.filter(item => item.id !== n.id);
      },
      setDirty() {},
    },
  };
  fakeOverlay.controller = {
    frames: [frame],
    selectedNodes: () => selected,
    edit: fn => fn(),
    graph: {
      getNodeById: id => [node10, node99].find(n => String(n.id) === String(id)) ?? null,
    },
  };

  assert.equal(fakeOverlay.isFrameAutohidden(frame), false, 'not autohidden when autohide is off');

  fakeOverlay.toggleAutohide(frame.id);
  assert.equal(frame.autohide, true);
  assert.equal(fakeOverlay.isFrameAutohidden(frame), true, 'frame is autohidden');

  // Selecting nested node 10 or 20 inside the frame continues to hide the grid container
  selected = [node10, { id: 20 }];
  assert.equal(fakeOverlay.isFrameAutohidden(frame), true, 'frame continues to hide when nested nodes are selected');

  // Merely pressing pointerdown on nested node 10 without moving it keeps the frame hidden
  fakeOverlay.nativeNode = node10;
  fakeOverlay.nativeDrag = {
    before: new Map([[10, { pos: [20, 80], size: [200, 100] }]]),
    pointer: [50, 100],
  };
  assert.equal(fakeOverlay.isFrameAutohidden(frame), true, 'unmoved nested node click keeps frame hidden');
  fakeOverlay.nativeDrag = null;
  fakeOverlay.nativeNode = null;

  // Collapsed or minimized frames are never autohidden
  frame.collapsed = true;
  assert.equal(fakeOverlay.isFrameAutohidden(frame), false, 'collapsed frame is never autohidden');
  delete frame.collapsed;
  frame.minimized = true;
  assert.equal(fakeOverlay.isFrameAutohidden(frame), false, 'minimized frame is never autohidden');
  delete frame.minimized;

  // drawCanvasBackgrounds skips autohidden frames even when a nested node is selected
  frame.containerColor = '#182024';
  let drawn = 0;
  const ctx = {
    save() {},
    translate() {},
    beginPath() {},
    roundRect() {},
    clip() {},
    fillRect() { drawn++; },
    restore() {},
  };
  selected = [node10];
  fakeOverlay.drawCanvasBackgrounds(ctx);
  assert.equal(drawn, 0, 'autohidden frame with selected nested node does not draw canvas background');

  // Entering a cell drop zone reveals the frame and draws its canvas background
  fakeOverlay.hover = first.id;
  fakeOverlay.drawCanvasBackgrounds(ctx);
  assert.equal(drawn, 1, 'frame draws canvas background when a node is in its drop zone');
});

test('render hides autohide toggle when collapsed or minimized and omits container DOM when autohidden', () => {
  const prevDoc = globalThis.document;
  const makeNode = (tag) => {
    const classes = new Set();
    const attrs = new Map();
    const listeners = new Map();
    const node = {
      tagName: tag.toUpperCase(),
      className: '',
      textContent: '',
      hidden: false,
      dataset: {},
      style: {},
      children: [],
      classList: {
        add: (...cs) => cs.forEach(c => classes.add(c)),
        remove: (...cs) => cs.forEach(c => classes.delete(c)),
        toggle: (c, force) => force ? classes.add(c) : classes.delete(c),
        contains: c => classes.has(c),
      },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: k => attrs.get(k) ?? null,
      addEventListener: (ev, fn) => listeners.set(ev, fn),
      append(...items) { this.children.push(...items); },
      replaceChildren(...items) { this.children = items.flatMap(i => i.tagName === 'FRAGMENT' ? i.children : [i]); },
      findAll(pred) {
        const res = [];
        if (pred(this)) res.push(this);
        for (const c of this.children) res.push(...c.findAll(pred));
        return res;
      },
    };
    return node;
  };

  try {
    globalThis.document = {
      createElement: tag => {
        const el = makeNode(tag);
        return new Proxy(el, {
          set(target, prop, value) {
            if (prop === 'className' && typeof value === 'string') {
              value.split(/\s+/).filter(Boolean).forEach(c => target.classList.add(c));
            }
            target[prop] = value;
            return true;
          },
        });
      },
      createDocumentFragment: () => makeNode('fragment'),
      querySelectorAll: () => [],
    };

    const frame = engine.createFrame([0, 0]);
    engine.gridCell(frame, frame.root.id, 1, 2);
    const [first] = engine.leaves(frame.root);
    first.nodes = [1];
    frame.headerOpacity = 0.5;
    first.headerOpacity = 0.8;

    const metrics = new Map([[1, { minWidth: 200, height: 100, minHeight: 80, collapsed: false, titleHeight: 30 }]]);
    let selected = [];

    const fakeOverlay = Object.create(LayoutOverlay.prototype);
    fakeOverlay.hidden = { ids: new Set(), frames: new Map() };
    fakeOverlay.plane = makeNode('div');
    fakeOverlay.hover = null;
    fakeOverlay.editing = null;
    fakeOverlay.drag = null;
    fakeOverlay.headerPreview = null;
    fakeOverlay.app = { canvas: { setDirty() {} } };
    fakeOverlay.controller = {
      frames: [frame],
      selectedNodes: () => selected,
      graph: { links: [], getNodeById: id => (String(id) === '1' ? { id: 1 } : null) },
    };

    // 1. Expanded, autohide off: frame, cells, dividers, and autohide toggle button render
    let layouts = [{ frame, ...engine.layoutFrame(frame, metrics) }];
    fakeOverlay.render(layouts);
    let autohideBtns = fakeOverlay.plane.findAll(el => el.classList.contains('clt-autohide'));
    assert.equal(autohideBtns.length, 1);
    assert.equal(autohideBtns[0].style.display, undefined, 'autohide toggle is visible when expanded');
    let frameHeaders = fakeOverlay.plane.findAll(el => el.classList.contains('clt-frame-header'));
    assert.equal(frameHeaders[0].style.background, 'rgba(32, 40, 44, 0.5)', 'frame header applies headerOpacity');
    let cellHeaders = fakeOverlay.plane.findAll(el => el.classList.contains('clt-cell-header'));
    assert.equal(cellHeaders[0].style.background, 'rgba(32, 40, 44, 0.8)', 'first cell header applies cell headerOpacity override');
    assert.equal(cellHeaders[1].style.background, 'rgba(32, 40, 44, 0.5)', 'second cell header inherits frame headerOpacity');

    // 2. Collapsed: autohide toggle is hidden
    frame.collapsed = true;
    layouts = [{ frame, ...engine.layoutFrame(frame, metrics) }];
    fakeOverlay.render(layouts);
    autohideBtns = fakeOverlay.plane.findAll(el => el.classList.contains('clt-autohide'));
    assert.equal(autohideBtns[0].style.display, 'none', 'autohide toggle is hidden when collapsed');
    delete frame.collapsed;

    // 3. Minimized: autohide toggle is hidden
    frame.minimized = true;
    layouts = [{ frame, ...engine.layoutFrame(frame, metrics) }];
    fakeOverlay.render(layouts);
    autohideBtns = fakeOverlay.plane.findAll(el => el.classList.contains('clt-autohide'));
    assert.equal(autohideBtns[0].style.display, 'none', 'autohide toggle is hidden when minimized');
    delete frame.minimized;

    // 4. Expanded with autohide = true and no selected node: container is completely hidden
    frame.autohide = true;
    layouts = [{ frame, ...engine.layoutFrame(frame, metrics) }];
    fakeOverlay.render(layouts);
    assert.equal(fakeOverlay.plane.children.length, 0, 'grid container DOM is completely omitted when autohidden');

    // 5. Expanded with autohide = true and node 1 selected: container remains hidden
    selected = [{ id: 1 }];
    fakeOverlay.render(layouts);
    assert.equal(fakeOverlay.plane.children.length, 0, 'grid container DOM remains omitted when a contained node is selected');

    // 6. Expanded with autohide = true and a node in its drop zone: container appears
    fakeOverlay.hover = first.id;
    fakeOverlay.render(layouts);
    assert.ok(fakeOverlay.plane.children.length > 0, 'grid container DOM appears when a node is in its drop zone');
    autohideBtns = fakeOverlay.plane.findAll(el => el.classList.contains('clt-autohide'));
    assert.equal(autohideBtns[0].getAttribute('aria-pressed'), 'true');
  } finally {
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
  }
});

test('selectedFrame identifies the grid containing a selected node and frameActions includes container and header toggle controls', async () => {
  const { LayoutController } = await import('../web/core/controller.js');
  const n1 = { id: 1, pos: [0, 0], size: [200, 100], computeSize: () => [200, 80], setSize(s) { this.size = s; } };
  const n2 = { id: 2, pos: [400, 0], size: [200, 100], computeSize: () => [200, 80], setSize(s) { this.size = s; } };
  let selected = [n1, n2];
  const graph = {
    extra: {},
    _nodes: [n1, n2],
    getNodeById: id => [n1, n2].find(n => String(n.id) === String(id)) ?? null,
    setDirtyCanvas() {},
  };
  const app = {
    configuringGraph: false,
    graph,
    canvas: {
      graph,
      get selected_nodes() { return selected; },
      ds: { scale: 1, offset: [0, 0] },
      setDirty() {},
    },
  };
  const controller = new LayoutController(app);
  assert.equal(controller.selectedFrame(), null, 'no frame before grid creation');

  const frame = controller.createFromNodes([1], 'columns');
  selected = [n2];
  assert.equal(controller.selectedFrame(), null, 'external selected node does not match grid');

  selected = [n1];
  assert.equal(controller.selectedFrame()?.id, frame.id, 'selected node inside grid resolves its frame');

  const fakeOverlay = Object.create(LayoutOverlay.prototype);
  fakeOverlay.controller = controller;
  fakeOverlay.app = app;
  fakeOverlay.safe = fn => fn();

  // Expanded frame with includeToggles: true includes both ••• items and all 4 header toggles
  const expandedLabels = fakeOverlay.frameActions(frame, { includeToggles: true }).map(([label]) => label);
  assert.deepEqual(expandedLabels, [
    'Change Appearance…',
    'Shrink grid to content',
    'Add bottom row',
    'Fill cell height',
    'Lock frame',
    'Autohide grid',
    'Minimize grid',
    'Collapse grid',
    'Export empty template',
    'Remove grid (keep nodes)',
  ]);

  // Collapsed frame omits Autohide toggle and flips Collapse -> Expand
  frame.collapsed = true;
  const collapsedLabels = fakeOverlay.frameActions(frame, { includeToggles: true }).map(([label]) => label);
  assert.equal(collapsedLabels.includes('Autohide grid'), false, 'autohide toggle hidden when collapsed');
  assert.equal(collapsedLabels.includes('Expand grid'), true);
  delete frame.collapsed;

  // Minimized frame omits both Autohide and Collapse toggles and flips Minimize -> Restore
  frame.minimized = true;
  const minimizedLabels = fakeOverlay.frameActions(frame, { includeToggles: true }).map(([label]) => label);
  assert.equal(minimizedLabels.includes('Autohide grid'), false, 'autohide toggle hidden when minimized');
  assert.equal(minimizedLabels.includes('Collapse grid'), false, 'collapse toggle hidden when minimized');
  assert.equal(minimizedLabels.includes('Restore grid'), true);
});

test('autohide reveals the grid container when an external or ghost node is dragged over it', () => {
  const frame = engine.createFrame([100, 100]);
  frame.size = [400, 300];
  frame.autohide = true;
  frame.root.nodes = ['1'];

  const insideNode = { id: '1', pos: [120, 180], size: [200, 100] };
  const draggedNode = { id: '2', pos: [700, 700], size: [200, 100] };
  const ghostNode = { id: '3', pos: [700, 700], size: [200, 100], flags: { ghost: true } };
  const nodes = [insideNode, draggedNode, ghostNode];

  const fakeOverlay = Object.create(LayoutOverlay.prototype);
  fakeOverlay.controller = {
    frames: [frame],
    selectedNodes: () => [draggedNode], // External node is selected, not insideNode
    adapter: { classicTitle: 30 },
    graph: {
      getNodeById: id => nodes.find(n => String(n.id) === String(id)) ?? null,
    },
  };
  fakeOverlay.app = { canvas: { setDirty() {} } };
  fakeOverlay.editing = null;
  fakeOverlay.drag = null;
  fakeOverlay.headerPreview = null;
  fakeOverlay.nativeDrag = null;
  fakeOverlay.nativeNode = null;
  fakeOverlay.hover = null;
  fakeOverlay.ghostNodeId = null;

  // Before dragging: external node is at [700, 700] outside frame [100, 100, 400, 300]
  assert.equal(fakeOverlay.isFrameAutohidden(frame), true, 'hidden when external node is not dragged over frame');

  // Start dragging external node, still far away from frame
  fakeOverlay.nativeNode = draggedNode;
  fakeOverlay.nativeDrag = {
    before: new Map([['1', { pos: [120, 180], size: [200, 100] }], ['2', { pos: [700, 700], size: [200, 100] }]]),
    pointer: [750, 720],
  };
  draggedNode.pos = [680, 680];
  assert.equal(fakeOverlay.isFrameAutohidden(frame), true, 'still hidden while dragged far from frame');

  // Drag external node over the top of the grid container (e.g., overlapping the frame header / body)
  draggedNode.pos = [200, 110];
  fakeOverlay.nativeDrag.pointer = [250, 115];
  assert.equal(fakeOverlay.isFrameAutohidden(frame), false, 'revealed when external node is dragged over the grid container');

  // Drag external node away from the grid container
  draggedNode.pos = [700, 700];
  fakeOverlay.nativeDrag.pointer = [750, 720];
  assert.equal(fakeOverlay.isFrameAutohidden(frame), true, 'hidden again when dragged away from the grid container');

  // End native drag, test ghost node dragged over the grid container
  fakeOverlay.nativeDrag = null;
  fakeOverlay.nativeNode = null;
  fakeOverlay.ghostNodeId = '3';
  ghostNode.pos = [220, 200];
  assert.equal(fakeOverlay.isFrameAutohidden(frame), false, 'revealed when a ghost node is dragged over the grid container');

  ghostNode.pos = [800, 800];
  assert.equal(fakeOverlay.isFrameAutohidden(frame), true, 'hidden when ghost node is outside the grid container');
});

test('an empty grid forces autohide off and keeps the toggle disabled until a node is added', async () => {
  const { LayoutController } = await import('../web/core/controller.js');
  const n1 = { id: 1, pos: [0, 0], size: [200, 100], computeSize: () => [200, 80], setSize(s) { this.size = s; } };
  const graph = {
    extra: {},
    _nodes: [n1],
    getNodeById: id => graph._nodes.find(n => String(n.id) === String(id)) ?? null,
    setDirtyCanvas() {},
  };
  const app = { configuringGraph: false, graph, canvas: { graph, selected_nodes: {}, ds: { scale: 1, offset: [0, 0] }, setDirty() {} } };
  const controller = new LayoutController(app);
  const frame = controller.createFromNodes([1], 'columns');

  const overlay = Object.create(LayoutOverlay.prototype);
  Object.assign(overlay, { controller, app, safe: fn => fn(), editing: null, drag: null, headerPreview: null, hover: null, nativeDrag: null, nativeNode: null, ghostNodeId: null });
  const labels = () => overlay.frameActions(frame, { includeToggles: true }).map(([label]) => label);

  overlay.toggleAutohide(frame.id);
  assert.equal(frame.autohide, true);
  assert.equal(overlay.isFrameAutohidden(frame), true);

  // Dragging the last node out of the grid switches autohide off.
  controller.drop([1], [5000, 5000], null);
  assert.equal(engine.leaves(frame.root).some(cell => cell.nodes.length), false);
  assert.equal('autohide' in frame, false, 'autohide is cleared once the grid is empty');
  assert.equal(overlay.isFrameAutohidden(frame), false, 'an empty grid is always visible');

  // While empty, autohide cannot be switched back on.
  overlay.toggleAutohide(frame.id);
  assert.equal('autohide' in frame, false, 'toggle refuses to enable autohide on an empty grid');
  assert.equal(labels().includes('Autohide grid'), false, 'menu omits autohide while the grid is empty');
  assert.equal(labels().includes('Remove grid (keep nodes)'), true);

  // A stale autohide flag saved in the workflow cannot hide an empty grid either.
  frame.autohide = true;
  assert.equal(overlay.isFrameAutohidden(frame), false, 'a saved autohide flag cannot hide an empty grid');
  delete frame.autohide;

  // Dropping a node back in makes autohide available again.
  const cell = engine.leaves(frame.root)[0];
  controller.drop([1], null, { frame, cell });
  assert.equal(labels().includes('Autohide grid'), true);
  overlay.toggleAutohide(frame.id);
  assert.equal(frame.autohide, true);

  // Deleting the last node from the workflow also clears autohide on the next reflow.
  graph._nodes = [];
  controller.reflow();
  assert.equal('autohide' in frame, false, 'autohide is cleared when the last node is deleted');
});

test('syncSelectionMenuDom colors top toolbox icon purple when in grid, adds VF logo to hamburger menu item, deduplicates, and hides menu item when in grid', () => {
  assert.equal(LOGO_PURPLE, '#8b5cf6');

  const makeEl = (tag, className = '', text = '') => {
    const el = {
      tagName: tag.toUpperCase(),
      className,
      textContent: text,
      style: {},
      dataset: {},
      attributes: new Map(),
      children: [],
      parent: null,
      classList: {
        contains(cls) { return el.className.split(/\s+/).filter(Boolean).includes(cls); },
        add(...classes) {
          const set = new Set(el.className.split(/\s+/).filter(Boolean));
          for (const c of classes) set.add(c);
          el.className = [...set].join(' ');
        },
        remove(...classes) {
          const set = new Set(el.className.split(/\s+/).filter(Boolean));
          for (const c of classes) set.delete(c);
          el.className = [...set].join(' ');
        },
        toggle(cls, force) {
          const has = this.contains(cls);
          const next = force === undefined ? !has : Boolean(force);
          if (next) this.add(cls); else this.remove(cls);
          return next;
        },
      },
      setAttribute(k, v) { this.attributes.set(k, String(v)); },
      getAttribute(k) { return this.attributes.get(k) ?? null; },
      removeAttribute(k) { this.attributes.delete(k); },
      append(...nodes) {
        for (const n of nodes) {
          if (typeof n === 'object' && n) n.parent = this;
          this.children.push(n);
        }
      },
      prepend(...nodes) {
        for (const n of nodes) {
          if (typeof n === 'object' && n) n.parent = this;
        }
        this.children.unshift(...nodes);
      },
      replaceChildren(...nodes) {
        this.children = [];
        this.append(...nodes);
      },
      remove() {
        if (this.parent) {
          this.parent.children = this.parent.children.filter(c => c !== this);
          this.parent = null;
        }
      },
      closest(sel) {
        let cur = this;
        while (cur) {
          if (sel === 'button' && cur.tagName === 'BUTTON') return cur;
          cur = cur.parent;
        }
        return null;
      },
      getBoundingClientRect() { return { left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30 }; },
      cloneNode() {
        const cloneTree = node => {
          const copy = makeEl(node.tagName.toLowerCase(), node.className, node.textContent);
          for (const [k, v] of node.attributes) copy.setAttribute(k, v);
          for (const child of node.children) copy.append(cloneTree(child));
          return copy;
        };
        return cloneTree(this);
      },
      get fullText() {
        if (!this.children.length) return this.textContent || '';
        return (this.textContent || '') + this.children.map(c => c.fullText ?? c.textContent ?? '').join('');
      },
      matchesSelector(sel) {
        if (sel === '.selection-toolbox [class~="icon-[lucide--panels-top-left]"]') {
          return this.classList.contains('icon-[lucide--panels-top-left]');
        }
        if (sel === '.p-contextmenu-root-list') return this.classList.contains('p-contextmenu-root-list');
        if (sel === '.p-contextmenu-item') return this.classList.contains('p-contextmenu-item');
        if (sel === 'a' || sel === '.p-contextmenu-item-link') return this.tagName === 'A' || this.classList.contains('p-contextmenu-item-link');
        if (sel === '.vf-brand-link') return this.classList.contains('vf-brand-link');
        if (sel === 'img') return this.tagName === 'IMG';
        return false;
      },
      querySelectorAll(sel) {
        const out = [];
        const visit = n => {
          for (const c of n.children || []) {
            if (c.matchesSelector?.(sel)) out.push(c);
            visit(c);
          }
        };
        visit(this);
        return out;
      },
      querySelector(sel) {
        return this.querySelectorAll(sel)[0] ?? null;
      },
    };
    return el;
  };

  const fakeDoc = {
    createElement: tag => makeEl(tag),
    createTextNode: text => ({ textContent: text, fullText: text, children: [] }),
  };

  const root = makeEl('div', 'root');
  const toolbox = makeEl('div', 'selection-toolbox');
  const button = makeEl('button');
  const icon = makeEl('i', 'icon-[lucide--panels-top-left]');
  button.append(icon);
  toolbox.append(button);
  root.append(toolbox);

  const list = makeEl('ul', 'p-contextmenu-root-list');
  const deleteItem = makeEl('li', 'p-contextmenu-item');
  deleteItem.setAttribute('aria-label', 'Delete');
  const deleteLink = makeEl('a', 'p-contextmenu-item-link');
  deleteLink.append(makeEl('span', 'p-contextmenu-item-label', 'Delete'));
  deleteItem.append(deleteLink);
  list.append(deleteItem);
  root.append(list);

  // 1. Not in grid, menuPending = true (multi-select where PrimeVue did not add the item):
  //    - toolbox icon has default color ('')
  //    - hamburger menu adds 1 "Create grid layout from selected nodes" item with VF logo (.vf-brand-link > img)
  let pending = syncSelectionMenuDom(root, {
    doc: fakeDoc,
    inGrid: false,
    selectionCount: 2,
    menuPending: true,
    onActivate() {},
  });
  assert.equal(pending, false, 'menuPending is consumed after populating menu');
  assert.equal(icon.style.color, '', 'toolbox icon is default color when selected node is not in grid');
  assert.equal(button.classList.contains('clt-in-grid'), false);

  let createItems = list.querySelectorAll('.p-contextmenu-item').filter(
    el => el.getAttribute('aria-label') === 'Create grid layout from selected nodes' || el.fullText.trim() === 'Create grid layout from selected nodes'
  );
  assert.equal(createItems.length, 1, 'creates exactly one menu item');
  assert.ok(createItems[0].querySelector('.vf-brand-link'), 'menu item includes VF logo badge');
  assert.ok(createItems[0].querySelector('img')?.src?.startsWith('data:image/svg+xml,'), 'VF logo badge contains inline SVG data URI');

  // 2. Single-node selection where PrimeVue ALREADY rendered the item from getNodeMenuItems(), plus menuPending = true:
  //    must NOT duplicate the item, and must ensure the existing item has the VF logo badge
  const primeVueItem = makeEl('li', 'p-contextmenu-item');
  primeVueItem.setAttribute('aria-label', 'Create grid layout from selected nodes');
  const primeVueLink = makeEl('a', 'p-contextmenu-item-link');
  primeVueLink.append(makeEl('span', 'p-contextmenu-item-label', 'Create grid layout from selected nodes'));
  primeVueItem.append(primeVueLink);
  list.replaceChildren(primeVueItem, deleteItem);

  pending = syncSelectionMenuDom(root, {
    doc: fakeDoc,
    inGrid: false,
    selectionCount: 1,
    menuPending: true,
    onActivate() {},
  });
  assert.equal(pending, false);
  createItems = list.querySelectorAll('.p-contextmenu-item').filter(
    el => el.getAttribute('aria-label') === 'Create grid layout from selected nodes' || el.fullText.trim() === 'Create grid layout from selected nodes'
  );
  assert.equal(createItems.length, 1, 'does not duplicate existing menu item from getNodeMenuItems');
  assert.ok(primeVueLink.querySelector('.vf-brand-link'), 'prepends VF logo badge to existing menu item');

  // 3. Selected node IS contained in a grid container (inGrid = true):
  //    - top toolbox icon turns purple (#8b5cf6)
  //    - "Create grid layout from selected nodes" menu item is hidden/removed from the hamburger menu
  pending = syncSelectionMenuDom(root, {
    doc: fakeDoc,
    inGrid: true,
    selectionCount: 1,
    menuPending: true,
    onActivate() {},
  });
  assert.equal(pending, false);
  assert.equal(icon.style.color, LOGO_PURPLE, 'top toolbox icon turns logo purple when selected node is in grid');
  assert.equal(button.classList.contains('clt-in-grid'), true);
  createItems = list.querySelectorAll('.p-contextmenu-item').filter(
    el => el.getAttribute('aria-label') === 'Create grid layout from selected nodes' || el.fullText.trim() === 'Create grid layout from selected nodes'
  );
  assert.equal(createItems.length, 0, 'does not show Create grid layout from selected nodes menu item when node is already in grid');
});




