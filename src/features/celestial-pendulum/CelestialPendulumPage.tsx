/**
 * CelestialPendulumPage — the hub shell.
 *
 *   PageHero
 *   ┌ Top tab bar: Overview · Worlds · Activities · Nightwave ·
 *   │              Vendors & Syndicates · Events ┐
 *   └────────────────────────────────────────────┘
 *   <active tab>
 *
 * WORLDS: horizontal place chips (the old left rail, flattened) → a place
 * dossier (live hero + a lazy "Next 6 hours" glance + Bounties / Forecast /
 * Fishing / Circuit facets). Activities / Nightwave / Vendors & Syndicates /
 * Events are live where worldstate provides it, honest "curated — coming" stubs
 * where it doesn't. Overview is interim ("what's good now" board) until built last.
 * App-wide live cycle pills + Baro + the Dailies panel live in the global header.
 *
 * Plan + rationale: docs/celestial-pendulum.md. All styling lives in
 * CelestialPendulum.module.css (tokens only).
 */

import { useState, useCallback, useMemo } from 'react';
import { PageHero }            from '@/components/ui/PageHero';
import { PRESTIGE_LEVEL }      from '@/tokens/worldThemes';
import type { CycleId, CycleState, CycleStatus } from '@/core/domain/cycles';
import { useWorldCycles }      from './hooks/useWorldCycles';
import { useDropsLastSynced }  from './hooks/useDropsLastSynced';
import { useAllGiverBounties } from './hooks/useAllGiverBounties';
import { WorldActivityDetail } from './components/WorldActivityDetail';
import { StaticPlaceHero }     from './components/StaticPlaceHero';
import { RightNowHero, type HeroActive, type HeroUpcoming } from './components/RightNowHero';
import { BountyBoard }         from './components/BountyBoard';
import { CircuitPanel }        from './components/CircuitPanel';
import { ActivitiesTab }       from './components/ActivitiesTab';
import { NightwaveTab }         from './components/NightwaveTab';
import { VendorsSyndicatesTab } from './components/VendorsSyndicatesTab';
import { EventsTab }            from './components/EventsTab';
import { NextHoursButton }     from './components/NextHoursButton';
import { OverviewPanel }       from './components/OverviewPanel';
import { CelestialWireframe }  from './wireframe/CelestialWireframe';
import { useDuviriCircuit }    from './hooks/useDuviriCircuit';
import { buildPlaces }         from './placesModel';
import {
  ORRERY_ORDER,
  getWorldMeta,
  getActivity,
  getKeyResources,
}                              from './cycleActivity';
import { getWorldBg }          from './worldAssets';
import styles                  from './CelestialPendulum.module.css';

// Two-colour discipline (matches the Codex): jade = interactive / live / default,
// gold = the meaningful highlight (prime windows).
const JADE = 'var(--color-accent-jade)';
const GOLD = 'var(--color-accent-gold)';

// ── Hub tabs ──────────────────────────────────────────────────────────────────
type HubTab = 'overview' | 'worlds' | 'activities' | 'nightwave' | 'market' | 'events';
const HUB_TABS: { key: HubTab; label: string }[] = [
  { key: 'overview',   label: 'Overview' },
  { key: 'worlds',     label: 'Worlds' },
  { key: 'activities', label: 'Activities' },
  { key: 'nightwave',  label: 'Nightwave' },
  { key: 'market',     label: 'Vendors & Syndicates' },
  { key: 'events',     label: 'Events' },
];

function ComingSoon({ label, note }: { label: string; note?: string }) {
  return (
    <div className={styles.comingSoon}>
      <span className={styles.comingSoonLabel}>{label}</span>
      <span className={styles.comingSoonNote}>{note ?? 'Coming soon.'}</span>
      <span className={styles.comingSoonHint}>Planned · Celestial hub re-build</span>
    </div>
  );
}

