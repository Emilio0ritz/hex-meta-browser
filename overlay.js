const STORAGE_KEY = "emilio.browserBase.v3";

const fallbackThread = {
  id: "thread_home",
  title: "Home",
  mode: "research",
  notes: "",
  queue: [],
  loops: [],
  links: [],
  pins: [],
  stickyNotion: null,
  codex: { handoff: "", promptDraft: "" },
  researchTrail: [],
  activity: [],
  archived: false,
  folderName: "home",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const fallbackState = {
  version: 3,
  activeThreadId: fallbackThread.id,
  threads: { [fallbackThread.id]: fallbackThread },
  global: { engine: "google", quickLinks: [], activity: [], dataRoot: "", onboarded: false }
};

const elements = {
  edgeTab: document.querySelector("#edgeTab"),
  edgeCount: document.querySelector("#edgeCount"),
  panel: document.querySelector("#panel"),
  collapsePanel: document.querySelector("#collapsePanel"),
  openManager: document.querySelector("#openManager"),
  threadSelect: document.querySelector("#threadSelect"),
  newThread: document.querySelector("#newThread"),
  threadTitle: document.querySelector("#threadTitle"),
  quickNote: document.querySelector("#quickNote"),
  saveState: document.querySelector("#saveState"),
  loopInput: document.querySelector("#loopInput"),
  addLoop: document.querySelector("#addLoop"),
  loopList: document.querySelector("#loopList"),
  pinCount: document.querySelector("#pinCount"),
  pinClipboard: document.querySelector("#pinClipboard"),
  newPin: document.querySelector("#newPin"),
  pinForm: document.querySelector("#pinForm"),
  pinName: document.querySelector("#pinName"),
  pinType: document.querySelector("#pinType"),
  pinContent: document.querySelector("#pinContent"),
  pinSource: document.querySelector("#pinSource"),
  definePin: document.querySelector("#definePin"),
  googlePin: document.querySelector("#googlePin"),
  definitionStatus: document.querySelector("#definitionStatus"),
  cancelPin: document.querySelector("#cancelPin"),
  pinList: document.querySelector("#pinList"),
  linkForm: document.querySelector("#linkForm"),
  linkName: document.querySelector("#linkName"),
  linkUrl: document.querySelector("#linkUrl"),
  linkList: document.querySelector("#linkList"),
  dropZone: document.querySelector("#dropZone"),
  addFiles: document.querySelector("#addFiles"),
  refreshFiles: document.querySelector("#refreshFiles"),
  openFolder: document.querySelector("#openFolder"),
  chooseRoot: document.querySelector("#chooseRoot"),
  fileLocation: document.querySelector("#fileLocation"),
  fileStatus: document.querySelector("#fileStatus"),
  fileList: document.querySelector("#fileList"),
  footerSummary: document.querySelector("#footerSummary"),
  quitHex: document.querySelector("#quitHex"),
  toast: document.querySelector("#toast")
};

let state = loadState();
let toastTimer = null;
let saveTimer = null;
let editingPinId = null;
let fileRenderVersion = 0;
const expandedPinIds = new Set();

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || !saved.threads || typeof saved.threads !== "object") {
      return structuredClone(fallbackState);
    }
    const next = { ...structuredClone(fallbackState), ...saved };
    next.global = { ...structuredClone(fallbackState.global), ...(saved.global || {}) };
    next.threads = {};
    Object.entries(saved.threads).forEach(([id, thread]) => {
      next.threads[id] = normalizeThread(id, thread);
    });
    if (!Object.keys(next.threads).length) {
      next.threads[fallbackThread.id] = structuredClone(fallbackThread);
    }
    if (!next.threads[next.activeThreadId]) {
      next.activeThreadId = Object.keys(next.threads)[0];
    }
    return next;
  } catch {
    return structuredClone(fallbackState);
  }
}

function normalizeThread(id, thread = {}) {
  return {
    ...structuredClone(fallbackThread),
    ...thread,
    id,
    title: String(thread.title || "Untitled Thread"),
    notes: typeof thread.notes === "string" ? thread.notes : "",
    queue: Array.isArray(thread.queue) ? thread.queue : [],
    loops: Array.isArray(thread.loops) ? thread.loops : [],
    links: Array.isArray(thread.links) ? thread.links : [],
    pins: Array.isArray(thread.pins) ? thread.pins.map(normalizePin) : [],
    researchTrail: Array.isArray(thread.researchTrail) ? thread.researchTrail : [],
    activity: Array.isArray(thread.activity) ? thread.activity : [],
    folderName: typeof thread.folderName === "string" ? thread.folderName : ""
  };
}

