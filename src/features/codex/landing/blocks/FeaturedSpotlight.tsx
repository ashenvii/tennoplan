/**
 * FeaturedSpotlight — the landing's anchored composition.
 *
 * v3 rebuild (.impeccable.md §3a — Anchored Composition):
 *
 * The old layout was the textbook §3 violation — `[art panel] | [meta
 * panel]` side-by-side, each its own boxed island. Replaced with an
 * anchored composition where:
 *
 *   • The artwork is a STRUCTURAL ANCHOR, not boxed content. It
 *     bleeds from the left edge and reaches into the composition.
 *   • A shared radial gradient (jade, soft) sits behind the artwork,
 *     dissolving the boundary between "image" and "data."
 *   • The right side carries an Editorial Rail (§3b) of meta — small
 *     caps labels above values, no chrome, separated only by
 *     typographic rhythm.
 *   • The composition has NO box around art, NO box around meta, NO
 *     border splitting the two. Information radiates from the anchor.
 *
 * Spotlight item selection (unchanged from v2):
 *   1. Query Dexie for items with `introduced.date` populated.
 *   2. Group by update; pick the newest update's presentable items.
 *   3. Rotate weekly via deterministic UTC-week math.
 *   4. Fall back to hand-curated SPOTLIGHT_POOL when introduced data
 *      isn't available (fresh install, codex not yet synced).
 */

import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight } from 'lucide-react';
import { db } from '@/adapters/storage/db';
import { fillDescriptionTokens } from '@/lib/text/descriptionTokens';
import type { TennoplanItem, ItemCategory } from '@/core/domain/tennoplanApi';
import {
  SPOTLIGHT_POOL,
  currentSpotlightIndex,
  type SpotlightPoolEntry,
} from '../spotlightPool';
import styles from './FeaturedSpotlight.module.css';

// Categories worth featuring, in descending preference order.
const PRESENTABLE: ItemCategory[] = ['Warframe', 'Weapon', 'Arcane', 'Companion', 'Sentinel'];

interface FeaturedSpotlightProps {
  onSelectEntry: (entry: TennoplanItem) => void;
}

export function FeaturedSpotlight({ onSelectEntry }: FeaturedSpotlightProps) {
  const resolved = useLiveQuery(async () => resolveSpotlight(), []);

  return (
    <section className={styles.root} aria-labelledby="codex-spotlight-label">
      {/* Top rail: FEATURED label + update tag.
          Sits over the composition's negative space (no boxed header). */}
      <header className={styles.topRail}>
        <h2 id="codex-spotlight-label" className={`typo-section-label ${styles.label}`}>
          <span className={styles.labelGlyph} aria-hidden="true">▢</span>
          Featured
        </h2>
        {resolved?.updateName && (
          <span className={styles.updateTag}>{resolved.updateName}</span>
        )}
      </header>

      {resolved === undefined && (
        <p className={styles.loading}>Loading featured entry…</p>
      )}
      {resolved === null && (
        <p className={styles.unavailable}>
          Spotlight unavailable — codex is still syncing. Browse the Collections below to get started.
        </p>
      )}
      {resolved && (
        <AnchoredComposition entry={resolved.item} onSelectEntry={onSelectEntry} />
      )}
    </section>
  );
}

interface AnchoredCompositionProps {
  entry:         TennoplanItem;
  onSelectEntry: (entry: TennoplanItem) => void;
}

