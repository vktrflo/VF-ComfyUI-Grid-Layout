export const HIDDEN_LINK_LABEL_SETTING = 'VF.GridLayout.HiddenLinkLabels';
export const HIDDEN_LINK_LABEL_MAX_CHARS = 20;

export function createHiddenLinkLabelSetting(app) {
  return {
    id: HIDDEN_LINK_LABEL_SETTING,
    category: ['VF', 'Grid Layout', 'Hidden Link Labels'],
    name: 'Format hidden link badges (Type > TargetNode > TargetSlot)',
    type: 'boolean',
    defaultValue: true,
    tooltip:
      'Display hidden link badges as "Type > TargetNode > TargetSlot", truncated with an ellipsis until a connected node is hovered or selected.',
    onChange: () => {
      app?.canvas?.setDirty?.(true, true);
    },
  };
}

export function getLinkPresentationStore(doc = globalThis.document) {
  if (!doc) return null;
  const candidates = [
    doc.querySelector?.('#vue-app'),
    doc.querySelector?.('#app'),
    ...(doc.body?.children ? [...doc.body.children] : []),
  ];
  for (const el of candidates) {
    const store = el?.__vue_app__?.config?.globalProperties?.$pinia?._s?.get?.('linkPresentation');
    if (store && typeof store.patch === 'function') return store;
  }
  return null;
}

export function getGraphScope(graph) {
  if (!graph) return null;
  const owningGraphId = graph.id;
  const rootGraphId = graph.rootGraph?.id ?? owningGraphId;
  return { rootGraphId, owningGraphId };
}

export function collectGraphLinkIds(graph) {
  const links = graph?.links;
  if (!links) return [];
  const entries = links instanceof Map ? [...links.values()] : Object.values(links);
  const ids = [];
  for (const link of entries) {
    if (link && link.id !== undefined && link.id !== null) {
      ids.push(link.id);
    }
  }
  return ids;
}

export function setAllLinksHidden(app, hidden, { doc = globalThis.document, store } = {}) {
  const canvas = app?.canvas;
  const graph = canvas?.graph ?? app?.graph;
  if (!graph) return 0;
  const presentation = store ?? getLinkPresentationStore(doc);
  if (!presentation || typeof presentation.patch !== 'function') {
    throw new Error('ComfyUI native linkPresentation store is not available.');
  }
  const scope = getGraphScope(graph);
  const linkIds = collectGraphLinkIds(graph);
  if (!linkIds.length) return 0;

  graph.beforeChange?.();
  try {
    const flag = Boolean(hidden);
    for (const id of linkIds) {
      presentation.patch(scope, id, { hidden: flag });
    }
  } finally {
    graph.afterChange?.();
    canvas?.setDirty?.(true, true);
  }
  return linkIds.length;
}

export function formatHiddenLinkLabel(graph, link) {
  if (!graph || !link) return '';
  const type = String(link.type ?? '*').trim() || '*';
  const targetNode = graph.getNodeById?.(link.target_id);
  const targetNodeName = String(targetNode?.title || targetNode?.type || `Node ${link.target_id}`).trim();
  const inputSlot = targetNode?.inputs?.[link.target_slot];
  const targetSlotName = String(inputSlot?.localized_name || inputSlot?.label || inputSlot?.name || `slot ${link.target_slot}`).trim();
  return `${type} > ${targetNodeName} > ${targetSlotName}`;
}

export function truncateLinkLabel(label, maxChars = HIDDEN_LINK_LABEL_MAX_CHARS) {
  if (!label || label.length <= maxChars) return label;
  return `${label.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

export function isLinkActive(canvas, link) {
  if (!canvas || !link) return false;
  const originId = String(link.origin_id);
  const targetId = String(link.target_id);

  // Selected node check
  const sel = canvas.selected_nodes;
  if (sel) {
    if (sel instanceof Map) {
      if (sel.has(link.origin_id) || sel.has(link.target_id) || sel.has(originId) || sel.has(targetId)) return true;
    } else if (sel instanceof Set) {
      for (const n of sel) {
        if (String(n?.id) === originId || String(n?.id) === targetId) return true;
      }
    } else if (sel[link.origin_id] || sel[link.target_id] || sel[originId] || sel[targetId]) {
      return true;
    }
  }

  // Hovered node check
  const hoveredId = canvas.node_over?.id;
  if (hoveredId !== undefined && (String(hoveredId) === originId || String(hoveredId) === targetId)) {
    return true;
  }

  // Highlighted link check
  const hl = canvas.highlighted_links;
  if (hl && (hl[link.id] || hl[String(link.id)])) return true;

  return false;
}

export function installHiddenLinkLabels(app, { doc = globalThis.document, store, maxChars = HIDDEN_LINK_LABEL_MAX_CHARS } = {}) {
  const presentation = store ?? getLinkPresentationStore(doc);
  if (!presentation || typeof presentation.getPresentation !== 'function') return null;
  if (presentation.__vfHiddenLinkLabelsInstalled) return presentation.__vfHiddenLinkLabelsUninstall;

  const originalGetPresentation = presentation.getPresentation.bind(presentation);
  presentation.getPresentation = function (scope, linkId) {
    const pres = originalGetPresentation(scope, linkId);
    if (!pres || pres.hidden !== true) return pres;
    // Respect explicit user-assigned labels
    if (pres.label) return pres;
    const enabled = app?.ui?.settings?.getSettingValue?.(HIDDEN_LINK_LABEL_SETTING) ?? true;
    if (!enabled) return pres;

    const canvas = app?.canvas;
    const graph = canvas?.graph ?? app?.graph;
    const link = graph?.links instanceof Map ? graph.links.get(linkId) : graph?.links?.[linkId];
    if (!link) return pres;

    const full = formatHiddenLinkLabel(graph, link);
    if (!full) return pres;
    const label = isLinkActive(canvas, link) ? full : truncateLinkLabel(full, maxChars);
    return { ...pres, label };
  };

  const uninstall = () => {
    presentation.getPresentation = originalGetPresentation;
    delete presentation.__vfHiddenLinkLabelsInstalled;
    delete presentation.__vfHiddenLinkLabelsUninstall;
  };
  presentation.__vfHiddenLinkLabelsInstalled = true;
  presentation.__vfHiddenLinkLabelsUninstall = uninstall;
  return uninstall;
}