function normalizePin(pin = {}) {
  return {
    id: String(pin.id || `pin_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`),
    name: String(pin.name || "Untitled pin"),
    type: String(pin.type || "general"),
    content: String(pin.content || ""),
    source: String(pin.source || ""),
    status: pin.status === "understood" ? "understood" : "review",
    createdAt: pin.createdAt || new Date().toISOString(),
    updatedAt: pin.updatedAt || new Date().toISOString()
  };
}

function currentThread() {
  return state.threads[state.activeThreadId];
}

function saveState(message = "Saved") {
  const thread = currentThread();
  thread.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  elements.saveState.textContent = message;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    elements.saveState.textContent = "Saved";
  }, 700);
}

function slugify(value) {
  return String(value || "thread")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "thread";
}

function uniqueFolderName(title) {
  const base = slugify(title);
  const used = new Set(Object.values(state.threads).map(thread => thread.folderName).filter(Boolean));
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function render() {
  renderThreadPicker();
  renderThread();
  renderLoops();
  renderPins();
  renderLinks();
  renderSummary();
}

function renderThreadPicker() {
  const threads = Object.values(state.threads)
    .filter(thread => !thread.archived)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  elements.threadSelect.replaceChildren();
  threads.forEach(thread => {
    const option = document.createElement("option");
    option.value = thread.id;
    option.textContent = thread.title;
    option.selected = thread.id === state.activeThreadId;
    elements.threadSelect.append(option);
  });
}

function renderThread() {
  const thread = currentThread();
  if (document.activeElement !== elements.threadTitle) elements.threadTitle.value = thread.title;
  if (document.activeElement !== elements.quickNote) elements.quickNote.value = thread.notes;
}

function renderLoops() {
  const thread = currentThread();
  elements.loopList.replaceChildren();
  const loops = thread.loops.filter(item => !item.done);
  if (!loops.length) return renderEmpty(elements.loopList, "No open loops. Your attention is clear.");

  loops.forEach(item => {
    const row = document.createElement("li");
    row.className = "list-row";
    const main = document.createElement("div");
    main.className = "list-row-main";
    const text = document.createElement("strong");
    text.textContent = item.text;
    main.append(text);
    const done = document.createElement("button");
    done.className = "row-action";
    done.type = "button";
    done.textContent = "Done";
    done.addEventListener("click", () => {
      item.done = true;
      saveState();
      renderLoops();
      renderSummary();
    });
    row.append(main, done);
    elements.loopList.append(row);
  });
}

function renderPins() {
  const pins = currentThread().pins;
  elements.pinList.replaceChildren();
  elements.pinCount.textContent = `${pins.length} pin${pins.length === 1 ? "" : "s"}`;
  if (!pins.length) {
    return renderEmpty(elements.pinList, "Pin a term, definition, question, or quote while you work.");
  }

  pins.forEach(pin => {
    const item = document.createElement("li");
    item.className = `pin-item ${pin.status === "understood" ? "understood" : "needs-review"}`;

    const details = document.createElement("details");
    details.open = expandedPinIds.has(pin.id);
    details.addEventListener("toggle", () => {
      if (details.open) expandedPinIds.add(pin.id);
      else expandedPinIds.delete(pin.id);
    });

    const summary = document.createElement("summary");
    const identity = document.createElement("span");
    identity.className = "pin-identity";
    const name = document.createElement("strong");
    name.textContent = pin.name;
    const type = document.createElement("span");
    type.className = "pin-type";
    type.textContent = pin.type;
    identity.append(name, type);
    const status = document.createElement("span");
    status.className = "pin-status";
    status.textContent = pin.status === "understood" ? "Understood" : "Review";
    summary.append(identity, status);

    const body = document.createElement("div");
    body.className = "pin-body";
    const content = document.createElement("p");
    content.textContent = pin.content || "No explanation yet.";
    body.append(content);

    if (pin.source) {
      const source = document.createElement("button");
      source.className = "pin-source";
      source.type = "button";
      source.textContent = prettyUrl(pin.source);
      source.title = pin.source;
      source.addEventListener("click", () => window.bb.view.openExternal(pin.source));
      body.append(source);
    }

    const actions = document.createElement("div");
    actions.className = "pin-actions";
    actions.append(
      rowButton(pin.status === "understood" ? "Needs review" : "Understood", () => {
        pin.status = pin.status === "understood" ? "review" : "understood";
        pin.updatedAt = new Date().toISOString();
        saveState();
        renderPins();
        renderSummary();
      }),
      rowButton("Copy", async () => {
        await window.bb.clipboard.writeText(`${pin.name}\n${pin.content}`);
        toast("Pin copied");
      }),
      rowButton("Edit", () => openPinForm(pin)),
      rowButton("Remove", () => removePin(pin.id), "remove")
    );
    body.append(actions);
    details.append(summary, body);
    item.append(details);
    elements.pinList.append(item);
  });
}

function openPinForm(pin = null, capturedText = "") {
  editingPinId = pin?.id || null;
  elements.pinName.value = pin?.name || "";
  elements.pinType.value = pin?.type || "definition";
  elements.pinContent.value = pin?.content || capturedText;
  elements.pinSource.value = pin?.source || "";
  setDefinitionStatus("");
  elements.pinForm.hidden = false;
  elements.pinName.focus();
  if (pin) elements.pinName.select();
}

function closePinForm() {
  editingPinId = null;
  elements.pinForm.reset();
  elements.pinType.value = "definition";
  setDefinitionStatus("");
  elements.pinForm.hidden = true;
}

function setDefinitionStatus(message, isError = false) {
  elements.definitionStatus.textContent = message;
  elements.definitionStatus.classList.toggle("error", isError);
}

function googleDefinitionUrl(term) {
  return `https://www.google.com/search?q=${encodeURIComponent(`define ${term}`)}`;
}

async function defineCurrentPin() {
  const term = elements.pinName.value.trim();
  if (!term) {
    elements.pinName.focus();
    return setDefinitionStatus("Enter a term first", true);
  }

  elements.definePin.disabled = true;
  elements.definePin.textContent = "Finding...";
  setDefinitionStatus("Looking it up");

  try {
    const thread = currentThread();
    const context = [thread.title, thread.notes].filter(Boolean).join(". ");
    const result = await window.bb.knowledge.define(term, context);
    if (!result?.definition) throw new Error("No concise definition found");
    elements.pinType.value = "definition";
    elements.pinContent.value = result.definition;
    elements.pinSource.value = result.source || "";
    setDefinitionStatus(result.sourceLabel || "Definition found");
    elements.pinContent.focus();
    elements.pinContent.setSelectionRange(0, 0);
    elements.pinContent.scrollTop = 0;
  } catch (error) {
    const message = String(error?.message || "Definition unavailable")
      .replace(/^Error invoking remote method 'knowledge:define': Error: /, "");
    setDefinitionStatus(message, true);
  } finally {
    elements.definePin.disabled = false;
    elements.definePin.textContent = "Define term";
  }
}

function removePin(id) {
  const thread = currentThread();
  const index = thread.pins.findIndex(pin => pin.id === id);
  if (index === -1) return;
  thread.pins.splice(index, 1);
  expandedPinIds.delete(id);
  if (editingPinId === id) closePinForm();
  saveState();
  renderPins();
  renderSummary();
  toast("Pin removed");
}

function renderLinks() {
  const thread = currentThread();
  elements.linkList.replaceChildren();
  if (!thread.links.length) return renderEmpty(elements.linkList, "No pages saved to this thread yet.");

  thread.links.forEach((link, index) => {
    const row = document.createElement("li");
    row.className = "list-row";
    const main = document.createElement("div");
    main.className = "list-row-main";
    const name = document.createElement("strong");
    name.textContent = link.name || prettyUrl(link.url);
    const url = document.createElement("span");
    url.textContent = prettyUrl(link.url);
    main.append(name, url);
    const actions = document.createElement("div");
    actions.className = "row-actions";
    actions.append(
      rowButton("Open", () => window.bb.view.openExternal(link.url)),
      rowButton("Remove", () => {
        thread.links.splice(index, 1);
        saveState();
        renderLinks();
      }, "remove")
    );
    row.append(main, actions);
    elements.linkList.append(row);
  });
}

function renderEmpty(list, message) {
  const empty = document.createElement("li");
  empty.className = "empty-row";
  empty.textContent = message;
  list.append(empty);
}

function rowButton(label, action, extraClass = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `row-action ${extraClass}`.trim();
  button.textContent = label;
  button.addEventListener("click", action);
  return button;
}

function renderSummary() {
  const threads = Object.values(state.threads).filter(thread => !thread.archived);
  const loops = currentThread().loops.filter(item => !item.done).length;
  const pins = currentThread().pins.length;
  elements.edgeCount.textContent = String(pins);
  elements.edgeCount.title = `${pins} pin${pins === 1 ? "" : "s"} in the active thread`;
  elements.footerSummary.textContent = `${pins} pin${pins === 1 ? "" : "s"} - ${loops} open loop${loops === 1 ? "" : "s"} - ${threads.length} thread${threads.length === 1 ? "" : "s"}`;
}

async function renderFiles() {
  const renderVersion = ++fileRenderVersion;
  elements.fileList.replaceChildren();
  elements.fileStatus.textContent = "Loading files...";
  if (!window.bb) return showFileError("File access is only available in the HEX desktop app.");
  const thread = currentThread();
  let result;
  try {
    await ensureDefaultFileRoot();
    await ensureThreadFolder(thread);
    result = await window.bb.data.listThreadFiles(state.global.dataRoot, thread.folderName);
  } catch (error) {
    if (renderVersion !== fileRenderVersion) return;
    return showFileError(error);
  }
  if (renderVersion !== fileRenderVersion) return;
  elements.fileList.replaceChildren();
  elements.fileLocation.textContent = compactFilePath(result.path);
  elements.fileLocation.title = result.path;
  elements.fileStatus.textContent = `${result.files.length} file${result.files.length === 1 ? "" : "s"} in ${thread.title}`;
  if (!result.files.length) return renderEmpty(elements.fileList, "No files yet. Add files or drop them above.");

  result.files.forEach(file => {
    const tile = document.createElement("li");
    tile.className = "file-tile";

    const open = document.createElement("button");
    open.className = "file-open-surface";
    open.type = "button";
    open.title = `Open ${file.name}`;

    const preview = document.createElement("span");
    preview.className = "file-preview";
    const extension = document.createElement("span");
    extension.className = "file-extension";
    extension.textContent = file.extension.slice(0, 4).toUpperCase();
    preview.append(extension);
    loadFilePreview(preview, file, thread);

    const main = document.createElement("span");
    main.className = "file-info";
    const name = document.createElement("strong");
    name.textContent = file.name;
    const detail = document.createElement("span");
    detail.textContent = `${formatBytes(file.size)} - ${formatFileDate(file.modifiedAt)}`;
    main.append(name, detail);

    open.append(preview, main);
    open.addEventListener("click", async () => {
      const opened = await window.bb.data.openFile(file.path);
      if (!opened) showFileError(`Windows could not open ${file.name}.`);
    });

    const actions = document.createElement("div");
    actions.className = "file-tile-actions";
    actions.append(rowButton("Show in folder", () => window.bb.data.revealFile(file.path)));
    tile.append(open, actions);
    elements.fileList.append(tile);
  });
}

async function ensureDefaultFileRoot() {
  if (state.global.dataRoot) return state.global.dataRoot;
  const roots = await window.bb.data.defaultRoots();
  state.global.dataRoot = roots.documents;
  await window.bb.data.ensureRoot(state.global.dataRoot);
  saveState();
  return state.global.dataRoot;
}

async function loadFilePreview(container, file, thread) {
  try {
    const preview = await window.bb.data.filePreview(
      state.global.dataRoot,
      thread.folderName,
      file.name
    );
    if (!preview || !container.isConnected) return;
    const image = document.createElement("img");
    image.src = preview;
    image.alt = "";
    container.replaceChildren(image);
  } catch {}
}

async function ensureThreadFolder(thread) {
  if (!state.global.dataRoot) return false;
  if (!thread.folderName) thread.folderName = uniqueFolderName(thread.title);
  await window.bb.data.ensureRoot(state.global.dataRoot);
  await window.bb.data.ensureThreadFolder(state.global.dataRoot, thread.folderName);
  saveState();
  return true;
}

async function chooseFileRoot() {
  try {
    const root = await window.bb.data.chooseRoot();
    if (!root) return false;
    state.global.dataRoot = root;
    await ensureThreadFolder(currentThread());
    saveState();
    toast("File location connected");
    await renderFiles();
    return true;
  } catch (error) {
    showFileError(error);
    return false;
  }
}

async function addChosenFiles() {
  try {
    await ensureDefaultFileRoot();
    const thread = currentThread();
    await ensureThreadFolder(thread);
    const result = await window.bb.data.chooseAndAddFiles(state.global.dataRoot, thread.folderName);
    reportFileAdd(result);
  } catch (error) {
    showFileError(error);
  }
}

async function addDroppedFilePaths(filePaths) {
  try {
    if (!filePaths.length) return;
    await ensureDefaultFileRoot();
    const thread = currentThread();
    await ensureThreadFolder(thread);
    elements.fileStatus.textContent = `Adding ${filePaths.length} file${filePaths.length === 1 ? "" : "s"}...`;
    const result = await window.bb.data.addFilePaths(state.global.dataRoot, thread.folderName, filePaths);
    reportFileAdd(result);
  } catch (error) {
    showFileError(error);
  }
}

async function reportFileAdd(result) {
  const count = result?.copied?.length || 0;
  const errors = result?.errors?.length || 0;
  await renderFiles();
  if (errors) {
    elements.fileStatus.textContent = `${errors} file${errors === 1 ? "" : "s"} could not be added.`;
  }
  toast(count ? `Added ${count} file${count === 1 ? "" : "s"}` : errors ? "Could not add files" : "No files selected");
}

function showFileError(error) {
  const message = String(error?.message || error || "Unknown file error");
  elements.fileList.replaceChildren();
  elements.fileStatus.textContent = `File holder error: ${message}`;
  renderEmpty(elements.fileList, "Reconnect the file location or try again.");
  toast("File holder needs attention");
}

function compactFilePath(folderPath) {
  const parts = String(folderPath || "").split(/[\\/]+/).filter(Boolean);
  return parts.slice(-3).join(" / ") || "HEX files";
}

function formatFileDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function normalizeUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    return new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`).href;
  } catch {
    return "";
  }
}

function prettyUrl(value) {
  try {
    const url = new URL(value);
    return `${url.hostname.replace(/^www\./, "")}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return String(value || "");
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 1800);
}

