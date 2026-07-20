# HEX - your meta browser

HEX is a calm local-first Windows desktop companion for keeping threads, links, and files together while moving between applications.

Former project name: Browser Base.

## Launch

For normal use, double-click the **HEX** desktop shortcut or `Launch HEX.cmd` in this folder.

For development, install dependencies once and launch from a terminal:

```powershell
npm install
npm start
```

HEX starts as a small tab on the right edge of the Windows desktop. Click it to open the compact overlay. The full workspace is available from the button in the overlay header.

See `LAUNCHING_HEX.md` for simple launch and troubleshooting instructions.

## Legacy browser preview

The original browser workspace can still be previewed with:

```powershell
node preview-server.mjs
```

Then open:

```text
http://127.0.0.1:8765
```

The preview server only serves the static files. Thread file features are not available in the web preview (the Files view shows "Thread files are a desktop-app feature."); use the HEX desktop app for those.

## What It Does

- Floats above the Windows desktop as a compact, always-available edge tab.
- Expands into Thread, Links, and Files views.
- Preserves the active thread and quick note using local storage.
- Tracks open loops for the active thread.
- Keeps per-thread concept pins with definitions, types, sources, and review state.
- Looks up a concise sourced definition from the pin form and offers a Google verification search.
- Captures copied text from any Windows application into a new pin.
- Saves and reopens links attached to each thread.
- Creates local thread folders and accepts file picker or drag-and-drop additions.
- Automatically uses `Documents/HEX` by default and shows files as a visible two-column shelf with image previews.
- Opens the original full workspace for deeper thread management.
- Searches Google, Perplexity, YouTube, or Reddit.
- Expands Google into an in-app search workspace when the browser permits embedded results.
- Opens pasted URLs directly.
- Provides a Thread Files holder for files tied to the active thread (desktop app only).
- Opens the active thread's holding folder from the desktop app.
- Lists held files with size, type, modified time, Open actions, and Copy Path actions.
- Tracks an active thread as the center of the workflow.
- Keeps queue items, open loops, notes, sticky Notion, research trail, and activity history per thread.
- Connects the active Thread and its local folder to a persistent Codex session through Codex Dock.
- Saves opened URLs and searches into a Recent Research Trail.
- Shows contextual website shortcuts based on workflow mode.
- Sticks one Notion page to the current active thread.
- Supports workflow modes: Research, Writing, Opportunity Scan, and Deep Work.
- Saves quick links.
- Provides a scratchpad for temporary browsing notes.
- Extracts simple action lines from the scratchpad into the queue.
- Keeps a lightweight session log.

HEX data is stored in local storage. Codex Dock also uses the local Codex session store managed by the official Codex runtime.

## Thread Workspace

HEX treats tabs as temporary and threads as persistent. Each thread stores:

- title
- workflow mode
- notes
- queue
- open loops
- sticky Notion page
- Codex session ID, workspace folder, permission mode, status, and latest response preview
- concept pins and learning state
- recent research trail
- activity history

Thread file features (folders, file lists, opening files) run through the Electron desktop app. The legacy preview server serves static files only.

## Codex Dock

Codex Dock connects one HEX Thread to its existing local Thread folder and a persistent Codex session. It sends a concise package containing the Thread title and objective, notes, Pins, sources, connected file paths, unfinished work, and the current instruction. The latest status and response appear inside HEX.

The integration uses the official [`@openai/codex-sdk`](https://github.com/openai/codex/tree/main/sdk/typescript) from the Electron main process. Codex never runs in the page renderer, and authentication credentials are not exposed through the preload bridge.

### Authentication

Codex Dock reuses the Codex authentication already stored on the computer. Sign in through the Codex CLI or Codex app first. HEX does not collect, display, or save an API key. If the SDK reports that authentication is missing, the Dock shows **Sign-in required** and keeps the HEX Thread unchanged.

### Folder permissions

Every Codex run is restricted to the active HEX Thread's existing folder. The two available permission modes are:

- **Read only**: Codex can inspect the connected folder but cannot edit it.
- **Allow edits in this folder**: Codex can write inside the connected Thread folder.

HEX never requests unrestricted filesystem access. Network access is disabled for Codex Dock runs. The permission choice is explicit, stored per HEX Thread, and never increased automatically.

### Session persistence

After the first successful Codex turn, HEX saves the returned Codex thread ID inside that HEX Thread. Codex keeps the underlying session in its normal local session store. Reopening HEX and sending another instruction resumes that same Codex session by default.

Disconnecting removes HEX's link to the Codex session but does not delete the Codex session itself. Existing Thread notes, Pins, sources, files, queues, and activity remain intact.

### Current limitations

- Codex Dock shows the latest response and useful progress, not a full chat transcript or terminal.
- The TypeScript SDK does not provide a supported way to open the exact session in the Codex desktop app, so HEX does not show an **Open Codex app** control.
- Interactive approvals are not granted inside HEX. If a request requires one, the Dock reports **Approval required** so the user can adjust the request or permission mode.
- Authentication is confirmed by the first real Codex request; the initial connection check only validates the SDK and folder.
- Changing the HEX storage folder starts a new Codex session for the active Thread to avoid resuming old context against a different workspace.

## Product Identity

HEX points to honeycomb structure, bee geometry, modular cells, hexadecimal systems, and symbolic compression. The bee mascot represents the intelligence moving through the system; HEX is the comb it builds.

See `BRAND.md` for the fuller product language.

## Design Direction

HEX is not trying to become a full browser, chatbot, or noisy productivity dashboard. It is an ambient desktop continuity layer: minimal, persistent, warm, and available while the user works elsewhere.
