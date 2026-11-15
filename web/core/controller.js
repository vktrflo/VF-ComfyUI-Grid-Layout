import {
  KEY,
  LEGACY_KEY,
  VERSION,
  createFrame,
  createCell,
  shrinkFrame,
  PAD,
  FRAME_TITLE,
  gridCell,
  contains,
  dropNodes,
  dropNodesIntoTab,
  dropNodesIntoExistingTab,
  insertColumnCell,
  insertRowCell,
  addBottomRow,
  applyIdePreset,
  exportTemplate,
  importTemplate,
  layoutFrame,
  leaves,
  pickCell,
  targetCellForNode,
  resolveDropTarget,
  validateFrame,
} from './layout.js';
import {
  BOTTOM_TAB_BAR_HEIGHT,
  GROUP_TAB_HEADER_HEIGHT,
  enableNodeBottomTabs,
  removeNodeBottomTabs,
  createStackFromSingleGroup,
  createStackFromSelection,
  addNodesOrGroupToStack,
  unpackTabStack,
  stackNodeIds,
  validateBottomTabsData,
  layoutTabStack,
} from './bottom-tabs.js';
import { NodeAdapter } from './adapter.js';

// Rollback copy taken on every pointer-down. Unlike a JSON round trip, it
// reuses string values, so embedded background images aren't re-encoded.
// Uses a WeakMap visited guard so circular references never overflow the stack.
function copy(value, seen = new WeakMap()) {
  if (Array.isArray(value)) {
    if (seen.has(value)) return seen.get(value);
    const out = [];
    seen.set(value, out);
    for (let i = 0; i < value.length; i++) out[i] = copy(value[i], seen);
    return out;
  }
  if (value && typeof value === 'object') {
    if (seen.has(value)) return seen.get(value);
    const out = {};
    seen.set(value, out);
    for (const [key, item] of Object.entries(value)) out[key] = copy(item, seen);
    return out;
  }
  return value;
}

