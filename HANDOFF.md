# Handoff

Overwrite this file at the end of every session. Keep it under one screen. Everything here was true on the date below; check it against `git` and the code before relying on it.

**Updated:** 2026-10-25 · **Branch:** `Development`. The cleanup commits (`8bd569d`, `976dfe5`, `18be996`) are pushed; local and `origin/Development` are both at `18be996c0291b6676e70c2a428529f1958ead6d5`. `main` is unchanged at `d6257cf`. Remote: `https://github.com/ashenvii/tennoplan.git` (the repo moved from `Gizzy2x/tennoplan`).

## Where the project is
- Last real feature work (2026-06-16): weapon Cephalon's Notes finished (864 notes applied to real codex uniqueNames), plus `fireModes` and melee scalars from Public Export Plus. See `docs/decisions/0006`.
- Waiting on the author: the weapon-card UI rework (card is being moved into the page header). Data layer is done and decoupled from it.
- Deferred by the author: crit/status percentage prose pass, `core/` calc engine, build planner, community submissions.

## Verified on 2026-10-25
- `npx tsc -b` (root): no errors.
- `cd cloudflare-worker && npx tsc --noEmit`: no errors.
- `cd cloudflare-worker && npm run build-codex`: exits 1, 864 notes applied. An unknown icon token fails the build (`process.exit(1)` in the token scan); the current one is `<OVERGUARD_GAIN>` (Narin), from new upstream data.
- Live worker `/v1/pulse` answers with a current sync time.
- GitHub "Type-check" workflow (`check.yml`) run `40228533422` on `18be996`: success, app and worker type-checks both passed.
- No production deployment, workflow re-enable, or Cloudflare worker deletion was done during the cleanup.

## Problems that are still open
- **Codex refresh is still off.** GitHub disabled the scheduled "Build & Publish Codex" workflow (`disabled_inactivity`, last run 2026-08-16; still disabled when checked 2026-10-25). The repo is public, so the 60-day inactivity rule applies. The live codex manifest is dated 2026-08-14. Restoring it needs a production-affecting step that the author must approve.
- `<OVERGUARD_GAIN>` needs a glyph in `src/assets/tennoicons/` and an entry in `src/lib/tennoicons/tennoIconMap.ts` (or a flag entry).
- No automated tests exist. Verification is the commands in `CLAUDE.md`.
- The `web` worker (`web.tennoplan.workers.dev`) is a stale frontend copy from 2026-06-13 and still serves an old build. The live frontend is `tennoplan`. Retiring `web` is a production change for the author to decide.

## Next
1. Author decides: re-enable the codex workflow by hand (`gh workflow enable build-codex.yml`). An in-workflow enable step was rejected because nothing documents that it resets the inactivity timer. Showing codex age in the app is the suggested follow-up.
2. Author decides: retire the stale `web` worker or keep it.
3. Author reviews the proposed memory and vault archive list before anything is moved.
4. Then resume product work from the weapon-card UI rework.
