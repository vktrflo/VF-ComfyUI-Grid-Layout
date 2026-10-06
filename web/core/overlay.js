import { findCell, splitCell, gridCell, resizeDivider, addBottomRow, deleteCell, resizeRightEdge, normalizeColor, normalizeFontSize, leaves, KEY } from './layout.js';

const STYLE = `
.clt-overlay{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:20;font-family:var(--font-inter,Inter,Arial,sans-serif);font-size:13px;color:var(--fg-color,#e4e4e7)}
.clt-plane{position:absolute;inset:0;transform-origin:0 0;pointer-events:none}
.clt-frame,.clt-cell{position:absolute;box-sizing:border-box;pointer-events:none;border:1px solid #5d7e89;border-radius:5px}
.clt-frame{border:2px solid #7197a5}
.clt-frame-header{position:absolute;left:0;right:0;top:0;height:34px;background:var(--comfy-menu-bg,#20282c);display:flex;align-items:center;gap:8px;padding:0 8px;pointer-events:auto;cursor:move;border-radius:3px 3px 0 0;user-select:none}
.clt-label{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:.03em}
.clt-emoji,.clt-lock{flex:none}
.clt-title-input{flex:1;min-width:0;width:100%;box-sizing:border-box;font:inherit;color:var(--fg-color,#e4e4e7);background:var(--comfy-input-bg,#111b20);border:1px solid #70d8be;border-radius:3px;padding:2px 4px;cursor:text;outline:none}
.clt-cell-header{height:25px;display:flex;align-items:center;padding:0 6px;background:var(--comfy-menu-bg,#20282c);pointer-events:auto;user-select:none;gap:6px;border-radius:4px 4px 0 0}
.clt-button{font:inherit;color:inherit;background:transparent;border:1px solid transparent;border-radius:3px;cursor:pointer;padding:2px 6px}
.clt-button:hover,.clt-button:focus-visible{background:#345361;border-color:#7197a5;outline:none}
.clt-custom-bg .clt-button:hover,.clt-custom-bg .clt-button:focus-visible{background:rgba(128,128,128,.3);border-color:transparent}
.clt-hint{position:absolute;top:48px;left:12px;right:12px;color:#8ea1a9;font-size:12px;text-align:center;pointer-events:none}
.clt-cell.clt-target{border:2px solid #70d8be;box-shadow:inset 0 0 0 2px #70d8be33}
.clt-divider{position:absolute;pointer-events:auto;touch-action:none}
.clt-divider::after{content:'';position:absolute;background:#7197a5;opacity:.5;border-radius:2px}
.clt-divider-x{cursor:col-resize}.clt-divider-x::after{width:2px;height:32px;left:5px;top:calc(50% - 16px)}
.clt-divider-y{cursor:row-resize}.clt-divider-y::after{height:2px;width:32px;top:5px;left:calc(50% - 16px)}
.clt-divider:hover::after{opacity:1;background:#70d8be}
.clt-resize-x{position:absolute;pointer-events:auto;touch-action:none;z-index:2}
.clt-resize-x{right:-2px;top:36px;bottom:0;width:10px;cursor:ew-resize}
.clt-resize-x:hover{background:#70d8be55}
.clt-menu{position:fixed;z-index:10000;min-width:180px;padding:5px;background:var(--comfy-menu-bg,#20282c);color:var(--fg-color,#eee);border:1px solid #7197a5;border-radius:5px;box-shadow:0 4px 16px #0006;font-family:var(--font-inter,Inter,Arial,sans-serif);font-size:13px}
.clt-menu button{display:block;width:100%;text-align:left;padding:8px;border:0;background:none;color:inherit;cursor:pointer}.clt-menu button:hover{background:#345361}
.clt-dialog{background:var(--comfy-menu-bg,#20282c);color:var(--fg-color,#eee);border:1px solid #7197a5;border-radius:6px;padding:20px;min-width:280px;font-family:var(--font-inter,Inter,Arial,sans-serif);font-size:14px}.clt-dialog::backdrop{background:#0007}
.clt-dialog h3{margin:0 0 16px}.clt-dialog label{display:flex;justify-content:space-between;align-items:center;gap:18px;margin:12px 0}.clt-dialog input{background:var(--comfy-input-bg,#111b20);color:inherit;padding:6px;border:1px solid #5d7e89;border-radius:3px;max-width:200px}.clt-dialog input[type=color]{width:160px;height:42px;padding:2px;border:1px solid #7197a5;border-radius:6px;cursor:pointer}.clt-dialog footer{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}.clt-dialog button{padding:6px 12px;color:inherit;background:#345361;border:1px solid #7197a5;border-radius:3px;cursor:pointer}
`;

