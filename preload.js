const { contextBridge, ipcRenderer, webUtils } = require("electron");

const droppedFileHandlers = new Set();

window.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("drop", event => {
    const filePaths = Array.from(event.dataTransfer?.files || [])
      .map(file => webUtils.getPathForFile(file))
      .filter(Boolean);
    if (!filePaths.length) return;
    droppedFileHandlers.forEach(handler => handler(filePaths));
  }, true);
}, { once: true });

// Safe, narrow API surface for the renderer. No raw ipcRenderer escape.
contextBridge.exposeInMainWorld("bb", {
  view: {
    navigate: url => ipcRenderer.invoke("view:navigate", url),
    back: () => ipcRenderer.invoke("view:back"),
    forward: () => ipcRenderer.invoke("view:forward"),
    reload: () => ipcRenderer.invoke("view:reload"),
    stop: () => ipcRenderer.invoke("view:stop"),
    show: bounds => ipcRenderer.invoke("view:show", bounds),
    hide: () => ipcRenderer.invoke("view:hide"),
    setBounds: bounds => ipcRenderer.invoke("view:setBounds", bounds),
    getState: () => ipcRenderer.invoke("view:getState"),
    openExternal: url => ipcRenderer.invoke("view:openExternal", url),
    onNav: handler => {
      const listener = (_e, payload) => handler(payload);
      ipcRenderer.on("view:nav", listener);
      return () => ipcRenderer.removeListener("view:nav", listener);
    },
    onTitle: handler => {
      const listener = (_e, payload) => handler(payload);
      ipcRenderer.on("view:title", listener);
      return () => ipcRenderer.removeListener("view:title", listener);
    },
    onLoading: handler => {
      const listener = (_e, payload) => handler(payload);
      ipcRenderer.on("view:loading", listener);
      return () => ipcRenderer.removeListener("view:loading", listener);
    }
  },
  data: {
    defaultRoots: () => ipcRenderer.invoke("data:default-roots"),
    chooseRoot: () => ipcRenderer.invoke("data:choose-root"),
    ensureRoot: rootPath => ipcRenderer.invoke("data:ensure-root", rootPath),
    ensureThreadFolder: (root, folderName) =>
      ipcRenderer.invoke("data:ensure-thread-folder", { root, folderName }),
    listThreadFiles: (root, folderName) =>
      ipcRenderer.invoke("data:list-thread-files", { root, folderName }),
    filePreview: (root, folderName, fileName) =>
      ipcRenderer.invoke("data:file-preview", { root, folderName, fileName }),
    chooseAndAddFiles: (root, folderName) =>
      ipcRenderer.invoke("data:choose-and-add-files", { root, folderName }),
    addFilePaths: (root, folderName, filePaths) =>
      ipcRenderer.invoke("data:add-dropped-files", { root, folderName, filePaths }),
    onDroppedFiles: handler => {
      droppedFileHandlers.add(handler);
      return () => droppedFileHandlers.delete(handler);
    },
    openFolder: folderPath => ipcRenderer.invoke("data:open-folder", folderPath),
    openThreadFolder: (root, folderName) =>
      ipcRenderer.invoke("data:open-thread-folder", { root, folderName }),
    openFile: filePath => ipcRenderer.invoke("data:open-file", filePath),
    revealFile: filePath => ipcRenderer.invoke("data:reveal-file", filePath),
    findOrphans: (root, claimed) =>
      ipcRenderer.invoke("data:find-orphans", { root, claimed }),
    deleteFolder: folderPath => ipcRenderer.invoke("data:delete-folder", folderPath),
    cacheSize: () => ipcRenderer.invoke("data:get-cache-size")
  },
  cache: {
    clear: opts => ipcRenderer.invoke("cache:clear", opts || {})
  },
  capture: {
    onCapture: handler => {
      const listener = (_e, payload) => handler(payload);
      ipcRenderer.on("capture:received", listener);
      return () => ipcRenderer.removeListener("capture:received", listener);
    }
  },
  overlay: {
    toggle: () => ipcRenderer.invoke("overlay:toggle"),
    collapse: () => ipcRenderer.invoke("overlay:collapse"),
    getState: () => ipcRenderer.invoke("overlay:get-state"),
    openManager: () => ipcRenderer.invoke("overlay:open-manager"),
    quit: () => ipcRenderer.invoke("overlay:quit"),
    onState: handler => {
      const listener = (_e, payload) => handler(payload);
      ipcRenderer.on("overlay:state", listener);
      return () => ipcRenderer.removeListener("overlay:state", listener);
    }
  },
  clipboard: {
    readText: () => ipcRenderer.invoke("clipboard:read-text"),
    writeText: text => ipcRenderer.invoke("clipboard:write-text", text)
  },
  knowledge: {
    define: (term, context) => ipcRenderer.invoke("knowledge:define", { term, context })
  },
  codex: {
    connect: payload => ipcRenderer.invoke("codex:connect", payload),
    run: payload => ipcRenderer.invoke("codex:run", payload),
    disconnect: payload => ipcRenderer.invoke("codex:disconnect", payload),
    onStatus: handler => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on("codex:status", listener);
      return () => ipcRenderer.removeListener("codex:status", listener);
    }
  },
  env: {
    isElectron: true,
    platform: process.platform
  }
});
