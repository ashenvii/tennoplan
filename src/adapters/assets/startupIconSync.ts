/**
 * startupIconSync — preload all wiki-relevant icons at app launch.
 *
 * Alecaframe pattern: download every icon once at startup, store in the
 * browser Cache API, serve blob URLs forever with zero network after that.
 *
 * First launch:  ~13k images, 15 concurrent — typically 20-40s.
 *                App is fully usable while this runs; icons pop in as they resolve.
 * Subsequent:    cache.keys() check finds everything already cached — exits in <1s.
 *
 * Skipped categories (cosmetic-only, not needed for a wiki):
 *   Glyphs  — player profile emblems    (1,648 items)
 *   Sigils  — warframe body markings    (330 items)
 *   Misc    — engine/internal assets    (1,213 items)
 */

import { getAllItems } from '@/adapters/items/itemsAdapter';
import { getIconUrl } from '@/lib/icons/IconResolver';
import {
  resolveIconBlobUrl,
  clearIconBlobCache,
  clearFailureRecords,
  ICON_CACHE_NAME,
  PLACEHOLDER,
} from '@/lib/icons/iconBlobCache';
import { testCdnConnection } from '@/lib/http/nativeFetch';
import { logger } from '@/adapters/logging/logger';

// ─── Progress shape ───────────────────────────────────────────────────────────

export interface IconSyncProgress {
  phase:   'idle' | 'preflight' | 'checking' | 'downloading' | 'done' | 'aborted';
  cached:  number;   // icons confirmed in Cache API
  failed:  number;   // icons that could not be fetched
  total:   number;   // total wiki-relevant items in items-map
  pct:     number;   // 0–100 fill for the progress bar
  /** Set when phase is 'aborted' — actionable error message for the user. */
  error?:  string | null;
  /** HTTP backend used for the last fetch — 'tauri-http' is the goal in Tauri. */
  backend?: string;
}

// ─── Listeners ────────────────────────────────────────────────────────────────

type ProgressListener = (p: IconSyncProgress) => void;
const _listeners = new Set<ProgressListener>();

export function onIconSyncProgress(fn: ProgressListener): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

// Throttle emits to max once per 80ms so the bar animates smoothly
// without triggering hundreds of React re-renders per second.
let _lastEmit = 0;

function emit(p: IconSyncProgress): void {
  const now = Date.now();
  // Always emit terminal/diagnostic phases; throttle only the bulk progress
  const force = p.phase !== 'downloading';
  if (!force && now - _lastEmit < 80) return;
  _lastEmit = now;
  for (const fn of _listeners) fn(p);
}

// ─── State ────────────────────────────────────────────────────────────────────

const SKIP = new Set(['Glyphs', 'Sigils', 'Misc']);

type Phase = 'idle' | 'running';
let _phase: Phase = 'idle';

/** Snapshot of the last emitted progress — lets late-mounting components
 *  immediately render the current state without waiting for the next emit. */
let _snapshot: IconSyncProgress = {
  phase: 'idle', cached: 0, failed: 0, total: 0, pct: 0,
};

