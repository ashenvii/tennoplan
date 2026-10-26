/**
 * dedupeMods: turn the raw mod list into what the Mods browser shows.
 *
 * A display name is not an identity. The codex holds several records per name:
 * the Beginner / Intermediate / full-rank tiers of one mod (Serration has
 * three), Focus abilities that share a name with a warframe mod, and
 * placeholder records such as the 43 "Unfused Artifact" Railjack entries.
 * Collapsing by name hid every record after the first (issue #6).
 *
 * Rule: every record keeps its own identity (uniqueName). Only records that are
 * identical in every other field are collapsed, and the first one by uniqueName
 * wins so the choice is stable between syncs.
 */

import type { ModEntry } from './codexModsAdapter';

/** Every field except the identity (uniqueName) and iconUrl (derived from imageName). */
function contentFingerprint(m: ModEntry): string {
  const { uniqueName: _id, iconUrl: _icon, ...content } = m;
  return JSON.stringify({ ...content, name: content.name.toLowerCase() });
}

/** Name first, then fewer ranks first so tiers read Beginner, Intermediate, full. */
export function compareMods(a: ModEntry, b: ModEntry): number {
  return a.name.localeCompare(b.name)
    || a.levelStats.length - b.levelStats.length
    || (a.uniqueName < b.uniqueName ? -1 : a.uniqueName > b.uniqueName ? 1 : 0);
}

export function dedupeMods(mods: readonly ModEntry[]): ModEntry[] {
  const seen = new Set<string>();
  const kept: ModEntry[] = [];
  for (const m of [...mods].sort((a, b) => (a.uniqueName < b.uniqueName ? -1 : a.uniqueName > b.uniqueName ? 1 : 0))) {
    const key = contentFingerprint(m);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(m);
  }
  return kept.sort(compareMods);
}
