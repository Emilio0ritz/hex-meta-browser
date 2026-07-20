const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { CodexDockService } = require("../codex-service");

async function main() {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "hex-codex-smoke-"));
  const samplePath = path.join(workspace, "sample.txt");
  const original = "HEX Codex Dock read-only smoke test.\n";
  await fs.writeFile(samplePath, original, "utf8");

  try {
    const service = new CodexDockService();
    const connected = await service.connect({
      hexThreadId: "hex-smoke-thread",
      workspacePath: workspace,
      permissionMode: "read-only"
    });
    if (!connected.ok) throw new Error(connected.message);

    const first = await service.run({
      hexThreadId: "hex-smoke-thread",
      workspacePath: workspace,
      permissionMode: "read-only",
      threadId: "",
      context: {
        title: "HEX Codex Dock Smoke Test",
        objective: "Verify a harmless read-only SDK request",
        notes: "This folder contains one sample file.",
        pins: [],
        sources: [],
        nextSteps: ["Confirm the SDK can read the workspace"]
      },
      instruction: "Read sample.txt without changing any files. Reply briefly that the HEX Codex Dock read-only check completed."
    });
    if (!first.ok) throw new Error(`${first.status}: ${first.message}`);
    assert.ok(first.threadId, "The SDK did not return a persistent thread ID");
    assert.ok(first.lastResponsePreview, "The SDK did not return a response");
    assert.equal(await fs.readFile(samplePath, "utf8"), original);

    // A new service instance simulates HEX restarting before the session resumes.
    const restartedService = new CodexDockService();
    const resumed = await restartedService.run({
      hexThreadId: "hex-smoke-thread",
      workspacePath: workspace,
      permissionMode: "read-only",
      threadId: first.threadId,
      context: {
        title: "HEX Codex Dock Smoke Test",
        objective: "Verify session persistence",
        notes: "Resume the previous harmless read-only check.",
        pins: [],
        sources: [],
        nextSteps: []
      },
      instruction: "Confirm briefly that this is the resumed HEX Codex Dock session. Do not change files."
    });
    if (!resumed.ok) throw new Error(`${resumed.status}: ${resumed.message}`);
    assert.equal(await fs.readFile(samplePath, "utf8"), original);

    console.log(JSON.stringify({
      connected: true,
      threadId: first.threadId,
      resumed: resumed.threadId === first.threadId,
      workspaceUnchanged: true,
      firstResponse: first.lastResponsePreview,
      resumedResponse: resumed.lastResponsePreview
    }, null, 2));
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
