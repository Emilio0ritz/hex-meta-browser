(function configureHexPreview() {
  const now = "2026-07-20T18:30:00.000Z";
  const workspaceRoot = "C:\\Users\\You\\Documents\\HEX";
  const workspacePath = `${workspaceRoot}\\video-compression-study`;

  window.__HEX_PREVIEW__ = {
    enabled: true,
    storageKey: "emilio.browserBase.annotationPreview.v1",
    folderPath: workspacePath,
    filesByThread: {
      thread_video_compression: [
        {
          name: "compression-notes.md",
          extension: "md",
          size: 6840,
          modifiedAt: "2026-07-20T18:18:00.000Z",
          path: `${workspacePath}\\compression-notes.md`
        },
        {
          name: "codec-comparison.pdf",
          extension: "pdf",
          size: 1482300,
          modifiedAt: "2026-07-20T17:42:00.000Z",
          path: `${workspacePath}\\codec-comparison.pdf`
        }
      ]
    },
    state: {
      version: 3,
      activeThreadId: "thread_video_compression",
      threads: {
        thread_video_compression: {
          id: "thread_video_compression",
          title: "Video Compression Study",
          mode: "research",
          notes: "Goal: understand how codecs reduce file size without losing the detail viewers notice.\n\n- Compare constant and variable bitrate\n- Capture a practical H.264 vs AV1 example",
          queue: [
            { text: "Compare H.264 and AV1 at the same visual quality", done: false, addedAt: now },
            { text: "Find one clear variable bitrate example", done: false, addedAt: now },
            { text: "Define codec, container, and bitrate", done: true, addedAt: now }
          ],
          loops: [],
          links: [
            { name: "YouTube Creator Academy", url: "https://www.youtube.com/creators/" },
            { name: "FFmpeg Documentation", url: "https://ffmpeg.org/documentation.html" },
            { name: "Google", url: "https://www.google.com" }
          ],
          pins: [
            {
              id: "pin_bitrate",
              name: "Bitrate",
              type: "definition",
              content: "The amount of data used to represent each second of audio or video, usually measured in bits per second.",
              source: "https://en.wikipedia.org/wiki/Bit_rate",
              status: "understood",
              createdAt: now,
              updatedAt: now
            },
            {
              id: "pin_codec",
              name: "Codec",
              type: "definition",
              content: "A system that encodes media for storage or transmission and decodes it for playback.",
              source: "https://en.wikipedia.org/wiki/Codec",
              status: "review",
              createdAt: now,
              updatedAt: now
            },
            {
              id: "pin_lossy",
              name: "Lossy compression",
              type: "definition",
              content: "Compression that permanently removes selected information to produce a smaller file.",
              source: "https://en.wikipedia.org/wiki/Lossy_compression",
              status: "review",
              createdAt: now,
              updatedAt: now
            }
          ],
          stickyNotion: {
            name: "Video compression reference",
            url: "https://en.wikipedia.org/wiki/Video_coding_format"
          },
          codex: {
            threadId: "preview-session-7f1c2a9b",
            workspacePath,
            permissionMode: "read-only",
            status: "completed",
            statusMessage: "Preview state: the connected folder is read only.",
            lastRunAt: "2026-07-20T18:22:00.000Z",
            lastResponsePreview: "The notes already cover the core vocabulary. The strongest next step is a small H.264 versus AV1 comparison using the same source clip and target visual quality."
          },
          researchTrail: [
            {
              title: "Video coding format",
              url: "https://en.wikipedia.org/wiki/Video_coding_format",
              source: "pinned reference",
              openedAt: "2026-07-20T18:12:00.000Z",
              time: "2:12 PM"
            },
            {
              title: "FFmpeg Documentation",
              url: "https://ffmpeg.org/documentation.html",
              source: "saved link",
              openedAt: "2026-07-20T17:48:00.000Z",
              time: "1:48 PM"
            }
          ],
          activity: [
            { text: "Codex completed a Thread request", at: "2026-07-20T18:22:00.000Z", time: "2:22 PM" },
            { text: "Added 2 files", at: "2026-07-20T18:18:00.000Z", time: "2:18 PM" },
            { text: "Created Pin: Codec", at: "2026-07-20T18:05:00.000Z", time: "2:05 PM" }
          ],
          folderName: "video-compression-study",
          archived: false,
          createdAt: "2026-07-19T14:00:00.000Z",
          updatedAt: now
        },
        thread_build_week: {
          id: "thread_build_week",
          title: "HEX Build Week Submission",
          mode: "deepWork",
          notes: "Keep the demo focused on continuity: capture, organize, resume, and hand off.",
          queue: [{ text: "Rehearse the five-minute demo", done: false, addedAt: now }],
          loops: [],
          links: [{ name: "OpenAI", url: "https://openai.com" }],
          pins: [],
          stickyNotion: null,
          researchTrail: [],
          activity: [],
          folderName: "hex-build-week-submission",
          archived: false,
          createdAt: "2026-07-18T14:00:00.000Z",
          updatedAt: "2026-07-20T16:00:00.000Z"
        }
      },
      global: {
        engine: "google",
        quickLinks: [],
        activity: [],
        dataRoot: workspaceRoot,
        onboarded: true,
        threadLinksMigrated: true
      }
    }
  };
})();
