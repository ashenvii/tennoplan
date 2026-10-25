/**
 * tennoIconMap — maps Warframe text-icon codes (e.g. <DT_SLASH_COLOR>) to
 * local asset URLs. Vite handles the asset imports and hashing.
 *
 * Source of truth for codes: https://wiki.warframe.com/w/Text_Icons
 * Codes appear in:
 *   - @wfcd/items mod `description` and `levelStats` strings (mods-map.json)
 *   - Worldstate descriptions
 *   - Future: Riven mod stat strings (same format)
 *
 * Adding a new code:
 *   1. Drop the icon into the appropriate src/assets/tennoicons/<folder>/
 *   2. Add a static import below
 *   3. Add the code → URL entry in TENNOICON_MAP
 */

// --- Damage type icons (the small color glyphs shown in-game) ---
import dmgImpact      from '@/assets/tennoicons/damage/DmgImpactSmall64.png';
import dmgPuncture    from '@/assets/tennoicons/damage/DmgPunctureSmall64.png';
import dmgSlash       from '@/assets/tennoicons/damage/DmgSlashSmall64.png';
import dmgHeat        from '@/assets/tennoicons/damage/DmgHeatSmall64.png';
import dmgCold        from '@/assets/tennoicons/damage/DmgColdSmall64.png';
import dmgElectricity from '@/assets/tennoicons/damage/DmgElectricitySmall64.png';
import dmgToxin       from '@/assets/tennoicons/damage/DmgToxinSmall64.png';
import dmgBlast       from '@/assets/tennoicons/damage/DmgBlastSmall64.png';
import dmgRadiation   from '@/assets/tennoicons/damage/DmgRadiationSmall64.png';
import dmgGas         from '@/assets/tennoicons/damage/DmgGasSmall64.png';
import dmgMagnetic    from '@/assets/tennoicons/damage/DmgMagneticSmall64.png';
import dmgViral       from '@/assets/tennoicons/damage/DmgViralSmall64.png';
import dmgCorrosive   from '@/assets/tennoicons/damage/DmgCorrosiveSmall64.png';
import dmgVoid        from '@/assets/tennoicons/damage/DmgVoidSmall64.png';
import dmgTau         from '@/assets/tennoicons/damage/DmgTauSmall64.png';
import dmgTrue        from '@/assets/tennoicons/damage/DmgTrueSmall64.png';

// --- Focus school clean variants (used for <MADURAI_CLEAN>, etc.) ---
import focusMadurai   from '@/assets/tennoicons/focus/IconFocusCleanMadurai(xWhite).png';
import focusNaramon   from '@/assets/tennoicons/focus/IconFocusCleanNaramon(xWhite).png';
import focusUnairu    from '@/assets/tennoicons/focus/IconFocusCleanUnairu(xWhite).png';
import focusVazarin   from '@/assets/tennoicons/focus/IconFocusCleanVazarin(xWhite).png';
import focusZenurik   from '@/assets/tennoicons/focus/IconFocusCleanZenurik(xWhite).png';

// --- Stats / HUD glyphs ---
import iconShield     from '@/assets/tennoicons/stats/IconShield.png';
import iconEnergy     from '@/assets/tennoicons/stats/IconEnergy.gif';
import iconHealth     from '@/assets/tennoicons/stats/IconHealth.gif';
import iconAffinity   from '@/assets/tennoicons/rank/MasteryAffinity64(xDark).png';

// --- Currency glyphs ---
import iconCredits    from '@/assets/tennoicons/currency/IconCredits.png';

/**
 * Code → asset URL. Unknown codes return `undefined` and the StatLine
 * component will strip them silently.
 */
