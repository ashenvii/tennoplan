// ---------------------------------------------------------------------------
// Public Export Plus loader — Codex v2 phase A (source-first).
//
// warframe-public-export-plus (calamity-inc) republishes DE's OFFICIAL Public
// Export as an npm package, auto-updated on game patches: Export*.json data
// files keyed by uniqueName + dict.<lang>.json localization. It is GAME TRUTH
// — when WFCD's community data lags a patch, this is what's actually correct.
//
// Integration posture (deliberate):
//   • FETCH-AT-BUILD, never vendored. The repo has no declared license, so we
//     never copy its files into our tree; CI runs
//     `npm install --no-save warframe-public-export-plus@latest` right before
//     the build, and our published blob contains only transformed data —
//     the same posture we already hold toward WFCD. The package version is
//     recorded for provenance.
//   • OWN minimal interfaces below (only the fields we consume) rather than
//     importing their index.d.ts — decouples us from their type churn and
//     keeps `tsc` green when the 100MB package isn't installed (worker
//     deploys don't need it).
//   • fs-read of SELECTED files. The package's exports map blocks subpath
//     imports, and importing its index would load every category + all 15
//     language dicts (~100MB). We resolve the package directory and read
//     only what we use (~12MB).
//   • LAYER-OPTIONAL (dossier layering rule): when the package is absent or
//     unreadable, loadPePlus() returns null and the build proceeds WFCD-only,
//     exactly as today. PE+ can improve the build but never break it.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { logger } from '../../src/logger';

const log  = (msg: string, data?: unknown) => logger.info('codex-peplus', msg, data);
const warn = (msg: string, data?: unknown) => logger.warn('codex-peplus', msg, data);

// ─── Minimal record shapes (fields we consume only) ──────────────────────────

/** ExportWarframes entry — Suits, SpaceSuits (archwings), MechSuits. */
export interface PePowersuit {
  name:                string;   // dict key
  description?:        string;   // dict key
  health:              number;
  shield:              number;
  armor:               number;
  power:               number;
  sprintSpeed?:        number;
  masteryReq?:         number;
  codexSecret?:        boolean;
  productCategory:     'Suits' | 'SpaceSuits' | 'MechSuits';
  variantType?:        string;
}

/** One IAttackData damage block — NAMED damage-type keys (DT_IMPACT, DT_FIRE, …)
 *  plus a per-attack procChance. Self-describing: the key IS the type. */
export type PeAttackData = Record<string, number> & { procChance?: number };

/** PE+ projectile config — direct hit (`attack`), radial explosion
 *  (`explosiveAttack`), and embedded-projectile death burst (`embedDeathAttack`). */
export interface PeProjectile {
  attack?:          PeAttackData;
  explosiveAttack?: PeAttackData;
  embedDeathAttack?: PeAttackData;
}

/** One firing STATE from PE+ behaviours[]. `stateName` carries the trigger
 *  (…/Loadout_TriggerAuto|TriggerSemiAuto|TriggerCharge|TriggerContinous);
 *  `impact` is the direct hitscan block (a generic ~10-dmg placeholder when a
 *  projectile co-exists); `projectile`/`chargedProjectile` hold projectile +
 *  AoE splits. Absent stateName = melee. */
export interface PeBehaviour {
  stateName?:         string;
  fireIterations?:    number;
  burst?:             unknown;
  impact?:            PeAttackData;
  projectile?:        PeProjectile;
  chargedProjectile?: PeProjectile;
}

/** ExportWeapons entry. Crit/status are FRACTIONS (0.12) — same unit as WFCD. */
export interface PeWeapon {
  name:                string;   // dict key
  description?:        string;   // dict key
  totalDamage?:        number;
  /** Per-damage-type split for one shot/hit — a 20-slot array indexed by DE's
   *  damage-type enum (IAttackData key order: Impact/Puncture/Slash/Fire/…).
   *  Sums to totalDamage. The overlay maps it into TennoplanItem.damageTypes. */
  damagePerShot?:      number[];
  criticalChance?:     number;
  criticalMultiplier?: number;
  procChance?:         number;
  fireRate?:           number;
  multishot?:          number;   // base pellet count; >1 = innate multishot
  magazineSize?:       number;
  reloadTime?:         number;
  accuracy?:           number;
  omegaAttenuation?:   number;   // riven disposition
  masteryReq?:         number;
  trigger?:            string;   // "AUTO" | "SEMI" | ...
  noise?:              string;   // "ALARMING" | "SILENT"
  codexSecret?:        boolean;
  tradable?:           boolean;
  productCategory:     string;   // LongGuns | Pistols | Melee | ...
  variantType?:        string;
  /** Per-firing-state damage structure (direct/radial/charge/alt-fire). PE+'s
   *  README prefers this over the flat damagePerShot for anything richer than a
   *  single hit. Consumed by deriveFireModes in the overlay. */
  behaviours?:         PeBehaviour[];
  // ── Melee scalars (productCategory === 'Melee' etc.) ──
  slamRadius?:            number;
  slideAttack?:           number;
  heavyAttackDamage?:     number;
  heavySlamAttack?:       number;
  heavySlamRadialDamage?: number;
  heavySlamRadius?:       number;
  windUp?:                number;
}

