export const LINK_EFFECT_SETTINGS = {
  enabled: 'VF.LinkEffects.Enabled',
  effect: 'VF.LinkEffects.Effect',
  neighbors: 'VF.LinkEffects.HighlightConnectedNodes',
};

export function createLinkEffectSettings(settings) {
  const enabled = () => settings.getSettingValue(LINK_EFFECT_SETTINGS.enabled) ?? true;
  const category = ['LiteGraph', 'Graph', 'VF Link Effects'];
  return [
    {
      id: LINK_EFFECT_SETTINGS.enabled,
      category: [...category, 'Enabled'],
      name: 'VF Link Effects',
      sortOrder: -10,
      type: 'boolean',
      defaultValue: true,
      tooltip: 'Emphasize incoming and outgoing wires attached to selected nodes using their output port colors.',
    },
    {
      id: LINK_EFFECT_SETTINGS.effect,
      category: [...category, 'Effect'],
      name: 'Link effect',
      sortOrder: -11,
      get type() { return enabled() ? 'combo' : 'hidden'; },
      defaultValue: 'electricity',
      options: [{ text: 'Electricity', value: 'electricity' }, { text: 'Neon Glow', value: 'neon' }],
      tooltip: 'Electricity travels from output to input. Neon Glow adds a steady halo.',
    },
    {
      id: LINK_EFFECT_SETTINGS.neighbors,
      category: [...category, 'Highlight connected nodes'],
      name: 'Highlight connected nodes',
      sortOrder: -12,
      get type() { return enabled() ? 'boolean' : 'hidden'; },
      defaultValue: true,
      tooltip: 'Give directly connected, unselected nodes a subtle border.',
    },
  ];
}

export function collectConnections(graph, selection) {
  const selected = new Set(selection.filter(node => graph?.getNodeById(node.id) === node).map(node => String(node.id)));
  const links = new Set();
  const neighbors = new Set();
  if (!selected.size) return { links, neighbors };
  const allLinks = graph.links instanceof Map ? graph.links.values() : Object.values(graph.links ?? {});
  for (const link of allLinks) {
    if (!link || !graph.getNodeById(link.origin_id) || !graph.getNodeById(link.target_id)) continue;
    const origin = String(link.origin_id), target = String(link.target_id);
    if (!selected.has(origin) && !selected.has(target)) continue;
    links.add(String(link.id));
    if (!selected.has(origin)) neighbors.add(origin);
    if (!selected.has(target)) neighbors.add(target);
  }
  return { links, neighbors };
}

export function outputPortColor(graph, canvas, link, typeColors = {}) {
  const litegraph = globalThis.LiteGraph ?? globalThis.comfyAPI?.litegraph?.LiteGraph;
  if (litegraph?.vueNodesMode && globalThis.document && globalThis.getComputedStyle) {
    const id = String(link.origin_id);
    const node = globalThis.CSS?.escape
      ? document.querySelector(`.lg-node[data-node-id="${CSS.escape(id)}"]`)
      : [...document.querySelectorAll('.lg-node')].find(el => el.dataset?.nodeId === id);
    const dot = node?.querySelectorAll('.lg-slot--output')[link.origin_slot]?.querySelector('.slot-dot');
    if (dot) {
      const svg = dot.tagName.toLowerCase() === 'svg';
      const fill = svg ? dot.querySelector('[fill]:not([fill="transparent"])') : dot;
      const style = fill && getComputedStyle(fill);
      const displayed = svg ? style?.fill : style?.backgroundColor;
      if (displayed && displayed !== 'none' && displayed !== 'transparent' && displayed !== 'rgba(0, 0, 0, 0)') return displayed;
    }
  }
  const port = graph?.getNodeById(link.origin_id)?.outputs?.[link.origin_slot];
  const displayed = canvas.colourGetter && port?.renderingColor?.(canvas.colourGetter);
  return displayed || port?.color_on || typeColors[String(port?.type ?? link.type)] || link.color || canvas.default_link_color || '#9a9a9a';
}

