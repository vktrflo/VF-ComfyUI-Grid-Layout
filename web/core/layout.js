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

// Pick the cell a node rect should land in: the cell containing the rect's
// center first (existing behavior), then the cell with the largest overlap —
// a tall node dropped onto a small cell attaches even when its center is out.
export function pickCell(layouts, rect) {
  const [x, y, width, height] = rect;
  const center = [x + width / 2, y + height / 2];
  let best = null, bestArea = 0;
  for (const layout of [...layouts].reverse()) {
    for (const cell of layout.cells) {
      const [cx, cy, cw, ch] = cell.rect;
      if (center[0] >= cx && center[0] <= cx + cw && center[1] >= cy && center[1] <= cy + ch) return { frame: layout.frame, ...cell };
      const area = Math.max(0, Math.min(x + width, cx + cw) - Math.max(x, cx)) * Math.max(0, Math.min(y + height, cy + ch) - Math.max(y, cy));
      if (area > bestArea) { bestArea = area; best = { frame: layout.frame, ...cell }; }
    }
  }
  return best;
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

export const createFrame = (pos = [0, 0]) => ({ id: id(), label: 'Grid', pos: [...pos], size: [620, 500], root: createCell() });
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
  for (const key of ['color', 'textColor', 'fontSize', 'border']) {
    if (source[key] !== undefined) { target[key] = source[key]; delete source[key]; }
  }
}

export function splitCell(frame, cellId, axis) {
  if (!['x', 'y'].includes(axis)) throw new Error('Choose a horizontal or vertical split.');
  const cell = findCell(frame.root, cellId);
  if (!cell || cell.children) throw new Error('Only an unsplit cell can be split.');
  if (cellDepth(frame.root, cellId) >= 16) throw new Error('Layouts support up to 16 nested split levels.');
  if (leaves(frame.root).length >= 256) throw new Error('A layout supports up to 256 cells.');
  const first = createCell(cell.label), second = createCell();
  first.nodes = cell.nodes;
  delete cell.nodes;
  carryHeaderConfig(first, cell);
  Object.assign(cell, { axis, ratios: [0.5, 0.5], children: [first, second] });
}

export function gridCell(frame, cellId, rows, columns) {
  if (![rows, columns].every(n => Number.isInteger(n) && n >= 1 && n <= 16) || rows * columns > 256) {
    throw new Error('Use 1–16 rows and columns, up to 256 cells.');
  }
  const cell = findCell(frame.root, cellId);
  if (!cell || cell.children) throw new Error('Choose an unsplit cell for the grid.');
  if (cellDepth(frame.root, cellId) + Number(rows > 1) + Number(columns > 1) > 16) throw new Error('Layouts support up to 16 nested split levels.');
  if (leaves(frame.root).length - 1 + rows * columns > 256) throw new Error('A layout supports up to 256 cells.');
  if (rows === 1 && columns === 1) return;
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
}

export function dropNodes(frames, frameId, cellId, nodeIds, index = Infinity) {
  const target = frames.find(f => f.id === frameId);
  const cell = target && findCell(target.root, cellId);
  if (frameId != null && (!cell || cell.children)) throw new Error('Drop into an unsplit cell.');
  const ids = [...new Set(nodeIds)];
  const moving = new Set(ids.map(String));
  for (const frame of frames) for (const leaf of leaves(frame.root)) {
    leaf.nodes = leaf.nodes.filter(n => !moving.has(String(n)));
  }
  if (cell) cell.nodes.splice(Math.min(Math.max(0, index), cell.nodes.length), 0, ...ids);
}

function ratios(cell) {
  const sum = cell.ratios.reduce((a, b) => a + b, 0);
  return cell.ratios.map(r => r / sum);
}

function contentMinimumWidth(cell, metrics) {
  if (!cell.children) return Math.max(160, ...cell.nodes.map(id => metrics.get(id)?.minWidth ?? 160)) + PAD * 2;
  const widths = cell.children.map(child => contentMinimumWidth(child, metrics));
  return cell.axis === 'y' ? Math.max(...widths) : Math.max(...widths.map((width, index) => width / ratios(cell)[index])) + GAP * (widths.length - 1);
}

export function shrinkFrame(frame, metrics) {
  function fit(cell) {
    if (!cell.children) return contentMinimumWidth(cell, metrics);
    const widths = cell.children.map(fit);
    if (cell.axis === 'y') return Math.max(...widths);
    const total = widths.reduce((sum, width) => sum + width, 0);
    cell.ratios = widths.map(width => width / total);
    return total + GAP * (widths.length - 1);
  }
  frame.size[0] = fit(frame.root) + PAD * 2;
  layoutFrame(frame, metrics);
}

