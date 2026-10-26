/**
 * CodexQuickLook — the universal "smart window" (the app's staple info surface).
 *
 * Step 1 of the two-step codex access pattern: any surface outside the codex
 * (bounty reward, vendor ware, drop row, recipe component, …) calls
 * quickLook.open(uniqueName, name, context?). This sheet resolves the item from
 * Dexie and shows the sweet-sauce — icon, identity, a sanitised description,
 * category-aware key stats, SOURCE-SPECIFIC drop rates (from `context`, e.g. a
 * bounty's per-stage %), and where else to find it. Step 2 is the footer's
 * "Open full entry →" → the full codex detail page (with a Back affordance).
 *
 * Mounted once at the app root so it floats over every tab. Every ItemTile in
 * the app opens it, so one window = one consistent detail experience.
 */

import { useEffect, useState, useMemo, useCallback } from 'react';
import { Sheet } from '@/components/common/Sheet';
import { db } from '@/adapters/storage/db';
import { useQuickLook } from '@/store/quickLook';
import { useNavigationStore } from '@/store/navigation';
import { fillDescriptionTokens } from '@/lib/text/descriptionTokens';
import type { TennoplanItem, TpDropLocation } from '@/core/domain/tennoplanApi';
import styles from './CodexQuickLook.module.css';

