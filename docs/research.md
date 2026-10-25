# Tennoplan Research Dossier

> Research dossier: competitors, data sources, and findings, with dates and sources.
> Purpose: stop re-researching the same things across chats and sessions. Every new finding from
> the internet, a competitor app, or an experiment gets integrated HERE - dated, sourced, and
> filed under the right section. Before researching anything, check this file first.
>
> **Created:** 2026-06-11 · **Last updated:** 2026-06-16 (§5 item 16 - wiki's two-layer number maintenance + calc-engine scope; §5 item 13 Slice 2 DATA SHIPPED - fireModes from behaviours[] (295) + 7 melee scalars (228))
> **How to add findings:** use the entry template at the bottom of this file. Date everything.
> Never delete old findings - strike them through and note what replaced them, so we keep the
> "why" trail.

---

## 0. The One-Page Summary

Tennoplan is an offline-first Warframe companion (Tauri 2 + React 19 + Cloudflare). The goal:
cover *anything* in Warframe, stay up to date automatically, beat AlecaFrame / Overframe /
WFInfo on quality and reliability, eventually go mobile - built by one person, so **low
maintenance is a hard requirement**, not a nice-to-have.

The whole app reduces to one sentence:

> **Static data holds the nouns. Live data holds the verbs and the clock. They join on
> `uniqueName`. Each system has exactly one writer.**

Everything below explains the patterns that sentence is made of, where the rest of the industry
uses the same patterns, and what we learned from every relevant app and data source in the
Warframe ecosystem.

---

## 1. The Universal Patterns (the backbone of the app)

These are not Tennoplan inventions. Each one is a pattern most serious apps run on. Knowing the
pattern's *common name* and where you've already seen it makes the codebase legible: when you
open a folder, you should be able to say "ah, this is the X pattern."

### 1.1 Offline-first / local database is the source of truth
- **The pattern:** the UI never renders from a network response. The network's only job is to
  fill a local database; the UI *always* reads the database. App works on a plane.
- **Seen in:** Notion, Linear, Figma, every good mobile app, every game (games render from
  installed files, the patcher fills them).
- **In Tennoplan:** Dexie (IndexedDB) is the truth. `useLiveQuery` subscribers render from
  tables; sync engines write to tables. If the worker dies, the app keeps working on cached data.

### 1.2 Manifest + content-addressed chunks (the "game patcher" pattern)
- **The pattern:** big static data is split into pieces, each named by the *hash of its
  content*. A tiny **manifest** lists `{piece → hash}`. The client compares hashes and downloads
  only what changed. Hash-named files never change, so they cache forever (`immutable`).
- **Seen in:** Steam depots, the Warframe launcher itself, Riot's patcher, npm/cargo lockfiles,
  Docker image layers. This is literally how games update.
- **In Tennoplan (target):** the codex is built in CI, split per category
  (`warframes.json`, `mods.json`, …) into R2, with a small manifest in KV. After a patch, users
  pull the 300 KB that changed, not the 3 MB blob. Prerequisite for mobile.

### 1.3 Stable IDs, never display names (the "asset GUID" pattern)
- **The pattern:** every entity has one immutable machine ID; human-readable names are display
  decoration that may collide, get renamed, or be localized.
- **Seen in:** every game engine (Unity GUIDs, Unreal asset paths), every database primary key.
- **In Tennoplan:** `uniqueName` (e.g. `/Lotus/Powersuits/Excalibur/Excalibur`) is the only join
  key allowed to cross system boundaries. Name-joins are legal **only inside CI**, where failures
  are visible in build logs - never in the browser. This is why shared builds and OCR matching
  will resolve unambiguously when competitors' name-matching breaks.

### 1.4 Anchor + period math instead of polling (the "world clock" pattern)
- **The pattern:** for anything cyclic, you don't ask a server "what time is it in Cetus" - you
  store an **anchor** (a known epoch timestamp) and a **period**, and compute the current state
  locally, forever. Re-sync only to correct drift.
- **Seen in:** NTP, every Warframe timer website, game day/night cycles, cron itself.
- **In Tennoplan (target):** all world cycles (Cetus/Vallis/Cambion/Zariman/Duviri) become local
  math from anchors carried in worldstate. Cycles stop being polled data entirely.

### 1.5 Diff-detection + events instead of "ask the entire time" (event-driven)
- **The pattern:** one place watches the raw feed, computes *what changed*, and publishes small
  **events**. Consumers react to events instead of re-downloading and re-comparing state.
- **Seen in:** game-server delta/tick updates, webhooks, Kafka/event-sourcing, WFInfo's
  EE.log-triggered OCR (see §2.1).
- **In Tennoplan (target - "Pulse"):** the worker cron diffs old vs new worldstate and appends
  compact events (`fissure-spawned`, `fissure-expired`, `bounty-rotated`, `alert-up`). Fissures
  are the only data that changes frequently and irregularly; even fissure *expiry* is local math
  (expiry timestamps are known) - only *spawns* genuinely need the network. The events stream is
  also the future push-notification backbone.

### 1.6 Conditional GET - ETag/304 + tiny "pulse" head
- **The pattern:** the client says "I have version X" (`If-None-Match`); the server answers
  "unchanged" (304, no body) or sends the new version. Polling becomes nearly free. A further
  refinement: poll a sub-KB *head* (`{etag, lastChange}`) and fetch the body only when the head
  moves.
- **Seen in:** all of HTTP caching, RSS readers, package managers.
- **In Tennoplan:** already implemented end-to-end for `/v1/worldstate` and `/v1/codex`.
  Target: align client poll cadence with the worker's 5-min cron (polling every 60 s was 5×
  wasted - data only changes when the cron writes) and put the edge Cache API in front.

### 1.7 CI is the kitchen, the edge is the fridge
- **The pattern:** heavy compute (parsing, joining, enriching, validating) runs where compute is
  free and unlimited (GitHub Actions); the runtime layer (Cloudflare Worker) only *serves*
  pre-cooked results. The server becomes a dumb, fast, reliable CDN pointer.
- **Seen in:** static-site generation (Next.js SSG, Hugo), game build pipelines, data warehouses.
- **In Tennoplan:** the codex pipeline already lives in GitHub Actions because the Worker's
  free-plan 10 ms CPU budget can't parse 7 MB. Lean further in: validation gates,
  skip-if-unchanged uploads, archived builds, patch-triggered rebuilds (§5.3).

### 1.8 Single-writer ownership
- **The pattern:** every table / KV key / store has exactly **one** system allowed to write it.
  Everyone else reads. The moment two systems write one store, you get the "10 systems fighting
  each other" feeling.
- **Seen in:** database ownership in microservices, Rust's borrow checker (same idea, in code),
  Redux "single store, reducers only".
- **In Tennoplan:** the Six-Systems map (§4) assigns every piece of data one writer.

### 1.9 Never overwrite good data with bad (last-known-good)
- **The pattern:** a failed fetch/parse leaves the previous good snapshot untouched; you keep a
  `previous` for rollback; stale data + a staleness banner beats a blank screen.
- **Seen in:** game config backups, blue-green deploys, browser cache fallbacks.
- **In Tennoplan:** already implemented (worldstate updater, `*:previous` keys, 24 h TTL).
  Extend to CI: refuse to publish a codex build whose item count drops suspiciously (§5.3).

### 1.10 Log-tailing as the event source (the WFInfo pattern)
- **The pattern:** instead of watching the screen or polling memory, tail the game's own debug
  log; specific log lines *are* the events that trigger work (like a webhook the game emits for
  free).
- **Seen in:** WFInfo, AlecaFrame, Sentinel, most MMO addons/companions, server log shippers.
- **In Tennoplan (future Capture system):** the Tauri/Rust EE.log tailer is the event source;
  the "reward screen displayed" line triggers screenshot + OCR. OCR is the payload, never the
  trigger.

### 1.11 Hexagonal core + vertical feature slices (code organization)
- **The pattern:** pure business logic (`core/`) imports nothing about React, databases, or
  fetch - so it runs identically on desktop, mobile, and in CI tests. Each UI tab is a
  self-contained vertical slice (`features/<tab>/`). Adapters (`adapters/`) are the only code
  that touches the outside world.
- **Seen in:** Clean/Hexagonal Architecture, game ECS separation of simulation vs rendering.
- **In Tennoplan:** already the repo layout (`src/core`, `src/adapters`, `src/features`,
  `src/store`). This is *why* the future build-calculator and mobile port are cheap - the math
  will be pure `core/` code.

---

## 2. Competitor Dossiers - what each app does, how, and what we take

### 2.1 WFInfo - [github.com/WFCD/WFinfo](https://github.com/WFCD/WFinfo)
- **License: Apache-2.0 → we may port code, not just ideas.** C#/.NET, Windows. Still active
  (v9.8.0, 2026-04-26).
- **Architecture (the important part):** it does **not** poll the screen. It tails `EE.log`;
  when the log says the reward screen is up, *that event* triggers: screenshot the game window →
  crop the part-name regions → Tesseract OCR → fuzzy-match part names → look up
  platinum (warframe.market) + ducat values → overlay. Event-driven end to end (§1.5, §1.10).
