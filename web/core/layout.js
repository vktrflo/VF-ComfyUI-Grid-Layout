// Geometry and membership are independent of ComfyUI's rendering system.
export const VERSION = 1;
export const KEY = 'comfyui_grid_layout';
export const LEGACY_KEY = 'comfyui_layout_templates';
export const KIND = 'comfyui-grid-layout';
export const LEGACY_KIND = 'comfyui-layout-template';
export const PAD = 12;
export const GAP = 12;
export const CELL_TITLE = 26;
export const FRAME_TITLE = 36;
export const COLLAPSED_CELL_WIDTH = 36;
export const COLLAPSED_CELL_HEIGHT = 26;
// Height of a collapsed frame holding no nodes; with nodes it grows by one
// title bar each, and the border wraps the stack.
export const COLLAPSED_TITLE = FRAME_TITLE + PAD;
let fallbackId = 0;
function id() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  // getRandomValues remains available on HTTP LAN origins, where the
  // secure-context-only randomUUID method is absent.
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // These are layout identities, not security tokens.
  return `layout-${Date.now().toString(36)}-${++fallbackId}-${Math.random().toString(36).slice(2)}`;
}
const clone = value => JSON.parse(JSON.stringify(value));

export function syncCellTabs(cell) {
  if (!cell || cell.children) return;
  if (!Array.isArray(cell.tabs) || !cell.tabs.length) {
    delete cell.tabs;
    delete cell.activeTab;
    cell.nodes ??= [];
    return;
  }
  const seen = new Set();
  for (const tab of cell.tabs) {
    tab.id = typeof tab.id === 'string' && tab.id ? tab.id : id();
    tab.label = String(tab.label ?? 'Tab').slice(0, 120) || 'Tab';
    if (typeof tab.icon === 'string' && tab.icon.trim()) tab.icon = tab.icon.trim().slice(0, 16);
    else delete tab.icon;
    const clean = [];
    for (const n of Array.isArray(tab.nodes) ? tab.nodes : []) {
      const k = String(n);
      if (!seen.has(k)) { seen.add(k); clean.push(n); }
    }
    tab.nodes = clean;
  }
  const active = Number.isInteger(cell.activeTab) ? cell.activeTab : 0;
  cell.activeTab = Math.max(0, Math.min(cell.tabs.length - 1, active));
  cell.nodes = cell.tabs.flatMap(t => t.nodes);
}

export function activeTabIndex(cell) {
  if (!Array.isArray(cell?.tabs) || !cell.tabs.length) return 0;
  const idx = Number.isInteger(cell.activeTab) ? cell.activeTab : 0;
  return Math.max(0, Math.min(cell.tabs.length - 1, idx));
}

export function removeNodeFromCell(cell, movingSet) {
  if (!cell || cell.children) return;
  cell.nodes = (cell.nodes ?? []).filter(n => !movingSet.has(String(n)));
  if (Array.isArray(cell.tabs)) {
    for (const tab of cell.tabs) {
      tab.nodes = (tab.nodes ?? []).filter(n => !movingSet.has(String(n)));
    }
    syncCellTabs(cell);
  }
}

export function computeCompassRect(cellRect, cellTitle = CELL_TITLE) {
  const [cx, cy, cw, ch] = cellRect;
  const bodyH = Math.max(0, ch - cellTitle);
  if (cw < 110 || bodyH < 90) return null;
  const size = 84;
  return [
    Math.round(cx + (cw - size) / 2),
    Math.round(cy + cellTitle + (bodyH - size) / 2),
    size,
    size,
  ];
}

export function hitTestCompass(compassRect, point) {
  if (!compassRect || !point) return null;
  const [rx, ry, rw, rh] = compassRect;
  const [px, py] = point;
  if (px < rx || px > rx + rw || py < ry || py > ry + rh) return null;
  const dx = px - (rx + rw / 2);
  const dy = py - (ry + rh / 2);
  if (Math.abs(dx) <= 15 && Math.abs(dy) <= 15) return 'center';
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx < 0 ? 'left' : 'right';
  }
  return dy < 0 ? 'top' : 'bottom';
}

// Pick the cell a node rect should land in: the cell containing the rect's
// center first (existing behavior), then the cell with the largest overlap —
// a tall node dropped onto a small cell attaches even when its center is out.
export function pickCell(layouts, rect) {
  const [x, y, width, height] = rect;
  const center = [x + width / 2, y + height / 2];
  let best = null, bestArea = 0;
  for (const layout of [...layouts].reverse()) {
    if (layout.frame?.lock === true) continue;
    for (const cell of layout.cells) {
      if (cell.cell?.collapsed === true) continue;
      const [cx, cy, cw, ch] = cell.rect;
      if (center[0] >= cx && center[0] <= cx + cw && center[1] >= cy && center[1] <= cy + ch) return { frame: layout.frame, ...cell };
      const area = Math.max(0, Math.min(x + width, cx + cw) - Math.max(x, cx)) * Math.max(0, Math.min(y + height, cy + ch) - Math.max(y, cy));
      if (area > bestArea) { bestArea = area; best = { frame: layout.frame, ...cell }; }
    }
  }
  return best;
}

// Target a cell for a newly added node. Errs on the side of caution:
// ensures the node's placement anchor falls within the cell's inner content area
// (below cell header + padding, and within cell horizontal padding). In ghost
// placement mode, ComfyUI centers the node horizontally on the cursor
// (x = cursorX - width / 2, y = cursorY + 10), so the horizontal center is the
// placement anchor. Nodes placed on frame headers, cell headers, dividers, outer
// borders, or locked frames are never captured.
export function targetCellForNode(layouts, node, options = {}) {
  if (!node || !layouts) return null;
  const rect = Array.isArray(node) ? node : (node.pos && node.size ? [node.pos[0], node.pos[1], node.size[0], node.size[1]] : null);
  if (!rect || rect.some(n => typeof n !== 'number' || !Number.isFinite(n))) return null;
  const [x, y, width, height] = rect;
  if (width <= 0 || height <= 0) return null;

  const isGhost = Boolean(options?.ghost || (!Array.isArray(node) && node?.flags?.ghost));
  const anchorX = isGhost ? x + width / 2 : x;
  const anchorY = y;

  for (const layout of [...layouts].reverse()) {
    if (layout.frame?.lock === true) continue;
    const hasNodes = layout.cells.some(({ cell }) => cell?.nodes?.length > 0);
    const cellTitle = layout.frame?.autohide === true && hasNodes && !layout.frame?.appMode ? 0 : CELL_TITLE;
    const pad = layout.frame?.appMode === true ? 6 : PAD;
    for (const cell of layout.cells) {
      if (cell.cell?.collapsed === true) continue;
      const [cx, cy, cw, ch] = cell.rect;
      const left = cx + pad;
      const right = cx + cw - pad;
      const top = cy + cellTitle + pad;
      const bottom = cy + ch - pad;
      if (right >= left && bottom >= top && anchorX >= left && anchorX <= right && anchorY >= top && anchorY <= bottom) {
        return { frame: layout.frame, ...cell };
      }
    }
  }
  return null;
}

