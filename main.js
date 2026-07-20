const { app, BaseWindow, BrowserWindow, WebContentsView, ipcMain, shell, Menu, dialog, session, screen, clipboard, net } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const { CodexDockService } = require("./codex-service");

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

// Build a minimal app menu that registers the standard clipboard accelerators
// (Ctrl+C / Ctrl+V / Ctrl+X / Ctrl+A / Ctrl+Z / Ctrl+Y). Without this menu,
// Electron does not bind those shortcuts and copy/paste silently fails.
function buildAppMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    }] : []),
    {
      label: "File",
      submenu: [
        isMac ? { role: "close" } : { role: "quit" }
      ]
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    },
    {
      role: "window",
      submenu: [
        { role: "minimize" },
        { role: "close" }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Single WebContentsView instance — the universal embedded surface.
let mainWindow = null;
let overlayWindow = null;
let overlayExpanded = false;
let view = null;
let viewVisible = false;
let lastBounds = { x: 0, y: 0, width: 0, height: 0 };

function mainChromeContents() {
  if (!mainWindow || !mainWindow.contentView) return null;
  const chrome = mainWindow.contentView.children[0];
  return chrome && !chrome.webContents.isDestroyed() ? chrome.webContents : null;
}

function isMainChromeSender(event) {
  return Boolean(mainChromeContents() && event.sender === mainChromeContents());
}

function sendCodexStatus(payload) {
  const contents = mainChromeContents();
  if (contents) contents.send("codex:status", payload);
}

const codexDock = new CodexDockService({ onStatus: sendCodexStatus });

// Session partition name kept as legacy "browser-base" on purpose.
// Renaming this would orphan every embedded site login (Notion, ChatGPT, etc.)
// because Chromium stores cookies/storage per partition name.
const PARTITION = "persist:browser-base";

function createWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = new BaseWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "HEX",
    backgroundColor: "#eff2ed"
  });

  // The chrome/UI view — our existing HTML/CSS/JS app
  const chrome = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.contentView.addChildView(chrome);

  // Size the chrome to fill the window
  const resizeChrome = () => {
    const { width, height } = mainWindow.getContentBounds();
    chrome.setBounds({ x: 0, y: 0, width, height });
    // Re-apply view bounds when window resizes so it stays aligned
    if (view && viewVisible) {
      applyViewBounds(lastBounds);
    }
  };
  mainWindow.on("resize", resizeChrome);
  resizeChrome();

  chrome.webContents.loadFile(path.join(__dirname, "index.html"));

  // Pipe renderer console to main stdout so we can see errors in the terminal
  chrome.webContents.on("console-message", (_e, level, message, line, source) => {
    const levels = ["log", "warn", "error"];
    const tag = levels[level] || "log";
    if (tag === "error" || tag === "warn") {
      console.log(`[renderer ${tag}] ${message} (${source}:${line})`);
    }
  });

  // Open external <a target="_blank"> in the real browser
  chrome.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    view = null;
  });
}

const OVERLAY_COLLAPSED = { width: 58, height: 132 };
const OVERLAY_EXPANDED = { width: 372, height: 680 };

function overlayBounds(expanded) {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;
  const size = expanded ? OVERLAY_EXPANDED : OVERLAY_COLLAPSED;
  return {
    width: size.width,
    height: Math.min(size.height, area.height - 24),
    x: area.x + area.width - size.width,
    y: area.y + Math.max(12, Math.round((area.height - Math.min(size.height, area.height - 24)) / 2))
  };
}

function setOverlayExpanded(expanded) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayExpanded = Boolean(expanded);
  // Windows can reject programmatic size changes while a window is marked
  // non-resizable. Briefly allow the transition, then lock the panel again.
  overlayWindow.setResizable(true);
  overlayWindow.setBounds(overlayBounds(overlayExpanded));
  overlayWindow.setResizable(false);
  overlayWindow.webContents.send("overlay:state", { expanded: overlayExpanded });
  overlayWindow.show();
  overlayWindow.moveTop();
  if (overlayExpanded) overlayWindow.focus();
}