const NEIGHBOR_COLOR = 'rgba(120,144,156,0.65)';

export class LinkEffects {
  constructor(controller) {
    this.controller = controller;
    this.canvas = controller.app.canvas;
    this.connections = { links: new Set(), neighbors: new Set() };
    this.selected = new Set();
    this.elements = new Set();
    this.motion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (globalThis.document?.head) {
      this.style = document.createElement('style');
      this.style.textContent = `
        .lg-node.vf-link-neighbor { outline: 1px solid ${NEIGHBOR_COLOR}; outline-offset: 0; }
        .lg-node.vf-link-dimmed { filter: opacity(0.3); }
        [data-setting-id="VF.LinkEffects.Enabled"] { border-top: 1px solid var(--border-color, #343434); margin-top: 16px; padding-top: 16px; }
      `;
      document.head.append(this.style);
    }
  }

  update(now = globalThis.performance?.now() ?? 0) {
    if (this.disposed) return;
    this.time = now;
    const settings = this.controller.app.ui?.settings;
    this.enabled = settings?.getSettingValue(LINK_EFFECT_SETTINGS.enabled) === true;
    this.effect = settings?.getSettingValue(LINK_EFFECT_SETTINGS.effect) === 'neon' ? 'neon' : 'electricity';
    this.highlight = settings?.getSettingValue(LINK_EFFECT_SETTINGS.neighbors) !== false;
    const graph = this.controller.graph;
    const selection = this.enabled ? this.controller.selectedNodes().filter(node => graph?.getNodeById(node.id) === node) : [];
    this.selected = new Set(selection.map(node => String(node.id)));
    const key = `${this.enabled}:${graph?._version}:${selection.map(node => node.id).sort().join(',')}`;
    if (graph !== this.graph || key !== this.key || graph?._version === undefined) {
      this.connections = collectConnections(graph, selection);
      this.graph = graph;
      this.key = key;
    }
    const signature = `${key}:${this.effect}:${this.highlight}:${this.isHiddenLinkMode()}:${!!this.motion?.matches}:${[...this.connections.links].join(',')}:${[...this.connections.neighbors].join(',')}`;
    const changed = signature !== this.signature;
    this.signature = signature;
    this.updateNodeElements();
    if (changed || (this.enabled && this.effect === 'electricity' && !this.motion?.matches && this.hasVisibleLinks())) {
      this.canvas.setDirty?.(true, true);
    }
  }

  isHiddenLinkMode() {
    const litegraph = globalThis.LiteGraph ?? globalThis.comfyAPI?.litegraph?.LiteGraph;
    const hiddenMode = litegraph?.HIDDEN_LINK ?? -1;
    return this.canvas?.links_render_mode === hiddenMode;
  }

  shouldRevealHiddenLinks() {
    return Boolean(this.enabled && this.highlight && this.connections.links.size > 0);
  }

  isConnectedLink(link, reroute) {
    if (!link) return false;
    if (this.connections.links.has(String(link.id))) return true;
    return Boolean(reroute?.linkIds && [...reroute.linkIds].some(id => this.connections.links.has(String(id))));
  }

  hasVisibleLinks() {
    if ((this.isHiddenLinkMode() && !this.shouldRevealHiddenLinks()) || globalThis.document?.visibilityState === 'hidden') return false;
    const visible = this.canvas.renderedPaths ?? this.canvas.visible_links;
    if (visible) {
      for (const segment of visible) {
        if (this.connections.links.has(String(segment.id))) return true;
        if (segment.linkIds && [...segment.linkIds].some(id => this.connections.links.has(String(id)))) return true;
      }
      return false;
    }
    return this.lastDraw >= this.time - 100;
  }

