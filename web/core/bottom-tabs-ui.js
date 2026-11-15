import {
  BOTTOM_TAB_BAR_HEIGHT,
  GROUP_TAB_HEADER_HEIGHT,
  isPreviewWidget,
  createAutoNodeTabs,
  syncNodeTabConfig,
  selectNodeBottomTab,
  renameNodeBottomTab,
  addCustomNodeBottomTab,
  removeSingleNodeBottomTab,
  assignWidgetToNodeTab,
  setNodeTabsSizing,
  selectStackTab,
  renameStackTab,
  toggleGroupTabLayoutMode,
  setStackSizing,
} from './bottom-tabs.js';

export const BOTTOM_TABS_STYLE = `
.clt-bottom-tab-bar{position:absolute;box-sizing:border-box;height:${BOTTOM_TAB_BAR_HEIGHT}px;background:var(--comfy-menu-bg,#1b2226);border:1px solid #5d7e89;border-top:1px solid #354952;border-radius:0 0 7px 7px;display:flex;align-items:center;gap:3px;padding:0 5px;pointer-events:auto;user-select:none;box-shadow:0 6px 16px rgba(0,0,0,.38);z-index:6;cursor:move}
.clt-bottom-tab-bar.clt-bottom-inner{border-radius:0;border-bottom:none;background:#1e2429;border-color:#465d66}
.clt-bottom-tab-bar.clt-bottom-drop-active{border-color:#f59e0b;box-shadow:0 0 0 2px rgba(245,158,11,.35)}
.clt-bottom-tab-scroll{display:flex;align-items:center;gap:3px;flex:1;min-width:0;overflow-x:auto;scrollbar-width:none;height:100%}
.clt-bottom-tab-scroll::-webkit-scrollbar{display:none}
.clt-bottom-tab{position:relative;display:inline-flex;align-items:center;gap:4px;height:21px;padding:0 7px;border-radius:0 0 4px 4px;background:rgba(15,22,26,.72);color:#9fb0b7;border:1px solid transparent;border-top:2px solid transparent;font:inherit;font-size:11px;cursor:grab;user-select:none;flex-shrink:0;max-width:155px;transition:background .12s ease,color .12s ease}
.clt-bottom-tab:hover{background:rgba(52,83,97,.58);color:#f4f6f7}
.clt-bottom-tab.active{background:rgba(112,216,190,.16);color:#70d8be;border-color:rgba(112,216,190,.38);border-top-color:#70d8be;font-weight:600}
.clt-bottom-tab.dragging{opacity:.42;border-color:#70d8be;border-style:dashed}
.clt-bottom-tab.clt-tab-merge-target{background:rgba(245,158,11,.28);border-color:#f59e0b;color:#fff;box-shadow:0 0 0 1px rgba(245,158,11,.55)}
.clt-bottom-tab.clt-tab-insert-before::after,.clt-bottom-tab.clt-tab-insert-after::after{content:"";position:absolute;top:1px;bottom:1px;width:2px;background:#f59e0b;border-radius:1px;box-shadow:0 0 6px #f59e0b;pointer-events:none}
.clt-bottom-tab.clt-tab-insert-before::after{left:-2px}
.clt-bottom-tab.clt-tab-insert-after::after{right:-2px}
.clt-bottom-tab-accent{width:7px;height:7px;border-radius:999px;flex-shrink:0}
.clt-bottom-tab-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:110px}
.clt-bottom-port-dot{width:6px;height:6px;border-radius:999px;background:#70d8be;box-shadow:0 0 5px #70d8be;flex-shrink:0}
.clt-group-tab-box{position:absolute;box-sizing:border-box;pointer-events:none;border-radius:7px 7px 0 0;border:1.5px solid #3f789e;border-bottom:none;background:rgba(63,120,158,.09);z-index:1}
.clt-group-tab-header{height:${GROUP_TAB_HEADER_HEIGHT}px;display:flex;align-items:center;justify-content:space-between;gap:6px;padding:0 8px;border-bottom:1px solid rgba(255,255,255,.09);pointer-events:auto;cursor:move;user-select:none;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
.clt-section-hidden{display:none !important}
.lg-node.clt-has-bottom-tabs{border-bottom-left-radius:0 !important;border-bottom-right-radius:0 !important}
`;

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function isCanvasConnectingWire(canvas) {
  if (!canvas) return false;
  return Boolean(
    (Array.isArray(canvas.connecting_links) && canvas.connecting_links.length > 0) ||
    canvas.connecting_node != null ||
    canvas.connecting_output != null ||
    canvas.connecting_input != null ||
    canvas.linkConnector?.isConnecting ||
    canvas.state?.connectingLink
  );
}