function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    ...overlayBounds(false),
    title: "HEX",
    frame: false,
    transparent: false,
    backgroundColor: "#101318",
    resizable: false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    hasShadow: true,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  overlayWindow.setAlwaysOnTop(true);
  overlayWindow.loadFile(path.join(__dirname, "overlay.html")).then(() => {
    setOverlayExpanded(false);
  });
  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });
}

function ensureView() {
  if (view) return view;
  view = new WebContentsView({
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "embedded-preload.js")
    }
  });
  // Start fully off-screen — renderer will request bounds when ready
  view.setBounds({ x: -10000, y: -10000, width: 1, height: 1 });

  const wc = view.webContents;
  const send = (channel, payload) => {
    if (mainWindow && mainWindow.contentView) {
      const chrome = mainWindow.contentView.children[0];
      if (chrome && !chrome.webContents.isDestroyed()) {
        chrome.webContents.send(channel, payload);
      }
    }
  };

  wc.on("did-start-loading", () => send("view:loading", true));
  wc.on("did-stop-loading", () => {
    send("view:loading", false);
    send("view:nav", {
      url: wc.getURL(),
      title: wc.getTitle(),
      canGoBack: wc.canGoBack(),
      canGoForward: wc.canGoForward()
    });
  });
  wc.on("page-title-updated", (_e, title) => {
    send("view:title", { title, url: wc.getURL() });
  });
  wc.on("did-navigate", (_e, url) => {
    send("view:nav", {
      url,
      title: wc.getTitle(),
      canGoBack: wc.canGoBack(),
      canGoForward: wc.canGoForward()
    });
  });
  wc.on("did-navigate-in-page", (_e, url) => {
    send("view:nav", {
      url,
      title: wc.getTitle(),
      canGoBack: wc.canGoBack(),
      canGoForward: wc.canGoForward()
    });
  });
  // Pop-ups from inside the embedded page → open externally
  wc.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.contentView.addChildView(view);
  return view;
}

function applyViewBounds(bounds) {
  if (!view) return;
  const safe = {
    x: Math.max(0, Math.round(bounds.x || 0)),
    y: Math.max(0, Math.round(bounds.y || 0)),
    width: Math.max(1, Math.round(bounds.width || 1)),
    height: Math.max(1, Math.round(bounds.height || 1))
  };
  lastBounds = safe;
  view.setBounds(safe);
}

// ── IPC API exposed to the renderer (see preload.js) ───────────────

// Quick-capture from embedded pages: forward selection + page metadata
// from any embedded WebContentsView's preload to the chrome renderer.
ipcMain.on("embedded:capture", (event, payload) => {
  if (!payload || typeof payload.text !== "string" || !payload.text.trim()) return;
  // Only accept from our own embedded view's webContents
  if (!view || event.sender !== view.webContents) return;
  if (mainWindow && mainWindow.contentView) {
    const chrome = mainWindow.contentView.children[0];
    if (chrome && !chrome.webContents.isDestroyed()) {
      chrome.webContents.send("capture:received", {
        text: payload.text.trim(),
        url: String(payload.url || ""),
        title: String(payload.title || ""),
        capturedAt: payload.capturedAt || new Date().toISOString()
      });
    }
  }
});