function setExpanded(expanded) {
  document.body.classList.toggle("is-expanded", expanded);
  document.body.classList.toggle("is-collapsed", !expanded);
  if (expanded) {
    state = loadState();
    render();
    renderFiles();
  }
}

elements.edgeTab.addEventListener("click", () => window.bb.overlay.toggle());
elements.collapsePanel.addEventListener("click", () => window.bb.overlay.collapse());
elements.openManager.addEventListener("click", () => window.bb.overlay.openManager());
elements.quitHex.addEventListener("click", () => window.bb.overlay.quit());

elements.threadSelect.addEventListener("change", () => {
  state.activeThreadId = elements.threadSelect.value;
  saveState();
  render();
  renderFiles();
});

elements.newThread.addEventListener("click", () => {
  const id = `thread_${Date.now()}`;
  const title = "New Thread";
  state.threads[id] = normalizeThread(id, {
    title,
    folderName: uniqueFolderName(title),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  state.activeThreadId = id;
  saveState();
  render();
  renderFiles();
  elements.threadTitle.focus();
  elements.threadTitle.select();
});

elements.threadTitle.addEventListener("input", () => {
  currentThread().title = elements.threadTitle.value || "Untitled Thread";
  saveState("Saving...");
  renderThreadPicker();
  renderSummary();
});

elements.quickNote.addEventListener("input", () => {
  currentThread().notes = elements.quickNote.value;
  saveState("Saving...");
});

function addLoop() {
  const text = elements.loopInput.value.trim();
  if (!text) return;
  currentThread().loops.unshift({ text, done: false });
  elements.loopInput.value = "";
  saveState();
  renderLoops();
  renderSummary();
}

elements.addLoop.addEventListener("click", addLoop);
elements.loopInput.addEventListener("keydown", event => {
  if (event.key === "Enter") addLoop();
});

elements.newPin.addEventListener("click", () => openPinForm());
elements.cancelPin.addEventListener("click", closePinForm);
elements.definePin.addEventListener("click", defineCurrentPin);
elements.googlePin.addEventListener("click", () => {
  const term = elements.pinName.value.trim();
  if (!term) {
    elements.pinName.focus();
    return setDefinitionStatus("Enter a term first", true);
  }
  window.bb.view.openExternal(googleDefinitionUrl(term));
});
elements.pinName.addEventListener("keydown", event => {
  if (event.key === "Enter" && elements.pinType.value === "definition") {
    event.preventDefault();
    defineCurrentPin();
  }
});

elements.pinClipboard.addEventListener("click", async () => {
  const text = (await window.bb.clipboard.readText()).trim();
  if (!text) return toast("Clipboard is empty");
  openPinForm(null, text);
  toast("Clipboard captured");
});

elements.pinForm.addEventListener("submit", event => {
  event.preventDefault();
  const name = elements.pinName.value.trim();
  const content = elements.pinContent.value.trim();
  const sourceText = elements.pinSource.value.trim();
  const source = sourceText ? normalizeUrl(sourceText) : "";
  if (!name || !content) return toast("Add a title and content");
  if (sourceText && !source) return toast("Enter a valid source URL");

  const thread = currentThread();
  const existing = editingPinId
    ? thread.pins.find(pin => pin.id === editingPinId)
    : null;
  const now = new Date().toISOString();

  if (existing) {
    Object.assign(existing, {
      name,
      type: elements.pinType.value,
      content,
      source,
      updatedAt: now
    });
  } else {
    const pin = normalizePin({
      id: `pin_${Date.now()}`,
      name,
      type: elements.pinType.value,
      content,
      source,
      status: "review",
      createdAt: now,
      updatedAt: now
    });
    thread.pins.unshift(pin);
    expandedPinIds.add(pin.id);
  }

  saveState();
  closePinForm();
  renderPins();
  renderSummary();
  toast(existing ? "Pin updated" : "Pin saved");
});

elements.linkForm.addEventListener("submit", event => {
  event.preventDefault();
  const url = normalizeUrl(elements.linkUrl.value);
  if (!url) return toast("Enter a valid URL");
  const name = elements.linkName.value.trim() || prettyUrl(url);
  currentThread().links.unshift({ name, url, addedAt: new Date().toISOString() });
  elements.linkName.value = "";
  elements.linkUrl.value = "";
  saveState();
  renderLinks();
  toast("Link saved to thread");
});

document.querySelectorAll(".view-tab").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".view-tab").forEach(tab => tab.classList.toggle("active", tab === button));
    document.querySelectorAll("[data-view-panel]").forEach(panel => {
      panel.classList.toggle("active", panel.dataset.viewPanel === button.dataset.view);
    });
    if (button.dataset.view === "files") renderFiles();
  });
});