export function CelestialPendulumPage() {
  const [hubTab, setHubTab] = useState<HubTab>('worlds');
  const [selectedKey, setSelectedKey] = useState<string>('cetus');
  const [showWireframe, setShowWireframe] = useState(false);

  const { statuses, urgency, hasEverLoaded, isError, isDataOutOfSync } = useWorldCycles();
  const { ageLabel: dropsAgeLabel } = useDropsLastSynced();

  const byId = useMemo(
    () => Object.fromEntries(statuses.map((s) => [s.cycle.id, s])) as Partial<Record<CycleId, CycleStatus>>,
    [statuses],
  );
  const worlds = useMemo(() => ORRERY_ORDER.filter((id) => byId[id]), [byId]);

  const duviriCircuit = useDuviriCircuit();
  const giverBounties = useAllGiverBounties();
  const places = useMemo(
    () => buildPlaces(worlds, byId, urgency, giverBounties),
    [worlds, byId, urgency, giverBounties],
  );

  const selectedPlace = useMemo(
    () => places.find((p) => p.key === selectedKey) ?? places[0] ?? null,
    [places, selectedKey],
  );

  // "Right now" — active prime windows + the next opening (drives Overview interim).
  const hero = useMemo(() => {
    const active: HeroActive[] = [];
    const upcoming: HeroUpcoming[] = [];
    for (const id of worlds) {
      const status = byId[id];
      if (!status) continue;
      const act = getActivity(id, status.cycle.state);
      const m   = getWorldMeta(id);
      if (act.isPrime) {
        const fraction = Math.max(0, Math.min(1, 1 - status.progress));
        active.push({ id, world: m.label, region: m.region, label: act.label, blurb: act.blurb, msRemaining: status.msRemaining, fraction, accent: GOLD });
        continue;
      }
      const nextKey = urgency[id]?.nextStateKey;
      if (nextKey && (PRESTIGE_LEVEL[nextKey] ?? 'none') === 'P0') {
        const nextState = nextKey.split('-')[1] ?? '';
        upcoming.push({ id, world: m.label, label: getActivity(id, nextState).label, msRemaining: status.msRemaining, accent: JADE });
      }
    }
    active.sort((a, b) => a.msRemaining - b.msRemaining);
    upcoming.sort((a, b) => a.msRemaining - b.msRemaining);
    return { active, upcoming };
  }, [worlds, byId, urgency]);

  // Select a place AND jump to the Worlds tab (used by Overview links).
  const goToPlace = useCallback((key: string) => { setSelectedKey(key); setHubTab('worlds'); }, []);

  const emptyReason =
    'No bounties to show here right now. Live jobs and reward tables refresh automatically in the background.';

  // ── Dev-only wireframe of the re-planned hub ─────────────────────────────
  if (import.meta.env.DEV && showWireframe) {
    return (
      <div className={styles.page}>
        <div className={styles.content}>
          <button type="button" onClick={() => setShowWireframe(false)} className={styles.devChip}>
            ← Exit wireframe (back to live page)
          </button>
          <CelestialWireframe />
        </div>
      </div>
    );
  }

  // ── Loading ─────────────────────────────────────────────────────────────
  if (!hasEverLoaded && !isError) {
    return (
      <div className={styles.loading}>
        <span className={styles.loadingDot} />
        <span className={styles.loadingText}>Aligning the orrery…</span>
      </div>
    );
  }

  // ── Selected-place derived view ──────────────────────────────────────────
  const cycleId      = selectedPlace?.cycleId;
  const cycleState   = (selectedPlace?.status?.cycle.state ?? 'day') as CycleState;
  const detailAccent = selectedPlace?.activity?.isPrime ? GOLD : JADE;

  return (
    <div className={styles.page} data-world={cycleId ?? selectedPlace?.giverId ?? 'none'}>
      <div className={styles.content}>
        <PageHero prefix="CELESTIAL" title="PENDULUM" />

        {import.meta.env.DEV && (
          <button type="button" onClick={() => setShowWireframe(true)} className={styles.devChip} data-gold>
            ◔ View re-plan wireframe (dev)
          </button>
        )}

        {/* ── Hub top tabs ─────────────────────────────────────────────── */}
        <nav className={styles.hubTabs} role="tablist" aria-label="Celestial sections">
          {HUB_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={t.key === hubTab}
              className={styles.hubTab}
              data-active={t.key === hubTab || undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setHubTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className={styles.tabPanel} key={hubTab} role="tabpanel">
          {/* ── Overview (interim: what's good now + all-worlds board) ──── */}
          {hubTab === 'overview' && (
            <>
              <RightNowHero active={hero.active} upcoming={hero.upcoming} onSelect={(id) => goToPlace(id)} />
              <OverviewPanel places={places} onSelect={goToPlace} />
            </>
          )}

          {/* ── Worlds (the first real tab) ─────────────────────────────── */}
          {hubTab === 'worlds' && (
            <>
              <div className={styles.placeChips} role="tablist" aria-label="Places">
                {places.map((p) => {
                  const isPrime = p.activity?.isPrime ?? false;
                  const sel = p.key === selectedPlace?.key;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      role="tab"
                      aria-selected={sel}
                      className={styles.placeChip}
                      data-active={sel || undefined}
                      data-prime={isPrime || undefined}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setSelectedKey(p.key)}
                    >
                      <span className={styles.placeChipDot} />
                      {p.label}
                    </button>
                  );
                })}
              </div>

              {selectedPlace?.status && selectedPlace.meta && selectedPlace.activity && cycleId ? (
                <WorldActivityDetail
                  meta={selectedPlace.meta}
                  status={selectedPlace.status}
                  urgency={selectedPlace.urgency}
                  activity={selectedPlace.activity}
                  accent={detailAccent}
                  resources={getKeyResources(cycleId, cycleState)}
                  staleData={isDataOutOfSync}
                  artUrl={getWorldBg(cycleId, cycleState)}
                />
              ) : selectedPlace ? (
                <StaticPlaceHero
                  label={selectedPlace.label}
                  region={selectedPlace.region}
                  npc={selectedPlace.npc}
                  blurb={selectedPlace.blurb}
                />
              ) : null}

              {/* Timer: open the per-world "next hours" view on demand (popover) —
                  it no longer sits inline eating space. */}
              {selectedPlace?.status && cycleId && (
                <NextHoursButton cycle={selectedPlace.status.cycle} accent={detailAccent} />
              )}

              {/* No tabs — the place's facets STACK: bounties, then fishing below
                  (plus the Circuit for Duviri, which has no open-world giver). */}
              {(selectedPlace?.giver || selectedPlace?.giverId) && (
                <BountyBoard giver={selectedPlace?.giver ?? null} emptyReason={emptyReason} />
              )}

              {cycleId === 'duviri' && (
                <CircuitPanel circuit={duviriCircuit} accent={detailAccent} />
              )}

              {cycleId && (
                <ComingSoon
                  label="Fishing"
                  note="Fish for this place, each tagged with its cycle (day/night · warm/cold). Listing + tags land next — the fish dataset is being mapped in."
                />
              )}
            </>
          )}

          {/* ── Activities (live rotating missions) ─────────────────────── */}
          {hubTab === 'activities' && <ActivitiesTab />}

          {/* ── Nightwave (battle-pass style) ───────────────────────────── */}
          {hubTab === 'nightwave' && <NightwaveTab />}

          {/* ── Vendors & Syndicates (merged DIM-style index) ───────────── */}
          {hubTab === 'market' && <VendorsSyndicatesTab />}

          {/* ── Events (operations: active-event view + recurring index) ── */}
          {hubTab === 'events' && <EventsTab />}
        </div>

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <div className={styles.footer}>
          <span className={styles.footerDot} />
          <span className={styles.footerLabel}>Reward data updated {dropsAgeLabel}</span>
        </div>
      </div>
    </div>
  );
}
