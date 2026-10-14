import { KEY, LEGACY_KEY, VERSION, createFrame, createCell, shrinkFrame, PAD, FRAME_TITLE, CELL_TITLE, gridCell, contains, dropNodes, exportTemplate, importTemplate, layoutFrame, leaves, pickCell, targetCellForNode, validateFrame } from './layout.js';
import { NodeAdapter } from './adapter.js';

// Rollback copy taken on every pointer-down. Unlike a JSON round trip, it
// reuses string values, so embedded background images aren't re-encoded.
function copy(value) {
  if (Array.isArray(value)) return value.map(copy);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]));
  return value;
}

export class LayoutController {
  constructor(app, options) {
    this.app = app;
    this.defaultColumns = options?.defaultColumns ?? 2;
    this.adapter = new NodeAdapter(app, options);
    this.transaction = null;
  }
  get graph() { return this.app.canvas.graph ?? this.app.graph; }
  get frames() {
    const data = this.graph?.extra?.[KEY] ?? this.graph?.extra?.[LEGACY_KEY];
    return data?.version === VERSION && Array.isArray(data.frames) ? data.frames : [];
  }
  ensureData() {
    const graph = this.graph;
    if (!graph || this.app.configuringGraph) throw new Error('Wait until the workflow has finished loading.');
    graph.extra ??= {};
    if (graph.extra[KEY]) {
      if (graph.extra[KEY].version !== VERSION) throw new Error('This workflow uses an unsupported grid layout version.');
      return graph.extra[KEY];
    }
    if (graph.extra[LEGACY_KEY]) {
      if (graph.extra[LEGACY_KEY].version !== VERSION) throw new Error('This workflow uses an unsupported grid layout version.');
      const legacy = graph.extra[LEGACY_KEY];
      delete graph.extra[LEGACY_KEY];
      return graph.extra[KEY] = { version: VERSION, frames: Array.isArray(legacy.frames) ? legacy.frames : [] };
    }
    return graph.extra[KEY] = { version: VERSION, frames: [] };
  }
  begin() {
    if (this.transaction) return false;
    this.ensureData();
    const graph = this.graph;
    this.transaction = { graph, extra: copy(graph.extra), nodes: this.snapshot() };
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
    return this.edit(() => { const frame = createFrame(pos); gridCell(frame, frame.root.id, 1, this.defaultColumns); this.ensureData().frames.push(frame); return frame; });
  }
  selectedNodes() {
    const selection = this.app.canvas.selected_nodes ?? {};
    const values = selection instanceof Map ? [...selection.values()] : selection instanceof Set ? [...selection] : Object.values(selection);
    return values.filter(node => node && this.graph.getNodeById(node.id) === node);
  }
  selectedFrame() {
    const selectedIds = new Set(this.selectedNodes().map(node => String(node.id)));
    if (!selectedIds.size) return null;
    for (const frame of [...this.frames].reverse()) {
      for (const cell of leaves(frame.root)) {
        if (cell.nodes.some(id => selectedIds.has(String(id)))) return frame;
      }
    }
    return null;
  }
  createFromNodes(ids, arrangement = 'columns') {
    if (!['columns','stack'].includes(arrangement)) throw new Error('Choose columns or a single stack.');
    const nodes = [...new Set(ids.map(String))].map(id => this.graph.getNodeById(id)).filter(Boolean);
    if (!nodes.length) throw new Error('Select at least one node first.');
    const columns = [];
    for (const node of [...nodes].sort((a,b) => a.pos[0]-b.pos[0] || a.pos[1]-b.pos[1])) {
      const column = arrangement === 'stack' ? columns[0] : columns.find(column => Math.abs(node.pos[0]-column.x) <= Math.max(48, Math.min(node.size[0],column.width)*0.35));
      if (column) { column.width = Math.max(column.width, node.size[0]); column.nodes.push(node); }
      else columns.push({x:node.pos[0],width:node.size[0],nodes:[node]});
    }
    if (columns.length > 256) throw new Error('A grid supports up to 256 columns.');
    return this.edit(() => {
      const frame = createFrame([Math.min(...nodes.map(node=>node.pos[0]))-PAD*2, Math.min(...nodes.map(node=>node.pos[1]-this.adapter.classicTitle))-FRAME_TITLE-PAD*2-CELL_TITLE]);
      // Group large selections into bounded split nodes accepted by serialization.
      const build = cells => {
        if (cells.length === 1) return cells[0];
        const groups = cells.length <= 16 ? cells : Array.from({length:Math.ceil(cells.length/16)},(_,i)=>build(cells.slice(i*16,(i+1)*16)));
        const root=createCell('');delete root.nodes;Object.assign(root,{axis:'x',children:groups,ratios:groups.map(()=>1/groups.length)});return root;
      };
      const cells=columns.map(column=>{const cell=createCell('');cell.nodes=column.nodes.sort((a,b)=>a.pos[1]-b.pos[1]||a.pos[0]-b.pos[0]).map(node=>node.id);return cell;});
      const moving=new Set(nodes.map(node=>String(node.id)));
      for (const oldFrame of this.frames) for (const cell of leaves(oldFrame.root)) cell.nodes=cell.nodes.filter(id=>!moving.has(String(id)));
      frame.root=build(cells);this.ensureData().frames.push(frame);
      const metrics = this.metrics();
      for (const node of nodes) {
        const metric = metrics.get(node.id);
        if (metric) metrics.set(node.id, { ...metric, minWidth: Math.max(metric.minWidth, node.size?.[0] || 0) });
      }
      shrinkFrame(frame,metrics);
      return frame;
    });
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
      if (layout.frame?.lock === true) continue;
      const target = layout.cells.find(({ rect }) => contains(rect, point));
      if (target) return { frame: layout.frame, ...target };
    }
    return null;
  }
  targetNode(node, options) {
    return targetCellForNode(this.geometry(), node, options);
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
      const metrics = this.metrics();
      for (const id of nodeIds) {
        const node = this.graph.getNodeById(id);
        if (node) {
          const metric = this.adapter.measure(node);
          metrics.set(id, metric);
          metrics.set(node.id, metric);
        }
      }
      dropNodes(this.frames, resolved?.frame.id ?? null, resolved?.cell.id ?? null, nodeIds, index === -1 ? others.length : index, metrics);
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