export function updateWirePeekState(controller, canvas, pointer) {
  const map = controller?.peekedPortsNodes;
  if (!map) return false;
  const prevSig = map.size ? [...map.entries()].map(([k, v]) => `${k}:${v}`).join(',') : '';
  map.clear();

  if (isCanvasConnectingWire(canvas) && Array.isArray(pointer)) {
    const [px, py] = pointer;
    const titleH = controller.adapter?.classicTitle ?? 30;
    for (const [nodeId, cfg] of Object.entries(controller.nodeTabs ?? {})) {
      const synced = syncNodeTabConfig(cfg);
      if (!synced) continue;
      const curTab = synced.tabs[synced.activeTab];
      if (curTab?.includePorts) continue;
      const portsIdx = synced.tabs.findIndex(t => t.includePorts);
      if (portsIdx === -1) continue;
      const node = controller.graph?.getNodeById?.(nodeId);
      if (!node?.pos || !node?.size || node.flags?.collapsed) continue;
      const nx = node.pos[0] - 18;
      const ny = node.pos[1] - titleH - 18;
      const nw = node.size[0] + 36;
      const nh = node.size[1] + titleH + BOTTOM_TAB_BAR_HEIGHT + 36;
      if (px >= nx && px <= nx + nw && py >= ny && py <= ny + nh) {
        map.set(String(nodeId), portsIdx);
      }
    }
  }

  const nextSig = map.size ? [...map.entries()].map(([k, v]) => `${k}:${v}`).join(',') : '';
  return prevSig !== nextSig;
}

export function effectiveNodeTabIndex(controller, nodeId, cfg) {
  const peek = controller?.peekedPortsNodes?.get?.(String(nodeId));
  if (Number.isInteger(peek) && cfg?.tabs?.[peek]) return peek;
  const idx = Number.isInteger(cfg?.activeTab) ? cfg.activeTab : 0;
  return Math.max(0, Math.min((cfg?.tabs?.length ?? 1) - 1, idx));
}

export function drawClassicNodeWithBottomTabs(node, cfg, effectiveIdx, drawFn) {
  if (!cfg || !Array.isArray(cfg.tabs) || !cfg.tabs.length || node?.flags?.collapsed || globalThis.LiteGraph?.vueNodesMode) {
    return drawFn();
  }
  const activeTab = cfg.tabs[effectiveIdx] ?? cfg.tabs[0];
  if (!activeTab) return drawFn();

  const origInputs = node.inputs;
  const origOutputs = node.outputs;
  const origWidgets = node.widgets;
  const hasImgs = Object.prototype.hasOwnProperty.call(node, 'imgs');
  const origImgs = node.imgs;

  const allowedNames = new Set((activeTab.widgets ?? []).map(String));
  try {
    if (!activeTab.includePorts) {
      node.inputs = [];
      node.outputs = [];
    }
    if (Array.isArray(origWidgets)) {
      const visibleWidgets = [];
      for (const w of origWidgets) {
        if (!w) continue;
        const name = String(w.name ?? '').trim();
        const show = allowedNames.has(name) || (activeTab.includePreview && isPreviewWidget(w));
        if (show) visibleWidgets.push(w);
        else w.last_y = -99999;
      }
      node.widgets = visibleWidgets;
    }
    if (!activeTab.includePreview && origImgs) {
      node.imgs = null;
    }
    return drawFn();
  } finally {
    node.inputs = origInputs;
    node.outputs = origOutputs;
    node.widgets = origWidgets;
    if (hasImgs) node.imgs = origImgs;
    else delete node.imgs;
  }
}

