// NOTE: storage keys keep the legacy "browserBase" prefix on purpose.
// Renaming them would orphan every existing user's saved state. They are
// internal identifiers that the user never sees.
const STORAGE_KEY = "emilio.browserBase.v3";
const LEGACY_KEYS = ["emilio.browserBase.v2", "emilio.browserBase.v1"];
const SIDEBAR_KEY = "emilio.browserBase.sidebar";
const SHOW_ARCHIVED_KEY = "emilio.browserBase.showArchived";
const THEME_KEY = "emilio.browserBase.theme";

const IS_ELECTRON = typeof window !== "undefined" && !!window.bb && window.bb.env && window.bb.env.isElectron;

const engines = {
  google: query => `https://www.google.com/search?q=${encodeURIComponent(query)}`,
  perplexity: query => `https://www.perplexity.ai/search?q=${encodeURIComponent(query)}`,
  youtube: query => `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
  reddit: query => `https://www.reddit.com/search/?q=${encodeURIComponent(query)}`
};

const modeCopy = {
  research: "Collect sources, questions, and patterns.",
  writing: "Keep references close and move toward a draft.",
  opportunity: "Scan lightly, capture leads, avoid rabbit holes.",
  deepWork: "Reduce inputs and protect the active thread."
};

const modeShortcuts = {
  research: [
    ["Google", "https://www.google.com"],
    ["Perplexity", "https://www.perplexity.ai"],
    ["Reddit", "https://www.reddit.com"],
    ["YouTube", "https://www.youtube.com"],
    ["ChatGPT", "https://chatgpt.com"],
    ["Claude", "https://claude.ai"]
  ],
  writing: [
    ["Notion", "https://www.notion.so"],
    ["Substack", "https://substack.com"],
    ["ChatGPT", "https://chatgpt.com"],
    ["Claude", "https://claude.ai"]
  ],
  opportunity: [
    ["Gmail", "https://mail.google.com"],
    ["LinkedIn", "https://www.linkedin.com"],
    ["Upwork", "https://www.upwork.com"],
    ["Notion", "https://www.notion.so"]
  ],
  deepWork: [
    ["Google", "https://www.google.com"],
    ["Notion", "https://www.notion.so"],
    ["ChatGPT", "https://chatgpt.com"]
  ]
};

