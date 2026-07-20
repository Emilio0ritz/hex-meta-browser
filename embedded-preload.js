// Runs inside every page loaded in the HEX embedded view.
// Watches text selection. When the user has selected ~5+ characters,
// shows a small floating "+ Scratchpad" button above the selection.
// Clicking the button sends the selection + page metadata back to the
// main process via the bridge exposed in this isolated world.

const { ipcRenderer } = require("electron");

const STYLE_ID = "__hex_capture_style__";
const BTN_ID = "__hex_capture_btn__";

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${BTN_ID} {
      position: fixed;
      z-index: 2147483646;
      display: none;
      padding: 6px 11px;
      border: none;
      border-radius: 14px;
      background: #1f2624;
      color: #f6f9f4;
      font: 600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      cursor: pointer;
      box-shadow: 0 6px 18px rgba(20, 30, 26, 0.32), 0 0 0 1px rgba(255,255,255,0.08) inset;
      user-select: none;
      transform: translate(-50%, -100%);
      pointer-events: auto;
      opacity: 0;
      transition: opacity 100ms ease, transform 100ms ease;
    }
    #${BTN_ID}.visible {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      opacity: 1;
      transform: translate(-50%, calc(-100% - 8px));
    }
    #${BTN_ID}:hover {
      background: #2e6f79;
    }
    #${BTN_ID}::before {
      content: "+";
      font-weight: 700;
      font-size: 13px;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

function ensureButton() {
  let btn = document.getElementById(BTN_ID);
  if (btn) return btn;

  btn = document.createElement("button");
  btn.id = BTN_ID;
  btn.type = "button";
  btn.textContent = "Scratchpad";
  btn.setAttribute("aria-label", "Send selection to HEX scratchpad");

  // Stop propagation so we don't disturb the page's own handlers
  btn.addEventListener("mousedown", e => e.stopPropagation());
  btn.addEventListener("click", e => {
    e.preventDefault();
    e.stopPropagation();
    captureCurrentSelection();
  });

  (document.body || document.documentElement).appendChild(btn);
  return btn;
}

function getSelectionText() {
  const sel = window.getSelection ? window.getSelection() : null;
  if (!sel) return "";
  return (sel.toString() || "").trim();
}

function getSelectionRect() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const rects = range.getClientRects();
  if (rects.length === 0) {
    // Fallback to bounding rect
    const r = range.getBoundingClientRect();
    return r.width || r.height ? r : null;
  }
  // Use the LAST rect (where the user finished selecting)
  return rects[rects.length - 1];
}

function showButtonForSelection() {
  const text = getSelectionText();
  const btn = ensureButton();
  if (text.length < 5) {
    btn.classList.remove("visible");
    return;
  }
  const rect = getSelectionRect();
  if (!rect) {
    btn.classList.remove("visible");
    return;
  }
  // Anchor the button above the middle of the last line of the selection
  const x = Math.max(60, Math.min(window.innerWidth - 60, rect.left + rect.width / 2));
  const y = Math.max(36, rect.top);
  btn.style.left = `${x}px`;
  btn.style.top = `${y}px`;
  btn.classList.add("visible");
}

function hideButton() {
  const btn = document.getElementById(BTN_ID);
  if (btn) btn.classList.remove("visible");
}

function captureCurrentSelection() {
  const text = getSelectionText();
  if (!text) return;
  const payload = {
    text,
    url: location.href,
    title: document.title || location.hostname,
    capturedAt: new Date().toISOString()
  };
  ipcRenderer.send("embedded:capture", payload);

  // Brief feedback then hide. The main app shows a toast.
  const btn = document.getElementById(BTN_ID);
  if (btn) {
    btn.textContent = "Saved";
    setTimeout(() => {
      if (btn) {
        btn.textContent = "Scratchpad";
        btn.classList.remove("visible");
      }
    }, 700);
  }

  // Clear native selection so the button doesn't immediately reappear
  try { window.getSelection().removeAllRanges(); } catch {}
}

function init() {
  if (window.top !== window) return; // Skip cross-origin iframes
  injectStyles();
  ensureButton();

  let raf = 0;
  const onSelectionChange = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(showButtonForSelection);
  };

  document.addEventListener("selectionchange", onSelectionChange, { passive: true });
  document.addEventListener("scroll", hideButton, { passive: true, capture: true });
  window.addEventListener("resize", hideButton, { passive: true });
  document.addEventListener("mousedown", evt => {
    // If user clicks somewhere that isn't our button, hide it
    const btn = document.getElementById(BTN_ID);
    if (btn && evt.target !== btn) hideButton();
  }, { passive: true, capture: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
