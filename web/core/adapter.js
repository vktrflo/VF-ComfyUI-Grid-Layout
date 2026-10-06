export class NodeAdapter {
  constructor(app, { classicTitle = 30 } = {}) {
    this.app = app;
    this.classicTitle = classicTitle;
    this.widths = new WeakMap();
    this.imposedWidths = new WeakMap();
    this.bases = new WeakMap();
    this.appliedHeights = new WeakMap();
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
    const collapsed = node.flags?.collapsed;
    // Track the intrinsic (pre-stretch) height: a fill stretch we applied is not
    // content, so the layout never reads its own stretch back as node size.
    const size = node.size[1] || 0;
    const applied = this.appliedHeights.get(node);
    if (applied === undefined || Math.abs(size - applied) > 0.5) this.bases.set(node, size);
    const base = this.bases.get(node) ?? size;
    return {
      minWidth: this.widths.get(node),
      height: collapsed ? 0 : Math.max(base, minimum[1] || 0),
      minHeight: collapsed ? 0 : minimum[1] || size,
      collapsed: Boolean(collapsed),
      // Both renderers retain LiteGraph's body-origin position convention.
      titleHeight: this.classicTitle,
    };
  }
  apply(node, placement) {
    node.pos = [placement.x, placement.y];
    // ComfyUI's setters update the shared layout store used by Nodes 2.0.
    // setSize also invokes custom nodes' resize callbacks in classic mode.
    if (!node.flags?.collapsed && (Math.abs(node.size[0] - placement.width) > 0.1 || Math.abs(node.size[1] - placement.height) > 0.1)) {
      const size = [placement.width, placement.height];
      this.imposedWidths.set(node, placement.width);
      if (node.setSize) node.setSize(size);
      else { node.size = size; node.onResize?.(size); }
    }
    if (placement.fill) this.appliedHeights.set(node, placement.height);
    node.setDirtyCanvas?.(true, true);
  }
  releaseFill(node) {
    const applied = this.appliedHeights.get(node);
    if (applied !== undefined) this.appliedHeights.delete(node);
    const current = node.size[1] || 0;
    // A size that changed since our stretch is foreign (the user's or the
    // node's own); leave it alone. Without a tracked stretch (e.g. after a
    // workflow reload), fall back to the node's natural minimum.
    if (applied !== undefined && Math.abs(current - applied) > 0.5) return;
    const base = this.bases.get(node);
    const minimum = node.computeSize?.() ?? [node.size[0], current];
    const height = applied !== undefined && base !== undefined ? base : minimum[1] || current;
    if (node.flags?.collapsed || Math.abs(current - height) <= 0.5) return;
    if (node.setSize) node.setSize([node.size[0], height]);
    else { node.size = [node.size[0], height]; node.onResize?.(node.size); }
  }
}