ipcMain.handle("view:navigate", (_e, url) => {
  if (!url) return null;
  const v = ensureView();
  try {
    v.webContents.loadURL(url);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle("view:back", () => {
  if (view && view.webContents.canGoBack()) {
    view.webContents.goBack();
  }
});

ipcMain.handle("view:forward", () => {
  if (view && view.webContents.canGoForward()) {
    view.webContents.goForward();
  }
});

ipcMain.handle("view:reload", () => {
  if (view) view.webContents.reload();
});

ipcMain.handle("view:stop", () => {
  if (view) view.webContents.stop();
});

ipcMain.handle("view:show", (_e, bounds) => {
  ensureView();
  applyViewBounds(bounds);
  viewVisible = true;
});

ipcMain.handle("view:hide", () => {
  if (!view) return;
  viewVisible = false;
  view.setBounds({ x: -10000, y: -10000, width: 1, height: 1 });
});

ipcMain.handle("view:setBounds", (_e, bounds) => {
  if (!view) return;
  if (viewVisible) applyViewBounds(bounds);
});

ipcMain.handle("view:openExternal", (_e, url) => {
  if (url) shell.openExternal(url);
});

ipcMain.handle("view:getState", () => {
  if (!view) return { url: "", title: "", canGoBack: false, canGoForward: false };
  const wc = view.webContents;
  return {
    url: wc.getURL(),
    title: wc.getTitle(),
    canGoBack: wc.canGoBack(),
    canGoForward: wc.canGoForward()
  };
});

// ── Data root + thread folder operations ────────────────────────────

function safeJoin(root, child) {
  const resolved = path.resolve(root, child);
  const resolvedRoot = path.resolve(root);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path escapes data root");
  }
  return resolved;
}

async function resolveCodexWorkspace(payload = {}) {
  const root = typeof payload.root === "string" ? payload.root : "";
  const folderName = typeof payload.folderName === "string" ? payload.folderName : "";
  if (!root || !path.isAbsolute(root)) throw new Error("HEX storage folder is not connected");
  if (!folderName || folderName !== path.basename(folderName) || folderName.length > 120) {
    throw new Error("HEX Thread folder is invalid");
  }
  const workspacePath = safeJoin(root, folderName);
  await fsp.mkdir(workspacePath, { recursive: true });
  return workspacePath;
}

function activeDialogOwner() {
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow;
  if (mainWindow) return mainWindow;
  return null;
}

function showHexOpenDialog(options) {
  const owner = activeDialogOwner();
  return owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options);
}

ipcMain.handle("data:default-roots", () => {
  return {
    documents: path.join(app.getPath("documents"), "HEX"),
    desktop: path.join(app.getPath("desktop"), "HEX"),
    home: path.join(app.getPath("home"), "HEX")
  };
});

ipcMain.handle("data:choose-root", async () => {
  const result = await showHexOpenDialog({
    title: "Choose where HEX should keep your thread folders",
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
});

ipcMain.handle("data:ensure-root", async (_e, rootPath) => {
  if (!rootPath || typeof rootPath !== "string") return { ok: false, error: "no path" };
  await fsp.mkdir(rootPath, { recursive: true });
  return { ok: true, path: rootPath };
});

ipcMain.handle("data:ensure-thread-folder", async (_e, { root, folderName }) => {
  if (!root || !folderName) return { ok: false };
  const full = safeJoin(root, folderName);
  await fsp.mkdir(full, { recursive: true });
  return { ok: true, path: full };
});

ipcMain.handle("data:list-thread-files", async (_e, { root, folderName }) => {
  if (!root || !folderName) return { files: [], path: "" };
  const full = safeJoin(root, folderName);
  try {
    const entries = await fsp.readdir(full, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const filePath = path.join(full, entry.name);
      const stats = await fsp.stat(filePath);
      const ext = path.extname(entry.name).slice(1).toLowerCase() || "file";
      files.push({
        name: entry.name,
        path: filePath,
        size: stats.size,
        modifiedAt: stats.mtime.getTime(),
        extension: ext
      });
    }
    files.sort((a, b) => b.modifiedAt - a.modifiedAt);
    return { files, path: full };
  } catch {
    return { files: [], path: full };
  }
});

const PREVIEW_MIME_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp"
};

ipcMain.handle("data:file-preview", async (_e, { root, folderName, fileName }) => {
  if (!root || !folderName || !fileName || path.basename(fileName) !== fileName) return null;
  const extension = path.extname(fileName).slice(1).toLowerCase();
  const mimeType = PREVIEW_MIME_TYPES[extension];
  if (!mimeType) return null;

  const folderPath = safeJoin(root, folderName);
  const filePath = safeJoin(folderPath, fileName);
  try {
    const stats = await fsp.stat(filePath);
    if (!stats.isFile() || stats.size > 8 * 1024 * 1024) return null;
    const data = await fsp.readFile(filePath);
    return `data:${mimeType};base64,${data.toString("base64")}`;
  } catch {
    return null;
  }
});

async function copyFilesIntoThread(root, folderName, filePaths) {
  if (!root || !folderName || !Array.isArray(filePaths)) return { copied: [], errors: [] };
  const destination = safeJoin(root, folderName);
  await fsp.mkdir(destination, { recursive: true });
  const copied = [];
  const errors = [];

  for (const source of filePaths) {
    try {
      const stats = await fsp.stat(source);
      if (!stats.isFile()) continue;
      const parsed = path.parse(source);
      let target = path.join(destination, parsed.base);
      let suffix = 2;
      while (fs.existsSync(target)) {
        target = path.join(destination, `${parsed.name}-${suffix}${parsed.ext}`);
        suffix += 1;
      }
      await fsp.copyFile(source, target);
      copied.push(path.basename(target));
    } catch (error) {
      errors.push({ file: path.basename(String(source)), error: String(error) });
    }
  }

  return { copied, errors };
}

ipcMain.handle("data:choose-and-add-files", async (_e, { root, folderName }) => {
  const result = await showHexOpenDialog({
    title: "Add files to this HEX thread",
    properties: ["openFile", "multiSelections"]
  });
  if (result.canceled) return { copied: [], errors: [] };
  return copyFilesIntoThread(root, folderName, result.filePaths);
});

ipcMain.handle("data:add-dropped-files", (_e, { root, folderName, filePaths }) => {
  return copyFilesIntoThread(root, folderName, filePaths);
});

ipcMain.handle("data:open-folder", async (_e, folderPath) => {
  if (!folderPath) return false;
  try { await fsp.mkdir(folderPath, { recursive: true }); } catch {}
  const err = await shell.openPath(folderPath);
  return !err;
});

ipcMain.handle("data:open-thread-folder", async (_e, { root, folderName }) => {
  if (!root || !folderName) return false;
  const folderPath = safeJoin(root, folderName);
  await fsp.mkdir(folderPath, { recursive: true });
  const error = await shell.openPath(folderPath);
  return !error;
});

ipcMain.handle("data:open-file", async (_e, filePath) => {
  if (!filePath) return false;
  const err = await shell.openPath(filePath);
  return !err;
});

ipcMain.handle("data:reveal-file", async (_e, filePath) => {
  if (!filePath) return false;
  shell.showItemInFolder(filePath);
  return true;
});

// List subdirectories of root that aren't in the supplied list of "claimed" names
ipcMain.handle("data:find-orphans", async (_e, { root, claimed }) => {
  if (!root) return [];
  try {
    const entries = await fsp.readdir(root, { withFileTypes: true });
    const claimedSet = new Set((claimed || []).map(s => String(s).toLowerCase()));
    const orphans = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (claimedSet.has(entry.name.toLowerCase())) continue;
      const full = path.join(root, entry.name);
      const sub = await fsp.readdir(full).catch(() => []);
      orphans.push({ name: entry.name, path: full, fileCount: sub.length });
    }
    return orphans;
  } catch {
    return [];
  }
});

ipcMain.handle("data:delete-folder", async (_e, folderPath) => {
  if (!folderPath) return { ok: false };
  try {
    // Move to trash for safety, fall back to recursive remove
    await shell.trashItem(folderPath);
    return { ok: true, trashed: true };
  } catch {
    try {
      await fsp.rm(folderPath, { recursive: true, force: true });
      return { ok: true, trashed: false };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }
});

ipcMain.handle("data:get-cache-size", async () => {
  try {
    const partition = session.fromPartition(PARTITION);
    const size = await partition.getCacheSize();
    return size;
  } catch {
    return 0;
  }
});

// Codex runs only in the main process. The renderer supplies structured Thread
// context, while the workspace is derived from HEX's existing folder system.
ipcMain.handle("codex:connect", async (event, payload = {}) => {
  if (!isMainChromeSender(event)) return { ok: false, status: "unavailable", message: "Codex Dock is only available in the expanded HEX window." };
  try {
    const workspacePath = await resolveCodexWorkspace(payload);
    return codexDock.connect({
      hexThreadId: payload.hexThreadId,
      workspacePath,
      permissionMode: payload.permissionMode
    });
  } catch {
    return { ok: false, status: "no-folder", code: "folder", message: "The HEX Thread folder is missing or inaccessible." };
  }
});

ipcMain.handle("codex:run", async (event, payload = {}) => {
  if (!isMainChromeSender(event)) return { ok: false, status: "unavailable", message: "Codex Dock is only available in the expanded HEX window." };
  try {
    const workspacePath = await resolveCodexWorkspace(payload);
    return codexDock.run({
      hexThreadId: payload.hexThreadId,
      workspacePath,
      permissionMode: payload.permissionMode,
      threadId: payload.threadId,
      context: payload.context,
      instruction: payload.instruction
    });
  } catch {
    return { ok: false, status: "no-folder", code: "folder", message: "The HEX Thread folder is missing or inaccessible." };
  }
});

ipcMain.handle("codex:disconnect", (event, payload = {}) => {
  if (!isMainChromeSender(event)) return { ok: false };
  return codexDock.disconnect(payload.hexThreadId);
});

ipcMain.handle("cache:clear", async (_e, opts = {}) => {
  const partition = session.fromPartition(PARTITION);
  if (opts.full) {
    // Wipes everything including cookies/logins
    await partition.clearStorageData();
    await partition.clearCache();
  } else {
    // Just cache + temporary site storage; keep logins
    await partition.clearStorageData({
      storages: ["appcache", "cachestorage", "shadercache", "filesystem", "serviceworkers"]
    });
    await partition.clearCache();
  }
  return { ok: true };
});

ipcMain.handle("overlay:toggle", () => {
  setOverlayExpanded(!overlayExpanded);
  return { expanded: overlayExpanded };
});

ipcMain.handle("overlay:collapse", () => {
  setOverlayExpanded(false);
  return { expanded: false };
});

ipcMain.handle("overlay:get-state", () => ({ expanded: overlayExpanded }));

ipcMain.handle("overlay:open-manager", () => {
  createWindow();
  setOverlayExpanded(false);
  return true;
});

ipcMain.handle("overlay:quit", () => app.quit());

ipcMain.handle("clipboard:read-text", () => clipboard.readText());
ipcMain.handle("clipboard:write-text", (_e, text) => {
  clipboard.writeText(String(text || ""));
  return true;
});

function conciseExtract(text, maxLength = 520) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  const clipped = clean.slice(0, maxLength + 1);
  const sentenceEnd = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf("? "), clipped.lastIndexOf("! "));
  if (sentenceEnd >= 140) return clipped.slice(0, sentenceEnd + 1);
  const wordEnd = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, wordEnd > 0 ? wordEnd : maxLength).trim()}...`;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await net.fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "HEX/0.1 definition lookup" }
    });
    if (!response.ok) throw new Error(`Knowledge source returned ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function isDisambiguationPage(page) {
  const pageProps = page?.pageprops || {};
  const extract = String(page?.extract || "");
  return Object.prototype.hasOwnProperty.call(pageProps, "disambiguation")
    || /\b(?:may|can|might|could) (?:also )?refer to\b/i.test(extract);
}

