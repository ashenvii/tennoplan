// ---------------------------------------------------------------------------
// Public Export Plus authority overlay — Codex v2 phase A.
//
// Runs AFTER enrichCodex, BEFORE normalizeCodex. Two jobs:
//
// 1. AUTHORITY OVERRIDE (matched uniqueNames). PE+ is DE's own export, so
//    for fields both sources carry, PE+ wins — this is what makes the codex
//    correct in the hours/days after a patch while WFCD lags. Rules:
//      • NUMERIC stats are overridden (units verified identical: crit/status
//        are fractions in both; WFCD copies the same Public Export numbers,
//        so values only diverge when WFCD is stale — exactly when we want
//        the override).
//      • ENUM/string fields are FILL-ONLY (normalized to our conventions).
//        WFCD's casing ("Auto", "vazarin") is what the frontend renders;
//        we never fight it, only patch holes.
//      • Mod per-rank levelStats / descriptions stay WFCD — PE+ ships mod
//        STRUCTURE (polarity, drain, rarity, max rank), not display prose.
//
// 2. GAP REPORT + SYNTHESIS (unmatched uniqueNames). Items in PE+ but not in
//    the build are the patch-day gap — brand-new items WFCD hasn't shipped
//    yet. We synthesize minimal codex entries for them (name via dict.en,
//    category via productCategory, stats where present) so new items exist
//    in Tennoplan on day one; the next WFCD catch-up build enriches them
//    with icons/drops/components automatically (same uniqueName = same row).
//
// The whole stage is a no-op when PE+ wasn't loaded (layer-optional).
// ---------------------------------------------------------------------------

import type { EnrichedItem } from '../../src/codex/enricher';
import type { ItemStats, ItemRarity, WeaponFireMode, WeaponAttack } from '../../src/types';
import type { PePlusData, PePowersuit, PeWeapon, PeUpgrade, PeRecipe, PeChallenge, PeBehaviour, PeAttackData } from './peplus';
import { peName } from './peplus';
import { fillChallengeCount } from './challengeCounts';
import { logger } from '../../src/logger';

const log = (msg: string, data?: unknown) => logger.info('codex-peplus-overlay', msg, data);

// ─── Report shape ─────────────────────────────────────────────────────────────