/** ExportUpgrades entry (mods). NO levelStats prose for most rows — WFCD
 *  stays authoritative for per-rank stat lines; PE+ owns the structure. */
export interface PeUpgrade {
  name:                string;   // dict key
  description?:        string;   // dict key (often absent)
  polarity?:           string;   // "AP_DEFENSE" | ...
  rarity?:             string;   // "COMMON" | "UNCOMMON" | "RARE" | "LEGENDARY"
  baseDrain?:          number;
  fusionLimit?:        number;   // max rank
  compatName?:         string;   // dict key
  type?:               string;
  codexSecret?:        boolean;
  tradable?:           boolean;
}

/** ExportArcanes entry. */
export interface PeArcane {
  name:                string;   // dict key
  description?:        string;   // dict key
  rarity?:             string;
  codexSecret?:        boolean;
}

/** ExportRecipes entry — the crafting recipe that builds `resultType`. */
export interface PeRecipe {
  resultType:          string;   // uniqueName of the built item
  buildPrice?:         number;   // credits to build
  creditsCost?:        number;   // credits (mirror of buildPrice)
  buildTime?:          number;   // seconds in the foundry
  skipBuildTimePrice?: number;   // platinum to rush
}

/** ExportChallenges entry. Only the field we consume. */
export interface PeChallenge {
  /** How many times the objective must be done ("Kill |COUNT| Enemies"). */
  requiredCount?: number;
}

export interface PePlusData {
  warframes: ReadonlyMap<string, PePowersuit>;
  weapons:   ReadonlyMap<string, PeWeapon>;
  mods:      ReadonlyMap<string, PeUpgrade>;
  arcanes:   ReadonlyMap<string, PeArcane>;
  /** Crafting recipes keyed by `resultType` (the built item's uniqueName). */
  recipes:   ReadonlyMap<string, PeRecipe>;
  /** Challenges (Nightwave etc.) keyed by uniqueName. Empty if the package has no ExportChallenges.json. */
  challenges: ReadonlyMap<string, PeChallenge>;
  /** English localization: dict key → display string. */
  dict:      Record<string, string>;
  /** Package version, recorded for provenance (e.g. "0.6.2"). */
  version:   string;
}

// ─── Loader ───────────────────────────────────────────────────────────────────

/**
 * Load Public Export Plus from node_modules. Returns null when the package
 * is not installed or any file is unreadable — callers treat that as
 * "layer absent" and build WFCD-only.
 */
export function loadPePlus(): PePlusData | null {
  let root: string;
  try {
    // exports-map encapsulation blocks `require('pkg/ExportWeapons.json')`;
    // resolving the entry point and reading siblings with fs does not care.
    const require = createRequire(import.meta.url);
    root = dirname(require.resolve('warframe-public-export-plus'));
  } catch {
    warn('warframe-public-export-plus not installed — PE+ layer skipped (WFCD-only build)');
    return null;
  }

  try {
    const t0 = Date.now();
    const read = <T>(file: string): T => JSON.parse(readFileSync(join(root, file), 'utf8')) as T;

    const warframes = read<Record<string, PePowersuit>>('ExportWarframes.json');
    const weapons   = read<Record<string, PeWeapon>>('ExportWeapons.json');
    const mods      = read<Record<string, PeUpgrade>>('ExportUpgrades.json');
    const arcanes   = read<Record<string, PeArcane>>('ExportArcanes.json');
    const recipesRaw = read<Record<string, PeRecipe>>('ExportRecipes.json');
    const dict      = read<Record<string, string>>('dict.en.json');
    // Optional: a missing or unreadable challenges file must not drop the whole layer.
    let challenges: Record<string, PeChallenge> = {};
    try { challenges = read<Record<string, PeChallenge> | null>('ExportChallenges.json') ?? {}; }
    catch { warn('ExportChallenges.json unreadable, challenge counts stay unresolved'); }
    const version   = read<{ version?: string }>('package.json').version ?? 'unknown';

    // Recipes are keyed by recipe id; we index by resultType (the built item)
    // so an item can look up its own build cost by uniqueName.
    const recipes = new Map<string, PeRecipe>();
    for (const r of Object.values(recipesRaw)) {
      if (r && typeof r.resultType === 'string') recipes.set(r.resultType, r);
    }

    const data: PePlusData = {
      warframes: toMap(warframes),
      weapons:   toMap(weapons),
      mods:      toMap(mods),
      arcanes:   toMap(arcanes),
      recipes,
      challenges: toMap(challenges),
      dict,
      version,
    };

    log('loaded Public Export Plus', {
      ms: Date.now() - t0,
      version,
      warframes: data.warframes.size,
      weapons:   data.weapons.size,
      mods:      data.mods.size,
      arcanes:   data.arcanes.size,
      recipes:   data.recipes.size,
      challenges: data.challenges.size,
      dictKeys:  Object.keys(dict).length,
    });
    return data;
  } catch (e) {
    warn('failed to read PE+ files — layer skipped (WFCD-only build)', {
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

function toMap<T>(record: Record<string, T>): ReadonlyMap<string, T> {
  return new Map(Object.entries(record));
}

/** Resolve a dict key to its English display string; undefined when absent. */
export function peName(data: PePlusData, dictKey: string | undefined): string | undefined {
  if (!dictKey) return undefined;
  return data.dict[dictKey];
}
