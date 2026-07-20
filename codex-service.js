const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const PERMISSION_MODES = new Set(["read-only", "workspace-write"]);
const MAX_CONTEXT_ITEMS = 30;
const MAX_TEXT = 12000;

function cleanText(value, max = MAX_TEXT) {
  return String(value || "").replace(/\0/g, "").trim().slice(0, max);
}

function cleanList(values, formatter = value => cleanText(value, 1000)) {
  if (!Array.isArray(values)) return [];
  return values.slice(0, MAX_CONTEXT_ITEMS).map(formatter).filter(Boolean);
}

function validatePermissionMode(value) {
  return PERMISSION_MODES.has(value) ? value : "read-only";
}

async function validateWorkspace(workspacePath, permissionMode) {
  const cleaned = cleanText(workspacePath, 2048);
  if (!cleaned) throw new Error("The connected workspace folder is missing");
  const resolved = path.resolve(cleaned);
  const stats = await fsp.stat(resolved);
  if (!stats.isDirectory()) throw new Error("The connected workspace is not a folder");
  const accessMode = fs.constants.R_OK |
    (permissionMode === "workspace-write" ? fs.constants.W_OK : 0);
  await fsp.access(resolved, accessMode);
  return resolved;
}

async function listWorkspaceFiles(workspacePath) {
  const entries = await fsp.readdir(workspacePath, { withFileTypes: true });
  return entries
    .filter(entry => entry.isFile())
    .slice(0, 50)
    .map(entry => path.join(workspacePath, entry.name));
}

function formatList(items, empty = "- None") {
  return items.length ? items.map(item => `- ${item}`) : [empty];
}

function buildContextPackage({ context = {}, instruction, workspacePath, permissionMode, filePaths = [] }) {
  const title = cleanText(context.title, 240) || "Untitled Thread";
  const objective = cleanText(context.objective, 500) || title;
  const notes = cleanText(context.notes);
  const pins = cleanList(context.pins, pin => {
    if (!pin || typeof pin !== "object") return "";
    const name = cleanText(pin.name, 180) || "Untitled pin";
    const content = cleanText(pin.content, 1200);
    const source = cleanText(pin.source, 1000);
    return `${name}: ${content || "No content"}${source ? ` (source: ${source})` : ""}`;
  });
  const sources = cleanList(context.sources, source => {
    if (!source || typeof source !== "object") return "";
    const name = cleanText(source.name, 240) || cleanText(source.url, 1000);
    const url = cleanText(source.url, 1000);
    return url ? `${name}: ${url}` : name;
  });
  const nextSteps = cleanList(context.nextSteps, step => cleanText(step, 700));
  const files = cleanList(filePaths, filePath => cleanText(filePath, 2048));
  const userInstruction = cleanText(instruction, 6000);
  if (!userInstruction) throw new Error("Enter an instruction for Codex");

  return [
    "You are continuing a HEX Thread inside its connected local workspace.",
    "Use the Thread context below as orientation, then follow the current instruction.",
    "Do not access files outside the connected workspace.",
    `Filesystem permission: ${permissionMode === "workspace-write" ? "Allow edits inside this workspace" : "Read only"}.`,
    "Network access is disabled for this turn.",
    "",
    `Thread: ${title}`,
    `Objective: ${objective}`,
    `Workspace: ${workspacePath}`,
    "",
    "Thread notes:",
    notes || "- None",
    "",
    "Pins:",
    ...formatList(pins),
    "",
    "Sources:",
    ...formatList(sources),
    "",
    "Connected files:",
    ...formatList(files),
    "",
    "Next steps:",
    ...formatList(nextSteps),
    "",
    "Current instruction:",
    userInstruction
  ].join("\n");
}

function classifyCodexError(error, wasAborted = false) {
  const raw = cleanText(error?.message || error, 2000) || "Codex could not complete the request";
  const message = raw.toLowerCase();

  if (wasAborted || error?.name === "AbortError" || /aborted|cancelled|canceled|interrupted/.test(message)) {
    return { status: "interrupted", code: "interrupted", message: "The Codex request was interrupted." };
  }
  if (/401|unauthori[sz]ed|not logged in|not authenticated|sign[ -]?in|login required/.test(message)) {
    return { status: "sign-in-required", code: "authentication", message: "Sign in to Codex on this computer, then try again." };
  }
  if (/approval/.test(message) && /required|request|denied|declined|not approved/.test(message)) {
    return { status: "approval-required", code: "approval", message: "Codex needs approval that HEX cannot grant automatically." };
  }
  if (/session|thread/.test(message) && /not found|missing|does not exist|could not resume|invalid/.test(message)) {
    return { status: "failed", code: "session-unavailable", message: "The saved Codex session is no longer available. Disconnect it to start a new session." };
  }
  if (/permission denied|access denied|read-only|sandbox|outside.*workspace|blocked by/.test(message)) {
    return { status: "failed", code: "permission-denied", message: "Codex was blocked by the selected folder permission." };
  }
  if (/cannot find package|module not found|enoent|spawn.*not found|codex.*not found/.test(message)) {
    return { status: "unavailable", code: "unavailable", message: "Codex is unavailable in this HEX installation." };
  }
  if (/working directory|workspace|folder|directory|no such file/.test(message)) {
    return { status: "no-folder", code: "folder", message: "The connected workspace folder is missing or inaccessible." };
  }
  return { status: "failed", code: "failed", message: raw.slice(0, 500) };
}

