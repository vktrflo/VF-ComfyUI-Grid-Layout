import test from 'node:test';
import assert from 'node:assert/strict';
import { setAllLinksHidden, getGraphScope, collectGraphLinkIds } from '../web/core/link-visibility.js';

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
