import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HIDDEN_LINK_LABEL_SETTING,
  setAllLinksHidden,
  getGraphScope,
  collectGraphLinkIds,
  formatHiddenLinkLabel,
  truncateLinkLabel,
  installHiddenLinkLabels,
} from '../web/core/link-visibility.js';

test('setAllLinksHidden patches all graph links via native linkPresentation store', () => {
  const patches = [];
  const events = [];
  const store = {
    patch(scope, id, patch) {
      patches.push({ scope, id, patch });
    },
  };
  const graph = {
    id: 'sub-1',
    rootGraph: { id: 'root-1' },
    links: new Map([
      [10, { id: 10 }],
      [20, { id: 20 }],
    ]),
    beforeChange() { events.push('before'); },
    afterChange() { events.push('after'); },
  };
  const app = {
    canvas: {
      graph,
      setDirty(fg, bg) { events.push(`dirty:${fg}:${bg}`); },
    },
  };

  assert.deepEqual(getGraphScope(graph), { rootGraphId: 'root-1', owningGraphId: 'sub-1' });
  assert.deepEqual(collectGraphLinkIds(graph), [10, 20]);

  const hiddenCount = setAllLinksHidden(app, true, { store });
  assert.equal(hiddenCount, 2);
  assert.deepEqual(patches, [
    { scope: { rootGraphId: 'root-1', owningGraphId: 'sub-1' }, id: 10, patch: { hidden: true } },
    { scope: { rootGraphId: 'root-1', owningGraphId: 'sub-1' }, id: 20, patch: { hidden: true } },
  ]);
  assert.deepEqual(events, ['before', 'after', 'dirty:true:true']);

  patches.length = 0;
  const shownCount = setAllLinksHidden(app, false, { store });
  assert.equal(shownCount, 2);
  assert.deepEqual(patches, [
    { scope: { rootGraphId: 'root-1', owningGraphId: 'sub-1' }, id: 10, patch: { hidden: false } },
    { scope: { rootGraphId: 'root-1', owningGraphId: 'sub-1' }, id: 20, patch: { hidden: false } },
  ]);
});

test('collectGraphLinkIds supports plain object graph.links maps', () => {
  const graph = { id: 'root', links: { 1: { id: 1 }, 2: null, 3: { id: 3 } } };
  assert.deepEqual(collectGraphLinkIds(graph), [1, 3]);
});

test('installHiddenLinkLabels formats Type > TargetNode > TargetSlot, truncates until active, and respects setting & manual labels', () => {
  const targetNode = {
    id: 2,
    title: 'KSamplerAdvanced',
    inputs: [{ name: 'model' }, { name: 'positive_conditioning' }],
  };
  const link = { id: 42, type: 'CONDITIONING', origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 1 };
  const graph = {
    id: 'root',
    links: new Map([[42, link]]),
    getNodeById: id => (id === 2 ? targetNode : null),
  };

  let settingEnabled = true;
  const canvas = { graph, selected_nodes: {}, node_over: null, highlighted_links: {} };
  const app = {
    canvas,
    graph,
    ui: { settings: { getSettingValue: id => (id === HIDDEN_LINK_LABEL_SETTING ? settingEnabled : undefined) } },
  };

  let stored = { hidden: true };
  const store = {
    patch() {},
    getPresentation: () => stored,
  };

  assert.equal(formatHiddenLinkLabel(graph, link), 'CONDITIONING > KSamplerAdvanced > positive_conditioning');
  assert.equal(truncateLinkLabel('CONDITIONING > KSamplerAdvanced > positive_conditioning', 20), 'CONDITIONING > KSam…');

  const uninstall = installHiddenLinkLabels(app, { store, maxChars: 20 });

  // Inactive: truncated with ellipsis
  assert.equal(store.getPresentation({ rootGraphId: 'root', owningGraphId: 'root' }, 42).label, 'CONDITIONING > KSam…');

  // Active (target node selected): full label
  canvas.selected_nodes = { 2: targetNode };
  assert.equal(
    store.getPresentation({ rootGraphId: 'root', owningGraphId: 'root' }, 42).label,
    'CONDITIONING > KSamplerAdvanced > positive_conditioning'
  );

  // Active (origin node hovered): full label
  canvas.selected_nodes = {};
  canvas.node_over = { id: 1 };
  assert.equal(
    store.getPresentation({ rootGraphId: 'root', owningGraphId: 'root' }, 42).label,
    'CONDITIONING > KSamplerAdvanced > positive_conditioning'
  );

  // Manual user rename takes precedence
  stored = { hidden: true, label: 'Custom Name' };
  assert.equal(store.getPresentation({ rootGraphId: 'root', owningGraphId: 'root' }, 42).label, 'Custom Name');

  // Setting disabled: returns unmodified presentation
  stored = { hidden: true };
  settingEnabled = false;
  assert.equal(store.getPresentation({ rootGraphId: 'root', owningGraphId: 'root' }, 42).label, undefined);

  uninstall();
});