function compactLookupText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function usefulContext(value) {
  const context = String(value || "")
    .replace(/^(?:studying|study(?:ing)? about|learning(?: about)?|researching|research(?:ing)? about|working on)\s+/i, "")
    .trim();
  return /^(?:home|untitled thread)$/i.test(context) ? "" : context;
}

function definitionScore(page, term, context) {
  const title = String(page.title || "");
  const titleCompact = compactLookupText(title);
  const termCompact = compactLookupText(term);
  const contextCompact = compactLookupText(context);
  const contextWords = [...new Set((String(context || "").toLowerCase().match(/[a-z0-9]{3,}/g) || [])
    .map(word => word.endsWith("s") && word.length > 4 ? word.slice(0, -1) : word))];
  const lowerTitle = title.toLowerCase();
  const lowerExtract = String(page.extract || "").toLowerCase();
  let score = -(page.index ?? 999);

  if (titleCompact === termCompact) score += 200;
  else if (titleCompact.includes(termCompact)) score += 80;
  if (contextCompact && titleCompact === contextCompact) score += 160;
  contextWords.forEach(word => {
    if (lowerTitle.includes(word)) score += 18;
    else if (lowerExtract.includes(word)) score += 3;
  });
  return score;
}

async function searchWikipediaDefinition(term, context = "") {
  const cleanTerm = term.replace(/"/g, " ");
  const cleanContext = context.replace(/"/g, " ");
  const query = context ? `intitle:"${cleanTerm}" ${cleanContext}` : cleanTerm;
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "0",
    gsrlimit: "8",
    prop: "extracts|info|pageprops",
    exintro: "1",
    explaintext: "1",
    exsentences: "2",
    inprop: "url",
    ppprop: "disambiguation",
    format: "json",
    formatversion: "2",
    origin: "*"
  });
  const data = await fetchJson(`https://en.wikipedia.org/w/api.php?${params}`);
  return (data?.query?.pages || [])
    .filter(page => page.extract && page.fullurl)
    .sort((a, b) => (a.index ?? 999) - (b.index ?? 999));
}