const defaultThread = {
  id: "thread_home",
  title: "Home",
  mode: "research",
  notes: "",
  queue: [
    { text: "Try a search to see how HEX captures your trail", done: false },
    { text: "Save your three most-used destinations under Saved Links", done: false }
  ],
  loops: [],
  links: [
    { name: "Google", url: "https://www.google.com" },
    { name: "ChatGPT", url: "https://chatgpt.com" },
    { name: "Notion", url: "https://www.notion.so" }
  ],
  pins: [],
  stickyNotion: null,
  codex: {
    intent: "continue",
    handoff: "",
    promptDraft: "",
    threadId: "",
    workspacePath: "",
    permissionMode: "read-only",
    status: "no-folder",
    statusMessage: "Connect the Thread folder to begin.",
    lastRunAt: "",
    lastResponsePreview: ""
  },
  researchTrail: [],
  activity: [],
  archived: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const defaultState = {
  version: 3,
  activeThreadId: defaultThread.id,
  threads: {
    [defaultThread.id]: structuredClone(defaultThread)
  },
  global: {
    engine: "google",
    quickLinks: [
      { name: "Google", url: "https://www.google.com" },
      { name: "ChatGPT", url: "https://chatgpt.com" },
      { name: "Notion", url: "https://www.notion.so" }
    ],
    activity: [],
    dataRoot: "",          // absolute path to root folder (Electron only)
    onboarded: false       // first-launch onboarding complete
  }
};

const state = loadState();
let showArchived = localStorage.getItem(SHOW_ARCHIVED_KEY) === "1";
let currentThreadFileCount = 0;
const codexInstructionDrafts = new Map();

// ── Thread folders (Electron native filesystem) ─────────────────────

// Slugify a thread title into a safe folder name.
// Examples: "100 Book Pipeline!" → "100-book-pipeline"
//           "Home" → "home", "" → "untitled"
function slugifyTitle(title) {
  const s = String(title || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\-_ ]+/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "untitled";
}

// Choose a folder name for a new thread that doesn't collide with any
// existing thread's folderName (case-insensitive).
function uniqueFolderName(baseSlug, existingNames) {
  const used = new Set((existingNames || []).map(n => String(n || "").toLowerCase()));
  if (!used.has(baseSlug)) return baseSlug;
  let n = 2;
  while (used.has(`${baseSlug}-${n}`)) n++;
  return `${baseSlug}-${n}`;
}

// Create a folder for a thread (idempotent). Stores folderName on the thread.
async function ensureThreadFolder(thread) {
  if (!IS_ELECTRON) return;
  const root = state.global.dataRoot;
  if (!root) return;
  if (!thread.folderName) {
    const existing = Object.values(state.threads).map(t => t.folderName).filter(Boolean);
    thread.folderName = uniqueFolderName(slugifyTitle(thread.title), existing);
  }
  return window.bb.data.ensureThreadFolder(root, thread.folderName);
}

// Create folders for any thread that doesn't have one yet (called after root is set).
async function backfillThreadFolders() {
  if (!IS_ELECTRON || !state.global.dataRoot) return;
  for (const thread of Object.values(state.threads)) {
    if (!thread.folderName) {
      const existing = Object.values(state.threads).map(t => t.folderName).filter(Boolean);
      thread.folderName = uniqueFolderName(slugifyTitle(thread.title), existing);
    }
    try {
      await window.bb.data.ensureThreadFolder(state.global.dataRoot, thread.folderName);
    } catch {}
  }
  saveState();
}

async function loadThreadFiles() {
  if (!IS_ELECTRON) {
    renderThreadFileMessage("Thread files are a desktop-app feature.");
    return;
  }
  const root = state.global.dataRoot;
  if (!root) {
    renderThreadFileMessage("Choose a storage folder in Settings.");
    return;
  }
  const thread = currentThread();
  if (!thread.folderName) {
    await ensureThreadFolder(thread);
    saveState();
  }
  const { files, path: folderPath } = await window.bb.data.listThreadFiles(root, thread.folderName);
  renderThreadFiles(folderPath, files);
}

function renderThreadFiles(folderPath, files) {
  currentThreadFileCount = files.length;
  elements.threadFolderPath.textContent = folderPath;
  elements.threadFiles.replaceChildren();

  if (files.length === 0) {
    const empty = document.createElement("li");
    empty.className = "thread-file-empty";
    empty.textContent = "Drop files here or use Add files.";
    elements.threadFiles.append(empty);
  }

  files.forEach(file => {
    const row = document.createElement("li");
    row.className = "thread-file";

    const meta = document.createElement("div");
    meta.className = "thread-file-meta";

    const name = document.createElement("strong");
    name.textContent = file.name;

    const detail = document.createElement("span");
    detail.textContent = `${file.extension.toUpperCase()} · ${formatBytes(file.size)} · ${formatDateTime(file.modifiedAt)}`;

    const actions = document.createElement("div");
    actions.className = "thread-file-actions";

    const open = document.createElement("button");
    open.type = "button";
    open.textContent = "Open";
    open.addEventListener("click", async () => {
      await window.bb.data.openFile(file.path);
      addActivity(`Opened file: ${file.name}`);
      saveState();
      renderLog();
    });

    const reveal = document.createElement("button");
    reveal.type = "button";
    reveal.textContent = "Reveal";
    reveal.title = "Show in folder";
    reveal.addEventListener("click", () => window.bb.data.revealFile(file.path));

    meta.append(name, detail);
    actions.append(open, reveal);
    row.append(meta, actions);
    elements.threadFiles.append(row);
  });

  const thread = currentThread();
  elements.threadFilesStatus.textContent = files.length
    ? `${files.length} file${files.length === 1 ? "" : "s"} in "${thread.title}".`
    : "";
  renderCodexDock();
}

function renderThreadFileMessage(message) {
  currentThreadFileCount = 0;
  elements.threadFolderPath.textContent = "";
  elements.threadFiles.replaceChildren();
  elements.threadFilesStatus.textContent = message;
  renderCodexDock();
}

async function pickRootFolder() {
  if (!IS_ELECTRON) {
    toast("Folder picking requires the desktop app");
    return null;
  }
  const chosen = await window.bb.data.chooseRoot();
  if (!chosen) return null;
  await window.bb.data.ensureRoot(chosen);
  state.global.dataRoot = chosen;
  saveState();
  addActivity(`Linked data folder: ${chosen}`);
  toast(`Data folder: ${chosen}`);
  await backfillThreadFolders();
  await loadThreadFiles();
  render();
  return chosen;
}

async function openCurrentThreadFolder() {
  if (!IS_ELECTRON || !state.global.dataRoot) return;
  const thread = currentThread();
  if (!thread.folderName) {
    await ensureThreadFolder(thread);
    saveState();
  }
  await window.bb.data.openThreadFolder(state.global.dataRoot, thread.folderName);
}

async function openOrCreateCodexFolder() {
  if (!IS_ELECTRON) {
    toast("Folder access requires the HEX desktop app");
    return;
  }
  if (!state.global.dataRoot) {
    const chosen = await pickRootFolder();
    if (!chosen) return;
  }
  const thread = currentThread();
  await ensureThreadFolder(thread);
  saveState();
  renderCodexDock();
  try {
    const opened = await window.bb.data.openThreadFolder(state.global.dataRoot, thread.folderName);
    if (!opened) toast("HEX could not open this folder");
  } catch (error) {
    toast(error?.message || "HEX could not open this folder");
  }
}

async function addFilesToCurrentThread(filePaths = null) {
  if (!IS_ELECTRON) {
    toast("Adding files requires the desktop app");
    return;
  }
  if (!state.global.dataRoot) {
    toast("Choose a storage folder in Settings first");
    return;
  }

  const thread = currentThread();
  if (!thread.folderName) await ensureThreadFolder(thread);
  const result = filePaths
    ? await window.bb.data.addFilePaths(state.global.dataRoot, thread.folderName, filePaths)
    : await window.bb.data.chooseAndAddFiles(state.global.dataRoot, thread.folderName);

  if (result.copied.length) {
    addActivity(`Added ${result.copied.length} file${result.copied.length === 1 ? "" : "s"}`);
    toast(`Added ${result.copied.length} file${result.copied.length === 1 ? "" : "s"}`);
  } else if (result.errors.length) {
    toast("HEX could not add those files");
  }
  touchThread(thread);
  saveState();
  await loadThreadFiles();
  renderLog();
}

function initThreadFileDrop() {
  if (!IS_ELECTRON || !window.bb.data.onDroppedFiles) return;
  let dropIsOverFiles = false;

  elements.threadFilesPanel.addEventListener("dragenter", event => {
    event.preventDefault();
    dropIsOverFiles = true;
    elements.threadFilesPanel.classList.add("drop-active");
  });
  elements.threadFilesPanel.addEventListener("dragover", event => event.preventDefault());
  elements.threadFilesPanel.addEventListener("dragleave", event => {
    if (elements.threadFilesPanel.contains(event.relatedTarget)) return;
    dropIsOverFiles = false;
    elements.threadFilesPanel.classList.remove("drop-active");
  });
  elements.threadFilesPanel.addEventListener("drop", event => {
    event.preventDefault();
    elements.threadFilesPanel.classList.remove("drop-active");
    setTimeout(() => { dropIsOverFiles = false; }, 0);
  });
  window.bb.data.onDroppedFiles(filePaths => {
    if (dropIsOverFiles) addFilesToCurrentThread(filePaths);
  });
}

async function initFileSystem() {
  if (!IS_ELECTRON) {
    renderThreadFileMessage("Thread files are a desktop-app feature.");
    return;
  }
  if (!state.global.dataRoot) {
    renderThreadFileMessage("Set up your data folder from the onboarding screen.");
    return;
  }
  await backfillThreadFolders();
  await loadThreadFiles();
}

// ── DOM elements ────────────────────────────────────────────────────

const elements = {
  clock: document.querySelector("#clock"),
  resumeLine: document.querySelector("#resumeLine"),
  threadInput: document.querySelector("#threadInput"),
  threadSidebar: document.querySelector("#threadSidebar"),
  sidebarToggle: document.querySelector("#sidebarToggle"),
  sidebarCollapse: document.querySelector("#sidebarCollapse"),
  newThreadBtn: document.querySelector("#newThreadBtn"),
  threadList: document.querySelector("#threadList"),
  workspaceTitle: document.querySelector("#workspaceTitle"),
  workspaceUrl: document.querySelector("#workspaceUrl"),
  searchWorkspace: document.querySelector("#searchWorkspace"),
  searchFrameWrap: document.querySelector("#searchFrameWrap"),
  searchFrame: document.querySelector("#searchFrame"),
  searchFrameStatus: document.querySelector("#searchFrameStatus"),
  webViewSlot: document.querySelector("#webViewSlot"),
  viewBack: document.querySelector("#viewBack"),
  viewForward: document.querySelector("#viewForward"),
  viewReload: document.querySelector("#viewReload"),
  openSearchTab: document.querySelector("#openSearchTab"),
  toggleSearchWorkspace: document.querySelector("#toggleSearchWorkspace"),
  modeShortcuts: document.querySelector("#modeShortcuts"),
  threadFolderPath: document.querySelector("#threadFolderPath"),
  threadFilesPanel: document.querySelector("#threadFilesPanel"),
  threadFiles: document.querySelector("#threadFiles"),
  threadFilesStatus: document.querySelector("#threadFilesStatus"),
  addThreadFilesBtn: document.querySelector("#addThreadFilesBtn"),
  openThreadFolderBtn: document.querySelector("#openThreadFolderBtn"),
  refreshThreadFiles: document.querySelector("#refreshThreadFiles"),
  searchForm: document.querySelector("#searchForm"),
  searchInput: document.querySelector("#searchInput"),
  queueForm: document.querySelector("#queueForm"),
  queueInput: document.querySelector("#queueInput"),
  queueList: document.querySelector("#queueList"),
  loopForm: document.querySelector("#loopForm"),
  loopInput: document.querySelector("#loopInput"),
  loopList: document.querySelector("#loopList"),
  notionForm: document.querySelector("#notionForm"),
  notionNameInput: document.querySelector("#notionNameInput"),
  notionUrlInput: document.querySelector("#notionUrlInput"),
  stickyNotion: document.querySelector("#stickyNotion"),
  clearStickyNotion: document.querySelector("#clearStickyNotion"),
  linkForm: document.querySelector("#linkForm"),
  linkNameInput: document.querySelector("#linkNameInput"),
  linkUrlInput: document.querySelector("#linkUrlInput"),
  quickLinks: document.querySelector("#quickLinks"),
  codexStatus: document.querySelector("#codexStatus"),
  codexStatusDetail: document.querySelector("#codexStatusDetail"),
  codexWorkspacePath: document.querySelector("#codexWorkspacePath"),
  codexFolderAction: document.querySelector("#codexFolderAction"),
  codexSessionStatus: document.querySelector("#codexSessionStatus"),
  codexPinCount: document.querySelector("#codexPinCount"),
  codexSourceCount: document.querySelector("#codexSourceCount"),
  codexFileCount: document.querySelector("#codexFileCount"),
  codexNextStepCount: document.querySelector("#codexNextStepCount"),
  codexInstruction: document.querySelector("#codexInstruction"),
  codexConnectBtn: document.querySelector("#codexConnectBtn"),
  codexChangeFolder: document.querySelector("#codexChangeFolder"),
  codexDisconnect: document.querySelector("#codexDisconnect"),
  codexSend: document.querySelector("#codexSend"),
  codexResponseWrap: document.querySelector("#codexResponseWrap"),
  codexResponse: document.querySelector("#codexResponse"),
  codexLastRun: document.querySelector("#codexLastRun"),
  scratchpad: document.querySelector("#scratchpad"),
  researchTrail: document.querySelector("#researchTrail"),
  clearTrail: document.querySelector("#clearTrail"),
  sessionLog: document.querySelector("#sessionLog"),
  clearDone: document.querySelector("#clearDone"),
  extractActions: document.querySelector("#extractActions"),
  notesSaveStatus: document.querySelector("#notesSaveStatus"),
  // Toolbar
  exportBtn: document.querySelector("#exportBtn"),
  importBtn: document.querySelector("#importBtn"),
  importFile: document.querySelector("#importFile"),
  showArchivedBtn: document.querySelector("#showArchivedBtn"),
  archivedCount: document.querySelector("#archivedCount"),
  helpBtn: document.querySelector("#helpBtn"),
  helpModal: document.querySelector("#helpModal"),
  toastContainer: document.querySelector("#toastContainer"),
  themeToggle: document.querySelector("#themeToggle"),
  themeIcon: document.querySelector("#themeIcon"),
  themeLabel: document.querySelector("#themeLabel"),
  // Settings / onboarding
  settingsBtn: document.querySelector("#settingsBtn"),
  settingsModal: document.querySelector("#settingsModal"),
  settingsRootPath: document.querySelector("#settingsRootPath"),
  settingsChangeRoot: document.querySelector("#settingsChangeRoot"),
  settingsOpenRoot: document.querySelector("#settingsOpenRoot"),
  settingsFindOrphans: document.querySelector("#settingsFindOrphans"),
  settingsOrphans: document.querySelector("#settingsOrphans"),
  settingsCacheSize: document.querySelector("#settingsCacheSize"),
  settingsClearCache: document.querySelector("#settingsClearCache"),
  settingsClearAll: document.querySelector("#settingsClearAll"),
  onboardingModal: document.querySelector("#onboardingModal"),
  onboardingOptions: document.querySelector("#onboardingOptions"),
  rootDocumentsPath: document.querySelector("#rootDocumentsPath"),
  rootDesktopPath: document.querySelector("#rootDesktopPath")
};

// ── Embedded view (Electron WebContentsView or iframe fallback) ─────

const embeddedView = {
  currentUrl: "",
  currentTitle: "",
  canBack: false,
  canForward: false,
  loading: false,
  rafToken: 0
};

function workspaceIsExpanded() {
  return !elements.searchFrameWrap.classList.contains("collapsed");
}

function getViewBounds() {
  const slot = elements.webViewSlot;
  if (!slot) return null;
  const r = slot.getBoundingClientRect();

  // Clip to visible viewport so the view never extends off-screen
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let x = r.left;
  let y = r.top;
  let w = r.width;
  let h = r.height;

  // Clip top
  if (y < 0) { h += y; y = 0; }
  // Clip bottom
  if (y + h > vh) h = vh - y;
  // Clip left
  if (x < 0) { w += x; x = 0; }
  // Clip right
  if (x + w > vw) w = vw - x;

  if (w <= 10 || h <= 10) return null; // slot is essentially off-screen

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(w),
    height: Math.round(h)
  };
}

async function showEmbeddedView() {
  if (!IS_ELECTRON) return;
  const bounds = getViewBounds();
  if (!bounds) {
    await window.bb.view.hide();
    return;
  }
  await window.bb.view.show(bounds);
}

async function hideEmbeddedView() {
  if (!IS_ELECTRON) return;
  await window.bb.view.hide();
}