export function syncVueNodeSectionTabs(doc, controller, hiddenNodeIds) {
  if (!doc?.querySelectorAll) return;
  const nodeTabs = controller.nodeTabs;
  for (const domNode of doc.querySelectorAll('.lg-node')) {
    const id = domNode.dataset?.nodeId || domNode.getAttribute?.('data-node-id');
    if (id == null) continue;
    const key = String(id);
    const node = controller.graph?.getNodeById?.(id);
    const cfg = node && !node.flags?.collapsed && !hiddenNodeIds.has(key) ? nodeTabs[key] : null;
    if (!cfg || !Array.isArray(cfg.tabs) || !cfg.tabs.length) {
      if (domNode.classList?.contains?.('clt-has-bottom-tabs')) {
        domNode.classList.remove('clt-has-bottom-tabs');
        for (const sub of domNode.querySelectorAll?.('.clt-section-hidden') ?? []) {
          sub.classList?.remove?.('clt-section-hidden');
        }
      }
      continue;
    }

    domNode.classList?.add?.('clt-has-bottom-tabs');
    const effIdx = effectiveNodeTabIndex(controller, key, cfg);
    const activeTab = cfg.tabs[effIdx] ?? cfg.tabs[0];
    const allowedWidgets = new Set((activeTab.widgets ?? []).map(String));

    // Toggle slot containers
    const slotSelectors = '.lg-node-slots,[data-testid*="slot" i],.node-slots,.lg-slot';
    for (const slotEl of domNode.querySelectorAll?.(slotSelectors) ?? []) {
      if (slotEl.closest?.('.lg-node-widget,.dom-widget')) continue;
      slotEl.classList?.toggle?.('clt-section-hidden', !activeTab.includePorts);
    }

    // Match widget wrappers inside .lg-node
    const widgetEls = [...(domNode.querySelectorAll?.('.lg-node-widget,[data-widget-name],.dom-widget') ?? [])];
    const liveWidgets = (node?.widgets ?? []).filter(w => w && w.hidden !== true && String(w.type ?? '') !== 'converted-widget');
    widgetEls.forEach((wEl, domIdx) => {
      let wName = wEl.dataset?.widgetName || wEl.getAttribute?.('data-widget-name') || '';
      let matchedWidget = null;
      if (wName) {
        matchedWidget = liveWidgets.find(w => String(w.name) === wName) ?? null;
      }
      if (!matchedWidget) {
        matchedWidget = liveWidgets.find(w => (w.element && (w.element === wEl || wEl.contains?.(w.element))) || (w.inputEl && (w.inputEl === wEl || wEl.contains?.(w.inputEl)))) ?? null;
        if (matchedWidget) wName = String(matchedWidget.name ?? '');
      }
      if (!matchedWidget && liveWidgets[domIdx]) {
        matchedWidget = liveWidgets[domIdx];
        wName = String(matchedWidget.name ?? '');
      }
      const show = wName
        ? (allowedWidgets.has(wName) || Boolean(activeTab.includePreview && matchedWidget && isPreviewWidget(matchedWidget)))
        : true;
      wEl.classList?.toggle?.('clt-section-hidden', !show);
    });

    // Toggle intrinsic preview containers (not already handled as a widget wrapper)
    const previewSelectors = '[data-testid*="preview" i],.lg-node-preview,.node-preview,.comfy-img-preview';
    for (const pEl of domNode.querySelectorAll?.(previewSelectors) ?? []) {
      if (pEl.closest?.('.lg-node-widget,.dom-widget')) continue;
      pEl.classList?.toggle?.('clt-section-hidden', !activeTab.includePreview);
    }
  }
}

