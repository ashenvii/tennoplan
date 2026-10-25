# Handoff

Overwrite this file at the end of every session. Keep it under one screen. Everything here was true on the date below; check it against `git` and the code before relying on it.

**Updated:** 2026-10-25 · **Branch:** `Development`, 7 commits ahead of `origin/Development` (not pushed). `main` is at `c97c04d` and was deployed today (Deploy to Cloudflare run `40233902653`, success).

## This session
Consolidated all documentation into the repo (`docs/decisions/0007`). New: `docs/architecture.md`, `docs/roadmap.md`, `docs/field-notes.md`. Moved in: `docs/data-sources.md`, `docs/research.md`, `docs/post-mortems.md`, `docs/celestial-pendulum.md`. Removed from git: `DATA_ARCHITECTURE.md` and 19 stale `*-Blueprint.md` files under `src/`. Docs only, no code changed except one comment in `CelestialPendulumPage.tsx`. Committed on `Development` (this handoff is the commit that follows `c97c04d`, message "Move all documentation into docs/ and remove the stale copies").

Everything as it stood before is in `Main_Vault/_tennoplan-docs-backup-2026-10-25.zip` (repo docs, vault Notes, Documents dossier, auto-memory).

## Cleanup finished
The old copies are deleted (vault `Notes/`, Documents dossier, ignored repo `Notes/` and `Research/`, `.impeccable.legacy.md`, `snapshot.sh`, the `post-commit` hook). Auto-memory is pruned to four preference files. The backup zip is the only record of the old layout.

## Verified
- Paths cited in `docs/architecture.md` exist; routes, Dexie v9 and wrangler bindings were read from code.
- Live `/v1/pulse` answers with current data.
- Type-checks and `build-codex` were not re-run (docs-only change). Last passing run was on `c801d42`.

## Open problems
- **Codex refresh:** `Build & Publish Codex` lists as active but its last scheduled run was 2026-08-16. Watch for the next scheduled run; if none, run `gh workflow enable build-codex.yml` or dispatch it. The live codex manifest was dated 2026-08-14 when last checked.
- The stale `web` worker (`web.tennoplan.workers.dev`, old frontend from 2026-06-13) is still deployed. Retiring it is the author's call.
- No automated tests exist.

## Next
1. Redesign page by page, Celestial Pendulum first (see `docs/roadmap.md`).
2. Weapon card UI rework when the author is ready.