function scheduleBoundsUpdate() {
  if (!IS_ELECTRON || !workspaceIsExpanded()) return;
  cancelAnimationFrame(embeddedView.rafToken);
  embeddedView.rafToken = requestAnimationFrame(() => {
    const bounds = getViewBounds();
    if (!bounds) {
      window.bb.view.hide();
      return;
    }
    window.bb.view.setBounds(bounds);
  });
}

// Hide view while scrolling (IPC lag makes tracking jittery), snap back when scroll settles
let scrollHideTimer = 0;
let isScrollHiding = false;

function handleScrollLikeEvent() {
  if (!IS_ELECTRON || !workspaceIsExpanded()) return;
  if (!isScrollHiding) {
    isScrollHiding = true;
    window.bb.view.hide();
  }
  clearTimeout(scrollHideTimer);
  scrollHideTimer = setTimeout(() => {
    isScrollHiding = false;
    showEmbeddedView();
  }, 90);
}

async function navigateEmbedded(url, opts = {}) {
  const { title = null, source = "navigation" } = opts;
  if (!url) return;

  // Expand workspace if it's collapsed
  if (!workspaceIsExpanded()) {
    elements.searchFrameWrap.classList.remove("collapsed");
    elements.toggleSearchWorkspace.textContent = "Collapse";
  }

  // Record trail entry now; title may update later via did-navigate
  recordTrail({ title: title || url, url, source });

  // Persist as thread's last URL
  const thread = currentThread();
  thread.lastUrl = url;
  touchThread(thread);
  saveState();

  if (IS_ELECTRON) {
    await window.bb.view.navigate(url);
    await showEmbeddedView();
  } else {
    // Browser preview fallback: open in new tab
    window.open(url, "_blank", "noopener");
  }

  render();
}

function setNavButtonsState() {
  elements.viewBack.disabled = !embeddedView.canBack;
  elements.viewForward.disabled = !embeddedView.canForward;
}

function setEmbeddedTitleAndUrl(title, url) {
  embeddedView.currentTitle = title || "";
  embeddedView.currentUrl = url || "";
  if (url) {
    elements.workspaceTitle.textContent = title || prettyUrl(url);
    elements.workspaceUrl.textContent = url;
  } else {
    elements.workspaceTitle.textContent = "Nothing loaded yet";
    elements.workspaceUrl.textContent = "";
  }
}

function prettyUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname === "/" ? "" : u.pathname);
  } catch { return url; }
}

function initEmbeddedView() {
  if (IS_ELECTRON) {
    window.bb.view.onNav(payload => {
      embeddedView.canBack = !!payload.canGoBack;
      embeddedView.canForward = !!payload.canGoForward;
      setEmbeddedTitleAndUrl(payload.title, payload.url);
      setNavButtonsState();

      // Update trail with real title once we have it
      if (payload.url && payload.title) {
        const thread = currentThread();
        const entry = thread.researchTrail.find(e => e.url === payload.url);
        if (entry && entry.title !== payload.title && entry.title === payload.url) {
          entry.title = payload.title;
          saveState();
          renderResearchTrail();
        }
      }
    });
    window.bb.view.onTitle(payload => {
      if (payload.url === embeddedView.currentUrl || !embeddedView.currentUrl) {
        embeddedView.currentTitle = payload.title;
        elements.workspaceTitle.textContent = payload.title || prettyUrl(payload.url);
      }
    });
    window.bb.view.onLoading(loading => {
      embeddedView.loading = loading;
      elements.searchWorkspace.classList.toggle("is-loading", loading);
    });
    if (window.bb.capture) {
      window.bb.capture.onCapture(captureToScratchpad);
    }
  } else {
    // In browser preview, hide nav buttons (they have no effect)
    elements.viewBack.style.display = "none";
    elements.viewForward.style.display = "none";
    elements.viewReload.style.display = "none";
  }

  // Keep WebContentsView aligned with the slot during layout changes
  if (IS_ELECTRON && elements.webViewSlot) {
    const ro = new ResizeObserver(() => scheduleBoundsUpdate());
    ro.observe(elements.webViewSlot);
    ro.observe(document.body);
  }
  window.addEventListener("resize", scheduleBoundsUpdate);

  // During scroll: hide view, snap back when scroll settles. This avoids
  // the visual lag of the native view trailing the page during fast scroll.
  window.addEventListener("scroll", handleScrollLikeEvent, { passive: true, capture: true });
  document.addEventListener("scroll", handleScrollLikeEvent, { passive: true, capture: true });
  window.addEventListener("wheel", handleScrollLikeEvent, { passive: true });
}

// ── Sidebar ─────────────────────────────────────────────────────────

function initSidebar() {
  const collapsed = localStorage.getItem(SIDEBAR_KEY) === "collapsed";
  if (collapsed) elements.threadSidebar.classList.add("collapsed");
}

function toggleSidebar() {
  elements.threadSidebar.classList.toggle("collapsed");
  localStorage.setItem(
    SIDEBAR_KEY,
    elements.threadSidebar.classList.contains("collapsed") ? "collapsed" : "open"
  );
}

elements.sidebarToggle.addEventListener("click", toggleSidebar);
elements.sidebarCollapse.addEventListener("click", toggleSidebar);

elements.newThreadBtn.addEventListener("click", createNewThread);