export function resolveDropTarget(layouts, node, options = {}) {
  if (!node || !layouts) return null;
  const rect = Array.isArray(node) ? node : (node.pos && node.size ? [node.pos[0], node.pos[1], node.size[0], node.size[1]] : null);
  if (!rect || rect.some(n => typeof n !== 'number' || !Number.isFinite(n))) return null;
  const [x, y, width, height] = rect;
  if (width <= 0 || height <= 0) return null;

  const moving = new Set((options?.excludeIds ?? []).map(String));
  if (!Array.isArray(node) && node?.id != null) moving.add(String(node.id));
  const titleHeight = options?.titleHeight ?? 30;
  const ghostHeight = Math.max(64, height + titleHeight);
  const center = [x + width / 2, y + height / 2];
  const pointer = options?.pointer ?? null;

  for (const layout of [...layouts].reverse()) {
    const { frame, cells = [], placements = [] } = layout;
    if (!frame || frame.lock === true || frame.minimized === true || frame.collapsed === true || !cells.length) continue;

    const frameHasNodes = cells.some(({ cell }) => cell.nodes.length > 0 || cell.tabs?.length > 0);
    const cellTitle = frame.autohide === true && frameHasNodes && !frame.appMode ? 0 : CELL_TITLE;
    const pad = frame.appMode === true ? 6 : PAD;
    const framePad = frame.appMode === true ? 4 : PAD;
    const frameHasOtherNodes = cells.some(({ cell }) => cell.nodes.some(id => !moving.has(String(id))) || cell.tabs?.length > 0);
    const [fx, fy] = frame.pos;
    const [fw, fh] = frame.size;
    const frameBottom = fy + fh;

    if (
      frameHasOtherNodes &&
      !frame.maximizedCellId &&
      center[0] >= fx &&
      center[0] <= fx + fw &&
      center[1] >= frameBottom + 8 &&
      center[1] <= frameBottom + Math.max(120, height)
    ) {
      return {
        kind: 'bottom-row',
        ghostType: 'cell',
        frame,
        cell: null,
        previewRect: [fx + framePad, frameBottom, fw - framePad * 2, ghostHeight],
      };
    }

    if (center[1] > frameBottom + Math.max(120, height)) continue;

    let pick = null;
    if (pointer) {
      const hit = cells.find(({ cell, rect: cellRect }) => cell?.collapsed !== true && contains(cellRect, pointer));
      if (hit) pick = { frame, ...hit };
    }
    if (!pick) pick = pickCell([layout], rect);
    if (!pick) continue;

    const { cell, rect: cellRect } = pick;
    const [cx, cy, cw, ch] = cellRect;
    const hasTabs = Array.isArray(cell.tabs) && cell.tabs.length > 0;
    const activeNodes = hasTabs
      ? (cell.tabs[activeTabIndex(cell)]?.nodes ?? [])
      : cell.nodes;
    const others = activeNodes.filter(id => !moving.has(String(id)));
    const hasAnyOtherContent = others.length > 0 || hasTabs;
    const isTabDrag = Boolean(options?.isTabDrag);
    const showCompass = Boolean(options?.enableCompass || (!hasTabs && others.length > 0));
    const compassRect = showCompass ? computeCompassRect(cellRect, cellTitle) : null;

    // 1. Check Cell Header / Tab Bar drop hotspot first (when pointer is over the cell header / tab bar)
    const headerZoneHeight = Math.max(CELL_TITLE, cellTitle);
    const tabHit = options?.tabHit?.cellId === cell.id ? options.tabHit : null;
    if (
      hasAnyOtherContent &&
      pointer &&
      pointer[0] >= cx - 8 &&
      pointer[0] <= cx + cw + 8 &&
      pointer[1] >= cy - (isTabDrag ? 20 : 4) &&
      pointer[1] <= cy + headerZoneHeight + (isTabDrag ? 12 : 4)
    ) {
      if (!isTabDrag && hasTabs) {
        if (tabHit && tabHit.onTabPill && Number.isInteger(tabHit.tabIndex)) {
          return {
            kind: 'tab-into',
            compassRect,
            ghostType: 'tab',
            frame,
            cell,
            rect: cellRect,
            tabIndex: Math.max(0, Math.min(cell.tabs.length - 1, tabHit.tabIndex)),
            previewRect: [cx + pad, cy + cellTitle + pad, cw - pad * 2, Math.max(48, ch - cellTitle - pad * 2)],
          };
        }
        if (Number.isInteger(options?.targetTabIndex)) {
          return {
            kind: 'tab-into',
            compassRect,
            ghostType: 'tab',
            frame,
            cell,
            rect: cellRect,
            tabIndex: Math.max(0, Math.min(cell.tabs.length - 1, options.targetTabIndex)),
            previewRect: [cx + pad, cy + cellTitle + pad, cw - pad * 2, Math.max(48, ch - cellTitle - pad * 2)],
          };
        }
      }
      let tabInsertIndex = hasTabs ? cell.tabs.length : 1;
      if (isTabDrag && hasTabs) {
        if (tabHit && Number.isInteger(tabHit.reorderIndex)) {
          tabInsertIndex = tabHit.reorderIndex;
        } else {
          const slotW = Math.min(96, Math.max(40, (cw - 80) / cell.tabs.length));
          tabInsertIndex = Math.max(0, Math.min(cell.tabs.length - 1, Math.floor((pointer[0] - (cx + 8)) / slotW)));
        }
      }
      return {
        kind: 'tab',
        compassRect,
        ghostType: 'tab',
        frame,
        cell,
        rect: cellRect,
        tabIndex: tabInsertIndex,
        previewRect: [cx + pad, cy + cellTitle + pad, cw - pad * 2, Math.max(48, ch - cellTitle - pad * 2)],
      };
    }

    // 2. Check 5-way Docking Compass Rose when active for this cell
    const compassZone = pointer && compassRect ? hitTestCompass(compassRect, pointer) : null;

    if (compassZone === 'center') {
      return {
        kind: 'tab',
        compassZone: 'center',
        compassRect,
        ghostType: 'tab',
        frame,
        cell,
        rect: cellRect,
        previewRect: [cx + pad, cy + cellTitle + pad, cw - pad * 2, Math.max(48, ch - cellTitle - pad * 2)],
      };
    }
    if (compassZone === 'left') {
      const splitW = Math.round(cw * 0.45);
      return {
        kind: 'split-left',
        compassZone: 'left',
        compassRect,
        ghostType: 'cell',
        frame,
        cell,
        rect: cellRect,
        previewRect: [cx, cy, splitW, ch],
      };
    }
    if (compassZone === 'right') {
      const splitW = Math.round(cw * 0.45);
      return {
        kind: 'split-right',
        compassZone: 'right',
        compassRect,
        ghostType: 'cell',
        frame,
        cell,
        rect: cellRect,
        previewRect: [cx + cw - splitW, cy, splitW, ch],
      };
    }
    if (compassZone === 'top') {
      const splitH = Math.round(ch * 0.45);
      return {
        kind: 'split-top',
        compassZone: 'top',
        compassRect,
        ghostType: 'cell',
        frame,
        cell,
        rect: cellRect,
        previewRect: [cx, cy, cw, splitH],
      };
    }
    if (compassZone === 'bottom') {
      const splitH = Math.round(ch * 0.45);
      return {
        kind: 'split-bottom',
        compassZone: 'bottom',
        compassRect,
        ghostType: 'cell',
        frame,
        cell,
        rect: cellRect,
        previewRect: [cx, cy + ch - splitH, cw, splitH],
      };
    }

    if (!others.length) {
      const previewY = cy + cellTitle + pad;
      const previewH = Math.min(ghostHeight, Math.max(48, ch - cellTitle - pad * 2));
      return {
        kind: 'cell',
        compassRect,
        ghostType: 'node',
        frame,
        cell,
        rect: cellRect,
        index: 0,
        previewRect: [cx + pad, previewY, cw - pad * 2, previewH],
      };
    }

    if (!hasTabs) {
      const edgeThreshold = Math.min(72, Math.max(36, cw * 0.22));
      const splitPreviewWidth = Math.min(Math.round(cw * 0.45), Math.max(72, Math.round(edgeThreshold * 1.4)));
      if (center[0] <= cx + edgeThreshold) {
        return {
          kind: 'split-left',
          compassRect,
          ghostType: 'cell',
          frame,
          cell,
          rect: cellRect,
          previewRect: [cx, cy, splitPreviewWidth, ch],
        };
      }
      if (center[0] >= cx + cw - edgeThreshold) {
        return {
          kind: 'split-right',
          compassRect,
          ghostType: 'cell',
          frame,
          cell,
          rect: cellRect,
          previewRect: [cx + cw - splitPreviewWidth, cy, splitPreviewWidth, ch],
        };
      }
    }

    const nodePlacements = others
      .map(id => placements.find(p => String(p.nodeId) === String(id) && !p.hidden))
      .filter(Boolean);
    const firstBelowIdx = nodePlacements.findIndex(p => center[1] < p.y + p.height / 2);
    const insertIndex = firstBelowIdx === -1 ? others.length : firstBelowIdx;

    if (insertIndex === 0) {
      const previewY = cy + cellTitle + pad;
      const previewH = Math.min(ghostHeight, Math.max(48, ch - cellTitle - pad * 2));
      return {
        kind: 'stack',
        position: 'before',
        compassRect,
        ghostType: 'node',
        frame,
        cell,
        rect: cellRect,
        index: 0,
        previewRect: [cx + pad, previewY, cw - pad * 2, previewH],
      };
    }

    const prevPlacement = nodePlacements[insertIndex - 1] ?? nodePlacements.at(-1);
    const slotY = prevPlacement ? prevPlacement.y + prevPlacement.height + GAP : cy + cellTitle + pad;
    const previewH = Math.max(48, Math.min(ghostHeight, 120));
    return {
      kind: 'stack',
      position: 'after',
      compassRect,
      ghostType: 'node',
      frame,
      cell,
      rect: cellRect,
      index: insertIndex,
      previewRect: [cx + pad, slotY, cw - pad * 2, previewH],
    };
  }
  return null;
}

export function normalizeColor(value) {
  if (typeof value !== 'string') return undefined;
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (!match) return undefined;
  const hex = match[1].length === 3 ? [...match[1]].map(c => c + c).join('') : match[1];
  return `#${hex.toLowerCase()}`;
}

export function normalizeFontSize(value) {
  const size = Number(value);
  if (!Number.isFinite(size)) return undefined;
  return Math.min(24, Math.max(8, Math.round(size)));
}

export const createCell = (label = '') => ({ id: id(), label, nodes: [] });
export function normalizeBorder(value) {
  if (!value || typeof value !== 'object') return undefined;
  const color = normalizeColor(value.color);
  const width = Number(value.width);
  if (!color || !Number.isInteger(width) || width < 1 || width > 8 || !['solid','dashed','dotted'].includes(value.style)) return undefined;
  return {color, width, style:value.style};
}

export const PATTERNS = ['none', 'dots', 'grid', 'diagonal', 'hexagons', 'carbon'];

export function normalizePattern(value) {
  if (typeof value !== 'string') return undefined;
  const lower = value.toLowerCase();
  return PATTERNS.includes(lower) && lower !== 'none' ? lower : undefined;
}

export function normalizeOpacity(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return undefined;
  return Math.min(1, Math.max(0, Math.round(num * 100) / 100));
}

// Upload limit for frame background images, in file bytes. Images are stored
// as base64 data URLs, which are about 4/3 the file size plus a short prefix.
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 256;

// Only embedded images are accepted: a remote URL in a shared workflow would
// make every viewer's browser fetch it.
export function normalizeImage(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.startsWith('data:image/') && trimmed.length <= MAX_IMAGE_CHARS) {
    return trimmed;
  }
  return undefined;
}

export function normalizeImageMode(value) {
  if (typeof value !== 'string') return undefined;
  const lower = value.toLowerCase();
  return ['repeat', 'cover'].includes(lower) ? lower : undefined;
}

export function normalizeContainerMode(value) {
  if (typeof value !== 'string') return undefined;
  const lower = value.toLowerCase();
  return ['color', 'image'].includes(lower) ? lower : undefined;
}

export const createFrame = (pos = [0, 0]) => ({ id: id(), label: 'Grid', pos: [...pos], size: [620, 500], autohide: true, root: createCell() });
export const leaves = cell => cell.children ? cell.children.flatMap(leaves) : [cell];
export function findCell(cell, cellId) {
  if (cell.id === cellId) return cell;
  for (const child of cell.children ?? []) {
    const found = findCell(child, cellId);
    if (found) return found;
  }
}

function cellDepth(cell, cellId, depth = 0) {
  if (cell.id === cellId) return depth;
  for (const child of cell.children ?? []) {
    const result = cellDepth(child, cellId, depth + 1);
    if (result !== undefined) return result;
  }
}

function carryHeaderConfig(target, source) {
  for (const key of ['color', 'textColor', 'fontSize', 'headerOpacity', 'border', 'fill', 'tabs', 'activeTab', 'collapsed', 'icon', 'minHeightOverride']) {
    if (source[key] !== undefined) { target[key] = source[key]; delete source[key]; }
  }
}

function containsCell(cell, targetId) {
  if (cell.id === targetId) return true;
  return Boolean(cell.children?.some(child => containsCell(child, targetId)));
}