const HEADER_TEXT_DARK = '#101418';
const HEADER_TEXT_LIGHT = '#f4f6f7';
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(value => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(first, second) {
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
export function contrastColor(hex) {
  const background = luminance(hex);
  return contrast(background, luminance(HEADER_TEXT_DARK)) >= contrast(background, luminance(HEADER_TEXT_LIGHT)) ? HEADER_TEXT_DARK : HEADER_TEXT_LIGHT;
}
function applyHeaderStyle(el, { color, textColor, fontSize } = {}) {
  if (color) {
    el.classList.add('clt-custom-bg');
    el.style.background = color;
  }
  if (textColor) el.style.color = textColor;
  else if (color) el.style.color = contrastColor(color);
  if (fontSize) el.style.fontSize = `${fontSize}px`;
}
function applyHeaderConfig(target, values) {
  const color = normalizeColor(values.color);
  if (color) target.color = color; else delete target.color;
  const textColor = values.auto === true ? undefined : normalizeColor(values.textColor);
  if (textColor) target.textColor = textColor; else delete target.textColor;
  const fontSize = values.fontSize == null ? undefined : normalizeFontSize(values.fontSize);
  if (fontSize === undefined) delete target.fontSize; else target.fontSize = fontSize;
}
function element(tag, className, text) {
  const el = document.createElement(tag);
  el.className = className;
  if (text != null) el.textContent = text;
  return el;
}
function rectStyle(el, rect) {
  Object.assign(el.style, { left: `${rect[0]}px`, top: `${rect[1]}px`, width: `${rect[2]}px`, height: `${rect[3]}px` });
}
function button(label, action, text = label) {
  const el = element('button', 'clt-button', text);
  el.type = 'button'; el.title = label; el.setAttribute('aria-label', label);
  el.addEventListener('pointerdown', e => e.stopPropagation());
  el.addEventListener('click', e => { e.stopPropagation(); action(e); });
  return el;
}

export class LayoutOverlay {
  constructor(controller) {
    this.controller = controller;
    this.app = controller.app;
    this.abort = new AbortController();
    const style = element('style', ''); style.textContent = STYLE; document.head.append(style); this.style = style;
    this.root = element('div', 'clt-overlay');
    this.plane = element('div', 'clt-plane'); this.root.append(this.plane);
    const container = this.app.canvas.canvas.parentElement;
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    container.append(this.root);
    this.menu = null; this.drag = null; this.nativeDrag = null; this.hover = null;
    const options = { capture: true, signal: this.abort.signal };
    document.addEventListener('pointerdown', e => this.nativeDown(e), options);
    document.addEventListener('pointermove', e => this.move(e), options);
    document.addEventListener('pointerup', e => this.up(e), options);
    document.addEventListener('pointercancel', e => this.up(e, true), options);
    window.addEventListener('blur', () => this.up(null, true), { signal: this.abort.signal });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { this.closeMenu(); this.up(null, true); } }, { signal: this.abort.signal });
    this.tick = this.tick.bind(this); this.animation = requestAnimationFrame(this.tick);
  }
  safe(action) {
    try { return action(); } catch (error) { this.message(error.message); }
  }
  title(label, frameId, cellId = null) {
    const title = element('span', 'clt-label', label);
    title.title = 'Double-click to rename';
    title.ondblclick = event => {
      event.preventDefault(); event.stopPropagation();
      this.closeMenu();
      const graph = this.controller.graph;
      const input = element('input', 'clt-title-input');
      input.type = 'text'; input.value = label; input.maxLength = 120;
      input.setAttribute('aria-label', cellId ? 'Cell title' : 'Frame title');
      let finished = false;
      const finish = save => {
        if (finished) return;
        finished = true; this.editing = null; this.signature = null;
        const value = input.value.trim();
        if (save && value && value !== label && graph === this.controller.graph) this.safe(() => this.controller.edit(() => {
          const frame = this.controller.frames.find(frame => frame.id === frameId);
          const target = cellId ? frame && findCell(frame.root, cellId) : frame;
          if (target) target.label = value;
        }));
      };
      this.editing = { graph, frameId, cellId, cancel: () => finish(false) };
      input.onpointerdown = event => event.stopPropagation();
      input.ondblclick = event => event.stopPropagation();
      input.onkeydown = event => {
        event.stopPropagation();
        if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); finish(true); }
        if (event.key === 'Escape') { event.preventDefault(); finish(false); }
      };
      input.onblur = () => finish(true);
      title.replaceWith(input); input.focus(); input.select();
    };
    return title;
  }
  message(text) {
    this.dialog('Layout Templates', [], () => {}, text);
  }
  dialog(title, fields, submit, message = '') {
    const dialog = element('dialog', 'clt-dialog');
    const form = document.createElement('form'); form.method = 'dialog';
    form.append(element('h3', '', title));
    if (message) form.append(element('p', '', message));
    const inputs = {};
    for (const field of fields) {
      const label = element('label', '', field.label), input = document.createElement('input');
      input.name = field.name; input.type = field.type ?? 'text';
      input.setAttribute('aria-label', field.label);
      input.required = field.optional !== true && input.type !== 'checkbox';
      if (input.type === 'number') {
        input.min = String(field.min ?? 1); input.max = String(field.max ?? 16); input.step = String(field.step ?? 1);
        if (field.value != null) input.value = String(field.value);
      } else if (input.type === 'checkbox') {
        input.checked = field.value === true;
      } else {
        input.value = field.value;
        input.maxLength = 120;
      }
      if (field.onChange) input.addEventListener('change', () => field.onChange(input, inputs));
      label.append(input); form.append(label); inputs[field.name] = input;
    }
    for (const field of fields) field.onChange?.(inputs[field.name], inputs);
    const footer = element('footer', '');
    const cancel = element('button', '', fields.length ? 'Cancel' : 'Close'); cancel.type = 'button'; cancel.onclick = () => dialog.close();
    footer.append(cancel);
    if (fields.length) { const save = element('button', '', 'OK'); save.type = 'submit'; footer.append(save); }
    form.append(footer); dialog.append(form); document.body.append(dialog);
    form.addEventListener('submit', e => {
      e.preventDefault();
      const values = Object.fromEntries(Object.entries(inputs).map(([key, input]) => {
        if (input.type === 'number') return [key, input.value === '' ? null : Number(input.value)];
        if (input.type === 'checkbox') return [key, input.checked];
        return [key, input.value];
      }));
      dialog.close(); this.safe(() => submit(values));
    });
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.showModal();
  }
  headerConfigDialog(defaults, submit) {
    this.dialog('Header configuration', [
      { name: 'color', label: 'Background color', type: 'color', value: defaults.color },
      { name: 'auto', label: 'Auto (contrast)', type: 'checkbox', value: defaults.auto, onChange: (input, inputs) => { inputs.textColor.disabled = input.checked; } },
      { name: 'textColor', label: 'Text color', type: 'color', value: defaults.textColor },
      { name: 'fontSize', label: 'Font size (px, empty = inherit)', type: 'number', value: defaults.fontSize, optional: true, min: 8, max: 24 },
    ], submit);
  }
  closeMenu() { this.menu?.remove(); this.menu = null; }
  showMenu(event, actions) {
    this.closeMenu();
    const menu = element('div', 'clt-menu'); menu.setAttribute('role', 'menu');
    for (const [label, action] of actions) {
      const item = element('button', '', label); item.type = 'button'; item.setAttribute('role', 'menuitem');
      item.onclick = () => { this.closeMenu(); this.safe(action); }; menu.append(item);
    }
    document.body.append(menu);
    menu.style.left = `${Math.min(event.clientX, innerWidth - menu.offsetWidth - 8)}px`;
    menu.style.top = `${Math.min(event.clientY, innerHeight - menu.offsetHeight - 8)}px`;
    this.menu = menu; menu.firstElementChild.focus();
  }
  cellMenu(event, frameId, cellId) {
    const edit = action => this.controller.edit(() => {
      const frame = this.controller.frames.find(f => f.id === frameId);
      const cell = frame && findCell(frame.root, cellId);
      if (!cell) throw new Error('This cell is no longer available.');
      action(frame, cell);
    });
    const actions = [
      ['Delete cell (keep nodes)', () => edit(frame => deleteCell(frame, cellId))],
      ['Split into left / right', () => edit(frame => splitCell(frame, cellId, 'x'))],
      ['Split into top / bottom', () => edit(frame => splitCell(frame, cellId, 'y'))],
      ['Create grid…', () => this.dialog('Create cell grid', [{ name: 'rows', label: 'Rows', type: 'number', value: 2 }, { name: 'columns', label: 'Columns', type: 'number', value: 2 }], ({ rows, columns }) => edit(frame => gridCell(frame, cellId, rows, columns)))],
      ['Rename cell…', () => this.dialog('Rename cell', [{ name: 'label', label: 'Cell name', value: findCell(this.controller.frames.find(f => f.id === frameId).root, cellId).label }], ({ label }) => edit((frame, cell) => { cell.label = label; }))],
      ['Header configuration…', () => {
        const frame = this.controller.frames.find(f => f.id === frameId);
        const cell = frame && findCell(frame.root, cellId);
        if (!cell) return;
        const color = normalizeColor(cell.color) ?? normalizeColor(frame.color) ?? '#20282c';
        this.headerConfigDialog({
          color,
          textColor: normalizeColor(cell.textColor) ?? normalizeColor(frame.textColor) ?? contrastColor(color),
          auto: !normalizeColor(cell.textColor),
          fontSize: normalizeFontSize(cell.fontSize) ?? normalizeFontSize(frame.fontSize),
        }, values => edit((targetFrame, targetCell) => applyHeaderConfig(targetCell, values)));
      }],
    ];
    const frame = this.controller.frames.find(f => f.id === frameId);
    const cell = frame && findCell(frame.root, cellId);
    if (cell && (normalizeColor(cell.color) || normalizeColor(cell.textColor) || normalizeFontSize(cell.fontSize) !== undefined)) {
      actions.push(['Reset header configuration', () => edit((targetFrame, targetCell) => {
        delete targetCell.color; delete targetCell.textColor; delete targetCell.fontSize;
      })]);
    }
    this.showMenu(event, actions);
  }
  frameMenu(event, frame) {
    frame = this.controller.frames.find(f => f.id === frame.id);
    if (!frame) return;
    const actions = [
      ['Add bottom row', () => this.controller.edit(() => addBottomRow(this.controller.frames.find(f => f.id === frame.id)))],
      ['Rename layout…', () => this.dialog('Rename layout', [{ name: 'label', label: 'Layout name', value: frame.label }], ({ label }) => this.controller.edit(() => { frame.label = label; }))],
      ['Header configuration…', () => {
        const color = normalizeColor(frame.color) ?? '#20282c';
        this.headerConfigDialog({
          color,
          textColor: normalizeColor(frame.textColor) ?? contrastColor(color),
          auto: !normalizeColor(frame.textColor),
          fontSize: normalizeFontSize(frame.fontSize),
        }, values => this.controller.edit(() => applyHeaderConfig(frame, values)));
      }],
    ];
    if (normalizeColor(frame.color) || normalizeColor(frame.textColor) || normalizeFontSize(frame.fontSize) !== undefined) {
      actions.push(['Reset header configuration', () => this.controller.edit(() => {
        delete frame.color; delete frame.textColor; delete frame.fontSize;
      })]);
    }
    if (frame.fill === true) {
      actions.push(['Fit to content height', () => this.controller.edit(() => {
        delete frame.fill;
        for (const cell of leaves(frame.root)) {
          const nodeId = cell.nodes[cell.nodes.length - 1];
          const node = nodeId != null ? this.controller.graph.getNodeById(nodeId) : null;
          if (node) this.controller.adapter.releaseFill(node);
        }
      })]);
    } else {
      actions.push(['Fill cell height', () => this.controller.edit(() => { frame.fill = true; })]);
    }
    if (frame.lock === true) {
      actions.push(['Unlock frame', () => this.controller.edit(() => { delete frame.lock; })]);
    } else {
      actions.push(['Lock frame', () => this.controller.edit(() => { frame.lock = true; })]);
    }
    actions.push(['Export empty template', () => {
        const blob = new Blob([JSON.stringify(this.controller.export(frame), null, 2)], { type: 'application/json' });
        const link = document.createElement('a'); link.href = URL.createObjectURL(blob);
        link.download = `${frame.label.replace(/[^a-z0-9_-]/gi, '-') || 'layout'}.layout.json`; link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      }]);
    actions.push(['Remove layout (keep nodes)', () => this.controller.remove(frame.id)]);
    this.showMenu(event, actions);
  }
  importAt(pos) {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return;
      if (file.size > 1024 * 1024) return this.message('Layout templates must be smaller than 1 MB.');
      try { this.controller.import(JSON.parse(await file.text()), pos); }
      catch (error) { this.message(error.message); }
    };
    input.click();
  }
  startDrag(event, kind, data) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); this.closeMenu();
    this.safe(() => {
      const frame = this.controller.frames.find(f => f.id === data.frame.id);
      if (!frame) return;
      data.frame = frame;
      if (frame.lock === true) return; // locked frames ignore header, edge, and divider drags
      if (kind === 'move') data.pos = [...frame.pos];
      if (kind.startsWith('resize')) {
        data.size = [...frame.size];
        data.root = structuredClone(frame.root);
      }
      if (kind === 'divider') {
        data.cell = findCell(frame.root, data.cell.id);
        data.weights = [...data.cell.ratios];
      }
      this.controller.begin();
      this.drag = { kind, ...data, start: this.controller.adapter.point(event), graph: this.controller.graph, pointerId: event.pointerId };
    });
  }
  nativeDown(event) {
    if (this.menu && !this.menu.contains(event.target)) this.closeMenu();
    if (event.button !== 0 || this.drag || event.target.closest?.('.clt-overlay,.clt-menu,.clt-dialog,input,textarea,button,select,[contenteditable="true"]')) return;
    const container = this.app.canvas.canvas.parentElement;
    if (!container.contains(event.target) || this.app.configuringGraph) return;
    // Start before the native renderer moves anything. Its nested history
    // events are then grouped with our drop/reflow into the same undo step.
    this.safe(() => {
      if (!this.controller.frames.length) return;
      this.controller.begin();
      this.nativeDrag = { before: this.controller.snapshot(), graph: this.controller.graph, pointerId: event.pointerId };
    });
  }
  move(event) {
    if (this.drag && event.pointerId === this.drag.pointerId) {
      event.preventDefault(); event.stopPropagation();
      if (this.drag.graph !== this.controller.graph) return this.up(null, true);
      const point = this.controller.adapter.point(event), dx = point[0] - this.drag.start[0], dy = point[1] - this.drag.start[1];
      this.safe(() => {
        try {
          this.controller.edit(() => {
            const { frame, kind } = this.drag;
            if (kind === 'move') frame.pos = [this.drag.pos[0] + dx, this.drag.pos[1] + dy];
            else if (kind.startsWith('resize')) {
              frame.root = structuredClone(this.drag.root);
              frame.size = [...this.drag.size];
              resizeRightEdge(frame, dx, this.controller.metrics());
            }
            else {
              const { cell, index, weights, available } = this.drag;
              const delta = (cell.axis === 'x' ? dx : dy) / available;
              cell.ratios = [...weights]; resizeDivider(cell, index, delta);
            }
          });
        } catch (error) {
          this.drag = null; this.controller.end(); this.signature = null;
          throw error;
        }
      });
    } else if (this.nativeDrag) {
      this.hover = this.controller.target(this.controller.adapter.point(event))?.cell.id ?? null;
    }
  }
  up(event, cancelled = false) {
    if (this.drag && (!event || event.pointerId === this.drag.pointerId)) {
      this.drag = null; this.controller.end(); this.signature = null;
    }
    if (this.nativeDrag && (!event || event.pointerId === this.nativeDrag.pointerId)) {
      const pending = this.nativeDrag;
      if (pending.finishing) return;
      pending.finishing = true; this.hover = null;
      // Wait for the renderer's pointer-up handler to finish final snapping.
      requestAnimationFrame(() => {
        this.safe(() => {
          if (!cancelled && pending.graph === this.controller.graph) this.controller.finishNativeDrag(pending.before);
        });
        this.nativeDrag = null; this.controller.end(); this.signature = null;
      });
    }
  }
  tick() {
    if (!this.root.isConnected) return;
    if (!this.app.configuringGraph) {
      try {
        const layouts = this.controller.geometry();
        const { ds } = this.app.canvas;
        const signature = JSON.stringify([this.controller.graph?.id, layouts, ds.scale, [...ds.offset], this.hover]);
        const data = this.controller.graph?.extra?.[KEY];
        if (this.editing) {
          const frame = this.controller.frames.find(frame => frame.id === this.editing.frameId);
          if (this.editing.graph !== this.controller.graph || !frame || (this.editing.cellId && !findCell(frame.root, this.editing.cellId))) this.editing.cancel();
        }
        if (!this.editing && (signature !== this.signature || data !== this.renderedData)) {
          // Content can grow asynchronously (previews, conditional widgets,
          // Nodes 2.0 DOM measurement). Keep the attached stack coherent.
          if (!this.drag && !this.nativeDrag && this.controller.frames.length) this.controller.reflow();
          this.signature = signature; this.renderedData = data; this.render(layouts);
        }
        this.plane.style.transform = `translate(${ds.offset[0] * ds.scale}px,${ds.offset[1] * ds.scale}px) scale(${ds.scale})`;
      } catch (error) {
        if (!this.reportedError) { console.error('[Layout Templates]', error); this.reportedError = true; }
      }
    }
    this.animation = requestAnimationFrame(this.tick);
  }
  render(layouts) {
    const fragment = document.createDocumentFragment();
    for (const layout of layouts) {
      const { frame } = layout;
      const el = element('section', 'clt-frame'); el.dataset.frameId = frame.id; el.setAttribute('aria-label', frame.label);
      rectStyle(el, [...frame.pos, ...frame.size]);
      const header = element('div', 'clt-frame-header');
      applyHeaderStyle(header, {
        color: normalizeColor(frame.color),
        textColor: normalizeColor(frame.textColor),
        fontSize: normalizeFontSize(frame.fontSize),
      });
      const badge = element('span', 'clt-emoji', '🌀');
      badge.setAttribute('aria-hidden', 'true');
      header.append(badge);
      header.append(this.title(frame.label, frame.id));
      if (frame.lock === true) {
        header.style.cursor = 'default';
        const lock = element('span', 'clt-lock', '🔒');
        lock.title = 'Locked';
        header.append(lock);
      }
      header.append(button('Layout options', e => this.frameMenu(e, frame), '•••'));
      header.onpointerdown = e => this.startDrag(e, 'move', { frame, pos: [...frame.pos] });
      el.append(header);
      for (const axis of ['x']) {
        const edge = element('div', `clt-resize-${axis}`);
        edge.title = axis === 'x' ? 'Drag to resize rightmost cells' : 'Drag to resize bottom cells';
        edge.setAttribute('aria-label', axis === 'x' ? 'Resize layout width' : 'Resize layout height');
        edge.onpointerdown = e => this.startDrag(e, `resize-${axis}`, { frame });
        el.append(edge);
      }
      fragment.append(el);
      for (const { cell, rect } of layout.cells) {
        const cellEl = element('div', `clt-cell${this.hover === cell.id ? ' clt-target' : ''}`);
        cellEl.dataset.cellId = cell.id; rectStyle(cellEl, rect);
        const cellHeader = element('div', 'clt-cell-header');
        applyHeaderStyle(cellHeader, {
          color: normalizeColor(cell.color) ?? normalizeColor(frame.color),
          textColor: normalizeColor(cell.textColor) ?? normalizeColor(frame.textColor),
          fontSize: normalizeFontSize(cell.fontSize) ?? normalizeFontSize(frame.fontSize),
        });
        cellHeader.append(this.title(cell.label, frame.id, cell.id));
        cellHeader.append(button('Cell options', e => this.cellMenu(e, frame.id, cell.id), '+'));
        cellEl.append(cellHeader);
        if (!cell.nodes.length) cellEl.append(element('div', 'clt-hint', 'Drop nodes here'));
        fragment.append(cellEl);
      }
      for (const divider of layout.dividers.filter(divider => divider.cell.axis === 'x')) {
        const el = element('div', `clt-divider clt-divider-${divider.cell.axis}`); rectStyle(el, divider.rect);
        el.title = 'Drag to resize cells'; el.setAttribute('aria-label', 'Resize cell divider');
        el.onpointerdown = e => this.startDrag(e, 'divider', { frame, cell: divider.cell, index: divider.index, weights: [...divider.cell.ratios], available: divider.available });
        fragment.append(el);
      }
    }
    this.plane.replaceChildren(fragment);
  }
  dispose() {
    this.editing?.cancel(); this.up(null, true); this.abort.abort(); cancelAnimationFrame(this.animation);
    this.closeMenu(); this.root.remove(); this.style.remove();
  }
}
