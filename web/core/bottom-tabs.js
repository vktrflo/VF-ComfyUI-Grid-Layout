import { normalizeColor, removeNodeFromCell, leaves } from './layout.js';

export const BOTTOM_TAB_BAR_HEIGHT = 28;
export const GROUP_TAB_HEADER_HEIGHT = 28;
const MAX_TABS = 32;
const GROUP_PAD = 10;
const NODE_GAP = 10;

let fallbackSeq = 0;
function uid(prefix = 'btab') {
  if (typeof globalThis.crypto?.randomUUID === 'function') return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${++fallbackSeq}-${Math.random().toString(36).slice(2, 8)}`;
}

const PREVIEW_NODE_TYPES = /^(LoadImage|LoadImageMask|PreviewImage|SaveImage|VHS_LoadVideo|VHS_LoadVideoPath|VHS_VideoCombine|VF_LoadImage|VF_LoadVideo|VFLoadImage|VFLoadVideo)$/i;
const PREVIEW_TYPE_RE = /preview|crop|video|audio|image_viewer|canvas|player|waveform|media/i;
const TEXT_WIDGET_TYPES = new Set(['customtext', 'string', 'text', 'markdown', 'code']);

export function isPreviewWidget(widget) {
  if (!widget) return false;
  const wType = String(widget.type ?? '').toLowerCase();
  const wName = String(widget.name ?? '');
  if (TEXT_WIDGET_TYPES.has(wType)) return false;
  if (['number', 'combo', 'toggle', 'boolean', 'button', 'slider', 'seed'].includes(wType)) return false;
  const el = widget.element ?? widget.inputEl;
  if (el?.tagName === 'TEXTAREA' || el?.tagName === 'INPUT' || el?.tagName === 'SELECT') return false;
  if (PREVIEW_TYPE_RE.test(wType) || PREVIEW_TYPE_RE.test(wName)) return true;
  if (el && typeof el.querySelector === 'function') {
    if (el.querySelector('canvas,video,audio,img')) return true;
  }
  const computedH = Array.isArray(widget.computeSize?.(240)) ? widget.computeSize(240)[1] : 0;
  if ((wType === 'custom' || wType === 'dom' || wType === 'html' || el) && computedH > 84) return true;
  return false;
}

export function nodeHasIntrinsicPreview(node) {
  if (!node) return false;
  if (Array.isArray(node.imgs) && node.imgs.length > 0) return true;
  const nType = String(node.type || node.comfyClass || '');
  const nTitle = String(node.title || '');
  if (PREVIEW_NODE_TYPES.test(nType) || /load\s*(image|video)|preview\s*(image|video)|video\s*combine/i.test(nType) || /load\s*(image|video)/i.test(nTitle)) {
    return true;
  }
  if (typeof globalThis.document !== 'undefined' && node.id != null) {
    const domNode = globalThis.document.querySelector?.(`.lg-node[data-node-id="${String(node.id)}"]`);
    if (domNode?.querySelector?.('canvas,video,[data-testid*="preview"],.node-preview,img:not(.vf-brand-link img)')) {
      return true;
    }
  }
  return false;
}

export function classifyNodeSections(node) {
  const hasPorts = Boolean((node?.inputs?.length ?? 0) > 0 || (node?.outputs?.length ?? 0) > 0);
  const standardWidgets = [];
  const previewWidgets = [];
  for (const w of node?.widgets ?? []) {
    if (!w || w.hidden === true || String(w.type ?? '') === 'converted-widget') continue;
    const name = String(w.name ?? '');
    if (!name) continue;
    if (isPreviewWidget(w)) previewWidgets.push(name);
    else standardWidgets.push(name);
  }
  const hasPreview = previewWidgets.length > 0 || nodeHasIntrinsicPreview(node);
  return { hasPorts, standardWidgets, previewWidgets, hasPreview };
}

export function createAutoNodeTabs(node) {
  const { hasPorts, standardWidgets, previewWidgets, hasPreview } = classifyNodeSections(node);
  const tabs = [];
  if (hasPorts) {
    tabs.push({
      id: uid('ntab'),
      label: 'Ports',
      icon: '🔌',
      includePorts: true,
      widgets: [],
      includePreview: false,
    });
  }
  if (standardWidgets.length > 0) {
    tabs.push({
      id: uid('ntab'),
      label: 'Widgets',
      icon: '🎛️',
      includePorts: false,
      widgets: [...standardWidgets],
      includePreview: false,
    });
  }
  if (hasPreview) {
    tabs.push({
      id: uid('ntab'),
      label: 'Preview',
      icon: '🖼️',
      includePorts: false,
      widgets: [...previewWidgets],
      includePreview: true,
    });
  }
  if (!tabs.length) {
    tabs.push({
      id: uid('ntab'),
      label: 'Main',
      icon: '📄',
      includePorts: true,
      widgets: [],
      includePreview: true,
    });
  }
  const previewIdx = tabs.findIndex(t => t.includePreview);
  const widgetsIdx = tabs.findIndex(t => t.widgets.length > 0);
  const activeTab = previewIdx !== -1 ? previewIdx : (widgetsIdx !== -1 ? widgetsIdx : 0);
  return {
    activeTab,
    sizing: 'max',
    tabs,
  };
}

export function syncNodeTabConfig(config, node = null) {
  if (!config || typeof config !== 'object' || !Array.isArray(config.tabs) || !config.tabs.length) return null;
  const cleanTabs = [];
  const assignedWidgets = new Set();
  for (const raw of config.tabs.slice(0, MAX_TABS)) {
    if (!raw || typeof raw !== 'object') continue;
    const widgets = [];
    for (const w of Array.isArray(raw.widgets) ? raw.widgets : []) {
      const name = String(w ?? '').trim();
      if (name && !assignedWidgets.has(name)) {
        assignedWidgets.add(name);
        widgets.push(name);
      }
    }
    const tab = {
      id: typeof raw.id === 'string' && raw.id ? raw.id : uid('ntab'),
      label: String(raw.label ?? 'Tab').trim().slice(0, 120) || 'Tab',
      includePorts: Boolean(raw.includePorts),
      widgets,
      includePreview: Boolean(raw.includePreview),
    };
    if (typeof raw.icon === 'string' && raw.icon.trim()) {
      tab.icon = raw.icon.trim().slice(0, 16);
    }
    cleanTabs.push(tab);
  }
  if (!cleanTabs.length) return null;

  // Ensure any newly created dynamic widgets on a live node are not orphaned
  if (node?.widgets?.length) {
    const liveNames = new Set();
    for (const w of node.widgets) {
      if (!w || w.hidden === true || String(w.type ?? '') === 'converted-widget') continue;
      const name = String(w.name ?? '').trim();
      if (!name) continue;
      liveNames.add(name);
      if (!assignedWidgets.has(name)) {
        assignedWidgets.add(name);
        if (isPreviewWidget(w)) {
          const prevTab = cleanTabs.find(t => t.includePreview) ?? cleanTabs.at(-1);
          prevTab.widgets.push(name);
        } else {
          const widTab = cleanTabs.find(t => t.widgets.length > 0 && !t.includePreview) ?? cleanTabs[0];
          widTab.widgets.push(name);
        }
      }
    }
  }

  config.tabs = cleanTabs;
  config.sizing = config.sizing === 'compact' ? 'compact' : 'max';
  const idx = Number.isInteger(config.activeTab) ? config.activeTab : 0;
  config.activeTab = Math.max(0, Math.min(cleanTabs.length - 1, idx));
  return config;
}

export function estimateNodeSectionBreakdown(node, baseBodyHeight = null, sectionMeasurements = null) {
  const slotCount = Math.max(node?.inputs?.length ?? 0, node?.outputs?.length ?? 0);
  const portsH = sectionMeasurements?.portsHeight ?? (slotCount > 0 ? slotCount * 20 + 8 : 0);

  const widgetHeights = new Map();
  let totalStdWidgetH = 0;
  let totalPreviewWidgetH = 0;
  const width = node?.size?.[0] ?? 260;

  for (const w of node?.widgets ?? []) {
    if (!w || w.hidden === true || String(w.type ?? '') === 'converted-widget') continue;
    const name = String(w.name ?? '').trim();
    if (!name) continue;
    let h = sectionMeasurements?.widgets?.get?.(name);
    if (!Number.isFinite(h) || h <= 0) {
      const cs = w.computeSize?.(width);
      if (Array.isArray(cs) && Number.isFinite(cs[1]) && cs[1] > 0) {
        h = cs[1] + 4;
      } else if (isPreviewWidget(w)) {
        h = 180;
      } else if (String(w.type ?? '').toLowerCase() === 'customtext' || w.element?.tagName === 'TEXTAREA' || w.inputEl?.tagName === 'TEXTAREA') {
        h = 96;
      } else {
        h = 30;
      }
    }
    widgetHeights.set(name, h);
    if (isPreviewWidget(w)) totalPreviewWidgetH += h;
    else totalStdWidgetH += h;
  }

  const rawBody = Number.isFinite(baseBodyHeight) && baseBodyHeight > 0
    ? baseBodyHeight
    : (node?.size?.[1] ?? 140);
  const hasIntrinsicPrev = nodeHasIntrinsicPreview(node) && totalPreviewWidgetH === 0;
  let intrinsicPreviewH = sectionMeasurements?.previewHeight;
  if (!Number.isFinite(intrinsicPreviewH) || intrinsicPreviewH <= 0) {
    if (hasIntrinsicPrev) {
      const remainder = rawBody - portsH - totalStdWidgetH - 12;
      intrinsicPreviewH = Math.max(150, remainder);
    } else {
      intrinsicPreviewH = 0;
    }
  }

  const footerBadgeH = sectionMeasurements?.footerHeight ?? 0;
  return { portsH, widgetHeights, intrinsicPreviewH, footerBadgeH };
}

export function computeNodeTabBodyHeights(node, config, options = {}) {
  const synced = syncNodeTabConfig(config, node);
  if (!synced) return { heights: [], activeHeight: node?.size?.[1] ?? 100, maxHeight: node?.size?.[1] ?? 100 };
  const { portsH, widgetHeights, intrinsicPreviewH, footerBadgeH } = estimateNodeSectionBreakdown(
    node,
    options.baseBodyHeight,
    options.sectionMeasurements
  );
  const pad = 12 + footerBadgeH;
  const heights = synced.tabs.map(tab => {
    let h = pad;
    if (tab.includePorts) h += portsH;
    for (const wName of tab.widgets) {
      h += widgetHeights.get(wName) ?? 30;
    }
    if (tab.includePreview) {
      h += intrinsicPreviewH;
    }
    return Math.max(48, Math.round(h));
  });
  const maxHeight = Math.max(48, ...heights);
  const effectiveIdx = Number.isInteger(options.overrideTabIndex)
    ? Math.max(0, Math.min(heights.length - 1, options.overrideTabIndex))
    : synced.activeTab;
  const activeHeight = heights[effectiveIdx] ?? maxHeight;
  return {
    heights,
    activeHeight,
    maxHeight,
    effectiveHeight: synced.sizing === 'compact' ? activeHeight : maxHeight,
  };
}

// ---------------- INTRA-NODE MUTATION HELPERS ----------------

export function enableNodeBottomTabs(data, node) {
  if (!data || !node || node.id == null) return null;
  data.nodeTabs ??= {};
  const key = String(node.id);
  const created = createAutoNodeTabs(node);
  if (Array.isArray(node.size) && Number.isFinite(node.size[1]) && node.size[1] > 0) {
    created.originalHeight = node.size[1];
  }
  data.nodeTabs[key] = created;
  return created;
}

export function removeNodeBottomTabs(data, nodeId) {
  if (!data?.nodeTabs || nodeId == null) return null;
  const key = String(nodeId);
  const prev = data.nodeTabs[key] ?? null;
  delete data.nodeTabs[key];
  return prev;
}

export function selectNodeBottomTab(data, nodeId, tabIndex) {
  const cfg = data?.nodeTabs?.[String(nodeId)];
  if (!cfg || !Array.isArray(cfg.tabs) || !cfg.tabs.length) return false;
  cfg.activeTab = Math.max(0, Math.min(cfg.tabs.length - 1, Number(tabIndex) || 0));
  return true;
}

export function renameNodeBottomTab(data, nodeId, tabIndex, label) {
  const cfg = data?.nodeTabs?.[String(nodeId)];
  const tab = cfg?.tabs?.[tabIndex];
  const clean = String(label ?? '').trim().slice(0, 120);
  if (!tab || !clean) return false;
  tab.label = clean;
  return true;
}

export function mergeNodeBottomTabs(data, nodeId, sourceIdx, targetIdx) {
  const cfg = data?.nodeTabs?.[String(nodeId)];
  if (!cfg || !Array.isArray(cfg.tabs) || cfg.tabs.length <= 1) return false;
  if (sourceIdx === targetIdx || !cfg.tabs[sourceIdx] || !cfg.tabs[targetIdx]) return false;
  const src = cfg.tabs[sourceIdx];
  const dst = cfg.tabs[targetIdx];
  dst.label = `${dst.label} + ${src.label}`.slice(0, 120);
  dst.includePorts = Boolean(dst.includePorts || src.includePorts);
  dst.includePreview = Boolean(dst.includePreview || src.includePreview);
  for (const w of src.widgets ?? []) {
    if (!dst.widgets.includes(w)) dst.widgets.push(w);
  }
  const targetId = dst.id;
  cfg.tabs.splice(sourceIdx, 1);
  const newIdx = cfg.tabs.findIndex(t => t.id === targetId);
  cfg.activeTab = newIdx !== -1 ? newIdx : 0;
  return true;
}

export function reorderNodeBottomTab(data, nodeId, fromIdx, toIdx) {
  const cfg = data?.nodeTabs?.[String(nodeId)];
  if (!cfg || !Array.isArray(cfg.tabs) || fromIdx === toIdx) return false;
  if (fromIdx < 0 || fromIdx >= cfg.tabs.length) return false;
  const clampedTo = Math.max(0, Math.min(cfg.tabs.length - 1, toIdx));
  const [moved] = cfg.tabs.splice(fromIdx, 1);
  cfg.tabs.splice(clampedTo, 0, moved);
  cfg.activeTab = clampedTo;
  return true;
}

export function addCustomNodeBottomTab(data, nodeId, label = 'Custom', icon = '✨') {
  const cfg = data?.nodeTabs?.[String(nodeId)];
  if (!cfg || !Array.isArray(cfg.tabs) || cfg.tabs.length >= MAX_TABS) return null;
  const tab = {
    id: uid('ntab'),
    label: String(label || 'Custom').trim().slice(0, 120) || 'Custom',
    icon: String(icon || '').trim().slice(0, 16) || undefined,
    includePorts: false,
    widgets: [],
    includePreview: false,
  };
  cfg.tabs.push(tab);
  cfg.activeTab = cfg.tabs.length - 1;
  return tab;
}

export function removeSingleNodeBottomTab(data, nodeId, tabIndex) {
  const cfg = data?.nodeTabs?.[String(nodeId)];
  if (!cfg || !Array.isArray(cfg.tabs) || cfg.tabs.length <= 1) return false;
  const [removed] = cfg.tabs.splice(tabIndex, 1);
  if (!removed) return false;
  const fallback = cfg.tabs[0];
  if (removed.includePorts && !cfg.tabs.some(t => t.includePorts)) fallback.includePorts = true;
  if (removed.includePreview && !cfg.tabs.some(t => t.includePreview)) fallback.includePreview = true;
  for (const w of removed.widgets ?? []) {
    if (!cfg.tabs.some(t => t.widgets.includes(w))) fallback.widgets.push(w);
  }
  cfg.activeTab = Math.max(0, Math.min(cfg.tabs.length - 1, cfg.activeTab));
  return true;
}

export function assignWidgetToNodeTab(data, nodeId, widgetName, targetTabIndex) {
  const cfg = data?.nodeTabs?.[String(nodeId)];
  if (!cfg || !Array.isArray(cfg.tabs) || !cfg.tabs[targetTabIndex]) return false;
  const name = String(widgetName ?? '').trim();
  if (!name) return false;
  for (const tab of cfg.tabs) {
    tab.widgets = (tab.widgets ?? []).filter(w => w !== name);
  }
  cfg.tabs[targetTabIndex].widgets.push(name);
  return true;
}

export function setNodeTabsSizing(data, nodeId, sizing) {
  const cfg = data?.nodeTabs?.[String(nodeId)];
  if (!cfg) return false;
  cfg.sizing = sizing === 'compact' ? 'compact' : 'max';
  return true;
}

// ---------------- COMFYUI GROUPS & MULTI-NODE STACKS ----------------

export function getGroupBounds(group) {
  if (!group) return null;
  const b = group._bounding ?? group.bounding;
  if (b && b.length >= 4 && Number.isFinite(b[0]) && Number.isFinite(b[1]) && Number.isFinite(b[2]) && Number.isFinite(b[3])) {
    return [Number(b[0]), Number(b[1]), Number(b[2]), Number(b[3])];
  }
  if (Array.isArray(group.pos) && Array.isArray(group.size) && group.pos.length >= 2 && group.size.length >= 2) {
    return [Number(group.pos[0]), Number(group.pos[1]), Number(group.size[0]), Number(group.size[1])];
  }
  return null;
}

export function getGraphGroups(graph) {
  return graph?._groups ?? graph?.groups ?? [];
}

export function getGroupMemberNodes(graph, group, titleHeight = 30) {
  if (!graph || !group) return [];
  if (typeof group.recomputeInsideNodes === 'function') {
    try { group.recomputeInsideNodes(); } catch {}
  }
  const direct = group._nodes ?? group.nodes;
  if (Array.isArray(direct) && direct.length > 0) {
    const live = direct.filter(n => n && graph.getNodeById?.(n.id) === n);
    if (live.length > 0) return live;
  }
  const bounds = getGroupBounds(group);
  if (!bounds) return [];
  const [gx, gy, gw, gh] = bounds;
  const allNodes = graph._nodes ?? graph.nodes ?? [];
  return allNodes.filter(node => {
    if (!node?.pos || !node?.size) return false;
    const cx = node.pos[0] + node.size[0] / 2;
    const topY = node.pos[1] - titleHeight;
    const cy = topY + (node.size[1] + titleHeight) / 2;
    return cx >= gx && cx <= gx + gw && cy >= gy && cy <= gy + gh;
  });
}

export function snapshotGroup(group) {
  const bounds = getGroupBounds(group) ?? [0, 0, 320, 240];
  return {
    title: String(group?.title ?? 'Group').slice(0, 120) || 'Group',
    color: normalizeColor(group?.color) ?? '#3f789e',
    fontSize: Number.isFinite(group?.font_size) ? Number(group.font_size) : 24,
    bounding: [...bounds],
  };
}

export function removeNativeGroup(graph, group) {
  if (!graph || !group) return;
  if (typeof graph.remove === 'function') {
    try {
      graph.remove(group);
      if (!getGraphGroups(graph).includes(group)) return;
    } catch {}
  }
  for (const list of [graph._groups, graph.groups]) {
    if (Array.isArray(list)) {
      const idx = list.indexOf(group);
      if (idx !== -1) list.splice(idx, 1);
    }
  }
}

export function restoreNativeGroup(graph, snapshot, overrideBounds = null) {
  if (!graph || !snapshot) return null;
  const bounds = overrideBounds ?? snapshot.bounding ?? [100, 100, 320, 240];
  const GroupCtor = globalThis.LGraphGroup ?? globalThis.LiteGraph?.LGraphGroup ?? globalThis.comfyAPI?.litegraph?.LGraphGroup;
  let group;
  if (typeof GroupCtor === 'function') {
    group = new GroupCtor(snapshot.title || 'Group');
    group.title = snapshot.title || 'Group';
    if (snapshot.color) group.color = snapshot.color;
    if (Number.isFinite(snapshot.fontSize)) group.font_size = snapshot.fontSize;
    if (group._bounding && group._bounding.length >= 4) {
      group._bounding[0] = bounds[0];
      group._bounding[1] = bounds[1];
      group._bounding[2] = bounds[2];
      group._bounding[3] = bounds[3];
    } else {
      group.pos = [bounds[0], bounds[1]];
      group.size = [bounds[2], bounds[3]];
      group._bounding = Float32Array.from(bounds);
    }
    if (typeof graph.add === 'function') {
      graph.add(group);
      return group;
    }
  } else {
    group = {
      title: snapshot.title || 'Group',
      color: snapshot.color || '#3f789e',
      font_size: snapshot.fontSize ?? 24,
      pos: [bounds[0], bounds[1]],
      size: [bounds[2], bounds[3]],
      _bounding: [...bounds],
    };
  }
  if (Array.isArray(graph._groups)) graph._groups.push(group);
  else if (Array.isArray(graph.groups)) graph.groups.push(group);
  else graph._groups = [group];
  return group;
}

function detachNodesFromContainers(data, movingIds) {
  if (!data || !movingIds.size) return;
  for (const frame of data.frames ?? []) {
    for (const cell of leaves(frame.root)) {
      removeNodeFromCell(cell, movingIds);
    }
  }
  if (Array.isArray(data.tabStacks)) {
    for (const stack of data.tabStacks) {
      stack.tabs = (stack.tabs ?? []).filter(tab => {
        if (tab.kind === 'node') return !movingIds.has(String(tab.nodeId));
        if (tab.kind === 'group') {
          tab.nodes = (tab.nodes ?? []).filter(entry => !movingIds.has(String(entry.id)));
          return tab.nodes.length > 0;
        }
        return false;
      });
    }
    data.tabStacks = data.tabStacks.filter(s => Array.isArray(s.tabs) && s.tabs.length > 0);
  }
}

export function buildGroupTabPage(group, memberNodes, titleHeight = 30) {
  const snap = snapshotGroup(group);
  const [gx, gy] = snap.bounding;
  const sorted = [...memberNodes].sort((a, b) => a.pos[1] - b.pos[1] || a.pos[0] - b.pos[0]);
  const minX = Math.min(...sorted.map(n => n.pos[0]));
  const minTopY = Math.min(...sorted.map(n => n.pos[1] - titleHeight));
  const baseX = Math.min(gx, minX - GROUP_PAD);
  const baseY = Math.min(gy, minTopY - GROUP_TAB_HEADER_HEIGHT - GROUP_PAD);

  const entries = sorted.map(n => ({
    id: n.id,
    offset: [
      Math.max(GROUP_PAD, Math.round(n.pos[0] - baseX)),
      Math.max(GROUP_TAB_HEADER_HEIGHT + GROUP_PAD, Math.round((n.pos[1] - titleHeight) - baseY)),
    ],
    size: [Math.round(n.size?.[0] || 220), Math.round(n.size?.[1] || 100)],
  }));

  return {
    id: uid('gtab'),
    kind: 'group',
    label: snap.title,
    color: snap.color,
    layoutMode: 'relative',
    nodes: entries,
    groupSnapshot: snap,
  };
}

export function createStackFromSingleGroup(data, graph, group, titleHeight = 30) {
  if (!data || !graph || !group) return null;
  const members = getGroupMemberNodes(graph, group, titleHeight);
  if (!members.length) throw new Error('This ComfyUI Group has no nodes inside it.');
  const sorted = [...members].sort((a, b) => a.pos[1] - b.pos[1] || a.pos[0] - b.pos[0]);
  const snap = snapshotGroup(group);
  const movingIds = new Set(sorted.map(n => String(n.id)));
  detachNodesFromContainers(data, movingIds);
  removeNativeGroup(graph, group);

  const pos = [
    Math.round(Math.min(...sorted.map(n => n.pos[0]))),
    Math.round(Math.min(...sorted.map(n => n.pos[1] - titleHeight))),
  ];
  const stack = {
    id: uid('stack'),
    pos,
    size: [Math.max(220, ...sorted.map(n => n.size?.[0] || 220)), 200],
    sizing: 'max',
    activeTab: 0,
    originGroupSnapshot: snap,
    tabs: sorted.map(node => ({
      id: uid('ptab'),
      kind: 'node',
      label: String(node.title || node.type || `Node ${node.id}`).trim().slice(0, 120),
      color: snap.color,
      nodeId: node.id,
    })),
  };
  data.tabStacks ??= [];
  data.tabStacks.push(stack);
  return stack;
}

export function createStackFromSelection(data, graph, { groups = [], nodes = [] } = {}, titleHeight = 30) {
  if (!data || !graph) return null;
  const tabs = [];
  const claimedIds = new Set();
  const consumedGroups = [];
  let anchorX = Infinity;
  let anchorY = Infinity;

  for (const group of groups) {
    const members = getGroupMemberNodes(graph, group, titleHeight);
    if (!members.length) continue;
    const bounds = getGroupBounds(group);
    if (bounds) {
      anchorX = Math.min(anchorX, bounds[0]);
      anchorY = Math.min(anchorY, bounds[1]);
    }
    for (const m of members) claimedIds.add(String(m.id));
    tabs.push(buildGroupTabPage(group, members, titleHeight));
    consumedGroups.push(group);
  }

  const standaloneNodes = nodes
    .filter(n => n && !claimedIds.has(String(n.id)))
    .sort((a, b) => a.pos[1] - b.pos[1] || a.pos[0] - b.pos[0]);

  for (const node of standaloneNodes) {
    claimedIds.add(String(node.id));
    anchorX = Math.min(anchorX, node.pos[0]);
    anchorY = Math.min(anchorY, node.pos[1] - titleHeight);
    tabs.push({
      id: uid('ptab'),
      kind: 'node',
      label: String(node.title || node.type || `Node ${node.id}`).trim().slice(0, 120),
      nodeId: node.id,
    });
  }

  if (!tabs.length) throw new Error('Select at least two nodes or ComfyUI Groups to combine.');

  detachNodesFromContainers(data, claimedIds);
  for (const g of consumedGroups) removeNativeGroup(graph, g);

  const stack = {
    id: uid('stack'),
    pos: [
      Number.isFinite(anchorX) ? Math.round(anchorX) : 100,
      Number.isFinite(anchorY) ? Math.round(anchorY) : 100,
    ],
    size: [320, 240],
    sizing: 'max',
    activeTab: 0,
    tabs,
  };
  data.tabStacks ??= [];
  data.tabStacks.push(stack);
  return stack;
}

export function stackNodeIds(stack) {
  const out = [];
  for (const tab of stack?.tabs ?? []) {
    if (tab.kind === 'node' && tab.nodeId != null) out.push(tab.nodeId);
    else if (tab.kind === 'group') {
      for (const entry of tab.nodes ?? []) {
        if (entry?.id != null) out.push(entry.id);
      }
    }
  }
  return out;
}

export function validateBottomTabsData(data, graph = null) {
  if (!data || typeof data !== 'object') return;
  if (data.nodeTabs && typeof data.nodeTabs === 'object' && !Array.isArray(data.nodeTabs)) {
    for (const [key, cfg] of Object.entries(data.nodeTabs)) {
      const node = graph?.getNodeById ? graph.getNodeById(key) : true;
      if (!node) {
        delete data.nodeTabs[key];
        continue;
      }
      const synced = syncNodeTabConfig(cfg, typeof node === 'object' ? node : null);
      if (!synced) delete data.nodeTabs[key];
    }
    if (!Object.keys(data.nodeTabs).length) delete data.nodeTabs;
  } else {
    delete data.nodeTabs;
  }

  if (Array.isArray(data.tabStacks)) {
    const cleanStacks = [];
    const seenNodes = new Set();
    for (const raw of data.tabStacks) {
      if (!raw || typeof raw !== 'object' || !Array.isArray(raw.tabs)) continue;
      const pos = Array.isArray(raw.pos) && raw.pos.length >= 2 && Number.isFinite(raw.pos[0]) && Number.isFinite(raw.pos[1])
        ? [Number(raw.pos[0]), Number(raw.pos[1])]
        : [100, 100];
      const size = Array.isArray(raw.size) && raw.size.length >= 2 && Number.isFinite(raw.size[0]) && Number.isFinite(raw.size[1])
        ? [Math.max(160, Number(raw.size[0])), Math.max(60, Number(raw.size[1]))]
        : [260, 180];
      const tabs = [];
      for (const t of raw.tabs.slice(0, MAX_TABS)) {
        if (!t || typeof t !== 'object') continue;
        if (t.kind === 'node') {
          if (t.nodeId == null) continue;
          const k = String(t.nodeId);
          if (seenNodes.has(k)) continue;
          if (graph?.getNodeById && !graph.getNodeById(t.nodeId)) continue;
          seenNodes.add(k);
          t.id = typeof t.id === 'string' && t.id ? t.id : uid('ptab');
          t.label = String(t.label ?? 'Node').trim().slice(0, 120) || 'Node';
          const col = normalizeColor(t.color);
          if (col) t.color = col;
          else delete t.color;
          if (typeof t.icon === 'string' && t.icon.trim()) t.icon = t.icon.trim().slice(0, 16);
          else delete t.icon;
          tabs.push(t);
        } else if (t.kind === 'group') {
          const entries = [];
          for (const e of Array.isArray(t.nodes) ? t.nodes : []) {
            if (!e || e.id == null) continue;
            const k = String(e.id);
            if (seenNodes.has(k)) continue;
            if (graph?.getNodeById && !graph.getNodeById(e.id)) continue;
            seenNodes.add(k);
            e.offset = Array.isArray(e.offset) && e.offset.length >= 2 && Number.isFinite(e.offset[0]) && Number.isFinite(e.offset[1])
              ? [Number(e.offset[0]), Number(e.offset[1])]
              : [GROUP_PAD, GROUP_TAB_HEADER_HEIGHT + GROUP_PAD];
            e.size = Array.isArray(e.size) && e.size.length >= 2 && Number.isFinite(e.size[0]) && Number.isFinite(e.size[1])
              ? [Math.max(120, Number(e.size[0])), Math.max(40, Number(e.size[1]))]
              : [220, 100];
            entries.push(e);
          }
          if (!entries.length) continue;
          t.id = typeof t.id === 'string' && t.id ? t.id : uid('gtab');
          t.label = String(t.label ?? 'Group').trim().slice(0, 120) || 'Group';
          t.color = normalizeColor(t.color) ?? '#3f789e';
          t.layoutMode = t.layoutMode === 'stack' ? 'stack' : 'relative';
          t.nodes = entries;
          if (t.groupSnapshot && typeof t.groupSnapshot === 'object') {
            t.groupSnapshot = {
              title: String(t.groupSnapshot.title ?? t.label).slice(0, 120),
              color: normalizeColor(t.groupSnapshot.color) ?? t.color,
              fontSize: Number.isFinite(t.groupSnapshot.fontSize) ? Number(t.groupSnapshot.fontSize) : 24,
              bounding: Array.isArray(t.groupSnapshot.bounding) && t.groupSnapshot.bounding.length >= 4
                ? t.groupSnapshot.bounding.slice(0, 4).map(Number)
                : [pos[0], pos[1], size[0], size[1]],
            };
          } else {
            delete t.groupSnapshot;
          }
          tabs.push(t);
        }
      }
      if (!tabs.length) continue;
      const activeIdx = Number.isInteger(raw.activeTab) ? raw.activeTab : 0;
      raw.id = typeof raw.id === 'string' && raw.id ? raw.id : uid('stack');
      raw.pos = pos;
      raw.size = size;
      raw.sizing = raw.sizing === 'compact' ? 'compact' : 'max';
      raw.activeTab = Math.max(0, Math.min(tabs.length - 1, activeIdx));
      raw.tabs = tabs;
      if (!(raw.originGroupSnapshot && typeof raw.originGroupSnapshot === 'object')) {
        delete raw.originGroupSnapshot;
      }
      cleanStacks.push(raw);
    }
    if (cleanStacks.length) data.tabStacks = cleanStacks;
    else delete data.tabStacks;
  } else {
    delete data.tabStacks;
  }
}

export function layoutTabStack(stack, metrics, nodeTabs = {}, defaultTitleHeight = 30) {
  if (!stack || !Array.isArray(stack.tabs) || !stack.tabs.length) return null;
  const activeIdx = Math.max(0, Math.min(stack.tabs.length - 1, stack.activeTab ?? 0));
  stack.activeTab = activeIdx;

  // Measure each tab page's required [width, totalHeight] (including title bar)
  const tabDims = stack.tabs.map(tab => {
    if (tab.kind === 'node') {
      const m = metrics.get(tab.nodeId) ?? metrics.get(String(tab.nodeId));
      const titleH = m?.titleHeight ?? defaultTitleHeight;
      const minW = Math.max(180, m?.minWidth ?? 220, m?.naturalWidth ?? 0);
      const bodyH = m?.collapsed ? 0 : Math.max(48, m?.height ?? 120);
      return { width: minW, totalHeight: titleH + bodyH, titleH, bodyH };
    }
    // kind === 'group'
    const entries = (tab.nodes ?? []).filter(e => metrics.has(e.id) || metrics.has(String(e.id)));
    if (!entries.length) {
      return { width: 240, totalHeight: GROUP_TAB_HEADER_HEIGHT + 80, titleH: GROUP_TAB_HEADER_HEIGHT, bodyH: 80 };
    }
    if (tab.layoutMode === 'stack') {
      let maxW = 200;
      let sumH = GROUP_TAB_HEADER_HEIGHT + GROUP_PAD;
      entries.forEach((e, idx) => {
        const m = metrics.get(e.id) ?? metrics.get(String(e.id));
        const tH = m?.titleHeight ?? defaultTitleHeight;
        const bH = m?.collapsed ? 0 : Math.max(48, m?.height ?? e.size?.[1] ?? 100);
        const nExtra = nodeTabs?.[String(e.id)] && !m?.collapsed ? BOTTOM_TAB_BAR_HEIGHT : 0;
        maxW = Math.max(maxW, (m?.minWidth ?? 200) + GROUP_PAD * 2);
        sumH += tH + bH + nExtra + (idx < entries.length - 1 ? NODE_GAP : 0);
      });
      sumH += GROUP_PAD;
      return { width: maxW, totalHeight: sumH, titleH: GROUP_TAB_HEADER_HEIGHT, bodyH: sumH - GROUP_TAB_HEADER_HEIGHT };
    }
    // Relative freeform layout inside group box
    let maxRight = 240;
    let maxBottom = GROUP_TAB_HEADER_HEIGHT + 80;
    for (const e of entries) {
      const m = metrics.get(e.id) ?? metrics.get(String(e.id));
      const tH = m?.titleHeight ?? defaultTitleHeight;
      const w = Math.max(m?.minWidth ?? 140, e.size?.[0] ?? 220);
      const bH = m?.collapsed ? 0 : Math.max(48, m?.height ?? e.size?.[1] ?? 100);
      const nExtra = nodeTabs?.[String(e.id)] && !m?.collapsed ? BOTTOM_TAB_BAR_HEIGHT : 0;
      maxRight = Math.max(maxRight, e.offset[0] + w + GROUP_PAD);
      maxBottom = Math.max(maxBottom, e.offset[1] + tH + bH + nExtra + GROUP_PAD);
    }
    return { width: maxRight, totalHeight: maxBottom, titleH: GROUP_TAB_HEADER_HEIGHT, bodyH: maxBottom - GROUP_TAB_HEADER_HEIGHT };
  });

  const maxWidth = Math.max(180, ...tabDims.map(d => d.width));
  const maxTotalHeight = Math.max(60, ...tabDims.map(d => d.totalHeight));
  const activeDim = tabDims[activeIdx];
  const effectiveWidth = maxWidth;
  const effectiveTotalHeight = stack.sizing === 'compact' ? activeDim.totalHeight : maxTotalHeight;

  stack.size = [effectiveWidth, effectiveTotalHeight];

  const [sx, sy] = stack.pos;
  const placements = [];
  const activeTab = stack.tabs[activeIdx];
  let groupBoxRect = null;
  let innerNodeTabBar = null;

  if (activeTab.kind === 'node') {
    const m = metrics.get(activeTab.nodeId) ?? metrics.get(String(activeTab.nodeId));
    if (m) {
      const titleH = m.titleHeight ?? defaultTitleHeight;
      const targetBodyH = m.collapsed ? 0 : Math.max(activeDim.bodyH, effectiveTotalHeight - titleH);
      placements.push({
        nodeId: activeTab.nodeId,
        x: sx,
        y: sy + titleH,
        width: effectiveWidth,
        height: targetBodyH,
        stackManaged: true,
      });
      const nestedCfg = nodeTabs?.[String(activeTab.nodeId)];
      if (nestedCfg && !m.collapsed) {
        innerNodeTabBar = {
          nodeId: activeTab.nodeId,
          config: nestedCfg,
          rect: [sx, sy + titleH + targetBodyH, effectiveWidth, BOTTOM_TAB_BAR_HEIGHT],
        };
      }
    }
  } else if (activeTab.kind === 'group') {
    groupBoxRect = [sx, sy, effectiveWidth, effectiveTotalHeight];
    const entries = (activeTab.nodes ?? []).filter(e => metrics.has(e.id) || metrics.has(String(e.id)));
    if (activeTab.layoutMode === 'stack') {
      let curY = sy + GROUP_TAB_HEADER_HEIGHT + GROUP_PAD;
      for (const e of entries) {
        const m = metrics.get(e.id) ?? metrics.get(String(e.id));
        const tH = m.titleHeight ?? defaultTitleHeight;
        const bH = m.collapsed ? 0 : Math.max(48, m.height ?? e.size?.[1] ?? 100);
        const nExtra = nodeTabs?.[String(e.id)] && !m.collapsed ? BOTTOM_TAB_BAR_HEIGHT : 0;
        placements.push({
          nodeId: e.id,
          x: sx + GROUP_PAD,
          y: curY + tH,
          width: effectiveWidth - GROUP_PAD * 2,
          height: bH,
          stackManaged: true,
        });
        curY += tH + bH + nExtra + NODE_GAP;
      }
    } else {
      for (const e of entries) {
        const m = metrics.get(e.id) ?? metrics.get(String(e.id));
        const tH = m.titleHeight ?? defaultTitleHeight;
        const w = Math.max(m.minWidth ?? 140, e.size?.[0] ?? 220);
        const bH = m.collapsed ? 0 : Math.max(48, m.height ?? e.size?.[1] ?? 100);
        placements.push({
          nodeId: e.id,
          x: sx + e.offset[0],
          y: sy + e.offset[1] + tH,
          width: w,
          height: bH,
          stackManaged: true,
        });
      }
    }
  }

  // Park all inactive tab nodes with hidden: true at the bottom tab bar anchor
  const outerBarY = sy + effectiveTotalHeight + (innerNodeTabBar ? BOTTOM_TAB_BAR_HEIGHT : 0);
  stack.tabs.forEach((tab, idx) => {
    if (idx === activeIdx) return;
    const ids = tab.kind === 'node' ? [tab.nodeId] : (tab.nodes ?? []).map(e => e.id);
    for (const nId of ids) {
      const m = metrics.get(nId) ?? metrics.get(String(nId));
      if (!m) continue;
      placements.push({
        nodeId: nId,
        x: sx + 8,
        y: outerBarY,
        width: Math.max(80, effectiveWidth - 16),
        height: 0,
        hidden: true,
        stackId: stack.id,
        stackTabIndex: idx,
      });
    }
  });

  return {
    stack,
    bodyRect: [sx, sy, effectiveWidth, effectiveTotalHeight],
    groupBoxRect,
    innerNodeTabBar,
    tabBarRect: [sx, outerBarY, effectiveWidth, BOTTOM_TAB_BAR_HEIGHT],
    placements,
  };
}

// ---------------- STACK MUTATION HELPERS ----------------

export function selectStackTab(data, stackId, tabIndex) {
  const stack = data?.tabStacks?.find(s => s.id === stackId);
  if (!stack || !Array.isArray(stack.tabs) || !stack.tabs.length) return false;
  stack.activeTab = Math.max(0, Math.min(stack.tabs.length - 1, Number(tabIndex) || 0));
  return true;
}

export function renameStackTab(data, stackId, tabIndex, label) {
  const stack = data?.tabStacks?.find(s => s.id === stackId);
  const tab = stack?.tabs?.[tabIndex];
  const clean = String(label ?? '').trim().slice(0, 120);
  if (!tab || !clean) return false;
  tab.label = clean;
  if (tab.groupSnapshot) tab.groupSnapshot.title = clean;
  return true;
}

export function toggleGroupTabLayoutMode(data, stackId, tabIndex = null) {
  const stack = data?.tabStacks?.find(s => s.id === stackId);
  if (!stack) return false;
  const idx = tabIndex ?? stack.activeTab ?? 0;
  const tab = stack.tabs?.[idx];
  if (!tab || tab.kind !== 'group') return false;
  tab.layoutMode = tab.layoutMode === 'stack' ? 'relative' : 'stack';
  return true;
}

export function setStackSizing(data, stackId, sizing) {
  const stack = data?.tabStacks?.find(s => s.id === stackId);
  if (!stack) return false;
  stack.sizing = sizing === 'compact' ? 'compact' : 'max';
  return true;
}

export function reorderStackTab(data, stackId, fromIdx, toIdx) {
  const stack = data?.tabStacks?.find(s => s.id === stackId);
  if (!stack || !Array.isArray(stack.tabs) || fromIdx === toIdx) return false;
  if (fromIdx < 0 || fromIdx >= stack.tabs.length) return false;
  const clamped = Math.max(0, Math.min(stack.tabs.length - 1, toIdx));
  const [moved] = stack.tabs.splice(fromIdx, 1);
  stack.tabs.splice(clamped, 0, moved);
  stack.activeTab = clamped;
  return true;
}

export function addNodesOrGroupToStack(data, graph, stackId, { nodes = [], group = null } = {}, insertIndex = null, titleHeight = 30) {
  const stack = data?.tabStacks?.find(s => s.id === stackId);
  if (!stack || !graph) return false;
  const newTabs = [];
  const movingIds = new Set();

  if (group) {
    const members = getGroupMemberNodes(graph, group, titleHeight);
    if (members.length) {
      for (const m of members) movingIds.add(String(m.id));
      newTabs.push(buildGroupTabPage(group, members, titleHeight));
      removeNativeGroup(graph, group);
    }
  }
  for (const node of nodes) {
    if (!node || movingIds.has(String(node.id))) continue;
    movingIds.add(String(node.id));
    newTabs.push({
      id: uid('ptab'),
      kind: 'node',
      label: String(node.title || node.type || `Node ${node.id}`).trim().slice(0, 120),
      nodeId: node.id,
    });
  }
  if (!newTabs.length) return false;

  // Remove moving nodes from other containers (and any older tabs in this stack)
  for (const frame of data.frames ?? []) {
    for (const cell of leaves(frame.root)) removeNodeFromCell(cell, movingIds);
  }
  for (const s of data.tabStacks ?? []) {
    s.tabs = s.tabs.filter(t => {
      if (t.kind === 'node') return !movingIds.has(String(t.nodeId));
      if (t.kind === 'group') {
        t.nodes = t.nodes.filter(e => !movingIds.has(String(e.id)));
        return t.nodes.length > 0;
      }
      return false;
    });
  }

  const idx = Number.isInteger(insertIndex)
    ? Math.max(0, Math.min(stack.tabs.length, insertIndex))
    : stack.tabs.length;
  stack.tabs.splice(idx, 0, ...newTabs);
  stack.activeTab = idx;
  data.tabStacks = data.tabStacks.filter(s => s.tabs.length > 0);
  return true;
}

export function detachStackTab(data, graph, stackId, tabIndex, dropPoint = null, titleHeight = 30) {
  const stack = data?.tabStacks?.find(s => s.id === stackId);
  if (!stack || !stack.tabs?.[tabIndex]) return null;
  const [removed] = stack.tabs.splice(tabIndex, 1);
  const destX = Array.isArray(dropPoint) ? Math.round(dropPoint[0]) : stack.pos[0] + 36;
  const destY = Array.isArray(dropPoint) ? Math.round(dropPoint[1]) : stack.pos[1] + 36;

  if (removed.kind === 'node') {
    const node = graph?.getNodeById?.(removed.nodeId);
    if (node) {
      node.pos = [destX, destY + titleHeight];
      node.setDirtyCanvas?.(true, true);
    }
  } else if (removed.kind === 'group') {
    let maxRight = 260;
    let maxBottom = GROUP_TAB_HEADER_HEIGHT + 100;
    for (const e of removed.nodes ?? []) {
      const node = graph?.getNodeById?.(e.id);
      if (node) {
        node.pos = [destX + e.offset[0], destY + e.offset[1] + titleHeight];
        if (Array.isArray(e.size) && node.setSize) node.setSize([...e.size]);
        else if (Array.isArray(e.size)) node.size = [...e.size];
        maxRight = Math.max(maxRight, e.offset[0] + (node.size?.[0] || 220) + GROUP_PAD);
        maxBottom = Math.max(maxBottom, e.offset[1] + titleHeight + (node.size?.[1] || 100) + GROUP_PAD);
        node.setDirtyCanvas?.(true, true);
      }
    }
    const snap = removed.groupSnapshot ?? { title: removed.label, color: removed.color, fontSize: 24 };
    restoreNativeGroup(graph, snap, [destX, destY, maxRight, maxBottom]);
  }

  if (stack.tabs.length === 0) {
    data.tabStacks = data.tabStacks.filter(s => s.id !== stackId);
  } else {
    stack.activeTab = Math.max(0, Math.min(stack.tabs.length - 1, stack.activeTab));
  }
  return removed;
}

export function unpackTabStack(data, graph, stackId, titleHeight = 30) {
  const stack = data?.tabStacks?.find(s => s.id === stackId);
  if (!stack || !graph) return false;
  const [sx, sy] = stack.pos;

  if (stack.originGroupSnapshot && stack.tabs.every(t => t.kind === 'node')) {
    let curY = sy + GROUP_TAB_HEADER_HEIGHT + GROUP_PAD;
    let maxW = 240;
    for (const tab of stack.tabs) {
      const node = graph.getNodeById?.(tab.nodeId);
      if (!node) continue;
      node.pos = [sx + GROUP_PAD, curY + titleHeight];
      maxW = Math.max(maxW, (node.size?.[0] || 220) + GROUP_PAD * 2);
      curY += titleHeight + (node.size?.[1] || 100) + NODE_GAP;
      node.setDirtyCanvas?.(true, true);
    }
    restoreNativeGroup(graph, stack.originGroupSnapshot, [
      sx,
      sy,
      Math.max(maxW, stack.originGroupSnapshot.bounding?.[2] ?? 240),
      Math.max(120, curY - sy + GROUP_PAD),
    ]);
  } else {
    let offsetX = sx;
    for (const tab of stack.tabs) {
      if (tab.kind === 'node') {
        const node = graph.getNodeById?.(tab.nodeId);
        if (node) {
          node.pos = [offsetX, sy + titleHeight];
          offsetX += (node.size?.[0] || 240) + 28;
          node.setDirtyCanvas?.(true, true);
        }
      } else if (tab.kind === 'group') {
        let maxRight = 260;
        let maxBottom = GROUP_TAB_HEADER_HEIGHT + 100;
        for (const e of tab.nodes ?? []) {
          const node = graph.getNodeById?.(e.id);
          if (node) {
            node.pos = [offsetX + e.offset[0], sy + e.offset[1] + titleHeight];
            maxRight = Math.max(maxRight, e.offset[0] + (node.size?.[0] || 220) + GROUP_PAD);
            maxBottom = Math.max(maxBottom, e.offset[1] + titleHeight + (node.size?.[1] || 100) + GROUP_PAD);
            node.setDirtyCanvas?.(true, true);
          }
        }
        const snap = tab.groupSnapshot ?? { title: tab.label, color: tab.color, fontSize: 24 };
        restoreNativeGroup(graph, snap, [offsetX, sy, maxRight, maxBottom]);
        offsetX += maxRight + 28;
      }
    }
  }

  data.tabStacks = data.tabStacks.filter(s => s.id !== stackId);
  if (!data.tabStacks.length) delete data.tabStacks;
  return true;
}
