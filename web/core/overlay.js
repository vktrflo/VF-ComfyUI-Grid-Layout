import { findCell, splitCell, gridCell, resizeDivider, addBottomRow, shrinkFrame, deleteCell, resizeRightEdge, resizeLeftEdge, normalizeColor, normalizeFontSize, normalizeBorder, normalizeOpacity, normalizePattern, normalizeImage, normalizeImageMode, normalizeContainerMode, PATTERNS, leaves, pickCell, KEY, LEGACY_KEY } from './layout.js';

const STYLE = `
.clt-overlay{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:20;font-family:var(--font-inter,Inter,Arial,sans-serif);font-size:13px;color:var(--fg-color,#e4e4e7)}
.clt-plane{position:absolute;inset:0;transform-origin:0 0;pointer-events:none}
.clt-frame,.clt-cell{position:absolute;box-sizing:border-box;pointer-events:none;border:1px solid #5d7e89;border-radius:5px}
.clt-frame{border:2px solid #7197a5}
.clt-frame-header{position:absolute;left:0;right:0;top:0;height:34px;background:var(--comfy-menu-bg,#20282c);display:flex;align-items:center;gap:8px;padding:0 8px;pointer-events:auto;cursor:move;border-radius:3px 3px 0 0;user-select:none}
.clt-frame.clt-minimized .clt-frame-header{position:absolute;left:0;right:0;top:0;bottom:0;height:auto;border-radius:3px}
.clt-port{position:absolute;width:12px;height:12px;border-radius:50%;background:#70d8be;border:2px solid #20282c;box-shadow:0 0 5px #70d8beaa;z-index:10;pointer-events:auto;box-sizing:border-box;cursor:default;transition:transform .15s ease}
.clt-port:hover{transform:scale(1.25);background:#a3f3df;box-shadow:0 0 8px #70d8bee0}
.clt-port-in{left:-6px;top:calc(50% - 6px)}
.clt-port-out{right:-6px;top:calc(50% - 6px)}
.clt-label{flex:1;min-height:1em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:.03em}
.clt-emoji,.clt-lock,.clt-collapse,.clt-minimize{flex:none}
.lg-node.clt-node-hidden{display:none !important;visibility:hidden !important;pointer-events:none !important}
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
.clt-resize-x,.clt-resize-left{position:absolute;pointer-events:auto;touch-action:none;z-index:2}
.clt-resize-x{right:-2px;top:36px;bottom:0;width:10px;cursor:ew-resize}
.clt-resize-left{left:-2px;top:36px;bottom:0;width:10px;cursor:ew-resize}
.clt-resize-x:hover,.clt-resize-left:hover{background:#70d8be55}
.clt-menu{position:fixed;z-index:10000;min-width:180px;padding:5px;background:var(--comfy-menu-bg,#20282c);color:var(--fg-color,#eee);border:1px solid #7197a5;border-radius:5px;box-shadow:0 4px 16px #0006;font-family:var(--font-inter,Inter,Arial,sans-serif);font-size:13px}
.clt-menu button{display:block;width:100%;text-align:left;padding:8px;border:0;background:none;color:inherit;cursor:pointer}.clt-menu button:hover{background:#345361}
.clt-dialog{background:var(--comfy-menu-bg,#20282c);color:var(--fg-color,#eee);border:1px solid #7197a5;border-radius:6px;padding:20px;min-width:400px;max-height:85vh;overflow-y:auto;font-family:var(--font-inter,Inter,Arial,sans-serif);font-size:14px}.clt-dialog::backdrop{background:#0007}
.clt-dialog h3{margin:0 0 12px}
.clt-dialog h4{margin:16px 0 8px;padding-bottom:4px;border-bottom:1px solid #345361;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:#70d8be}
.clt-dialog label{display:flex;justify-content:space-between;align-items:center;gap:18px;margin:10px 0}
.clt-dialog input,.clt-dialog select{background:var(--comfy-input-bg,#111b20);color:inherit;padding:6px;border:1px solid #5d7e89;border-radius:3px;max-width:200px}
.clt-dialog input[type=color]{width:160px;height:38px;padding:2px;border:1px solid #7197a5;border-radius:6px;cursor:pointer}
.clt-dialog input[type=file]{max-width:200px;font-size:12px}
.clt-dialog .clt-inline-group{display:flex;align-items:center;gap:8px}
.clt-tabs{display:flex;gap:4px;margin:12px 0 16px;border-bottom:2px solid #345361}
.clt-dialog .clt-tab{flex:1;background:#182024;color:#8ea1a9;border:1px solid #345361;border-bottom:none;border-radius:4px 4px 0 0;padding:8px 12px;font:inherit;font-size:12px;font-weight:600;cursor:pointer;text-align:center;transition:all .15s ease}
.clt-dialog .clt-tab:hover{color:#fff;background:#25343b}
.clt-dialog .clt-tab.active{color:#70d8be;background:#20282c;border-color:#70d8be #70d8be #20282c;margin-bottom:-2px;border-bottom:2px solid #20282c}
.clt-child-tabs{display:flex;gap:4px;margin:8px 0 14px;background:#182024;padding:3px;border-radius:5px;border:1px solid #345361}
.clt-dialog .clt-child-tab{flex:1;background:transparent;color:#8ea1a9;border:none;border-radius:3px;padding:6px 10px;font:inherit;font-size:12px;font-weight:600;cursor:pointer;text-align:center;transition:all .15s ease}
.clt-dialog .clt-child-tab:hover{color:#fff;background:#25343b}
.clt-dialog .clt-child-tab.active{color:#70d8be;background:#345361;box-shadow:0 1px 3px rgba(0,0,0,0.3)}
.clt-tab-panel{display:none}
.clt-tab-panel.active{display:block}
.clt-dialog footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:18px}
.clt-dialog footer .clt-reset-btn{margin-right:auto}
.clt-dialog button{padding:6px 12px;color:inherit;background:#345361;border:1px solid #7197a5;border-radius:3px;cursor:pointer}
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
const PATTERN_SVGS = {
  dots: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="2" cy="2" r="1.5" fill="rgba(255,255,255,0.15)"/></svg>')}`,
  grid: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1"/></svg>')}`,
  diagonal: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><line x1="0" y1="20" x2="20" y2="0" stroke="rgba(255,255,255,0.1)" stroke-width="1.5"/></svg>')}`,
  hexagons: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="48.5"><path d="M 14 0 L 28 8.08 L 28 24.25 L 14 32.33 L 0 24.25 L 0 8.08 Z M 14 48.5 L 28 40.42 L 28 24.25 L 14 16.17 L 0 24.25 L 0 40.42 Z" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1"/></svg>')}`,
  carbon: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><path d="M0 0h6v6H0z" fill="rgba(255,255,255,0.08)"/><path d="M6 6h6v6H6z" fill="rgba(255,255,255,0.08)"/><path d="M0 6h6v6H0z" fill="rgba(0,0,0,0.15)"/><path d="M6 0h6v6H6z" fill="rgba(0,0,0,0.15)"/></svg>')}`,
};

