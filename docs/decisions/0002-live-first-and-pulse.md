# 0002 Live-first contract and Pulse

**Status:** Approved · shipped 2026-06-12

**Contract:** static data (the codex, built in CI) holds the nouns. Live data (worldstate) holds the verbs and the clock. They join on `uniqueName`, always resolved in CI, never by display name in the browser. Bounties rotate on their own timer, not the planet day/night cycle.

**Pulse:**
- The raw worldstate blob changes every cron tick, so the worker hashes only unpredictable fields into a `semanticEtag` (`cloudflare-worker/src/worldstate/pulse.ts`).
- The client polls the small `GET /v1/pulse` every 5 minutes and fetches the full `/v1/worldstate` only when the etag moves. Manual refresh forces a full fetch. If pulse fails, it falls back to the full fetch.
- The diff engine emits spawn events only (fissures, alerts, invasions, bounty rotations, sortie/archon/baro/nightwave changes), never expiries. The client holds expiry times.
- Fixed-period cycles (Vallis, Cambion, Zariman, Duviri) are computed on the client from an anchor plus exact durations in `src/core/services/cycleService.ts`. Keep those durations in sync with the worker `fallback.ts`. A drift guard re-anchors clients if DE changes a schedule.
- Pulse metadata rides in `worldstate:metadata`, so it adds no KV writes.
- The Cache API wrapper on `/v1/pulse` and `/v1/worldstate` does nothing on `*.workers.dev`. It matters only once the worker has a custom domain. Required before real multi-user scale.

**Budget:** Cloudflare Free allows 1,000 KV writes a day for the account. The worldstate cron (`*/5`) uses about 576, the codex CI about 12. Do not tighten the cron without checking.
