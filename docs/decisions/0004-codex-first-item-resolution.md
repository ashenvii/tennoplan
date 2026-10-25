# 0004 Items resolve through the codex

**Status:** Approved · shipped 2026-06-13

The codex is the authority for item name, `uniqueName`, and icon. Resolution order everywhere: codex, then the frozen fallback map, then a placeholder.

- `src/adapters/items/codexCatalog.ts` is the synchronous index over the `tennoplanItems` table. It is the only intended reader of the fallback map. Icon consumers render by `uniqueName`.
- `fallback-items-map.json` is frozen. It supplies first-launch icons and cosmetics the codex lacks (skins, glyphs, sigils). Never regenerate it. Do not add new consumers, go through `codexCatalog`.
- The `items` table was dropped in Dexie v9. `DropDataService` now only writes `dropLocations`.
- Still open (S1b): retire `dropLocations`. It feeds the bounty board, so bounty drop tables must move into CI first. Low priority.
