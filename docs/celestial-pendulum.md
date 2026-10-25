# Celestial Pendulum: page spec

> Written before the redesign. Treat the layout as the plan of record until the page is redone, then rewrite this file to match what shipped.

## Purpose
The single hub for Warframe's live, in-game state: world cycles, bounties,
fishing, live activities, Nightwave, vendors,
syndicates, and events. Solar Rail Feed keeps ONLY out-of-game content (news,
dev streams, hotfix notes), presented paimon.moe-timeline style.

## Locked structure (planned via dev wireframe - `wireframe/CelestialWireframe.tsx`)

### Navigation = top tab bar (NO left rail)
`Overview · Worlds · Activities · Nightwave · Vendors & Syndicates · Events`

### Persistent app-wide header (visible on every page)
- **3 world pills** - Cetus, Fortuna, Deimos - planet-state icon + countdown;
  the one(s) in a prime window **pulse gold** ("worth doing now" = the pulse, no
  big cards). Zariman/Duviri live inside the Worlds tab.
- **Baro chip** - "◆ Baro 8d", pulses when in-relay → Vendors & Syndicates.
- **Dailies & Weeklies access** - opens the **tracker panel** from anywhere (this
  is where Dailies/Weeklies lives now - NOT a tab, NOT the Overview). Draws live
  state from the detail tabs, tickable; later becomes a **rewards/streaks** system.

### Tabs
1. **Overview** - *built last.* Only the most important need-to-know (open prime
   windows, today's sortie/archon, active event if any, Baro). A tight dashboard,
   not the tracker. Nothing links until the other tabs exist.
2. **Worlds** - place chips (Cetus…Höllvania) → slim live strip + a lazy
   **"Next 6 hours"** per-world glance (Framer-Motion fake-load; computed only
   when viewed, anchored on view/flip - cheap) + **forecast** + **bounties**
   (DIM tiles → per-stage drop detail) + **fishing**.
3. **Activities** - live rotating missions moved from Solar Rail: alerts,
   invasions (progress bars), sortie, Archon Hunt, arbitration, persistent enemies.
4. **Nightwave** - **battle-pass style**: rank/tier ladder you progress, this
   week's acts, Cred shop. Mirrors the in-game Nightwave.
5. **Vendors & Syndicates** - *merged* (syndicates ARE vendors). Smart nav:
   category (Traders / Syndicates / Event vendors) → entity → **detail page**.
   Syndicate detail is extensive (rank ladder, Warframe Augments, offerings).
   DIM-style item tiles; rotation **A/B/C tags**; click → cost or **per-stage drop
   rates** (wiki Bounty Stage 1/2/3 style: % + "expected ~N runs"). Goal: cover
   every vendor + faction in the game.
6. **Events** - Plague Star / Operation Supply / Thermia etc. Intermittent: show
   "no event active" + a recurring-events reference index when none is live; the
   **active-event look** (timer, offerings) surfaces on the tab + header + Overview
   when one runs. **Dev-only mock switch** simulates an active event (Plague Star)
   in `npm run dev` so we can build/preview it; stripped from the live build.

> **Scrapped:** a cross-world paimon-style **Timeline** tab was prototyped then
> removed - the perf/complexity (projecting every world far ahead) wasn't worth
> it. Replaced by the lazy per-world "Next 6 hours" glance inside Worlds.

## Item presentation
DIM-inspired (ref: `Reference-for-Tennoplan/.../Solar-Rail-Feed/Baro.png`): a
single recognisable image per item (mods/items readable at a glance), clickable
to enlarge/detail. Collapsed mod state later; GIFs later (cheap how-to clips).

## Codex-first rule
Anything a tab draws from the codex must exist in the codex first; we extend the
codex/backend where a section needs data it doesn't yet hold (vendor wares,
syndicate offerings, augments, event offerings).

## Data source & maintenance (the upkeep map)
- **live worldstate** (free/auto): cycles, Next-6h, alerts, invasions, sortie,
  archon, arbitration, persistent enemies, Nightwave season, Baro, event status.
- **codex**: item identities behind every reward/offering tile.
- **curated ⚠** (maintenance cost - confirm a low-maintenance source first):
  fishing tables, syndicate rank ladders, vendor/offering catalogs, event offerings.
- **tracking**: Dailies/Weeklies completion, Nightwave acts, ownership (endgame).

## Build order
1. **Header pills + Worlds tab together** (chosen first - they depend on each
   other; the tab assumes the header carries the live timer). Top-tab shell built
   here; other tabs land as "coming soon" stubs.
2. Activities → Nightwave → Vendors & Syndicates → Events.
3. **Overview last** (it aggregates from finished tabs).
4. Dailies & Weeklies header panel folds in as tracking matures.

## Key files
- `CelestialPendulumPage.tsx` - page shell (will become the top-tab host).
- `wireframe/CelestialWireframe.tsx` - dev-only low-fi click-through of this plan.
- `placesModel.ts`, `cycleActivity.ts`, `cycleForecast.ts` - cycle data/projection.
- `components/` - cycle/bounty/forecast UI (reused under the new Worlds tab).
- `CelestialPendulum.module.css` - styling (tokens only; ambient glow).