function preserveSplitWidths(frame, cellId, metrics, initialInnerWidth) {
  const pad = frame.appMode === true ? 6 : PAD;
  const framePad = frame.appMode === true ? 4 : PAD;
  const gap = frame.appMode === true ? 4 : GAP;
  function adjust(cell, currentWidth) {
    const minWidth = contentMinimumWidth(cell, metrics, pad, gap);
    if (cell.id === cellId || !cell.children || !containsCell(cell, cellId)) {
      return Math.max(currentWidth, minWidth);
    }
    if (cell.axis === 'y') {
      let nextWidth = currentWidth;
      for (const child of cell.children) {
        nextWidth = Math.max(nextWidth, containsCell(child, cellId) ? adjust(child, currentWidth) : contentMinimumWidth(child, metrics, pad, gap));
      }
      return nextWidth;
    }
    const gaps = gap * (cell.children.length - 1);
    const available = Math.max(0, currentWidth - gaps);
    const weights = ratios(cell);
    const widths = cell.children.map((child, index) => (
      containsCell(child, cellId)
        ? adjust(child, available * weights[index])
        : Math.max(available * weights[index], contentMinimumWidth(child, metrics, pad, gap))
    ));
    const total = widths.reduce((sum, width) => sum + width, 0);
    if (total > 0) cell.ratios = widths.map(width => width / total);
    return total + gaps;
  }
  const nextInnerWidth = adjust(frame.root, initialInnerWidth);
  frame.size[0] = Math.max(frame.size[0], nextInnerWidth + framePad * 2);
}

export function splitCell(frame, cellId, axis, metrics) {
  if (!['x', 'y'].includes(axis)) throw new Error('Choose a horizontal or vertical split.');
  const cell = findCell(frame.root, cellId);
  if (!cell || cell.children) throw new Error('Only an unsplit cell can be split.');
  if (cellDepth(frame.root, cellId) >= 16) throw new Error('Layouts support up to 16 nested split levels.');
  if (leaves(frame.root).length >= 256) throw new Error('A layout supports up to 256 cells.');
  const pad = frame.appMode === true ? 6 : PAD;
  const framePad = frame.appMode === true ? 4 : PAD;
  const gap = frame.appMode === true ? 4 : GAP;
  const initialInnerWidth = axis === 'x' && metrics ? Math.max(contentMinimumWidth(frame.root, metrics, pad, gap), frame.size[0] - framePad * 2) : 0;
  const first = createCell(cell.label), second = createCell();
  first.nodes = cell.nodes;
  delete cell.nodes;
  carryHeaderConfig(first, cell);
  Object.assign(cell, { axis, ratios: [0.5, 0.5], children: [first, second] });
  if (axis === 'x' && metrics) preserveSplitWidths(frame, cellId, metrics, initialInnerWidth);
}

export function gridCell(frame, cellId, rows, columns, metrics) {
  if (![rows, columns].every(n => Number.isInteger(n) && n >= 1 && n <= 16) || rows * columns > 256) {
    throw new Error('Use 1–16 rows and columns, up to 256 cells.');
  }
  const cell = findCell(frame.root, cellId);
  if (!cell || cell.children) throw new Error('Choose an unsplit cell for the grid.');
  if (cellDepth(frame.root, cellId) + Number(rows > 1) + Number(columns > 1) > 16) throw new Error('Layouts support up to 16 nested split levels.');
  if (leaves(frame.root).length - 1 + rows * columns > 256) throw new Error('A layout supports up to 256 cells.');
  if (rows === 1 && columns === 1) return;
  const pad = frame.appMode === true ? 6 : PAD;
  const framePad = frame.appMode === true ? 4 : PAD;
  const gap = frame.appMode === true ? 4 : GAP;
  const initialInnerWidth = columns > 1 && metrics ? Math.max(contentMinimumWidth(frame.root, metrics, pad, gap), frame.size[0] - framePad * 2) : 0;
  const nodes = cell.nodes;
  const makeRow = () => {
    if (columns === 1) return createCell();
    return { id: id(), label: 'Row', axis: 'x', ratios: Array(columns).fill(1 / columns), children: Array.from({ length: columns }, () => createCell()) };
  };
  delete cell.nodes;
  if (rows === 1) Object.assign(cell, makeRow(), { id: cellId });
  else Object.assign(cell, { axis: 'y', ratios: Array(rows).fill(1 / rows), children: Array.from({ length: rows }, makeRow) });
  const first = leaves(cell)[0];
  first.nodes = nodes;
  carryHeaderConfig(first, cell);
  if (columns > 1 && metrics) preserveSplitWidths(frame, cellId, metrics, initialInnerWidth);
}

export function dropNodes(frames, frameId, cellId, nodeIds, index = Infinity, metrics) {
  const target = frames.find(f => f.id === frameId);
  if (target?.lock === true) return;
  const cell = target && findCell(target.root, cellId);
  if (frameId != null && (!cell || cell.children)) throw new Error('Drop into an unsplit cell.');
  const pad = target?.appMode === true ? 6 : PAD;
  const framePad = target?.appMode === true ? 4 : PAD;
  const gap = target?.appMode === true ? 4 : GAP;
  const initialInnerWidth = target && metrics ? Math.max(contentMinimumWidth(target.root, metrics, pad, gap), target.size[0] - framePad * 2) : 0;
  const lockedNodeIds = new Set();
  for (const frame of frames) {
    if (frame?.lock !== true) continue;
    for (const leaf of leaves(frame.root)) {
      for (const n of leaf.nodes ?? []) lockedNodeIds.add(String(n));
      for (const tab of leaf.tabs ?? []) {
        for (const n of tab.nodes ?? []) lockedNodeIds.add(String(n));
      }
    }
  }
  const ids = [...new Set(nodeIds)].filter(id => !lockedNodeIds.has(String(id)));
  if (!ids.length) return;
  const moving = new Set(ids.map(String));
  for (const frame of frames) {
    if (frame?.lock === true) continue;
    for (const leaf of leaves(frame.root)) {
      removeNodeFromCell(leaf, moving);
    }
  }
  if (cell) {
    if (Array.isArray(cell.tabs) && cell.tabs.length) {
      const tab = cell.tabs[activeTabIndex(cell)];
      tab.nodes.splice(Math.min(Math.max(0, index), tab.nodes.length), 0, ...ids);
      syncCellTabs(cell);
    } else {
      cell.nodes.splice(Math.min(Math.max(0, index), cell.nodes.length), 0, ...ids);
    }
    if (metrics) preserveSplitWidths(target, cellId, metrics, initialInnerWidth);
  }
}

export function dropNodesIntoTab(frames, frameId, cellId, nodeIds, options = {}) {
  const target = frames.find(f => f.id === frameId);
  if (target?.lock === true) return null;
  const cell = target && findCell(target.root, cellId);
  if (!target || !cell || cell.children) throw new Error('Drop into an unsplit cell.');
  const metrics = options.metrics;
  const pad = target.appMode === true ? 6 : PAD;
  const framePad = target.appMode === true ? 4 : PAD;
  const gap = target.appMode === true ? 4 : GAP;
  const initialInnerWidth = metrics ? Math.max(contentMinimumWidth(target.root, metrics, pad, gap), target.size[0] - framePad * 2) : 0;
  const lockedNodeIds = new Set();
  for (const frame of frames) {
    if (frame?.lock !== true) continue;
    for (const leaf of leaves(frame.root)) {
      for (const n of leaf.nodes ?? []) lockedNodeIds.add(String(n));
      for (const tab of leaf.tabs ?? []) {
        for (const n of tab.nodes ?? []) lockedNodeIds.add(String(n));
      }
    }
  }
  const ids = [...new Set(nodeIds)].filter(id => !lockedNodeIds.has(String(id)));
  if (!ids.length) return null;
  const moving = new Set(ids.map(String));
  for (const frame of frames) {
    if (frame?.lock === true) continue;
    for (const leaf of leaves(frame.root)) {
      removeNodeFromCell(leaf, moving);
    }
  }
  if (!Array.isArray(cell.tabs) || !cell.tabs.length) {
    const existing = [...(cell.nodes ?? [])];
    cell.tabs = [];
    if (existing.length > 0) {
      cell.tabs.push({
        id: id(),
        label: cell.label || options.existingLabel || 'Tab 1',
        nodes: existing,
      });
    }
  }
  if (cell.tabs.length >= 32 && options.createNewTab !== false) {
    throw new Error('A panel supports up to 32 tabs.');
  }
  const label = String(options.tabLabel || (ids.length === 1 && options.nodeTitles?.get?.(String(ids[0]))) || `Tab ${cell.tabs.length + 1}`).slice(0, 120);
  const newTab = { id: id(), label, nodes: ids };
  if (options.tabIcon) newTab.icon = String(options.tabIcon).slice(0, 16);
  const insertAt = Number.isInteger(options.tabIndex) ? Math.max(0, Math.min(cell.tabs.length, options.tabIndex)) : cell.tabs.length;
  cell.tabs.splice(insertAt, 0, newTab);
  cell.activeTab = insertAt;
  syncCellTabs(cell);
  if (metrics) preserveSplitWidths(target, cellId, metrics, initialInnerWidth);
  return newTab;
}

export function dropNodesIntoExistingTab(frames, frameId, cellId, nodeIds, tabIndex, metrics) {
  const target = frames.find(f => f.id === frameId);
  if (target?.lock === true) return null;
  const cell = target && findCell(target.root, cellId);
  if (!target || !cell || cell.children || !Array.isArray(cell.tabs) || !cell.tabs.length) {
    return dropNodes(frames, frameId, cellId, nodeIds, Infinity, metrics);
  }
  const pad = target.appMode === true ? 6 : PAD;
  const framePad = target.appMode === true ? 4 : PAD;
  const gap = target.appMode === true ? 4 : GAP;
  const initialInnerWidth = metrics ? Math.max(contentMinimumWidth(target.root, metrics, pad, gap), target.size[0] - framePad * 2) : 0;
  const lockedNodeIds = new Set();
  for (const frame of frames) {
    if (frame?.lock !== true) continue;
    for (const leaf of leaves(frame.root)) {
      for (const n of leaf.nodes ?? []) lockedNodeIds.add(String(n));
      for (const tab of leaf.tabs ?? []) {
        for (const n of tab.nodes ?? []) lockedNodeIds.add(String(n));
      }
    }
  }
  const ids = [...new Set(nodeIds)].filter(id => !lockedNodeIds.has(String(id)));
  if (!ids.length) return null;
  const moving = new Set(ids.map(String));
  for (const frame of frames) {
    if (frame?.lock === true) continue;
    for (const leaf of leaves(frame.root)) {
      removeNodeFromCell(leaf, moving);
    }
  }
  const idx = Math.max(0, Math.min(cell.tabs.length - 1, Number(tabIndex) || 0));
  cell.activeTab = idx;
  const tab = cell.tabs[idx];
  tab.nodes.push(...ids);
  syncCellTabs(cell);
  if (metrics) preserveSplitWidths(target, cellId, metrics, initialInnerWidth);
  return tab;
}