async function createNewThread() {
  const id = `thread_${Date.now()}`;
  const newThread = {
    ...structuredClone(defaultThread),
    id,
    title: "New Thread",
    mode: currentThread().mode,
    queue: [],
    loops: [],
    notes: "",
    stickyNotion: null,
    codex: structuredClone(defaultThread.codex),
    researchTrail: [],
    activity: [],
    archived: false,
    folderName: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  state.threads[id] = newThread;
  state.activeThreadId = id;
  // Create the dedicated folder now (no-op if no data root linked yet)
  await ensureThreadFolder(newThread);
  hydrateInputs();
  addActivity("Created new thread");
  toast("New thread created");
  saveState();
  render();
  loadThreadFiles();
  elements.threadInput.focus();
  elements.threadInput.select();
}

function renderThreadList() {
  elements.threadList.replaceChildren();

  const all = Object.values(state.threads)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  const active = all.filter(t => !t.archived);
  const archived = all.filter(t => t.archived);

  // archived count badge
  if (archived.length > 0) {
    elements.archivedCount.textContent = archived.length;
    elements.archivedCount.hidden = false;
  } else {
    elements.archivedCount.hidden = true;
  }

  active.forEach((thread, index) => elements.threadList.append(buildThreadRow(thread, index + 1)));

  if (showArchived && archived.length > 0) {
    const divider = document.createElement("li");
    divider.className = "thread-divider";
    divider.textContent = "Archived";
    elements.threadList.append(divider);
    archived.forEach(thread => elements.threadList.append(buildThreadRow(thread, null)));
  }
}

function buildThreadRow(thread, index) {
  const item = document.createElement("li");
  item.className = "thread-item" +
    (thread.id === state.activeThreadId ? " active" : "") +
    (thread.archived ? " archived" : "");

  const titleBtn = document.createElement("button");
  titleBtn.className = "thread-item-title";
  titleBtn.type = "button";
  titleBtn.title = thread.title;

  if (index !== null && index <= 9) {
    const num = document.createElement("span");
    num.className = "thread-num";
    num.textContent = index;
    titleBtn.append(num);
  }

  const titleText = document.createElement("span");
  titleText.className = "thread-text";
  titleText.textContent = thread.title;
  titleBtn.append(titleText);

  if (thread.folderName && state.global.dataRoot) {
    const folder = document.createElement("span");
    folder.className = "thread-folder-icon";
    folder.textContent = "📁";
    folder.title = `Folder: ${thread.folderName}`;
    titleBtn.append(folder);
  }

  const openQueue = thread.queue.filter(i => !i.done).length;
  const openLoops = thread.loops.filter(i => !i.done).length;
  if (openQueue + openLoops > 0) {
    const counts = document.createElement("span");
    counts.className = "thread-counts";
    if (openQueue > 0) {
      const q = document.createElement("span");
      q.className = "thread-count queue";
      q.textContent = openQueue;
      q.title = `${openQueue} open queue item${openQueue === 1 ? "" : "s"}`;
      counts.append(q);
    }
    if (openLoops > 0) {
      const l = document.createElement("span");
      l.className = "thread-count loop";
      l.textContent = openLoops;
      l.title = `${openLoops} open loop${openLoops === 1 ? "" : "s"}`;
      counts.append(l);
    }
    titleBtn.append(counts);
  }

  titleBtn.addEventListener("click", () => switchToThread(thread.id));

  const actions = document.createElement("div");
  actions.className = "thread-item-actions";

  const archiveBtn = document.createElement("button");
  archiveBtn.className = "thread-item-archive";
  archiveBtn.type = "button";
  archiveBtn.textContent = thread.archived ? "↺" : "⌃";
  archiveBtn.title = thread.archived ? "Unarchive thread" : "Archive thread";
  archiveBtn.addEventListener("click", e => {
    e.stopPropagation();
    toggleArchive(thread);
  });

  const delBtn = document.createElement("button");
  delBtn.className = "thread-item-delete";
  delBtn.type = "button";
  delBtn.textContent = "×";
  delBtn.title = "Delete thread";
  delBtn.addEventListener("click", e => {
    e.stopPropagation();
    deleteThread(thread);
  });

  actions.append(archiveBtn, delBtn);
  item.append(titleBtn, actions);
  return item;
}

function switchToThread(id) {
  if (!state.threads[id]) return;
  state.activeThreadId = id;
  currentThreadFileCount = 0;
  hydrateInputs();
  addActivity(`Switched to: ${state.threads[id].title}`);
  saveState();
  render();
  loadThreadFiles();
  restoreThreadView();
  refreshCodexConnection();
}

async function restoreThreadView() {
  if (!IS_ELECTRON) return;
  const thread = currentThread();
  if (thread.lastUrl) {
    await window.bb.view.navigate(thread.lastUrl);
    if (workspaceIsExpanded()) await showEmbeddedView();
  } else {
    await hideEmbeddedView();
    setEmbeddedTitleAndUrl("", "");
    embeddedView.canBack = false;
    embeddedView.canForward = false;
    setNavButtonsState();
  }
}

function toggleArchive(thread) {
  thread.archived = !thread.archived;
  touchThread(thread);
  if (thread.archived && state.activeThreadId === thread.id) {
    const next = Object.values(state.threads).find(t => !t.archived && t.id !== thread.id);
    if (next) {
      state.activeThreadId = next.id;
      hydrateInputs();
    } else {
      // no other unarchived thread — unarchive it back
      thread.archived = false;
      toast("Cannot archive your only thread");
      saveState();
      render();
      return;
    }
  }
  addActivity(thread.archived ? `Archived: ${thread.title}` : `Unarchived: ${thread.title}`);
  toast(thread.archived ? `Archived "${thread.title}"` : `Unarchived "${thread.title}"`);
  saveState();
  render();
  loadThreadFiles();
}

function deleteThread(thread) {
  const remaining = Object.values(state.threads).filter(t => t.id !== thread.id);
  if (remaining.length === 0) {
    toast("Cannot delete your only thread");
    return;
  }
  if (!confirm(`Delete thread "${thread.title}"? This cannot be undone.`)) return;
  delete state.threads[thread.id];
  if (state.activeThreadId === thread.id) {
    state.activeThreadId = remaining[0].id;
  }
  hydrateInputs();
  toast(`Deleted "${thread.title}"`);
  saveState();
  render();
  loadThreadFiles();
}

// ── Toolbar ──────────────────────────────────────────────────────────

elements.exportBtn.addEventListener("click", exportData);
elements.importBtn.addEventListener("click", () => elements.importFile.click());
elements.importFile.addEventListener("change", importData);
elements.showArchivedBtn.addEventListener("click", () => {
  showArchived = !showArchived;
  localStorage.setItem(SHOW_ARCHIVED_KEY, showArchived ? "1" : "0");
  elements.showArchivedBtn.classList.toggle("active", showArchived);
  render();
});
elements.helpBtn.addEventListener("click", () => openModal(elements.helpModal));
elements.settingsBtn.addEventListener("click", () => openSettings());

// ── Theme (dark / light) ────────────────────────────────────────────

function resolveInitialTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") return saved;
  // Default to the OS preference, falling back to dark (the signature look)
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

function applyTheme(mode) {
  const theme = mode === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", theme);
  if (elements.themeIcon) elements.themeIcon.textContent = theme === "dark" ? "🌙" : "☀";
  if (elements.themeLabel) elements.themeLabel.textContent = theme === "dark" ? "Dark" : "Light";
  if (elements.themeToggle) {
    elements.themeToggle.title = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next = current === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
  toast(next === "dark" ? "Dark mode" : "Light mode");
}

applyTheme(resolveInitialTheme());
elements.themeToggle.addEventListener("click", toggleTheme);

// ── Settings ────────────────────────────────────────────────────────

async function openSettings() {
  elements.settingsRootPath.textContent = state.global.dataRoot || "(none chosen)";
  elements.settingsCacheSize.textContent = "…";
  elements.settingsOrphans.replaceChildren();
  openModal(elements.settingsModal);
  if (IS_ELECTRON) {
    try {
      const size = await window.bb.data.cacheSize();
      elements.settingsCacheSize.textContent = formatBytes(size);
    } catch {
      elements.settingsCacheSize.textContent = "—";
    }
  } else {
    elements.settingsCacheSize.textContent = "—";
  }
}

elements.settingsChangeRoot.addEventListener("click", async () => {
  await pickRootFolder();
  elements.settingsRootPath.textContent = state.global.dataRoot || "(none chosen)";
});

elements.settingsOpenRoot.addEventListener("click", async () => {
  if (!IS_ELECTRON || !state.global.dataRoot) {
    toast("No data folder linked");
    return;
  }
  await window.bb.data.openFolder(state.global.dataRoot);
});

elements.settingsFindOrphans.addEventListener("click", async () => {
  if (!IS_ELECTRON || !state.global.dataRoot) {
    toast("No data folder linked");
    return;
  }
  const claimed = Object.values(state.threads).map(t => t.folderName).filter(Boolean);
  const orphans = await window.bb.data.findOrphans(state.global.dataRoot, claimed);
  elements.settingsOrphans.replaceChildren();
  if (orphans.length === 0) {
    const li = document.createElement("li");
    li.className = "orphan-empty";
    li.textContent = "No orphan folders found.";
    elements.settingsOrphans.append(li);
    return;
  }
  orphans.forEach(orphan => {
    const li = document.createElement("li");
    li.className = "orphan-row";

    const meta = document.createElement("div");
    meta.className = "orphan-meta";
    const name = document.createElement("strong");
    name.textContent = orphan.name;
    const detail = document.createElement("span");
    detail.textContent = `${orphan.fileCount} item${orphan.fileCount === 1 ? "" : "s"} · ${orphan.path}`;
    meta.append(name, detail);

    const del = document.createElement("button");
    del.className = "subtle-button danger";
    del.type = "button";
    del.textContent = "Move to Trash";
    del.addEventListener("click", async () => {
      if (!confirm(`Move "${orphan.name}" to Trash? You can restore it from your OS trash.`)) return;
      const res = await window.bb.data.deleteFolder(orphan.path);
      if (res.ok) {
        li.remove();
        toast(`Removed "${orphan.name}"`);
      } else {
        toast("Could not delete folder");
      }
    });

    li.append(meta, del);
    elements.settingsOrphans.append(li);
  });
});

elements.settingsClearCache.addEventListener("click", async () => {
  if (!IS_ELECTRON) return;
  if (!confirm("Clear cached pages and temporary site data? You'll stay logged in.")) return;
  await window.bb.cache.clear({ full: false });
  const size = await window.bb.data.cacheSize();
  elements.settingsCacheSize.textContent = formatBytes(size);
  toast("Cache cleared");
});

elements.settingsClearAll.addEventListener("click", async () => {
  if (!IS_ELECTRON) return;
  if (!confirm("Clear ALL browsing data including logins for embedded sites? This will sign you out of Notion, ChatGPT, etc.")) return;
  await window.bb.cache.clear({ full: true });
  const size = await window.bb.data.cacheSize();
  elements.settingsCacheSize.textContent = formatBytes(size);
  toast("All browsing data cleared");
});

// ── Onboarding ──────────────────────────────────────────────────────

async function maybeShowOnboarding() {
  if (!IS_ELECTRON) return;
  if (state.global.onboarded && state.global.dataRoot) return;

  // Populate path previews
  try {
    const roots = await window.bb.data.defaultRoots();
    elements.rootDocumentsPath.textContent = roots.documents;
    elements.rootDesktopPath.textContent = roots.desktop;
  } catch {}

  openModal(elements.onboardingModal);
}

elements.onboardingOptions.addEventListener("click", async event => {
  const btn = event.target.closest("[data-root]");
  if (!btn) return;
  const which = btn.dataset.root;
  let chosen = null;

  if (which === "custom") {
    chosen = await window.bb.data.chooseRoot();
    if (!chosen) return;
  } else {
    const roots = await window.bb.data.defaultRoots();
    chosen = which === "desktop" ? roots.desktop : roots.documents;
  }

  await window.bb.data.ensureRoot(chosen);
  state.global.dataRoot = chosen;
  state.global.onboarded = true;
  saveState();
  closeModal(elements.onboardingModal);
  toast(`Data folder set: ${chosen}`);
  await backfillThreadFolders();
  await loadThreadFiles();
  render();
});

// Initial state of archived toggle
elements.showArchivedBtn.classList.toggle("active", showArchived);

function exportData() {
  const payload = {
    version: state.version,
    exportedAt: new Date().toISOString(),
    state: state
  };
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  a.href = url;
  a.download = `hex-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  addActivity("Exported data backup");
  toast("Backup downloaded");
  saveState();
  renderLog();
}

async function importData(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const incoming = parsed.state || parsed; // accept full payload or raw state

    if (!incoming || typeof incoming !== "object" || !incoming.threads) {
      toast("This file doesn't look like a HEX backup");
      return;
    }

    if (!confirm("Importing will replace your current HEX data. Continue?")) return;

    const merged = mergeState(incoming);
    Object.keys(state).forEach(k => delete state[k]);
    Object.assign(state, merged);
    hydrateInputs();
    saveState();
    render();
    loadThreadFiles();
    toast("Data imported successfully");
    addActivity("Imported data backup");
  } catch (err) {
    toast("Could not read that file");
  }
}

// ── Modal ────────────────────────────────────────────────────────────

function openModal(modal) {
  modal.hidden = false;
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closeModal(modal) {
  modal.hidden = true;
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

document.querySelectorAll('[data-close="modal"]').forEach(el => {
  el.addEventListener("click", () => {
    const modal = el.closest(".modal");
    if (modal) closeModal(modal);
  });
});

// ── Toasts ───────────────────────────────────────────────────────────

function toast(message, ms = 2400) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  elements.toastContainer.append(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 250);
  }, ms);
}

// ── Boot ─────────────────────────────────────────────────────────────

initSidebar();
hydrateInputs();

// ── Event listeners ──────────────────────────────────────────────────

document.querySelectorAll("[data-mode]").forEach(button => {
  button.addEventListener("click", () => {
    const thread = currentThread();
    thread.mode = button.dataset.mode;
    touchThread(thread);
    addActivity(`Mode changed to ${button.textContent}`);
    saveState();
    render();
  });
});

document.querySelectorAll("[data-engine]").forEach(button => {
  button.addEventListener("click", () => {
    state.global.engine = button.dataset.engine;
    saveState();
    render();
  });
});

elements.threadInput.addEventListener("change", () => {
  const title = elements.threadInput.value.trim() || "Untitled Thread";
  const thread = currentThread();
  thread.title = title;
  elements.threadInput.value = title;
  touchThread(thread);
  addActivity(`Renamed thread to: ${title}`);
  saveState();
  render();
});

elements.threadInput.addEventListener("keydown", event => {
  if (event.key === "Enter") elements.threadInput.blur();
});

elements.searchForm.addEventListener("submit", event => {
  event.preventDefault();
  const value = elements.searchInput.value.trim();
  if (!value) return;

  const destination = resolveDestination(value);
  const isDirectUrl = looksLikeUrl(value);
  const source = isDirectUrl ? "url" : state.global.engine;
  const title = isDirectUrl ? value : `${getEngineLabel(state.global.engine)}: ${value}`;

  addActivity(isDirectUrl ? `Opened ${value}` : `Searched ${state.global.engine}: ${value}`);
  navigateEmbedded(destination, { title, source });
  elements.searchInput.value = "";
});

elements.toggleSearchWorkspace.addEventListener("click", async () => {
  const willCollapse = !elements.searchFrameWrap.classList.contains("collapsed");
  elements.searchFrameWrap.classList.toggle("collapsed");
  elements.toggleSearchWorkspace.textContent = willCollapse ? "Expand" : "Collapse";
  if (willCollapse) {
    await hideEmbeddedView();
  } else if (embeddedView.currentUrl && IS_ELECTRON) {
    await showEmbeddedView();
  }
});

elements.openSearchTab.addEventListener("click", () => {
  const url = embeddedView.currentUrl;
  if (!url) {
    toast("Nothing loaded to open externally");
    return;
  }
  if (IS_ELECTRON) {
    window.bb.view.openExternal(url);
  } else {
    window.open(url, "_blank", "noopener");
  }
});

elements.viewBack.addEventListener("click", () => {
  if (IS_ELECTRON) window.bb.view.back();
});
elements.viewForward.addEventListener("click", () => {
  if (IS_ELECTRON) window.bb.view.forward();
});
elements.viewReload.addEventListener("click", () => {
  if (IS_ELECTRON) window.bb.view.reload();
});

elements.addThreadFilesBtn.addEventListener("click", () => addFilesToCurrentThread());
elements.openThreadFolderBtn.addEventListener("click", () => openCurrentThreadFolder());
elements.refreshThreadFiles.addEventListener("click", () => loadThreadFiles());

elements.queueForm.addEventListener("submit", event => {
  event.preventDefault();
  addTextItem("queue", elements.queueInput);
});

elements.loopForm.addEventListener("submit", event => {
  event.preventDefault();
  addTextItem("loops", elements.loopInput);
});

elements.notionForm.addEventListener("submit", event => {
  event.preventDefault();
  const thread = currentThread();
  const url = normalizeUrl(elements.notionUrlInput.value.trim());
  if (!url) return;
  const name = elements.notionNameInput.value.trim() || nameFromUrl(url);

  thread.stickyNotion = { name, url };
  elements.notionNameInput.value = "";
  elements.notionUrlInput.value = "";
  recordTrail({ title: name, url, source: "pinned reference" });
  addActivity(`Pinned reference: ${name}`);
  toast(`Pinned "${name}"`);
  touchThread(thread);
  saveState();
  render();
});

elements.linkForm.addEventListener("submit", event => {
  event.preventDefault();
  const url = normalizeUrl(elements.linkUrlInput.value.trim());
  if (!url) return;
  const name = elements.linkNameInput.value.trim() || nameFromUrl(url);

  currentThread().links.unshift({ name, url });
  elements.linkNameInput.value = "";
  elements.linkUrlInput.value = "";
  addActivity(`Saved link: ${name}`);
  toast(`Saved "${name}"`);
  saveState();
  render();
});

let notesSaveTimer = 0;
elements.scratchpad.addEventListener("input", () => {
  const thread = currentThread();
  thread.notes = elements.scratchpad.value;
  touchThread(thread);
  elements.notesSaveStatus.textContent = "Saving";
  saveState();
  clearTimeout(notesSaveTimer);
  notesSaveTimer = setTimeout(() => {
    elements.notesSaveStatus.textContent = "Saved";
  }, 450);
});

// ── Quick Capture: append selection from embedded view to scratchpad ──
elements.codexInstruction.addEventListener("input", () => {
  codexInstructionDrafts.set(currentThread().id, elements.codexInstruction.value);
});

document.querySelectorAll("[data-codex-permission]").forEach(button => {
  button.addEventListener("click", () => setCodexPermission(button.dataset.codexPermission));
});

elements.codexConnectBtn.addEventListener("click", connectCodex);
elements.codexFolderAction.addEventListener("click", openOrCreateCodexFolder);
elements.codexChangeFolder.addEventListener("click", changeCodexFolder);
elements.codexDisconnect.addEventListener("click", disconnectCodex);
elements.codexSend.addEventListener("click", sendToCodex);

function captureToScratchpad(payload) {
  if (!payload || !payload.text) return;
  const thread = currentThread();
  const time = formatTime(new Date());
  const title = (payload.title || "").trim() || prettyUrl(payload.url) || "source";
  const url = payload.url || "";

  // Markdown-friendly format. Renders cleanly if/when we add preview.
  const block = `> ${payload.text.replace(/\n+/g, "\n> ")}\n\n— [${title}](${url}) · ${time}\n\n`;

  const current = (thread.notes || "").trimEnd();
  thread.notes = current ? `${current}\n\n${block}` : block;
  touchThread(thread);
  saveState();

  // Update the visible textarea + scroll to the new content
  elements.scratchpad.value = thread.notes;
  elements.scratchpad.scrollTop = elements.scratchpad.scrollHeight;

  addActivity(`Captured from: ${title}`);
  toast(`Captured to scratchpad`);
  renderLog();
}

elements.clearDone.addEventListener("click", () => {
  const thread = currentThread();
  const before = thread.queue.length;
  thread.queue = thread.queue.filter(item => !item.done);
  const removed = before - thread.queue.length;
  if (removed > 0) {
    addActivity(`Cleared ${removed} completed item${removed === 1 ? "" : "s"}`);
    toast(`Cleared ${removed} completed`);
  }
  touchThread(thread);
  saveState();
  render();
});

elements.clearStickyNotion.addEventListener("click", () => {
  const thread = currentThread();
  if (!thread.stickyNotion) return;
  thread.stickyNotion = null;
  addActivity("Unpinned reference");
  touchThread(thread);
  saveState();
  render();
});

elements.clearTrail.addEventListener("click", () => {
  const thread = currentThread();
  thread.researchTrail = [];
  addActivity("Cleared recent activity");
  touchThread(thread);
  saveState();
  render();
});

elements.extractActions.addEventListener("click", () => {
  const thread = currentThread();
  const actions = extractActionItems(thread.notes);
  if (actions.length === 0) {
    toast("No action lines found in notes");
    return;
  }
  actions.forEach(text => thread.queue.unshift({ text, done: false }));
  addActivity(`Extracted ${actions.length} action${actions.length === 1 ? "" : "s"} from notes`);
  toast(`Added ${actions.length} action${actions.length === 1 ? "" : "s"} to Next Up`);
  touchThread(thread);
  saveState();
  render();
});

// ── Keyboard shortcuts ───────────────────────────────────────────────

document.addEventListener("keydown", event => {
  const target = event.target;
  const inField = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

  // Esc always works
  if (event.key === "Escape") {
    const openModalEl = document.querySelector(".modal:not([hidden])");
    if (openModalEl) {
      closeModal(openModalEl);
      event.preventDefault();
      return;
    }
    if (inField) {
      target.blur();
      event.preventDefault();
    }
    return;
  }

  if (inField) return; // don't fire shortcuts while typing

  // `/` or Ctrl+K: focus search
  if (event.key === "/" || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k")) {
    event.preventDefault();
    elements.searchInput.focus();
    elements.searchInput.select();
    return;
  }

  // `?`: open help
  if (event.key === "?") {
    event.preventDefault();
    openModal(elements.helpModal);
    return;
  }

  // Ctrl/Cmd + B: toggle sidebar
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
    event.preventDefault();
    toggleSidebar();
    return;
  }

  // Ctrl/Cmd + N: new thread
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
    event.preventDefault();
    createNewThread();
    return;
  }

  // Ctrl/Cmd + E: export
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "e") {
    event.preventDefault();
    exportData();
    return;
  }

  // Ctrl/Cmd + L: rename active thread
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") {
    event.preventDefault();
    elements.threadInput.focus();
    elements.threadInput.select();
    return;
  }

  // Ctrl/Cmd + 1-9: switch thread
  if ((event.ctrlKey || event.metaKey) && /^[1-9]$/.test(event.key)) {
    const i = parseInt(event.key, 10) - 1;
    const active = Object.values(state.threads)
      .filter(t => !t.archived)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    if (active[i]) {
      event.preventDefault();
      switchToThread(active[i].id);
    }
  }
});

setInterval(updateClock, 1000);
updateClock();
initCodexDock();
render();
initFileSystem();
initThreadFileDrop();
maybeShowOnboarding();
initEmbeddedView();
// Restore the active thread's last URL on boot
restoreThreadView();
refreshCodexConnection();

// ── Helpers ──────────────────────────────────────────────────────────

function hydrateInputs() {
  const thread = currentThread();
  elements.threadInput.value = thread.title;
  elements.scratchpad.value = thread.notes || "";
  if (document.activeElement !== elements.codexInstruction) {
    elements.codexInstruction.value = codexInstructionDrafts.get(thread.id) || "";
  }
  elements.notesSaveStatus.textContent = "Saved";
}

function ensureCodexState(thread) {
  if (!thread.codex || typeof thread.codex !== "object") {
    thread.codex = structuredClone(defaultThread.codex);
  }
  Object.assign(thread.codex, normalizeCodex(thread.codex));
  return thread.codex;
}

function collectCodexSources(thread) {
  const sources = [];
  const seen = new Set();
  const add = (name, url) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    sources.push({ name: name || prettyUrl(url), url });
  };
  if (thread.stickyNotion) add(thread.stickyNotion.name, thread.stickyNotion.url);
  (thread.researchTrail || []).forEach(entry => add(entry.title, entry.url));
  (thread.pins || []).forEach(pin => add(pin.name, pin.source));
  return sources;
}

function buildCodexContext(thread) {
  const codex = ensureCodexState(thread);
  return {
    title: thread.title,
    objective: codex.handoff.trim() || thread.title,
    notes: thread.notes || "",
    pins: (thread.pins || []).map(pin => ({ name: pin.name, content: pin.content, source: pin.source })),
    sources: collectCodexSources(thread),
    nextSteps: [
      ...thread.queue.filter(item => !item.done).map(item => item.text),
      ...thread.loops.filter(item => !item.done).map(item => item.text)
    ]
  };
}

function applyCodexUpdate(payload) {
  const thread = state.threads[payload?.hexThreadId];
  if (!thread) return;
  const codex = ensureCodexState(thread);
  const fields = ["threadId", "workspacePath", "permissionMode", "status", "lastRunAt", "lastResponsePreview"];
  fields.forEach(field => {
    if (typeof payload[field] === "string") codex[field] = payload[field];
  });
  if (typeof payload.message === "string") codex.statusMessage = payload.message;
  touchThread(thread);
  saveState();
  if (thread.id === state.activeThreadId) renderCodexDock();
}

function setCodexPermission(permissionMode) {
  if (!["read-only", "workspace-write"].includes(permissionMode)) return;
  const thread = currentThread();
  const codex = ensureCodexState(thread);
  if (codex.status === "working") return;
  codex.permissionMode = permissionMode;
  codex.statusMessage = permissionMode === "workspace-write"
    ? "Codex may edit files inside this Thread folder only."
    : "Codex may read this Thread folder but cannot edit it.";
  touchThread(thread);
  saveState();
  renderCodexDock();
}

async function connectCodex() {
  const thread = currentThread();
  const codex = ensureCodexState(thread);
  if (!IS_ELECTRON || !window.bb.codex) {
    codex.status = "unavailable";
    codex.statusMessage = "Codex Dock requires the HEX desktop app.";
    saveState();
    renderCodexDock();
    return false;
  }
  if (!state.global.dataRoot) {
    const chosen = await pickRootFolder();
    if (!chosen) return false;
  }
  await ensureThreadFolder(thread);
  codex.status = "working";
  codex.statusMessage = "Checking Codex and the connected folder.";
  saveState();
  renderCodexDock();
  const result = await window.bb.codex.connect({
    hexThreadId: thread.id,
    root: state.global.dataRoot,
    folderName: thread.folderName,
    permissionMode: codex.permissionMode
  });
  applyCodexUpdate({ hexThreadId: thread.id, ...result });
  return Boolean(result.ok);
}

async function sendToCodex() {
  const thread = currentThread();
  const codex = ensureCodexState(thread);
  const instruction = elements.codexInstruction.value.trim();
  if (!instruction) {
    toast("Tell Codex what to do with this Thread");
    elements.codexInstruction.focus();
    return;
  }
  if (!codex.workspacePath) {
    const connected = await connectCodex();
    if (!connected) return;
  }

  codexInstructionDrafts.set(thread.id, instruction);
  codex.status = "working";
  codex.statusMessage = codex.threadId ? "Resuming the connected Codex session." : "Starting a Codex session for this Thread.";
  touchThread(thread);
  saveState();
  renderCodexDock();

  const result = await window.bb.codex.run({
    hexThreadId: thread.id,
    root: state.global.dataRoot,
    folderName: thread.folderName,
    permissionMode: codex.permissionMode,
    threadId: codex.threadId,
    context: buildCodexContext(thread),
    instruction
  });
  applyCodexUpdate({ hexThreadId: thread.id, ...result });
  if (result.ok) {
    codexInstructionDrafts.set(thread.id, "");
    if (thread.id === state.activeThreadId) elements.codexInstruction.value = "";
    addActivity("Codex completed a Thread request");
    saveState();
    renderLog();
  }
}

async function changeCodexFolder() {
  if (!IS_ELECTRON || !window.bb.codex) return toast("Codex Dock requires the HEX desktop app");
  const thread = currentThread();
  const codex = ensureCodexState(thread);
  if (codex.status === "working") return toast("Wait for Codex to finish or disconnect it first");
  if (codex.threadId && !window.confirm("Changing the folder starts a new Codex session for this HEX Thread. Continue?")) return;
  const chosen = await pickRootFolder();
  if (!chosen) return;
  await window.bb.codex.disconnect({ hexThreadId: thread.id });
  codex.threadId = "";
  codex.workspacePath = "";
  codex.status = "no-folder";
  codex.statusMessage = "Connect Codex to the new Thread folder.";
  saveState();
  await connectCodex();
}

async function disconnectCodex() {
  if (!IS_ELECTRON || !window.bb.codex) return;
  const thread = currentThread();
  const codex = ensureCodexState(thread);
  if (!codex.workspacePath && !codex.threadId) return;
  const consequence = codex.threadId
    ? "Disconnect this Codex session from HEX? The Codex session will remain on this computer, but HEX will forget its link."
    : "Disconnect this Thread folder from Codex?";
  if (!window.confirm(consequence)) return;
  await window.bb.codex.disconnect({ hexThreadId: thread.id });
  codex.threadId = "";
  codex.workspacePath = "";
  codex.status = "no-folder";
  codex.statusMessage = "Connect the Thread folder to begin.";
  touchThread(thread);
  saveState();
  renderCodexDock();
}

async function refreshCodexConnection() {
  const thread = currentThread();
  const codex = ensureCodexState(thread);
  if (!codex.workspacePath || !state.global.dataRoot || !thread.folderName || codex.status === "working") return;
  await connectCodex();
}

function initCodexDock() {
  if (IS_ELECTRON && window.bb.codex?.onStatus) {
    window.bb.codex.onStatus(applyCodexUpdate);
  }
}

function addTextItem(collection, input) {
  const text = input.value.trim();
  if (!text) return;
  const thread = currentThread();
  thread[collection].unshift({ text, done: false });
  input.value = "";
  addActivity(collection === "queue" ? `Added to Next Up: ${text}` : `Added to Needs Attention: ${text}`);
  touchThread(thread);
  saveState();
  render();
}

function render() {
  renderModes();
  renderEngines();
  renderModeShortcuts();
  renderSearchWorkspace();
  renderOrientation();
  renderStickyNotion();
  renderCodexDock();
  renderItemList(elements.queueList, currentThread().queue, {
    kind: "queue",
    emptyText: "Nothing in Next Up"
  });
  renderItemList(elements.loopList, currentThread().loops, {
    kind: "loops",
    emptyText: "Nothing needs attention"
  });
  elements.clearDone.hidden = !currentThread().queue.some(item => item.done);
  renderLinks();
  renderResearchTrail();
  renderLog();
  renderThreadList();
}

function renderCodexDock() {
  if (!elements.codexStatus) return;
  const thread = currentThread();
  const codex = ensureCodexState(thread);
  const sources = collectCodexSources(thread);
  const nextSteps = thread.queue.filter(item => !item.done).length + thread.loops.filter(item => !item.done).length;
  const statusLabels = {
    unavailable: "Codex unavailable",
    "sign-in-required": "Sign-in required",
    "no-folder": "No folder connected",
    ready: "Ready",
    working: "Working",
    "approval-required": "Approval required",
    completed: "Completed",
    failed: "Failed",
    interrupted: "Interrupted"
  };
  const status = IS_ELECTRON ? codex.status : "unavailable";

  elements.codexStatus.textContent = statusLabels[status] || "Not connected";
  elements.codexStatus.dataset.status = status;
  elements.codexStatusDetail.textContent = IS_ELECTRON
    ? codex.statusMessage
    : "Codex Dock requires the HEX desktop app.";
  const threadFolderPath = state.global.dataRoot && thread.folderName
    ? `${state.global.dataRoot}\\${thread.folderName}`
    : "";
  const displayedWorkspacePath = codex.workspacePath || threadFolderPath;
  elements.codexWorkspacePath.textContent = displayedWorkspacePath || "No folder created";
  elements.codexWorkspacePath.title = displayedWorkspacePath;
  elements.codexFolderAction.textContent = threadFolderPath ? "Open folder" : "Create folder";
  elements.codexFolderAction.title = threadFolderPath
    ? "Open this Thread's Codex workspace folder"
    : "Choose a storage location and create this Thread's workspace folder";
  elements.codexFolderAction.disabled = status === "working";
  elements.codexSessionStatus.textContent = codex.threadId
    ? `Session ${codex.threadId.slice(0, 8)} saved - resumes on Send`
    : "New session starts on first send";
  elements.codexPinCount.textContent = String(thread.pins.length);
  elements.codexSourceCount.textContent = String(sources.length);
  elements.codexFileCount.textContent = String(currentThreadFileCount);
  elements.codexNextStepCount.textContent = String(nextSteps);

  document.querySelectorAll("[data-codex-permission]").forEach(button => {
    const active = button.dataset.codexPermission === codex.permissionMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(active));
    button.disabled = status === "working";
  });

  const needsReconnect = ["unavailable", "sign-in-required", "failed", "interrupted"].includes(status);
  elements.codexConnectBtn.hidden = Boolean(codex.workspacePath && !needsReconnect);
  elements.codexConnectBtn.textContent = codex.workspacePath ? "Check Codex again" : "Connect Codex";
  elements.codexConnectBtn.disabled = status === "working";
  elements.codexChangeFolder.textContent = state.global.dataRoot ? "Change folder" : "Connect folder";
  elements.codexDisconnect.disabled = !codex.workspacePath && !codex.threadId;
  elements.codexSend.disabled = !IS_ELECTRON || !codex.workspacePath || status === "working" || status === "unavailable" || (status === "failed" && Boolean(codex.threadId));
  elements.codexSend.textContent = status === "working" ? "Codex is working" : "Send to Codex";

  if (document.activeElement !== elements.codexInstruction) {
    elements.codexInstruction.value = codexInstructionDrafts.get(thread.id) || "";
  }
  elements.codexResponseWrap.hidden = !codex.lastResponsePreview;
  elements.codexResponse.textContent = codex.lastResponsePreview;
  elements.codexLastRun.textContent = codex.lastRunAt ? formatDateTime(codex.lastRunAt) : "";
  elements.codexLastRun.dateTime = codex.lastRunAt || "";
}

function renderModes() {
  const thread = currentThread();
  document.querySelectorAll("[data-mode]").forEach(button => {
    button.classList.toggle("active", button.dataset.mode === thread.mode);
  });
}

function renderEngines() {
  document.querySelectorAll("[data-engine]").forEach(button => {
    button.classList.toggle("active", button.dataset.engine === state.global.engine);
  });
}

function renderModeShortcuts() {
  const thread = currentThread();
  const shortcuts = modeShortcuts[thread.mode] || [];
  elements.modeShortcuts.replaceChildren();

  shortcuts.forEach(([label, url]) => {
    const button = document.createElement("button");
    button.className = "shortcut-button";
    button.type = "button";

    const icon = faviconImg(url);
    if (icon) button.append(icon);
    const text = document.createElement("span");
    text.textContent = label;
    button.append(text);

    button.addEventListener("click", () => {
      addActivity(`Opened shortcut: ${label}`);
      navigateEmbedded(url, { title: label, source: "shortcut" });
    });
    elements.modeShortcuts.append(button);
  });
}

function renderSearchWorkspace() {
  // With the embedded view, the workspace shows whatever's currently loaded.
  // The engine chips only affect what the search box does next.
  if (!embeddedView.currentUrl) {
    elements.searchFrameStatus.textContent =
      `Search with ${getEngineLabel(state.global.engine)}, paste a URL, or click a shortcut to load a site here.`;
  } else {
    elements.searchFrameStatus.textContent = "";
  }
}

function renderOrientation() {
  const thread = currentThread();
  const nextItem = thread.queue.find(item => !item.done)?.text;
  const openLoops = thread.loops.filter(item => !item.done).length;
  const sticky = thread.stickyNotion ? "Reference pinned" : "No pinned reference";
  const continuation = nextItem ? `Next: ${nextItem}` : modeCopy[thread.mode];
  elements.resumeLine.textContent =
    `${continuation} — ${openLoops} need${openLoops === 1 ? "s" : ""} attention — ${sticky}`;
}

function renderStickyNotion() {
  const thread = currentThread();
  const sticky = thread.stickyNotion;
  elements.stickyNotion.replaceChildren();
  elements.stickyNotion.classList.toggle("empty-state", !sticky);
  elements.notionForm.hidden = Boolean(sticky);
  elements.clearStickyNotion.hidden = !sticky;

  if (!sticky) {
    elements.stickyNotion.textContent = "No reference pinned";
    return;
  }

  const copy = document.createElement("div");
  copy.className = "reference-copy";
  const name = document.createElement("strong");
  name.textContent = sticky.name || nameFromUrl(sticky.url);
  const domain = document.createElement("span");
  domain.textContent = domainLabel(sticky.url);
  copy.append(name, domain);

  const open = document.createElement("button");
  open.type = "button";
  open.textContent = "Open";
  open.addEventListener("click", () => {
    addActivity(`Opened pinned reference: ${name.textContent}`);
    navigateEmbedded(sticky.url, { title: name.textContent, source: "pinned reference" });
  });

  elements.stickyNotion.append(copy, open);
}

function renderItemList(target, items, { kind, emptyText }) {
  target.replaceChildren();

  if (items.length === 0) {
    const empty = document.createElement("li");
    empty.className = "module-empty";
    empty.textContent = emptyText;
    target.append(empty);
    return;
  }

  items.forEach((item, index) => {
    const row = document.createElement("li");
    row.className = "item";
    if (item.done) row.classList.add("done");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = item.done;
    checkbox.setAttribute("aria-label", kind === "loops" ? `Resolve ${item.text}` : `Complete ${item.text}`);
    checkbox.addEventListener("change", () => {
      item.done = checkbox.checked;
      const action = kind === "loops"
        ? (item.done ? "Resolved" : "Reopened")
        : (item.done ? "Completed Next Up item" : "Reopened Next Up item");
      addActivity(`${action}: ${item.text}`);
      touchThread(currentThread());
      saveState();
      render();
    });

    const label = document.createElement("span");
    label.textContent = item.text;

    const remove = document.createElement("button");
    remove.className = "remove";
    remove.type = "button";
    remove.textContent = "x";
    remove.setAttribute("aria-label", `Remove ${item.text}`);
    remove.addEventListener("click", () => {
      addActivity(`Removed from ${kind === "loops" ? "Needs Attention" : "Next Up"}: ${item.text}`);
      items.splice(index, 1);
      touchThread(currentThread());
      saveState();
      render();
    });

    row.append(checkbox, label, remove);
    target.append(row);
  });
}

function renderLinks() {
  elements.quickLinks.replaceChildren();
  const links = currentThread().links;

  if (links.length === 0) {
    const empty = document.createElement("div");
    empty.className = "module-empty";
    empty.textContent = "No saved links";
    elements.quickLinks.append(empty);
    return;
  }

  links.forEach((link, index) => {
    const row = document.createElement("div");
    row.className = "quick-link";

    const copy = document.createElement("div");
    copy.className = "saved-link-copy";
    const icon = faviconImg(link.url);
    const text = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = link.name || nameFromUrl(link.url);
    const domain = document.createElement("span");
    domain.textContent = domainLabel(link.url);
    text.append(name, domain);
    if (icon) copy.append(icon);
    copy.append(text);

    const open = document.createElement("button");
    open.type = "button";
    open.textContent = "Open";
    open.addEventListener("click", () => {
      addActivity(`Opened quick link: ${link.name}`);
      navigateEmbedded(link.url, { title: link.name, source: "quickLink" });
    });

    const remove = document.createElement("button");
    remove.className = "remove";
    remove.type = "button";
    remove.textContent = "x";
    remove.setAttribute("aria-label", `Remove ${link.name}`);
    remove.addEventListener("click", () => {
      links.splice(index, 1);
      addActivity(`Removed saved link: ${link.name}`);
      saveState();
      render();
    });

    row.append(copy, open, remove);
    elements.quickLinks.append(row);
  });
}

function renderResearchTrail() {
  const trail = currentThread().researchTrail;
  elements.researchTrail.replaceChildren();

  if (trail.length === 0) {
    const empty = document.createElement("li");
    empty.className = "trail-empty";
    empty.textContent = "No recent pages or searches";
    elements.researchTrail.append(empty);
    return;
  }

  trail.slice(0, 10).forEach(entry => {
    const row = document.createElement("li");
    row.className = "trail-item";

    const main = document.createElement("div");
    main.className = "trail-main";
    const icon = faviconImg(entry.url);
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = entry.title || nameFromUrl(entry.url);
    const meta = document.createElement("span");
    meta.className = "trail-meta";
    const openedTime = entry.time || formatTime(new Date(entry.openedAt || Date.now()));
    meta.textContent = `${domainLabel(entry.url)} · ${openedTime}`;
    copy.append(title, meta);
    if (icon) main.append(icon);
    main.append(copy);

    const open = document.createElement("button");
    open.className = "trail-open";
    open.type = "button";
    open.textContent = "Open";
    open.addEventListener("click", () => {
      addActivity(`Reopened research: ${title.textContent}`);
      navigateEmbedded(entry.url, { title: entry.title, source: entry.source });
    });

    row.append(main, open);
    elements.researchTrail.append(row);
  });
}

function renderLog() {
  elements.sessionLog.replaceChildren();
  const activity = currentThread().activity.filter(isMeaningfulActivity).slice(0, 8);

  if (activity.length === 0) {
    const empty = document.createElement("li");
    empty.className = "module-empty";
    empty.textContent = "No meaningful changes yet";
    elements.sessionLog.append(empty);
    return;
  }

  activity.forEach(entry => {
    const row = document.createElement("li");
    row.className = "log-item";

    const time = document.createElement("span");
    time.className = "log-time";
    time.textContent = entry.time;

    const text = document.createElement("span");
    text.textContent = entry.text;

    row.append(time, text);
    elements.sessionLog.append(row);
  });
}

function isMeaningfulActivity(entry) {
  const text = entry?.text || "";
  return ![
    /^Switched to:/,
    /^Searched /,
    /^Opened https?:/,
    /^Opened shortcut:/
  ].some(pattern => pattern.test(text));
}

function recordTrail({ title, url, source }) {
  const thread = currentThread();
  const existingIndex = thread.researchTrail.findIndex(entry => entry.url === url);
  if (existingIndex >= 0) thread.researchTrail.splice(existingIndex, 1);
  thread.researchTrail.unshift({
    title,
    url,
    source,
    openedAt: new Date().toISOString(),
    time: formatTime(new Date())
  });
  thread.researchTrail = thread.researchTrail.slice(0, 30);
  touchThread(thread);
}

function addActivity(text) {
  const thread = currentThread();
  thread.activity.unshift({
    text,
    at: new Date().toISOString(),
    time: formatTime(new Date())
  });
  thread.activity = thread.activity.slice(0, 40);
  touchThread(thread);
}

function extractActionItems(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = [];

  lines.forEach(line => {
    // Markdown checkbox: - [ ] something or * [ ] something
    const checkbox = line.match(/^[-*]\s*\[\s\]\s+(.+)$/i);
    if (checkbox) {
      out.push(checkbox[1].trim());
      return;
    }

    // Keyword-prefixed lines
    const keyword = line.match(/^(todo|to do|action|next|follow up|follow-up|need to|should)[:\-\s]+(.+)$/i);
    if (keyword) {
      out.push(keyword[2].trim());
      return;
    }

    // Bare line starting with action verb (looser)
    if (/^(todo|action|next|follow)\b/i.test(line)) {
      out.push(line.replace(/^(todo|action|next|follow|follow up|follow-up)[:\-\s]*/i, "").trim());
    }
  });

  return out.slice(0, 10);
}

function resolveDestination(value) {
  if (looksLikeUrl(value)) return normalizeUrl(value);
  return engines[state.global.engine](value);
}

function looksLikeUrl(value) {
  return value.includes(".") && !value.includes(" ");
}

function normalizeUrl(value) {
  if (!value) return "";
  if (value.startsWith("../") || value.startsWith("./") || value.startsWith("../../")) return value;
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

function getEngineLabel(engine) {
  const labels = { google: "Google", perplexity: "Perplexity", youtube: "YouTube", reddit: "Reddit" };
  return labels[engine] || "Search";
}

function getDomain(url) {
  try {
    const u = new URL(url, "https://placeholder.invalid");
    if (u.hostname === "placeholder.invalid") return "";
    return u.hostname;
  } catch { return ""; }
}

function domainLabel(url) {
  return getDomain(url).replace(/^www\./i, "") || prettyUrl(url);
}

function nameFromUrl(url) {
  try {
    const parsed = new URL(url);
    const segment = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "")
      .replace(/[-_]+/g, " ")
      .trim();
    if (segment) return segment.replace(/\b\w/g, character => character.toUpperCase());
    return domainLabel(url);
  } catch {
    return url;
  }
}

function faviconImg(url) {
  const domain = getDomain(url);
  if (!domain) return null;
  const img = document.createElement("img");
  img.className = "favicon";
  img.alt = "";
  img.loading = "lazy";
  img.width = 16;
  img.height = 16;
  img.referrerPolicy = "no-referrer";
  img.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
  img.addEventListener("error", () => { img.style.visibility = "hidden"; });
  return img;
}

function updateClock() {
  elements.clock.textContent = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date());
}

function currentThread() {
  if (!state.threads[state.activeThreadId]) {
    const firstActive = Object.values(state.threads).find(t => !t.archived);
    state.activeThreadId = firstActive ? firstActive.id :
      (Object.keys(state.threads)[0] || defaultThread.id);
    if (!state.threads[state.activeThreadId]) {
      state.threads[defaultThread.id] = structuredClone(defaultThread);
      state.activeThreadId = defaultThread.id;
    }
  }
  return state.threads[state.activeThreadId];
}

function touchThread(thread) {
  thread.updatedAt = new Date().toISOString();
}

function normalizeThreadKey(value) {
  return (value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function formatTime(date) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return mergeState(JSON.parse(raw));

    for (const key of LEGACY_KEYS) {
      const legacy = localStorage.getItem(key);
      if (legacy) return migrateLegacy(JSON.parse(legacy));
    }

    return structuredClone(defaultState);
  } catch {
    return structuredClone(defaultState);
  }
}

function mergeState(saved) {
  const merged = {
    ...structuredClone(defaultState),
    ...saved,
    global: {
      ...structuredClone(defaultState.global),
      ...(saved.global || {})
    },
    threads: normalizeThreads(saved.threads)
  };

  if (!merged.threads[merged.activeThreadId]) {
    const firstActive = Object.values(merged.threads).find(t => !t.archived);
    merged.activeThreadId = firstActive ? firstActive.id :
      (Object.keys(merged.threads)[0] || defaultThread.id);
  }

  // Move the legacy global link shelf onto the active Thread once. Keep the
  // old global array intact so older HEX surfaces can still read it.
  if (!merged.global.threadLinksMigrated) {
    const activeThread = merged.threads[merged.activeThreadId];
    const legacyLinks = Array.isArray(merged.global.quickLinks) ? merged.global.quickLinks : [];
    if (activeThread && legacyLinks.length) {
      const existing = new Set(activeThread.links.map(link => link.url));
      legacyLinks.forEach(link => {
        if (link?.url && !existing.has(link.url)) activeThread.links.push({ name: link.name || prettyUrl(link.url), url: link.url });
      });
    }
    merged.global.threadLinksMigrated = true;
  }

  return merged;
}

function migrateLegacy(saved) {
  const legacyThread = {
    ...structuredClone(defaultThread),
    title: saved.activeThread || defaultThread.title,
    mode: saved.mode || defaultThread.mode,
    notes: saved.scratchpad || "",
    queue: normalizeItems(saved.queue, defaultThread.queue),
    loops: normalizeItems(saved.loops, defaultThread.loops),
    links: Array.isArray(saved.links) ? saved.links : structuredClone(defaultThread.links),
    stickyNotion: migrateStickyNotion(saved),
    researchTrail: [],
    archived: false,
    activity: Array.isArray(saved.log)
      ? saved.log.map(entry => ({ text: entry.text, at: new Date().toISOString(), time: entry.time || "Earlier" }))
      : [{ text: "Migrated previous HEX state", at: new Date().toISOString(), time: "Earlier" }]
  };

  return {
    version: 3,
    activeThreadId: legacyThread.id,
    threads: { [legacyThread.id]: legacyThread },
    global: {
      ...structuredClone(defaultState.global),
      engine: saved.engine || defaultState.global.engine,
      quickLinks: Array.isArray(saved.links) ? saved.links : structuredClone(defaultState.global.quickLinks)
    }
  };
}

function normalizeThreads(threads) {
  if (!threads || typeof threads !== "object") return structuredClone(defaultState.threads);
  const normalized = {};

  Object.entries(threads).forEach(([id, thread]) => {
    normalized[id] = {
      ...structuredClone(defaultThread),
      ...thread,
      id,
      queue: normalizeItems(thread.queue, []),
      loops: normalizeItems(thread.loops, []),
      links: Array.isArray(thread.links) ? thread.links : [],
      pins: Array.isArray(thread.pins) ? thread.pins : [],
      stickyNotion: thread.stickyNotion || null,
      codex: normalizeCodex(thread.codex, true),
      researchTrail: Array.isArray(thread.researchTrail) ? thread.researchTrail : [],
      activity: Array.isArray(thread.activity) ? thread.activity : [],
      archived: Boolean(thread.archived),
      lastUrl: typeof thread.lastUrl === "string" ? thread.lastUrl : "",
      folderName: typeof thread.folderName === "string" ? thread.folderName : ""
    };
  });

  return Object.keys(normalized).length ? normalized : structuredClone(defaultState.threads);
}

function normalizeCodex(codex, recoverWorking = false) {
  const statuses = [
    "unavailable",
    "sign-in-required",
    "no-folder",
    "ready",
    "working",
    "approval-required",
    "completed",
    "failed",
    "interrupted"
  ];
  let status = statuses.includes(codex?.status) ? codex.status : "no-folder";
  let statusMessage = typeof codex?.statusMessage === "string"
    ? codex.statusMessage
    : "Connect the Thread folder to begin.";
  if (recoverWorking && status === "working") {
    status = "interrupted";
    statusMessage = "The previous Codex request ended when HEX closed. You can send it again.";
  }
  return {
    intent: ["continue", "review", "plan", "ship"].includes(codex?.intent) ? codex.intent : "continue",
    handoff: typeof codex?.handoff === "string" ? codex.handoff : "",
    promptDraft: typeof codex?.promptDraft === "string" ? codex.promptDraft : "",
    threadId: typeof codex?.threadId === "string" ? codex.threadId : "",
    workspacePath: typeof codex?.workspacePath === "string" ? codex.workspacePath : "",
    permissionMode: ["read-only", "workspace-write"].includes(codex?.permissionMode) ? codex.permissionMode : "read-only",
    status,
    statusMessage,
    lastRunAt: typeof codex?.lastRunAt === "string" ? codex.lastRunAt : "",
    lastResponsePreview: typeof codex?.lastResponsePreview === "string" ? codex.lastResponsePreview : ""
  };
}

function migrateStickyNotion(saved) {
  if (!saved.stickyNotionByThread || typeof saved.stickyNotionByThread !== "object") return null;
  const activeKey = normalizeThreadKey(saved.activeThread || defaultThread.title);
  return saved.stickyNotionByThread[activeKey] || Object.values(saved.stickyNotionByThread)[0] || null;
}

function normalizeItems(items, fallback) {
  if (!Array.isArray(items)) return structuredClone(fallback);
  return items.map(item => {
    if (typeof item === "string") return { text: item, done: false };
    return { text: item.text || "", done: Boolean(item.done) };
  }).filter(item => item.text);
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
