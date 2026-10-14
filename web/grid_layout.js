import { app } from '../../scripts/app.js';
import { LayoutController } from './core/controller.js';
import { LayoutOverlay, syncSelectionMenuDom } from './core/overlay.js';
import { createLinkEffectSettings } from './core/link-effects.js';

let active;

app.registerExtension({
  name: 'VF.ComfyUI.GridLayout',
  settings: createLinkEffectSettings(app.ui.settings),
  commands: [{
    id: 'VF.GridLayout.CreateFromSelection',
    label: 'Create grid layout from selected nodes',
    icon: 'icon-[lucide--panels-top-left]',
    function: () => active?.openSelectionMenu(),
  }],
  // Current frontends collect menu items through these hooks. setup() falls
  // back to wrapping the canvas methods only when they are unavailable.
  getCanvasMenuItems(canvas) {
    return active ? active.canvasMenuItems(canvas) : [];
  },
  getNodeMenuItems() {
    const entry = active?.selectionEntry();
    return entry ? [null, entry] : [];
  },
  getSelectionToolboxCommands(item) {
    return item && active?.controller.graph.getNodeById(item.id) === item ? ['VF.GridLayout.CreateFromSelection'] : [];
  },
  async setup() {
    const LiteGraph = globalThis.LiteGraph ?? globalThis.comfyAPI?.litegraph?.LiteGraph;
    const controller = new LayoutController(app, { classicTitle: LiteGraph?.NODE_TITLE_HEIGHT ?? 30 });
    const overlay = new LayoutOverlay(controller);
    const openSelectionMenu = event => {
      const ids = controller.selectedNodes().map(node => node.id);
      if (!ids.length) return;
      const frame = controller.selectedFrame();
      if (frame) {
        const box = document.querySelector('.selection-toolbox')?.getBoundingClientRect();
        overlay.frameMenu(event ?? { clientX: box?.left ?? 20, clientY: box?.bottom ?? 60 }, frame, { includeToggles: true });
        return;
      }
      overlay.safe(() => controller.createFromNodes(ids, 'columns'));
    };
    active = { controller, overlay, openSelectionMenu };
    this.controller = controller;
    this.overlay = overlay;
    this.openSelectionMenu = openSelectionMenu;
    // Multi-selection's Vue menu does not call the node-menu extension hook.
    // Limit the additional item to the menu opened by the toolbox's More button,
    // deduplicating when single-selection already added it and omitting it when
    // the selected node is already inside a grid container.
    let selectionMenuPending = false;
    const syncMenus = () => {
      selectionMenuPending = syncSelectionMenuDom(document.body, {
        inGrid: Boolean(controller.selectedFrame()),
        selectionCount: controller.selectedNodes().length,
        menuPending: selectionMenuPending,
        onActivate: openSelectionMenu,
      });
    };
    overlay.onTick = syncMenus;
    document.addEventListener('click', event => {
      if (event.target.closest?.('[data-testid="more-options-button"]')) selectionMenuPending = true;
    }, { capture: true, signal: overlay.abort.signal });
    const observer = new MutationObserver(syncMenus);
    observer.observe(document.body, { childList: true, subtree: true });
    overlay.abort.signal.addEventListener('abort', () => observer.disconnect(), { once: true });
    const canvas = app.canvas;
    const selectionEntry = () => {
      if (controller.selectedFrame()) return null;
      const ids = controller.selectedNodes().map(node => node.id);
      return {
        content: 'Create grid layout from selected nodes',
        disabled: !ids.length,
        callback: () => overlay.safe(() => controller.createFromNodes(ids, 'columns')),
      };
    };
    const canvasMenuItems = target => {
      const point = [...(target?.graph_mouse ?? canvas.graph_mouse ?? [0, 0])];
      const entry = selectionEntry();
      return [
        null,
        ...(entry ? [entry] : []),
        { content: '🌀 Add Grid Frame', callback: () => overlay.safe(() => controller.create(point)) },
        { content: '🌀 Import Grid Template…', callback: () => overlay.importAt(point) },
      ];
    };
    active.selectionEntry = selectionEntry;
    active.canvasMenuItems = canvasMenuItems;
    if (typeof app.collectCanvasMenuItems !== 'function') {
      const originalNodeMenu = canvas.getNodeMenuOptions;
      canvas.getNodeMenuOptions = function (...args) {
        const entries = originalNodeMenu?.apply(this, args) ?? [];
        const entry = selectionEntry();
        if (entry) entries.push(null, entry);
        return entries;
      };
      const original = canvas.getCanvasMenuOptions;
      canvas.getCanvasMenuOptions = function (...args) {
        const entries = original?.apply(this, args) ?? [];
        entries.push(...canvasMenuItems(this));
        return entries;
      };
    }
  },
  nodeCreated(node) {
    if (!active || app.configuringGraph) return;
    if (node.flags?.ghost || app.canvas?.state?.ghostNodeId != null) return;
    // Creation hooks run before the editor assigns the drop position. Wait
    // for placement and DOM sizing, while skipping workflow/history loads
    // and ghost-placement nodes that are still following the cursor.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const { controller, overlay } = active;
      if (app.configuringGraph || node.graph !== controller.graph || !controller.frames.length) return;
      if (node.flags?.ghost || overlay.isGhostActive?.() || overlay.ghostHandled?.has(String(node.id))) return;
      const target = controller.targetNode(node);
      if (target) {
        const point = [node.pos[0] + node.size[0] / 2, node.pos[1] + node.size[1] / 2];
        overlay.safe(() => controller.drop([node.id], point, target));
      }
    }));
  },
});