function progressForEvent(event) {
  if (event.type === "turn.started") return "Codex is reading the Thread context.";
  if (event.type !== "item.started" && event.type !== "item.updated" && event.type !== "item.completed") return "";
  if (event.item?.type === "command_execution") return "Codex is working in the connected folder.";
  if (event.item?.type === "file_change") return "Codex is updating files in the connected folder.";
  if (event.item?.type === "web_search") return "Codex requested web search, but HEX keeps network access off.";
  if (event.item?.type === "todo_list") return "Codex is organizing the work.";
  return "";
}

class CodexDockService {
  constructor({ onStatus = () => {}, importSdk = () => import("@openai/codex-sdk") } = {}) {
    this.onStatus = onStatus;
    this.importSdk = importSdk;
    this.activeRuns = new Map();
  }

  emit(hexThreadId, payload) {
    this.onStatus({ hexThreadId, at: new Date().toISOString(), ...payload });
  }

  async connect({ hexThreadId, workspacePath, permissionMode }) {
    const mode = validatePermissionMode(permissionMode);
    try {
      await this.importSdk();
      const resolved = await validateWorkspace(workspacePath, mode);
      return {
        ok: true,
        status: "ready",
        workspacePath: resolved,
        permissionMode: mode,
        message: "Ready. HEX will use the existing Codex sign-in on this computer."
      };
    } catch (error) {
      const failure = classifyCodexError(error);
      this.emit(hexThreadId, failure);
      return { ok: false, ...failure };
    }
  }

  async run({ hexThreadId, workspacePath, permissionMode, threadId, context, instruction }) {
    const key = cleanText(hexThreadId, 200);
    if (!key) return { ok: false, status: "failed", code: "invalid-thread", message: "HEX Thread is missing." };
    if (this.activeRuns.has(key)) {
      return { ok: false, status: "working", code: "already-running", message: "Codex is already working on this Thread." };
    }

    const mode = validatePermissionMode(permissionMode);
    const controller = new AbortController();
    this.activeRuns.set(key, controller);
    let activeThreadId = cleanText(threadId, 200);
    let finalResponse = "";

    try {
      const resolved = await validateWorkspace(workspacePath, mode);
      const filePaths = await listWorkspaceFiles(resolved);
      const prompt = buildContextPackage({ context, instruction, workspacePath: resolved, permissionMode: mode, filePaths });
      const { Codex } = await this.importSdk();
      const codex = new Codex();
      const threadOptions = {
        workingDirectory: resolved,
        skipGitRepoCheck: true,
        sandboxMode: mode,
        approvalPolicy: "never",
        networkAccessEnabled: false,
        additionalDirectories: []
      };
      const thread = activeThreadId
        ? codex.resumeThread(activeThreadId, threadOptions)
        : codex.startThread(threadOptions);

      this.emit(key, {
        status: "working",
        threadId: activeThreadId,
        workspacePath: resolved,
        message: activeThreadId ? "Resuming the connected Codex session." : "Starting a Codex session for this Thread."
      });

      const { events } = await thread.runStreamed(prompt, { signal: controller.signal });
      for await (const event of events) {
        if (event.type === "thread.started") {
          activeThreadId = cleanText(event.thread_id, 200);
          this.emit(key, { status: "working", threadId: activeThreadId, message: "Codex session connected." });
        }
        const progress = progressForEvent(event);
        if (progress) this.emit(key, { status: "working", threadId: activeThreadId, message: progress });
        if (event.type === "item.completed" && event.item?.type === "agent_message") {
          finalResponse = cleanText(event.item.text, 12000);
          this.emit(key, {
            status: "working",
            threadId: activeThreadId,
            lastResponsePreview: finalResponse,
            message: "Codex is finishing the response."
          });
        }
        if (event.type === "turn.failed") throw new Error(event.error?.message || "Codex turn failed");
        if (event.type === "error") throw new Error(event.message || "Codex stream failed");
      }

      const completed = {
        ok: true,
        status: "completed",
        threadId: activeThreadId || thread.id || "",
        workspacePath: resolved,
        permissionMode: mode,
        lastRunAt: new Date().toISOString(),
        lastResponsePreview: finalResponse,
        message: "Codex completed this request."
      };
      this.emit(key, completed);
      return completed;
    } catch (error) {
      const failure = classifyCodexError(error, controller.signal.aborted);
      const result = {
        ok: false,
        ...failure,
        threadId: activeThreadId,
        lastRunAt: new Date().toISOString(),
        lastResponsePreview: finalResponse
      };
      this.emit(key, result);
      return result;
    } finally {
      this.activeRuns.delete(key);
    }
  }

  disconnect(hexThreadId) {
    const key = cleanText(hexThreadId, 200);
    const controller = this.activeRuns.get(key);
    if (controller) controller.abort();
    return { ok: true, interrupted: Boolean(controller) };
  }

  shutdown() {
    for (const controller of this.activeRuns.values()) controller.abort();
    this.activeRuns.clear();
  }
}

module.exports = {
  CodexDockService,
  buildContextPackage,
  classifyCodexError,
  validatePermissionMode
};
