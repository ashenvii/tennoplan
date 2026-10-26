# Handoff

Overwrite this file at the end of every session. Keep it under one screen. Everything here was true on the date below; check it against `git` and the code before relying on it.

**Updated:** 2026-10-26 · **Branch:** `Development`. The bug-fix work below is the commit that follows `9a20c79` (the PE+ safety fix), not pushed. `main` is at `c97c04d`.

## This session
Fixed the three open bugs locally. Nothing pushed or deployed; #6, #7 and #8 stay open on GitHub.
- **#8 icons:** browser `fetch()` to `cdn.warframestat.us` is blocked by CORS (the CDN answers with a 301 that has no `Access-Control-Allow-Origin`), so `iconBlobCache` fell back to the placeholder. In the browser it now loads the CDN URL directly, verified with an `Image` probe, through the existing 15-slot queue. Tauri is unchanged (blob + Cache API). The browser cannot keep a local icon cache for the CDN; that needs the desktop app. Files: `iconBlobCache.ts`, `nativeFetch.ts` (`errorName`), `startupIconSync.ts`.
- **#6 mods:** the browser no longer dedupes by display name. `src/lib/mods/dedupeMods.ts` keeps every `uniqueName` and collapses only records identical in every other field. The real list went from 1,546 to 1,787 mods; Serration shows its Rank 3, 5 and 10 tiers.
- **#7 tokens:** the codex build fills `|COUNT|` in Nightwave challenge text from PE+ `ExportChallenges.requiredCount` (158 of 170 resolve; 12 weekly-hard challenges are not in PE+). Everything else renders as a readable label, for example `(damage)%`, through `src/lib/text/descriptionTokens.ts`, used by all six views. Warframe passive values have no source in our data, so they stay labelled, not filled.

## Verified
- `node --test scripts/*.test.mjs`: 33 of 33 pass. `npx tsc -b`, worker `npx tsc --noEmit`, `npm run build` and `git diff --check` pass.
- `build-codex` with `CODEX_REQUIRE_PEPLUS=1`: exits 0, 45 known and 0 unknown glyph codes, 212 of 224 challenge rows free of `|COUNT|`.
- Real app (dev server on 5174 against the live worker): mod card art, Pendulum reward tiles, the three Serration tiers, Excalibur and Sirius & Orion passives, a challenge entry.

## Open
- The `|COUNT|` fix only reaches production after a codex rebuild from `main`. Merging to `main` deploys, so it is the author's call.
- Passive values are still unknown. A source would have to be the wiki (the CI wiki fetch currently gets HTTP 403) or hand-kept data.
- `npm run lint` fails: ESLint finds no config. Not looked at.
- The stale `web` worker (`web.tennoplan.workers.dev`) is still deployed.

## Next
1. Push `Development` when reviewed. Merging to `main` deploys and rebuilds the codex, so ask first.
2. Redesign page by page, Celestial Pendulum first (see `docs/roadmap.md`).
