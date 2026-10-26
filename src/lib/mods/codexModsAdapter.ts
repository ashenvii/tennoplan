/**
 * codexModsAdapter — live-codex backed access to mod data.
 *
 * Replaces the build-time `modsAdapter.ts` (which reads a frozen
 * mods-map.json) with a Dexie-backed view over `tennoplanItems` where
 * category === 'Mod'. The codex is synced by StaticDataService from the
 * Cloudflare Worker's /v1/codex endpoint, so mod data self-updates when
 * DE patches the game and the Worker re-runs.
 *
 * Shape parity:
 *   The exported `ModEntry` mirrors the legacy adapter's shape so
 *   downstream components (ModCardV3, ModDetailModal, ModPage,
 *   modFrameAssetsV3) need only an import-path swap.
 *
 * Hooks (useLiveQuery-backed):
 *   • useAllMods()           → ModEntry[] | undefined
 *   • useAllCompatNames()    → string[] | undefined
 *   • useModByUniqueName(id) → ModEntry | undefined
 *
 * Loading semantics: `undefined` while Dexie reads, [] when codex is
 * empty (never synced or no mods passed the validator).
 */

import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/adapters/storage/db';
import { getIconUrl } from '@/lib/icons/IconResolver';
import type { TennoplanItem, PatchLogEntry, IntroducedInfo } from '@/core/domain/tennoplanApi';
import { dedupeMods } from './dedupeMods';
import modsRawMap from './mods-map.json';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ModRarity = 'Common' | 'Uncommon' | 'Rare' | 'Legendary';

export type ModPolarity =
  | 'madurai'
  | 'vazarin'
  | 'naramon'
  | 'zenurik'
  | 'unairu'
  | 'penjaga'
  | 'umbra'
  | 'aura'
  | 'universal'
  | 'none';

export interface ModEntry {
  uniqueName:  string;
  name:        string;
  imageName:   string | null;
  rarity:      ModRarity;
  drain:       number;
  polarity:    ModPolarity | null;
  type:        string;
  description: string;
  /** Per-rank stat lines. levelStats[0] = R0, levelStats[N] = RN. */
  levelStats:  string[][];
  compatName:  string;
  tradeable:   boolean;
  isSet:       boolean;
  isAugment:   boolean;
  isExilus:    boolean;
  /** Resolved CDN icon URL when imageName is known. */
  iconUrl?:    string;

  // ── Wiki-equivalent fields (populated when live codex is enriched) ──
  /** Deep link to wiki.warframe.com — CC BY-SA. */
  wikiUrl?:      string;
  /** Update + date this mod was introduced. */
  introduced?:   IntroducedInfo;
  /** Patch history excerpts (newest first). */
  patchHistory?: PatchLogEntry[];
  /** Whether this mod can appear in transmutation. */
  transmutable?: boolean;
  /** ISO release date string. */
  releaseDate?:  string;
}

// ─── Projection ───────────────────────────────────────────────────────────────

const KNOWN_POLARITIES = new Set<ModPolarity>([
  'madurai', 'vazarin', 'naramon', 'zenurik', 'unairu',
  'penjaga', 'umbra', 'aura', 'universal', 'none',
]);

function asPolarity(raw: string | undefined): ModPolarity | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  return KNOWN_POLARITIES.has(lower as ModPolarity) ? (lower as ModPolarity) : null;
}

function asRarity(raw: string | undefined): ModRarity {
  switch (raw) {
    case 'Legendary':
    case 'Rare':
    case 'Uncommon':
    case 'Common':
      return raw;
    default:
      return 'Common';
  }
}

// ─── Build-time fallback (mods-map.json, frozen at last `npm run generate-mods`) ─
//
// Used until the Cloudflare Worker is redeployed with the enriched mod
// payload. Once the live codex contains levelStats-bearing mods we
// switch to it automatically (see useAllMods).

