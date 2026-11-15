import { BOTTOM_TAB_BAR_HEIGHT, computeNodeTabBodyHeights } from './bottom-tabs.js';

export class NodeAdapter {
  constructor(app, { classicTitle = 30 } = {}) {
    this.app = app;
    this.classicTitle = classicTitle;
    this.widths = new WeakMap();
    this.imposedWidths = new WeakMap();
    this.bases = new Map();
    this.appliedHeights = new Map();
    this.tabHeights = new Map();
    this.renderedHeights = new Map();
    this.sectionMeasurements = new Map();
  }
  // Fill tracking is keyed by node id, not object identity: undo/redo can
  // swap node instances, and the tracked heights must survive that.
  trackKey(node) {
    return node.id != null ? `id:${node.id}` : node;
  }
  point(event) {
    if (this.app.clientPosToCanvasPos) {
      return [...this.app.clientPosToCanvasPos([event.clientX, event.clientY])];
    }
    const { canvas, ds } = this.app.canvas;
    const rect = canvas.getBoundingClientRect();
    return [(event.clientX - rect.left) / ds.scale - ds.offset[0], (event.clientY - rect.top) / ds.scale - ds.offset[1]];
  }
  measure(node, options = null) {
    const minimum = node.computeSize?.() ?? [node.size[0], node.size[1]];
    // Remember the independent content minimum and honor later increases.
    // Some custom nodes report our imposed width from computeSize; treating
    // that as a new minimum would make a frame impossible to shrink.
    const imposed = this.imposedWidths.get(node);
    const computed = Math.abs((minimum[0] || 140) - imposed) < 0.1 ? 0 : minimum[0] || 140;
    this.widths.set(node, Math.max(this.widths.get(node) ?? 140, computed, node.min_size?.[0] ?? 0));
    const key = this.trackKey(node);
    let renderedMinimum = 0;
    let renderedHeight = 0;
    const hasNodeTabs = Boolean(options?.nodeTabConfig);
    if (globalThis.LiteGraph?.vueNodesMode && globalThis.document) {
      const element = document.querySelector(`.lg-node[data-node-id="${CSS.escape(String(node.id))}"]`);
      if (element) {
        renderedMinimum = parseFloat(getComputedStyle(element).minWidth) || 0;
        const isHidden = Boolean(element.classList?.contains?.('clt-node-hidden'));
        if (!isHidden && !hasNodeTabs) {
          // Nodes 2.0 lets content (image previews, media) grow the element past
          // node.size. offsetHeight ignores the canvas zoom transform, so it is in
          // graph units. It includes the title bar, which placements add separately.
          renderedHeight = Math.max(0, (element.offsetHeight || 0) - this.classicTitle);
          if (renderedHeight > 0) this.renderedHeights.set(key, renderedHeight);
        } else {
          renderedHeight = this.renderedHeights.get(key) ?? 0;
        }
      }
    }
    const collapsed = node.flags?.collapsed;
    // Track the intrinsic (pre-stretch) height: a fill stretch or bottom-tab
    // height we applied is not foreign content, so never read it back as base.
    const size = node.size[1] || 0;
    const applied = this.appliedHeights.get(key);
    const tabApplied = this.tabHeights.get(key);
    const matchesApplied = applied !== undefined && Math.abs(size - applied) <= 0.5;
    const matchesTab = tabApplied !== undefined && Math.abs(size - tabApplied) <= 0.5;
    if (size > 0 && !matchesApplied && !matchesTab) this.bases.set(key, size);
    const base = this.bases.get(key) ?? size;
    // A filled or section-tabbed node's element follows our height, so only trust
    // renderedHeight when neither stretch nor section tabbing is active.
    const content = applied === undefined && tabApplied === undefined && !hasNodeTabs ? renderedHeight : 0;
    if (hasNodeTabs) {
      const baseBody = options.nodeTabConfig.originalHeight ?? Math.max(base, minimum[1] || 0, this.renderedHeights.get(key) ?? 0);
      const { effectiveHeight } = computeNodeTabBodyHeights(node, options.nodeTabConfig, {
        baseBodyHeight: baseBody,
        sectionMeasurements: options.sectionMeasurements ?? this.sectionMeasurements.get(key),
        overrideTabIndex: options.overrideTabIndex,
      });
      return {
        minWidth: Math.max(this.widths.get(node), renderedMinimum),
        height: collapsed ? 0 : effectiveHeight,
        minHeight: collapsed ? 0 : effectiveHeight,
        collapsed: Boolean(collapsed),
        titleHeight: this.classicTitle,
        bottomBarHeight: collapsed ? 0 : BOTTOM_TAB_BAR_HEIGHT,
      };
    }
    return {
      minWidth: Math.max(this.widths.get(node), renderedMinimum),
      height: collapsed ? 0 : Math.max(base, minimum[1] || 0, content),
      minHeight: collapsed ? 0 : Math.max(minimum[1] || size, content),
      collapsed: Boolean(collapsed),
      // Both renderers retain LiteGraph's body-origin position convention.
      titleHeight: this.classicTitle,
    };
  }
  apply(node, placement) {
    node.pos = [placement.x, placement.y];
    if (placement.hidden) {
      node.setDirtyCanvas?.(true, true);
      return;
    }
    // Record the stretch before resizing: setSize can synchronously trigger
    // a re-entrant measure (resize callbacks, re-render). Without the marker
    // already in place, that measure would mistake our stretch for content
    // and adopt it as the node's intrinsic height.
    const key = this.trackKey(node);
    if (placement.fill) this.appliedHeights.set(key, placement.height);
    if (placement.stackManaged || placement.tabManaged) this.tabHeights.set(key, placement.height);
    // ComfyUI's setters update the shared layout store used by Nodes 2.0.
    // setSize also invokes custom nodes' resize callbacks in classic mode.
    this.imposedWidths.set(node, placement.width);
    this.lockCollapsedWidth(node, placement.width);
    if (node.flags?.collapsed) {
      if (Array.isArray(node.size) && Math.abs((node.size[0] ?? 0) - placement.width) > 0.1) {
        const nextSize = [placement.width, node.size[1] ?? 0];
        if (node.setSize) node.setSize(nextSize);
        else { node.size = nextSize; node.onResize?.(nextSize); }
      }
      if (globalThis.LiteGraph?.vueNodesMode && globalThis.document) {
        const element = document.querySelector(`.lg-node[data-node-id="${CSS.escape(String(node.id))}"]`);
        if (element) element.style?.setProperty?.('--node-width', `${placement.width}px`);
      }
    } else if (Math.abs(node.size[0] - placement.width) > 0.1 || Math.abs(node.size[1] - placement.height) > 0.1) {
      const size = [placement.width, placement.height];
      if (node.setSize) node.setSize(size);
      else { node.size = size; node.onResize?.(size); }
    }
    node.setDirtyCanvas?.(true, true);
  }
  applyTabHeight(node, height) {
    if (!node || node.flags?.collapsed || !Number.isFinite(height)) return;
    const key = this.trackKey(node);
    if (!this.bases.has(key) && Number.isFinite(node.size?.[1]) && node.size[1] > 0) {
      this.bases.set(key, node.size[1]);
    }
    this.tabHeights.set(key, height);
    if (Math.abs((node.size?.[1] ?? 0) - height) > 0.1) {
      const next = [node.size?.[0] ?? 220, height];
      if (node.setSize) node.setSize(next);
      else { node.size = next; node.onResize?.(next); }
    }
    node.setDirtyCanvas?.(true, true);
  }
  releaseTabHeight(node, originalHeight = null) {
    if (!node) return;
    const key = this.trackKey(node);
    this.tabHeights.delete(key);
    this.sectionMeasurements.delete(key);
    const restoreH = Number.isFinite(originalHeight) && originalHeight > 0
      ? originalHeight
      : (this.bases.get(key) ?? (node.computeSize?.()?.[1] || node.size?.[1] || 100));
    if (!node.flags?.collapsed && Math.abs((node.size?.[1] ?? 0) - restoreH) > 0.5) {
      const next = [node.size?.[0] ?? 220, restoreH];
      if (node.setSize) node.setSize(next);
      else { node.size = next; node.onResize?.(next); }
    }
    node.setDirtyCanvas?.(true, true);
  }
  lockCollapsedWidth(node, width) {
    if (!node || typeof node !== 'object' || !Number.isFinite(width)) return;
    try {
      Object.defineProperty(node, '_collapsed_width', {
        configurable: true,
        enumerable: true,
        get: () => this.imposedWidths.get(node) ?? width,
        set: () => {},
      });
    } catch {
      node._collapsed_width = width;
    }
  }
  releaseDockedWidth(node) {
    if (!node || typeof node !== 'object') return;
    this.imposedWidths.delete(node);
    const desc = Object.getOwnPropertyDescriptor(node, '_collapsed_width');
    if (desc && typeof desc.get === 'function') {
      try { delete node._collapsed_width; } catch {}
    }
    if (globalThis.LiteGraph?.vueNodesMode && globalThis.document && node.flags?.collapsed) {
      const element = document.querySelector?.(`.lg-node[data-node-id="${CSS.escape ? CSS.escape(String(node.id)) : node.id}"]`);
      if (element) element.style?.removeProperty?.('--node-width');
    }
  }
  // Neither renderer honors flags.hidden, so folding a node down to its title
  // bar is the only supported way to take one out of the visual flow. Both
  // drawNode and the Nodes 2.0 path branch on flags.collapsed.
  fold(node) {
    if (!node || node.flags?.collapsed) return false;
    node.flags ??= {};
    node.flags.collapsed = true;
    node.setDirtyCanvas?.(true, true);
    return true;
  }
  unfold(node) {
    if (!node?.flags?.collapsed) return false;
    delete node.flags.collapsed;
    node.setDirtyCanvas?.(true, true);
    return true;
  }
  releaseFill(node) {
    const key = this.trackKey(node);
    const applied = this.appliedHeights.get(key);
    if (applied !== undefined) this.appliedHeights.delete(key);
    const current = node.size[1] || 0;
    // A size that changed since our stretch is foreign (the user's or the
    // node's own); leave it alone. Without a tracked stretch (e.g. after a
    // workflow reload), fall back to the node's natural minimum.
    if (applied !== undefined && Math.abs(current - applied) > 0.5) return;
    const base = this.bases.get(key);
    const minimum = node.computeSize?.() ?? [node.size[0], current];
    const height = applied !== undefined && base !== undefined ? base : minimum[1] || current;
    if (node.flags?.collapsed || Math.abs(current - height) <= 0.5) return;
    if (node.setSize) node.setSize([node.size[0], height]);
    else { node.size = [node.size[0], height]; node.onResize?.(node.size); }
  }
}