- **Other proven features:** prime inventory scanner with plat/ducat math; relic stats
  (vaulted status, average value by refinement); 1-click warframe.market listing management;
  auto-copy price text for in-game chat.
- **Known pain points (their maintenance burden, our warning):** per-UI-theme color filters for
  OCR cropping - DE theme/scaling changes break it ([Ocr.cs](https://github.com/WFCD/WFinfo/blob/master/WFInfo/Ocr.cs)).
- **We take:** the log-trigger architecture; the cropping/fuzzy-match approach as reference
  code (license-compatible); the market-listing UX. We *improve* by using **Windows.Media.Ocr**
  (built into Windows - nothing to ship, no tessdata files) and by matching against our local
  Dexie codex keyed to `uniqueName`.

### 2.2 AlecaFrame - [alecaframe.com](https://alecaframe.com/) · [docs](https://docs.alecaframe.com/faq)
- **License: closed source.** We can study behavior only - no code.
- **How it works (from its own docs):** runs on **Overwolf**, which is its ToS-compliant channel
  for reading the actual in-game inventory; periodically refreshes inventory while playing.
  EE.log listener detects the reward screen and triggers its relic overlay (same pattern as
  WFInfo). All data stored locally.
- **Its moat = its weakness:** full inventory sync exists *only* through Overwolf. Third
  parties ([Sainan's alecaframe-inventory-parser](https://sainan.github.io/alecaframe-inventory-parser/),
  [Sentinel](https://github.com/calamity-inc/Sentinel-for-Warframe)) resort to reading
  *AlecaFrame's cache files* because no clean open inventory channel exists.
- **We take:** the feature bar (mastery checklist, "what can I build", inventory-aware
  recommendations) - implemented from EE.log + user-marked state instead of Overwolf. Decision
  (2026-06-11): **don't chase full inventory parity at first**; EE.log covers
  mastery/missions/rewards without the Overwolf dependency.

### 2.3 Overframe - overframe.gg
- **License: closed website.** Nothing to pull.
- **What it actually is:** a build database. Its moat is (a) the compact build-encoding URL that
  makes builds shareable, (b) the community ranking on top.
- **We take:** the *idea* of a versioned, compact build serialization
  (`{itemUniqueName, mods: [{modUniqueName, rank, slotPolarity}], schemaVersion}`) designed
  day-one for Dexie storage now and D1 + share-links later. Our `uniqueName` discipline makes
  imported builds survive game patches where name-based clones break.
- **Status note:** the build planner itself is **post-ship** (user decision 2026-05-31); only
  the data foundation (serialization format + pure calc engine in `core/`) is pre-work.

### 2.4 The Calamity ecosystem - browse.wf / Public Export Plus / Sentinel
- **[warframe-public-export-plus](https://github.com/calamity-inc/warframe-public-export-plus)** -
  **the most important data discovery.** DE's *official* Public Export (the game's own data
  export), auto-updated, plus everything DE leaves out. Structure: `ExportWarframes.json`,
  `ExportWeapons.json`, `ExportAbilities.json`, `ExportRecipes.json`, `ExportRelics.json`,
  `ExportVendors.json`, `ExportBundles.json`, … with **data and localization split**
  (`dict.en.json` + 13 more languages) and **TypeScript type definitions shipped in-repo**.
  Powers [browse.wf](https://browse.wf) (MIT). Our worker types already name `calamity-plus` as
  a data source.
- **[Sentinel-for-Warframe](https://github.com/calamity-inc/Sentinel-for-Warframe)** - C++
  open-source overlay (periodic-mission tracking, invasion rare-reward ownership flags, Duviri
  cave previews). Useful as a *feature catalogue* and for its local codename/recipe data files.
- **We take:** Public Export Plus becomes the **primary noun source** in CI (game truth), with
  WFCD as gap-fill + drops and the wiki as prose overlay (§3). The localization dicts give us
  multi-language nearly free, later.

### 2.5 warframestat.us / WFCD (the community backbone)
- Open-source org behind: `warframe-items` (the item library we currently build the codex
  from), `warframe-worldstate-parser` (we run it in the worker), `warframe-drop-data`
  (drops.warframestat.us), and the WFInfo fork. MIT-licensed ecosystem.
- **Known reliability quirks (verified in our own ops):** api.warframestat.us intermittently
  returns empty 200 bodies; several item categories 404 on the API and only exist on GitHub raw;
  arcanes shape differs between API and GitHub raw. Our config already routes around all of
  these - keep those notes in `cloudflare-worker/src/config.ts` comments.
- **DATA-CORRECTNESS quirk - WFCD weapon `damage` map has Puncture and Slash TRANSPOSED**
  (verified 2026-06-14 against PE+ named `behaviours` keys + the live codex). The WFCD
  `/weapons` `damage` object swaps the puncture/slash values: it serves **Lex as slash 104**
  (it's the game's iconic *puncture* hand cannon) and **Kronen Prime as puncture 169.6** (a
  *slash* weapon). Confirmed three ways: PE+'s unambiguous named `DT_PUNCTURE`/`DT_SLASH` keys
  agree with PE+ `damagePerShot` (373 vs 5), and both match real-game identity. It also carries
  a phantom `total` key (+ zero/`tau`/`cinematic` keys) that leaks into our DamageStrip as a
  large icon-less chip. Measured impact on the deployed codex (which is WFCD-sourced): **481/588
  weapons transposed, 334 show the WRONG dominant damage type to the user, 435 have a value off
  >5%, 589 carry the phantom total chip.** PE+ `damagePerShot` is correct on all of these - this
  is the concrete value of §5 item 13's Slice 1. **Filed under §2.5; cross-ref §5 item 13.**

---

### 2.6 underframe.site - the build-calculator correctness benchmark (studied 2026-06-14)

- **What it is:** a serious, modern Warframe **build optimizer + DPS calculator** across every
  category (Warframe, Primary/Secondary/Melee/Archgun/Operator, Sentinel/Moa/Beast/Companion,
  Necramech, Archwing), with full mods + polarity + riven. Deep combat sim: "Calculate DPS" with
  adjustable sim time, average damage/shot, **time-to-kill**, combat log, **target-dummy presets**
  (faction, level, armor, shield, overguard), **headshot multipliers, damage resistance, status
  cap + attenuation**. This is the bar for "doing the numbers correctly" - the user's reference
  for a calc engine done right.
- **Build sharing:** snapshot links, import/export, a "Trusted Builds" list, partner builds.
  **No upvotes/ratings, no per-build author credit** visible. Peer review happens via Discord.
- **Gaps = Tennoplan's wedge (verified on the live site):** (1) **zero new-player support** - no
  tutorial, glossary, or mechanics explanations; it assumes mastery. (2) **No community ranking /
  attribution** on builds. (3) **Never cites data sources or accuracy** - the "correct" tool
  doesn't show its work; Tennoplan's PE+-authoritative, sweep-verified numbers are a statable
  trust advantage.
- **License/access:** closed website - behaviours/ideas only, like Overframe/AlecaFrame.
- **Take:** match underframe's numerical rigor (pure calc engine in `core/`, §4 phase 5), and
  beat it on the two things it ignores - **new-player education** (own-words mechanics, §6) and
  **community-curated, attributed builds surfaced inside the codex** (§6.9). **Filed under §2;
  cross-ref §4 (calc engine), §6 (knowledge system).**

## 3. The Warframe Data Ecosystem Map (sources of truth, ranked)

| Source | What it holds | Cadence | License/Access | Role in Tennoplan |
|---|---|---|---|---|
| **DE Public Export via warframe-public-export-plus** | The game's own item/recipe/relic/vendor data + 14-language dicts + TS types | Auto-updated on patches | Public repo (verify license header before vendoring) | **Primary noun source (target)** |
| **WFCD warframe-items** | Community-enriched items (drops, patchlogs, images, market names) | Hours after patches | MIT | Gap-fill + drops + images |
| **drops.warframestat.us** | Official drop tables, parsed | On DE updates | MIT (WFCD) | Drop locations (joined in CI) |
| **api.warframestat.us/pc** | Parsed live worldstate | ~1 min | MIT, flaky (empty 200s) | Worldstate source #1 (DE blocks Cloudflare egress on official endpoints - verified 2026-06-02) |
| **api.warframe.com / content.warframe.com worldState.php** | Raw official worldstate | ~1 min | Public, but 403s Cloudflare IPs | Dormant fallback (needs a non-CF proxy to revive) |
| **wiki.warframe.com Lua data modules** (`Module:Warframes/data`, `Module:Weapons/data`, …) | Hand-curated prose, ability details, patch history | Community-paced | CC-BY-SA (attribute!) | Enrichment overlay only - never load-bearing; parse failure falls back to WFCD |
| **warframe.market API v2** | Player market prices/orders | Live | Public API, rate-limited | On-demand prices; CI builds the `uniqueName ↔ slug` map |
| **EE.log** (`%LOCALAPPDATA%/Warframe/EE.log`) | Everything the game announces: missions, rewards, relics, logins | Real-time | Local file, ToS-safe to read | Future Capture system's event source |
| **Overwolf** | True inventory access | Real-time | Requires building on Overwolf platform | **Rejected** - dependency too heavy; EE.log covers most value |

**The layering rule:** game truth (Public Export) ⟶ community enrichment (WFCD) ⟶ prose
(wiki) - joined **in CI, by `uniqueName`**, each layer optional so an upstream break degrades
gracefully instead of breaking the build.

### How Warframe's own data is structured (read this once, everything makes sense)
- Every game object's ID is a **virtual file path**: `/Lotus/Powersuits/Excalibur/Excalibur`,
  `/Lotus/Upgrades/Mods/Warframe/AvatarHealthMaxMod`. That *is* `uniqueName` - the game's
  internal asset tree, exactly like paths in a filesystem. Categories are directories
  (`/Lotus/Weapons/Tenno/…`, `/Lotus/Types/Items/MiscItems/…`).
- This is why `uniqueName` is immune to renames/localization: DE never moves the asset, only the
  display dictionary changes. Our entire join discipline is just "use the game's own filesystem
  paths as primary keys."
- The Public Export mirrors this: one `Export<Category>.json` per asset directory, names
  resolved through `dict.<lang>.json` - the same data/display split we use (codex data vs
  display names).

---

## 4. Tennoplan Target Architecture - the Six Systems (agreed 2026-06-11)

**Invariant: one writer, one store, one read surface per system. `uniqueName` is the only
cross-system join key.**

| # | System | One job | Writer | Store | Absorbs / retires |
|---|---|---|---|---|---|
| S1 | **CODEX** | All nouns (items, mods, relics, drops, recipes) | GitHub Actions CI | R2 chunks + KV manifest → Dexie `tennoplanItems` | DropDataService, items-map.json, legacy `items` + `dropLocations` tables, client dropResolver |
| S2 | **PULSE** | The clock + the verbs (cycles, fissures, events) | Worker cron (diff engine) | KV worldstate + events → Dexie `worldstate` | WorldstateSync/worldstateCache/worldstateStore/heartbeat merge into one LiveSync engine |
| S3 | **ASSETS** | Images/icons on demand | Asset engine | Cache Storage + Dexie `assetMeta` | (exists; rule: never bulk-sync on mobile) |
| S4 | **USER OVERLAY** | Everything the player owns/marks/plans | UI actions only | Dexie (`itemStates`, `progression`, future `builds`) | D1 enters only when sharing ships |
| S5 | **CAPTURE** | EE.log events → OCR payloads | Tauri/Rust | Emits events; writes nothing canonical | Built last; never load-bearing |
| S6 | **MARKET** | Prices | On-demand client fetch | Ephemeral Dexie cache + CI slug map | - |

**Pulse data tiers** (the event-driven core):
1. **Cycles** - anchor + period math, computed locally, zero polling (§1.4).
2. **Fissures/rotations/alerts** - worker diffs each cron tick → compact event log; spawns are
   the only network-required change (expiries are local math).
3. **The pulse head** - sub-KB `{etag, lastChange, counts}` behind the edge Cache API; client
   polls this at cron cadence (5 min) and fetches the snapshot only when it moves.

**Cloudflare storage decision table (free-plan budgets, verified 2026-06):**

| Store | Free budget | Use for | Never use for |
|---|---|---|---|
| KV | 1,000 writes/day (account-wide!), 100k reads/day | Small hot pointers: worldstate, manifests, metadata | Big blobs, user-generated writes |
| R2 | 10 GB, ~1M writes/mo, no egress fees | Codex chunks, images - immutable, content-addressed | Hot mutable state |
| Cache API | Free, per-edge | Absorbing poll traffic (60 s TTL on pulse) | Source of truth |
| D1 | 100k writes/day, 5M reads/day | Future: shared builds, community features | Anything before sharing ships |

**Execution order** (each phase deletes what it supersedes - that's the anti-sprawl mechanism):
1. **Pulse v1** - Cache API + diff engine + events key + anchor cycles + poll alignment
2. **Codex v2** - Public Export Plus ingestion + R2 chunks + manifest sync; delete legacy static path
3. **CI hardening** - validation gates, skip-unchanged uploads, archived builds, health monitor, CI worker deploys
4. **LiveSync consolidation** - one client engine; rebuild Solar Rail Feed on the events stream
5. **Foundations** - pure calc engine (`core/`) + versioned build serialization + market slug map
6. **Capture** - EE.log tailer first, OCR second (Windows.Media.Ocr; default theme + common resolutions only at v1)

---

## 5. Hard-Won Operational Knowledge (do not re-learn these)

1. **Cloudflare Workers free plan = 10 ms CPU/invocation** → the codex build *cannot* run in the
   worker; it lives in GitHub Actions (no CPU limit) and uploads to KV/R2. (Learned the hard way,
   2026-05.)
2. **KV free = 1,000 writes/day account-wide.** Every-minute worldstate cron (2 keys/tick) blew
   it; `*/5` cadence = 576/day. Any new writer must check this budget first.
3. **DE 403-blocks Cloudflare egress IPs** on both official worldstate hosts (verified
   2026-06-02). Community source leads; official revival needs a non-Cloudflare proxy.
4. **`tsc --noEmit` is a NO-OP in this repo** (root tsconfig is `files:[]` + references). Only
   `tsc -b` actually type-checks.
5. **api.warframestat.us quirks:** intermittent empty 200 bodies; no endpoints for
   sentinels/pets/relics/resources/gear/misc (404) - GitHub raw is primary for those; arcanes
   shape mismatch between API and GitHub raw.
6. **License rules of thumb:** Apache-2.0 / MIT (WFInfo, WFCD, browse.wf) → portable with
   attribution. GPL → ideas only unless we want to GPL the app. Closed (AlecaFrame, Overframe)
   → behaviors only. Wiki content → CC-BY-SA, attribute in-app.
7. **OCR is the highest-maintenance feature in this space** (WFInfo maintains per-theme color
   filters). Mitigation: EE.log first, OCR last, Windows built-in OCR over Tesseract, never
   load-bearing.
8. **A blob etag is NOT a change signal when the blob embeds clock fields** (found 2026-06-12,
   building Pulse v1). The parsed worldstate carries `timestamp`/`timeLeft`/`cyclesRemaining`
   recomputed at every parse, so its SHA-256 etag moves every cron tick even when nothing
   meaningful changed - conditional GET/304 almost never fired, and a pulse head built on it
   would have triggered a full-body fetch every poll. Fix: a SEMANTIC etag hashed over a sorted
   projection of unpredictable fields only (entity id sets, rotation expiries, variable-period
   cycle anchors), with predictable fixed-period anchors excluded and pulled in only when a
   drift guard (>90 s deviation from projection) detects an upstream schedule shift.
   Implementation: `cloudflare-worker/src/worldstate/pulse.ts`.
9. **Public Export Plus operational facts** (verified 2026-06-12, Codex v2 phase A):
   distributed as an npm package (~100MB unpacked: all categories + 15 language dicts) whose
   **version IS the data version** - install `@latest` per CI build, never pin. Its exports map
   blocks subpath imports (`pkg/ExportWeapons.json` throws); resolve the package dir and
   fs-read selected files instead (~12MB for our 5). All records keyed by uniqueName; `name`/
   `description` are dict.en keys. Crit/status are fractions - SAME unit as WFCD, but WFCD
   serializes float32 noise (0.25999999) vs PE+ clean decimals (0.26): exact-compare metrics
   produce fake divergence, use relative tolerance. First overlay run filled **31 real catalog
   holes** (all sentinel weapons, Moa/Hound weapons, Duviri Drifter melee) and corrected 17
   mod baseDrains - WFCD's gaps are exactly where its API 404s (§2.5).
10. **The WFCD weapons FALLBACK is All.json = their entire database** (exposed live
   2026-06-12): when api.warframestat.us/weapons times out, the fetcher's GitHub-raw fallback
   feeds ALL.json and the parser ingests every row as a weapon → build ballooned 9,008→25,573
   items (15,800 junk "weapons"), 17.3MB→31.8MB, exceeding KV's 27MiB cap (413). Guarded now by
   a 24MiB size gate in build-codex (fail-clean, last-good keeps serving) + count-drop gate
   (>5% shrink refused) + skip-unchanged publish (semantic contentHash - blob etag moves every
   build because the normalizer stamps lastUpdated). Proper fix pending: filter fallback rows
   by category in the parser. Also: codex:current no longer carries a TTL - skip-unchanged +
   48h TTL would have let a stable blob EXPIRE while metadata claimed fresh.
11. **The Cloudflare Cache API is a silent NO-OP on `*.workers.dev` domains** - `cache.match`
   never hits; it only engages on a custom domain / route on a Cloudflare zone
   ([docs](https://developers.cloudflare.com/workers/runtime-apis/cache/)). Pulse v1's edge
   caching (60 s TTL on /v1/pulse + /v1/worldstate, `api/routes.ts`) is deployed but dormant
   until the worker gets a custom domain. At 60k users the Cache API is what keeps Worker
   invocations + KV reads inside free-plan budgets (100k/day each) - getting a domain routed
   is a REQUIRED step before real multi-user scale, not an optimization. Bonus discovered in
   verification: the browser's own HTTP cache honors the same `max-age=60`, absorbing repeat
   head polls within a minute for free.
12. **PE+ is ALREADY effectively the primary source - coverage parity verified; the real risk is
   silent field drift, not coverage** (audit 2026-06-14). The Codex v2 phase-A overlay
   (`peplusOverlay.ts`) already does authority-override (DE numbers win on matched items) AND
   gap-synthesis (mints entries for PE+-only items) - so "make PE+ the primary source" is a no-op.
   A `uniqueName` set-diff (PE+ v0.6.2 vs the 2026-06-13 codex, junk-filtered by DE's own
   `codexSecret`/`excludeFromCodex`) found the codex at FULL parity on every consumer-relevant
   category: Warframe 120/120, Weapon 731/731, Mod 1417/1417, Relic 3013/3013, Equipment 160/160 -
   all **0 missing**. The only PE+ "misses" are noise: conservation wildlife (ExportAnimals, 159),
   fish size-variants + decorations (ExportResources, ~1283), internal quest keychains
   (ExportKeys, 42), and 4 modular Moa/Hound base powersuits. Overlay category-extension was
   therefore **skipped** - it would only bloat the blob toward the 24MB KV gate (§5 item 10) for
   zero player value. The genuine exposure: the overlay reads PE+ fields POSITIONALLY
   (`totalDamage`, `baseDrain`, …), so a DE rename/removal silently degrades the codex to stale
   WFCD numbers with NO error. Now covered by a schema-drift guard
   (`cloudflare-worker/scripts/lib/peplusSchemaGuard.ts`): snapshots the consumed fields per export
   (+ a `critical` flag) and the full top-level key set; at build time a critical field on ZERO
   records of a non-empty export → **FATAL** (fail-clean, last-good serves), a new upstream key →
   **WARN** (enrichment opportunity), and every consumed field's presence % is logged. Mirrors the
   `tokenScanner`/`loadKnownTokens` pattern (§5 item, codex token drift); accept intentional
   changes by editing its `SCHEMA` snapshot. **Filed under §5; cross-ref §2.4 (PE+), §4 (S1 Codex).**

13. **Damage numbers are FULLY STRUCTURED in PE+ - no hand-curation, and self-describing
    (named keys, not a positional array we must decode)** (Phase 2 "Topics - Damage" open
    question, answered 2026-06-14 against PE+ v0.6.2 as installed). The open question was
    "structured vs hand-curated"; the answer is **structured, and better than expected.** PE+
    `ExportWeapons.json` exposes per-shot damage two ways:
    - **`damagePerShot: number[]`** - a 20-slot POSITIONAL array (Braton `[7.92,7.92,8.16,0,…]`
      = Impact/Puncture/Slash → total 24). Order documented at
      [wiki.warframe.com/w/Public_Export#Guns](https://wiki.warframe.com/w/Public_Export#Guns).
      This is the only form that needs an external index→type map.
    - **`behaviours: IWeaponBehaviour[]`** - the form PE+'s OWN README says to **prefer**, and
      what we'll consume. Each behaviour is a firing STATE (`stateName` =
      `…/Loadout_TriggerAuto|TriggerContinous|TriggerCharge|TriggerSemiAuto`, `fireIterations`,
      optional `burst`) carrying `IAttackData` blocks with **NAMED damage-type keys** -
      `DT_IMPACT, DT_PUNCTURE, DT_SLASH, DT_FIRE, DT_FREEZE, DT_ELECTRICITY, DT_POISON,
      DT_EXPLOSION, DT_RADIATION, DT_GAS, DT_MAGNETIC, DT_VIRAL, DT_CORROSIVE, DT_RADIANT,
      DT_SENTIENT, DT_FINISHER, DT_SHIELD_DRAIN, DT_HEALTH_DRAIN` - plus a per-attack
      `procChance`. Self-describing: the key IS the type, so **no enum table to maintain**, and
      it's TYPED in the package's shipped `index.d.ts` (`IAttackData`, `IWeaponBehaviour`,
      `IProjectile`, and a `TProcType` enum that maps each `DT_*` → its status proc, e.g.
      `PT_BLEEDING`=Slash - so "what does this element do" is structured too).
    - **`behaviours` carries structure `damagePerShot`/`totalDamage` FLATTEN AWAY** - the reason
      to prefer it: multiple firing states (Braton/Lex show a base behaviour AND a second
      Incarnon/alt-fire behaviour with its own attack, e.g. Lex alt `DT_RADIATION:700`);
      direct vs **radial/AoE** split (`projectile.attack` vs `projectile.explosiveAttack` vs
      `embedDeathAttack` - Kuva Bramma: impact 187 / explosion 839 / embed 175, which
      `damagePerShot` lumps into slot 7); `chargedProjectile` for charge weapons; continuous
      beams flagged by `stateName`. The scalar `totalDamage` (currently the only damage field
      the overlay reads) is a lossy summary of all this.
    - **Melee** is structured via dedicated scalar fields, not `behaviours`: `slamAttack`,
      `slamRadialDamage`, `slamRadius`, `slideAttack`, `heavyAttackDamage`, `heavySlamAttack`,
      `heavySlamRadialDamage`, `heavySlamRadius`, `comboDuration`, `range`, `followThrough`,
      `windUp`, `blockingAngle` (Kronen Prime: slam/slide 424, heavy 848, etc.). Base hit still
      in `behaviours`/`damagePerShot`.
    - **Innate elements** are already in the damage data (Ignis `DT_FIRE:33`, Glaxion
      `DT_FREEZE:26`); lich/sister bonus element flagged separately by
      `nemesisUpgradeTag` (`InnateElectricityDamage` | `InnateHeatDamage` | …).
    - **Float noise** present as expected (Lex `12.999995`, Kronen `21.200001`) - same source as
      §5 item 9; any compare uses the existing relative tolerance, display rounds.
    - **Wiki Lua is NOT needed for damage numbers** and must not become load-bearing for them:
      the wiki's weapon damage ultimately traces to this same DE Public Export (the README links
      the wiki only to *document the array order*). Using PE+ directly = no scrape, no CC-BY-SA
      attribution for pure numbers, lower maintenance - wiki stays a PROSE overlay only (§3,
      §6.2 layering rule holds).
    - **Decision / action:** Phase 2 "Damage" is a **build-pipeline parse + domain-model + UI**
      job, **zero curation**, executed in slices. **Slice 0+1 SHIPPED (2026-06-14):** the
      `TennoplanItem.damageTypes` field and the `WeaponSummaryCard` DamageStrip UI already
      existed but were WFCD-only (stale post-patch, **no melee** - WFCD ships no melee `damage`
      map - and absent on synthesized new weapons). Fix = `peplusOverlay.ts` now authors
      `damageTypes` from PE+ `damagePerShot` (the faithful flat per-type split, sum-checked
      against `totalDamage`) on BOTH matched and synthesized weapons, mapped through
      `DPS_INDEX_TO_KEY` (slot order mirrors the typed `IAttackData` keys → our existing
      lowercase UI vocabulary, so **no frontend change**). `damagePerShot` added to `peplus.ts`
      `PeWeapon`; marked **critical** in `peplusSchemaGuard.ts`. Verified against live PE+:
      646/655 weapons get a breakdown incl. **228 melee** (was ~0), **0 sum-vs-total warnings**,
      `tsc -b` clean. Chose `damagePerShot` over `behaviours[]` for the flat strip because it's
      pre-summed/faithful and needs no block-selection logic. **Slice 2 DATA SHIPPED (2026-06-16,
      main `d6257cf`):** (a) `WeaponFireMode`/`WeaponAttack` types (both mirrored files) +
      `fireModes` on TennoplanItem, parsed from `behaviours[]` in `deriveFireModes` (peplusOverlay):
      direct + **radial AoE split** (Bramma explosion no longer lumped into impact), charge-vs-base
      (prefers `chargedProjectile`), beam flag (`TriggerContinous`), burst, alt-fire/Incarnon as a
      2nd profile; the generic ~10-dmg placeholder `impact` is auto-dropped by preferring
      projectile/chargedProjectile. Emitted only when structure exists beyond a plain hit (blob-lean)
      - **295 weapons**. DT_* mapped via `DT_TO_KEY` (DT_EXPLOSION→blast is the key radial type).
      (b) **7 melee scalars** the WFCD codex lacked entirely - `slamRadius, slideAttack,
      heavyAttackDamage, heavySlamAttack, heavySlamRadialDamage, heavySlamRadius, windUp` - added to
      `ItemStats` (both files) + read in `applyMeleeScalars` (additive, >0, melee only) - **228
      weapons** (Kronen Prime: heavy 848, slide 424, slamRadius 8, windUp 0.7). All `behaviours` +
      melee fields registered NON-critical in `peplusSchemaGuard`. **STILL TODO (UI, user's domain):**
      a typed model + dedicated `Damage`/fire-mode block to render fireModes (user is reworking the
      weapon card UI - data is decoupled & ready). **Filed under §5; cross-ref §2.4 (PE+), §4 (S1
      Codex), §6.2 (wiki = prose only).**

14. **Codex correctness sweep - scalar data is PE+-aligned (trustworthy); the only gaps are
    coverage, not errors** (audit 2026-06-14, after the damage fix). Diffed PE+ vs the LIVE codex
    field-by-field across Warframes/Weapons/Mods. **Result: 0% disagreement on every scalar/enum**
    - all warframe stats, all weapon stats (incl. the NON-overlaid melee scalars slamAttack/
    slamRadialDamage/range/comboDuration/followThrough → WFCD's melee numbers are correct), mod
    baseDrain/rarity. Only anomaly: 1 mod polarity edge case (Dreamer's Bond codex `aura` vs PE+
    `universal`). **Conclusion: the Puncture/Slash transposition (item 13) was the ONE systematic
    WFCD data bug; no second one hides in scalars.** Remaining differences are pure COVERAGE
    (PE+ has it, codex drops it), not correctness: **`multishot`** (378 weapons - a core combat
    stat the codex carries nowhere; cheapest high-value enrichment, same shape as the damage fix),
    melee heavy/slide/slamRadius/windUp (228 each) + `behaviours` (618) = Slice 2. **PE+ has NO
    structured per-rank mod values** (only 17/1596 mods carry `upgradeEntries`, 1 carries
    `levelStats`) - so "author mod per-rank values from PE+" is a DEAD END; the codex correctly
    keeps WFCD's prose `levelStats`. **Filed under §5; cross-ref §5 item 13 (damage), §2.4 (PE+).**

15. **`build-your-own-x` ([repo](https://github.com/codecrafters-io/build-your-own-x)) - a
    LEARNING-from-scratch resource, mostly orthogonal; its ethos is the OPPOSITE of our
    low-maintenance rule** (studied 2026-06-14). Its mission is "master programming by recreating
    your favorite technologies from scratch" - so it is NOT production-architecture guidance, and
    we must NOT let it tempt us into reinventing infra Dexie/Cloudflare/React already provide
    (database, web server, front-end framework, etc. = ignore). It does NOT revise the
    knowledge-layer work. **The 4 categories that DO map to the parts we legitimately build
    ourselves** (bookmark for when we reach them): **Search Engine** → codex client-side search;
    **Programming Language/Interpreter** → the `core/` build calc engine is a tiny domain
    interpreter (build → evaluate through the damage stacking pipeline); **Git** → our
    content-addressed chunk+manifest already IS git's object model (confirms §1.2, no change);
    **Bot** → the Discord BETA-vetting bot (§6.3). **Filed under §5; cross-ref §1.2, §4 (calc
    engine), §6.3 (Discord vet).**

16. **How the WF Wiki maintains its numbers = a TWO-LAYER system; only one layer is automatable,
    and it's the one we already have** (researched 2026-06-16, triggered by a user audit that
    caught a hand-written prose error - the Kohm note claimed "~7 projectiles" vs the wiki's 12).
    Source: [wiki.warframe.com/w/Public_Export](https://wiki.warframe.com/w/Public_Export) + direct
    inspection of installed PE+ `ExportWeapons.json`.
    - **Layer 1 - auto-sourced baseline (DE Public Export).** DE maintains the export to feed its
      OWN Companion app + Arsenal Twitch extension. Carries `damagePerShot[]`, `totalDamage`,
      crit chance/mult, `procChance`, fireRate, accuracy, magazineSize, reloadTime, `multishot`,
      melee scalars (slam/heavy/slide/range/combo). Tracks the game every patch. **This is exactly
      the PE+ layer we already ingest** - §5 item 14 found 0% scalar disagreement. **Zero
      maintenance, patch-stable.**
    - **Layer 2 - manual editorial depth (wiki-side).** The Public Export page confirms damage
      **falloff** (start/end distance + reduction), **pellet/spool ramps** (Kohm 1→12), and
      granular **per-fire-mode** attack tables are *"notably absent from the documented schema…
      wiki-side computations or editorial additions."* Editors extract from the full game manifest
      / in-game testing and hand-enter into `Module:Weapons/data`; Lua calc modules then compute
      DPS/TTK. **This is the labor-intensive layer (73k editors exist for a reason).**
    - **Verified on the Kohm in our installed PE+:** `multishot: 9` is a FLAT number (that IS the
      source of our card's "9" - DE's real export value; the wiki's "12" is its Layer-2 editorial
      full-spool figure, NOT exported). **No `falloff` key exists anywhere in the entire weapons
      export.** Single `behaviours` entry. Side-finding: PE+ carries Kohm `impact.procChance: 0.75`
      (matches the wiki's single-pellet 75% status) while our WFCD-sourced card shows 8.3% - PE+ is
      CLOSER to the wiki than our current codex on status; a reason to prefer PE+ proc data.
    - **Maintenance map for a calc-grade Tennoplan:** (a) base damage/crit/status/fireRate/mag/
      reload/**multishot**/innate elements/melee scalars = PE+, zero upkeep; (b) damage-stacking
      math (mods, multishot, crit tiers, status, combo, faction/armor/shield) = pure `core/` code,
      write-once, formulas rarely change; (c) **falloff + spool ramp + per-fire-mode** = NOT in PE+,
      the wiki's manual layer → HIGH maintenance if chased (own raw-manifest extractor = fragile per
      patch; scraping wiki Lua = CC-BY-SA + fragile + violates low-maint rule; hand-curate = the
      thing user rejects). Rows (a)+(b) cover ~90% of theorycrafting accuracy.
    - **Decision / action:** Build the calculator on the PE+ + pure-`core/` foundation (matches the
      wiki's AUTOMATED layer + underframe's math). Treat falloff/spool/per-mode as a bounded,
      opt-in "advanced modeling" tier added per-weapon later with an explicit "not yet modeled"
      flag - NEVER a launch blocker. Prose Notes go qualitative (numbers live only in the
      PE+-sourced card; delete hand-typed figures like Kohm "~7", don't correct them). Next codex
      data work = ingest `behaviours[]` (Slice 2, in PE+, zero curation). **Filed under §5;
      cross-ref §2.6 (underframe = falloff/attenuation bar), §3 (wiki = prose/Layer-2 only),
      §5 items 13–14 (PE+ damage structured + 0% scalar drift), §6.9 (calc north-star).**

---

## 6. Knowledge System - Wiki Integration, Community Content & Rich Enrichment (2026-06-11)

### 6.1 Competitive Landscape - What Others Do (and Don't)

Researched all major Warframe companion apps for wiki/guide integration:

| App | Wiki/Guide Content | In-App Annotation | Ability Previews |
|---|---|---|---|
| AlecaFrame | None - outbound link only | No | No |
| Overframe | None - build DB only | No | No |
| WFInfo | None - price overlay only | No | No |
| Official Warframe mobile | None - raw Codex reference | No | No |
| browse.wf | None | No | No |

**Key finding (2026-06-11):** *No competitor Warframe companion app integrates wiki prose, community annotations, or ability previews inline.* Every app either (a) sends users away to wiki.warframe.com, or (b) only uses structured data (WFCD JSON) without surfacing wiki prose back to users. This is a wide-open gap.

Broader gaming apps pattern:
- **Wowhead (WoW):** Community comment layer on top of curated machine data (not editable wiki). Up/down voting; 70 rep minimum to post. Best model for a companion app + community.
- **Fextralife network:** Traditional wiki with lightweight editorial approval. 73,000+ editors.
- **Light.gg / D2Foundry (Destiny 2):** Pure database apps, no wiki content at all.
- **Path of Building (PoE):** Offline tool; wiki and tool remain separate.
- **LoL companion apps:** Stats/builds only, no ability preview video integration.

**Conclusion:** The "companion app + inline wiki content" combination simply doesn't exist in the gaming space at this depth. That's the opportunity.

### 6.2 MediaWiki / Wiki Lua Data Extraction

- **Practical extraction path:** Use MediaWiki's `action=scribunto-console` API to run Lua snippets in sandbox and get JSON back. Or parse Module: namespace pages directly with `action=query&titles=Module:Warframes/data`.
- **Current use:** CI already pulls from `Module:Warframes/data` for `sex`, `subsumedAbility`, `tacticalAbility`, `progenitorElement`, `themes`, `playstyle`, `passiveDescription`. This is solid.
- **CC BY-SA 4.0 attribution:** Required for any display of wiki prose. Our `WikiFooterBlock` attribution text is compliant. Pure structured data (stats, numbers) from the game itself doesn't require CC attribution; prose descriptions do.
- **Filed under:** §3 (data ecosystem map - wiki row confirmed as enrichment overlay only).

### 6.3 Approval System Patterns

- **MediaWiki Flagged Revisions extension:** Separates Editors (submit) from Reviewers (approve for public). The Warframe wiki uses this pattern. Scales well for medium communities; overkill for small indie.
- **Lightweight alternative (recommended for Tennoplan):** Discord bot + D1 status field.
  1. User submits annotation/guide via in-app form → Worker writes row to D1 (status: pending)
  2. Discord bot posts to #codex-contributions channel
  3. Dev (or trusted editor) reacts ✅ → bot calls Worker API to flip status: approved
  4. Cron/next-sync picks up newly approved rows → distributed to clients
  - **Why:** Free, zero infrastructure, familiar to gaming communities, creates natural touchpoint for community building. Audit trail lives in Discord + D1.
- **Future:** Add "trusted contributor" tier (automatic approval above N approved submissions, like Wowhead's 70 rep). Start manual, automate later.

### 6.4 Ability Preview Clips

- **Source problem:** Warframe ability preview videos (from the in-game Codex) are NOT publicly extractable. Not in WFCD, not in Public Export, not in game files we can legally access.
- **YouTube:** Official DE ability previews exist on PlayWarframe channel but embedding in Tauri is awkward and creates external dependency.
- **Best approach:** Community-sourced WebM clips (3–5 seconds, recorded by players, submitted through the annotation system). Design the infrastructure, launch with 0 clips, let the community fill it in over time - exactly how the Warframe wiki built its media library.
- **Technical implementation:** `<video>` element in AbilityRow, `onMouseEnter` plays, `onMouseLeave` pauses + resets. Store in R2 at `/ability-previews/{uniqueName}/{abilityIndex}.webm`. Use `react-hover-video-player` npm package or vanilla HTML.
- **Performance:** URL fragments (`video.webm#t=0,5`) limit buffering to the preview range. Cache in Dexie assetMeta table (same as icons).

### 6.5 Guide Hosting (Steam Workshop parallel)

- **Steam's model:** Opaque blobs (not structured), community rating (not editorial), no version control. Its value is distribution/marketing, not content quality.
- **Tennoplan's model should be better:** Structured Markdown guides stored in R2, linked to codex entries by `uniqueName` (so a guide about Saryn auto-appears in the Saryn entry), metadata + approval status in D1, rated by community with up/down.
- **What makes it unique:** Guides are *connected* to the knowledge graph. Writing a guide about "Viral + Slash meta" and referencing Condition Overload → that guide shows up in the Condition Overload codex entry automatically. No other app does this cross-linking.

### 6.6 Storage Architecture (Cloudflare free tier, confirmed 2026-06)

| Store | Free limits | Use for | Capacity check |
|---|---|---|---|
| **D1** | 100k writes/day, 5M reads/day, 5 GB | Annotations, guide metadata, approval queue, contributor table | ~40 MB for 8k items at 5KB each = trivial |
| **R2** | 10 GB, 1M writes/mo, 10M reads/mo, **free egress** | Ability clips (~1.5 GB), guide images, guide markdown | 300 clips × 5 MB = 1.5 GB fits; free bandwidth wins |
| **KV** | 1,000 writes/day (budget-constrained!) | Enrichment manifest (item → version hash); hot per-item approved JSON | Low-write manifest only; don't write per-item enrichment through KV |
| **Cache API** | Free | Edge-cache approved enrichment JSON responses | 60 s TTL, same as worldstate pattern |

**Recommended D1 schema (top-level):**
```sql
CREATE TABLE annotations (
  item_unique_name TEXT NOT NULL,
  annotation_type TEXT NOT NULL,  -- 'tldr' | 'mechanic_note' | 'synergy_tag' | 'ability_preview_url'
  content TEXT NOT NULL,          -- JSON payload
  contributor_id TEXT,
  status TEXT DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected'
  approved_by TEXT,
  approved_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE guides (
  guide_id TEXT PRIMARY KEY,       -- ulid
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  author_id TEXT NOT NULL,
  content_r2_key TEXT,             -- R2 path for markdown body
  status TEXT DEFAULT 'draft',
  linked_items TEXT NOT NULL,      -- JSON array of uniqueNames
  created_at INTEGER NOT NULL,
  published_at INTEGER,
  view_count INTEGER DEFAULT 0
);

CREATE TABLE contributors (
  contributor_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  reputation INTEGER DEFAULT 0,
  trusted BOOLEAN DEFAULT FALSE,
  joined_at INTEGER NOT NULL
);
```

**R2 path convention:**
```
/ability-previews/{uniqueName}/{abilityIndex}.webm
/ability-thumbnails/{uniqueName}/{abilityIndex}.jpg
/guide-content/{guide_id}.md
/guide-images/{guide_id}/{image_hash}.webp
```

### 6.7 What Would Be Unique in This Space (the bet)

No other Warframe companion app has ever:
1. **Surfaced wiki prose/annotations inline** (they link out) - you'd bring it in
2. **Cross-linked guides to codex entries by uniqueName** (guide about Saryn → appears in Saryn entry; no other app does knowledge-graph linking)
3. **Ability hover previews** (the game's own Codex does this; no companion app does)
4. **Dual-audience enrichment**: a "new player" layer (tldr, what-is-this, playstyle tags) + a "theory-crafter" layer (mechanic notes, ability interaction math, combo synergies) - same entry, different information density
5. **Offline-first community content** (guides and annotations cached in Dexie, available without network)

### 6.8 Maintenance Risk Assessment

**LOW maintenance:**
- D1 + Discord bot approval: no server to babysit; serverless
- CI seeds initial content; manual corrections only
- Community clips: zero obligation if no one submits (graceful absence)

**AVOID (high maintenance):**
- Scraping ability videos from warframe.com - breaks on UI updates
- Embedding YouTube iframes - Tauri sandboxing + ToS issues
- Full headless CMS (Contentful/Sanity) - overkill, adds vendor dependency
- Real-time collaborative editing - async Discord bot is 95% of value for 5% of effort
- Any scraper that requires per-patch manual fixes

**Filed under:** §2 (competitor dossiers), §4 (target architecture - Knowledge System = potential S7), §5 (operational knowledge).

---

### 6.9 Build model + newbie knowledge layer - corrected design + empty-entry audit (2026-06-14)

Refinements from the user that supersede earlier §6 phrasing:

- **Builds are user-created and community-ranked, NOT auto-linked guides.** Correct model: a
  dedicated **Builds section**; users author builds; the **top builds (best ~5+, by upvotes)**
  surface on the relevant weapon/warframe codex entry, **author credited by name**. This is
  Overframe's model + attribution + ranking (underframe §2.6 has none of it). Earlier §6.7's
  "guide auto-appears via content mention" is NOT the mechanism - surfacing is build→item by
  rank, not prose-keyword matching. Storage: uniqueName-keyed build serialization (Dexie now →
  D1 + share-links later, §2.3).
- **The reason the codex numbers are sacred:** builds + comparisons are pure functions of the
  codex data (cross-ref the calc-engine north-star). Correctness (§5 items 13–14) is the
  foundation; a builder on wrong numbers silently mis-ranks everything.
- **Newbie knowledge layer = the wedge.** Re-express mechanics / mod effects in OUR OWN words,
  simpler, for new players, and fill empty entries. Ship as **"BETA"**, gather Discord feedback
  from math/tech-savvy users, **fact-check before promoting**. Legal line (already in §6.2):
  facts/numbers are not copyrightable (free, no attribution); only wiki PROSE is CC-BY-SA - so
  original explanations are genuinely ours, just don't copy sentence structure.
- **Structured mod-effects = the hard missing model.** PE+ does NOT carry it (§5 item 14: only
  17/1596 mods have `upgradeEntries`). A builder needs `{targetStat, op, valuePerRank}`, not
  prose. Build incrementally via the BETA + vet loop - most load-bearing future data work.
- **Empty-entry audit (live codex, 2026-06-14)** - scope for "fill the empty entries":
  Arcanes **100% no description** (39% husk) → best pilot (bounded ~168, high value, underframe
  ignores them); Companions 74%; Resources 14% (192 husk); Blueprints 6%; Weapons 7%; Warframes
  & Relics ~complete. NOTE: the Mod "husk" count is a false signal - the generic check ignored
  `levelStats`/polarity/drain; mods need a mod-specific coverage metric, not the prose check.
- **Sequencing:** builder UI stays post-ship; foundation now = codex fidelity (multishot, Slice 2)
  + newbie prose / empty-entry fill + eventual `core/` calc engine. **Filed under §6; cross-ref
  §2.3 (build serialization), §2.6 (underframe), §4 (calc engine), §5 items 13–14.**

## 8. UI/UX & Presentation Patterns - Data Density, Responsive Compression & the Theme System (2026-06-11)

> **Why this section exists.** Tennoplan's #1 felt advantage over AlecaFrame must be *comfort in
> any window size*. AlecaFrame's drawback (user-reported): you couldn't shrink the window and keep
> seeing the data you wanted - nothing compressed smartly; it just stayed too big or clipped. DIM
> (Destiny Item Manager) is the gold standard for the opposite behavior and is **open-source
> (MIT)** - we can study and port its approach. This section is the canonical reference for *how
> data is presented, how it compresses as space shrinks, and how one change propagates app-wide.*
> Everything here joins back to the design system in `.impeccable.md` and the CSS class system in
> `src/index.css`.

### 8.0 The core principle: space is a budget, not a fixed canvas

Good data apps treat available width/height as a **continuous budget** and spend it in priority
order. As the budget shrinks, the UI *sheds* low-priority detail and *reflows* high-priority data
- it never just scales down uniformly or clips. The single biggest mistake (AlecaFrame's) is a
**fixed-layout mindset**: one designed size, then scrollbars/clipping when it doesn't fit. The fix
is four layered mechanisms, applied in this order of preference:

1. **Fluid reflow first** (no breakpoints) - CSS Grid `auto-fill/auto-fit` + `minmax()` so columns
   drop automatically as width shrinks. Free, continuous, no JS.
2. **Container queries second** (component-level) - each panel responds to *its own* width, not the
   window's. A bounty card in a narrow rail and the same card in a wide pane render differently
   from one component.
3. **Density tokens third** (global user/auto choice) - compact vs comfortable spacing/type, what
   we already started with `data-density`.
4. **Progressive disclosure last** (explicit drop order) - when even that isn't enough, hide
   secondary fields behind expand/`…`/hover, keeping them in the DOM for a11y.

> **Tennoplan rule:** reach for these in order. Don't write a media-query breakpoint when an
> `auto-fill` grid or a container query would do it continuously. Breakpoints are for *page
> skeleton* changes (sidebar→drawer), not for content cards.

### 8.1 DIM's playbook (the model to copy) - MIT, portable

DIM ([github.com/DestinyItemManager/DIM](https://github.com/DestinyItemManager/DIM),
[item-display deep-dive](https://deepwiki.com/DestinyItemManager/DIM/4.1-item-displays)) is a
dense item-management app that stays usable from phone to ultrawide. What it does, and what we take:

- **One sizing variable drives everything.** Item size is a single CSS custom property
  (`--item-size`) set from a user **"Item Size" slider** in settings. The inventory grid is
  `grid-template-columns: repeat(auto-fill, minmax(var(--item-size), 1fr))`; the icon, its border,
  badge text, and overlays all derive their dimensions from that same variable. **Change one
  number → the entire grid re-densifies.** This is the literal answer to the user's question "if I
  change a box, do all the similar boxes change?" - *yes, when they all read one variable.*
- **`InventoryItem` is the single reusable atom.** Every item everywhere (grid, loadout builder,
  search results) is the same component wrapped by `ConnectedInventoryItem` (state: tags, notes,
  wishlist). It renders icon + rarity border + progress bar + lock/new/tag indicators; special
  cases (subclasses get an SVG diamond border) are *variants of the one atom*, not new components.
  Memoized with `useMemo` so dense grids stay 60fps.
- **Two presentations of the same data: grid vs table ("Organizer").** The dense visual grid is for
  scanning; the **Organizer** is a tabular view with user-toggled columns, sort, filter, CSV
  export - the *same items* in a high-information table. Lesson: **let the user pick the
  representation; don't pick for them.** Tennoplan analog: a "gallery vs list/compare" toggle on
  codex categories and drop tables.
- **Works phone→desktop** because the grid reflows fluidly and the chrome (character columns)
  collapses, not the items.

**Take:** copy the `--item-size`-style single-variable sizing for every repeating collection
(codex grids, drop reward rows, bounty tiers, relic lists). Copy the grid-vs-table dual view.
Copy the "one memoized atom + variants" rule.

> **DON'T copy DIM's *density*, only its *mechanism*.** DIM's tiny 48-ish-px tiles fit DIM's
> data: thousands of *fungible, glanceable* inventory items where the icon basically **is** the
> whole record (you scan, you don't read). **Tennoplan's data is the opposite - richer per item,
> fewer of them:** a bounty carries tiers + rewards + a timer; a codex entry carries stats + drop
> sources; a cycle carries a clock + state. That data dies in a 48px tile. So: take DIM's
> *single-variable, reflowing-grid* mechanism, but set the variable **larger** and let each tile
> show real content (icon + name + 1–2 key facts), or drop the grid entirely for rows/cards when
> the record is read, not scanned. **Match the representation to the data's richness (§8.2),
> don't inherit DIM's chosen size.** The icon-grid default is a *DIM-data* choice, not a universal
> one. Per-collection size variables exist precisely so each data type gets its own right size.

### 8.2 The data-type → component map (what popular apps actually use)

Match the representation to the data's shape. Common, proven choices (DIM, Linear, Notion,
light.gg, Grafana, Wowhead):

| Data shape | Use | Avoid | Where in Tennoplan |
|---|---|---|---|
| **Single value vs a target / % to goal** | Radial gauge OR compact progress bar + number | Big pie for one number | Mastery rank progress, nightwave tier, standing-to-cap |
| **Cyclical / clock data** (day-night, time-left) | Radial ring / arc (clockwise from 12 o'clock) | Linear bar (loses the "cycle" metaphor) | Celestial Pendulum cycle rings (already doing this - correct) |
| **Precise comparison / ranking** (2 values 45% vs 47%) | **Linear** bar list, or a table | Radial bars (eye can't compare arcs accurately) | Drop-chance tables, plat-value compare, stat bars |
| **Many categories (>7)** | Sorted bar list or table, virtualized | Any radial form | Full drop tables, mod lists, item grids |
| **Part-to-whole, few slices** | Stacked bar or labeled donut | Pie with many slices | Polarity/forma cost breakdown |
| **Status / category membership** | Chip / pill / badge | Sentence text | Vaulted/Prime/faction tags, "owned" flags |
| **Item identity at a glance** | Icon tile (size-variable) + border-color semantics | Text-only rows | Codex grids, reward rows (ItemIcon already) |
| **A record with many attributes** | Table (priority columns) ↔ stacked card at narrow width | Wide table that h-scrolls on mobile | Organizer-style compare views |
| **Trend over time** | Sparkline (inline) / line chart (full) | Gauge | Future: market price history |

**Radial/gauge rules (sourced - Domo, ApexCharts):** great for *quick impression of one metric
vs a goal* and for *cyclic* data; **bad** for precise comparison or >5–7 categories; start at 12
o'clock, go clockwise; add reference ticks so users can read values. Our cycle rings are a
*correct* use (cyclical clock). Do **not** turn drop chances or stat comparisons into radials -
those need linear bars/tables.
Sources: [Domo radial bar](https://www.domo.com/learn/charts/radial-bar-chart),
[Domo gauge](https://www.domo.com/learn/charts/gauge-chart),
[ApexCharts radialBar](https://apexcharts.com/docs/chart-types/radialbar-gauge/).

### 8.3 The compression ladder - what collapses, in what order

When width (or a container's width) shrinks, components should walk *down* this ladder rather than
clip. Define each component's drop order explicitly:

1. **Reflow** - multi-column grid → fewer columns → one column (`auto-fill`/`minmax`).
2. **Shed chrome** - drop section labels, helper text, secondary metadata; keep the primary
   value + identity. (Progressive disclosure - keep in DOM, hide visually for a11y/screen readers.)
3. **Collapse table → cards** - a wide table becomes stacked "label: value" cards; use
   **priority columns** so the *least* important columns vanish first (DataTables `responsivePriority`
   / `data-priority` is the canonical pattern; lower number = stays longest).
4. **Iconify** - replace "icon + label + value" with "icon + value", label moves to tooltip/title.
5. **Densify type & spacing** - compact density tokens (smaller line-height, 8px gaps).
6. **Truncate + reveal** - ellipsis with hover/expand for the long tail; a "+N more" affordance.

Sources: [responsive table → cards](https://medium.com/appnroll-publication/5-practical-solutions-to-make-responsive-data-tables-ff031c48b122),
[DataTables column priority](https://datatables.net/extensions/responsive/examples/column-control/columnPriority.html),
[progressive disclosure (Nielsen, 1995)](https://ui-patterns.com/patterns/ProgressiveDisclosure),
[information density + progressive disclosure](https://www.algolia.com/blog/ux/information-density-and-progressive-disclosure-search-ux).

### 8.4 Container queries vs media queries - the rule that fixes AlecaFrame's flaw

The reason AlecaFrame "stayed too big" is almost certainly **viewport-only thinking**: components
sized to the *window* can't adapt when they're placed in a narrow rail or a resized pane. The 2025+
fix is **container queries** - a component responds to *its own container's* width.

- **Media queries** → page skeleton & OS prefs only: sidebar↔drawer, dark mode, reduced-motion,
  overall column count of the app shell.
- **Container queries** (`container-type: inline-size` on the wrapper, `@container (max-width: …)`
  inside the component) → *everything inside a panel*. A bounty card, a codex tile, a stat block:
  one component definition that renders dense in the 280px rail and roomy in the 700px pane -
  **without knowing where it lives.** This is exactly Tennoplan's observatory (rail + place-pane):
  the same card must work in both. Container queries are now widely shipped (Chrome/Safari/Firefox)
  - size queries are safe to use today; *style* queries are still partial, don't rely on them.
- Combine with **`clamp()`** for fluid type/spacing so values scale *between* the query breakpoints
  with no jumps: `font-size: clamp(0.8rem, 0.7rem + 0.5cqi, 1rem)` (note `cqi` = 1% of container
  inline size - pairs with container queries).

Sources: [MDN container queries](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Containment/Container_queries),
[LogRocket: container queries 2026 (not a silver bullet)](https://blog.logrocket.com/container-queries-2026/),
[clamp() fluid type & spacing](https://halcyonwebdesign.com.ph/the-complete-guide-to-css-clamp-for-fluid-typography-and-responsive-spacing/).

**Decision:** adopt container queries as the *default* responsive mechanism for feature components;
reserve media queries for `AppShell`/`Sidebar`/`Header` skeleton changes only. Add a
`container-type: inline-size` to the standard `.panel` wrapper so every panel becomes a query
context for free.

### 8.5 The theme/token system - "change one box and all the boxes change"

This is the user's central question, answered structurally. The mechanism that makes a single
change cascade app-wide is the **3-tier token architecture** (industry standard - Contentful,
GitLab Pajamas, Backbase):

1. **Primitive tokens** - raw values, no meaning: `--green-900: #080a08`, `--amber-400: #dbb058`.
2. **Semantic tokens** - *intent*, referencing primitives: `--color-bg-primary: var(--green-900)`,
   `--color-accent-gold: var(--amber-400)`. **Components only ever reference this tier.**
3. **Component tokens** (optional) - context-specific: `--panel-bg: var(--color-bg-secondary)`,
   `--item-size`, `--cycle-ring-track`.

Why it cascades: because every box reads `var(--panel-bg)` (never a hex), redefining `--panel-bg`
once - or swapping the whole semantic layer under a `[data-theme="…"]` selector - **re-skins every
panel simultaneously.** Dark/alt themes become "redefine the semantic tier", nothing else.
This is *already* how Tennoplan is set up (`.impeccable.md` Mutalist Glow `:root` tokens +
`data-density`); §8 just names the discipline and extends it:

- **Tighten the rule:** components reference **semantic** tokens only. The CLAUDE.md "never
  hardcode hex" rule is the enforcement; add "and never reference a *primitive* directly in a
  component - go through a semantic alias" so a re-theme never misses a box.
- **PNG vs SVG sections** (user's literal example): make decorative box ornaments **SVG that
  inherits `currentColor` / reads CSS vars**, mounted via one shared component (e.g. `<PanelFrame>`
  / a `mask-image`), *not* baked-in PNGs. Then a theme swap recolors all frames at once. A raster
  PNG can't be re-tinted reliably (our `ItemIcon` gold-tint is a CSS `filter` hack - fine for item
  art, wrong for chrome). **Rule: chrome/ornament = themeable SVG/CSS; only content art = raster.**
- **Theme switching mechanics:** put a `data-theme` attribute on `<html>` (same pattern as the
  existing `data-density`), with each theme block redefining the semantic tier. One attribute flip
  = whole-app re-skin, no React re-render of leaves needed (pure CSS cascade).

Sources: [Contentful: design token system](https://www.contentful.com/blog/design-token-system/),
[GitLab Pajamas tokens](https://design.gitlab.com/product-foundations/design-tokens/),
[dev/CSS-vars guide](https://penpot.app/blog/the-developers-guide-to-design-tokens-and-css-variables/).

### 8.6 Reusable-component discipline (the "one atom, many variants" rule)

Apps that stay consistent at scale (DIM, Linear, Notion) share one trait: **a small set of atoms
re-used everywhere with variant props**, never per-screen one-offs. The contract:

- **One component per data shape**, parameterized by `size`/`density`/`variant` props - not a new
  component per location. (Tennoplan already does this for `ItemIcon` with `size` presets and
  `CodexQuickLook` as the single smart-window - extend the habit to rows, tiles, stat blocks,
  chips, gauges.)
- **Size presets should read a variable, not a hardcoded px**, so a global density/size change
  flows through. (Refactor target: `ItemIcon`'s `SIZE_MAP` px values → `--item-size-*` tokens, so
  a grid's `--item-size` slider also resizes the icon, DIM-style.)
- **Compose chrome from shared frame components** (`<Panel>`, `<DataRow>`, `<StatBar>`, `<Chip>`,
  `<Gauge>`) that already exist as CSS classes (`.panel`, `.data-row`, …) - promote the most-reused
  to actual components so behavior (not just styling) is shared. Then a chrome change is one edit.
- **Build a `/components` "kitchen sink" preview route** (like a mini Storybook) showing every atom
  at every size/density/theme - the ModCard preview strip already proved this workflow valuable.

### 8.7 Concrete recommendations for Tennoplan (the action list)

Grounded in current code (`src/store/uiSettings.ts`, `ItemIcon.tsx`, `src/index.css`, `.impeccable.md`):

1. **Make density reactive & 3-step, not one-shot.** `uiSettings.ts` auto-detects viewport width
   *once* and offers only compact/standard. That's why a mid-session window-shrink doesn't
   re-compress (AlecaFrame's exact flaw). Options: (a) keep the sticky user choice but **also** let
   container queries handle in-session resize so density is the *floor*, not the only lever; (b)
   consider a 3rd "cozy" step. The biggest win is (a) - container queries make resize free.
2. **Adopt `auto-fill` + `minmax(var(--tile-size), 1fr)` for every collection grid** (codex,
   rewards, relics, mods). Add a per-collection size variable (DIM slider). One variable resizes
   the whole grid and reflows columns continuously - no breakpoints.
3. **Add `container-type: inline-size` to `.panel`.** Instantly makes every panel a query context;
   then write card internals against `@container`, so the observatory rail-card and pane-card are
   one component.
4. **Define drop-order for each repeating row/card** (§8.3 ladder): label the columns/fields with a
   priority so narrow widths shed the right things. Especially for drop tables and any future
   compare/Organizer view.
5. **Keep cycle rings radial (correct), keep drop/stat data linear.** Don't let the "orrery"
   aesthetic tempt radial encodings onto comparison data (§8.2).
6. **Promote the most-reused CSS classes to real variant components** + a kitchen-sink preview
   route. Convert `ItemIcon` sizes to read size tokens.
7. **Pre-wire a `data-theme` attribute** (mirror `data-density`) and ensure components reference
   only semantic tokens, so the eventual theme system is a CSS-only swap. Make box ornaments
   themeable SVG, not PNG.

**Filed under:** new §8 (this section is the canonical UI-presentation reference); cross-refs
`.impeccable.md` (design spec) and `src/index.css` (class system). Touches §1.11 (component
organization) and §4 (S3 Assets - the SVG-vs-PNG ornament rule).

---

## 7. Open Research Questions (the backlog - add here instead of starting a new chat)

- [x] ~~Exact license of `warframe-public-export-plus`~~ **RESOLVED 2026-06-12: no license
      declared anywhere** (no LICENSE file, no package.json license field, nothing in README).
      Decision: **fetch-at-build, never vendor** - CI runs `npm install --no-save
      warframe-public-export-plus@latest` per build; our published blob contains only
      transformed data (same posture as WFCD). Implemented in Codex v2 phase A.
- [ ] Windows.Media.Ocr accuracy on Warframe's reward-screen font vs Tesseract + custom
      training (WFInfo ships a trained eng model) - prototype before committing.
- [ ] warframe.market API v2 rate limits + ToS for automated listing management.
- [ ] Cheapest compliant proxy to revive official worldstate (small VPS? Deno Deploy? GH Actions
      relay is too slow) - only matters if warframestat.us reliability degrades.
- [ ] Web Push from a Cloudflare Worker (VAPID) for PWA/desktop notifications fed by the Pulse
      events stream - budget check: subscription storage (KV vs D1).
- [ ] Tauri 2 mobile (iOS/Android) maturity check closer to mobile phase; PWA as the stepping
      stone before app stores.
- [ ] EE.log line catalogue: which exact lines mark mission start/end, reward screen, relic
      opening, login. (WFInfo's source is the reference - Apache-2.0.)
- [ ] (§8) Container-query browser support floor for our Tauri webview (WebView2 / WKWebView
      versions) - confirm `@container` + `cqi` units are safe before making them the default.
- [ ] (§8) Pull DIM's actual inventory SCSS (`--item-size` + grid) from its MIT repo as concrete
      reference code for our collection-grid refactor.
- [ ] (§8) Decide the canonical chart primitive(s): hand-rolled SVG (zero-dep, full theme control)
      vs a tiny lib for radial rings + sparklines + bars - must read CSS vars for theming.
- [ ] (§8) Kitchen-sink/Storybook-lite preview route: build vs adopt a minimal harness; how it
      coexists with the no-router navigation store.

---

## 7. Entry Template (copy-paste for new findings)

```markdown
### YYYY-MM-DD - <short title>
- **Question / trigger:** what sent us researching
- **Finding:** the fact(s), with numbers
- **Source:** link(s)
- **License implication:** (if code/data)
- **Decision / action:** what Tennoplan does about it (or "none yet")
- **Filed under:** §<section> (also update that section if it changes a conclusion)
```

---

*Companion docs: `CLAUDE.md` (repo rules), `DATA_ARCHITECTURE.md` (current implementation map,
in-repo), `.impeccable.md` (design system). This dossier is for research findings and
decisions-with-sources; implementation detail lives in the repo docs.*
