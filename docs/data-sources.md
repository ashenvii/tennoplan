# Tennoplan Data Sources - Coverage Map

> Field-by-field coverage of the data sources. Written 2026-05-27 and not re-verified since; check the codex build before trusting a count. How the data flows is in [architecture.md](architecture.md).

> **What this document is:** A complete inventory of every data field, image, and piece of metadata your current sources can give you - and just as importantly, what they **can't**. Use this when designing codex views, tab features, or any UI that depends on Warframe data, so you don't design around fields that don't exist.
>
> **Last verified:** 2026-05-27 against the live `build-codex.ts` pipeline (worker version `wfcd-20260527`, 8,973 items in production).

---

## TL;DR - what you have, at a glance

| Layer | Source | Used for | Refresh |
|---|---|---|---|
| **Item universe** | WFCD `warframe-items` via `api.warframestat.us` + GitHub raw fallback | Codex (mods, frames, weapons, sentinels, pets, arcanes, relics, resources, gear, misc) | Every 6h via GitHub Actions |
| **Drop tables** | WFCD `warframe-drop-data` (`drops.warframestat.us/data/all.json`) | Per-item drop locations, chances, rotations | Every 6h, bundled into codex blob |
| **Live worldstate** | `api.warframestat.us/pc/` | Cycle timers, fissures, sorties, Nightwave, Baro, bounties, EDA | Every 5 min via Cloudflare cron |
| **Icons / images** | `cdn.warframestat.us/img/<imageName>` | Single square icon per item | Static CDN |
| **Market prices** | `api.warframe.market/v2/` | NOT integrated yet - available, not pulled | - |
| **Wiki content** | `wiki.warframe.com` (no API) | Deep links only via `wikiaUrl` field | - |

**Total codex items in production right now:** 8,973
**Total drops indexed:** ~25,000+ (per-item, after inversion)

---

## 1. WFCD `warframe-items` - the item universe

Your single source of truth for everything that isn't drops or worldstate. Primary endpoint is `api.warframestat.us/<category>?only=<fields>` (smaller payload via field filtering); fallback is `raw.githubusercontent.com/WFCD/warframe-items/master/data/json/<Category>.json` (full payload). Some categories use GitHub raw as both primary and fallback because `api.warframestat.us` doesn't expose them.

### Per-category breakdown

#### Mods (~1,800)

**Endpoint:** `api.warframestat.us/mods?only=...`

| Field | Type | Notes |
|---|---|---|
| `uniqueName` | string | Internal DE ID, primary key |
| `name` | string | Display name |
| `description` | string | Flavor text |
| `levelStats` | `Array<{stats: string[]}>` | **Per-rank stat lines.** `levelStats[0]` = R0, `levelStats[N]` = max rank. Each `stats` is an array of formatted strings like `"+165% Damage"`. ~10% of mods legitimately lack this (stance variants, focus ways, mod-set tokens). |
| `polarity` | string | `madurai` \| `vazarin` \| `naramon` \| `zenurik` \| `unairu` \| `penjaga` \| `umbra` \| `aura` \| `universal` \| `none` |
| `rarity` | string | `Common` \| `Uncommon` \| `Rare` \| `Legendary` |
| `baseDrain` | number | Energy cost at R0 |
| `compatName` | string | Short label shown on the mod card: `"SHOTGUN"`, `"WARFRAME"`, `"ASH"`, `"POLEARMS"`, `"FOCUS WAY"`, etc. |
| `imageName` | string | Filename on `cdn.warframestat.us/img/` |
| `isAugment` | boolean | True for warframe augment mods |
| `isExilus` | boolean | True for utility/cosmetic Exilus-slot mods |
| `modSet` | string | Set uniqueName when this mod is part of one (Augur, Vigilante, etc.) |
| `tradable` | boolean | |
| `type` | string | Internal category |
| `wikiaUrl` | string | Direct wiki.warframe.com link |
| `releaseDate` | string | ISO date |
| `transmutable` | boolean | Can appear in mod transmutation |
| `introduced` | `{name, date, url, parent}` | Which update added it |
| `patchlogs` | `Array<{name, date, url, additions, changes, fixes}>` | **Capped at 20 most-recent entries per mod** (Ash alone has 135 - cap protects worker payload). |

#### Warframes (~58)

**Endpoint:** `api.warframestat.us/warframes?only=...`

