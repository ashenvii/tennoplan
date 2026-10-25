# Tennoplan Data Architecture Reference

A complete map of how data flows from external sources → Cloudflare backend → Tennoplan frontend → local storage.

*Last fully verified: 2026-06-03. Corrected 2026-10-25 for three later changes: the live poll is now a 5 minute pulse-gated poll (`docs/decisions/0002`), Dexie is at v9, and the `items` table was dropped (`docs/decisions/0004`). The drop-data section and its flow steps were not re-verified and still describe the pre-v9 behaviour.*

---

## Overview

Tennoplan uses a **multi-layer, offline-first** data strategy built on one core idea:

> **Static data holds the *nouns* (the item codex). Live data holds the *verbs* and the *clock* (world cycles, fissures, bounty rotation). The two are joined by a stable `uniqueName` key — always resolved against the static codex, never by display name.**

Static data is heavy and changes rarely, so it is built **once in CI** and cached locally in IndexedDB. Live data is light and changes constantly, so it is polled from a Cloudflare Worker every minute on the client. The UI renders instantly from local cache; only the small, fast-changing slice needs the network.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        External Data Sources                         │
├─────────────────────────────────────────────────────────────────────┤
│  Live worldstate:                                                    │
│   • api.warframe.com/cdn/worldState.php  (official DE, raw)          │
│   • content.warframe.com/.../worldState.php (official mirror)        │
│   • api.warframestat.us/pc/              (community, pre-parsed)      │
│                                                                       │
│  Static codex (WFCD):                                                │
│   • api.warframestat.us/{mods,warframes,weapons}?only=…              │
│   • raw.githubusercontent.com/WFCD/warframe-items  (fallback + the   │
│     primary for sentinels/pets/relics/resources/gear/arcanes/misc)   │
│   • drops.warframestat.us/data/all.json  (drop tables)               │
│   • wiki.warframe.com Lua module         (warframe passive prose)    │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│              Build & Edge layer (two separate paths)                 │
├─────────────────────────────────────────────────────────────────────┤
│  GitHub Actions — Codex build (every 6h)                            │
│   • Runs cloudflare-worker/scripts/build-codex.ts                   │
│   • fetch → parse → normalize → build → enrich → token-scan         │
│   • PUTs the blob to KV: codex:current / codex:previous / :metadata │
│                                                                       │
│  Cloudflare Worker "app" — runtime API (cron */5)                   │
│   • Cron updates worldstate: official → mirror → warframestat →     │
│     cycle-math projection; writes worldstate:current/previous/meta  │
│   • Serves GET /v1/worldstate, GET /v1/codex, GET /v1/health        │
│   • /v1/codex just streams the pre-built blob (no parsing at edge)  │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│                  Tennoplan Frontend (React + Vite)                   │
├─────────────────────────────────────────────────────────────────────┤
│  • WorldstateSync.ts   (live worldstate polling engine, V2)         │
│  • useWorldstate.ts    (shared useLiveQuery subscriber)             │
│  • StaticDataService.ts(codex fetch → tennoplanItems)               │
│  • DropDataService.ts  (download-once drop tables, manual)          │
│  • Zustand stores (heartbeat, navigation, density)                  │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│                     Client Local Storage (Dexie v9)                  │
├─────────────────────────────────────────────────────────────────────┤
│  • worldstate      (ParsedWorldstate snapshot: current | previous)  │
│  • syncMetadata    (per-dataset sync state: worldstate | codex)     │
│  • tennoplanItems  (codex catalogue, ~8k items)                     │
│  • dropLocations / dataSyncState (items table dropped in v9)    │
│  • cache           (ephemeral, TTL-indexed) + others (see schema)   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Data Flows by Category

### 1. Live Worldstate (cycles, fissures, invasions, alerts, bounties)