  updateNodeElements() {
    for (const el of this.elements) {
      if (!el.isConnected || !this.enabled || !this.selected.size) {
        el.classList.remove('vf-link-neighbor');
        el.classList.remove('vf-link-dimmed');
        this.elements.delete(el);
      }
    }
    if (!this.enabled || !this.selected.size) return;
    for (const el of globalThis.document?.querySelectorAll?.('.lg-node') ?? []) {
      const id = String(el.dataset?.nodeId);
      const neighbor = this.highlight && this.connections.neighbors.has(id) && !el.classList.contains('clt-node-hidden');
      const dimmed = this.isDimmed(id);
      if (neighbor) el.classList.add('vf-link-neighbor');
      else el.classList.remove('vf-link-neighbor');
      if (dimmed) el.classList.add('vf-link-dimmed');
      else el.classList.remove('vf-link-dimmed');
      if (neighbor || dimmed) this.elements.add(el);
      else this.elements.delete(el);
    }
  }

  isDimmed(id) {
    return this.enabled && this.selected.size > 0 && !this.selected.has(String(id)) && !this.connections.neighbors.has(String(id));
  }

  isLinkDimmed(link, reroute) {
    if (!this.enabled || !this.selected.size || !link) return false;
    return !this.isConnectedLink(link, reroute);
  }

  renderDimmed(ctx, draw) {
    let proto = ctx, descriptor;
    while (proto && !descriptor) {
      descriptor = Object.getOwnPropertyDescriptor(proto, 'globalAlpha');
      proto = Object.getPrototypeOf(proto);
    }
    if (!descriptor?.get || !descriptor?.set) return draw();
    const own = Object.getOwnPropertyDescriptor(ctx, 'globalAlpha');
    const originalAlpha = descriptor.get.call(ctx);
    // Native drawing resets alpha for widgets, slots, and markers. Scale every
    // assignment for this draw while keeping its logical alpha reads intact.
    Object.defineProperty(ctx, 'globalAlpha', {
      configurable: true,
      get: () => descriptor.get.call(ctx) / 0.3,
      set: value => { if (value >= 0 && value <= 1) descriptor.set.call(ctx, value * 0.3); },
    });
    descriptor.set.call(ctx, originalAlpha * 0.3);
    try { return draw(); }
    finally {
      if (own) Object.defineProperty(ctx, 'globalAlpha', own);
      else delete ctx.globalAlpha;
      descriptor.set.call(ctx, originalAlpha);
    }
  }

  renderNode(ctx, node, draw) {
    if (!this.isDimmed(node.id)) return draw();
    return this.renderDimmed(ctx, draw);
  }

  drawConnections(ctx, draw) {
    if (!this.isHiddenLinkMode() || !this.shouldRevealHiddenLinks()) return draw();
    const litegraph = globalThis.LiteGraph ?? globalThis.comfyAPI?.litegraph?.LiteGraph;
    const prevMode = this.canvas.links_render_mode;
    const origRenderAll = this.canvas._renderAllLinkSegments;
    const hadOwnRenderAll = Object.hasOwn(this.canvas, '_renderAllLinkSegments');
    this.revealingHiddenLinks = true;
    this.canvas.links_render_mode = litegraph?.SPLINE_LINK ?? 2;
    if (typeof origRenderAll === 'function') {
      this.canvas._renderAllLinkSegments = (c, link, ...rest) => {
        if (link && !this.connections.links.has(String(link.id))) return;
        return origRenderAll.call(this.canvas, c, link, ...rest);
      };
    }
    try { return draw(); }
    finally {
      this.revealingHiddenLinks = false;
      this.canvas.links_render_mode = prevMode;
      if (typeof origRenderAll === 'function') {
        if (hadOwnRenderAll) this.canvas._renderAllLinkSegments = origRenderAll;
        else delete this.canvas._renderAllLinkSegments;
      }
    }
  }

