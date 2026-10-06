export class NodeAdapter {
  constructor(app, { classicTitle = 30 } = {}) {
    this.app = app;
    this.classicTitle = classicTitle;
    this.widths = new WeakMap();
    this.imposedWidths = new WeakMap();
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
    return {
      minWidth: this.widths.get(node),
      height: collapsed ? 0 : Math.max(node.size[1] || 0, minimum[1] || 0),
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
    node.setDirtyCanvas?.(true, true);
  }
}
