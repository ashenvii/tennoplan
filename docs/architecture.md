# Architecture

How data gets from Warframe's sources to the screen. The code is the authority. This file was checked against it on 2026-10-25 (routes, Dexie schema, wrangler config, workflows). Why each piece exists is in [decisions/](decisions/).

## The one idea

Static data holds the nouns, live data holds the verbs and the clock. They join on `uniqueName`, resolved against the codex, never by display name (names collide).

- **Static (the codex):** items, mods, weapons, drops. Heavy, changes with patches. Built in CI, cached locally.
- **Live (worldstate):** cycles, fissures, invasions, bounty rotation. Light, changes constantly. Polled from the worker.

The UI always reads from local storage. The network only refreshes it.

## Pieces

| Piece | Where | Job |
|---|---|---|
| Frontend | `src/`, deployed as worker `tennoplan` | React 19 + Vite app |
| API worker | `cloudflare-worker/`, deployed as worker `app` | Serves `/v1/*`, runs the worldstate cron (`*/5`) |
| Codex build | `.github/workflows/build-codex.yml` | Builds the codex every 6 hours and uploads it |
| Desktop shell | `src-tauri/` | Scaffold only, no logic yet ([0001](decisions/0001-product-direction.md)) |

Storage on Cloudflare: KV namespace `TENNOPLAN_KV` (worldstate, codex manifest, monolith) and R2 bucket `tennoplan-codex` (codex chunks).

## API (`cloudflare-worker/src/api/routes.ts`)

| Route | Returns |
|---|---|
| `/v1/health` | Liveness and source check |
| `/v1/pulse` | Small head with a semantic etag, polled by the client |
| `/v1/worldstate` | Full parsed worldstate, fetched only when the pulse etag moves |
| `/v1/codex/manifest` | Chunk list with hashes |
| `/v1/codex/chunk/<key>` | One codex category chunk from R2 |
| `/v1/codex` | The whole codex as one blob. Permanent fallback and first-sync path |

## Live path

1. The worker cron (every 5 minutes) fetches worldstate: official DE endpoint, then the official mirror, then `api.warframestat.us`, then cycle math as a last resort. The result is written to KV with a 24 hour TTL so the last good snapshot survives outages.
2. The client (`src/services/WorldstateSync.ts`) polls `/v1/pulse` every 5 minutes and pulls `/v1/worldstate` only when the etag changed. Hidden tab pauses the poll.
3. The snapshot lands in Dexie, and `src/hooks/useWorldstate.ts` fans it out to feature hooks.
4. Fixed-period cycles (Vallis, Cambion, Zariman, Duviri) are computed on the client from an anchor (`src/core/services/cycleService.ts`). Keep those durations in sync with the worker `fallback.ts`.

Details and the reasoning: [0002](decisions/0002-live-first-and-pulse.md).

## Static path

1. GitHub Actions runs `cloudflare-worker/scripts/build-codex.ts`: fetch, parse, normalize, build, enrich, token scan. Public Export Plus is the primary source, WFCD fills gaps and supplies drops, `fieldNotes.ts` adds Cephalon's Notes.
2. The result is split into one chunk per category in R2, with a manifest in KV. The monolith is uploaded too.
3. The client (`src/services/StaticDataService.ts`) compares chunk hashes and downloads only the categories that changed, into the Dexie `tennoplanItems` table.
4. Gates that fail the build instead of shipping bad data: `peplusSchemaGuard.ts`, the token scan, schema and minimum client version in the manifest.

Details: [0003](decisions/0003-codex-ci-and-r2-chunks.md), [0004](decisions/0004-codex-first-item-resolution.md). Field-level coverage of every source: [data-sources.md](data-sources.md).

## Local storage (Dexie, schema v9, `src/adapters/storage/db.ts`)

| Table | Holds |
|---|---|
| `worldstate` | Current and previous parsed snapshot |
| `syncMetadata` | Per-dataset sync state (worldstate, codex): last sync, etag, source, quality |
| `tennoplanItems` | The codex catalogue, keyed by `uniqueName` |
| `dropLocations`, `dataSyncState` | Legacy drop data, still feeds the bounty board |
| `cache`, `assetMeta`, `syncErrors` | Ephemeral cache and asset sync bookkeeping |
| `progression`, `itemStates`, `userMarks`, `settings`, `eventLog` | User state and app logs |

Migrations only add. The `items` table was dropped in v9.

## Freshness states

`WorldstateSync` drives a heartbeat store with four states: `live` (fresh 200 or 304), `stale` (older than 30 minutes, probably the cycle-math fallback), `cached` (network failed, last snapshot served), `offline` (network failed, nothing stored).

## Limits to remember

- Cloudflare Free allows 1,000 KV writes a day for the whole account. The cron uses about 576 and the codex build about 12. Do not tighten the cron without checking.
- A Workers Free request has about 10 ms of CPU, which is why the codex is built in CI and the worker only serves it.
- The Cache API wrapper on `/v1/pulse` and `/v1/worldstate` does nothing on `*.workers.dev`. It only matters with a custom domain.
- `VITE_WORLDSTATE_WORKER_URL` is inlined at build time. `src/lib/config/workerBase.ts` holds a production default so an empty value cannot brick a build.

## Not built yet

EE.log capture and inventory (Tauri), market prices, on-demand asset redesign, user sharing (D1). See [roadmap.md](roadmap.md) and [0005](decisions/0005-six-systems-target.md).