interface FallbackModRaw {
  name:        string;
  imageName:   string | null;
  rarity:      string;
  drain:       number;
  polarity:    string | null;
  type:        string;
  description: string;
  levelStats:  string[][];
  compatName:  string;
  tradeable:   boolean;
  isSet:       boolean;
  isAugment:   boolean;
  isExilus:    boolean;
}

const FALLBACK_RAW = modsRawMap as Record<string, FallbackModRaw>;

let _fallbackEntries: ModEntry[] | null = null;

function getFallbackEntries(): ModEntry[] {
  if (_fallbackEntries) return _fallbackEntries;
  const entries: ModEntry[] = [];
  for (const [uniqueName, raw] of Object.entries(FALLBACK_RAW)) {
    const entry: ModEntry = {
      uniqueName,
      name:        raw.name,
      imageName:   raw.imageName,
      rarity:      asRarity(raw.rarity),
      drain:       raw.drain,
      polarity:    asPolarity(raw.polarity ?? undefined),
      type:        raw.type,
      description: raw.description,
      levelStats:  raw.levelStats,
      compatName:  raw.compatName,
      tradeable:   raw.tradeable,
      isSet:       raw.isSet,
      isAugment:   raw.isAugment,
      isExilus:    raw.isExilus,
    };
    if (raw.imageName) entry.iconUrl = getIconUrl(raw.imageName);
    entries.push(entry);
  }
  _fallbackEntries = dedupeMods(entries);
  return _fallbackEntries;
}

/**
 * The codex is "usable" for mods when most rows carry per-rank levelStats.
 *
 * Real-world baseline: about 10% of mod rows legitimately lack levelStats —
 * stance variants, focus ways, mod-set bonus tokens, riven templates, Plexus
 * railjack mods. Threshold is set at 75% so normal upstream noise doesn't
 * push us back to the build-time fallback; only a catastrophic shape change
 * (half the mods suddenly missing stats) triggers the fallback path.
 */
function codexIsEnriched(items: TennoplanItem[]): boolean {
  if (items.length === 0) return false;
  let enriched = 0;
  for (const m of items) {
    if (Array.isArray(m.levelStats) && m.levelStats.length > 0) enriched++;
  }
  return enriched >= items.length * 0.75;
}

/** Project one TennoplanItem (category=Mod) into the legacy ModEntry shape. */
export function projectMod(item: TennoplanItem): ModEntry {
  const imageName = item.imageName ?? null;
  const entry: ModEntry = {
    uniqueName:  item.uniqueName,
    name:        item.name,
    imageName,
    rarity:      asRarity(item.rarity),
    drain:       item.baseDrain ?? 0,
    polarity:    asPolarity(item.polarity),
    type:        item.type ?? 'Mod',
    description: item.description ?? '',
    levelStats:  item.levelStats ?? [],
    compatName:  item.compatName ?? 'MOD',
    tradeable:   item.tradeable ?? false,
    isSet:       item.isSet     ?? false,
    isAugment:   item.isAugment ?? false,
    isExilus:    item.isExilus  ?? false,
  };
  if (imageName)                     entry.iconUrl      = getIconUrl(imageName);
  if (item.wikiUrl)                  entry.wikiUrl      = item.wikiUrl;
  if (item.introduced)               entry.introduced   = item.introduced;
  if (item.patchHistory?.length)     entry.patchHistory = item.patchHistory;
  if (item.transmutable !== undefined) entry.transmutable = item.transmutable;
  if (item.releaseDate)              entry.releaseDate  = item.releaseDate;
  return entry;
}

/**
 * Inverse of projectMod — rebuild a minimal TennoplanItem from a ModEntry.
 * Used only when a mod is opened from the browser but the live codex row
 * isn't in Dexie yet (build-time fallback path): the detail page still needs
 * a TennoplanItem, and every field the mod blocks read is present on ModEntry.
 */