| Field | Type | Notes |
|---|---|---|
| `uniqueName`, `name`, `description` | string | |
| `polarities` | string[] | Slot polarities (in order) |
| `aura` | string | Aura slot polarity (separate field) |
| `abilities` | `Array<{uniqueName, name, description, imageName}>` | **No per-rank stats, no energy cost, no scaling info - only flavor text + icon.** This is a hard limit, see §6. |
| `components` | `Array<{name, itemCount, uniqueName, description, imageName, tradable, drops}>` | Chassis / Neuroptics / Systems / Blueprint. `drops` is pre-joined with location/chance/rarity. |
| `health`, `shield`, `armor`, `power`, `sprintSpeed` | number | Base stats at R0 |
| `imageName` | string | Frame splash icon |
| `type` | string | |
| `masterable` | boolean | Whether it grants MR XP |
| `isPrime` | boolean | |
| `wikiaUrl`, `releaseDate`, `introduced`, `patchlogs` | - | Same as Mods |

#### Weapons (~700 - Primary + Secondary + Melee + Arch-*)

**Endpoint:** `api.warframestat.us/weapons?only=...`

| Field | Type | Notes |
|---|---|---|
| `uniqueName`, `name`, `description` | string | |
| `type` | string | `Rifle` \| `Shotgun` \| `Pistol` \| `Bow` \| `Sniper` \| `Melee` \| etc. |
| `category` | string | `Primary` \| `Secondary` \| `Melee` \| `Arch-Gun` \| `Arch-Melee` |
| `productCategory` | string | Internal DE category |
| `masteryReq` | number | MR required to equip |
| `totalDamage` | number | Combined damage per shot |
| `fireRate`, `criticalChance`, `criticalMultiplier`, `procChance`, `magazineSize`, `reloadTime` | number | Base stats |
| `components` | array | Build parts (same shape as Warframes) |
| `polarities` | string[] | |
| `imageName`, `wikiaUrl`, `releaseDate`, `introduced`, `patchlogs`, `tradable`, `isPrime` | - | |

#### Sentinels (~12)

**Endpoint:** GitHub raw only (api.warframestat.us 404s on this route)

Fields: `uniqueName`, `name`, `description`, `health`, `shield`, `armor`, `components`, `abilities`, `polarities`, `masteryReq`, `imageName`, `wikiaUrl`, `releaseDate`, `tradable`, `isPrime`, `introduced`, `patchlogs`.

#### Pets (~20 - Kubrows, Kavats, Predasites, Vulpaphylas, MOAs, Hounds)

**Endpoint:** GitHub raw only

Same shape as Sentinels, plus `type` field distinguishing the pet category.

#### Arcanes (168 - all captured, including the 51 that the old pipeline dropped)

