# Tennoplan

**An offline-first Warframe companion desktop app** - a single hub for tracking world cycles, bounties, drop tables, and progression, built to stay fast and fully usable without a network connection.

Built with **Tauri 2 · React 19 · TypeScript · Vite · Cloudflare Workers**.

[![wakatime](https://wakatime.com/badge/user/aacb495a-a08d-4a50-8b55-e145d3a59fd7/project/tennoplan.svg)](https://wakatime.com/@aacb495a-a08d-4a50-8b55-e145d3a59fd7)

<!-- Screenshots: add 2–3 captures of the Codex and Celestial Pendulum tabs here before sharing. -->

---

## What it does

Warframe's in-game information is scattered across world timers, rotating bounties, sprawling drop tables, and a huge item codex. Tennoplan pulls all of it into one desktop surface:

- **Codex** - the canonical detail view for every item, mod, resource, and reward. Built from a regularly-rebuilt data blob; every other screen is a window into it.
- **Celestial Pendulum** - a live "observatory" of world cycles (Cetus, Fortuna, Deimos, Zariman, Duviri) and their rotating bounties, in a master–detail layout. World day/night clocks and bounty rotation are driven independently by live worldstate.
- **Void Reliquaries · Solar Rail Feed · Ascension Registry · Dailies & Weeklies** - additional tracking surfaces (live fissures, invasions/alerts/events, mastery progression, and a daily/weekly checklist). Several of these are mid-rebuild on the shared live data backbone.

> Status: active development. The Codex and Celestial Pendulum tabs are the most complete; other tabs are being rebuilt on the same foundation.

---

## Architecture

Tennoplan follows a **hexagonal (clean) architecture**. The core domain has zero dependencies on React, the storage layer, or `fetch` - frameworks live only at the edges.

```
src/core/domain/       Pure TypeScript types & entities
src/core/services/     Pure business logic (no I/O)
src/adapters/api/      fetch + Dexie (IndexedDB) caching
src/adapters/storage/  Dexie schema
src/features/<tab>/    One vertical slice per tab (UI + hooks)
src/store/             Zustand stores (navigation, density, …)
src/components/layout/ AppShell, sidebar, header
src/tokens/            Design tokens (color, spacing, type, shadow)
cloudflare-worker/     Edge API: /v1 worldstate + codex, cron updater
```

### Data model: static nouns, live verbs

A core principle keeps the app correct *and* offline-capable:

- **Static data** (the item/codex "nouns") is heavy and changes rarely - it's built once and cached locally in IndexedDB (download-once).
- **Live data** (the "verbs" and the clock - resets, fissures, bounty rotation) is light and changes constantly - it's polled from a Cloudflare Worker.
- The two are joined by a stable `uniqueName` key, **always resolved against the static codex - never by display name**, which collides.

This split means the UI renders instantly from local cache and only the small, fast-changing slice needs the network.

### The codex pipeline runs in CI, not the worker

Parsing several MB across multiple community data endpoints exceeds the Cloudflare Workers free-tier CPU budget per request. So the parse → build → enrich step runs in **GitHub Actions** on a schedule, and the resulting blob is pushed to Cloudflare KV. The worker stays trivial: it just serves the pre-built blob. This keeps the runtime cheap and well within free-tier limits.

---

## Tech stack

| Layer | Choice |
|-------|--------|
| Desktop shell | Tauri 2 (Rust) |
| UI | React 19 + TypeScript, Vite |
| Styling | Tailwind CSS v4 + CSS Modules, design-token system |
| State | Zustand, TanStack Query |
| Local storage | Dexie (IndexedDB) |
| Motion | Motion (Framer) |
| Backend | Cloudflare Workers + KV |
| Data build | GitHub Actions (scheduled codex build) |

---

## Getting started

Prerequisites: **Node 20+** and the **Rust toolchain** (for the Tauri desktop build).

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env        # set VITE_WORLDSTATE_WORKER_URL

# Run the web frontend (fastest dev loop)
npm run dev

# Run the full desktop app
npm run tauri:dev

# Type-check + production web build
npm run build

# Build the desktop binary
npm run tauri:build
```

### Backend (optional, for live data)

The frontend talks to a Cloudflare Worker that proxies worldstate and serves the codex blob.

```bash
cd cloudflare-worker
npm install
npm run deploy
```

---

## Project layout

```
src/                  React app (hexagonal core + feature slices)
src-tauri/            Tauri (Rust) desktop shell
cloudflare-worker/    Edge API + scheduled worldstate updater
scripts/              Build/codegen utilities
public/               Static assets (fonts, icons)
docs/                 Architecture, roadmap, data sources, decisions
.impeccable.md        Design-system specification
```

## Documentation

Everything lives in this repo. Start with [docs/architecture.md](docs/architecture.md) for how data flows and [docs/roadmap.md](docs/roadmap.md) for where the project is going. Past decisions and their reasons are in [docs/decisions/](docs/decisions/). Rules for working in the repo are in [CLAUDE.md](CLAUDE.md), and the current task state is in [HANDOFF.md](HANDOFF.md).

---

## Data sources

Tennoplan builds on the Warframe community data ecosystem (warframestat.us, WFCD item data, warframe.market) plus first-party Cloudflare infrastructure for caching and delivery. All static data is cached locally so the app works offline after first sync. Field-level detail is in [docs/data-sources.md](docs/data-sources.md).

---

## License

Personal project. Not affiliated with Digital Extremes. Warframe and related assets are property of Digital Extremes.