async function fetchWikipediaTitle(title) {
  const params = new URLSearchParams({
    action: "query",
    titles: title,
    redirects: "1",
    prop: "extracts|info|pageprops",
    exintro: "1",
    explaintext: "1",
    exsentences: "2",
    inprop: "url",
    ppprop: "disambiguation",
    format: "json",
    formatversion: "2",
    origin: "*"
  });
  const data = await fetchJson(`https://en.wikipedia.org/w/api.php?${params}`);
  const page = data?.query?.pages?.[0];
  return page && !page.missing && page.extract && page.fullurl ? page : null;
}

ipcMain.handle("knowledge:define", async (_event, payload = {}) => {
  const term = String(payload.term || "").replace(/\s+/g, " ").trim().slice(0, 160);
  const context = usefulContext(String(payload.context || "").replace(/\s+/g, " ").trim().slice(0, 240));
  if (!term) throw new Error("Enter a term first");

  const exactPage = await fetchWikipediaTitle(term);
  if (exactPage && !isDisambiguationPage(exactPage)) {
    return {
      definition: conciseExtract(exactPage.extract),
      source: exactPage.fullurl,
      sourceLabel: `Wikipedia: ${exactPage.title}`
    };
  }
  if (exactPage && isDisambiguationPage(exactPage) && !context) {
    throw new Error("This term is ambiguous. Add context to the thread or make the term more specific.");
  }

  if (context) {
    const contextPage = await fetchWikipediaTitle(context);
    const termCompact = compactLookupText(term);
    const contextPageIncludesTerm = contextPage
      && (compactLookupText(contextPage.title).includes(termCompact)
        || compactLookupText(contextPage.extract).includes(termCompact));
    if (contextPageIncludesTerm && !isDisambiguationPage(contextPage)) {
      return {
        definition: conciseExtract(contextPage.extract),
        source: contextPage.fullurl,
        sourceLabel: `Wikipedia: ${contextPage.title}`
      };
    }
  }

  const plainPages = await searchWikipediaDefinition(term);
  const contextualPages = context ? await searchWikipediaDefinition(term, context) : [];
  const pagesById = new Map([...contextualPages, ...plainPages].map(page => [page.pageid, page]));
  const pages = [...pagesById.values()]
    .filter(page => !isDisambiguationPage(page))
    .sort((a, b) => definitionScore(b, term, context) - definitionScore(a, term, context));
  const match = pages[0];
  if (!match) throw new Error("No concise definition found");

  return {
    definition: conciseExtract(match.extract),
    source: match.fullurl,
    sourceLabel: `Wikipedia: ${match.title}`
  };
});