export function modEntryToItem(mod: ModEntry): TennoplanItem {
  return {
    uniqueName:   mod.uniqueName,
    name:         mod.name,
    category:     'Mod',
    type:         mod.type,
    iconUrl:      mod.iconUrl ?? '',
    imageName:    mod.imageName ?? undefined,
    rarity:       mod.rarity,
    description:  mod.description,
    baseDrain:    mod.drain,
    polarity:     mod.polarity ?? undefined,
    levelStats:   mod.levelStats,
    compatName:   mod.compatName,
    tradeable:    mod.tradeable,
    isSet:        mod.isSet,
    isAugment:    mod.isAugment,
    isExilus:     mod.isExilus,
    dropLocations: [],
    wikiUrl:      mod.wikiUrl,
    patchHistory: mod.patchHistory,
    introduced:   mod.introduced,
    transmutable: mod.transmutable,
    releaseDate:  mod.releaseDate,
    // Metadata stamped by the codex pipeline — synthesised here for the
    // build-time fallback path (no live codex row yet).
    dataVersion:  'mod-fallback',
    lastUpdated:  Date.now(),
    source:       'enriched',
    quality:      'high',
  } as TennoplanItem;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

/**
 * All mods, projected to ModEntry. Source-of-truth chain:
 *   1. Live codex (`tennoplanItems`) when its mod rows carry levelStats.
 *      Means the Worker has been redeployed with the enriched mod fields.
 *   2. Build-time `mods-map.json` otherwise.
 *
 * Always returns a non-empty array (we ship the fallback bundled), so
 * consumers never need a loading state. The hook does still re-run when
 * Dexie data arrives, swapping from fallback to live codex seamlessly.
 *
 * Identity is the uniqueName, not the display name: tier variants (Serration
 * has Beginner, Intermediate and full-rank records) and same-named mods from
 * different systems are all listed. Only records identical in every field
 * except the uniqueName (and the derived iconUrl) are collapsed. See dedupeMods.
 */
export function useAllMods(): ModEntry[] {
  const items = useLiveQuery(
    () => db.tennoplanItems.where('category').equals('Mod').toArray(),
    [],
  );

  return useMemo(() => {
    // Codex not loaded yet (undefined) OR not enriched yet → fallback.
    if (!items || !codexIsEnriched(items)) {
      return getFallbackEntries();
    }
    return dedupeMods(items.map(projectMod));
  }, [items]);
}

/** All unique compat-name labels, sorted. */
export function useAllCompatNames(): string[] {
  const mods = useAllMods();
  return useMemo(() => {
    const set = new Set<string>();
    for (const m of mods) set.add(m.compatName);
    return [...set].sort();
  }, [mods]);
}

/** Lookup one mod by uniqueName. Returns null when not found. */
export function useModByUniqueName(uniqueName: string | null | undefined): ModEntry | null {
  const mods = useAllMods();
  // Build a Map once per mods array so repeated detail-modal opens are O(1).
  const byUniqueName = useMemo(() => {
    const m = new Map<string, ModEntry>();
    for (const e of mods) m.set(e.uniqueName, e);
    return m;
  }, [mods]);
  return uniqueName ? byUniqueName.get(uniqueName) ?? null : null;
}

// ─── Pure search helper (in-memory) ───────────────────────────────────────────

export interface ModSearchOpts {
  query?:      string;
  rarity?:     ModRarity | 'all';
  compatName?: string;
}

/**
 * Filter a pre-loaded mod array by query / rarity / compatName.
 * Pure function — the consumer pairs this with useAllMods() and useMemo.
 */
export function filterMods(mods: readonly ModEntry[], opts: ModSearchOpts): ModEntry[] {
  const { query = '', rarity = 'all', compatName } = opts;
  const q = query.toLowerCase().trim();
  return mods.filter((m) => {
    if (q && !m.name.toLowerCase().includes(q)) return false;
    if (rarity !== 'all' && m.rarity !== rarity) return false;
    if (compatName && m.compatName !== compatName) return false;
    return true;
  });
}

// ─── Rank helpers (unchanged from legacy adapter) ─────────────────────────────

export function modRankCount(mod: ModEntry): number {
  return mod.levelStats.length;
}

export function modMaxRank(mod: ModEntry): number {
  return Math.max(0, mod.levelStats.length - 1);
}
