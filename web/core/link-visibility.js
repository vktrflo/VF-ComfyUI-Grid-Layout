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