export function addCellTab(frame, cellId, label = '', icon = undefined) {
  const cell = findCell(frame?.root, cellId);
  if (!cell || cell.children) throw new Error('Choose an unsplit cell to add a tab.');
  if (!Array.isArray(cell.tabs) || !cell.tabs.length) {
    const firstLabel = cell.label || 'Tab 1';
    const secondLabel = label || 'Tab 2';
    cell.tabs = [
      { id: id(), label: firstLabel, ...(cell.icon ? { icon: cell.icon } : {}), nodes: [...(cell.nodes ?? [])] },
      { id: id(), label: secondLabel, ...(icon ? { icon } : {}), nodes: [] },
    ];
    cell.activeTab = 1;
    syncCellTabs(cell);
    return cell.tabs[1];
  }
  if (cell.tabs.length >= 32) throw new Error('A panel supports up to 32 tabs.');
  const nextLabel = label || `Tab ${cell.tabs.length + 1}`;
  const tab = { id: id(), label: nextLabel, ...(icon ? { icon } : {}), nodes: [] };
  cell.tabs.push(tab);
  cell.activeTab = cell.tabs.length - 1;
  syncCellTabs(cell);
  return tab;
}

export function selectCellTab(frame, cellId, tabIndex) {
  const cell = findCell(frame?.root, cellId);
  if (!cell || cell.children || !Array.isArray(cell.tabs) || !cell.tabs.length) return;
  cell.activeTab = Math.max(0, Math.min(cell.tabs.length - 1, Number(tabIndex) || 0));
  syncCellTabs(cell);
}

export function renameCellTab(frame, cellId, tabIndex, label, icon) {
  const cell = findCell(frame?.root, cellId);
  if (!cell || cell.children || !Array.isArray(cell.tabs)) return;
  const tab = cell.tabs[tabIndex];
  if (!tab) return;
  if (label !== undefined) tab.label = String(label || 'Tab').slice(0, 120);
  if (icon !== undefined) {
    if (icon) tab.icon = String(icon).slice(0, 16);
    else delete tab.icon;
  }
  syncCellTabs(cell);
}

export function removeCellTab(frame, cellId, tabIndex, { revertSingleToUntabbed = true } = {}) {
  const cell = findCell(frame?.root, cellId);
  if (!cell || cell.children || !Array.isArray(cell.tabs) || !cell.tabs.length) return;
  const idx = Math.max(0, Math.min(cell.tabs.length - 1, Number(tabIndex) || 0));
  cell.tabs.splice(idx, 1);
  if (cell.tabs.length === 0) {
    delete cell.tabs;
    delete cell.activeTab;
    cell.nodes = [];
    return;
  }
  if (cell.tabs.length === 1 && revertSingleToUntabbed) {
    const remaining = cell.tabs[0];
    cell.nodes = [...remaining.nodes];
    if (!cell.label && remaining.label && !/^Tab \d+$/.test(remaining.label)) {
      cell.label = remaining.label;
    }
    delete cell.tabs;
    delete cell.activeTab;
    return;
  }
  cell.activeTab = Math.min(cell.activeTab ?? 0, cell.tabs.length - 1);
  syncCellTabs(cell);
}

export function moveCellTab(frames, sourceFrameId, sourceCellId, tabIndex, target, metrics) {
  const srcFrame = frames.find(f => f.id === sourceFrameId);
  const srcCell = srcFrame && findCell(srcFrame.root, sourceCellId);
  if (!srcFrame || !srcCell || srcCell.children || !Array.isArray(srcCell.tabs) || !srcCell.tabs[tabIndex]) {
    throw new Error('Source tab not found.');
  }
  const tab = srcCell.tabs[tabIndex];
  const nodeIds = [...tab.nodes];
  const tabLabel = tab.label;
  const tabIcon = tab.icon;

  // Reordering within the same cell (any non-split drop on the source cell reorders rather than deleting the tab)
  if (
    target?.frame?.id === sourceFrameId &&
    target?.cell?.id === sourceCellId &&
    !String(target?.kind ?? '').startsWith('split-') &&
    target?.kind !== 'bottom-row'
  ) {
    const destIdx = Number.isInteger(target.tabIndex)
      ? Math.max(0, Math.min(srcCell.tabs.length - 1, target.tabIndex))
      : srcCell.tabs.length - 1;
    srcCell.tabs.splice(tabIndex, 1);
    srcCell.tabs.splice(destIdx, 0, tab);
    srcCell.activeTab = destIdx;
    syncCellTabs(srcCell);
    return;
  }

  // Remove the tab from source cell first
  removeCellTab(srcFrame, sourceCellId, tabIndex, { revertSingleToUntabbed: true });

  if (!target) {
    // Detached outside all frames
    return;
  }

  if (target.kind === 'tab' && target.frame && target.cell) {
    dropNodesIntoTab(frames, target.frame.id, target.cell.id, nodeIds, {
      tabIndex: target.tabIndex,
      tabLabel,
      tabIcon,
      metrics,
    });
    return;
  }

  if (target.kind === 'split-left' || target.kind === 'split-right') {
    const newCell = insertColumnCell(frames, target.frame.id, target.cell.id, target.kind === 'split-left' ? 'left' : 'right', nodeIds, metrics);
    if (newCell && tabLabel) newCell.label = tabLabel;
    if (newCell && tabIcon) newCell.icon = tabIcon;
    return;
  }

  if (target.kind === 'split-top' || target.kind === 'split-bottom') {
    const newCell = insertRowCell(frames, target.frame.id, target.cell.id, target.kind === 'split-top' ? 'top' : 'bottom', nodeIds, metrics);
    if (newCell && tabLabel) newCell.label = tabLabel;
    if (newCell && tabIcon) newCell.icon = tabIcon;
    return;
  }

  if (target.kind === 'bottom-row' && target.frame) {
    const frame = frames.find(f => f.id === target.frame.id);
    if (!frame) return;
    addBottomRow(frame);
    const bottomCell = frame.root.children?.at(-1);
    if (bottomCell) {
      if (tabLabel) bottomCell.label = tabLabel;
      dropNodes(frames, frame.id, bottomCell.id, nodeIds, 0, metrics);
    }
    return;
  }

  if (target.frame && target.cell) {
    dropNodes(frames, target.frame.id, target.cell.id, nodeIds, target.index ?? Infinity, metrics);
  }
}

export function toggleCellCollapse(frame, cellId) {
  const cell = findCell(frame?.root, cellId);
  if (!cell || cell.children) throw new Error('Choose an unsplit panel to collapse or expand.');
  if (cell.collapsed === true) {
    delete cell.collapsed;
  } else {
    // Do not allow collapsing every sibling in the same split
    const parent = findParent(frame.root, cellId);
    if (parent && parent.children.every(c => c.id === cellId || c.collapsed === true)) {
      throw new Error('At least one panel in a split must stay expanded.');
    }
    cell.collapsed = true;
  }
}

export function toggleMaximizeCell(frame, cellId) {
  if (!frame) return;
  const cell = findCell(frame.root, cellId);
  if (!cell || cell.children) throw new Error('Choose an unsplit panel to maximize.');
  if (frame.maximizedCellId === cellId) {
    delete frame.maximizedCellId;
  } else {
    delete cell.collapsed;
    frame.maximizedCellId = cellId;
  }
}

function findParent(root, childId) {
  if (!root?.children) return null;
  if (root.children.some(c => c.id === childId)) return root;
  for (const child of root.children) {
    const found = findParent(child, childId);
    if (found) return found;
  }
  return null;
}