elements.dropZone.addEventListener("click", addChosenFiles);
elements.addFiles.addEventListener("click", addChosenFiles);
elements.refreshFiles.addEventListener("click", renderFiles);
elements.chooseRoot.addEventListener("click", chooseFileRoot);
elements.openFolder.addEventListener("click", async () => {
  try {
    await ensureDefaultFileRoot();
    const thread = currentThread();
    await ensureThreadFolder(thread);
    const opened = await window.bb.data.openThreadFolder(state.global.dataRoot, thread.folderName);
    if (!opened) showFileError("Windows could not open the thread folder.");
  } catch (error) {
    showFileError(error);
  }
});

["dragenter", "dragover"].forEach(name => {
  elements.dropZone.addEventListener(name, event => {
    event.preventDefault();
    elements.dropZone.classList.add("dragging");
  });
});

["dragleave", "drop"].forEach(name => {
  elements.dropZone.addEventListener(name, event => {
    event.preventDefault();
    elements.dropZone.classList.remove("dragging");
  });
});

document.addEventListener("dragover", event => event.preventDefault());
document.addEventListener("drop", event => event.preventDefault());

window.bb.data.onDroppedFiles(filePaths => addDroppedFilePaths(filePaths));

window.bb.overlay.onState(payload => setExpanded(Boolean(payload.expanded)));
window.addEventListener("storage", event => {
  if (event.key !== STORAGE_KEY) return;
  state = loadState();
  render();
});

window.bb.overlay.getState().then(payload => setExpanded(Boolean(payload.expanded)));
render();