// Right-click context menu wired to every WebContents (chrome + embedded view).
// Decides what items to show based on what the user clicked.
function attachContextMenu(webContents) {
  webContents.on("context-menu", (_event, params) => {
    const items = [];
    const isInput = params.isEditable;
    const hasSelection = !!(params.selectionText && params.selectionText.trim());
    const hasLink = !!params.linkURL;
    const hasImage = params.mediaType === "image";

    if (hasLink) {
      items.push({
        label: "Open Link in External Browser",
        click: () => shell.openExternal(params.linkURL).catch(() => {})
      });
      items.push({
        label: "Copy Link Address",
        click: () => require("electron").clipboard.writeText(params.linkURL)
      });
      items.push({ type: "separator" });
    }

    if (hasImage && params.srcURL) {
      items.push({
        label: "Copy Image Address",
        click: () => require("electron").clipboard.writeText(params.srcURL)
      });
      items.push({ type: "separator" });
    }

    if (isInput) {
      items.push({ role: "undo", enabled: params.editFlags.canUndo });
      items.push({ role: "redo", enabled: params.editFlags.canRedo });
      items.push({ type: "separator" });
      items.push({ role: "cut", enabled: params.editFlags.canCut });
      items.push({ role: "copy", enabled: params.editFlags.canCopy });
      items.push({ role: "paste", enabled: params.editFlags.canPaste });
      items.push({ role: "selectAll", enabled: params.editFlags.canSelectAll });
    } else if (hasSelection) {
      items.push({ role: "copy", enabled: params.editFlags.canCopy });
      items.push({ role: "selectAll", enabled: params.editFlags.canSelectAll });
    } else if (!hasLink && !hasImage) {
      // Generic menu when nothing specific is clicked
      items.push({ role: "selectAll", enabled: params.editFlags.canSelectAll });
      items.push({ type: "separator" });
      items.push({ label: "Reload", click: () => webContents.reload() });
      items.push({ label: "Inspect Element", click: () => webContents.inspectElement(params.x, params.y) });
    }

    // Always offer Inspect (useful while debugging)
    if (isInput || hasSelection || hasLink || hasImage) {
      items.push({ type: "separator" });
      items.push({ label: "Inspect Element", click: () => webContents.inspectElement(params.x, params.y) });
    }

    if (items.length === 0) return;
    Menu.buildFromTemplate(items).popup();
  });
}

// Attach to every WebContents created in this app (chrome + embedded views)
app.on("web-contents-created", (_e, contents) => {
  attachContextMenu(contents);
});

app.on("second-instance", () => {
  if (!app.isReady()) return;
  if (!overlayWindow || overlayWindow.isDestroyed()) createOverlayWindow();
  setOverlayExpanded(true);
});

if (hasSingleInstanceLock) {
  app.whenReady().then(() => {
    buildAppMenu();
    createOverlayWindow();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => codexDock.shutdown());

app.on("activate", () => {
  if (!overlayWindow) createOverlayWindow();
  else overlayWindow.show();
});