// Strip residual game markup (<DT_..> tags, escaped newlines) and give unresolved
// |TOKEN| placeholders a readable label.
function sanitize(text?: string): string {
  if (!text) return '';
  return fillDescriptionTokens(text)
    .replace(/<[^>]+>/g, '')
    .replace(/\\[rn]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type Tint = 'health' | 'shield' | 'energy';
interface Fact { label: string; value: string; tint?: Tint; }

function keyFacts(item: TennoplanItem): Fact[] {
  const f: Fact[] = [];
  const s = item.stats;
  if (item.category === 'Warframe' && s) {
    if (s.health) f.push({ label: 'Health', value: String(s.health), tint: 'health' });
    if (s.shield) f.push({ label: 'Shield', value: String(s.shield), tint: 'shield' });
    if (s.energy) f.push({ label: 'Energy', value: String(s.energy), tint: 'energy' });
    if (s.armor)  f.push({ label: 'Armor',  value: String(s.armor) });
  } else if (item.category === 'Weapon' && s) {
    if (s.damage)       f.push({ label: 'Damage', value: String(Math.round(s.damage)) });
    if (s.critChance)   f.push({ label: 'Crit',   value: `${Math.round(s.critChance * 100)}%` });
    if (s.statusChance) f.push({ label: 'Status', value: `${Math.round(s.statusChance * 100)}%` });
    if (item.weaponTrigger) f.push({ label: 'Trigger', value: item.weaponTrigger });
  }
  if (item.masteryRank) f.push({ label: 'MR',     value: String(item.masteryRank) });
  if (item.rarity)      f.push({ label: 'Rarity', value: item.rarity });
  return f.slice(0, 5);
}

const expectedRuns = (chance: number) => (chance > 0 ? Math.ceil(100 / chance) : null);

/** Trim a percent for display: "20%", "12.5%", "0.67%" — no trailing ".0". */
function fmtPct(pct: number): string {
  if (pct >= 100) return '100%';
  if (pct >= 10) return `${(Math.round(pct * 10) / 10).toString().replace(/\.0$/, '')}%`;
  if (pct >= 1)  return `${(Math.round(pct * 10) / 10)}%`;
  return `${(Math.round(pct * 100) / 100)}%`;
}

/** "1 in 8" / "guaranteed" — the framing players actually reason in. */
function fmtOdds(runs: number | null, pct: number): string {
  if (pct >= 100) return 'guaranteed';
  if (!runs) return '—';
  return `1 in ${runs.toLocaleString()}`;
}

/**
 * One acquisition source for an item — a single place it drops, normalised for
 * presentation. Self-describing chips (rotation / Steel Path / relic tier) mean
 * each row reads on its own, the way the wiki's acquisition tables do. The whole
 * list is ONE ranked table: the highest-chance row is the BEST farm, and the
 * source the player CLICKED FROM (if any) is folded in as a highlighted
 * "you're here" row so they can see how their current spot stacks up.
 */
interface SourceRow {
  key:       string;
  where:     string;
  category?: string;
  /** Drop chance as a percent (0–100). */
  pct:       number;
  /** Expected runs to get one (curated estimate when available, else ⌈100/pct⌉). */
  runs:      number | null;
  /** Context chips, e.g. ["Rot C", "Steel Path"]. */
  chips:     string[];
  notes?:    string;
  /** This is the source the player clicked from (the "you're here" row). */
  isHere?:   boolean;
}

function sourceChips(loc: TpDropLocation): string[] {
  const c: string[] = [];
  if (loc.rotation)        c.push(`Rot ${loc.rotation}`);
  if (loc.bountyTier)      c.push(String(loc.bountyTier));
  if (loc.voidFissureTier) c.push(String(loc.voidFissureTier));
  if (loc.isSteelPath)     c.push('Steel Path');
  return c;
}

function toSourceRow(loc: TpDropLocation, runsOverride?: number, notes?: string): SourceRow {
  const pct = loc.chance * 100;
  return {
    key:      `${loc.location}|${loc.rotation ?? ''}|${loc.chance.toFixed(4)}`,
    where:    loc.location,
    category: loc.sourceName,
    pct,
    runs:     runsOverride ?? expectedRuns(pct),
    chips:    sourceChips(loc),
    ...(notes ? { notes } : {}),
  };
}

/**
 * Synthesise the "you're here" row from the clicking surface's context (e.g. a
 * bounty's per-stage rates). We collapse same-rate stages (app-wide rule) and
 * take the best stage as the row's headline %, summarising the rest as a note
 * ("Stage 1 12% · Final 6%") — keeping the unified table to one row per source.
 */
function buildHereRow(context?: { source?: string; drops?: { label: string; chance: number }[] } | null): SourceRow | null {
  const drops = context?.drops ?? [];
  if (!drops.length) return null;
  const grouped = groupSameRate(drops);
  if (!grouped.length) return null;

  // Split "Konzu · Capture · Lv 5–15" → where "Konzu", category "Capture · Lv 5–15".
  const parts = (context?.source ?? '').split('·').map((s) => s.trim()).filter(Boolean);
  const where = parts[0] || 'This source';
  const category = parts.length > 1 ? parts.slice(1).join(' · ') : undefined;

  const top = grouped[0]!;
  const stageNote =
    grouped.length > 1 ? grouped.map((g) => `${g.label} ${fmtPct(g.chance)}`).join(' · ') : undefined;

  return {
    key:   'here',
    where,
    pct:   top.chance,
    runs:  expectedRuns(top.chance),
    chips: [],
    isHere: true,
    ...(category ? { category } : {}),
    ...(stageNote ? { notes: stageNote } : {}),
  };
}

/**
 * Build ONE ranked acquisition table for the item: every source sorted by drop
 * chance (best first), with the clicked source folded in as the "you're here"
 * row. This is a PREVIEW — we cap the visible rows but ALWAYS keep the here-row,
 * and surface a "+N more" pointer to the full codex entry (the canonical table).
 */
const ROWS_CAP = 6;
function buildAcquisition(
  item: TennoplanItem,
  hereRow: SourceRow | null,
): { rows: SourceRow[]; bestKey: string | null; moreCount: number } {
  const all: SourceRow[] = [];
  const seen = new Set<string>();
  for (const dl of item.dropLocations ?? []) {
    const row = toSourceRow(dl);
    if (seen.has(row.key)) continue;
    seen.add(row.key);
    all.push(row);
  }
  // Attach curated best-farm runs/notes to the matching source row.
  const bf = item.bestFarms?.[0];
  if (bf) {
    const match = all.find((r) => r.where === bf.location.location);
    if (match) { match.runs = bf.estimatedRuns; if (bf.notes) match.notes = bf.notes; }
  }
  if (hereRow) all.push(hereRow);
  all.sort((a, b) => b.pct - a.pct);

  const bestKey = all[0]?.key ?? null;

  let rows = all.slice(0, ROWS_CAP);
  // The here-row must always be visible even if it ranks past the cap.
  if (hereRow && !rows.some((r) => r.key === hereRow.key)) {
    rows = [...all.slice(0, ROWS_CAP - 1), hereRow].sort((a, b) => b.pct - a.pct);
  }
  return { rows, bestKey, moreCount: Math.max(0, all.length - rows.length) };
}

/**
 * App-wide rule: collapse drop rows that share the SAME rate into one. Many
 * bounty stages award an item at an identical chance — listing "12.5%" five
 * times is noise. Group by chance (high → low); the label summarises the sources
 * (full list kept in the title), the % + runs show once.
 */
interface GroupedDrop { label: string; title: string; chance: number; }
function groupSameRate(rows: { label: string; chance: number }[]): GroupedDrop[] {
  const map = new Map<string, { labels: string[]; chance: number }>();
  for (const r of rows) {
    const k = r.chance.toFixed(2);
    let g = map.get(k);
    if (!g) { g = { labels: [], chance: r.chance }; map.set(k, g); }
    g.labels.push(r.label);
  }
  return [...map.values()]
    .sort((a, b) => b.chance - a.chance)
    .map((g) => {
      const uniq = [...new Set(g.labels)];
      const label = uniq.length <= 2 ? uniq.join(', ') : `${uniq.slice(0, 2).join(', ')} +${uniq.length - 2}`;
      return { label, title: uniq.join(' · '), chance: g.chance };
    });
}

type LoadState = 'loading' | 'ready' | 'missing';

export function CodexQuickLook() {
  const link           = useQuickLook((s) => s.link);
  const context        = useQuickLook((s) => s.context);
  const close          = useQuickLook((s) => s.close);
  const openCodexEntry = useNavigationStore((s) => s.openCodexEntry);

  const [item,  setItem]  = useState<TennoplanItem | null>(null);
  const [state, setState] = useState<LoadState>('loading');

  useEffect(() => {
    if (!link) return;
    let cancelled = false;
    setItem(null);
    setState('loading');
    (async () => {
      const byId  = await db.tennoplanItems.get(link.uniqueName);
      const found = byId ?? (link.name
        ? await db.tennoplanItems.filter((i) => i.name.toLowerCase() === link.name!.toLowerCase()).first()
        : undefined);
      if (cancelled) return;
      if (found) { setItem(found); setState('ready'); }
      else       { setItem(null);  setState('missing'); }
    })();
    return () => { cancelled = true; };
  }, [link]);

  const handleOpenFull = useCallback(() => {
    if (!item) return;
    close();
    openCodexEntry(item.uniqueName, item.name);
  }, [item, close, openCodexEntry]);

  const facts = useMemo(() => (item ? keyFacts(item) : []), [item]);
  const desc  = useMemo(() => sanitize(item?.description), [item]);
  // The clicked source (e.g. a bounty's per-stage rates) becomes a "you're here"
  // row folded into the one ranked acquisition table.
  const hereRow = useMemo(() => buildHereRow(context), [context]);
  const acq = useMemo(
    () => (item ? buildAcquisition(item, hereRow) : { rows: hereRow ? [hereRow] : [], bestKey: hereRow?.key ?? null, moreCount: 0 }),
    [item, hereRow],
  );
  const hasAcq = acq.rows.length > 0;
  // Magnitude bars are relative to the best (highest) chance shown.
  const acqMax = Math.max(1, ...acq.rows.map((r) => r.pct));

  const accent: 'gold' | 'jade' =
    item?.rarity && /rare|legendary/i.test(item.rarity) ? 'gold' : 'jade';

  const footer = state === 'ready' && item ? (
    <button type="button" className={styles.openFull} onClick={handleOpenFull}>
      Open full entry <span aria-hidden="true">→</span>
    </button>
  ) : undefined;

  return (
    <Sheet
      open={!!link}
      onClose={close}
      size="md"
      title={item?.name ?? link?.name ?? 'Loading…'}
      ariaLabel={item?.name ?? 'Item preview'}
      footer={footer}
    >
      {state === 'loading' && <div className={styles.status}>Loading…</div>}

      {state !== 'loading' && (
        <div className={styles.body} data-accent={accent}>
          {/* ── Hero: icon (lit) + identity ─────────────────────────────── */}
          <div className={styles.hero}>
            <div className={styles.iconHolder}>
              {item?.iconUrl
                ? <img src={item.iconUrl} alt="" className={styles.icon} loading="lazy" />
                : <span className={styles.iconFallback} aria-hidden="true" />}
            </div>
            <div className={styles.identity}>
              <span className={styles.cat}>
                {[item?.category, item?.type].filter(Boolean).join(' · ') || (state === 'missing' ? 'Not in codex yet' : '')}
              </span>
              {item?.rarity && (
                <span className={styles.rarity} data-rarity={item.rarity.toLowerCase()}>{item.rarity}</span>
              )}
            </div>
          </div>

          {desc && <p className={styles.desc}>{desc}</p>}

          {facts.length > 0 && (
            <div className={styles.facts}>
              {facts.map((f) => (
                <div key={f.label} className={styles.fact}>
                  <span className={styles.factVal} data-tint={f.tint}>{f.value}</span>
                  <span className={styles.factLabel}>{f.label}</span>
                </div>
              ))}
            </div>
          )}

          {/* ── Where to farm — ONE ranked table ─────────────────────────────
              Every source sorted by drop chance (best first). The top row is the
              BEST farm; the source the player clicked from is folded in as a
              highlighted "you're here" row so they can see how it ranks. % is the
              headline, "1 in N" is the framing players reason in, the bar shows
              relative magnitude at a glance. ───────────────────────────────── */}
          {hasAcq && (
            <section className={styles.acq}>
              <span className={styles.acqLabel}>Where to farm</span>
              <ul className={styles.srcList}>
                {acq.rows.map((s) => {
                  const isBest = s.key === acq.bestKey;
                  return (
                    <li
                      key={s.key}
                      className={styles.srcRow}
                      data-here={s.isHere || undefined}
                      data-best={isBest || undefined}
                    >
                      <span
                        className={styles.srcMain}
                        title={[s.where, s.category, s.notes].filter(Boolean).join(' — ')}
                      >
                        <span className={styles.srcTop}>
                          <span className={styles.srcWhere}>{s.where}</span>
                          {s.chips.map((c) => (
                            <span key={c} className={styles.chipSm}>{c}</span>
                          ))}
                          {isBest && <span className={styles.badgeBest}>BEST</span>}
                          {s.isHere && <span className={styles.badgeHere}>YOU’RE HERE</span>}
                        </span>
                        {(s.category || s.notes) && (
                          <span className={styles.srcSub} title={[s.category, s.notes].filter(Boolean).join(' — ')}>
                            {[s.category, s.notes].filter(Boolean).join(' — ')}
                          </span>
                        )}
                      </span>
                      <span className={styles.srcBar} aria-hidden="true">
                        <span className={styles.srcBarFill} style={{ width: `${Math.max(4, (s.pct / acqMax) * 100)}%` }} />
                      </span>
                      <span className={styles.srcPct}>{fmtPct(s.pct)}</span>
                      <span className={styles.srcOdds}>{fmtOdds(s.runs, s.pct)}</span>
                    </li>
                  );
                })}
              </ul>

              {acq.moreCount > 0 && (
                <button type="button" className={styles.moreLink} onClick={handleOpenFull}>
                  +{acq.moreCount} more {acq.moreCount === 1 ? 'source' : 'sources'} — see the full table <span aria-hidden="true">→</span>
                </button>
              )}
            </section>
          )}

          {state === 'missing' && !hasAcq && (
            <div className={styles.status}>This item isn’t in the codex yet.</div>
          )}
        </div>
      )}
    </Sheet>
  );
}