**Client engine:** `src/services/WorldstateSync.ts` (singleton) + `src/hooks/useWorldstate.ts` (shared subscriber) + `src/adapters/storage/worldstateStore.ts` (Dexie I/O).
**Source:** the Tennoplan Cloudflare Worker only — `${VITE_WORLDSTATE_WORKER_URL}/v1/worldstate`. There is **no direct warframestat.us fallback in the browser**; all upstream fallback logic lives in the Worker.
**Client freshness:** 5 minute poll of the small `/v1/pulse` head; the full `/v1/worldstate` is fetched only when its `semanticEtag` changes.
**Storage:** Dexie `worldstate` table (snapshot) + `syncMetadata` table (sync state).

#### Worker side (cron `*/5 * * * *`, every 5 min)

1. Fetch the official DE endpoint `api.warframe.com/cdn/worldState.php`.
2. On failure → the official mirror `content.warframe.com/.../worldState.php`.
3. On failure → community `api.warframestat.us/pc/` (flaky: intermittently returns an empty 200).
4. Last resort → **cycle-math projection** (compute cycle states from known periods so timers keep running through a total upstream outage).
5. Official/mirror payloads are run through `warframe-worldstate-parser` and normalized to the `ParsedWorldstate` shape (Unix-ms timestamps).
6. Result is written to KV (`worldstate:current`, `worldstate:previous`, `worldstate:metadata`) with a **24-hour TTL** — long TTL so the last-good snapshot survives outages rather than evaporating and 503-ing the app.
7. Responses carry an `X-Data-Source` header indicating which tier served the data.

#### Client side (`WorldstateSync`)

- `WorldstateSync.init()` (called once in `AppShell`) → immediate sync, then a 5 minute pulse-gated poll loop.
- Conditional GET: sends `If-None-Match` with the stored ETag.
  - **304 Not Modified** → keep cached snapshot, mark heartbeat `live`.
  - **200 OK** → write new `ParsedWorldstate` to `db.worldstate`, update `db.syncMetadata`.
- Tab hidden → poll paused; tab re-focused → immediate resync + restart loop.
- `requestPassiveSync()` — a 60 s-cooldown nudge safe to call from render loops, fired when a tracked event expires (a fissure hits 00:00, a cycle flips) so the UI doesn't wait for the next poll tick.
- `useWorldstate()` is the single read surface: a `useLiveQuery` over `worldstate` + `syncMetadata`, returning `{ data, lastSync, ageMs, isStale, source, quality, errorCount, forceRefetch, requestPassiveSync }`. Feature hooks (`useWorldCycles`, `useSyndicateMissions`, `useDuviriCircuit`, …) subscribe to it and add only their per-feature derivation.

#### Config

- `VITE_WORLDSTATE_WORKER_URL` — **required**. If unset, `WorldstateSync.init()` logs an error and no-ops (every tab renders empty).
- `VITE_USE_MOCK_DATA=true` — load mock worldstate from fixtures for dev/testing.

---

### 2. Static Codex (the canonical item catalogue)

The Codex is the canonical detail view for every item, mod, resource, and reward; every other surface is a window into it. It is built from a single pre-computed blob.

**Why the build runs in CI, not the Worker:** parsing several MB across ~11 WFCD endpoints exceeds the Cloudflare Workers free-plan budget of **10 ms CPU per invocation**. GitHub Actions has no such limit, so the heavy work happens there and the Worker only ever serves the finished blob.

#### Build (GitHub Actions — `.github/workflows/build-codex.yml`, cron `12 */6 * * *`, every 6h)

Runs `cloudflare-worker/scripts/build-codex.ts`, whose pipeline (`cloudflare-worker/src/codex/*`) is:

```
fetcher → parser → normalizer → builder → enricher → tokenScanner
```

