# Cephalon's Notes

Short own-words explanations shown on codex pages, aimed at new players. Source file: `cloudflare-worker/src/codex/fieldNotes.ts`. The build merges them into the codex and the `CephalonNotesBlock` component renders them with a BETA tag.

Coverage as of 2026-06-16: Warframes, sentinels, companions (the 17 real creatures, not the modular parts), arcanes, and all weapon categories. 864 notes applied. Mods have only a handful.

## Writing a note

- Shape: a `tldr`, then optional `points`, then labelled `sections` (Mechanics, Interactions). No Trivia.
- Plain facts in your own words. Never copy sentences from the wiki (its prose is CC-BY-SA). Numbers and mechanics are facts.
- Keep the prose qualitative where a number can drift. The weapon card owns the numbers ([0006](decisions/0006-weapon-notes-numbers.md)).
- Status stays `beta` until a note has been checked by someone who knows the item.
- Check pronouns (Xaku and Temple are they/them).

## Keys

Key every note by the real codex `uniqueName`, never a guessed one. DE internal names don't match display names (Nikana is `Katana`, Tipedo is `MonkSpade`, Inaros is `Sandman`). Get the names from the live chunk:

```bash
curl https://app.tennoplan.workers.dev/v1/codex/manifest
curl https://app.tennoplan.workers.dev/v1/codex/chunk/<Category>-<hash>.json
```

Use the chunk key without the `chunks/` prefix. One note can be shared by a base item and its Prime through the `SharedNote` helper.

## Check before merging

```bash
cd cloudflare-worker && npx tsc --noEmit
cd cloudflare-worker && npm run build-codex
```

The build prints `applied N, UNMATCHED [...]`. Anything in UNMATCHED is a dead key. Use a typographic apostrophe (U+2019) inside single-quoted strings; straight ones broke the build once.

## Publishing

Notes only reach the app after a merge to `main` and a codex rebuild (pushing to `main` triggers `build-codex.yml` for these paths). After a rebuild the manifest can lag a few minutes, so check the chunk key from the run log if it looks unchanged.

## Not done

Abilities page, mod notes, a moderated submission pipeline so notes stop living in a source file, and the crit and status percentage rewrite.
