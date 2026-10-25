# 0001 Product direction

**Status:** Approved · 2026-10-25

The desktop app (Tauri) is the end goal. The current web app on Cloudflare is the foundation and keeps being built on. No rewrite.

**Reason:** the codex pipeline, R2 delta sync, Pulse, and the schema guards took a lot of work and run in production. The Tauri shell today is a scaffold (`src-tauri/src` is about 20 lines), so desktop features such as the EE.log parser are future work on top of this base.

**Consequence:** new work must keep `src/core/` free of React, Dexie, and fetch so it can move into the desktop build unchanged.
