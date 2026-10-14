import { app } from '../../scripts/app.js';
import { LayoutController } from './core/controller.js';
import { LayoutOverlay } from './core/overlay.js';

let active;

app.registerExtension({
  name: 'VF.ComfyUI.GridLayout',
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
    return active ? [null, active.selectionEntry()] : [];
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
    // Limit the additional item to the menu opened by the toolbox's More button.
    let selectionMenuPending = false;
    document.addEventListener('click', event => {
      if (event.target.closest?.('[data-testid="more-options-button"]')) selectionMenuPending = true;
    }, {capture:true,signal:overlay.abort.signal});
    const observer = new MutationObserver(() => {
      const toolbarButton = document.querySelector('.selection-toolbox [class~="icon-[lucide--panels-top-left]"]')?.closest('button');
      if (toolbarButton && toolbarButton.getAttribute('aria-label') !== 'Create grid layout from selected nodes') {
        toolbarButton.setAttribute('aria-label','Create grid layout from selected nodes');
        toolbarButton.title='Create grid layout from selected nodes';
        const label=document.createElement('span');label.textContent='Grid';toolbarButton.append(label);
      }
      if (!selectionMenuPending || !controller.selectedNodes().length) return;
      const list = [...document.querySelectorAll('.p-contextmenu-root-list')].find(list => list.getBoundingClientRect().width > 0);
      if (!list || list.querySelector('[data-clt-selection-action]')) return;
      const example = list.querySelector('.p-contextmenu-item');
      if (!example) return;
      const item = example.cloneNode(true);
      item.removeAttribute('id');item.removeAttribute('aria-posinset');item.removeAttribute('aria-setsize');
      item.setAttribute('aria-label','Create grid layout from selected nodes');
      item.dataset.cltSelectionAction = 'true';
      const link = item.querySelector('a');
      if (!link) return;
      link.replaceChildren(document.createTextNode('Create grid layout from selected nodes'));
      link.tabIndex=0;
      const activate = event => {
        event.preventDefault();event.stopPropagation();
        const box=item.getBoundingClientRect();
        document.body.click();
        openSelectionMenu({clientX:box.right,clientY:box.top});
      };
      link.onclick=activate;
      link.onkeydown=event=>{if(event.key==='Enter'||event.key===' ')activate(event);};
      list.append(item);selectionMenuPending=false;
    });
    observer.observe(document.body,{childList:true,subtree:true});
    overlay.abort.signal.addEventListener('abort',()=>observer.disconnect(),{once:true});
    const canvas = app.canvas;
    const selectionEntry = () => {
      const ids = controller.selectedNodes().map(node => node.id);
      const frame = controller.selectedFrame();
      if (frame) {
        const actions = overlay.frameActions(frame, { includeToggles: true });
        return {
          content: 'Create grid layout from selected nodes',
          disabled: !actions.length,
          submenu: {
            options: actions.map(([ content, action ]) => ({
              content,
              callback: () => overlay.safe(action),
            })),
          },
        };
      }
      return {
        content: 'Create grid layout from selected nodes',
        disabled: !ids.length,
        callback: () => overlay.safe(() => controller.createFromNodes(ids, 'columns')),
      };
    };
    const canvasMenuItems = target => {
      const point = [...(target?.graph_mouse ?? canvas.graph_mouse ?? [0, 0])];
      return [null, selectionEntry(),
        { content: '🌀 Add Grid Frame', callback: () => overlay.safe(() => controller.create(point)) },
        { content: '🌀 Import Grid Template…', callback: () => overlay.importAt(point) }];
    };
    active.selectionEntry = selectionEntry;
    active.canvasMenuItems = canvasMenuItems;
    if (typeof app.collectCanvasMenuItems !== 'function') {
      const originalNodeMenu = canvas.getNodeMenuOptions;
      canvas.getNodeMenuOptions = function (...args) {
        const entries = originalNodeMenu?.apply(this,args) ?? [];
        entries.push(null, selectionEntry());return entries;
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
