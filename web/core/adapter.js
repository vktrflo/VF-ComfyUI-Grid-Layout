export class NodeAdapter {
  constructor(app, { classicTitle = 30 } = {}) {
    this.app = app;
    this.classicTitle = classicTitle;
    this.widths = new WeakMap();
    this.imposedWidths = new WeakMap();
    this.bases = new Map();
    this.appliedHeights = new Map();
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
  measure(node) {
    const minimum = node.computeSize?.() ?? [node.size[0], node.size[1]];
    // Remember the independent content minimum and honor later increases.
    // Some custom nodes report our imposed width from computeSize; treating
    // that as a new minimum would make a frame impossible to shrink.
    const imposed = this.imposedWidths.get(node);
    const computed = Math.abs((minimum[0] || 140) - imposed) < 0.1 ? 0 : minimum[0] || 140;
    this.widths.set(node, Math.max(this.widths.get(node) ?? 140, computed, node.min_size?.[0] ?? 0));
    let renderedMinimum = 0;
    if (globalThis.LiteGraph?.vueNodesMode && globalThis.document) {
      const element = document.querySelector(`.lg-node[data-node-id="${CSS.escape(String(node.id))}"]`);
      if (element) renderedMinimum = parseFloat(getComputedStyle(element).minWidth) || 0;
    }
    const collapsed = node.flags?.collapsed;
    // Track the intrinsic (pre-stretch) height: a fill stretch we applied is not
    // content, so the layout never reads its own stretch back as node size.
    const size = node.size[1] || 0;
    const key = this.trackKey(node);
    const applied = this.appliedHeights.get(key);
    if (applied === undefined || Math.abs(size - applied) > 0.5) this.bases.set(key, size);
    const base = this.bases.get(key) ?? size;
    return {
      minWidth: Math.max(this.widths.get(node), renderedMinimum),
      height: collapsed ? 0 : Math.max(base, minimum[1] || 0),
      minHeight: collapsed ? 0 : minimum[1] || size,
      collapsed: Boolean(collapsed),
      // Both renderers retain LiteGraph's body-origin position convention.
      titleHeight: this.classicTitle,
    };
  }
  apply(node, placement) {
    node.pos = [placement.x, placement.y];
    // Record the stretch before resizing: setSize can synchronously trigger
    // a re-entrant measure (resize callbacks, re-render). Without the marker
    // already in place, that measure would mistake our stretch for content
    // and adopt it as the node's intrinsic height.
    if (placement.fill) this.appliedHeights.set(this.trackKey(node), placement.height);
    // ComfyUI's setters update the shared layout store used by Nodes 2.0.
    // setSize also invokes custom nodes' resize callbacks in classic mode.
    if (!node.flags?.collapsed) this.imposedWidths.set(node, placement.width);
    if (!node.flags?.collapsed && (Math.abs(node.size[0] - placement.width) > 0.1 || Math.abs(node.size[1] - placement.height) > 0.1)) {
      const size = [placement.width, placement.height];
      if (node.setSize) node.setSize(size);
      else { node.size = size; node.onResize?.(size); }
    }
    node.setDirtyCanvas?.(true, true);
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
