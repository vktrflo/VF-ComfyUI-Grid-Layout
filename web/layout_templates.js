import { app } from '../../scripts/app.js';
import { LayoutController } from './core/controller.js';
import { LayoutOverlay } from './core/overlay.js';

let active;

app.registerExtension({
  name: 'VF.ComfyUI.LayoutTemplates',
  async setup() {
    const LiteGraph = globalThis.LiteGraph ?? globalThis.comfyAPI?.litegraph?.LiteGraph;
    const controller = new LayoutController(app, { classicTitle: LiteGraph?.NODE_TITLE_HEIGHT ?? 30 });
    const overlay = new LayoutOverlay(controller);
    active = { controller, overlay };
    const canvas = app.canvas;
    const original = canvas.getCanvasMenuOptions;
    canvas.getCanvasMenuOptions = function (...args) {
      const entries = original?.apply(this, args) ?? [];
      const point = [...(this.graph_mouse ?? [0, 0])];
      entries.push(null,
        { content: '🌀 Add Layout Frame', callback: () => overlay.safe(() => controller.create(point)) },
        { content: '🌀 Import Layout Template…', callback: () => overlay.importAt(point) });
      return entries;
    };
  },
  nodeCreated(node) {
    if (!active || app.configuringGraph) return;
    // Creation hooks run before the editor assigns the drop position. Wait
    // for placement and DOM sizing, while skipping workflow/history loads.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const { controller, overlay } = active;
      if (app.configuringGraph || node.graph !== controller.graph || !controller.frames.length) return;
      const point = [node.pos[0] + node.size[0] / 2, node.pos[1] + node.size[1] / 2];
      if (controller.target(point)) overlay.safe(() => controller.drop([node.id], point));
    }));
  },
});