export interface OverlayReport {
  /** PE+ package version the overlay ran against. */
  peVersion:        string;
  /** Items matched by uniqueName, per overlaid category. */
  matched:          Record<string, number>;
  /** Matched items where at least one numeric stat actually changed —
   *  the "WFCD was stale here" signal. Expect ~0 normally, spikes post-patch. */
  statDivergence:   Record<string, number>;
  /** Enum/string holes filled from PE+. */
  enumFills:        number;
  /** Weapons whose per-type damage breakdown was authored from PE+
   *  damagePerShot (matched + synthesized). PE+ ships melee splits WFCD omits,
   *  so this exceeds WFCD's damage-map coverage. */
  damageBreakdowns: number;
  /** Weapons where the mapped damagePerShot sum deviated >2% from totalDamage —
   *  a slot reorder/new-type signal (non-fatal; schema guard owns the hard fail). */
  damageSumWarnings: number;
  /** Weapons given structured fireModes[] from PE+ behaviours[] (radial AoE
   *  split / charge / beam / burst / alt-fire). Subset with interesting structure. */
  fireModeWeapons:  number;
  /** Melee weapons given the heavy/slide/slam-radius/wind-up scalars PE+ carries
   *  that the WFCD codex lacks. */
  meleeScalarWeapons: number;
  /** Mods given a computed Endo-to-max upgrade cost (matched + synthesized). */
  upgradeCosts:     number;
  /** Items given a foundry build cost from ExportRecipes (any category). */
  buildCosts:       number;
  /** Challenge descriptions whose `|COUNT|` was filled from ExportChallenges.requiredCount. */
  challengeCounts:  number;
  /** Descriptions still holding `|COUNT|` because PE+ has no challenge for that uniqueName. */
  challengeCountsUnresolved: number;
  /** PE+ records with no codex row (after junk filters) — the patch-day gap. */
  peOnly:           Record<string, number>;
  /** Of those, how many we synthesized into minimal entries. */
  synthesized:      number;
  /** Codex rows in overlaid categories with no PE+ record (WFCD-only;
   *  usually modular/virtual items DE doesn't export individually). */
  wfcdOnly:         Record<string, number>;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export function applyPePlusAuthority(items: EnrichedItem[], pe: PePlusData): OverlayReport {
  const t0 = Date.now();

  const report: OverlayReport = {
    peVersion:      pe.version,
    matched:         {},
    statDivergence:  {},
    enumFills:       0,
    damageBreakdowns:  0,
    damageSumWarnings: 0,
    fireModeWeapons:   0,
    meleeScalarWeapons: 0,
    upgradeCosts:      0,
    buildCosts:        0,
    challengeCounts:   0,
    challengeCountsUnresolved: 0,
    peOnly:          {},
    synthesized:     0,
    wfcdOnly:        {},
  };

  const byUniqueName = new Map(items.map((i) => [i.uniqueName, i]));

  // ── 1. Authority override on matched rows ──
  for (const item of items) {
    switch (item.category) {
      case 'Warframe': overlayWarframe(item, pe.warframes.get(item.uniqueName), report); break;
      case 'Weapon':   overlayWeapon(item, pe.weapons.get(item.uniqueName), report);     break;
      case 'Mod':      overlayMod(item, pe.mods.get(item.uniqueName), pe, report);       break;
      default: break;
    }
    // Build cost applies to ANY craftable item, regardless of category.
    applyBuildCost(item, pe.recipes.get(item.uniqueName), report);
    resolveChallengeCount(item, pe.challenges.get(item.uniqueName), report);
  }

  // ── 2. Gap report + synthesis ──
  synthesizeMissing(items, byUniqueName, pe, report);

  log('PE+ authority applied', { ms: Date.now() - t0, ...report });
  return report;
}

// ─── Challenge counts ─────────────────────────────────────────────────────────

/**
 * Nightwave challenge text is a template ("Kill |COUNT| Enemies while Aim
 * Gliding"). PE+ carries the real requirement as requiredCount, joined on the
 * exact uniqueName. Anything without a match keeps the token, and the app
 * shows a readable fallback for it instead of inventing a number.
 */
function resolveChallengeCount(item: EnrichedItem, challenge: PeChallenge | undefined, report: OverlayReport): void {
  if (!item.description?.includes('|COUNT|')) return;
  const filled = fillChallengeCount(item.description, challenge?.requiredCount);
  if (filled === null) {
    report.challengeCountsUnresolved++;
    return;
  }
  item.description = filled;
  report.challengeCounts++;
}

// ─── Per-category overlays ────────────────────────────────────────────────────

function overlayWarframe(item: EnrichedItem, peRec: PePowersuit | undefined, report: OverlayReport): void {
  if (!peRec) { bump(report.wfcdOnly, 'Warframe'); return; }
  bump(report.matched, 'Warframe');

  const diverged = overrideStats(item, {
    health:      peRec.health,
    shield:      peRec.shield,
    armor:       peRec.armor,
    energy:      peRec.power,
    sprintSpeed: peRec.sprintSpeed,
  });
  if (typeof peRec.masteryReq === 'number') item.masteryRank = peRec.masteryReq;
  if (diverged) bump(report.statDivergence, 'Warframe');
}

function overlayWeapon(item: EnrichedItem, peRec: PeWeapon | undefined, report: OverlayReport): void {
  if (!peRec) { bump(report.wfcdOnly, 'Weapon'); return; }
  bump(report.matched, 'Weapon');

  const diverged = overrideStats(item, {
    damage:           peRec.totalDamage,
    critChance:       peRec.criticalChance,
    critMultiplier:   peRec.criticalMultiplier,
    statusChance:     peRec.procChance,
    fireRate:         peRec.fireRate,
    magazine:         peRec.magazineSize,
    reload:           peRec.reloadTime,
    accuracy:         peRec.accuracy,
    rivenDisposition: peRec.omegaAttenuation,
  });
  if (typeof peRec.masteryReq === 'number') item.masteryRank = peRec.masteryReq;

  // Multishot — store only innate (>1); single-shot weapons default to 1 in
  // display/calc, so storing 1 on every rifle would be pure blob bloat.
  if (typeof peRec.multishot === 'number' && peRec.multishot > 1) {
    (item.stats ??= {}).multishot = peRec.multishot;
  }

  // Damage-type breakdown — PE+ authority over WFCD's `damage` map. PE+'s
  // damagePerShot is the per-type split that sums to totalDamage (verified 0
  // mismatch across 647 weapons), so it corrects post-patch drift AND fills
  // melee, which WFCD ships no `damage` map for (the DamageStrip's known gap).
  const dmg = deriveDamageTypes(peRec.damagePerShot, peRec.totalDamage, report);
  if (dmg) { item.damageTypes = dmg; report.damageBreakdowns++; }

  // Structured fire modes — behaviours[] carries the direct-vs-radial AoE split,
  // charge vs base, beam flag and alt-fire/Incarnon profiles the flat field can't.
  const fireModes = deriveFireModes(peRec.behaviours, isMeleeCategory(peRec.productCategory));
  if (fireModes) { item.fireModes = fireModes; report.fireModeWeapons++; }

  // Melee scalars PE+ carries that the WFCD codex lacks entirely
  // (heavy/slide/slam-radius/wind-up). Additive — no WFCD value to override.
  if (applyMeleeScalars(item, peRec)) report.meleeScalarWeapons++;

  // Enum fills — WFCD casing is the display convention; only patch holes.
  if (!item.weaponTrigger && peRec.trigger) { item.weaponTrigger = normalizeTrigger(peRec.trigger); report.enumFills++; }
  if (!item.weaponNoise && peRec.noise)     { item.weaponNoise   = titleCase(peRec.noise);          report.enumFills++; }

  if (diverged) bump(report.statDivergence, 'Weapon');
}

function overlayMod(item: EnrichedItem, peRec: PeUpgrade | undefined, pe: PePlusData, report: OverlayReport): void {
  if (!peRec) { bump(report.wfcdOnly, 'Mod'); return; }
  bump(report.matched, 'Mod');

  if (typeof peRec.baseDrain === 'number') {
    if (item.baseDrain !== undefined && item.baseDrain !== peRec.baseDrain) bump(report.statDivergence, 'Mod');
    item.baseDrain = peRec.baseDrain;
  }

  // Fill-only: polarity school, rarity, compat label, tradability.
  if (!item.polarity && peRec.polarity) {
    const school = AP_TO_SCHOOL[peRec.polarity];
    if (school) { item.polarity = school; report.enumFills++; }
  }
  if (!item.rarity && peRec.rarity) {
    const rarity = asRarity(peRec.rarity);
    if (rarity) { item.rarity = rarity; report.enumFills++; }
  }
  if (!item.compatName && peRec.compatName) {
    const compat = peName(pe, peRec.compatName);
    if (compat) { item.compatName = compat; report.enumFills++; }
  }
  if (item.tradeable === undefined && typeof peRec.tradable === 'boolean') {
    item.tradeable = peRec.tradable;
    report.enumFills++;
  }

  // Upgrade cost — Endo to fully rank, from the resolved rarity + PE+ max rank.
  const endo = modEndoToMax(item.rarity, peRec.fusionLimit);
  if (endo !== undefined) { item.upgradeCost = { endoToMax: endo }; report.upgradeCosts++; }
}

// ─── Synthesis of PE+-only items (the patch-day gap) ──────────────────────────

/** productCategory → our ItemCategory, for records we synthesize confidently. */
const WEAPON_CATEGORIES = new Set([
  'LongGuns', 'Pistols', 'Melee', 'SpaceGuns', 'SpaceMelee',
  'SentinelWeapons', 'SpecialItems', 'DrifterMelee', 'OperatorAmps',
]);

function synthesizeMissing(
  items:        EnrichedItem[],
  byUniqueName: Map<string, EnrichedItem>,
  pe:           PePlusData,
  report:       OverlayReport,
): void {
  const push = (item: EnrichedItem, gapKey: string) => {
    bump(report.peOnly, gapKey);
    items.push(item);
    byUniqueName.set(item.uniqueName, item);
    report.synthesized++;
  };

  for (const [uniqueName, rec] of pe.warframes) {
    if (byUniqueName.has(uniqueName) || skipRecord(uniqueName, rec.codexSecret)) continue;
    const name = peName(pe, rec.name);
    if (!name) continue;
    const item = baseSynthetic(uniqueName, name, 'Warframe', peName(pe, rec.description));
    item.subtype = rec.productCategory;
    const stats: ItemStats = {};
    if (rec.health > 0) stats.health = rec.health;
    if (rec.shield > 0) stats.shield = rec.shield;
    if (rec.armor  > 0) stats.armor  = rec.armor;
    if (rec.power  > 0) stats.energy = rec.power;
    if (typeof rec.sprintSpeed === 'number' && rec.sprintSpeed > 0) stats.sprintSpeed = rec.sprintSpeed;
    if (Object.keys(stats).length > 0) item.stats = stats;
    if (typeof rec.masteryReq === 'number') item.masteryRank = rec.masteryReq;
    push(item, 'Warframe');
  }

  for (const [uniqueName, rec] of pe.weapons) {
    if (byUniqueName.has(uniqueName) || skipRecord(uniqueName, rec.codexSecret)) continue;
    if (!WEAPON_CATEGORIES.has(rec.productCategory)) continue;
    const name = peName(pe, rec.name);
    if (!name) continue;
    const item = baseSynthetic(uniqueName, name, 'Weapon', peName(pe, rec.description));
    item.subtype = rec.productCategory;
    const stats: ItemStats = {};
    if (typeof rec.totalDamage        === 'number' && rec.totalDamage        > 0) stats.damage           = rec.totalDamage;
    if (typeof rec.criticalChance     === 'number' && rec.criticalChance     > 0) stats.critChance       = rec.criticalChance;
    if (typeof rec.criticalMultiplier === 'number' && rec.criticalMultiplier > 0) stats.critMultiplier   = rec.criticalMultiplier;
    if (typeof rec.procChance         === 'number' && rec.procChance         > 0) stats.statusChance     = rec.procChance;
    if (typeof rec.fireRate           === 'number' && rec.fireRate           > 0) stats.fireRate         = rec.fireRate;
    if (typeof rec.magazineSize       === 'number' && rec.magazineSize       > 0) stats.magazine         = rec.magazineSize;
    if (typeof rec.reloadTime         === 'number' && rec.reloadTime         > 0) stats.reload           = rec.reloadTime;
    if (typeof rec.omegaAttenuation   === 'number' && rec.omegaAttenuation   > 0) stats.rivenDisposition = rec.omegaAttenuation;
    if (typeof rec.multishot          === 'number' && rec.multishot          > 1) stats.multishot        = rec.multishot;
    if (Object.keys(stats).length > 0) item.stats = stats;
    const dmg = deriveDamageTypes(rec.damagePerShot, rec.totalDamage, report);
    if (dmg) { item.damageTypes = dmg; report.damageBreakdowns++; }
    const fireModes = deriveFireModes(rec.behaviours, isMeleeCategory(rec.productCategory));
    if (fireModes) { item.fireModes = fireModes; report.fireModeWeapons++; }
    if (applyMeleeScalars(item, rec)) report.meleeScalarWeapons++;
    if (typeof rec.masteryReq === 'number') item.masteryRank   = rec.masteryReq;
    if (rec.trigger)                        item.weaponTrigger = normalizeTrigger(rec.trigger);
    if (rec.noise)                          item.weaponNoise   = titleCase(rec.noise);
    if (typeof rec.tradable === 'boolean')  item.tradeable     = rec.tradable;
    push(item, 'Weapon');
  }

  for (const [uniqueName, rec] of pe.mods) {
    if (byUniqueName.has(uniqueName) || skipRecord(uniqueName, rec.codexSecret)) continue;
    const name = peName(pe, rec.name);
    if (!name) continue;
    const item = baseSynthetic(uniqueName, name, 'Mod', peName(pe, rec.description));
    if (typeof rec.baseDrain === 'number')  item.baseDrain = rec.baseDrain;
    if (rec.polarity && AP_TO_SCHOOL[rec.polarity]) item.polarity = AP_TO_SCHOOL[rec.polarity];
    const rarity = rec.rarity ? asRarity(rec.rarity) : undefined;
    if (rarity) item.rarity = rarity;
    const compat = peName(pe, rec.compatName);
    if (compat) item.compatName = compat;
    if (typeof rec.tradable === 'boolean') item.tradeable = rec.tradable;
    const endo = modEndoToMax(item.rarity, rec.fusionLimit);
    if (endo !== undefined) { item.upgradeCost = { endoToMax: endo }; report.upgradeCosts++; }
    push(item, 'Mod');
  }

  for (const [uniqueName, rec] of pe.arcanes) {
    if (byUniqueName.has(uniqueName) || skipRecord(uniqueName, rec.codexSecret)) continue;
    const name = peName(pe, rec.name);
    if (!name) continue;
    const item = baseSynthetic(uniqueName, name, 'Arcane', peName(pe, rec.description));
    const rarity = rec.rarity ? asRarity(rec.rarity) : undefined;
    if (rarity) item.rarity = rarity;
    push(item, 'Arcane');
  }
}

/** Riven templates and other internal/virtual rows that must never become
 *  codex entries. codexSecret marks hidden/unreleased content. */
function skipRecord(uniqueName: string, codexSecret: boolean | undefined): boolean {
  if (codexSecret) return true;
  if (uniqueName.includes('/Randomized/')) return true;   // riven mod templates
  return false;
}

function baseSynthetic(
  uniqueName:  string,
  name:        string,
  category:    EnrichedItem['category'],
  description: string | undefined,
): EnrichedItem {
  const item: EnrichedItem = {
    uniqueName,
    name,
    category,
    iconUrl:       '',          // validator accepts; frontend renders placeholder
    dropLocations: [],          // new items have no drop data yet by definition
    _qualityHints: ['peplus-only'],
  };
  if (description) item.description = description;
  return item;
}

// ─── Normalization helpers ────────────────────────────────────────────────────

/**
 * Override numeric stats in place; returns true when an existing value
 * MEANINGFULLY changed. Tolerance is relative (0.1%) because WFCD serializes
 * float32 round-trips (0.25999999) where PE+ writes clean decimals (0.26) —
 * those are the same number, not a balance change, and counting them made
 * the divergence signal useless (578/634 weapons "diverged" on noise).
 */
function overrideStats(item: EnrichedItem, updates: Partial<ItemStats>): boolean {
  let diverged = false;
  let stats = item.stats;
  for (const [key, value] of Object.entries(updates)) {
    if (typeof value !== 'number' || value <= 0) continue;   // never zero a stat
    if (!stats) stats = item.stats = {};
    const prev = stats[key];
    if (prev !== undefined && Math.abs(prev - value) > Math.abs(value) * 1e-3) diverged = true;
    stats[key] = value;
  }
  return diverged;
}

/**
 * PE+ `damagePerShot` slot index → our lowercase UI damage-type key (the same
 * vocabulary WFCD's `damage` map and WeaponSummaryCard's damageIconFor speak,
 * so no frontend change is needed). The slot order mirrors the IAttackData key
 * declaration in PE+'s shipped index.d.ts (DT_IMPACT, DT_PUNCTURE, DT_SLASH,
 * DT_FIRE, …) and was verified against live data: slots 0–13 are the standard
 * elements and the mapped sum equals totalDamage for every weapon. Slot 15
 * (DT_FINISHER) and slot 19 (the cinematic slot on Wukong's Shadow Clones)
 * carry "true" damage. Unmapped/unused slots are skipped. The schema guard
 * marks damagePerShot critical; deriveDamageTypes' sum check catches a reorder.
 */
const DPS_INDEX_TO_KEY: readonly (string | undefined)[] = [
  'impact', 'puncture', 'slash', 'heat', 'cold', 'electricity', 'toxin', 'blast',
  'radiation', 'gas', 'magnetic', 'viral', 'corrosive', 'void',
  undefined, 'true', undefined, undefined, undefined, 'true',
];

/**
 * Map a PE+ damagePerShot array into TennoplanItem.damageTypes (absolute damage
 * per lowercase type). Returns undefined when there's no usable breakdown so the
 * caller keeps WFCD's map. Bumps report.damageSumWarnings when the mapped sum
 * drifts >2% from totalDamage (a slot reorder/new-type tell — non-fatal).
 */
function deriveDamageTypes(
  dps:    number[] | undefined,
  total:  number | undefined,
  report: OverlayReport,
): Record<string, number> | undefined {
  if (!Array.isArray(dps)) return undefined;
  const out: Record<string, number> = {};
  let sum = 0;
  for (let i = 0; i < dps.length; i++) {
    const v = dps[i];
    if (!(v > 0)) continue;
    const key = DPS_INDEX_TO_KEY[i];
    if (!key) continue;                       // unmapped/special slot
    out[key] = (out[key] ?? 0) + v;
    sum += v;
  }
  if (sum <= 0) return undefined;
  if (typeof total === 'number' && total > 0 && Math.abs(sum - total) > total * 0.02) {
    report.damageSumWarnings++;
  }
  return out;
}

// ─── Structured fire modes from behaviours[] ──────────────────────────────────

/** PE+ named DT_* damage-type keys → our lowercase UI vocabulary (same words as
 *  DPS_INDEX_TO_KEY / WeaponSummaryCard). DT_EXPLOSION→blast is the key one: it's
 *  the radial AoE the flat damagePerShot lumps into the impact total. */
const DT_TO_KEY: Record<string, string> = {
  DT_IMPACT: 'impact', DT_PUNCTURE: 'puncture', DT_SLASH: 'slash',
  DT_FIRE: 'heat', DT_FREEZE: 'cold', DT_ELECTRICITY: 'electricity', DT_POISON: 'toxin',
  DT_EXPLOSION: 'blast', DT_RADIATION: 'radiation', DT_GAS: 'gas', DT_MAGNETIC: 'magnetic',
  DT_VIRAL: 'viral', DT_CORROSIVE: 'corrosive', DT_RADIANT: 'void',
  DT_FINISHER: 'true', DT_SENTIENT: 'sentient',
};

const MELEE_CATEGORIES = new Set(['Melee', 'SpaceMelee', 'DrifterMelee']);
function isMeleeCategory(productCategory: string): boolean {
  return MELEE_CATEGORIES.has(productCategory);
}

/** Melee scalar fields PE+ carries that WFCD/the codex does not — heavy & slide
 *  attacks, slam radii, heavy-attack wind-up. Names match ItemStats 1:1. */
const MELEE_SCALARS = [
  'slamRadius', 'slideAttack', 'heavyAttackDamage', 'heavySlamAttack',
  'heavySlamRadialDamage', 'heavySlamRadius', 'windUp',
] as const;

/** Copy the PE+ melee scalars onto a melee weapon's stats (additive, >0 only).
 *  Returns true when at least one was written. */
function applyMeleeScalars(item: EnrichedItem, peRec: PeWeapon): boolean {
  if (!isMeleeCategory(peRec.productCategory)) return false;
  let wrote = false;
  for (const f of MELEE_SCALARS) {
    const v = peRec[f];
    if (typeof v === 'number' && v > 0) { (item.stats ??= {})[f] = v; wrote = true; }
  }
  return wrote;
}

/** One IAttackData block → WeaponAttack; undefined when it has no positive,
 *  mappable damage. procChance becomes statusChance. */
function attackFrom(block: PeAttackData | undefined): WeaponAttack | undefined {
  if (!block) return undefined;
  const damage: Record<string, number> = {};
  for (const [k, v] of Object.entries(block)) {
    if (k === 'procChance') continue;
    if (typeof v !== 'number' || !(v > 0)) continue;
    const key = DT_TO_KEY[k];
    if (!key) continue;                                  // unmapped exotic slot
    damage[key] = (damage[key] ?? 0) + v;
  }
  if (Object.keys(damage).length === 0) return undefined;
  const attack: WeaponAttack = { damage };
  if (typeof block.procChance === 'number' && block.procChance > 0) attack.statusChance = block.procChance;
  return attack;
}

/** The generic ~10-damage quick-melee placeholder impact (3.33/3.33/3.33, proc
 *  0.1) PE+ attaches to alt-fire/projectile behaviours — never the real hit. */
function isPlaceholderImpact(b: PeAttackData | undefined): boolean {
  if (!b) return false;
  return Math.abs((b.DT_IMPACT ?? 0) - 3.33333) < 0.02
      && Math.abs((b.DT_PUNCTURE ?? 0) - 3.33333) < 0.02
      && Math.abs((b.DT_SLASH ?? 0) - 3.33334) < 0.02;
}

function triggerFromState(stateName: string | undefined): string | undefined {
  if (!stateName) return undefined;
  if (/TriggerCharge/.test(stateName))    return 'Charge';
  if (/TriggerContinous/.test(stateName)) return 'Held';
  if (/TriggerSemiAuto/.test(stateName))  return 'Semi';
  if (/TriggerAutoBurst/.test(stateName)) return 'Auto Burst';
  if (/TriggerBurst/.test(stateName))     return 'Burst';
  if (/TriggerDuplex/.test(stateName))    return 'Duplex';
  if (/TriggerAuto/.test(stateName))      return 'Auto';
  return undefined;
}

/**
 * Map PE+ behaviours[] → WeaponFireMode[]. For each firing state, the direct hit
 * is taken from chargedProjectile > projectile > a non-placeholder impact (so
 * the quick-melee placeholder impact drops whenever a real projectile exists),
 * and explosiveAttack becomes the radial AoE component. Returns undefined unless
 * the result carries structure the flat damageTypes can't (radial / charge /
 * beam / burst / >1 mode), keeping the blob lean.
 */
function deriveFireModes(
  behaviours: PeBehaviour[] | undefined,
  isMelee:    boolean,
): WeaponFireMode[] | undefined {
  if (!Array.isArray(behaviours) || behaviours.length === 0) return undefined;

  const modes: WeaponFireMode[] = [];
  for (const b of behaviours) {
    const isBeam  = !!b.stateName && /TriggerContinous/.test(b.stateName);
    const trigger = triggerFromState(b.stateName);

    let directBlock: PeAttackData | undefined;
    let radialBlock: PeAttackData | undefined;
    if (b.chargedProjectile) {                           // charge weapons: full-charge headline
      directBlock = b.chargedProjectile.attack;
      radialBlock = b.chargedProjectile.explosiveAttack;
    } else if (b.projectile) {
      directBlock = b.projectile.attack;
      radialBlock = b.projectile.explosiveAttack;
    } else if (b.impact && !isPlaceholderImpact(b.impact)) {
      directBlock = b.impact;                            // hitscan / beam
    }

    const direct = attackFrom(directBlock);
    if (!direct) continue;                               // no real damage in this state

    const mode: WeaponFireMode = { name: '', direct };
    const radial = attackFrom(radialBlock);
    if (radial) mode.radial = radial;
    if (trigger) mode.trigger = trigger;
    if (isBeam) mode.isBeam = true;
    if (typeof b.fireIterations === 'number' && b.fireIterations > 1) mode.burst = b.fireIterations;
    modes.push(mode);
  }

  if (modes.length === 0) return undefined;
  labelModes(modes, isMelee);

  const interesting = modes.length > 1
    || modes.some((m) => m.radial || m.isBeam || m.burst || m.trigger === 'Charge');
  return interesting ? modes : undefined;
}

/** Assign honest, simple labels in place — ranged: Normal/Charged/Beam then Alt
 *  Fire; melee: Melee then Thrown (glaives). */
function labelModes(modes: WeaponFireMode[], isMelee: boolean): void {
  modes.forEach((m, i) => {
    if (isMelee) {
      m.name = i === 0 ? 'Melee' : 'Thrown';
    } else if (i === 0) {
      m.name = m.isBeam ? 'Beam' : m.trigger === 'Charge' ? 'Charged' : 'Normal';
    } else {
      m.name = 'Alt Fire';
    }
  });
}

/**
 * Foundry build cost from the item's recipe (keyed by resultType = uniqueName).
 * Requires a real buildTime; credits fall back across buildPrice/creditsCost.
 * Applies to any craftable item.
 */
function applyBuildCost(item: EnrichedItem, recipe: PeRecipe | undefined, report: OverlayReport): void {
  if (!recipe || typeof recipe.buildTime !== 'number' || recipe.buildTime <= 0) return;
  const credits = recipe.buildPrice ?? recipe.creditsCost;
  item.buildCost = {
    credits:   typeof credits === 'number' && credits > 0 ? credits : 0,
    buildTime: recipe.buildTime,
    ...(typeof recipe.skipBuildTimePrice === 'number' && recipe.skipBuildTimePrice > 0
      ? { rushPlatinum: recipe.skipBuildTimePrice }
      : {}),
  };
  report.buildCosts++;
}

/**
 * Total Endo to rank a mod from 0 to max, via DE's fusion formula:
 *   endoToMax = 10 × rarityNum × (2^maxRank − 1)
 * rarityNum: Common 1, Uncommon 2, Rare 3, Legendary 4. PE+'s rarity field
 * already encodes the cost tier (Primed/Umbra/Archon → Legendary, Galvanized/
 * Amalgam/Riven → Rare), verified against known mods (Vitality 10230, Primed
 * Continuity 40920, Galvanized Aptitude 30690). Returns undefined when rarity
 * or max rank is unknown / max rank is 0.
 */
const RARITY_FUSION_NUM: Record<string, number> = { Common: 1, Uncommon: 2, Rare: 3, Legendary: 4 };

function modEndoToMax(rarity: string | undefined, maxRank: number | undefined): number | undefined {
  if (!rarity || typeof maxRank !== 'number' || maxRank <= 0) return undefined;
  const n = RARITY_FUSION_NUM[rarity];
  if (!n) return undefined;
  return 10 * n * (2 ** maxRank - 1);
}

/** DE polarity tags → our lowercase school names (same map WFCD uses). */
const AP_TO_SCHOOL: Record<string, string> = {
  AP_ATTACK:    'madurai',
  AP_DEFENSE:   'vazarin',
  AP_TACTIC:    'naramon',
  AP_POWER:     'zenurik',
  AP_WARD:      'unairu',
  AP_PRECEPT:   'penjaga',
  AP_UMBRA:     'umbra',
  AP_UNIVERSAL: 'universal',
  AP_ANY:       'universal',
};

function normalizeTrigger(trigger: string): string {
  const map: Record<string, string> = {
    AUTO:        'Auto',
    SEMI:        'Semi',
    BURST:       'Burst',
    HELD:        'Held',
    CHARGE:      'Charge',
    ACTIVE:      'Active',
    DUPLEX:      'Duplex',
    AUTOBURST:   'Auto Burst',
  };
  return map[trigger] ?? titleCase(trigger);
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function asRarity(raw: string): ItemRarity | undefined {
  switch (raw.toUpperCase()) {
    case 'COMMON':    return 'Common';
    case 'UNCOMMON':  return 'Uncommon';
    case 'RARE':      return 'Rare';
    case 'LEGENDARY': return 'Legendary';
    default:          return undefined;
  }
}

function bump(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}
