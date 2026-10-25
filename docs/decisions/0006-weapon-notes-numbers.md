# 0006 Weapon notes: the card owns the numbers

**Status:** Approved · 2026-06-16

Cephalon's Notes (`cloudflare-worker/src/codex/fieldNotes.ts`) are own-words, knowledge-driven prose. Numbers that come from game data (damage, crit, pellets, spool) are shown by the weapon card, which reads Public Export Plus. Notes stay qualitative where a number can drift.

- Notes are keyed by the real codex `uniqueName`. Never guess one. DE internal names do not match display names (Nikana is `Katana`, Tipedo is `MonkSpade`). In June 2026 about 170 notes were dead-keyed and 15 described items that do not exist.
- The crit% and status% figures in prose were kept on purpose: they carry build insight ("raises crit to 24%, opening Hunter Munitions"). A rewrite is deferred until the card UI rework is done.
- All note prose is authored from memory and marked BETA. Claims are not wiki-verified. Treat any single claim as unverified until checked.
- Notes carry no wiki attribution because they state mechanics, not wiki text. Trivia sections were dropped as too lore-flavoured.
- Before merging note or worker changes run the worker type-check and `npm run build-codex` (see `CLAUDE.md`). Straight apostrophes inside single-quoted note strings once broke the build for hours.
