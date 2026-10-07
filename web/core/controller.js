import { KEY, VERSION, createFrame, contains, dropNodes, exportTemplate, importTemplate, layoutFrame, leaves, pickCell, validateFrame } from './layout.js';
import { NodeAdapter } from './adapter.js';

export class LayoutController {
  constructor(app, options) {
    this.app = app;
    this.adapter = new NodeAdapter(app, options);
    this.transaction = null;
  }
  get graph() { return this.app.canvas.graph ?? this.app.graph; }
  get frames() {
    const data = this.graph?.extra?.[KEY];
    return data?.version === VERSION && Array.isArray(data.frames) ? data.frames : [];
  }
  ensureData() {
    const graph = this.graph;
    if (!graph || this.app.configuringGraph) throw new Error('Wait until the workflow has finished loading.');
    graph.extra ??= {};
    if (graph.extra[KEY] && graph.extra[KEY].version !== VERSION) throw new Error('This workflow uses an unsupported layout version.');
    return graph.extra[KEY] ??= { version: VERSION, frames: [] };
  }
  begin() {
    if (this.transaction) return false;
    this.ensureData();
    const graph = this.graph;
    this.transaction = { graph, extra: JSON.parse(JSON.stringify(graph.extra)), nodes: this.snapshot() };
    this.app.canvas.emitBeforeChange?.();
    return true;
  }
  end() {
    if (!this.transaction) return;
    this.transaction = null;
    this.app.canvas.emitAfterChange?.();
  }
  edit(action) {
    const own = this.begin();
    try {
      const result = action();
      this.reflow();
      return result;
    } catch (error) {
      if (this.transaction) {
        this.transaction.graph.extra = this.transaction.extra;
        for (const [id, state] of this.transaction.nodes) {
          const node = this.transaction.graph.getNodeById(id);
          if (node) this.adapter.apply(node, { x: state.pos[0], y: state.pos[1], width: state.size[0], height: state.size[1] });
        }
      }
      throw error;
    } finally { if (own) this.end(); }
  }
  create(pos) {
    return this.edit(() => { const frame = createFrame(pos); this.ensureData().frames.push(frame); return frame; });
  }
  remove(frameId) {
    this.edit(() => { this.ensureData().frames = this.frames.filter(f => f.id !== frameId); });
  }
  import(value, pos) {
    const frame = importTemplate(value, pos);
    this.edit(() => this.ensureData().frames.push(frame));
    return frame;
  }
  export(frame) { return exportTemplate(frame); }
  metrics() {
    const result = new Map();
    for (const frame of this.frames) for (const cell of leaves(frame.root)) for (const id of cell.nodes) {
      const node = this.graph.getNodeById(id);
      if (node) result.set(id, this.adapter.measure(node));
    }
    return result;
  }
  geometry() {
    for (const frame of this.frames) validateFrame(frame);
    const metrics = this.metrics();
    return this.frames.map(frame => ({ frame, ...layoutFrame(frame, metrics) }));
  }
  reflow() {
    for (const { placements } of this.geometry()) for (const placement of placements) {
      const node = this.graph.getNodeById(placement.nodeId);
      if (node) this.adapter.apply(node, placement);
    }
    this.graph?.setDirtyCanvas?.(true, true);
  }
  target(point) {
    for (const layout of this.geometry().reverse()) {
      const target = layout.cells.find(({ rect }) => contains(rect, point));
      if (target) return { frame: layout.frame, ...target };
    }
    return null;
  }
  drop(nodeIds, point, target) {
    return this.edit(() => {
      const resolved = target === undefined ? this.target(point) : target;
      const moving = new Set(nodeIds.map(String));
      const others = resolved?.cell.nodes.filter(id => !moving.has(String(id))) ?? [];
      const index = others.findIndex(id => {
        const node = this.graph.getNodeById(id);
        return node && point[1] < node.pos[1] + node.size[1] / 2;
      });
      dropNodes(this.frames, resolved?.frame.id ?? null, resolved?.cell.id ?? null, nodeIds, index === -1 ? others.length : index);
    });
  }
  snapshot() {
    return new Map((this.graph?._nodes ?? this.graph?.nodes ?? []).map(n => [n.id, { pos: [...n.pos], size: [...n.size] }]));
  }
  finishNativeDrag(before) {
    const moved = [], resized = [];
    for (const [id, previous] of before) {
      const node = this.graph.getNodeById(id);
      if (!node) continue;
      if (Math.abs(node.pos[0] - previous.pos[0]) > 1 || Math.abs(node.pos[1] - previous.pos[1]) > 1) moved.push(node);
      else if (Math.abs(node.size[0] - previous.size[0]) > 1 || Math.abs(node.size[1] - previous.size[1]) > 1) resized.push(node);
    }
    if (moved.length) {
      // Group nodes by destination so multi-selection can cross cell boundaries.
      const destinations = new Map();
      for (const node of moved) {
        const rect = [node.pos[0], node.pos[1], node.size[0], node.size[1]];
        const pick = pickCell(this.geometry(), rect);
        const key = pick?.cell.id ?? 'outside';
        // The node's own center anchors the insertion order; pickCell resolved
        // the destination (null = detach).
        if (!destinations.has(key)) destinations.set(key, { target: pick, point: [rect[0] + rect[2] / 2, rect[1] + rect[3] / 2], nodes: [] });
        destinations.get(key).nodes.push(node);
      }
      this.edit(() => {
        for (const { target, point, nodes } of destinations.values()) {
          nodes.sort((a, b) => a.pos[1] - b.pos[1]);
          this.drop(nodes.map(n => n.id), point, target);
        }
      });
    } else if (resized.length) this.edit(() => {});
  }
}