function hexToRgba(hex, opacity = 1) {
  if (!hex) return undefined;
  let clean = hex.startsWith('#') ? hex.slice(1) : hex;
  if (clean.length === 3) clean = clean.split('').map(c => c + c).join('');
  const n = parseInt(clean, 16);
  if (isNaN(n) || clean.length !== 6) return undefined;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

const IMAGE_CACHE = new Map();
function getImage(src, onReady) {
  if (!src) return null;
  let img = IMAGE_CACHE.get(src);
  if (!img) {
    if (typeof Image === 'undefined') return null;
    img = new Image();
    img.src = src;
    IMAGE_CACHE.set(src, img);
  }
  if (!img.complete || img.naturalWidth === 0) {
    if (onReady) img.addEventListener('load', onReady, { once: true });
    return null;
  }
  return img;
}

if (typeof Image !== 'undefined') {
  for (const svg of Object.values(PATTERN_SVGS)) {
    getImage(svg);
  }
}

function drawFrameBackground(ctx, frame, config, onDirty) {
  if (!ctx) return;
  const mode = config.containerMode || (config.containerImage ? 'image' : 'color');

  const [x, y] = frame.pos;
  const [w, h] = frame.size;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;

  const radius = 5;

  if (mode === 'image') {
    const imageSrc = config.containerImage;
    if (!imageSrc) return;
    const img = getImage(imageSrc, onDirty);
    if (!img) return;

    const opacity = config.containerOpacity ?? 1;
    const imageMode = config.containerImageMode || 'repeat';

    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = opacity;

    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(0, 0, w, h, radius);
    } else {
      ctx.moveTo(radius, 0);
      ctx.lineTo(w - radius, 0);
      ctx.arcTo(w, 0, w, radius, radius);
      ctx.lineTo(w, h - radius);
      ctx.arcTo(w, h, w - radius, h, radius);
      ctx.lineTo(radius, h);
      ctx.arcTo(0, h, 0, h - radius, radius);
      ctx.lineTo(0, radius);
      ctx.arcTo(0, 0, radius, 0, radius);
      ctx.closePath();
    }
    ctx.clip();

    if (imageMode === 'cover') {
      const imgRatio = img.naturalWidth / img.naturalHeight;
      const rectRatio = w / h;
      let sx = 0, sy = 0, sWidth = img.naturalWidth, sHeight = img.naturalHeight;
      if (rectRatio > imgRatio) {
        sHeight = img.naturalWidth / rectRatio;
        sy = (img.naturalHeight - sHeight) / 2;
      } else {
        sWidth = img.naturalHeight * rectRatio;
        sx = (img.naturalWidth - sWidth) / 2;
      }
      ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, w, h);
    } else {
      const pattern = ctx.createPattern(img, 'repeat');
      if (pattern) {
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, w, h);
      }
    }
    ctx.restore();
    return;
  }

  // mode === 'color'
  const hasColor = config.hasContainerColor !== false && Boolean(config.containerColor);
  const color = hasColor ? config.containerColor : null;
  const opacity = config.containerOpacity ?? 1;
  const rgba = color ? hexToRgba(color, opacity) : null;
  const patternKey = config.containerPattern && config.containerPattern !== 'none' ? config.containerPattern : null;

  if (!rgba && !patternKey) return;

  ctx.save();
  ctx.translate(x, y);

  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(0, 0, w, h, radius);
  } else {
    ctx.moveTo(radius, 0);
    ctx.lineTo(w - radius, 0);
    ctx.arcTo(w, 0, w, radius, radius);
    ctx.lineTo(w, h - radius);
    ctx.arcTo(w, h, w - radius, h, radius);
    ctx.lineTo(radius, h);
    ctx.arcTo(0, h, 0, h - radius, radius);
    ctx.lineTo(0, radius);
    ctx.arcTo(0, 0, radius, 0, radius);
    ctx.closePath();
  }
  ctx.clip();

  if (rgba) {
    ctx.fillStyle = rgba;
    ctx.fillRect(0, 0, w, h);
  }

  if (patternKey && PATTERN_SVGS[patternKey]) {
    const img = getImage(PATTERN_SVGS[patternKey], onDirty);
    if (img) {
      const pattern = ctx.createPattern(img, 'repeat');
      if (pattern) {
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, w, h);
      }
    }
  }

  ctx.restore();
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
  if (values.resetAppearance) {
    for (const key of ['color','textColor','fontSize','border','containerColor','containerOpacity','containerPattern','containerImage','containerImageMode','containerMode']) delete target[key];
    return;
  }
  const border = normalizeBorder(values.border); if (border) target.border = border;
  const color = normalizeColor(values.color);
  if (color) target.color = color; else delete target.color;
  const textColor = values.auto === true ? undefined : normalizeColor(values.textColor);
  if (textColor) target.textColor = textColor; else delete target.textColor;
  const fontSize = values.fontSize == null ? undefined : normalizeFontSize(values.fontSize);
  if (fontSize === undefined) delete target.fontSize; else target.fontSize = fontSize;
  if (!values.cellId) {
    const containerMode = normalizeContainerMode(values.containerMode);
    if (containerMode) target.containerMode = containerMode; else delete target.containerMode;
    const containerColor = values.hasContainerColor ? normalizeColor(values.containerColor) : undefined;
    if (containerColor) target.containerColor = containerColor; else delete target.containerColor;
    const containerOpacity = normalizeOpacity(values.containerOpacity);
    if (containerOpacity !== undefined) target.containerOpacity = containerOpacity; else delete target.containerOpacity;
    const containerPattern = normalizePattern(values.containerPattern);
    if (containerPattern) target.containerPattern = containerPattern; else delete target.containerPattern;
    const containerImage = normalizeImage(values.containerImage);
    if (containerImage) target.containerImage = containerImage; else delete target.containerImage;
    const containerImageMode = normalizeImageMode(values.containerImageMode);
    if (containerImageMode) target.containerImageMode = containerImageMode; else delete target.containerImageMode;
  }
}
function element(tag, className, text) {
  const el = document.createElement(tag);
  el.className = className;
  if (text != null) el.textContent = text;
  return el;
}
function applyBorder(el, value) {
  const border = normalizeBorder(value);
  if (border) {el.style.borderColor = border.color; el.style.borderWidth = `${border.width}px`; el.style.borderStyle = border.style;}
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
    const canvas = this.app.canvas;
    if (canvas) {
      this.origOnDrawBackground = canvas.onDrawBackground;
      canvas.onDrawBackground = (ctx, visible_area) => {
        this.origOnDrawBackground?.call(canvas, ctx, visible_area);
        this.drawCanvasBackgrounds(ctx);
      };
      this.origDrawNode = canvas.drawNode;
      canvas.drawNode = (node, ctx) => {
        if (this.hiddenNodeIds.has(String(node.id))) return;
        return this.origDrawNode?.call(canvas, node, ctx);
      };
      if (canvas.renderLink) {
        this.origRenderLink = canvas.renderLink;
        canvas.renderLink = (ctx, startPos, endPos, link, ...rest) => {
          if (link) {
            const originFrame = this.getMinimizedFrameForNode(link.origin_id);
            const targetFrame = this.getMinimizedFrameForNode(link.target_id);
            if (originFrame && targetFrame) {
              if (originFrame === targetFrame) return;
              startPos = [originFrame.pos[0] + originFrame.size[0], originFrame.pos[1] + originFrame.size[1] / 2];
              endPos = [targetFrame.pos[0], targetFrame.pos[1] + targetFrame.size[1] / 2];
            } else if (originFrame) {
              startPos = [originFrame.pos[0] + originFrame.size[0], originFrame.pos[1] + originFrame.size[1] / 2];
            } else if (targetFrame) {
              endPos = [targetFrame.pos[0], targetFrame.pos[1] + targetFrame.size[1] / 2];
            }
          }
          return this.origRenderLink?.call(canvas, ctx, startPos, endPos, link, ...rest);
        };
      }
    }
    this.menu = null; this.drag = null; this.nativeDrag = null; this.nativeNode = null; this.hover = null;
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
        if (save && (cellId !== null || value) && value !== label && graph === this.controller.graph) this.safe(() => this.controller.edit(() => {
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
    this.dialog('Grid Layout', [], () => {}, text);
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
    const dialog = element('dialog', 'clt-dialog');
    dialog.append(element('h3', '', 'Change Appearance'));
    const values = {
      ...defaults,
      fontSize: Math.max(12, Math.min(24, defaults.fontSize ?? 13)),
      containerMode: normalizeContainerMode(defaults.containerMode) ?? (defaults.containerImage ? 'image' : 'color'),
      hasContainerColor: defaults.hasContainerColor ?? Boolean(defaults.containerColor),
      containerColor: normalizeColor(defaults.containerColor) ?? '#182024',
      containerOpacity: defaults.containerOpacity ?? 0.5,
      containerPattern: defaults.containerPattern ?? 'none',
      containerImage: defaults.containerImage,
      containerImageMode: defaults.containerImageMode ?? 'repeat',
    };
    const frame = this.controller.frames.find(frame => frame.id === defaults.frameId);
    const target = defaults.cellId ? frame && findCell(frame.root, defaults.cellId) : frame;
    values.border = normalizeBorder(target?.border) ?? {color: defaults.cellId ? '#5d7e89' : '#7197a5', width: defaults.cellId ? 1 : 2, style: 'solid'};
    const preview = (reset = false) => {
      values.resetAppearance = reset;
      this.borderPreview = {frameId: defaults.frameId, cellId: defaults.cellId, ...values.border};
      this.previewBorder();
      this.headerPreview = { ...values };
      this.previewHeader();
      if (!defaults.cellId) {
        this.containerPreview = { frameId: defaults.frameId, ...values };
        this.previewContainer();
      }
    };
    const row = (parent, label, input) => {
      const el = element('label', '', label); el.append(input); parent.append(el); return el;
    };
    const colorButton = (parent, key, label) => {
      const input = document.createElement('input'); input.type = 'color';
      input.value = values[key]; input.setAttribute('aria-label', label);
      input.oninput = () => { values[key] = input.value; preview(); };
      row(parent, label, input); return input;
    };

    // --- Tab Bar ---
    const tabsContainer = element('div', 'clt-tabs');
    dialog.append(tabsContainer);

    const titlePanel = element('div', 'clt-tab-panel active');
    const borderPanel = element('div', 'clt-tab-panel');
    let containerPanel = null;
    if (!defaults.cellId) {
      containerPanel = element('div', 'clt-tab-panel');
    }

    const tabPanels = [
      { id: 'title', label: 'Title Bar', panel: titlePanel },
      { id: 'border', label: 'Border', panel: borderPanel },
    ];
    if (containerPanel) {
      tabPanels.push({ id: 'container', label: 'Grid Background', panel: containerPanel });
    }

    const tabButtons = [];
    const activateTab = (tabId) => {
      for (const item of tabPanels) {
        item.panel.classList.toggle('active', item.id === tabId);
      }
      for (const btn of tabButtons) {
        btn.classList.toggle('active', btn.dataset.tabId === tabId);
      }
    };

    for (const item of tabPanels) {
      const btn = element('button', 'clt-tab', item.label);
      btn.type = 'button';
      btn.dataset.tabId = item.id;
      if (item.id === 'title') btn.classList.add('active');
      btn.onclick = () => activateTab(item.id);
      tabButtons.push(btn);
      tabsContainer.append(btn);
    }

    dialog.append(titlePanel, borderPanel);
    if (containerPanel) dialog.append(containerPanel);

    // --- Section 1: Title Bar ---
    const background = colorButton(titlePanel, 'color', 'Title bar background color');
    const auto = document.createElement('input'); auto.type = 'checkbox'; auto.checked = values.auto;
    auto.setAttribute('aria-label', 'Auto text contrast'); row(titlePanel, 'Auto text contrast', auto);
    const text = colorButton(titlePanel, 'textColor', 'Title bar text color'); text.disabled = values.auto;
    auto.onchange = () => { values.auto = auto.checked; text.disabled = auto.checked; preview(); };
    const slider = document.createElement('input'); slider.type = 'range'; slider.min = '12'; slider.max = '24'; slider.step = '1'; slider.value = values.fontSize;
    slider.setAttribute('aria-label', 'Title font size');
    const label = row(titlePanel, `Title font size: ${values.fontSize} px`, slider);
    slider.oninput = () => { values.fontSize = Number(slider.value); label.firstChild.textContent = `Title font size: ${values.fontSize} px`; preview(); };

    // --- Section 2: Border ---
    const borderColor = document.createElement('input'); borderColor.type = 'color'; borderColor.value = values.border.color;
    borderColor.setAttribute('aria-label', 'Border color'); row(borderPanel, 'Border color', borderColor);
    borderColor.oninput = () => { values.border.color = borderColor.value; preview(); };
    const thickness = document.createElement('input'); thickness.type = 'range'; thickness.min = '1'; thickness.max = '8'; thickness.step = '1'; thickness.value = values.border.width;
    thickness.setAttribute('aria-label', 'Border thickness');
    const thicknessLabel = row(borderPanel, `Border thickness: ${values.border.width} px`, thickness);
    thickness.oninput = () => { values.border.width = Number(thickness.value); thicknessLabel.firstChild.textContent = `Border thickness: ${values.border.width} px`; preview(); };
    const style = document.createElement('select'); style.setAttribute('aria-label', 'Border style');
    for (const name of ['solid', 'dashed', 'dotted']) { const option = element('option', '', name); option.value = name; style.append(option); }
    style.value = values.border.style; row(borderPanel, 'Border style', style); style.onchange = () => { values.border.style = style.value; preview(); };

    // --- Section 3: Grid Container (Frame only) ---
    let containerCheck, containerBg, opacitySlider, opacityLabel, patternSelect, fileInput, removeImageBtn, imageStatus, imageModeSelect, imageOpacitySlider, imageOpacityLabel;
    let activateChildTab = null;
    if (containerPanel) {
      const childTabsContainer = element('div', 'clt-child-tabs');
      containerPanel.append(childTabsContainer);

      const colorPanel = element('div', 'clt-tab-panel');
      const imagePanel = element('div', 'clt-tab-panel');
      containerPanel.append(colorPanel, imagePanel);

      const childTabButtons = [];
      const childTabs = [
        { id: 'color', label: 'Color', panel: colorPanel },
        { id: 'image', label: 'Custom Image', panel: imagePanel },
      ];

      activateChildTab = (mode, shouldPreview = true) => {
        values.containerMode = mode;
        for (const item of childTabs) {
          item.panel.classList.toggle('active', item.id === mode);
        }
        for (const btn of childTabButtons) {
          btn.classList.toggle('active', btn.dataset.mode === mode);
        }
        if (shouldPreview) preview();
      };

      for (const item of childTabs) {
        const btn = element('button', 'clt-child-tab', item.label);
        btn.type = 'button';
        btn.dataset.mode = item.id;
        btn.onclick = () => activateChildTab(item.id);
        childTabButtons.push(btn);
        childTabsContainer.append(btn);
      }

      activateChildTab(values.containerMode || 'color', false);

      const syncOpacity = (val) => {
        values.containerOpacity = val;
        const pct = String(Math.round(val * 100));
        if (opacitySlider) {
          opacitySlider.value = pct;
          opacityLabel.firstChild.textContent = `Container opacity: ${pct}%`;
        }
        if (imageOpacitySlider) {
          imageOpacitySlider.value = pct;
          imageOpacityLabel.firstChild.textContent = `Image opacity: ${pct}%`;
        }
        preview();
      };

      // --- Color Child Tab ---
      const containerColorWrapper = element('div', 'clt-inline-group');
      containerCheck = document.createElement('input');
      containerCheck.type = 'checkbox';
      containerCheck.checked = values.hasContainerColor;
      containerCheck.setAttribute('aria-label', 'Enable container background color');

      containerBg = document.createElement('input');
      containerBg.type = 'color';
      containerBg.value = values.containerColor;
      containerBg.disabled = !values.hasContainerColor;
      containerBg.setAttribute('aria-label', 'Container background color');

      containerCheck.onchange = () => {
        values.hasContainerColor = containerCheck.checked;
        containerBg.disabled = !containerCheck.checked;
        preview();
      };
      containerBg.oninput = () => {
        values.containerColor = containerBg.value;
        preview();
      };
      containerColorWrapper.append(containerCheck, containerBg);
      row(colorPanel, 'Container background color', containerColorWrapper);

      opacitySlider = document.createElement('input');
      opacitySlider.type = 'range';
      opacitySlider.min = '0';
      opacitySlider.max = '100';
      opacitySlider.step = '1';
      opacitySlider.value = String(Math.round(values.containerOpacity * 100));
      opacitySlider.setAttribute('aria-label', 'Container opacity');
      opacityLabel = row(colorPanel, `Container opacity: ${opacitySlider.value}%`, opacitySlider);
      opacitySlider.oninput = () => {
        syncOpacity(Number(opacitySlider.value) / 100);
      };

      patternSelect = document.createElement('select');
      patternSelect.setAttribute('aria-label', 'Repeating pattern');
      const patternOptions = [
        ['none', 'None'],
        ['dots', 'Dots'],
        ['grid', 'Grid Lines'],
        ['diagonal', 'Diagonal Lines'],
        ['hexagons', 'Hexagons'],
        ['carbon', 'Carbon Fiber'],
      ];
      for (const [key, title] of patternOptions) {
        const option = element('option', '', title);
        option.value = key;
        patternSelect.append(option);
      }
      patternSelect.value = values.containerPattern || 'none';
      patternSelect.onchange = () => {
        values.containerPattern = patternSelect.value;
        preview();
      };
      row(colorPanel, 'Repeating pattern', patternSelect);

      // --- Custom Image Child Tab ---
      const imageWrapper = element('div', 'clt-inline-group');
      fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.setAttribute('aria-label', 'Upload custom image');

      removeImageBtn = element('button', 'clt-button', 'Clear');
      removeImageBtn.type = 'button';
      removeImageBtn.style.display = values.containerImage ? 'inline-block' : 'none';

      imageStatus = element('span', '', values.containerImage ? 'Image uploaded' : '');
      imageStatus.style.fontSize = '12px';

      fileInput.onchange = () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
          alert('Background image must be smaller than 2 MB.');
          fileInput.value = '';
          return;
        }
        const reader = new FileReader();
        reader.onload = e => {
          values.containerImage = e.target.result;
          imageStatus.textContent = 'Image uploaded';
          removeImageBtn.style.display = 'inline-block';
          if (imageModeSelect) imageModeSelect.disabled = false;
          preview();
        };
        reader.readAsDataURL(file);
      };

      removeImageBtn.onclick = () => {
        values.containerImage = undefined;
        fileInput.value = '';
        imageStatus.textContent = '';
        removeImageBtn.style.display = 'none';
        if (imageModeSelect) imageModeSelect.disabled = true;
        preview();
      };

      imageWrapper.append(fileInput, removeImageBtn, imageStatus);
      row(imagePanel, 'Custom image', imageWrapper);

      imageModeSelect = document.createElement('select');
      imageModeSelect.setAttribute('aria-label', 'Image display mode');
      for (const [mode, text] of [['repeat', 'Repeat (Tile)'], ['cover', 'Cover / Fit']]) {
        const option = element('option', '', text);
        option.value = mode;
        imageModeSelect.append(option);
      }
      imageModeSelect.value = values.containerImageMode || 'repeat';
      imageModeSelect.disabled = !values.containerImage;
      imageModeSelect.onchange = () => {
        values.containerImageMode = imageModeSelect.value;
        preview();
      };
      row(imagePanel, 'Image display mode', imageModeSelect);

      imageOpacitySlider = document.createElement('input');
      imageOpacitySlider.type = 'range';
      imageOpacitySlider.min = '0';
      imageOpacitySlider.max = '100';
      imageOpacitySlider.step = '1';
      imageOpacitySlider.value = String(Math.round(values.containerOpacity * 100));
      imageOpacitySlider.setAttribute('aria-label', 'Image opacity');
      imageOpacityLabel = row(imagePanel, `Image opacity: ${imageOpacitySlider.value}%`, imageOpacitySlider);
      imageOpacitySlider.oninput = () => {
        syncOpacity(Number(imageOpacitySlider.value) / 100);
      };
    }

    const footer = element('footer', '');
    const cancel = element('button', '', 'Cancel'), ok = element('button', '', 'OK');
    cancel.onclick = () => dialog.close();
    ok.onclick = () => { this.safe(() => submit(values)); dialog.close(); };
    const reset = element('button', 'clt-reset-btn', 'Reset appearance configuration');
    reset.type = 'button';
    reset.onclick = () => {
      const inherited = defaults.cellId ? frame : null;
      values.color = normalizeColor(inherited?.color) ?? '#20282c';
      values.auto = !normalizeColor(inherited?.textColor);
      values.textColor = normalizeColor(inherited?.textColor) ?? contrastColor(values.color);
      values.fontSize = normalizeFontSize(inherited?.fontSize) ?? 13;
      values.border = {color:defaults.cellId ? '#5d7e89' : '#7197a5',width:defaults.cellId ? 1 : 2,style:'solid'};
      background.value=values.color;auto.checked=values.auto;text.value=values.textColor;text.disabled=values.auto;
      slider.value=values.fontSize;label.firstChild.textContent=`Title font size: ${values.fontSize} px`;
      borderColor.value=values.border.color;thickness.value=values.border.width;thicknessLabel.firstChild.textContent=`Border thickness: ${values.border.width} px`;style.value=values.border.style;

      if (!defaults.cellId) {
        values.containerMode = 'color';
        values.hasContainerColor = false;
        values.containerColor = '#182024';
        values.containerOpacity = 0.5;
        values.containerPattern = 'none';
        values.containerImage = undefined;
        values.containerImageMode = 'repeat';
        if (containerCheck) containerCheck.checked = false;
        if (containerBg) { containerBg.value = values.containerColor; containerBg.disabled = true; }
        if (patternSelect) patternSelect.value = 'none';
        if (fileInput) fileInput.value = '';
        if (removeImageBtn) removeImageBtn.style.display = 'none';
        if (imageStatus) imageStatus.textContent = '';
        if (imageModeSelect) { imageModeSelect.value = 'repeat'; imageModeSelect.disabled = true; }
        if (opacitySlider) {
          opacitySlider.value = '50';
          opacityLabel.firstChild.textContent = 'Container opacity: 50%';
        }
        if (imageOpacitySlider) {
          imageOpacitySlider.value = '50';
          imageOpacityLabel.firstChild.textContent = 'Image opacity: 50%';
        }
        if (activateChildTab) activateChildTab('color', false);
      }

      preview(true);
    };
    footer.append(reset, cancel, ok); dialog.append(footer);
    dialog.onclose = () => {
      this.borderPreview = null;
      this.headerPreview = null;
      this.containerPreview = null;
      this.signature = null;
      this.app.canvas?.setDirty(true, true);
      dialog.remove();
    };
    document.body.append(dialog); dialog.showModal();
  }
  previewHeader() {
    const values = this.headerPreview;
    if (!values) return;
    const frame = this.controller.frames.find(frame => frame.id === values.frameId);
    if (!frame) return;
    const color = values.color, textColor = values.auto ? contrastColor(color) : values.textColor;
    const selectors = values.cellId ? `[data-cell-id="${values.cellId}"] .clt-cell-header` : `[data-frame-id="${values.frameId}"] .clt-frame-header`;
    for (const header of this.plane.querySelectorAll(selectors)) applyHeaderStyle(header, {color,textColor,fontSize:values.fontSize});
    if (!values.cellId) for (const cell of leaves(frame.root)) {
      const header = this.plane.querySelector(`[data-cell-id="${cell.id}"] .clt-cell-header`);
      if (header) applyHeaderStyle(header, {color:cell.color ?? color,textColor:cell.textColor ?? (values.auto ? contrastColor(cell.color ?? color) : textColor),fontSize:cell.fontSize ?? values.fontSize});
    }
  }
  previewBorder() {
    const value=this.borderPreview;if(!value)return;
    const target=this.plane.querySelector(value.cellId?`[data-cell-id="${value.cellId}"]`:`[data-frame-id="${value.frameId}"]`);
    if(target)applyBorder(target,value);
  }
  previewContainer() {
    this.app.canvas?.setDirty(true, true);
  }
  drawCanvasBackgrounds(ctx) {
    if (!ctx) return;
    const frames = this.controller.frames;
    if (!frames || !frames.length) return;
    const onDirty = () => this.app.canvas?.setDirty(true, true);
    for (const frame of frames) {
      const config = (this.containerPreview && this.containerPreview.frameId === frame.id)
        ? this.containerPreview
        : frame;
      drawFrameBackground(ctx, frame, config, onDirty);
    }
  }
  closeMenu() { this.menu?.remove(); this.menu = null; }
  showMenu(event, actions) {
    this.closeMenu();
    const menu = element('div', 'clt-menu'); menu.setAttribute('role', 'menu');
    actions = [...actions].sort((a,b) => Number(b[0].startsWith('Change Appearance')) - Number(a[0].startsWith('Change Appearance')));
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
      ['Rename cell…', () => this.dialog('Rename cell', [{ name: 'label', label: 'Cell name', optional: true, value: findCell(this.controller.frames.find(f => f.id === frameId).root, cellId).label }], ({ label }) => edit((frame, cell) => { cell.label = label; }))],
      ['Change Appearance…', () => {
        const frame = this.controller.frames.find(f => f.id === frameId);
        const cell = frame && findCell(frame.root, cellId);
        if (!cell) return;
        const color = normalizeColor(cell.color) ?? normalizeColor(frame.color) ?? '#20282c';
        this.headerConfigDialog({
          frameId, cellId, color,
          textColor: normalizeColor(cell.textColor) ?? normalizeColor(frame.textColor) ?? contrastColor(color),
          auto: !normalizeColor(cell.textColor),
          fontSize: normalizeFontSize(cell.fontSize) ?? normalizeFontSize(frame.fontSize),
        }, values => edit((targetFrame, targetCell) => applyHeaderConfig(targetCell, values)));
      }],
    ];
    const frame = this.controller.frames.find(f => f.id === frameId);
    const cell = frame && findCell(frame.root, cellId);
    this.showMenu(event, actions);
  }
  frameMenu(event, frame) {
    frame = this.controller.frames.find(f => f.id === frame.id);
    if (!frame) return;
    const actions = [
      ['Shrink grid to content', () => this.controller.edit(() => shrinkFrame(this.controller.frames.find(f => f.id === frame.id), this.controller.metrics()))],
      ['Add bottom row', () => this.controller.edit(() => addBottomRow(this.controller.frames.find(f => f.id === frame.id)))],
      ['Change Appearance…', () => {
        const color = normalizeColor(frame.color) ?? '#20282c';
        this.headerConfigDialog({
          frameId: frame.id, color,
          textColor: normalizeColor(frame.textColor) ?? contrastColor(color),
          auto: !normalizeColor(frame.textColor),
          fontSize: normalizeFontSize(frame.fontSize),
          containerMode: frame.containerMode ?? (frame.containerImage ? 'image' : 'color'),
          hasContainerColor: Boolean(normalizeColor(frame.containerColor)),
          containerColor: normalizeColor(frame.containerColor) ?? '#182024',
          containerOpacity: frame.containerOpacity ?? 0.5,
          containerPattern: frame.containerPattern ?? 'none',
          containerImage: frame.containerImage,
          containerImageMode: frame.containerImageMode ?? 'repeat',
        }, values => this.controller.edit(() => applyHeaderConfig(frame, values)));
      }],
    ];
    if (frame.fill === true) {
      actions.push(['Undo Fill cell height', () => this.controller.edit(() => {
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
    actions.push(['Export empty template', () => {
        const blob = new Blob([JSON.stringify(this.controller.export(frame), null, 2)], { type: 'application/json' });
        const link = document.createElement('a'); link.href = URL.createObjectURL(blob);
        link.download = `${frame.label.replace(/[^a-z0-9_-]/gi, '-') || 'grid'}.grid.json`; link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      }]);
    actions.push(['Remove grid (keep nodes)', () => this.controller.remove(frame.id)]);
    this.showMenu(event, actions);
  }
  // Both toggles edit through the controller so the change lands in the
  // workflow's undo history like every other frame edit.
  toggleLock(frameId) {
    this.safe(() => this.controller.edit(() => {
      const frame = this.controller.frames.find(frame => frame.id === frameId);
      if (!frame) return;
      if (frame.lock === true) delete frame.lock; else frame.lock = true;
    }));
  }
  get hiddenNodeIds() {
    const ids = new Set();
    const frames = this.controller.frames;
    if (frames) {
      for (const frame of frames) {
        if (frame.minimized === true) {
          for (const cell of leaves(frame.root)) {
            for (const n of cell.nodes) ids.add(String(n));
          }
        }
      }
    }
    return ids;
  }
  getMinimizedFrameForNode(nodeId) {
    if (nodeId == null) return null;
    const id = String(nodeId);
    for (const frame of this.controller.frames ?? []) {
      if (frame.minimized === true) {
        for (const cell of leaves(frame.root)) {
          if (cell.nodes.some(n => String(n) === id)) return frame;
        }
      }
    }
    return null;
  }
  getExternalLinks(frame) {
    const nodeIds = new Set();
    for (const cell of leaves(frame.root)) {
      for (const n of cell.nodes) nodeIds.add(String(n));
    }
    const inputs = [];
    const outputs = [];
    const links = this.controller.graph?.links;
    if (links) {
      const list = typeof links.values === 'function' ? links.values() : Object.values(links);
      for (const link of list) {
        if (!link) continue;
        const originInside = nodeIds.has(String(link.origin_id));
        const targetInside = nodeIds.has(String(link.target_id));
        if (originInside && !targetInside) {
          outputs.push(link);
        } else if (!originInside && targetInside) {
          inputs.push(link);
        }
      }
    }
    return { inputs, outputs, nodeIds };
  }
  toggleMinimize(frameId) {
    this.safe(() => this.controller.edit(() => {
      const frame = this.controller.frames.find(frame => frame.id === frameId);
      if (!frame) return;
      if (frame.minimized === true) this.restoreFrame(frame); else this.minimizeFrame(frame);
    }));
    this.app.canvas?.setDirty(true, true);
  }
  minimizeFrame(frame) {
    if (frame.collapsed === true) {
      this.expandFrame(frame);
    }
    const folded = [];
    for (const cell of leaves(frame.root)) for (const id of cell.nodes) {
      if (this.controller.adapter.fold(this.controller.graph.getNodeById(id))) folded.push(id);
    }
    frame.minimized = true;
    if (folded.length) frame.minimizedNodes = folded;
  }
  restoreFrame(frame) {
    for (const id of frame.minimizedNodes ?? []) this.controller.adapter.unfold(this.controller.graph.getNodeById(id));
    delete frame.minimizedNodes;
    delete frame.minimized;
  }
  toggleCollapse(frameId) {
    this.safe(() => this.controller.edit(() => {
      const frame = this.controller.frames.find(frame => frame.id === frameId);
      if (!frame || frame.minimized === true) return;
      if (frame.collapsed === true) this.expandFrame(frame); else this.collapseFrame(frame);
    }));
  }
  collapseFrame(frame) {
    const folded = [];
    for (const cell of leaves(frame.root)) for (const id of cell.nodes) {
      if (this.controller.adapter.fold(this.controller.graph.getNodeById(id))) folded.push(id);
    }
    frame.collapsed = true;
    if (folded.length) frame.collapsedNodes = folded;
  }
  // Unfold inside the edit and before its reflow: a folded node measures zero
  // height, so one still folded would shrink the frame we just reopened.
  expandFrame(frame) {
    for (const id of frame.collapsedNodes ?? []) this.controller.adapter.unfold(this.controller.graph.getNodeById(id));
    delete frame.collapsedNodes;
    delete frame.collapsed;
  }
  importAt(pos) {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.grid.json,.layout.json,.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return;
      if (file.size > 1024 * 1024) return this.message('Grid templates must be smaller than 1 MB.');
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
        data.pos = [...frame.pos];
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
      const pointer = this.controller.adapter.point(event);
      this.nativeNode = this.controller.graph.getNodeOnPos?.(pointer[0], pointer[1]) || null;
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
              frame.pos = [...this.drag.pos];
              if (kind === 'resize-left') resizeLeftEdge(frame, dx, this.controller.metrics());
              else resizeRightEdge(frame, dx, this.controller.metrics());
            }
            else {
              const { cell, index, weights, available } = this.drag;
              const delta = (cell.axis === 'x' ? dx : dy) / available;
              cell.ratios = [...weights]; resizeDivider(cell, index, delta, available, this.controller.metrics());
            }
          });
          this.app.canvas?.setDirty(true, true);
        } catch (error) {
          this.drag = null; this.controller.end(); this.signature = null;
          throw error;
        }
      });
    } else if (this.nativeDrag) {
      const pointer = this.controller.adapter.point(event);
      const node = this.nativeNode && this.controller.graph.getNodeById(this.nativeNode.id);
      const pick = node ? pickCell(this.controller.geometry(), [node.pos[0], node.pos[1], node.size[0], node.size[1]]) : null;
      this.hover = pick?.cell.id ?? this.controller.target(pointer)?.cell.id ?? null;
    }
  }
  up(event, cancelled = false) {
    if (this.drag && (!event || event.pointerId === this.drag.pointerId)) {
      this.drag = null; this.controller.end(); this.signature = null;
    }
    if (this.nativeDrag && (!event || event.pointerId === this.nativeDrag.pointerId)) {
      const pending = this.nativeDrag;
      if (pending.finishing) return;
      pending.finishing = true; this.nativeNode = null; this.hover = null;
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
        const data = this.controller.graph?.extra?.[KEY] ?? this.controller.graph?.extra?.[LEGACY_KEY];
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
        this.previewHeader();
        this.previewBorder();
        this.previewContainer();
        this.plane.style.transform = `translate(${ds.offset[0] * ds.scale}px,${ds.offset[1] * ds.scale}px) scale(${ds.scale})`;
      } catch (error) {
        if (!this.reportedError) { console.error('[Grid Layout]', error); this.reportedError = true; }
      }
    }
    this.animation = requestAnimationFrame(this.tick);
  }
  render(layouts) {
    const hidden = this.hiddenNodeIds;
    if (typeof document !== 'undefined') {
      for (const el of document.querySelectorAll('.lg-node')) {
        const id = el.dataset?.nodeId || el.getAttribute('data-node-id');
        if (id && hidden.has(String(id))) {
          el.classList.add('clt-node-hidden');
        } else {
          el.classList.remove('clt-node-hidden');
        }
      }
    }
    const fragment = document.createDocumentFragment();
    for (const layout of layouts) {
      const { frame } = layout;
      const el = element('section', 'clt-frame'); el.dataset.frameId = frame.id; el.setAttribute('aria-label', frame.label);
      rectStyle(el, [...frame.pos, ...frame.size]);
      applyBorder(el, frame.border);
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
      if (frame.lock === true) header.style.cursor = 'default';
      const locked = frame.lock === true;
      const lock = button(locked ? 'Unlock frame' : 'Lock frame', () => this.toggleLock(frame.id), locked ? '🔒' : '🔓');
      lock.classList.add('clt-lock');
      lock.setAttribute('aria-pressed', String(locked));
      header.append(lock);

      const minimized = frame.minimized === true;
      const minimize = button(minimized ? 'Restore grid' : 'Minimize grid', () => this.toggleMinimize(frame.id), minimized ? '◻' : '−');
      minimize.classList.add('clt-minimize');
      minimize.setAttribute('aria-expanded', String(!minimized));
      header.append(minimize);

      const collapsed = frame.collapsed === true;
      const collapse = button(collapsed ? 'Expand grid' : 'Collapse grid', () => this.toggleCollapse(frame.id), collapsed ? '▾' : '▴');
      collapse.classList.add('clt-collapse');
      collapse.setAttribute('aria-expanded', String(!collapsed));
      if (minimized) {
        collapse.style.opacity = '0.35';
        collapse.style.pointerEvents = 'none';
      }
      header.append(collapse);

      header.append(button('Grid options', e => this.frameMenu(e, frame), '•••'));
      header.onpointerdown = e => this.startDrag(e, 'move', { frame, pos: [...frame.pos] });
      el.append(header);

      // A minimized frame hides all child nodes, cells, and dividers, leaving
      // just the container header and border. External wires connect to consolidated ports.
      if (minimized) {
        el.classList.add('clt-minimized');
        const extLinks = this.getExternalLinks(frame);
        const formatLink = (link) => {
          const originNode = this.controller.graph?.getNodeById(link.origin_id);
          const targetNode = this.controller.graph?.getNodeById(link.target_id);
          const originTitle = originNode?.title || originNode?.type || `#${link.origin_id}`;
          const targetTitle = targetNode?.title || targetNode?.type || `#${link.target_id}`;
          const typeStr = link.type ? ` [${link.type}]` : '';
          return `• ${originTitle} → ${targetTitle}${typeStr}`;
        };
        if (extLinks.inputs.length > 0) {
          const inPort = element('div', 'clt-port clt-port-in');
          const count = extLinks.inputs.length;
          inPort.title = `Input (${count} wire${count > 1 ? 's' : ''}):\n` + extLinks.inputs.map(formatLink).join('\n');
          inPort.setAttribute('aria-label', `Consolidated input port with ${count} connections`);
          inPort.addEventListener('pointerdown', e => e.stopPropagation());
          el.append(inPort);
        }
        if (extLinks.outputs.length > 0) {
          const outPort = element('div', 'clt-port clt-port-out');
          const count = extLinks.outputs.length;
          outPort.title = `Output (${count} wire${count > 1 ? 's' : ''}):\n` + extLinks.outputs.map(formatLink).join('\n');
          outPort.setAttribute('aria-label', `Consolidated output port with ${count} connections`);
          outPort.addEventListener('pointerdown', e => e.stopPropagation());
          el.append(outPort);
        }
        fragment.append(el);
        continue;
      }
      // A collapsed frame hides cells and edge resize handles, but retains
      // column dividers between columns.
      if (collapsed) {
        fragment.append(el);
        for (const divider of layout.dividers.filter(divider => divider.cell.axis === 'x')) {
          const divEl = element('div', `clt-divider clt-divider-${divider.cell.axis}`);
          rectStyle(divEl, divider.rect);
          divEl.title = 'Drag to resize cells';
          divEl.setAttribute('aria-label', 'Resize cell divider');
          divEl.onpointerdown = e => this.startDrag(e, 'divider', {
            frame,
            cell: divider.cell,
            index: divider.index,
            weights: [...divider.cell.ratios],
            available: divider.available,
          });
          fragment.append(divEl);
        }
        continue;
      }
      for (const axis of ['x']) {
        const edge = element('div', `clt-resize-${axis}`);
        edge.title = axis === 'x' ? 'Drag to resize rightmost cells' : 'Drag to resize bottom cells';
        edge.setAttribute('aria-label', axis === 'x' ? 'Resize grid width' : 'Resize grid height');
        edge.onpointerdown = e => this.startDrag(e, `resize-${axis}`, { frame });
        el.append(edge);
      }
      const leftEdge = element('div', 'clt-resize-left');
      leftEdge.title = 'Drag to resize leftmost cells';
      leftEdge.setAttribute('aria-label', 'Resize grid from left');
      leftEdge.onpointerdown = event => this.startDrag(event, 'resize-left', {frame});
      el.append(leftEdge);
      fragment.append(el);
      for (const { cell, rect } of layout.cells) {
        const cellEl = element('div', `clt-cell${this.hover === cell.id ? ' clt-target' : ''}`);
        cellEl.dataset.cellId = cell.id; rectStyle(cellEl, rect);
        applyBorder(cellEl, cell.border);
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
    this.app.canvas?.setDirty(true, true);
  }
  dispose() {
    if (this.app.canvas) {
      if (this.origOnDrawBackground !== undefined) {
        this.app.canvas.onDrawBackground = this.origOnDrawBackground;
      }
      if (this.origDrawNode !== undefined) {
        this.app.canvas.drawNode = this.origDrawNode;
      }
      if (this.origRenderLink !== undefined) {
        this.app.canvas.renderLink = this.origRenderLink;
      }
    }
    this.editing?.cancel(); this.up(null, true); this.abort.abort(); cancelAnimationFrame(this.animation);
    this.closeMenu(); this.root.remove(); this.style.remove();
  }
}