export class LayoutController {
  constructor(app, options) {
    this.app = app;
    this.defaultColumns = options?.defaultColumns ?? 2;
    this.adapter = new NodeAdapter(app, options);
    this.transaction = null;
    this.pendingAutohide = new Set();
    this.peekedPortsNodes = new Map();
  }
  get graph() { return this.app.canvas.graph ?? this.app.graph; }
  get rawData() {
    const data = this.graph?.extra?.[KEY] ?? this.graph?.extra?.[LEGACY_KEY];
    return data?.version === VERSION ? data : null;
  }
  get frames() {
    const data = this.rawData;
    return Array.isArray(data?.frames) ? data.frames : [];
  }
  get nodeTabs() {
    const data = this.rawData;
    return data?.nodeTabs && typeof data.nodeTabs === 'object' && !Array.isArray(data.nodeTabs) ? data.nodeTabs : {};
  }
  get tabStacks() {
    const data = this.rawData;
    return Array.isArray(data?.tabStacks) ? data.tabStacks : [];
  }
  get hasBottomTabs() {
    return Boolean(this.tabStacks.length > 0 || Object.keys(this.nodeTabs).length > 0);
  }
  ensureData() {
    const graph = this.graph;
    if (!graph || this.app.configuringGraph) throw new Error('Wait until the workflow has finished loading.');
    graph.extra ??= {};
    if (graph.extra[KEY]) {
      if (graph.extra[KEY].version !== VERSION) throw new Error('This workflow uses an unsupported grid layout version.');
      graph.extra[KEY].frames ??= [];
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
    const extra = graph.extra ?? {};
    const hasKey = Object.prototype.hasOwnProperty.call(extra, KEY);
    const hasLegacy = Object.prototype.hasOwnProperty.call(extra, LEGACY_KEY);
    this.transaction = {
      graph,
      hasKey,
      hasLegacy,
      data: hasKey ? copy(extra[KEY]) : undefined,
      legacyData: hasLegacy ? copy(extra[LEGACY_KEY]) : undefined,
      nodes: this.snapshot(),
      groups: Array.isArray(graph._groups) ? [...graph._groups] : (Array.isArray(graph.groups) ? [...graph.groups] : null),
    };
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
        const extra = (this.transaction.graph.extra ??= {});
        if (this.transaction.hasKey) extra[KEY] = this.transaction.data;
        else delete extra[KEY];
        if (this.transaction.hasLegacy) extra[LEGACY_KEY] = this.transaction.legacyData;
        else delete extra[LEGACY_KEY];
        if (this.transaction.groups) {
          if (Array.isArray(this.transaction.graph._groups)) this.transaction.graph._groups = [...this.transaction.groups];
          else if (Array.isArray(this.transaction.graph.groups)) this.transaction.graph.groups = [...this.transaction.groups];
        }
        for (const [id, state] of this.transaction.nodes) {
          const node = this.transaction.graph.getNodeById(id);
          if (node) {
            if (state.mode !== undefined) node.mode = state.mode;
            this.adapter.apply(node, { x: state.pos[0], y: state.pos[1], width: state.size[0], height: state.size[1] });
          }
        }
      }
      throw error;
    } finally { if (own) this.end(); }
  }
  create(pos) {
    return this.edit(() => { const frame = createFrame(pos); this.pendingAutohide.add(frame.id); gridCell(frame, frame.root.id, 1, this.defaultColumns); this.ensureData().frames.push(frame); return frame; });
  }
  createPreset(pos, preset = 'vscode') {
    return this.edit(() => {
      const frame = createFrame(pos);
      delete frame.autohide;
      applyIdePreset(frame, preset, this.metrics());
      this.ensureData().frames.push(frame);
      return frame;
    });
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
  selectedCell(frame = this.selectedFrame()) {
    if (!frame) return null;
    const selectedIds = new Set(this.selectedNodes().map(node => String(node.id)));
    if (!selectedIds.size) return null;
    return leaves(frame.root).find(cell => cell.nodes.some(id => selectedIds.has(String(id)))) ?? null;
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
      const frame = createFrame([Math.min(...nodes.map(node=>node.pos[0]))-PAD*2, Math.min(...nodes.map(node=>node.pos[1]-this.adapter.classicTitle))-FRAME_TITLE-PAD*2]);
      // Group large selections into bounded split nodes accepted by serialization.
      const build = cells => {
        if (cells.length === 1) return cells[0];
        const groups = cells.length <= 16 ? cells : Array.from({length:Math.ceil(cells.length/16)},(_,i)=>build(cells.slice(i*16,(i+1)*16)));
        const root=createCell('');delete root.nodes;Object.assign(root,{axis:'x',children:groups,ratios:groups.map(()=>1/groups.length)});return root;
      };
      const cells=columns.map(column=>{const cell=createCell('');cell.nodes=column.nodes.sort((a,b)=>a.pos[1]-b.pos[1]||a.pos[0]-b.pos[0]).map(node=>node.id);return cell;});
      const moving=new Set(nodes.map(node=>String(node.id)));
      for (const oldFrame of this.frames) for (const cell of leaves(oldFrame.root)) {
        cell.nodes=cell.nodes.filter(id=>!moving.has(String(id)));
        if (Array.isArray(cell.tabs)) {
          for (const tab of cell.tabs) tab.nodes = (tab.nodes ?? []).filter(id => !moving.has(String(id)));
        }
      }
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
    this.edit(() => {
      const target = this.frames.find(f => f.id === frameId);
      if (target) {
        for (const cell of leaves(target.root)) {
          for (const id of cell.nodes) {
            const node = this.graph?.getNodeById(id);
            if (node) this.adapter.releaseDockedWidth?.(node);
          }
        }
      }
      this.ensureData().frames = this.frames.filter(f => f.id !== frameId);
    });
  }
  import(value, pos) {
    const frame = importTemplate(value, pos);
    this.pendingAutohide.add(frame.id);
    this.edit(() => this.ensureData().frames.push(frame));
    return frame;
  }
  export(frame) { return exportTemplate(frame); }
  // Ids of deleted nodes can linger in cells, so only live nodes count.
  hasNodes(frame) {
    return leaves(frame.root).some(cell => cell.nodes.some(id => this.graph?.getNodeById(id)));
  }
  measureNode(node) {
    const cfg = node?.id != null ? this.nodeTabs[String(node.id)] : null;
    if (cfg) {
      const overrideTabIndex = this.peekedPortsNodes.get(String(node.id));
      return this.adapter.measure(node, { nodeTabConfig: cfg, overrideTabIndex });
    }
    return this.adapter.measure(node);
  }
  metrics() {
    const result = new Map();
    const record = id => {
      const node = this.graph?.getNodeById?.(id);
      if (!node || result.has(node.id)) return;
      const m = this.measureNode(node);
      result.set(id, m);
      result.set(node.id, m);
      result.set(String(node.id), m);
    };
    for (const frame of this.frames) for (const cell of leaves(frame.root)) {
      const allIds = new Set([...(cell.nodes ?? []), ...(cell.tabs?.flatMap(t => t.nodes ?? []) ?? [])]);
      for (const id of allIds) record(id);
    }
    for (const stack of this.tabStacks) {
      for (const id of stackNodeIds(stack)) record(id);
    }
    for (const id of Object.keys(this.nodeTabs)) record(id);
    return result;
  }
  geometry() {
    for (const frame of this.frames) validateFrame(frame);
    const metrics = this.metrics();
    return this.frames.map(frame => ({ frame, ...layoutFrame(frame, metrics) }));
  }
  stackGeometry(precomputedMetrics = null) {
    const raw = this.rawData;
    if (raw && !this.app.configuringGraph) validateBottomTabsData(raw, this.graph);
    const stacks = this.tabStacks;
    if (!stacks.length) return [];
    const metrics = precomputedMetrics ?? this.metrics();
    const nodeTabs = this.nodeTabs;
    return stacks.map(stack => layoutTabStack(stack, metrics, nodeTabs, this.adapter.classicTitle)).filter(Boolean);
  }
  enableNodeTabs(nodeId) {
    const node = this.graph?.getNodeById?.(nodeId);
    if (!node) throw new Error('Node not found.');
    return this.edit(() => enableNodeBottomTabs(this.ensureData(), node));
  }
  removeNodeTabs(nodeId) {
    return this.edit(() => {
      const prev = removeNodeBottomTabs(this.ensureData(), nodeId);
      const node = this.graph?.getNodeById?.(nodeId);
      if (node) this.adapter.releaseTabHeight(node, prev?.originalHeight);
      return prev;
    });
  }
  tabifySingleGroup(group) {
    return this.edit(() => createStackFromSingleGroup(this.ensureData(), this.graph, group, this.adapter.classicTitle));
  }
  combineIntoBottomStack({ groups = [], nodes = [] } = {}) {
    return this.edit(() => createStackFromSelection(this.ensureData(), this.graph, { groups, nodes }, this.adapter.classicTitle));
  }
  unpackBottomStack(stackId) {
    return this.edit(() => {
      const target = this.tabStacks.find(s => s.id === stackId);
      const ids = target ? stackNodeIds(target) : [];
      const ok = unpackTabStack(this.ensureData(), this.graph, stackId, this.adapter.classicTitle);
      for (const id of ids) {
        const node = this.graph?.getNodeById?.(id);
        if (node) {
          this.adapter.releaseDockedWidth?.(node);
          if (!this.nodeTabs[String(id)]) this.adapter.releaseTabHeight?.(node);
        }
      }
      return ok;
    });
  }
  findStackForNode(nodeId) {
    const k = String(nodeId);
    for (const stack of this.tabStacks) {
      for (let i = 0; i < (stack.tabs?.length ?? 0); i++) {
        const tab = stack.tabs[i];
        if (tab.kind === 'node' && String(tab.nodeId) === k) return { stack, tab, tabIndex: i };
        if (tab.kind === 'group' && (tab.nodes ?? []).some(e => String(e.id) === k)) return { stack, tab, tabIndex: i };
      }
    }
    return null;
  }
  reflow() {
    // An empty autohidden grid could never be revealed, deleted, or dropped
    // into again, so autohide switches off as soon as the last node leaves.
    if (!this.app.configuringGraph) {
      for (const frame of this.frames) {
        if (this.hasNodes(frame)) this.pendingAutohide.delete(frame.id);
        else if (frame.autohide === true && !this.pendingAutohide.has(frame.id)) delete frame.autohide;
      }
      if (this.rawData) validateBottomTabsData(this.rawData, this.graph);
    }
    const dockedIds = new Set();
    for (const { placements } of this.geometry()) for (const placement of placements) {
      dockedIds.add(String(placement.nodeId));
      const node = this.graph.getNodeById(placement.nodeId);
      if (node) this.adapter.apply(node, placement);
    }
    const metrics = this.metrics();
    for (const { placements } of this.stackGeometry(metrics)) for (const placement of placements) {
      dockedIds.add(String(placement.nodeId));
      const node = this.graph.getNodeById(placement.nodeId);
      if (node) this.adapter.apply(node, placement);
    }
    // Standalone nodes with intra-node bottom section tabs
    for (const id of Object.keys(this.nodeTabs)) {
      if (dockedIds.has(String(id))) continue;
      const node = this.graph?.getNodeById?.(id);
      const m = node && (metrics.get(id) ?? metrics.get(node.id));
      if (node && m && !node.flags?.collapsed) {
        this.adapter.applyTabHeight(node, m.height);
      }
    }
    for (const node of this.graph?._nodes ?? this.graph?.nodes ?? []) {
      if (node && !dockedIds.has(String(node.id)) && this.adapter.imposedWidths?.has?.(node)) {
        this.adapter.releaseDockedWidth?.(node);
      }
    }
    this.graph?.setDirtyCanvas?.(true, true);
  }
  target(point) {
    for (const layout of this.geometry().reverse()) {
      if (layout.frame?.lock === true) continue;
      const target = layout.cells.find(({ cell, rect }) => cell?.collapsed !== true && contains(rect, point));
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
      // If nodes are being dropped into a Grid Frame cell/tab/row, detach them from any tabStacks
      if (resolved?.frame) {
        const movingSet = new Set(nodeIds.map(String));
        const raw = this.rawData;
        if (raw && Array.isArray(raw.tabStacks)) {
          for (const stack of raw.tabStacks) {
            stack.tabs = (stack.tabs ?? []).filter(t => {
              if (t.kind === 'node') return !movingSet.has(String(t.nodeId));
              if (t.kind === 'group') {
                t.nodes = (t.nodes ?? []).filter(e => !movingSet.has(String(e.id)));
                return t.nodes.length > 0;
              }
              return false;
            });
          }
          raw.tabStacks = raw.tabStacks.filter(s => s.tabs.length > 0);
          if (!raw.tabStacks.length) delete raw.tabStacks;
        }
      }
      const metrics = this.metrics();
      const nodeTitles = new Map();
      for (const id of nodeIds) {
        const node = this.graph.getNodeById(id);
        if (node) {
          const metric = { ...this.measureNode(node), width: node.size?.[0] ?? 0 };
          metrics.set(id, metric);
          metrics.set(node.id, metric);
          metrics.set(String(id), metric);
          metrics.set(String(node.id), metric);
          const title = String(node.title || node.type || `Node ${node.id}`).trim();
          nodeTitles.set(String(id), title);
          nodeTitles.set(String(node.id), title);
        }
      }
      if (resolved?.kind === 'split-left' || resolved?.kind === 'split-right') {
        insertColumnCell(this.frames, resolved.frame.id, resolved.cell.id, resolved.kind === 'split-left' ? 'left' : 'right', nodeIds, metrics);
        return;
      }
      if (resolved?.kind === 'split-top' || resolved?.kind === 'split-bottom') {
        insertRowCell(this.frames, resolved.frame.id, resolved.cell.id, resolved.kind === 'split-top' ? 'top' : 'bottom', nodeIds, metrics);
        return;
      }
      if (resolved?.kind === 'tab-into' && resolved?.frame && resolved?.cell) {
        dropNodesIntoExistingTab(this.frames, resolved.frame.id, resolved.cell.id, nodeIds, resolved.tabIndex, metrics);
        return;
      }
      if (resolved?.kind === 'tab' && resolved?.frame && resolved?.cell) {
        const firstExistingId = resolved.cell.nodes?.[0];
        const existingNode = firstExistingId != null ? this.graph?.getNodeById(firstExistingId) : null;
        const existingLabel = existingNode ? String(existingNode.title || existingNode.type || 'Tab 1').trim() : undefined;
        dropNodesIntoTab(this.frames, resolved.frame.id, resolved.cell.id, nodeIds, {
          tabIndex: resolved.tabIndex,
          nodeTitles,
          existingLabel,
          metrics,
        });
        return;
      }
      if (resolved?.kind === 'bottom-row') {
        const frame = this.frames.find(f => f.id === resolved.frame.id);
        if (!frame || frame.lock === true) return;
        const lockedIds = this.lockedNodeIds();
        const unlockedIds = nodeIds.filter(id => !lockedIds.has(String(id)));
        if (!unlockedIds.length) return;
        // Dragging the only node of the bottom row below the grid again must
        // not leave that row empty behind a second new row. Reuse the row.
        const moving = new Set(unlockedIds.map(String));
        const last = frame.root.axis === 'y' ? frame.root.children.at(-1) : null;
        const reusable = last && !last.children && last.nodes.every(id => moving.has(String(id)));
        if (!reusable) addBottomRow(frame);
        const bottomCell = frame.root.children?.at(-1);
        if (bottomCell) dropNodes(this.frames, frame.id, bottomCell.id, unlockedIds, 0, metrics);
        return;
      }
      const moving = new Set(nodeIds.map(String));
      const activeNodes = Array.isArray(resolved?.cell?.tabs) && resolved.cell.tabs.length
        ? (resolved.cell.tabs[resolved.cell.activeTab ?? 0]?.nodes ?? [])
        : (resolved?.cell?.nodes ?? []);
      const others = activeNodes.filter(id => !moving.has(String(id)));
      const index = Number.isInteger(resolved?.index)
        ? resolved.index
        : others.findIndex(id => {
            const node = this.graph.getNodeById(id);
            return node && point[1] < node.pos[1] + node.size[1] / 2;
          });
      dropNodes(this.frames, resolved?.frame.id ?? null, resolved?.cell?.id ?? null, nodeIds, index === -1 ? others.length : index, metrics);
    });
  }
  lockedNodeIds() {
    const ids = new Set();
    for (const frame of this.frames) {
      if (frame?.lock !== true) continue;
      for (const cell of leaves(frame.root)) {
        for (const id of cell.nodes ?? []) ids.add(String(id));
        for (const tab of cell.tabs ?? []) {
          for (const id of tab.nodes ?? []) ids.add(String(id));
        }
      }
    }
    return ids;
  }
  snapshot() {
    return new Map((this.graph?._nodes ?? this.graph?.nodes ?? []).map(n => [n.id, { pos: [...n.pos], size: [...n.size], mode: n.mode }]));
  }
  finishNativeDrag(before, pointer = null, options = {}) {
    const lockedIds = this.lockedNodeIds();
    const moved = [], resized = [], lockedMoved = [];
    for (const [id, previous] of before) {
      const node = this.graph.getNodeById(id);
      if (!node) continue;
      if (Math.abs(node.pos[0] - previous.pos[0]) > 1 || Math.abs(node.pos[1] - previous.pos[1]) > 1) {
        if (lockedIds.has(String(node.id))) lockedMoved.push(node);
        else moved.push(node);
      }
      else if (Math.abs(node.size[0] - previous.size[0]) > 1 || Math.abs(node.size[1] - previous.size[1]) > 1) resized.push(node);
    }

    // Handle drop onto an existing bottom tab bar (adds dragged node(s)/group as bottom tab(s))
    const bottomHit = options?.bottomBarHit ?? null;
    if (bottomHit && (moved.length > 0 || options?.draggedGroup)) {
      const draggedGroup = options?.draggedGroup ?? null;
      if (bottomHit.stackId) {
        const sameActiveOnly = !draggedGroup && moved.length === 1 && this.findStackForNode(moved[0].id)?.stack.id === bottomHit.stackId;
        if (!sameActiveOnly) {
          this.edit(() => {
            addNodesOrGroupToStack(this.ensureData(), this.graph, bottomHit.stackId, { nodes: moved, group: draggedGroup }, bottomHit.insertIndex, this.adapter.classicTitle);
          });
          return;
        }
      } else if (bottomHit.nodeId != null) {
        const hostNode = this.graph?.getNodeById?.(bottomHit.nodeId);
        const filteredMoved = moved.filter(n => String(n.id) !== String(bottomHit.nodeId));
        if (hostNode && (filteredMoved.length > 0 || draggedGroup)) {
          this.edit(() => {
            createStackFromSelection(
              this.ensureData(),
              this.graph,
              { groups: draggedGroup ? [draggedGroup] : [], nodes: [hostNode, ...filteredMoved] },
              this.adapter.classicTitle
            );
          });
          return;
        }
      }
    }

    if (moved.length) {
      // Group nodes by destination so multi-selection can cross cell boundaries.
      const destinations = new Map();
      const stackUpdates = [];
      const movingIds = moved.map(n => n.id);
      const layouts = this.geometry();
      for (const node of moved) {
        const rect = [node.pos[0], node.pos[1], node.size[0], node.size[1]];
        const pick = resolveDropTarget(layouts, rect, {
          excludeIds: movingIds,
          pointer: moved.length === 1 ? pointer : null,
          tabHit: moved.length === 1 ? (options?.tabHit ?? null) : null,
          titleHeight: this.adapter.classicTitle,
        });
        const stackOwner = this.findStackForNode(node.id);
        if (!pick && stackOwner) {
          const prev = before.get(node.id);
          stackUpdates.push({ node, prev, ...stackOwner });
          continue;
        }
        const key = pick ? `${pick.kind}:${pick.frame.id}:${pick.cell?.id ?? 'row'}:${pick.position ?? ''}:${pick.tabIndex ?? ''}` : 'outside';
        // The node's own center anchors the insertion order; resolveDropTarget
        // resolved the destination (null = detach).
        if (!destinations.has(key)) destinations.set(key, { target: pick, point: [rect[0] + rect[2] / 2, rect[1] + rect[3] / 2], nodes: [] });
        destinations.get(key).nodes.push(node);
      }
      this.edit(() => {
        if (stackUpdates.length) {
          const movedStacks = new Set();
          for (const { node, prev, stack, tab } of stackUpdates) {
            if (tab.kind === 'node') {
              stack.pos = [Math.round(node.pos[0]), Math.round(node.pos[1] - this.adapter.classicTitle)];
              movedStacks.add(stack.id);
            } else if (tab.kind === 'group') {
              const allTabNodesMoved = (tab.nodes ?? []).length > 1 && (tab.nodes ?? []).every(e => stackUpdates.some(u => String(u.node.id) === String(e.id)));
              if (allTabNodesMoved || tab.layoutMode === 'stack') {
                if (!movedStacks.has(stack.id) && prev) {
                  const dx = node.pos[0] - prev.pos[0];
                  const dy = node.pos[1] - prev.pos[1];
                  stack.pos = [Math.round(stack.pos[0] + dx), Math.round(stack.pos[1] + dy)];
                  movedStacks.add(stack.id);
                }
              } else {
                const entry = (tab.nodes ?? []).find(e => String(e.id) === String(node.id));
                if (entry) {
                  entry.offset = [
                    Math.max(10, Math.round(node.pos[0] - stack.pos[0])),
                    Math.max(GROUP_TAB_HEADER_HEIGHT + 10, Math.round((node.pos[1] - this.adapter.classicTitle) - stack.pos[1])),
                  ];
                }
              }
            }
          }
        }
        for (const { target, point, nodes } of destinations.values()) {
          nodes.sort((a, b) => a.pos[1] - b.pos[1]);
          this.drop(nodes.map(n => n.id), point, target);
        }
      });
    } else if (resized.length || lockedMoved.length) this.edit(() => {});
  }
}