**Endpoint:** GitHub raw only (api.warframestat.us shape didn't match)

Fields: `uniqueName`, `name`, `description`, `rarity`, `levelStats` (per-rank), `imageName`, `wikiaUrl`, `type`, `tradable`, `releaseDate`, `introduced`, `patchlogs`.

#### Relics (~500)

**Endpoint:** GitHub raw only

| Field | Type | Notes |
|---|---|---|
| `uniqueName`, `name`, `description` | string | |
| `rewards` | `Array<{itemName, rarity, chance, rotation}>` | What the relic drops |
| `imageName`, `wikiaUrl` | string | |
| `vaulted` | boolean | Currently vaulted by DE |
| `tier` | string | `Lith` \| `Meso` \| `Neo` \| `Axi` \| `Requiem` |
| `locations` | string[] | Free-text where to farm the relic itself |

#### Resources (~150) + Misc (~80) + Gear (~40)

**Endpoint:** GitHub raw only

Resources covers most farming materials. **Misc** is WFCD's catch-all for the core resources `/resources` misses (Orokin Cell, Argon Crystal, Neural Sensors, Forma, Orokin Catalyst, Reactor, etc.). Gear is consumables (ciphers, restores, archgun deployer, etc.).

Fields: `uniqueName`, `name`, `description`, `type`, `category`, `imageName`, `wikiaUrl`, `tradable`, and Resources adds `parents` (items this resource is a component of).

### WFCD fields available but NOT currently pulled (cheap-win expansion)

These fields exist in the raw WFCD JSON but are excluded from your `?only=` filter or your parser. Adding them is one line per field. Payload cost is modest (~2× per category at most).

**Weapons:**
- `damage` - **per-damage-type breakdown**: Impact/Puncture/Slash/Cold/Heat/Electricity/Toxin/Blast/Corrosive/Gas/Magnetic/Radiation/Viral. Currently you only have `totalDamage`.
- `attacks` - per-attack stats for melee: normal swing, heavy attack, slam attack, slide attack, ground slam radius.
- `accuracy`, `noise` (Alarming/Silent), `trigger` (Auto/Semi/Charge/Burst/Held), `disposition` (1.0–1.6, the riven multiplier)
- `zoom`, `secondary` (alt-fire stats for weapons like Stahlta)
- `omegaAttenuation`, `buildPrice`, `buildTime`, `marketCost`, `skipBuildTimePrice`, `consumeOnBuild`

**Warframes:**
- `passiveDescription` - **the passive ability text**, currently missing entirely
- `sex`, `buildPrice`, `buildTime`, `skipBuildTimePrice`, `bpCost`, `consumeOnBuild`

**Mods:**
- `availability` - text describing where the mod is earnable (separate from drops)
- `fusionLimit`, `numFusions`, `excludeFromCodex`

**Universal:**
- `productCategory`, `excludeFromCodex`, `tags`, `subtypes`

### WFCD categories you're not fetching at all

These exist in `warframe-items` (or could be added to fetch config) but aren't currently in your pipeline:

- **Skins** (`Skins.json`) - Warframe/weapon skins, Tennogen, Deluxe variants. **Available.**
- **Quests** (`Quests.json`) - quest names, rewards, prerequisites. **Available but WFCD coverage is incomplete upstream.**
- **Fish** (`Fish.json`) - Cetus/Fortuna/Cambion/Zariman fishing. **Available.**
- **Sigils, Glyphs, Emotes, Sugatras** - scattered across Misc/Cosmetics, partial.
- **Mining ore/gems** - partially in Resources.

### Definitively NOT in WFCD (any of its repos)

- **Enemies / Codex creatures** - health, armor, shield, faction, damage resistance tables. Not in `warframe-items`. Wiki only.
- **Per-tile node geometry / tilesets** - `warframe-worldstate-data` has `solNodes.json` (mission name, planet, faction, type) but no map data.
- **Focus trees** - individual focus way stats per pip. Wiki only.
- **Helminth subsume table** - which subsume goes on which slot, costs. Wiki only.
- **Lich/Sister/Coda ephemera + per-element bonuses + quirks** - wiki only.
- **Riven disposition history** - current snapshot only.
- **Conclave PvP stats** - none.

---

## 2. WFCD `warframe-drop-data` - the drops blob

**Source:** `drops.warframestat.us/data/all.json` (primary) / `raw.githubusercontent.com/WFCD/warframe-drop-data/master/data/all.json` (fallback).

One ~7 MB JSON blob, location-keyed. Your parser at [`cloudflare-worker/src/codex/parser.ts:1047`](cloudflare-worker/src/codex/parser.ts) inverts it to per-item.

### Sections walked

| Section | What it gives | Parser fn |
|---|---|---|
| `missionRewards` | Every planet/node/rotation/Steel-Path drop | `walkMissionRewards` |
| `relics` | Every relic × state (Intact/Exceptional/Flawless/Radiant) × reward | `walkRelics` |
| `sortieRewards` | Daily sortie pool | `walkSortieRewards` |
| `arbitrationRewards` | Arbitration A/B/C rotations | `walkArbitration` |
| `transientRewards` | Event drops | `walkTransient` |
| `blueprintLocations` | Where each blueprint comes from | `walkBlueprintLocs` |
| `modLocations` | Mod drops from named enemies (`enemyName` + chance) | `walkModByDrop` |
| `keyRewards` | Derelict / dragon key rewards | `walkKeyRewards` |
| `cetusBountyRewards` | Cetus bounties | `walkBounty('Cetus')` |
| `solarisBountyRewards` | Fortuna bounties | `walkBounty('Fortuna')` |
| `deimosRewards` | Cambion bounties | `walkBounty('Cambion')` |
| `zarimanRewards` | Zariman bounties | `walkBounty('Zariman')` |
| `entratiLabRewards` | Entrati Vaults bounties | `walkBounty('Entrati Vaults')` |

### Per-drop fields (after inversion → `DropLocation`)

```ts
uniqueName        // parent item this drop belongs to
location          // human label, e.g. "Hepit, Void"
sourceName        // "Void Fissure" | "Mission" | "Bounty" | etc.
chance            // 0.0 – 1.0
rotation          // 'A' | 'B' | 'C'
rarity            // 'Common' | 'Uncommon' | 'Rare' | 'Legendary' | 'Cosmic'
isSteelPath       // boolean
voidFissureTier   // 'Lith' | 'Meso' | 'Neo' | 'Axi' | 'Requiem'
bountyTier        // 'Lv1-5' | 'Lv6-10' | ...
isDailyDeal       // boolean
cooldown          // hours
```

Plus per-drop context (preserved during parsing): planet, node, missionType, relicTier/name/state, bountyLocation/tier/stage, rawLocation.

### Drop data gaps & weak coverage

- **Conjunction Survival, Disruption demolyst rotations, Granum Crown rotations** - sometimes missing rotation labels; parser silently drops them.
- **Lich / Sister / Coda weapons** - drop chances per murmur tier are not consistently in this dataset.
- **Eidolons / Profit-Taker / Orphix / Archons** - partial; some entries list reward names with no `chance`.
- **Railjack** - node-level drops only, not per-component.
- **Duviri Spiral** - sparse coverage.
- **Event-exclusive rewards** - appear in `transientRewards` but go stale once the event ends.

---

## 3. Live worldstate (`api.warframestat.us/pc/`)

Used by your worker for `/v1/worldstate`, served separately from codex. Cached in KV with 5-min cron refresh.

### Fields parsed today ([`cloudflare-worker/src/types.ts:76`](cloudflare-worker/src/types.ts))

| Field | Notes |
|---|---|
| **Cycles:** `cetusCycle`, `orbVallisCycle`, `cambionDriftCycle`, `zarimanCycle`, `duviriCycle`, `earthCycle` | Each: activation, expiry, timeLeft, state (day/night/warm/cold/fass/vome/grineer/corpus). Duviri also has `mood`. |
| `fissures` | id, node, missionType, tier, enemy, expiry, isHard (Steel Path), isStorm (Void Storm) |
| `alerts` | id, node, missionType, level, expiry, reward, description |
| `invasions` | id, node, attacking, defending, attackerReward, defenderReward, progress (0–100), vsInfestation, completed |
| `sortie` | id, missionTypes, modifiers, expiry, rewards, faction |
| `archonHunt` | id, missions, expiry, boss, faction |
| `arbitration` | node, missionType, enemy, modifier, expiry |
| `baro` | id, name, presence (`at_location` / `in_transit`), arrival/departure, location, inventory (name + ducats + credits) |
| `flashSales` | item, discount %, expiry |
| `nightwave` | season, tier, expiry, full `challenges` array (daily/weekly/elite with title, description, reputation, expiry) |
| `persistentEnemies` | name, location, level (Stalker, G3, Zanuka) |
| `news` | id, title, description, url, date |
| `syndicateMissions` | Cetus / Fortuna / Necralisk / Zariman bounty rotations: type, enemyLevels, standingStages, rewardPool |
| `simaris` | Active synthesis target (name, type, isArchwing, isBoss) |
| `archimedeas` | EDA / ETA / Netracell weekly rotation: missions (faction + missionType + deviation + risks), personalModifiers |

### Worldstate fields available upstream but NOT pulled

- `dailyDeals` (Darvo's daily deal)
- `globalUpgrades` (XP boosters etc.)
- `kuvaMissions` / `kuvaSiphons` (current Kuva node)
- `voidTraderMods` (full Baro inventory; partial today)
- `events` (full event metadata: boss, scoring, leaderboards)
- `constructionProgress` (Fomorian/Razorback meter)
- `vaultTrader` (Entrati Necralisk vault rotations)

---

## 4. Icons & images - what visuals you have

| Source | What it gives | URL pattern |
|---|---|---|
| `cdn.warframestat.us/img/<imageName>` | **One square icon per item** - extracted from game files | `https://cdn.warframestat.us/img/<imageName>` |
| WFCD ability `imageName` | Ability slot icon (diamond/circle UI element) | same CDN |
| `wikiaUrl` field | Direct link to wiki.warframe.com page | per-item field |

### Visual data you do NOT have access to via any API

- ❌ **In-game screenshots** of warframes/weapons from multiple angles
- ❌ **Concept art**
- ❌ **Ability video previews** (DE's official YouTube clips exist but aren't in any structured feed)
- ❌ **Skin/cosmetic previews** beyond one thumbnail
- ❌ **Tileset / level imagery**
- ❌ **Codex enemy renders** beyond what's on the wiki
- ❌ **Animated mod card visuals** (the holographic mod animation)

**The wiki has all of this** but `wiki.warframe.com` has **no JSON/REST API** - only MediaWiki's `api.php` returning HTML/wikitext. To use it you'd need to scrape, parse infoboxes/gallery tags, and respect CC BY-SA attribution.

---

## 5. Market prices (`warframe.market` v2)

Mentioned in `CLAUDE.md` as a data source but **not currently integrated into the codex pipeline.**

**Available:** orders (buy/sell, platinum prices, online status), recent statistics (48h volume + median price), item icons (their own CDN), set vs part relations, item slugs.

**Limitation:** Only tradable items. Non-tradable warframes/weapons/mods → no price data.

**Integration cost if you want it:** new fetcher in worker, new KV bucket, rate-limit handling (warframe.market has stricter limits than WFCD). Probably its own 6h-cron build job similar to codex.

---

## 6. Hard limitations - what you CANNOT get from any current source

These need a new data source (wiki scrape, community-maintained spreadsheet, or game-file parsing) to provide:

1. **Ability mechanics & scaling** - duration, range, energy cost, base damage values, mod-affected stats. WFCD only has the flavor description + icon.
2. **Build orders / popular meta builds** - Overframe.gg has this but no public API; warframe-builder.com has limited export.
3. **Riven dispositions history** (current snapshot only).
4. **Lich / Sister / Coda quirks tables** + ephemera + per-element bonuses.
5. **Steel Path Incursions rotation** (daily, not surfaced clearly anywhere).
6. **Focus way detailed stats per pip.**
7. **Helminth subsume mappings + costs.**
8. **Conclave / PvP stats.**
9. **Open-world fishing/mining spawn rates** (day/night dependencies, hotspot timing).
10. **Tenno Specters / Companion AI behavior data.**
11. **Enemy codex entries** - health/armor/shield scaling, faction, damage types they take, drop tables linked from the enemy side.
12. **Full DE patch notes text** - you get titles + dates + truncated summary fields via WFCD `patchlogs`, capped at 20 entries per item.

---

## Design implications - what this means for your UI

When designing codex / wiki views, you can confidently rely on:

✅ Item name, description, single icon, rarity, tradability, mastery req
✅ For frames/weapons: stats block (health/shield/armor/power for frames; damage/fire rate/crit/status/magazine/reload for weapons)
✅ For mods: per-rank stat lines, polarity, drain, set affiliation, compat label
✅ For arcanes: per-rank stat lines, rarity, type
✅ For relics: tier, vaulted flag, full reward table with rarity + chance
✅ Drop locations (with chance, rotation, planet/node/bounty tier, Steel Path flag)
✅ Wiki deep link
✅ Patch history (most recent 20 entries with date + url + additions/changes/fixes)
✅ "Introduced in" tag (update name + date)
✅ Build components (with item counts + their drops)

**Design around but be careful with:**

⚠️ Abilities - you have name + description + icon, but **no scaling, no energy cost, no per-rank values**. Don't design an "ability calculator" view.
⚠️ Ability icons - they're the UI slot icons, not full ability art / video.
⚠️ Multiple images - there's only one icon per item. Don't design gallery / carousel views unless you're prepared to scrape the wiki.
⚠️ Quests - coverage is incomplete in WFCD. Don't promise a complete quest tracker.
⚠️ Enemies - no data at all. Don't design enemy stat cards yet.

**Hard "do not design for":**

❌ Ability damage numbers or scaling formulas
❌ In-game screenshots / concept art / cinematics
❌ Per-tile mission layouts
❌ Focus tree visualization with stats
❌ Helminth subsume planning UI
❌ Riven roll history / disposition history
❌ Build calculator with energy/duration/range scaling
❌ Enemy codex with stats

---

## Cheap-win expansion roadmap (not yet implemented)

When you're ready to add the "richer WFCD fields" you already approved, here's the concrete checklist:

1. **Expand `?only=` filters** in [`cloudflare-worker/src/config.ts:45-54`](cloudflare-worker/src/config.ts) to include the new fields.
2. **Add fields to `WfcdWeapon` / `WfcdWarframe` / `WfcdMod` interfaces** in [`cloudflare-worker/src/codex/parser.ts:91-145`](cloudflare-worker/src/codex/parser.ts).
3. **Surface them on `TennoplanItem`** (extend `ItemStats` and add new top-level fields) in [`cloudflare-worker/src/types.ts:355-445`](cloudflare-worker/src/types.ts).
4. **Pipe them through the enricher.**
5. **Bump `version`** so cache invalidates → CI auto-rebuilds on next 6h tick.

**Payload cost estimate:** weapons category goes from ~250 KB → ~600 KB. Still well within KV's 25 MB blob limit (current full codex is ~3 MB). No infrastructure changes needed.

---

*Generated 2026-05-27 from a live audit of the build-codex pipeline. Re-verify against `cloudflare-worker/src/` if anything in this doc seems wrong - the code is the truth, this is a snapshot.*