export function getIconSyncSnapshot(): IconSyncProgress {
  return _snapshot;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function wikiItems() {
  return getAllItems().filter((i) => i.imageName && !SKIP.has(i.category));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Call once at app startup. Non-blocking — returns immediately.
 * Subsequent calls while already running are ignored.
 */
export function startupIconSync(): void {
  if (_phase !== 'idle') return;
  _phase = 'running';
  void _run(false);
}

/**
 * Re-check the cache and download any missing icons.
 * Clears prior session failures so transiently-failed URLs get retried.
 */
export function verifyAndRepairIcons(): void {
  if (_phase === 'running') return;
  _phase = 'running';
  clearFailureRecords();
  void _run(false);
}

/**
 * Wipe the entire icon cache and re-download everything from scratch.
 * Shows full progress in Settings.
 */
export async function clearAndRedownloadIcons(): Promise<void> {
  if (_phase === 'running') return;
  _phase = 'running';
  await clearIconBlobCache();
  void _run(true);
}

// ─── Core runner ─────────────────────────────────────────────────────────────

async function _run(fullRedownload: boolean): Promise<void> {
  const items = wikiItems();
  const total = items.length;

  // ── Phase: preflight ──────────────────────────────────────────────────────
  // Verify ONE known icon downloads cleanly before queuing 13k requests.
  // If preflight fails, abort with a clear error instead of grinding through
  // every URL and reporting "13,781 failed" — actionable diagnostics matter.
  const preflightProgress: IconSyncProgress = {
    phase: 'preflight', cached: 0, failed: 0, total, pct: 0,
  };
  _snapshot = preflightProgress;
  emit(preflightProgress);

  // Use real URLs from the bundled items-map so preflight matches whatever
  // naming convention this build of @wfcd/items uses (Aya.png, Ash.png, etc.).
  // Sample 5 items so a single stale entry doesn't kill the whole sync.
  const probeCandidates = items
    .slice(0, 5)
    .map((it) => getIconUrl(it.imageName));

  const preflight = await testCdnConnection(probeCandidates);
  if (!preflight.ok) {
    // In a plain browser, fetch() to the CDN is blocked by CORS (a TypeError), so
    // bulk caching cannot work there. Icons still display via direct <img>
    // loading (see iconBlobCache), so this is expected, not an error.
    const browserCorsBlock = preflight.backend === 'browser' && preflight.errorName === 'TypeError';
    const aborted: IconSyncProgress = {
      phase:   'aborted',
      cached:  0,
      failed:  0,
      total,
      pct:     0,
      error:   browserCorsBlock
        ? `Icons load directly from the CDN in the browser. Local icon caching needs the desktop app, ` +
          `because the browser cannot read cdn.warframestat.us with fetch() (${preflight.message}).`
        : `Preflight failed via ${preflight.backend}: ${preflight.message}. ` +
          `Likely fixes: (1) restart Tauri to load tauri-plugin-http, ` +
          `(2) verify network access to cdn.warframestat.us.`,
      backend: preflight.backend,
    };
    _snapshot = aborted;
    _phase    = 'idle';
    emit(aborted);
    const detail = {
      backend:    preflight.backend,
      message:    preflight.message,
      probedUrl:  preflight.url,
      durationMs: preflight.durationMs,
    };
    if (browserCorsBlock) {
      logger.info('icons', `Icon sync skipped in browser: ${preflight.message}`, detail, 'startupIconSync');
    } else {
      logger.error('network', `Icon sync preflight failed: ${preflight.message}`, detail, 'startupIconSync');
    }
    return;
  }
  logger.info('icons', `Icon sync preflight OK (${preflight.backend}, ${preflight.durationMs}ms)`, {
    backend:    preflight.backend,
    durationMs: preflight.durationMs,
  }, 'startupIconSync');

  // ── Phase: checking ────────────────────────────────────────────────────────
  const progress: IconSyncProgress = {
    phase: 'checking', cached: 0, failed: 0, total, pct: 0,
    backend: preflight.backend,
  };
  _snapshot = progress;
  emit(progress);

  let alreadyCached = 0;
  let toFetch = items;

  if (!fullRedownload) {
    try {
      const cache      = await caches.open(ICON_CACHE_NAME);
      const cachedKeys = await cache.keys();
      const cachedUrls = new Set(cachedKeys.map((r) => r.url));
      toFetch       = items.filter((i) => !cachedUrls.has(getIconUrl(i.imageName)));
      alreadyCached = total - toFetch.length;
    } catch {
      // Cache API unavailable — download everything
    }
  }

  let cached  = alreadyCached;
  let failed  = 0;

  if (toFetch.length === 0) {
    const done: IconSyncProgress = {
      phase: 'done', cached, failed, total, pct: 100,
      backend: preflight.backend,
    };
    _snapshot = done;
    _phase    = 'idle';
    emit(done);
    return;
  }

  // ── Phase: downloading ────────────────────────────────────────────────────
  const downloading: IconSyncProgress = {
    phase: 'downloading', cached, failed, total,
    pct: Math.round((cached / total) * 100),
    backend: preflight.backend,
  };
  _snapshot = downloading;
  emit(downloading);

  const promises = toFetch.map((item) =>
    resolveIconBlobUrl(getIconUrl(item.imageName)).then((result) => {
      if (result === PLACEHOLDER) failed++;
      else cached++;
      const p: IconSyncProgress = {
        phase: 'downloading',
        cached,
        failed,
        total,
        pct: Math.round(((cached + failed) / total) * 100),
        backend: preflight.backend,
      };
      _snapshot = p;
      emit(p);
    }),
  );

  await Promise.allSettled(promises);

  // ── Stale-icon rate on the frozen fallback map ──────────────────────────────
  // This bulk pre-cache runs against the FROZEN fallback-items-map (S1a). As it
  // ages, some icon URLs 404 — that's expected and no longer actionable (the map
  // is intentionally not regenerated; the codex carries current icons, fetched
  // on demand). Logged as info, not an actionable warning.
  const failureRate = toFetch.length > 0 ? failed / toFetch.length : 0;
  if (failureRate > 0.05 && failed > 10) {
    logger.info('icons',
      `Frozen fallback map has ${failed} of ${toFetch.length} stale icon URLs (${(failureRate * 100).toFixed(1)}% 404) — expected as it ages; codex carries current icons`,
      { failed, attempted: toFetch.length, cached, failureRate },
      'startupIconSync',
    );
  } else if (failed > 0) {
    logger.info('icons', `Icon sync complete with ${failed} non-fatal failures`, {
      cached, failed, total, attempted: toFetch.length,
    }, 'startupIconSync');
  } else if (toFetch.length > 0) {
    logger.info('icons', `Icon sync complete: ${cached} cached`, {
      cached, total, downloaded: toFetch.length,
    }, 'startupIconSync');
  }

  const done: IconSyncProgress = {
    phase: 'done', cached, failed, total, pct: 100,
    backend: preflight.backend,
  };
  _snapshot = done;
  _phase    = 'idle';
  emit(done);
}