export function insertColumnCell(frames, frameId, cellId, side, nodeIds, metrics) {
  if (!['left', 'right'].includes(side)) throw new Error('Choose left or right column insertion.');
  const target = frames.find(f => f.id === frameId);
  if (target?.lock === true) return null;
  const cell = target && findCell(target.root, cellId);
  if (!target || !cell || cell.children) throw new Error('Drop into an unsplit cell.');
  if (leaves(target.root).length >= 256) throw new Error('A layout supports up to 256 cells.');

  const pad = target.appMode === true ? 6 : PAD;
  const framePad = target.appMode === true ? 4 : PAD;
  const gap = target.appMode === true ? 4 : GAP;
  const beforeCells = metrics ? layoutFrame(target, metrics).cells : [];
  const beforeRect = beforeCells.find(c => c.cell.id === cellId)?.rect;
  const isLeftmost = beforeRect ? Math.abs(beforeRect[0] - (target.pos[0] + framePad)) < 1 : side === 'left';
  const initialInnerWidth = metrics ? Math.max(contentMinimumWidth(target.root, metrics, pad, gap), target.size[0] - framePad * 2) : target.size[0] - framePad * 2;

  const lockedNodeIds = new Set();
  for (const frame of frames) {
    if (frame?.lock !== true) continue;
    for (const leaf of leaves(frame.root)) {
      for (const n of leaf.nodes ?? []) lockedNodeIds.add(String(n));
      for (const tab of leaf.tabs ?? []) {
        for (const n of tab.nodes ?? []) lockedNodeIds.add(String(n));
      }
    }
  }
  const ids = [...new Set(nodeIds)].filter(id => !lockedNodeIds.has(String(id)));
  if (!ids.length) return null;
  const moving = new Set(ids.map(String));
  for (const frame of frames) {
    if (frame?.lock === true) continue;
    for (const leaf of leaves(frame.root)) {
      removeNodeFromCell(leaf, moving);
    }
  }

  const nodeWidth = Math.max(160, ...ids.map(id => {
    const m = metrics?.get(id);
    return Math.max(m?.minWidth ?? 160, m?.width ?? 0);
  }));
  const newCellWidth = nodeWidth + pad * 2;
  const newCell = createCell('');
  newCell.nodes = ids;
  if (metrics) {
    for (const id of ids) {
      const m = metrics.get(id);
      if (m && m.width > m.minWidth) metrics.set(id, { ...m, minWidth: m.width });
    }
  }

  function insert(node, currentWidth) {
    if (node.children && node.axis === 'x' && node.children.some(c => c.id === cellId) && node.children.length < 16) {
      const gaps = gap * (node.children.length - 1);
      const available = Math.max(0, currentWidth - gaps);
      const weights = ratios(node);
      const widths = node.children.map((child, i) => Math.max(available * weights[i], metrics ? contentMinimumWidth(child, metrics, pad, gap) : 160 + pad * 2));
      const idx = node.children.findIndex(c => c.id === cellId);
      const insertIdx = side === 'left' ? idx : idx + 1;
      node.children.splice(insertIdx, 0, newCell);
      widths.splice(insertIdx, 0, newCellWidth);
      const total = widths.reduce((sum, w) => sum + w, 0);
      node.ratios = widths.map(w => w / total);
      return total + gap * (node.children.length - 1);
    }
    if (node.id === cellId) {
      if (cellDepth(target.root, cellId) >= 16) throw new Error('Layouts support up to 16 nested split levels.');
      const existingWidth = Math.max(currentWidth, metrics ? contentMinimumWidth(node, metrics, pad, gap) : 160 + pad * 2);
      const existingCopy = createCell(node.label);
      existingCopy.nodes = node.nodes;
      delete node.nodes;
      carryHeaderConfig(existingCopy, node);
      const children = side === 'left' ? [newCell, existingCopy] : [existingCopy, newCell];
      const widths = side === 'left' ? [newCellWidth, existingWidth] : [existingWidth, newCellWidth];
      const total = widths[0] + widths[1];
      Object.assign(node, { axis: 'x', ratios: [widths[0] / total, widths[1] / total], children });
      return total + gap;
    }
    if (!node.children || !containsCell(node, cellId)) {
      return Math.max(currentWidth, metrics ? contentMinimumWidth(node, metrics, pad, gap) : 160 + pad * 2);
    }
    if (node.axis === 'y') {
      let nextWidth = currentWidth;
      for (const child of node.children) {
        const w = containsCell(child, cellId)
          ? insert(child, currentWidth)
          : Math.max(currentWidth, metrics ? contentMinimumWidth(child, metrics, pad, gap) : 160 + pad * 2);
        nextWidth = Math.max(nextWidth, w);
      }
      return nextWidth;
    }
    const gaps = gap * (node.children.length - 1);
    const available = Math.max(0, currentWidth - gaps);
    const weights = ratios(node);
    const widths = node.children.map((child, i) => (
      containsCell(child, cellId)
        ? insert(child, available * weights[i])
        : Math.max(available * weights[i], metrics ? contentMinimumWidth(child, metrics, pad, gap) : 160 + pad * 2)
    ));
    const total = widths.reduce((sum, w) => sum + w, 0);
    if (total > 0) node.ratios = widths.map(w => w / total);
    return total + gaps;
  }

  const prevWidth = target.size[0];
  const nextInnerWidth = insert(target.root, initialInnerWidth);
  target.size[0] = Math.max(target.size[0], nextInnerWidth + framePad * 2);
  if (side === 'left' && isLeftmost) {
    target.pos[0] -= (target.size[0] - prevWidth);
  }
  return newCell;
}

export function insertRowCell(frames, frameId, cellId, side, nodeIds, metrics) {
  if (!['top', 'bottom'].includes(side)) throw new Error('Choose top or bottom row insertion.');
  const target = frames.find(f => f.id === frameId);
  if (target?.lock === true) return null;
  const cell = target && findCell(target.root, cellId);
  if (!target || !cell || cell.children) throw new Error('Drop into an unsplit cell.');
  if (leaves(target.root).length >= 256) throw new Error('A layout supports up to 256 cells.');

  const pad = target.appMode === true ? 6 : PAD;
  const framePad = target.appMode === true ? 4 : PAD;
  const gap = target.appMode === true ? 4 : GAP;
  const initialInnerWidth = metrics ? Math.max(contentMinimumWidth(target.root, metrics, pad, gap), target.size[0] - framePad * 2) : target.size[0] - framePad * 2;

  const lockedNodeIds = new Set();
  for (const frame of frames) {
    if (frame?.lock !== true) continue;
    for (const leaf of leaves(frame.root)) {
      for (const n of leaf.nodes ?? []) lockedNodeIds.add(String(n));
      for (const tab of leaf.tabs ?? []) {
        for (const n of tab.nodes ?? []) lockedNodeIds.add(String(n));
      }
    }
  }
  const ids = [...new Set(nodeIds)].filter(id => !lockedNodeIds.has(String(id)));
  if (!ids.length) return null;
  const moving = new Set(ids.map(String));
  for (const frame of frames) {
    if (frame?.lock === true) continue;
    for (const leaf of leaves(frame.root)) {
      removeNodeFromCell(leaf, moving);
    }
  }

  const newCell = createCell('');
  newCell.nodes = ids;

  function insert(node) {
    if (node.children && node.axis === 'y' && node.children.some(c => c.id === cellId) && node.children.length < 16) {
      const idx = node.children.findIndex(c => c.id === cellId);
      const insertIdx = side === 'top' ? idx : idx + 1;
      node.children.splice(insertIdx, 0, newCell);
      node.ratios = Array(node.children.length).fill(1 / node.children.length);
      return true;
    }
    if (node.id === cellId) {
      if (cellDepth(target.root, cellId) >= 16) throw new Error('Layouts support up to 16 nested split levels.');
      const existingCopy = createCell(node.label);
      existingCopy.nodes = node.nodes;
      delete node.nodes;
      carryHeaderConfig(existingCopy, node);
      const children = side === 'top' ? [newCell, existingCopy] : [existingCopy, newCell];
      Object.assign(node, { axis: 'y', ratios: [0.5, 0.5], children });
      return true;
    }
    for (const child of node.children ?? []) {
      if (containsCell(child, cellId) && insert(child)) return true;
    }
    return false;
  }

  insert(target.root);
  if (metrics) preserveSplitWidths(target, newCell.id, metrics, initialInnerWidth);
  return newCell;
}

export function applyIdePreset(frame, preset = 'vscode', metrics) {
  if (!frame) throw new Error('Frame is required.');
  const existingNodes = leaves(frame.root).flatMap(c => c.nodes ?? []);
  delete frame.maximizedCellId;
  delete frame.collapsed;
  delete frame.minimized;
  delete frame.autohide;

  if (preset === 'vscode') {
    frame.label = frame.label === 'Grid' ? 'IDE Workspace' : frame.label;
    frame.size = [Math.max(frame.size[0], 980), Math.max(frame.size[1], 640)];
    frame.fill = true;

    const sidebar = createCell('Sidebar');
    sidebar.icon = '◫';
    sidebar.tabs = [
      { id: id(), label: 'Explorer', icon: '◫', nodes: [] },
      { id: id(), label: 'Controls', icon: '☰', nodes: [] },
    ];
    sidebar.activeTab = 0;
    syncCellTabs(sidebar);

    const editor = createCell('Editor');
    editor.fill = true;
    editor.tabs = [
      { id: id(), label: 'Main View', icon: '◈', nodes: existingNodes },
      { id: id(), label: 'Pipeline', icon: '⚙', nodes: [] },
    ];
    editor.activeTab = 0;
    syncCellTabs(editor);

    const bottomPanel = createCell('Panel');
    bottomPanel.icon = '▣';
    bottomPanel.tabs = [
      { id: id(), label: 'Output', icon: '▣', nodes: [] },
      { id: id(), label: 'Console', icon: '⌘', nodes: [] },
    ];
    bottomPanel.activeTab = 0;
    syncCellTabs(bottomPanel);

    const rightArea = createCell('Workspace');
    delete rightArea.nodes;
    Object.assign(rightArea, { axis: 'y', ratios: [0.68, 0.32], children: [editor, bottomPanel] });

    const root = createCell('');
    delete root.nodes;
    Object.assign(root, { axis: 'x', ratios: [0.26, 0.74], children: [sidebar, rightArea] });
    frame.root = root;
  } else if (preset === 'dual-sidebar') {
    frame.label = frame.label === 'Grid' ? 'Studio Workspace' : frame.label;
    frame.size = [Math.max(frame.size[0], 1120), Math.max(frame.size[1], 620)];
    frame.fill = true;

    const leftSidebar = createCell('Inputs');
    leftSidebar.icon = '⊞';
    leftSidebar.tabs = [
      { id: id(), label: 'Loaders', icon: '⊞', nodes: [] },
      { id: id(), label: 'Prompts', icon: '✎', nodes: [] },
    ];
    leftSidebar.activeTab = 0;
    syncCellTabs(leftSidebar);

    const center = createCell('Viewport');
    center.fill = true;
    center.nodes = existingNodes;

    const rightSidebar = createCell('Inspector');
    rightSidebar.icon = '⚙';
    rightSidebar.tabs = [
      { id: id(), label: 'Parameters', icon: '☰', nodes: [] },
      { id: id(), label: 'Advanced', icon: '◈', nodes: [] },
    ];
    rightSidebar.activeTab = 0;
    syncCellTabs(rightSidebar);

    const root = createCell('');
    delete root.nodes;
    Object.assign(root, { axis: 'x', ratios: [0.24, 0.52, 0.24], children: [leftSidebar, center, rightSidebar] });
    frame.root = root;
  } else if (preset === 'tabbed-dashboard') {
    frame.label = frame.label === 'Grid' ? 'Tabbed Dashboard' : frame.label;
    frame.size = [Math.max(frame.size[0], 920), Math.max(frame.size[1], 600)];
    frame.fill = true;

    const left = createCell('Controls');
    left.tabs = [
      { id: id(), label: 'Prompt & Seed', icon: '✎', nodes: existingNodes },
      { id: id(), label: 'Model & LoRA', icon: '◈', nodes: [] },
      { id: id(), label: 'Sampling', icon: '⚙', nodes: [] },
    ];
    left.activeTab = 0;
    syncCellTabs(left);

    const right = createCell('Preview');
    right.fill = true;
    right.tabs = [
      { id: id(), label: 'Live Output', icon: '▣', nodes: [] },
      { id: id(), label: 'Comparison', icon: '◎', nodes: [] },
    ];
    right.activeTab = 0;
    syncCellTabs(right);

    const root = createCell('');
    delete root.nodes;
    Object.assign(root, { axis: 'x', ratios: [0.45, 0.55], children: [left, right] });
    frame.root = root;
  } else {
    throw new Error(`Unknown IDE preset: ${preset}`);
  }

  if (metrics) layoutFrame(frame, metrics);
  return frame;
}