export function resizeDivider(cell, index, delta, available, metrics) {
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
  function minimumWidth(cell) {
    if (!cell.children) return Math.max(160, ...cell.nodes.map(id => metrics.get(id)?.minWidth ?? 160)) + PAD * 2;
    const widths = cell.children.map(minimumWidth);
    return cell.axis === 'x' ? widths.reduce((sum, width) => sum + width, 0) + GAP * (widths.length - 1) : Math.max(...widths);
  }
  function room(cell, width) {
    if (!cell.children) return width - minimumWidth(cell);
    if (cell.axis === 'y') return Math.min(...cell.children.map(child => room(child, width)));
    const available = width - GAP * (cell.children.length - 1);
    const last = left ? 0 : cell.children.length - 1;
    return room(cell.children[last], available * ratios(cell)[last]);
  }
  const width = frame.size[0] - PAD * 2;
  delta = Math.max(-Math.max(0, room(frame.root, width)), delta);
  if (frame.size[0] + delta > 1e7) throw new Error('Layout dimensions are too large.');
  function resize(cell, width) {
    if (!cell.children) return;
    if (cell.axis === 'y') { cell.children.forEach(child => resize(child, width)); return; }
    const available = width - GAP * (cell.children.length - 1);
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
  if (frame.collapsed === true) throw new Error('Expand the grid before adding a bottom row.');
  if (leaves(frame.root).length >= 256) throw new Error('A layout supports up to 256 cells.');
  const height = 200;
  const root = frame.root;
  const contentHeight = frame.size[1] - FRAME_TITLE - PAD * 2;
  const row = createCell('');
  if (root.axis === 'y' && root.children.length < 16) {
    const available = contentHeight - GAP * (root.children.length - 1);
    root.ratios = [...ratios(root).map(weight => weight * available / (available + height)), height / (available + height)];
    root.children.push(row);
  } else {
    const depth = cell => cell.children ? 1 + Math.max(...cell.children.map(depth)) : 0;
    if (depth(root) >= 16) throw new Error('Layouts support up to 16 nested split levels.');
    const wrapper = createCell('Rows'); delete wrapper.nodes;
    Object.assign(wrapper, { axis: 'y', ratios: [contentHeight / (contentHeight + height), height / (contentHeight + height)], children: [root, row] });
    frame.root = wrapper;
  }
  frame.size[1] += GAP + height;
}

export function layoutFrame(frame, metrics) {
  // A collapsed frame folds its nodes to their title bars and stacks those
  // flush under the header, with the frame border wrapping the stack. Cells and
  // dividers are dropped, so the frame offers no drop target while folded, but
  // placements are still emitted: reflow is what carries the titles into place.
  if (frame.collapsed === true) {
    const titles = [];
    for (const cell of leaves(frame.root)) for (const nodeId of cell.nodes) {
      const metric = metrics.get(nodeId);
      if (metric) titles.push({ nodeId, title: metric.titleHeight });
    }
    let y = frame.pos[1] + FRAME_TITLE;
    const placements = titles.map(({ nodeId, title }) => {
      // Both renderers keep LiteGraph's body-origin convention, so the body
      // sits below its title bar (web/core/adapter.js).
      const placement = { nodeId, x: frame.pos[0] + PAD, y: y + title, width: frame.size[0] - PAD * 2, height: 0 };
      y += title;
      return placement;
    });
    frame.size[1] = FRAME_TITLE + (y - frame.pos[1] - FRAME_TITLE) + PAD;
    return { cells: [], dividers: [], placements };
  }
  const sizes = new Map();
  function minimum(cell) {
    let size;
    if (!cell.children) {
      cell.nodes = cell.nodes.filter(n => metrics.has(n));
      const nodes = cell.nodes.map(n => metrics.get(n));
      size = [Math.max(160, ...nodes.map(n => n.minWidth)) + PAD * 2,
        CELL_TITLE + PAD * 2 + Math.max(64, nodes.reduce((h, n) => h + n.height + n.titleHeight, 0) + Math.max(0, nodes.length - 1) * GAP)];
    } else {
      const children = cell.children.map(minimum), weights = ratios(cell);
      const dim = cell.axis === 'x' ? 0 : 1, cross = 1 - dim;
      size = [0, 0];
      if (dim === 1) {
        const content = children.reduce((sum, child) => sum + child[1], 0);
        cell.ratios = children.map(child => child[1] / content);
        size[1] = content + GAP * (children.length - 1);
      } else size[0] = Math.max(...children.map((s, i) => s[0] / weights[i])) + GAP * (children.length - 1);
      size[cross] = Math.max(...children.map(s => s[cross]));
    }
    sizes.set(cell.id, size);
    return size;
  }
  const min = minimum(frame.root);
  const size = [Math.max(frame.size[0], min[0] + PAD * 2), min[1] + FRAME_TITLE + PAD * 2];
  if (!size.every(n => Number.isFinite(n) && n <= 1e7)) throw new Error('Layout dimensions are too large. Use more balanced splits or fewer nested cells.');
  frame.size = size;
  const cells = [], dividers = [], placements = [];
  function place(cell, rect) {
    if (!cell.children) {
      cells.push({ cell, rect });
      let y = rect[1] + CELL_TITLE + PAD;
      const last = cell.nodes.length - 1;
      const floor = rect[1] + rect[3] - PAD;
      const filling = frame.fill === true;
      cell.nodes.forEach((nodeId, index) => {
        const metric = metrics.get(nodeId);
        let height = metric.height;
        const owned = filling && index === last && !metric.collapsed;
        if (owned) height = Math.max(metric.minHeight, floor - y - metric.titleHeight);
        const placement = { nodeId, x: rect[0] + PAD, y: y + metric.titleHeight, width: rect[2] - PAD * 2, height };
        if (owned) placement.fill = true;
        placements.push(placement);
        y += metric.titleHeight + height + GAP;
      });
      return;
    }
    const dim = cell.axis === 'x' ? 0 : 1;
    const available = rect[dim + 2] - GAP * (cell.children.length - 1);
    const weights = ratios(cell);
    let offset = rect[dim];
    cell.children.forEach((child, i) => {
      const childRect = [...rect];
      childRect[dim] = offset;
      childRect[dim + 2] = available * weights[i];
      place(child, childRect);
      offset += childRect[dim + 2];
      if (i < cell.children.length - 1) {
        const dividerRect = [...rect];
        dividerRect[dim] = offset;
        dividerRect[dim + 2] = GAP;
        dividers.push({ cell, index: i, rect: dividerRect, available });
        offset += GAP;
      }
    });
  }
  place(frame.root, [frame.pos[0] + PAD, frame.pos[1] + FRAME_TITLE + PAD, frame.size[0] - PAD * 2, frame.size[1] - FRAME_TITLE - PAD * 2]);
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
      const color = normalizeColor(cell.color);
      if (color) result.color = color;
      const textColor = normalizeColor(cell.textColor);
      if (textColor) result.textColor = textColor;
      const fontSize = normalizeFontSize(cell.fontSize);
      if (fontSize !== undefined) result.fontSize = fontSize;
      const border = normalizeBorder(cell.border); if (border) result.border = border;
    }
    return result;
  }
  if (typeof value.id !== 'string') throw new Error('Invalid grid ID.');
  const root = read(value.root, 0);
  if (leaves(root).length > 256) throw new Error('A grid supports up to 256 cells.');
  const result = { id: freshIds ? id() : value.id, label: String(value.label ?? 'Grid').slice(0, 120), pos: [...value.pos], size: [...value.size], root };
  const color = normalizeColor(value.color);
  if (color) result.color = color;
  if (value.fill === true) result.fill = true;
  if (value.lock === true) result.lock = true;
  if (value.collapsed === true) result.collapsed = true;
  // Meaningful only while collapsed: the nodes this frame folded shut. Nodes
  // the user had already folded are excluded, so expanding never reopens one.
  if (result.collapsed === true && Array.isArray(value.collapsedNodes)) {
    const folded = [...new Set(value.collapsedNodes.filter(n => typeof n === 'string' || (typeof n === 'number' && Number.isFinite(n))))];
    if (folded.length) result.collapsedNodes = folded;
  }
  const textColor = normalizeColor(value.textColor);
  if (textColor) result.textColor = textColor;
  const fontSize = normalizeFontSize(value.fontSize);
  if (fontSize !== undefined) result.fontSize = fontSize;
  const border = normalizeBorder(value.border); if (border) result.border = border;
  return result;
}

export function exportTemplate(frame) {
  const emptyFrame = validateFrame(clone(frame), false, true);
  // Folded ids reference nodes a template does not carry.
  delete emptyFrame.collapsedNodes;
  layoutFrame(emptyFrame, new Map());
  return { kind: KIND, version: VERSION, frame: emptyFrame };
}

export function importTemplate(value, pos) {
  if ((value?.kind !== KIND && value?.kind !== LEGACY_KIND) || value.version !== VERSION) throw new Error('Choose a version 1 ComfyUI grid template JSON file.');
  const frame = validateFrame(value.frame, true, true);
  frame.pos = [...pos];
  layoutFrame(frame, new Map());
  validateFrame(frame);
  return frame;
}