export const TENNOICON_MAP: Record<string, string> = {
  // Damage — _COLOR variants (the canonical DE form, used in most strings)
  '<DT_IMPACT_COLOR>':      dmgImpact,
  '<DT_PUNCTURE_COLOR>':    dmgPuncture,
  '<DT_SLASH_COLOR>':       dmgSlash,
  '<DT_FIRE_COLOR>':        dmgHeat,        // DE uses FIRE for Heat
  '<DT_FREEZE_COLOR>':      dmgCold,        // DE uses FREEZE for Cold
  '<DT_ELECTRICITY_COLOR>': dmgElectricity,
  '<DT_POISON_COLOR>':      dmgToxin,       // DE uses POISON for Toxin
  '<DT_EXPLOSION_COLOR>':   dmgBlast,       // DE uses EXPLOSION for Blast
  '<DT_RADIATION_COLOR>':   dmgRadiation,
  '<DT_GAS_COLOR>':         dmgGas,
  '<DT_MAGNETIC_COLOR>':    dmgMagnetic,
  '<DT_VIRAL_COLOR>':       dmgViral,
  '<DT_CORROSIVE_COLOR>':   dmgCorrosive,
  '<DT_RADIANT_COLOR>':     dmgVoid,        // RADIANT = Void
  '<DT_SENTIENT>':          dmgTau,         // Sentient/Tau damage
  '<DT_SENTIENT_COLOR>':    dmgTau,         // alias — appears on Caliban abilities
  '<DT_TRUE_COLOR>':        dmgTrue,        // future-proofing

  // Damage — bare codes (no _COLOR suffix). DE uses these on a handful of
  // older mods (Meltdown, Short Circuit, Detonator, etc.); they render the
  // same glyph as their _COLOR equivalent. Mapped explicitly so the CI
  // token-scanner doesn't flag them on every build.
  '<DT_IMPACT>':            dmgImpact,
  '<DT_PUNCTURE>':          dmgPuncture,
  '<DT_SLASH>':             dmgSlash,
  '<DT_FIRE>':              dmgHeat,
  '<DT_FREEZE>':            dmgCold,
  '<DT_ELECTRICITY>':       dmgElectricity,
  '<DT_POISON>':            dmgToxin,
  '<DT_EXPLOSION>':         dmgBlast,
  '<DT_RADIATION>':         dmgRadiation,
  '<DT_GAS>':               dmgGas,
  '<DT_MAGNETIC>':          dmgMagnetic,
  '<DT_VIRAL>':             dmgViral,
  '<DT_CORROSIVE>':         dmgCorrosive,
  '<DT_RADIANT>':           dmgVoid,
  '<DT_TRUE>':              dmgTrue,

  // Focus
  '<MADURAI_CLEAN>':        focusMadurai,
  '<NARAMON_CLEAN>':        focusNaramon,
  '<UNAIRU_CLEAN>':         focusUnairu,
  '<VAZARIN_CLEAN>':        focusVazarin,
  '<ZENURIK_CLEAN>':        focusZenurik,

  // Stats / HUD
  '<HEALTH>':               iconHealth,
  '<SHIELD>':               iconShield,
  '<ENERGY>':               iconEnergy,
  '<AFFINITY_SHARE>':       iconAffinity,

  // Currency
  '<CREDITS>':              iconCredits,
};

/**
 * Non-icon codes — these have semantic meaning but render as text or trigger
 * styling. Handled in StatLine separately from the icon map.
 */
export const TENNOICON_TEXT_TOKENS: Record<string, string> = {
  '<LINE_SEPARATOR>': ' · ',
  // Typographic glyphs used in cosmetic item names ("File-A-Style™ Binder").
  '<RETRO_TM>':       '™',
};

/**
 * Codes that signal layout/styling rather than rendering anything. StatLine
 * strips these but may use them to add classNames in the future.
 */
export const TENNOICON_FLAG_CODES = new Set([
  '<LOWER_IS_BETTER>',
  '<SECONDARY_FIRE>',
  '<USE>',
  // Keybind notation in mod / ability rules text (e.g. "After casting
  // <ACTIVATE_ABILITY_1>"). The surrounding prose already names which
  // ability is meant; the glyph itself adds nothing in static text.
  '<ACTIVATE_ABILITY_1>',
  '<ACTIVATE_ABILITY_2>',
  '<ACTIVATE_ABILITY_3>',
  '<ACTIVATE_ABILITY_4>',
  '<ACTIVATE_ABILITY_5>',
  // Stance-combo prelude notation (Emergence Dissipate etc.). No icon.
  '<PRE_ATTACK>',
  // Unfilled value placeholder in Narin's Naraemagi ("Gain <OVERGUARD_GAIN>
  // Overguard"). Upstream ships the template variable, not a glyph, and there
  // is no Overguard icon asset. Stripped, same as StatLine already did.
  '<OVERGUARD_GAIN>',
]);
