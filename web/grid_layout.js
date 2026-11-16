import { app } from '../../scripts/app.js';
import { LayoutController } from './core/controller.js';
import { LayoutOverlay, syncSelectionMenuDom } from './core/overlay.js';
import { createLinkEffectSettings } from './core/link-effects.js';
import { getGraphGroups } from './core/bottom-tabs.js';
import { openConfigureBottomTabsDialog } from './core/bottom-tabs-ui.js';

let active;

app.registerExtension({
  name: 'VF.ComfyUI.GridLayout',
  settings: createLinkEffectSettings(app.ui.settings),
  commands: [
    {
      id: 'VF.GridLayout.CreateFromSelection',
      label: 'Create grid layout from selected nodes',
      icon: 'icon-[lucide--panels-top-left]',
      function: () => active?.openSelectionMenu(),
    },
    {
      id: 'VF.GridLayout.SplitNodeBottomTabs',
      label: 'Split selected node(s) into bottom tabs',
      icon: 'icon-[lucide--panel-bottom]',
      function: () => active?.splitSelectedNodesIntoBottomTabs(),
    },
    {
      id: 'VF.GridLayout.CombineIntoBottomTabs',
      label: 'Combine selection into bottom-tabbed stack',
      icon: 'icon-[lucide--layers]',
      function: () => active?.combineSelectionIntoBottomTabs(),
    },
  ],
  // Current frontends collect menu items through these hooks. setup() falls
  // back to wrapping the canvas methods only when they are unavailable.
  getCanvasMenuItems(canvas) {
    return active ? active.canvasMenuItems(canvas) : [];
  },
  getNodeMenuItems(node) {
    return active ? active.nodeMenuItems(node) : [];
  },
  getSelectionToolboxCommands(item) {
    return item && active?.controller.graph.getNodeById(item.id) === item
      ? ['VF.GridLayout.CreateFromSelection', 'VF.GridLayout.SplitNodeBottomTabs']
      : [];
  },
  async setup() {
    const LiteGraph = globalThis.LiteGraph ?? globalThis.comfyAPI?.litegraph?.LiteGraph;
    const controller = new LayoutController(app, { classicTitle: LiteGraph?.NODE_TITLE_HEIGHT ?? 30 });
    const overlay = new LayoutOverlay(controller);
    const selectedGroups = () => {
      const canvas = app.canvas;
      const out = [];
      if (canvas?.selected_group) out.push(canvas.selected_group);
      const multi = canvas?.selected_groups ?? canvas?.selectedItems;
      if (multi) {
        const items = multi instanceof Set || multi instanceof Map ? [...multi.values()] : (Array.isArray(multi) ? multi : Object.values(multi));
        const liveGroups = new Set(getGraphGroups(controller.graph));
        for (const item of items) {
          if (liveGroups.has(item) && !out.includes(item)) out.push(item);
        }
      }
      return out;
    };
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
    const splitSelectedNodesIntoBottomTabs = () => {
      const nodes = controller.selectedNodes();
      if (!nodes.length) return;
      overlay.safe(() => {
        for (const n of nodes) controller.enableNodeTabs(n.id);
        overlay.refreshHidden();
        overlay.signature = null;
      });
    };
    const combineSelectionIntoBottomTabs = () => {
      const groups = selectedGroups();
      const nodes = controller.selectedNodes();
      if (groups.length === 1 && nodes.length === 0) {
        overlay.safe(() => {
          controller.tabifySingleGroup(groups[0]);
          overlay.refreshHidden();
          overlay.signature = null;
        });
        return;
      }
      overlay.safe(() => {
        controller.combineIntoBottomStack({ groups, nodes });
        overlay.refreshHidden();
        overlay.signature = null;
      });
    };
    active = { controller, overlay, openSelectionMenu, splitSelectedNodesIntoBottomTabs, combineSelectionIntoBottomTabs };
    this.controller = controller;
    this.overlay = overlay;
    this.openSelectionMenu = openSelectionMenu;
    // Multi-selection's Vue menu does not call the node-menu extension hook.
    // Limit the additional item to the menu opened by the toolbox's More button,
    // deduplicating when single-selection already added it and omitting it when
    // the selected node is already inside a grid container.
    let selectionMenuPending = false;
    const syncMenus = () => {
      const frame = controller.selectedFrame();
      const canAutohide = Boolean(frame && frame.minimized !== true && frame.collapsed !== true && overlay.frameHasNodes(frame));
      selectionMenuPending = syncSelectionMenuDom(document.body, {
        inGrid: Boolean(frame),
        canAutohide,
        autohide: Boolean(canAutohide && frame.autohide === true),
        selectionCount: controller.selectedNodes().length,
        menuPending: selectionMenuPending,
        onActivate: openSelectionMenu,
        onToggleAutohide: () => {
          const current = controller.selectedFrame();
          if (current) {
            overlay.toggleAutohide(current.id, { preserveSelection: true });
            syncMenus();
          }
        },
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
    const nodeMenuItems = targetNode => {
      const items = [];
      const entry = selectionEntry();
      if (entry) items.push(entry);
      const selNodes = controller.selectedNodes();
      const selGroups = selectedGroups();
      const node = targetNode ?? selNodes[0] ?? null;
      if (node) {
        const hasTabs = Boolean(controller.nodeTabs?.[String(node.id)]);
        if (hasTabs) {
          items.push({
            content: '🌀 Configure bottom tabs…',
            callback: () => openConfigureBottomTabsDialog(overlay, { nodeId: node.id }),
          });
          items.push({
            content: '🌀 Remove bottom tabs',
            callback: () => overlay.safe(() => {
              controller.removeNodeTabs(node.id);
              overlay.refreshHidden();
              overlay.signature = null;
            }),
          });
        } else {
          const targets = selNodes.length > 1 && selNodes.some(n => String(n.id) === String(node.id)) ? selNodes : [node];
          items.push({
            content: targets.length > 1 ? `🌀 Split ${targets.length} nodes into bottom tabs` : '🌀 Split node into bottom tabs',
            callback: () => overlay.safe(() => {
              for (const t of targets) controller.enableNodeTabs(t.id);
              overlay.refreshHidden();
              overlay.signature = null;
            }),
          });
        }
        if (selNodes.length + selGroups.length >= 2) {
          items.push({
            content: '🌀 Combine selected into bottom tabs',
            callback: () => combineSelectionIntoBottomTabs(),
          });
        }
        const stackOwner = controller.findStackForNode(node.id);
        if (stackOwner) {
          items.push({
            content: '🌀 Unpack bottom-tabbed stack',
            callback: () => overlay.safe(() => {
              controller.unpackBottomStack(stackOwner.stack.id);
              overlay.refreshHidden();
              overlay.signature = null;
            }),
          });
        }
      }
      return items.length ? [null, ...items] : [];
    };
    const groupMenuItems = group => {
      if (!group) return [];
      const allGroups = getGraphGroups(controller.graph);
      const selGroups = selectedGroups();
      const selNodes = controller.selectedNodes();
      const out = [
        null,
        {
          content: `🌀 Convert Group "${group.title || 'Group'}" into bottom tabs`,
          callback: () => overlay.safe(() => {
            controller.tabifySingleGroup(group);
            overlay.refreshHidden();
            overlay.signature = null;
          }),
        },
      ];
      if (selGroups.length + selNodes.length >= 2) {
        out.push({
          content: '🌀 Combine selected into bottom tabs',
          callback: () => combineSelectionIntoBottomTabs(),
        });
      } else if (allGroups.length >= 2) {
        out.push({
          content: `🌀 Combine all ${allGroups.length} ComfyUI Groups into bottom tabs`,
          callback: () => overlay.safe(() => {
            controller.combineIntoBottomStack({ groups: [...allGroups], nodes: [] });
            overlay.refreshHidden();
            overlay.signature = null;
          }),
        });
      }
      return out;
    };
    const canvasMenuItems = target => {
      const point = [...(target?.graph_mouse ?? canvas.graph_mouse ?? [0, 0])];
      const entry = selectionEntry();
      const groupAtPoint = overlay.findNativeGroupAt(point);
      const selGroups = selectedGroups();
      const selNodes = controller.selectedNodes();
      const allGroups = getGraphGroups(controller.graph);
      const bottomItems = [];
      if (groupAtPoint) {
        bottomItems.push({
          content: `🌀 Convert Group "${groupAtPoint.title || 'Group'}" into bottom tabs`,
          callback: () => overlay.safe(() => {
            controller.tabifySingleGroup(groupAtPoint);
            overlay.refreshHidden();
            overlay.signature = null;
          }),
        });
      }
      if (selGroups.length + selNodes.length >= 2) {
        bottomItems.push({
          content: '🌀 Combine selected into bottom tabs',
          callback: () => combineSelectionIntoBottomTabs(),
        });
      } else if (allGroups.length >= 2) {
        bottomItems.push({
          content: `🌀 Combine all ${allGroups.length} ComfyUI Groups into bottom tabs`,
          callback: () => overlay.safe(() => {
            controller.combineIntoBottomStack({ groups: [...allGroups], nodes: [] });
            overlay.refreshHidden();
            overlay.signature = null;
          }),
        });
      }
      return [
        null,
        ...(entry ? [entry] : []),
        ...bottomItems,
        { content: '🌀 Add Grid Frame', callback: () => overlay.safe(() => controller.create(point)) },
        { content: '🌀 Add IDE Workspace (VS Code)', callback: () => overlay.safe(() => controller.createPreset(point, 'vscode')) },
        { content: '🌀 Import Grid Template…', callback: () => overlay.importAt(point) },
      ];
    };
    active.selectionEntry = selectionEntry;
    active.nodeMenuItems = nodeMenuItems;
    active.canvasMenuItems = canvasMenuItems;
    if (typeof canvas.getGroupMenuOptions === 'function') {
      const originalGroupMenu = canvas.getGroupMenuOptions;
      canvas.getGroupMenuOptions = function (group, ...rest) {
        const entries = originalGroupMenu?.call(this, group, ...rest) ?? [];
        entries.push(...groupMenuItems(group));
        return entries;
      };
    }
    if (typeof app.collectCanvasMenuItems !== 'function') {
      const originalNodeMenu = canvas.getNodeMenuOptions;
      canvas.getNodeMenuOptions = function (node, ...rest) {
        const entries = originalNodeMenu?.call(this, node, ...rest) ?? [];
        entries.push(...nodeMenuItems(node));
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