function ratios(cell) {
  const sum = cell.ratios.reduce((a, b) => a + b, 0);
  return cell.ratios.map(r => r / sum);
}

function leafMinWidth(cell, metrics, pad = PAD) {
  if (cell.collapsed === true) return COLLAPSED_CELL_WIDTH;
  if (Array.isArray(cell.tabs) && cell.tabs.length) {
    let maxTabW = 160;
    for (const tab of cell.tabs) {
      for (const nodeId of tab.nodes ?? []) {
        maxTabW = Math.max(maxTabW, metrics?.get(nodeId)?.minWidth ?? 160);
      }
    }
    return maxTabW + pad * 2;
  }
  return Math.max(160, ...(cell.nodes ?? []).map(id => metrics?.get(id)?.minWidth ?? 160)) + pad * 2;
}

function contentMinimumWidth(cell, metrics, pad = PAD, gap = GAP) {
  if (!cell.children) return leafMinWidth(cell, metrics, pad);
  const widths = cell.children.map(child => contentMinimumWidth(child, metrics, pad, gap));
  if (cell.axis === 'y') return Math.max(...widths);
  const weights = ratios(cell);
  const collapsedTotal = cell.children.reduce((sum, child, i) => sum + (child.collapsed === true ? widths[i] : 0), 0);
  const uncollapsedWeightSum = cell.children.reduce((sum, child, i) => sum + (child.collapsed === true ? 0 : weights[i]), 0);
  let uncollapsedRequired = 0;
  if (uncollapsedWeightSum > 0) {
    for (let i = 0; i < cell.children.length; i++) {
      if (cell.children[i].collapsed === true) continue;
      const relWeight = weights[i] / uncollapsedWeightSum;
      uncollapsedRequired = Math.max(uncollapsedRequired, widths[i] / relWeight);
    }
  }
  return collapsedTotal + uncollapsedRequired + gap * (widths.length - 1);
}

export function shrinkFrame(frame, metrics) {
  delete frame.fill;
  const pad = frame.appMode === true ? 6 : PAD;
  const framePad = frame.appMode === true ? 4 : PAD;
  const gap = frame.appMode === true ? 4 : GAP;
  function fit(cell) {
    if (!cell.children) {
      delete cell.minHeightOverride;
      delete cell.fill;
      return contentMinimumWidth(cell, metrics, pad, gap);
    }
    const widths = cell.children.map(fit);
    if (cell.axis === 'y') return Math.max(...widths);
    const total = widths.reduce((sum, width) => sum + width, 0);
    // Only update ratios for uncollapsed children so collapsed panels keep their restore ratio
    if (cell.children.every(c => c.collapsed !== true)) {
      cell.ratios = widths.map(width => width / total);
    }
    return total + gap * (widths.length - 1);
  }
  frame.size[0] = fit(frame.root) + framePad * 2;
  layoutFrame(frame, metrics);
}

export function resizeDivider(cell, index, delta, available, metrics) {
  if (cell.axis === 'y' && cell.children?.[index] && cell.children?.[index + 1]) {
    // Allow resizing vertical split rows by adjusting minHeightOverride on the upper/lower child
    const weights = ratios(cell);
    const sum = weights[index] + weights[index + 1];
    const minimum = Math.min(0.05, sum / 4);
    const first = Math.max(minimum, Math.min(sum - minimum, weights[index] + delta));
    weights[index] = first;
    weights[index + 1] = sum - first;
    cell.ratios = weights;
    if (Number.isFinite(available) && available > 0) {
      const targetH = Math.max(64, Math.round(first * available));
      if (!cell.children[index].children) cell.children[index].minHeightOverride = targetH;
    }
    return;
  }
  const weights = ratios(cell);
  const sum = weights[index] + weights[index + 1];
  const minimum = Math.min(0.05, sum / 4);
  const lower = metrics && cell.axis === 'x' ? contentMinimumWidth(cell.children[index], metrics) / available : minimum;
  const upper = sum - (metrics && cell.axis === 'x' ? contentMinimumWidth(cell.children[index + 1], metrics) / available : minimum);
  // A changing content minimum may make the pair temporarily too small.
  // Keep its current split rather than forcing another frame expansion.
  const first = lower > upper ? weights[index] : Math.max(lower, Math.min(upper, weights[index] + delta));
  weights[index] = first; weights[index + 1] = sum - first;
  cell.ratios = weights;
}

// Removing a leaf releases its nodes; the graph itself is untouched.
export function deleteCell(frame, cellId) {
  const target = findCell(frame.root, cellId);
  if (!target || target.children) throw new Error('Choose an unsplit cell to delete.');
  if (frame.maximizedCellId === cellId) delete frame.maximizedCellId;
  function remove(cell) {
    if (cell.id === cellId) return null;
    if (!cell.children) return cell;
    const weights = ratios(cell);
    const remaining = cell.children.map((child, index) => ({ child: remove(child), weight: weights[index] })).filter(item => item.child);
    if (remaining.length === 1) return remaining[0].child;
    cell.children = remaining.map(item => item.child);
    const total = remaining.reduce((sum, item) => sum + item.weight, 0);
    cell.ratios = remaining.map(item => item.weight / total);
    return cell;
  }
  frame.root = remove(frame.root) ?? createCell();
}

// Removing every empty leaf collapses the tree the same way one delete does.
// Refuse when nothing would remain, so one menu click cannot wipe the grid.
export function deleteEmptyCells(frame) {
  const cells = leaves(frame.root);
  const empty = cells.filter(cell => cell.nodes.length === 0);
  if (!empty.length) throw new Error('This grid has no empty cells.');
  if (empty.length === cells.length) throw new Error('The grid has no cells with nodes.');
  for (const cell of empty) deleteCell(frame, cell.id);
  return empty.length;
}

// Preserve absolute widths on the left. Only subtrees touching the right
// boundary receive the delta, including each row of a vertical split.
export function resizeRightEdge(frame, delta, metrics) {
  resizeBoundary(frame, delta, metrics, false);
}

export function resizeLeftEdge(frame, delta, metrics) {
  resizeBoundary(frame, -delta, metrics, true);
}

function resizeBoundary(frame, delta, metrics, left) {
  if (!Number.isFinite(delta)) throw new Error('Invalid resize distance.');
  layoutFrame(frame, metrics);
  const pad = frame.appMode === true ? 6 : PAD;
  const framePad = frame.appMode === true ? 4 : PAD;
  const gap = frame.appMode === true ? 4 : GAP;
  function minimumWidth(cell) {
    if (!cell.children) return leafMinWidth(cell, metrics, pad);
    const widths = cell.children.map(minimumWidth);
    return cell.axis === 'x' ? widths.reduce((sum, width) => sum + width, 0) + gap * (widths.length - 1) : Math.max(...widths);
  }
  function room(cell, width) {
    if (!cell.children) return width - minimumWidth(cell);
    if (cell.axis === 'y') return Math.min(...cell.children.map(child => room(child, width)));
    const available = width - gap * (cell.children.length - 1);
    const last = left ? 0 : cell.children.length - 1;
    return room(cell.children[last], available * ratios(cell)[last]);
  }
  const width = frame.size[0] - framePad * 2;
  delta = Math.max(-Math.max(0, room(frame.root, width)), delta);
  if (frame.size[0] + delta > 1e7) throw new Error('Layout dimensions are too large.');
  function resize(cell, width) {
    if (!cell.children) return;
    if (cell.axis === 'y') { cell.children.forEach(child => resize(child, width)); return; }
    const available = width - gap * (cell.children.length - 1);
    const widths = ratios(cell).map(weight => weight * available);
    const last = left ? 0 : widths.length - 1;
    resize(cell.children[last], widths[last]);
    widths[last] += delta;
    cell.ratios = widths.map(childWidth => childWidth / (available + delta));
  }
  resize(frame.root, width);
  frame.size[0] += delta;
  if (left) frame.pos[0] -= delta;
}

export function addBottomRow(frame) {
  if (frame.minimized === true) throw new Error('Restore the grid before adding a bottom row.');
  if (frame.collapsed === true) throw new Error('Expand the grid before adding a bottom row.');
  if (leaves(frame.root).length >= 256) throw new Error('A layout supports up to 256 cells.');
  const height = 200;
  const root = frame.root;
  const framePad = frame.appMode === true ? 4 : PAD;
  const gap = frame.appMode === true ? 4 : GAP;
  const contentHeight = frame.size[1] - FRAME_TITLE - framePad * 2;
  const row = createCell('');
  if (root.axis === 'y' && root.children.length < 16) {
    const available = contentHeight - gap * (root.children.length - 1);
    root.ratios = [...ratios(root).map(weight => weight * available / (available + height)), height / (available + height)];
    root.children.push(row);
  } else {
    const depth = cell => cell.children ? 1 + Math.max(...cell.children.map(depth)) : 0;
    if (depth(root) >= 16) throw new Error('Layouts support up to 16 nested split levels.');
    const wrapper = createCell('Rows'); delete wrapper.nodes;
    Object.assign(wrapper, { axis: 'y', ratios: [contentHeight / (contentHeight + height), height / (contentHeight + height)], children: [root, row] });
    frame.root = wrapper;
  }
  frame.size[1] += gap + height;
}

