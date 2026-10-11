import { app } from "../../scripts/app.js";

const WEBSITE = "http://vktrflo.com";
const LOGO_URL = new URL("./vf-logo.svg", import.meta.url).href;
const HEADERS = ".vf-modal-header, .vf-browser-header, .vf-video-modal-header, .clt-frame-header, .clt-dialog h3";
const MENU_ITEMS = ".litemenu-entry, .p-contextmenu-item-link, [role='menuitem']";
const MENU_LABELS = new Set(["Add Grid Frame", "Import Grid Template…"]);

function createBrandLink() {
  const link = document.createElement("a");
  link.className = "vf-brand-link";
  link.href = WEBSITE;
  link.title = WEBSITE;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("aria-label", `VF — ${WEBSITE}`);
  Object.assign(link.style, { display: "inline-flex", alignItems: "center", flexShrink: "0", width: "15px", height: "15px", marginRight: "8px", verticalAlign: "middle", cursor: "pointer", pointerEvents: "auto" });
  const img = document.createElement("img");
  img.src = LOGO_URL;
  img.alt = "VF";
  img.width = 15;
  img.height = 15;
  img.draggable = false;
  link.appendChild(img);
  // Header drags and canvas gestures must not consume link clicks.
  link.onpointerdown = link.onmousedown = link.onclick = link.ondblclick = event => event.stopPropagation();
  return link;
}

function brandHeader(header) {
  if (header.querySelector(":scope > .vf-brand-link")) return;
  header.querySelector(":scope > .clt-emoji")?.remove();
  header.prepend(createBrandLink());
}

function brandMenuItem(item) {
  if (!MENU_LABELS.has(item.textContent.trim()) || item.querySelector(".vf-brand-link") || item.querySelector(MENU_ITEMS)) return;
  item.prepend(createBrandLink());
}

function brandTree(root) {
  if (root.matches?.(HEADERS)) brandHeader(root);
  if (root.matches?.(MENU_ITEMS)) brandMenuItem(root);
  root.querySelectorAll(HEADERS).forEach(brandHeader);
  root.querySelectorAll(MENU_ITEMS).forEach(brandMenuItem);
}

app.registerExtension({
  name: "VF.GridHeaderBrandLinks",
  setup() {
    // Either node pack can provide this integration when installed on its own.
    if (document.querySelector("[data-vf-brand-observer]")) return;
    const marker = document.createElement("meta");
    marker.setAttribute("data-vf-brand-observer", "true");
    document.head.appendChild(marker);
    brandTree(document);
    const observer = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType !== 1 || node.classList?.contains("vf-brand-link")) continue;
          brandTree(node);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  },
});
