# 0007 One home for documentation

**Status:** Approved · 2026-10-25

All project documentation lives in this repo and nowhere else. No parallel copies in the Obsidian vault, the Documents folder, or auto-memory.

- Root: `README.md` (what it is and how to run it), `CLAUDE.md` (rules and commands for the agent), `HANDOFF.md` (current state, overwritten each session).
- `docs/`: `architecture.md`, `roadmap.md`, `data-sources.md`, `field-notes.md`, `research.md`, `post-mortems.md`, one spec per finished page (`celestial-pendulum.md`), and `decisions/`.
- Markdown files are not scattered through `src/`. A file exists only if it has a reader.
- Auto-memory keeps the author's working preferences only, not project facts.
- The vault keeps other projects. Tennoplan notes there were retired.

**Reason:** the same facts lived in about 40 files across four places and nobody could tell which copy was current.

**Replaced:** `DATA_ARCHITECTURE.md`, the per-module `*-Blueprint.md` files, `Research/`, `Notes/`, the vault `Notes/` folder, and the dossier in Documents. A zip of everything as it stood on 2026-10-25 was kept outside the repo.