export function layoutFrame(frame, metrics) {
  // A minimized frame hides all child nodes, leaving just the container
  // header and border. Cells and dividers are omitted. Placements are emitted
  // at the header so nodes track frame movement during drag.
  if (frame.minimized === true) {
    const borderWidth = normalizeBorder(frame.border)?.width ?? 2;
    frame.size[1] = 34 + borderWidth * 2;
    const placements = [];
    for (const cell of leaves(frame.root)) {
      syncCellTabs(cell);
      for (const nodeId of cell.nodes) {
        if (metrics.has(nodeId)) {
          // Park each folded title bar under the header, which sits above the
          // canvas and swallows pointer events, so hidden nodes can't be hit.
          placements.push({
            nodeId,
            x: frame.pos[0] + PAD,
            y: frame.pos[1] + borderWidth + Math.min(metrics.get(nodeId).titleHeight, 34),
            width: frame.size[0] - PAD * 2,
            height: 0,
            hidden: true,
          });
        }
      }
    }
    return { cells: [], dividers: [], placements };
  }

  const pad = frame.appMode === true ? 6 : PAD;
  const framePad = frame.appMode === true ? 4 : PAD;
  const gap = frame.appMode === true ? 4 : GAP;

  // A collapsed frame folds its nodes to their title bars and stacks those
  // within their respective columns flush under the header, with the frame
  // border wrapping the tallest column. Cells are omitted (no drop targets),
  // but column dividers and placements are emitted to maintain the grid
  // column structure.
  if (frame.collapsed === true) {
    function layoutCollapsed(cell, x, width, y) {
      if (!cell.children) {
        syncCellTabs(cell);
        const activeIdx = activeTabIndex(cell);
        const activeNodes = Array.isArray(cell.tabs) && cell.tabs.length
          ? (cell.tabs[activeIdx]?.nodes ?? [])
          : cell.nodes;
        const activeSet = new Set(activeNodes.map(String));
        let currentY = y;
        const placements = [];
        const cellNodes = activeNodes.filter(n => metrics.has(n));
        for (const nodeId of cellNodes) {
          const metric = metrics.get(nodeId);
          const title = metric.titleHeight;
          placements.push({
            nodeId,
            x: x + pad,
            y: currentY + title,
            width: width - pad * 2,
            height: 0,
          });
          currentY += title;
        }
        if (Array.isArray(cell.tabs) && cell.tabs.length) {
          for (const tab of cell.tabs) {
            for (const nodeId of tab.nodes) {
              if (activeSet.has(String(nodeId))) continue;
              const metric = metrics.get(nodeId);
              if (!metric) continue;
              placements.push({
                nodeId,
                x: x + pad,
                y: y + metric.titleHeight,
                width: Math.max(40, width - pad * 2),
                height: 0,
                hidden: true,
              });
            }
          }
        }
        return {
          placements,
          height: currentY - y,
          dividers: [],
        };
      }

      if (cell.axis === 'y') {
        let currentY = y;
        const placements = [];
        const dividers = [];
        cell.children.forEach(child => {
          const res = layoutCollapsed(child, x, width, currentY);
          placements.push(...res.placements);
          dividers.push(...res.dividers);
          currentY += res.height;
        });
        return {
          placements,
          height: currentY - y,
          dividers,
        };
      }

      // cell.axis === 'x'
      const available = width - gap * (cell.children.length - 1);
      const weights = ratios(cell);
      let offset = x;
      const placements = [];
      const dividers = [];
      const childResults = [];
      cell.children.forEach((child, i) => {
        const childWidth = available * weights[i];
        const res = layoutCollapsed(child, offset, childWidth, y);
        placements.push(...res.placements);
        dividers.push(...res.dividers);
        childResults.push({ offset, width: childWidth, res });
        offset += childWidth + gap;
      });

      const height = Math.max(0, ...childResults.map(c => c.res.height));

      // Emit column dividers between adjacent children
      childResults.forEach((c, i) => {
        if (i < childResults.length - 1) {
          dividers.push({
            cell,
            index: i,
            rect: [c.offset + c.width, y, gap, height],
            available,
          });
        }
      });

      return {
        placements,
        height,
        dividers,
      };
    }

    const { placements, height, dividers } = layoutCollapsed(
      frame.root,
      frame.pos[0] + framePad,
      frame.size[0] - framePad * 2,
      frame.pos[1] + FRAME_TITLE
    );

    frame.size[1] = FRAME_TITLE + height + framePad;
    return { cells: [], dividers, placements };
  }

  const allLeaves = leaves(frame.root);
  for (const leaf of allLeaves) syncCellTabs(leaf);
  if (frame.maximizedCellId && !allLeaves.some(l => l.id === frame.maximizedCellId)) {
    delete frame.maximizedCellId;
  }

  const hasNodes = allLeaves.some(cell => cell.nodes.some(n => metrics.has(n)) || (cell.tabs && cell.tabs.length > 0));
  const cellTitle = frame.autohide === true && hasNodes && !frame.appMode ? 0 : CELL_TITLE;
  const sizes = new Map();

  function minimum(cell, parentAxis = null) {
    let size;
    if (!cell.children) {
      if (Array.isArray(cell.tabs) && cell.tabs.length) {
        for (const tab of cell.tabs) {
          tab.nodes = tab.nodes.filter(n => metrics.has(n));
        }
        syncCellTabs(cell);
        let maxW = 160;
        let maxH = 64;
        for (const tab of cell.tabs) {
          const tabNodes = tab.nodes.map(n => metrics.get(n));
          const w = Math.max(160, ...tabNodes.map(n => n.minWidth));
          const h = Math.max(64, tabNodes.reduce((sum, n) => sum + n.height + n.titleHeight, 0) + Math.max(0, tabNodes.length - 1) * gap);
          maxW = Math.max(maxW, w);
          maxH = Math.max(maxH, h);
        }
        if (Number.isFinite(cell.minHeightOverride) && cell.minHeightOverride > 0) {
          maxH = Math.max(maxH, cell.minHeightOverride - cellTitle - pad * 2);
        }
        size = [maxW + pad * 2, cellTitle + pad * 2 + maxH];
      } else {
        cell.nodes = cell.nodes.filter(n => metrics.has(n));
        const nodes = cell.nodes.map(n => metrics.get(n));
        let contentH = Math.max(64, nodes.reduce((h, n) => h + n.height + n.titleHeight, 0) + Math.max(0, nodes.length - 1) * gap);
        if (Number.isFinite(cell.minHeightOverride) && cell.minHeightOverride > 0) {
          contentH = Math.max(contentH, cell.minHeightOverride - cellTitle - pad * 2);
        }
        size = [
          Math.max(160, ...nodes.map(n => n.minWidth)) + pad * 2,
          cellTitle + pad * 2 + contentH,
        ];
      }
      if (cell.collapsed === true) {
        if (parentAxis === 'y') size[1] = COLLAPSED_CELL_HEIGHT;
        else size = [COLLAPSED_CELL_WIDTH, CELL_TITLE + pad * 2];
      }
    } else {
      const children = cell.children.map(child => minimum(child, cell.axis)), weights = ratios(cell);
      const dim = cell.axis === 'x' ? 0 : 1, cross = 1 - dim;
      size = [0, 0];
      if (dim === 1) {
        const content = children.reduce((sum, child) => sum + child[1], 0);
        cell.ratios = children.map(child => child[1] / content);
        size[1] = content + gap * (children.length - 1);
      } else {
        const collapsedTotal = cell.children.reduce((sum, child, i) => sum + (child.collapsed === true ? children[i][0] : 0), 0);
        const uncollapsedWeightSum = cell.children.reduce((sum, child, i) => sum + (child.collapsed === true ? 0 : weights[i]), 0);
        let uncollapsedReq = 0;
        if (uncollapsedWeightSum > 0) {
          for (let i = 0; i < children.length; i++) {
            if (cell.children[i].collapsed === true) continue;
            const relW = weights[i] / uncollapsedWeightSum;
            uncollapsedReq = Math.max(uncollapsedReq, children[i][0] / relW);
          }
        }
        size[0] = collapsedTotal + uncollapsedReq + gap * (children.length - 1);
      }
      size[cross] = Math.max(...children.map(s => s[cross]));
    }
    sizes.set(cell.id, size);
    return size;
  }

  const min = minimum(frame.root, null);
  const size = [Math.max(frame.size[0], min[0] + framePad * 2), min[1] + FRAME_TITLE + framePad * 2];
  if (!size.every(n => Number.isFinite(n) && n <= 1e7)) throw new Error('Layout dimensions are too large. Use more balanced splits or fewer nested cells.');
  frame.size = size;
  const cells = [], dividers = [], placements = [];

  function placeLeafNodes(cell, rect, parentAxis = null) {
    if (cell.collapsed === true) {
      for (const nodeId of cell.nodes) {
        const metric = metrics.get(nodeId);
        if (!metric) continue;
        placements.push({
          nodeId,
          x: rect[0] + 2,
          y: rect[1] + Math.min(metric.titleHeight, rect[3]),
          width: Math.max(24, rect[2] - 4),
          height: 0,
          hidden: true,
        });
      }
      return;
    }

    const activeIdx = activeTabIndex(cell);
    const activeNodes = Array.isArray(cell.tabs) && cell.tabs.length
      ? (cell.tabs[activeIdx]?.nodes ?? [])
      : cell.nodes;
    const activeSet = new Set(activeNodes.map(String));

    let y = rect[1] + cellTitle + pad;
    const last = activeNodes.length - 1;
    const floor = rect[1] + rect[3] - pad;
    const filling = frame.fill === true || cell.fill === true;

    activeNodes.forEach((nodeId, index) => {
      const metric = metrics.get(nodeId);
      if (!metric) return;
      let height = metric.height;
      const owned = filling && index === last && !metric.collapsed;
      if (owned) height = Math.max(metric.minHeight, floor - y - metric.titleHeight);
      const placement = { nodeId, x: rect[0] + pad, y: y + metric.titleHeight, width: rect[2] - pad * 2, height };
      if (owned) placement.fill = true;
      placements.push(placement);
      y += metric.titleHeight + height + gap;
    });

    // Park inactive tab nodes under the cell header with hidden: true
    if (Array.isArray(cell.tabs) && cell.tabs.length) {
      for (const tab of cell.tabs) {
        for (const nodeId of tab.nodes) {
          if (activeSet.has(String(nodeId))) continue;
          const metric = metrics.get(nodeId);
          if (!metric) continue;
          placements.push({
            nodeId,
            x: rect[0] + pad,
            y: rect[1] + Math.min(metric.titleHeight, Math.max(24, cellTitle)),
            width: Math.max(40, rect[2] - pad * 2),
            height: 0,
            hidden: true,
          });
        }
      }
    }
  }

  const bodyRect = [frame.pos[0] + framePad, frame.pos[1] + FRAME_TITLE + framePad, frame.size[0] - framePad * 2, frame.size[1] - FRAME_TITLE - framePad * 2];

  // Zen Focus / Maximized Cell Mode
  if (frame.maximizedCellId) {
    const maxCell = findCell(frame.root, frame.maximizedCellId);
    if (maxCell && !maxCell.children) {
      cells.push({ cell: maxCell, rect: bodyRect, parentAxis: null, maximized: true });
      placeLeafNodes(maxCell, bodyRect, null);
      for (const leaf of allLeaves) {
        if (leaf.id === maxCell.id) continue;
        for (const nodeId of leaf.nodes) {
          const metric = metrics.get(nodeId);
          if (!metric) continue;
          placements.push({
            nodeId,
            x: frame.pos[0] + framePad,
            y: frame.pos[1] + Math.min(metric.titleHeight, FRAME_TITLE),
            width: Math.max(40, frame.size[0] - framePad * 2),
            height: 0,
            hidden: true,
          });
        }
      }
      return { cells, dividers: [], placements };
    }
  }

  function place(cell, rect, parentAxis = null) {
    if (!cell.children) {
      cells.push({ cell, rect, parentAxis });
      placeLeafNodes(cell, rect, parentAxis);
      return;
    }
    const dim = cell.axis === 'x' ? 0 : 1;
    const available = rect[dim + 2] - gap * (cell.children.length - 1);
    const weights = ratios(cell);

    let childSizes;
    if (cell.axis === 'x') {
      const collapsedCount = cell.children.filter(c => c.collapsed === true).length;
      const collapsedSpace = collapsedCount * COLLAPSED_CELL_WIDTH;
      const remaining = Math.max(0, available - collapsedSpace);
      const uncollapsedWeightSum = cell.children.reduce((sum, c, i) => sum + (c.collapsed === true ? 0 : weights[i]), 0);
      childSizes = cell.children.map((child, i) => {
        if (child.collapsed === true) return COLLAPSED_CELL_WIDTH;
        const relW = uncollapsedWeightSum > 0 ? weights[i] / uncollapsedWeightSum : 1 / Math.max(1, cell.children.length - collapsedCount);
        return remaining * relW;
      });
    } else {
      childSizes = cell.children.map((child, i) => available * weights[i]);
    }

    let offset = rect[dim];
    cell.children.forEach((child, i) => {
      const childRect = [...rect];
      childRect[dim] = offset;
      childRect[dim + 2] = childSizes[i];
      place(child, childRect, cell.axis);
      offset += childRect[dim + 2];
      if (i < cell.children.length - 1) {
        const dividerRect = [...rect];
        dividerRect[dim] = offset;
        dividerRect[dim + 2] = gap;
        dividers.push({ cell, index: i, rect: dividerRect, available });
        offset += gap;
      }
    });
  }
  place(frame.root, bodyRect, null);
  return { cells, dividers, placements };
}