export function openConfigureBottomTabsDialog(overlay, { nodeId = null, stackId = null }, doc = globalThis.document) {
  if (!doc) return;
  const controller = overlay.controller;
  const dialog = el(doc, 'dialog', 'clt-dialog clt-appearance-dialog');
  const header = el(doc, 'header', 'clt-appearance-header');
  const titleText = nodeId != null ? 'Configure Node Bottom Tabs' : 'Configure Stack Bottom Tabs';
  const heading = el(doc, 'h3', '', titleText);
  const closeBtn = el(doc, 'button', 'clt-close', '×');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close dialog');
  closeBtn.onclick = () => dialog.close();
  header.append(heading, closeBtn);

  const body = el(doc, 'div', 'clt-appearance-body');
  const footer = el(doc, 'footer', '');

  const rebuild = () => {
    body.replaceChildren();
    footer.replaceChildren();

    if (nodeId != null) {
      const node = controller.graph?.getNodeById?.(nodeId);
      const cfg = controller.nodeTabs[String(nodeId)];
      if (!node || !cfg) {
        dialog.close();
        return;
      }
      syncNodeTabConfig(cfg, node);

      // Sizing row
      const sizingLabel = el(doc, 'label', '', 'Height sizing behavior');
      const sizingSelect = el(doc, 'select', '');
      for (const [val, txt] of [['max', 'Stable Max-of-Tabs (Stationary Bar)'], ['compact', 'Compact Fit per Tab']]) {
        const opt = el(doc, 'option', '', txt);
        opt.value = val;
        if (cfg.sizing === val) opt.selected = true;
        sizingSelect.append(opt);
      }
      sizingSelect.onchange = () => {
        overlay.safe(() => controller.edit(() => setNodeTabsSizing(controller.ensureData(), nodeId, sizingSelect.value)));
        overlay.refreshHidden();
        overlay.signature = null;
      };
      sizingLabel.append(sizingSelect);
      body.append(sizingLabel);

      body.append(el(doc, 'h4', '', `Bottom Tabs (${cfg.tabs.length})`));
      cfg.tabs.forEach((tab, idx) => {
        const row = el(doc, 'div', 'clt-inline-group');
        row.style.marginBottom = '8px';
        row.style.justifyContent = 'space-between';

        const nameInput = el(doc, 'input', '');
        nameInput.type = 'text';
        nameInput.value = tab.label;
        nameInput.setAttribute('aria-label', `Tab ${idx + 1} name`);
        nameInput.onchange = () => {
          if (nameInput.value.trim()) {
            overlay.safe(() => controller.edit(() => renameNodeBottomTab(controller.ensureData(), nodeId, idx, nameInput.value)));
            overlay.signature = null;
            rebuild();
          }
        };

        const portsChkLabel = el(doc, 'span', 'clt-inline-group', 'Ports ');
        portsChkLabel.style.fontSize = '12px';
        const portsChk = el(doc, 'input', '');
        portsChk.type = 'checkbox';
        portsChk.checked = Boolean(tab.includePorts);
        portsChk.onchange = () => {
          overlay.safe(() => controller.edit(() => { tab.includePorts = portsChk.checked; }));
          overlay.refreshHidden();
          overlay.signature = null;
        };
        portsChkLabel.append(portsChk);

        const prevChkLabel = el(doc, 'span', 'clt-inline-group', 'Preview ');
        prevChkLabel.style.fontSize = '12px';
        const prevChk = el(doc, 'input', '');
        prevChk.type = 'checkbox';
        prevChk.checked = Boolean(tab.includePreview);
        prevChk.onchange = () => {
          overlay.safe(() => controller.edit(() => { tab.includePreview = prevChk.checked; }));
          overlay.refreshHidden();
          overlay.signature = null;
        };
        prevChkLabel.append(prevChk);

        row.append(nameInput, portsChkLabel, prevChkLabel);
        if (cfg.tabs.length > 1) {
          const delBtn = el(doc, 'button', '', '✕');
          delBtn.type = 'button';
          delBtn.title = 'Remove tab';
          delBtn.onclick = () => {
            overlay.safe(() => controller.edit(() => removeSingleNodeBottomTab(controller.ensureData(), nodeId, idx)));
            overlay.refreshHidden();
            overlay.signature = null;
            rebuild();
          };
          row.append(delBtn);
        }
        body.append(row);
      });

      const liveWidgets = (node.widgets ?? []).filter(w => w && w.hidden !== true && String(w.type ?? '') !== 'converted-widget' && w.name);
      if (liveWidgets.length > 0) {
        body.append(el(doc, 'h4', '', 'Widget Assignments'));
        for (const w of liveWidgets) {
          const wName = String(w.name);
          const wLabel = el(doc, 'label', '', wName);
          const wSelect = el(doc, 'select', '');
          const ownerIdx = Math.max(0, cfg.tabs.findIndex(t => t.widgets.includes(wName)));
          cfg.tabs.forEach((t, idx) => {
            const opt = el(doc, 'option', '', t.label);
            opt.value = String(idx);
            if (idx === ownerIdx) opt.selected = true;
            wSelect.append(opt);
          });
          wSelect.onchange = () => {
            overlay.safe(() => controller.edit(() => assignWidgetToNodeTab(controller.ensureData(), nodeId, wName, Number(wSelect.value))));
            overlay.refreshHidden();
            overlay.signature = null;
          };
          wLabel.append(wSelect);
          body.append(wLabel);
        }
      }

      const resetBtn = el(doc, 'button', 'clt-reset-btn', 'Reset to Auto-Split');
      resetBtn.type = 'button';
      resetBtn.onclick = () => {
        overlay.safe(() => controller.edit(() => {
          const fresh = createAutoNodeTabs(node);
          fresh.originalHeight = cfg.originalHeight;
          controller.ensureData().nodeTabs[String(nodeId)] = fresh;
        }));
        overlay.refreshHidden();
        overlay.signature = null;
        rebuild();
      };
      const addBtn = el(doc, 'button', '', '+ Add Tab');
      addBtn.type = 'button';
      addBtn.onclick = () => {
        overlay.safe(() => controller.edit(() => addCustomNodeBottomTab(controller.ensureData(), nodeId, `Tab ${cfg.tabs.length + 1}`)));
        overlay.signature = null;
        rebuild();
      };
      const doneBtn = el(doc, 'button', 'clt-primary', 'Done');
      doneBtn.type = 'button';
      doneBtn.onclick = () => dialog.close();
      footer.append(resetBtn, addBtn, doneBtn);
    } else if (stackId != null) {
      const stack = controller.tabStacks.find(s => s.id === stackId);
      if (!stack) {
        dialog.close();
        return;
      }
      const sizingLabel = el(doc, 'label', '', 'Height sizing behavior');
      const sizingSelect = el(doc, 'select', '');
      for (const [val, txt] of [['max', 'Stable Max-of-Tabs (Stationary Bar)'], ['compact', 'Compact Fit per Tab']]) {
        const opt = el(doc, 'option', '', txt);
        opt.value = val;
        if (stack.sizing === val) opt.selected = true;
        sizingSelect.append(opt);
      }
      sizingSelect.onchange = () => {
        overlay.safe(() => controller.edit(() => setStackSizing(controller.ensureData(), stackId, sizingSelect.value)));
        overlay.refreshHidden();
        overlay.signature = null;
      };
      sizingLabel.append(sizingSelect);
      body.append(sizingLabel);

      body.append(el(doc, 'h4', '', `Stack Pages (${stack.tabs.length})`));
      stack.tabs.forEach((tab, idx) => {
        const row = el(doc, 'label', '', tab.kind === 'group' ? `Group: ${tab.label}` : `Node: ${tab.label}`);
        const nameInput = el(doc, 'input', '');
        nameInput.type = 'text';
        nameInput.value = tab.label;
        nameInput.onchange = () => {
          if (nameInput.value.trim()) {
            overlay.safe(() => controller.edit(() => renameStackTab(controller.ensureData(), stackId, idx, nameInput.value)));
            overlay.signature = null;
            rebuild();
          }
        };
        row.append(nameInput);
        body.append(row);

        if (tab.kind === 'group') {
          const layoutRow = el(doc, 'label', '', `  ↳ ${tab.label} internal layout`);
          const layoutSel = el(doc, 'select', '');
          for (const [v, t] of [['relative', 'Preserve Relative Positions'], ['stack', 'Snap Vertical Stack']]) {
            const o = el(doc, 'option', '', t);
            o.value = v;
            if ((tab.layoutMode || 'relative') === v) o.selected = true;
            layoutSel.append(o);
          }
          layoutSel.onchange = () => {
            if ((tab.layoutMode || 'relative') !== layoutSel.value) {
              overlay.safe(() => controller.edit(() => toggleGroupTabLayoutMode(controller.ensureData(), stackId, idx)));
              overlay.signature = null;
            }
          };
          layoutRow.append(layoutSel);
          body.append(layoutRow);
        }
      });

      const unpackBtn = el(doc, 'button', 'clt-reset-btn', 'Unpack Stack');
      unpackBtn.type = 'button';
      unpackBtn.onclick = () => {
        dialog.close();
        overlay.safe(() => controller.unpackBottomStack(stackId));
        overlay.refreshHidden();
        overlay.signature = null;
      };
      const doneBtn = el(doc, 'button', 'clt-primary', 'Done');
      doneBtn.type = 'button';
      doneBtn.onclick = () => dialog.close();
      footer.append(unpackBtn, doneBtn);
    }
  };

  rebuild();
  dialog.append(header, body, footer);
  doc.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.showModal?.();
  return dialog;
}
