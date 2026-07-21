# Built with Codex + GPT-5.6

This document describes where OpenAI Codex (running GPT-5.6) did the work in HEX — both as the tool that built the product and as a component inside it.

## 1. Features built by Codex

Development followed a spec-driven loop: a feature package was written as a markdown spec with hard constraints and an acceptance checklist, handed to Codex, and the resulting diff was reviewed, tested, and committed with Codex authorship. Run `git log --author="Codex"` in this repo to see exactly what the model contributed.

### Overlay ergonomics package (commit `342d843`)

Codex CLI v0.145.0-alpha.18, model `gpt-5.6-sol`, session `019f80ff-e5e2-73b2-9b5e-1a896ab72461`. From a single spec, Codex implemented across 7 files (293 insertions), matching the existing vanilla-JS codebase style with no new dependencies:

- **Global clipboard-pin hotkey** — `Ctrl+Shift+H` registered in the Electron main process; clipboard text crosses to the overlay renderer over a new IPC channel (with sender validation Codex added unprompted); URLs are auto-routed to the pin's source field; a system notification confirms capture without opening the panel.
- **Pin review mode** — a one-at-a-time recall flow (show name, reveal content, "Got it"/"Keep reviewing") that turns pin status into an actual learning loop.
- **Next Up ergonomics** — `addedAt` timestamps with age chips, "Do first" reordering, and a 5-second Undo on Done implemented as a backward-compatible extension of the existing toast helper.

All acceptance criteria passed on the first run: `npm run check`, the full test suite, and legacy-data compatibility.

### Bee mascot, light mode, and annotation preview (commit `f311e81`)

Built in an interactive Codex app session (gpt-5.6-sol): the draggable bee Thread handle with snap positioning and idle expressions, the full light-mode theme for the workspace, the official logo integration, and a browser-based annotation preview system (`npm run preview`) that loads the production renderer with safe representative data for design review.

<!-- TODO(Emilio): add your /feedback Codex session ID here — the session where the majority of core functionality was built. -->

## 2. Codex inside the product: Codex Dock

HEX doesn't just use Codex as a build tool — it ships with Codex embedded via the official `@openai/codex-sdk`:

- Each HEX thread connects to a **persistent Codex session** (thread IDs saved and resumed across app restarts).
- Runs are **scoped to the thread's folder** with explicit read-only or write-in-folder permission, chosen per thread and never escalated automatically.
- The SDK runs in the **Electron main process only** — no credentials or Codex access exposed to the renderer.
- HEX packages the thread's working context (title, objective, notes, pins, sources, connected files, unfinished work) so GPT-5.6 starts every instruction already situated.

## 3. Where Codex accelerated the workflow

- **Spec to working multi-file feature in one pass** — the overlay package touched main process, preload bridge, renderer, styles, and a second renderer's data normalization, coherently and in-style, in a single autonomous session.
- **Constraint adherence** — hard rules in the specs (no new dependencies, saved-data compatibility, files it must not touch) were respected, which made review fast.
- **Receipts** — Codex's contributions are verifiable: the attributed commits carry CLI session IDs, and full session transcripts exist in the local Codex session store.
