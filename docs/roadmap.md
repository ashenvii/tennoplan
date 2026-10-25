# Roadmap

Where Tennoplan is going and in what order. What is built right now is in the code and in [HANDOFF.md](../HANDOFF.md).

## What it is for

An offline-first Warframe companion that does three things the existing tools don't do together:

1. **Correct numbers.** The codex is built from DE's own export, so a future calc or build tool on top of it can be trusted.
2. **Explained for new players.** Mechanics and mod effects written in our own words (Cephalon's Notes, see [field-notes.md](field-notes.md)), filling the entries other sites leave empty.
3. **Community builds with credit.** Users make builds, the best ones (by upvotes) show on the relevant weapon or warframe page, with the author named.

Desktop (Tauri) is the end goal, the web app is the foundation ([0001](decisions/0001-product-direction.md)).

## How we build it: one page at a time

Each tab is a place, not a view: Celestial Pendulum is an observatory, Solar Rail Feed a command center, Platinum Ledger a trading floor, Dailies & Weeklies a personal log, Void Reliquaries an archive. A page is finished before the next one starts. For each page:

1. Shape the layout and content first (wireframe or reference image, before code).
2. Build it on the shared worldstate and codex layers.
3. Finish it completely, then write its spec in `docs/<page>.md` (see [celestial-pendulum.md](celestial-pendulum.md) for the format).

The UI is being redesigned from the start of this process. The design spec is `.impeccable.md`; the redesign will replace it.

## Status

| Area | State |
|---|---|
| Codex | Built, largest feature. Weapon card UI rework is waiting on the author |
| Celestial Pendulum | Built, to be redone as the first redesigned page |
| Settings | Built |
| Every other tab | Empty stub, rebuild on the live data layer |
| Codex refresh | Off. GitHub disabled the scheduled workflow for inactivity (see HANDOFF.md) |

## Next

1. Turn the codex refresh back on and decide whether to retire the old `web` worker (both need the author's go-ahead).
2. Redesign page by page, starting with Celestial Pendulum.
3. Weapon card rework, then the crit and status prose pass ([0006](decisions/0006-weapon-notes-numbers.md)).

## Later (deliberately deferred)

- **Build planner and calc engine.** Not until the app has shipped to an audience and every codex page is accurate. A pure engine in `src/core/` plus structured mod effects (`targetStat`, `op`, `valuePerRank`) is the hard missing data piece.
- **Community builds and note submissions.** Notes should eventually come from a moderated overlay, with the baked notes as the seed.
- **Abilities page** per Warframe, separate from the short Cephalon's Notes.
- **Mods category notes**, then the rest of the empty entries (arcanes and companions are the emptiest).
- **Relic page.** Skipped when templating the codex summary rail across categories; the author has a separate plan for it.
- **EE.log capture, inventory, market prices, sharing.** Order and reasoning in [0005](decisions/0005-six-systems-target.md).

## Rule for upkeep

Maintenance cost is the first thing to check. Before adding a scraper, a fragile API or a hand-kept data file, say what it costs to keep alive.
