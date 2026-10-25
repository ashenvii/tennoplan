# Handoff

Overwrite this file at the end of every session. Keep it under one screen. Everything here was true on the date below; check it against `git` and the code before relying on it.

**Updated:** 2026-10-25 · **Branch:** `Development`. The cleanup commits (`8bd569d`, `976dfe5`, `18be996`) and the `<OVERGUARD_GAIN>` fix (`c801d42`) are pushed to `origin/Development`. This handoff update is the commit after `c801d42`. `main` is unchanged at `d6257cf` and does not have the fix yet. Remote: `https://github.com/ashenvii/tennoplan.git` (the repo moved from `Gizzy2x/tennoplan`).

## Where the project is
- Last real feature work (2026-06-16): weapon Cephalon's Notes finished (864 notes applied to real codex uniqueNames), plus `fireModes` and melee scalars from Public Export Plus. See `docs/decisions/0006`.
- Waiting on the author: the weapon-card UI rework (card is being moved into the page header). Data layer is done and decoupled from it.
- Deferred by the author: crit/status percentage prose pass, `core/` calc engine, build planner, community submissions.

## Verified on 2026-10-25
- `npx tsc -b` (root): no errors.
- `cd cloudflare-worker && npx tsc --noEmit`: no errors.
- `cd cloudflare-worker && npm run build-codex`: exits 0 on `c801d42`, 864 notes applied, token scan 45 known and 0 unknown. An unknown icon token fails the build with exit 1 (`process.exit(1)` in the token scan); that was the case for `<OVERGUARD_GAIN>` before the fix.
- `npm run build` (root): exits 0 on `c801d42`.
- Live worker `/v1/pulse` answers with a current sync time.
- GitHub "Type-check" workflow (`check.yml`) run `40232846647` on `c801d42`: success, app and worker type-checks both passed.
- No production deployment, workflow re-enable, or Cloudflare worker deletion was done during the cleanup.

## Problems that are still open
- **Codex refresh is still off.** GitHub disabled the scheduled "Build & Publish Codex" workflow (`disabled_inactivity`, last run 2026-08-16; still disabled when checked 2026-10-25). The repo is public, so the 60-day inactivity rule applies. The live codex manifest is dated 2026-08-14. Restoring it needs a production-affecting step that the author must approve.
- **The `<OVERGUARD_GAIN>` fix is not on `main` yet.** It is a flag code in `TENNOICON_FLAG_CODES` (an unfilled value placeholder in Narin's Naraemagi, not a glyph), so the displayed sentence reads "Gain  Overguard" with no number. Until `Development` is merged into `main`, the codex workflow would fail at the token scan if re-enabled. Merging to `main` triggers `deploy.yml` (frontend and API worker), which has not run since 2026-06-16.
- No automated tests exist. Verification is the commands in `CLAUDE.md`.
- The `web` worker (`web.tennoplan.workers.dev`) is a stale frontend copy from 2026-06-13 and still serves an old build. The live frontend is `tennoplan`. Retiring `web` is a production change for the author to decide.

## Next
1. Author decides: merge `Development` into `main` first (production deploy), then re-enable the codex workflow by hand (`gh workflow enable build-codex.yml`). An in-workflow enable step was rejected because nothing documents that it resets the inactivity timer. Showing codex age in the app is the suggested follow-up.
2. Author decides: retire the stale `web` worker or keep it.
3. Author reviews the proposed memory and vault archive list before anything is moved.
4. Then resume product work from the weapon-card UI rework.