  renderLink(ctx, link, draw, reroute) {
    const connected = this.isConnectedLink(link, reroute);
    if (this.revealingHiddenLinks || this.isHiddenLinkMode()) {
      if (!this.shouldRevealHiddenLinks() || !connected) return;
    } else if (this.isLinkDimmed(link, reroute)) {
      return this.renderDimmed(ctx, draw);
    }
    if (!this.enabled || !connected) return draw();
    const canvas = this.canvas;
    const litegraph = globalThis.LiteGraph ?? globalThis.comfyAPI?.litegraph?.LiteGraph;
    const color = outputPortColor(this.controller.graph, canvas, link, litegraph?.LGraphCanvas?.link_type_colors);
    const nativeStroke = ctx.stroke;
    const ownedStroke = Object.hasOwn(ctx, 'stroke');
    // Decorate native strokes, including PCB and reroute paths. This leaves
    // geometry and hit testing entirely in the original renderer's hands.
    ctx.stroke = (...args) => {
      const result = nativeStroke.apply(ctx, args);
      if (ctx.lineWidth > (canvas.connections_width ?? 3) + 0.01) return result;
      this.lastDraw = this.time;
      ctx.save();
      try {
        const width = ctx.lineWidth;
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
        ctx.lineCap = 'round';
        ctx.strokeStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = this.effect === 'neon' ? 12 : 6;
        if (this.effect === 'neon') {
          ctx.globalAlpha *= 0.35;
          ctx.lineWidth = width + 4;
          nativeStroke.apply(ctx, args);
          ctx.globalAlpha /= 0.35;
        }
        ctx.lineWidth = width;
        nativeStroke.apply(ctx, args);
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(1, width * (this.effect === 'neon' ? 0.4 : 0.65));
        if (this.effect === 'neon') ctx.globalAlpha *= 0.55;
        if (this.effect === 'electricity') {
          ctx.setLineDash([12, 88]);
          ctx.lineDashOffset = this.motion?.matches ? 0 : -this.time * 0.32;
          ctx.shadowColor = '#ffffff';
          ctx.shadowBlur = 8;
        }
        nativeStroke.apply(ctx, args);
      } finally { ctx.restore(); }
      return result;
    };
    try { return draw(); }
    finally {
      if (ownedStroke) ctx.stroke = nativeStroke;
      else delete ctx.stroke;
    }
  }

  drawNodeBorder(node, ctx) {
    if (!this.enabled || !this.highlight || !this.connections.neighbors.has(String(node.id)) || node.selected) return;
    const litegraph = globalThis.LiteGraph ?? globalThis.comfyAPI?.litegraph?.LiteGraph;
    if (litegraph?.vueNodesMode) return;
    const title = litegraph?.NODE_TITLE_HEIGHT ?? 30;
    const rect = node.boundingRect;
    const [x, y, w, h] = rect
      ? [rect[0] - node.pos[0], rect[1] - node.pos[1], rect[2], rect[3]]
      : [0, -title, node.size[0], (node.flags?.collapsed ? 0 : node.size[1]) + title];
    ctx.save();
    try {
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = NEIGHBOR_COLOR;
      ctx.lineWidth = 1.25;
      ctx.setLineDash([]);
      ctx.beginPath();
      const shape = node.renderingShape ?? node.shape;
      if (litegraph && shape === litegraph.CIRCLE_SHAPE) {
        const size = node.renderingSize ?? node.size;
        ctx.arc(size[0] / 2, size[1] / 2, size[0] / 2, 0, Math.PI * 2);
      } else if (shape !== litegraph?.BOX_SHAPE && ctx.roundRect) {
        const radius = litegraph?.ROUND_RADIUS ?? 8;
        ctx.roundRect(x, y, w, h, shape === litegraph?.CARD_SHAPE ? [radius, radius, 0, 0] : radius);
      } else ctx.rect(x, y, w, h);
      ctx.stroke();
    } finally { ctx.restore(); }
  }

  dispose() {
    this.disposed = true;
    for (const el of this.elements) {
      el.classList.remove('vf-link-neighbor');
      el.classList.remove('vf-link-dimmed');
    }
    this.elements.clear();
    this.style?.remove();
    this.canvas.setDirty?.(true, true);
  }
}