- **fetcher** — pulls ~9 item categories (mods, warframes, weapons, sentinels, pets, relics, resources, gear, arcanes, misc) plus drop tables. Primary source is `api.warframestat.us` with `?only=` field-filtering to keep payloads small; `raw.githubusercontent.com/WFCD/warframe-items` is the fallback (and the *primary* for the categories the API doesn't expose). Runs 4 fetches concurrently (Workers cap at 6 subrequests).
- **parser / normalizer** — coerce each source shape into the internal `TennoplanItem` model.
- **builder** — assemble the catalogue keyed by `uniqueName`.
- **enricher** — fold in drops (inverted from location-keyed to per-item), warframe passive prose from the Wiki Lua module, etc.
- **tokenScanner** — resolve leftover `|TOKEN|` placeholders.

The resulting blob is PUT to KV: `codex:current`, `codex:previous`, `codex:metadata` via the Cloudflare API. Manual rebuilds: GitHub → Actions → "Build & Publish Codex" → Run workflow.

#### Serve (Worker)

`GET /v1/codex` (`cloudflare-worker/src/api/handlers/codex.ts`) streams the pre-built blob straight from KV. No parsing at the edge.

#### Client (`src/services/StaticDataService.ts`)

Fetches `/v1/codex`, stores rows in Dexie `tennoplanItems` (PK `uniqueName`, indexed on `category` / `masteryRank` / `vaulted`), and exposes `findItems()` / lookup helpers used by the Codex pages and quick-look. Sync state is tracked in `syncMetadata` under `id: 'codex'`.

---

### 3. Drop Data (legacy download-once path)

**Service:** `src/adapters/api/DropDataService.ts`.
**Source:** `drops.warframestat.us/data/all.json`, fallback `raw.githubusercontent.com/WFCD/warframe-drop-data`.
**Model:** download-once. Data only enters Dexie when the user clicks "Refresh" (or accepts the stale banner on launch) and only leaves on "Clear Data".
**Storage:** Dexie `dropLocations` + `dataSyncState` (the `items` table was dropped in v9).

> Note: this predates the codex pipeline and still feeds the legacy `items` / `dropLocations` tables. It coexists with `tennoplanItems` during the ongoing migration of UI consumers onto the codex. Drop *tables* are also folded into the codex blob by the CI enricher.

#### Flow

1. `fetchAndSync({ onProgress })` — fetch with ETag conditional GET; exponential backoff (3 attempts: 1 s, 2 s, 3 s); fall back to the GitHub raw mirror.
2. `normaliseDropPayload()` → `DropLocation[]`; load baked `items-map.json` → `StoredItem[]` with **pre-resolved icon URLs**.
3. Transactional Dexie write (items + dropLocations + dataSyncState, all-or-nothing). On failure, existing rows are preserved — never overwritten with an empty result.
4. `checkForStaleData()` — lightweight timestamp read; banner appears past **14 days** old.
5. `clearAllData()` — Settings button; wipes the three tables.

`VITE_USE_MOCK_DATA=true` loads `MOCK_DROP_LOCATIONS` + `MOCK_ITEMS` from `src/lib/mockdata/fixtures.ts` instead of fetching.

---

### 4. User Inventory (EE.log parser) — *not yet implemented*

Planned Tauri + Rust work: read the local `EE.log`, extract owned items, and persist to Dexie so progression surfaces (Ascension Registry) can reflect ownership. No code path exists yet.

---

## Dexie Schema (v8)

Located: `src/adapters/storage/db.ts`. Migrations are additive — each version repeats prior store definitions so tables carry forward without data loss.

| Table | Primary key | Purpose |
|-------|-------------|---------|
| `worldstate` | `key` (`current` \| `previous`) | Full `ParsedWorldstate` snapshot from `/v1/worldstate` |
| `syncMetadata` | `id` (`worldstate` \| `codex`) | Per-dataset sync state: lastSync, etag, version, source, quality, errorCount |
| `tennoplanItems` | `uniqueName` | Codex catalogue (~8k items); indexed `category`, `masteryRank`, `vaulted` |
| `items` | n/a | **Dropped in Dexie v9.** Items resolve through the codex (`docs/decisions/0004`) |
| `dropLocations` | `locationKey` | Normalized drop locations; compound indexes for Celestial Pendulum facets |
| `dataSyncState` | `id` (`items` \| `dropLocations`) | Legacy drop-data sync metadata |
| `cache` | `key` | Ephemeral data, `expiresAt`-indexed (per-feature cache rows, ETag/source tags) |
| `assetMeta` | `uniqueName` | Asset Sync Engine metadata (LRU eviction fields) |
| `syncErrors` | `++id` | Failed/404 asset-download log |
| `progression` | `++id` | Ascension Registry — one row per masterable item |
| `itemStates` | `uniqueName` | Sparse user-owned flags (only touched items) |
| `userMarks` | `++id` | User-created marks/notes |
| `settings` | `key` | User preferences |
| `eventLog` | `++id` | Cross-cutting app event log (~500-entry rolling buffer; Settings → Event Log) |

---

## Sync State, Heartbeat & Data Quality

`WorldstateSync` writes a `SyncMetadata` row and drives `useHeartbeatStore`, whose status reflects data freshness:

| Status | Meaning |
|--------|---------|
| **live** | Fresh data confirmed (200 or 304), within the staleness threshold |
| **stale** | Snapshot older than 30 min — likely served via the Worker's cycle-math projection |
| **cached** | Network failed; serving last-good Dexie snapshot |
| **offline** | Network failed *and* no local snapshot exists |

The 30-minute stale threshold mirrors the Worker's `fallbackStalenessWarningMinutes`. The Worker also grades each response via `X-Data-Source`, which the client maps to a coarse quality: official/warframestat/enriched → `high`, cached → `medium`, fallback (projection) → `low`.

---

## ETag & Conditional GET

Avoids re-downloading/re-parsing large payloads when nothing changed.

1. Client sends `If-None-Match: <etag>`.
2. Server compares against the stored ETag → **304** (reuse cache) or **200** + new ETag.
3. Client updates its stored ETag only on a 200.

ETag storage: worldstate in `db.syncMetadata.etag`; legacy drop data in `db.dataSyncState`; Worker copies in KV metadata.

---

## KV Write Budget (Cloudflare Free plan)

Free Workers = **1,000 KV writes/day, account-wide.** Current usage:

- Worldstate cron `*/5` → ~576 writes/day.
- Codex CI every 6h → ~12 writes/day.

Total ≈ 590/day, leaving headroom for manual ops. Don't tighten the worldstate cron without re-checking this budget.

---

## Reference: API Contract Summary

| Endpoint | Method | Response | Purpose |
|----------|--------|----------|---------|
| `${WORKER}/v1/worldstate` | GET | `ParsedWorldstate` (Unix-ms) | Live events; `X-Data-Source` header, ETag |
| `${WORKER}/v1/codex` | GET | Pre-built codex blob | Static catalogue (served from KV) |
| `${WORKER}/v1/health` | GET | Health JSON | Liveness / source check |
| `api.warframe.com/cdn/worldState.php` (+ content.warframe.com mirror) | GET | Raw DE worldstate | Worker primary (needs parser) |
| `api.warframestat.us/pc/` | GET | Pre-parsed worldstate | Worker tertiary fallback |
| `drops.warframestat.us/data/all.json` | GET | WFCD drop tables | Codex enrichment + legacy drop sync |
| `raw.githubusercontent.com/WFCD/warframe-items` | GET | Per-category item JSON | Codex source/fallback |

---

## Summary — the whole flow in plain English

1. **Static (CI, every 6h):** GitHub Actions builds the codex blob from WFCD sources and PUTs it to Cloudflare KV. The Worker just serves it at `/v1/codex`. The client caches it once into `tennoplanItems` and treats the Codex as the canonical detail view.
2. **Live (Worker cron, every 5 min):** the Worker refreshes worldstate from the official DE API (with mirror, community, and cycle-math fallbacks) into KV.
3. **Client (every 5 min):** `WorldstateSync` polls `/v1/pulse` and fetches `/v1/worldstate` only when the etag moves, writes the `ParsedWorldstate` snapshot to Dexie, and updates the heartbeat. `useWorldstate` fans it out to every feature hook.
4. **Join key:** everything is wired together by `uniqueName`, resolved against the static codex — never by display name.
5. **Offline:** the UI always reads from local Dexie cache; network failures degrade gracefully to `cached`/`stale`/`offline` rather than blanking the app.
6. **Future:** a Tauri + Rust `EE.log` parser will add user inventory, persisted the same way.