export function contains(rect, point) {
  return point[0] >= rect[0] && point[1] >= rect[1] && point[0] <= rect[0] + rect[2] && point[1] <= rect[1] + rect[3];
}

// Reconstruct a whitelist of fields rather than trusting imported workflow data.
export function validateFrame(value, freshIds = false, empty = false) {
  const finitePair = (v, positive) => Array.isArray(v) && v.length === 2 && v.every(n => Number.isFinite(n) && Math.abs(n) <= 1e7 && (!positive || n >= 1));
  if (!value || !finitePair(value.pos, false) || !finitePair(value.size, true)) throw new Error('Invalid layout position or size.');
  const seen = new Set(); let count = 0;
  function read(cell, depth) {
    if (!cell || depth > 16 || ++count > 512 || typeof cell.id !== 'string' || seen.has(cell.id)) throw new Error('Invalid or overly complex cell structure.');
    seen.add(cell.id);
    const result = { id: freshIds ? id() : cell.id, label: String(cell.label ?? '').slice(0, 120) };
    if (cell.children) {
      if (!['x', 'y'].includes(cell.axis) || !Array.isArray(cell.children) || cell.children.length < 2 || cell.children.length > 16 || !Array.isArray(cell.ratios) || cell.ratios.length !== cell.children.length || !cell.ratios.every(r => Number.isFinite(r) && r > 0 && r <= 1)) throw new Error('Invalid cell split.');
      Object.assign(result, { axis: cell.axis, ratios: ratios(cell), children: cell.children.map(c => read(c, depth + 1)) });
    } else {
      if (!Array.isArray(cell.nodes)) throw new Error('Invalid cell membership.');
      result.nodes = empty ? [] : [...new Set(cell.nodes.filter(n => typeof n === 'string' || (typeof n === 'number' && Number.isFinite(n))))];
      if (Array.isArray(cell.tabs) && cell.tabs.length > 0) {
        if (cell.tabs.length > 32) throw new Error('A panel supports up to 32 tabs.');
        const tabSeenNodes = new Set();
        result.tabs = cell.tabs.map((tab, idx) => {
          if (!tab || typeof tab !== 'object') throw new Error('Invalid tab entry.');
          const tabNodes = empty || !Array.isArray(tab.nodes)
            ? []
            : [...new Set(tab.nodes.filter(n => (typeof n === 'string' || (typeof n === 'number' && Number.isFinite(n))) && !tabSeenNodes.has(String(n))))];
          for (const n of tabNodes) tabSeenNodes.add(String(n));
          const tabEntry = {
            id: freshIds || typeof tab.id !== 'string' || !tab.id ? id() : tab.id,
            label: String(tab.label ?? `Tab ${idx + 1}`).slice(0, 120) || `Tab ${idx + 1}`,
            nodes: tabNodes,
          };
          if (typeof tab.icon === 'string' && tab.icon.trim()) tabEntry.icon = tab.icon.trim().slice(0, 16);
          return tabEntry;
        });
        const active = Number.isInteger(cell.activeTab) ? cell.activeTab : 0;
        result.activeTab = Math.max(0, Math.min(result.tabs.length - 1, active));
        result.nodes = empty ? [] : result.tabs.flatMap(t => t.nodes);
      }
      const color = normalizeColor(cell.color);
      if (color) result.color = color;
      const textColor = normalizeColor(cell.textColor);
      if (textColor) result.textColor = textColor;
      const fontSize = normalizeFontSize(cell.fontSize);
      if (fontSize !== undefined) result.fontSize = fontSize;
      const headerOpacity = normalizeOpacity(cell.headerOpacity);
      if (headerOpacity !== undefined) result.headerOpacity = headerOpacity;
      const border = normalizeBorder(cell.border); if (border) result.border = border;
      if (cell.fill === true) result.fill = true;
      if (cell.collapsed === true) result.collapsed = true;
      if (typeof cell.icon === 'string' && cell.icon.trim()) result.icon = cell.icon.trim().slice(0, 16);
      if (Number.isFinite(cell.minHeightOverride) && cell.minHeightOverride >= 40 && cell.minHeightOverride <= 1e5) {
        result.minHeightOverride = Math.round(cell.minHeightOverride);
      }
    }
    return result;
  }
  if (typeof value.id !== 'string') throw new Error('Invalid grid ID.');
  const root = read(value.root, 0);
  const allLeaves = leaves(root);
  if (allLeaves.length > 256) throw new Error('A grid supports up to 256 cells.');
  const result = { id: freshIds ? id() : value.id, label: String(value.label ?? 'Grid').slice(0, 120), pos: [...value.pos], size: [...value.size], root };
  const color = normalizeColor(value.color);
  if (color) result.color = color;
  if (value.fill === true) result.fill = true;
  if (value.lock === true) result.lock = true;
  if (value.autohide === true) result.autohide = true;
  if (value.appMode === true) result.appMode = true;
  if (!freshIds && !empty && typeof value.maximizedCellId === 'string' && allLeaves.some(l => l.id === value.maximizedCellId)) {
    result.maximizedCellId = value.maximizedCellId;
  }
  if (value.collapsed === true) result.collapsed = true;
  // Meaningful only while collapsed: the nodes this frame folded shut. Nodes
  // the user had already folded are excluded, so expanding never reopens one.
  if (result.collapsed === true && Array.isArray(value.collapsedNodes)) {
    const folded = [...new Set(value.collapsedNodes.filter(n => typeof n === 'string' || (typeof n === 'number' && Number.isFinite(n))))];
    if (folded.length) result.collapsedNodes = folded;
  }
  if (value.minimized === true) result.minimized = true;
  if (result.minimized === true && Array.isArray(value.minimizedNodes)) {
    const folded = [...new Set(value.minimizedNodes.filter(n => typeof n === 'string' || (typeof n === 'number' && Number.isFinite(n))))];
    if (folded.length) result.minimizedNodes = folded;
  }
  // A frame minimized while collapsed collapses again when restored.
  if (result.minimized === true && value.restoreCollapsed === true) result.restoreCollapsed = true;
  const textColor = normalizeColor(value.textColor);
  if (textColor) result.textColor = textColor;
  const fontSize = normalizeFontSize(value.fontSize);
  if (fontSize !== undefined) result.fontSize = fontSize;
  const headerOpacity = normalizeOpacity(value.headerOpacity);
  if (headerOpacity !== undefined) result.headerOpacity = headerOpacity;
  const border = normalizeBorder(value.border); if (border) result.border = border;
  const containerColor = normalizeColor(value.containerColor);
  if (containerColor) result.containerColor = containerColor;
  const containerOpacity = normalizeOpacity(value.containerOpacity);
  if (containerOpacity !== undefined) result.containerOpacity = containerOpacity;
  const containerPattern = normalizePattern(value.containerPattern);
  if (containerPattern) result.containerPattern = containerPattern;
  const containerImage = normalizeImage(value.containerImage);
  if (containerImage) result.containerImage = containerImage;
  const containerImageMode = normalizeImageMode(value.containerImageMode);
  if (containerImageMode) result.containerImageMode = containerImageMode;
  const containerMode = normalizeContainerMode(value.containerMode);
  if (containerMode) result.containerMode = containerMode;
  return result;
}

export function exportTemplate(frame) {
  const emptyFrame = validateFrame(clone(frame), false, true);
  // Folded ids reference nodes a template does not carry.
  delete emptyFrame.collapsedNodes;
  delete emptyFrame.minimizedNodes;
  delete emptyFrame.minimized;
  delete emptyFrame.restoreCollapsed;
  delete emptyFrame.autohide;
  delete emptyFrame.maximizedCellId;
  layoutFrame(emptyFrame, new Map());
  return { kind: KIND, version: VERSION, frame: emptyFrame };
}

export function importTemplate(value, pos) {
  if ((value?.kind !== KIND && value?.kind !== LEGACY_KIND) || value.version !== VERSION) throw new Error('Choose a version 1 ComfyUI grid template JSON file.');
  const frame = validateFrame(value.frame, true, true);
  frame.pos = [...pos];
  frame.autohide = true;
  layoutFrame(frame, new Map());
  validateFrame(frame);
  return frame;
}
