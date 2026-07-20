const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  CodexDockService,
  buildContextPackage,
  classifyCodexError
} = require("../codex-service");

test("buildContextPackage includes Thread context and permission boundary", () => {
  const prompt = buildContextPackage({
    workspacePath: "C:\\HEX\\thread",
    permissionMode: "read-only",
    instruction: "Summarize the files.",
    filePaths: ["C:\\HEX\\thread\\notes.txt"],
    context: {
      title: "Compression Study",
      objective: "Understand codec tradeoffs",
      notes: "Focus on practical playback.",
      pins: [{ name: "Bitrate", content: "Data per unit of time", source: "https://example.com/bitrate" }],
      sources: [{ name: "Reference", url: "https://example.com/reference" }],
      nextSteps: ["Compare H.264 and AV1"]
    }
  });

  assert.match(prompt, /Thread: Compression Study/);
  assert.match(prompt, /Filesystem permission: Read only/);
  assert.match(prompt, /C:\\HEX\\thread\\notes.txt/);
  assert.match(prompt, /Current instruction:\nSummarize the files\./);
});

test("classifyCodexError exposes useful authentication and permission states", () => {
  assert.equal(classifyCodexError(new Error("401 Unauthorized")).status, "sign-in-required");
  assert.equal(classifyCodexError(new Error("approval required")).status, "approval-required");
  assert.equal(classifyCodexError(new Error("permission denied by sandbox")).code, "permission-denied");
  assert.equal(classifyCodexError(new Error("spawn codex ENOENT")).status, "unavailable");
});

test("connect reports an unavailable SDK without changing workspace data", async () => {
  const service = new CodexDockService({
    importSdk: async () => { throw new Error("Cannot find package @openai/codex-sdk"); }
  });
  const result = await service.connect({
    hexThreadId: "hex-thread-1",
    workspacePath: process.cwd(),
    permissionMode: "read-only"
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "unavailable");
});

test("CodexDockService starts a persistent streamed session inside the workspace", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "hex-codex-test-"));
  await fs.writeFile(path.join(workspace, "notes.txt"), "safe test file", "utf8");
  const statuses = [];
  let receivedOptions;
  let receivedPrompt;
  let resumedId = "";

  class FakeThread {
    constructor(id) { this.id = id; }
    async runStreamed(prompt) {
      receivedPrompt = prompt;
      async function* events() {
        yield { type: "thread.started", thread_id: "sdk-thread-123" };
        yield { type: "turn.started" };
        yield { type: "item.completed", item: { id: "item-1", type: "agent_message", text: "Read-only check complete." } };
        yield { type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } };
      }
      return { events: events() };
    }
  }

  class FakeCodex {
    startThread(options) {
      receivedOptions = options;
      return new FakeThread(null);
    }
    resumeThread(id, options) {
      resumedId = id;
      receivedOptions = options;
      return new FakeThread(id);
    }
  }

  const service = new CodexDockService({
    importSdk: async () => ({ Codex: FakeCodex }),
    onStatus: status => statuses.push(status)
  });
  const result = await service.run({
    hexThreadId: "hex-thread-1",
    workspacePath: workspace,
    permissionMode: "read-only",
    threadId: "",
    context: { title: "Test Thread", notes: "Inspect only", pins: [], sources: [], nextSteps: [] },
    instruction: "Read the file names and report them without changing anything."
  });

  assert.equal(result.ok, true);
  assert.equal(result.threadId, "sdk-thread-123");
  assert.equal(result.lastResponsePreview, "Read-only check complete.");
  assert.equal(receivedOptions.workingDirectory, workspace);
  assert.equal(receivedOptions.sandboxMode, "read-only");
  assert.equal(receivedOptions.approvalPolicy, "never");
  assert.equal(receivedOptions.networkAccessEnabled, false);
  assert.match(receivedPrompt, /notes\.txt/);
  assert.ok(statuses.some(status => status.status === "completed"));

  const resumed = await service.run({
    hexThreadId: "hex-thread-1",
    workspacePath: workspace,
    permissionMode: "read-only",
    threadId: result.threadId,
    context: { title: "Test Thread", pins: [], sources: [], nextSteps: [] },
    instruction: "Continue the same session."
  });
  assert.equal(resumed.ok, true);
  assert.equal(resumedId, "sdk-thread-123");

  await fs.rm(workspace, { recursive: true, force: true });
});
