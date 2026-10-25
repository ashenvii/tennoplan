# 0003 Codex built in CI, shipped as R2 chunks

**Status:** Approved · chunks and delta sync shipped 2026-06-13

**Where it runs:** parsing about 7 MB across the WFCD endpoints exceeds the Workers Free CPU limit, so `.github/workflows/build-codex.yml` runs `cloudflare-worker/scripts/build-codex.ts` and uploads the result. The worker only serves it.

**Shape:**
- One chunk per item category at `chunks/<Category>-<semanticHash>.json` in the R2 bucket `tennoplan-codex`. Volatile fields are stripped, so identical content keeps the same key and is served immutable.
- A manifest at KV `codex:manifest` lists the chunks. The worker serves `GET /v1/codex/manifest` and `GET /v1/codex/chunk/<key>` (keys are validated against the category list).
- The client diffs chunk hashes against the stored map and downloads only changed categories (`StaticDataService.performDeltaSync`). One changed category was about 30 KB against the 17 MB monolith.
- The monolith `GET /v1/codex` is the permanent first-sync and fallback path. Do not retire it.
- Public Export Plus is installed fresh (`@latest`, not pinned) on every build so the data tracks game patches. If the install fails the build falls back to WFCD only.
- The skip-unchanged gate still publishes chunks if `codex:manifest` is missing.

**Gates:** `schemaVersion` and `minimumClientVersion` in the manifest force the client to fall back. `CODEX_SCHEMA_VERSION` (`src/services/StaticDataService.ts`) wipes local data on change. `peplusSchemaGuard.ts` catches silent upstream field drift.

**Gotchas:** after a rebuild the manifest can lag a few minutes (KV eventual consistency). Check the monolith or the chunk key from the run log. Scheduled GitHub workflows on a public repo are disabled after 60 days without repository activity. This happened in August 2026, see `HANDOFF.md`.