function AnchoredComposition({ entry, onSelectEntry }: AnchoredCompositionProps) {
  const description = fillDescriptionTokens(entry.description ?? '')
    .replace(/<[A-Z0-9_]+>/g, '')
    .replace(/\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const initial = entry.name.slice(0, 1).toUpperCase();
  const masteryRow = entry.masteryRank != null && entry.masteryRank > 0
    ? `Rank ${entry.masteryRank}`
    : '—';
  const introducedRow = entry.introduced?.name ?? '—';
  const statusRow     = entry.vaulted ? 'Vaulted' : 'Available';

  return (
    <div className={styles.composition}>
      {/* Artwork — anchored bottom-left, bleeds from the edge.
          NO panel chrome. NO border. NO background card. Just the
          asset and a soft radial gradient behind it that paints the
          composition's color story. */}
      <button
        type="button"
        className={styles.anchor}
        onClick={() => onSelectEntry(entry)}
        aria-label={`Open ${entry.name}`}
      >
        {entry.iconUrl
          ? <img src={entry.iconUrl} alt="" className={styles.anchorImage} draggable={false} />
          : <span className={styles.anchorFallback} aria-hidden="true">{initial}</span>}
      </button>

      {/* Meta column — radiates from the right of the anchor.
          Editorial Rail typography (small caps, generous letter-spacing).
          No card around it; the spacing IS the structure. */}
      <div className={styles.meta}>
        <h3 className={styles.name}>{entry.name}</h3>
        <p className={styles.kind}>
          <span>{entry.category}</span>
        </p>

        {/* Editorial Rail — §3b. Four-row spec sheet, ornament-bulleted. */}
        <dl className={styles.rail} aria-label={`${entry.name} key facts`}>
          <RailRow label="Introduced" value={introducedRow} />
          <RailRow label="Mastery"    value={masteryRow} />
          <RailRow label="Type"       value={entry.category} />
          <RailRow label="Status"     value={statusRow} accent={entry.vaulted ? 'vaulted' : 'available'} />
        </dl>

        {description.length > 0 && (
          <p className={styles.description}>{description}</p>
        )}

        <button
          type="button"
          className={styles.cta}
          onClick={() => onSelectEntry(entry)}
        >
          <span className={styles.ctaGlyph} aria-hidden="true">▢</span>
          Open in Codex
          <ArrowRight size={14} strokeWidth={2.25} />
        </button>
      </div>
    </div>
  );
}

interface RailRowProps {
  label:  string;
  value:  string;
  accent?: 'vaulted' | 'available';
}

function RailRow({ label, value, accent }: RailRowProps) {
  return (
    <div className={styles.railRow}>
      <span className={styles.railBullet} aria-hidden="true">▢</span>
      <dt className={styles.railLabel}>{label}</dt>
      <dd
        className={styles.railValue}
        data-accent={accent}
      >
        {value}
      </dd>
    </div>
  );
}

// ─── Resolution (unchanged from v2) ──────────────────────────────────────────

interface SpotlightResult {
  item:        TennoplanItem;
  /** Update name shown in the header tag, e.g. "Dante Unbound". */
  updateName?: string;
}

/**
 * Primary strategy: find the most recently-introduced update in Dexie,
 * pick the best presentable item from it, rotate weekly.
 *
 * Falls back to the hand-curated pool when introduced data is absent
 * (codex not yet synced, or pre-introduced-field build in KV).
 */
async function resolveSpotlight(): Promise<SpotlightResult | null> {
  const all = await db.tennoplanItems.toArray();

  // ── Strategy 1: data-driven from introduced.date ─────────────────
  const updateResult = resolveFromUpdates(all);
  if (updateResult) return updateResult;

  // ── Strategy 2: fall back to hand-curated pool ───────────────────
  return resolveFromPool(all);
}

/**
 * Group items by update name, find the most recently-introduced update
 * that has at least one presentable item, rotate through those weekly.
 */
function resolveFromUpdates(all: TennoplanItem[]): SpotlightResult | null {
  // Build: updateName → { latestDate, presentableItems[] }
  const updates = new Map<string, { latestDate: number; items: TennoplanItem[] }>();

  for (const item of all) {
    const iso  = item.introduced?.date;
    const name = item.introduced?.name;
    if (!iso || !name) continue;
    if (!PRESENTABLE.includes(item.category)) continue;
    if (!item.iconUrl) continue;

    const t = Date.parse(iso);
    if (!Number.isFinite(t)) continue;

    const bucket = updates.get(name);
    if (!bucket) {
      updates.set(name, { latestDate: t, items: [item] });
    } else {
      bucket.items.push(item);
      if (t > bucket.latestDate) bucket.latestDate = t;
    }
  }

  if (updates.size === 0) return null;

  // Sort updates newest-first
  const sorted = [...updates.entries()].sort((a, b) => b[1].latestDate - a[1].latestDate);

  // Take the newest update with presentable items (already filtered above)
  for (const [updateName, { items }] of sorted) {
    if (items.length === 0) continue;

    // Sort alphabetically for consistency, then rotate weekly
    const pool = [...items].sort((a, b) => a.name.localeCompare(b.name));
    const idx  = currentSpotlightIndex() % pool.length;
    const item = pool[idx];
    if (!item) continue;

    return { item, updateName };
  }

  return null;
}

/**
 * Legacy fallback: walk the hand-curated SPOTLIGHT_POOL, returning the
 * first entry found in Dexie. Used when no items have introduced data.
 */
async function resolveFromPool(all: TennoplanItem[]): Promise<SpotlightResult | null> {
  const byName = new Map(all.map(it => [it.uniqueName, it]));
  const start  = currentSpotlightIndex();

  for (let i = 0; i < SPOTLIGHT_POOL.length; i++) {
    const idx:   number            = (start + i) % SPOTLIGHT_POOL.length;
    const entry: SpotlightPoolEntry | undefined = SPOTLIGHT_POOL[idx];
    if (!entry) continue;
    const item = byName.get(entry.uniqueName);
    if (item) return { item };
  }

  return null;
}
