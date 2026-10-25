# Handoff

Overwrite this file at the end of every session. Keep it under one screen. Everything here was true on the date below; check it against `git` and the code before relying on it.

**Updated:** 2026-10-25 · **Branch:** `Development`, two local cleanup commits ahead of origin (`9ae7185`), not pushed

## Where the project is
- Last real feature work (2026-06-16): weapon Cephalon's Notes finished (864 notes applied to real codex uniqueNames), plus `fireModes` and melee scalars from Public Export Plus. See `docs/decisions/0006`.
- Waiting on the author: the weapon-card UI rework (card is being moved into the page header). Data layer is done and decoupled from it.
- Deferred by the author: crit/status percentage prose pass, `core/` calc engine, build planner, community submissions.

## Verified on 2026-10-25
- `npx tsc -b` (root): no errors.
- `cd cloudflare-worker && npx tsc --noEmit`: no errors.
- `cd cloudflare-worker && npm run build-codex`: exits 0, 864 notes applied. It reports one unknown icon token, `<OVERGUARD_GAIN>` (Narin), from new upstream data.
- Live worker `/v1/pulse` answers with a current sync time.

## Problems that are still open
- **Codex refresh is off.** GitHub disabled the scheduled "Build & Publish Codex" workflow (`disabled_inactivity`, last run 2026-08-16). The repo is public, so the 60-day inactivity rule applies. The live codex manifest is dated 2026-08-14. Restoring it needs a production-affecting step that the author must approve.
- `<OVERGUARD_GAIN>` needs a glyph in `src/assets/tennoicons/` and an entry in `src/lib/tennoicons/tennoIconMap.ts` (or a flag entry).
- No automated tests exist. Verification is the commands in `CLAUDE.md`.
- The `web` worker (`web.tennoplan.workers.dev`) is a stale frontend copy from 2026-06-13 and still serves an old build. The live frontend is `tennoplan`. Retiring `web` is a production change for the author to decide.

## Next
1. Author approves: re-enable the codex workflow and add a keep-alive step.
2. Author approves: push the cleanup commit(s) from `Development`.
3. Then resume product work from the weapon-card UI rework.
