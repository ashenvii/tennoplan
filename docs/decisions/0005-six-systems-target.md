# 0005 Six-systems target architecture

**Status:** Approved · agreed 2026-06-11 · phases partly done

Six systems, one writer per store, and `uniqueName` as the only cross-system join key. Each phase deletes what it supersedes.

1. **Codex** (CI-built nouns, Public Export Plus as primary source, WFCD for gap-fill and drops, wiki overlay): done, see 0003 and 0004.
2. **Pulse** (event-driven live data): done, see 0002.
3. **Assets**: on demand only, never bulk-sync on mobile. Not started as a redesign.
4. **User overlay**: Dexie locally, D1 only when sharing ships.
5. **Capture**: EE.log tailer that triggers OCR (the WFInfo pattern, Apache-2.0). Built last, never load-bearing.
6. **Market**: CI-built `uniqueName` to slug map, prices fetched on demand.

**Order planned:** Pulse, Codex v2, CI hardening, live-sync client consolidation, calc engine plus build serialization, capture.

**Status check:** the context archive says steps 1 and 2 shipped and CI hardening is partly done (publish gates, semantic hash). I have not verified the remaining items. Check the code before assuming any of steps 3 to 6 exist.

Competitor and licence research behind this lives in the research dossier (outside the repo), not here.
