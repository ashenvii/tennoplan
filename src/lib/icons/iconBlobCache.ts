/**
 * Icon blob cache — CDN download + Cache API persistence + concurrency queue.
 *
 * Single source of truth for icon URLs across the entire app.
 *
 * Flow per icon:
 *   1. In-memory Map (instant, this session)
 *   2. Browser Cache API (fast, survives restarts)
 *   3. CDN fetch via concurrency-limited queue (max 15 parallel)
 *   4. Browser only: if fetch() is blocked by CORS, load the CDN URL directly
 *      through an <img> (see "Direct loading" below). No local copy is kept.
 *   5. Placeholder on failure (NOT permanently cached; retries on next call)
 *
 * Direct loading: cdn.warframestat.us answers image requests with a 301 that
 * carries no Access-Control-Allow-Origin header, so a browser fetch() to it is
 * rejected as a CORS failure even though <img> loading works fine. Tauri's
 * native fetch has no CORS, so there the blob + Cache API path is unchanged.
 * We deliberately do NOT fetch the redirect target (raw.githubusercontent.com)
 * from the browser: it is an undocumented implementation detail of the CDN and
 * rate-limits bulk use.
 *
 * Failures are tracked in a separate Set so we don't permanently mark a
 * transiently-failed URL as broken. The "Verify & Repair" button clears this.
 */

import { useState, useEffect } from 'react';
import { nativeFetch, getFetchDiagnostics } from '@/lib/http/nativeFetch';
import { logger } from '@/adapters/logging/logger';

export const ICON_CACHE_NAME = 'tennoplan-icons-v1';
export const PLACEHOLDER = '/lotus-placeholder.svg';

// ─── In-memory state ─────────────────────────────────────────────────────────

const _resolved = new Map<string, string>();        // cdnUrl → blob:// URL (success only)
const _inflight = new Map<string, Promise<string>>(); // cdnUrl → shared download promise
const _failures = new Set<string>();                  // cdnUrl → failed this session (retryable)

// Set once a browser fetch() to the CDN throws a TypeError (CORS block or no
// network). From then on this session skips fetch() and loads icons directly,
// so we do not fire one doomed request per icon.
let _directOnly = false;

// Diagnostic state — exposed for the Settings panel
let _lastError:    string | null = null;
let _failureCount: number = 0;

export function getCacheDiagnostics() {
  return {
    lastError:     _lastError,
    failureCount:  _failureCount,
    resolvedCount: _resolved.size,
    failedUrls:    Array.from(_failures).slice(0, 5), // sample for debugging
  };
}

export function clearFailureRecords(): void {
  _failures.clear();
  _lastError = null;
  _failureCount = 0;
}

// ─── Concurrency queue ───────────────────────────────────────────────────────

const MAX_CONCURRENT = 15;
let _active = 0;
const _waiting: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  return new Promise((resolve) => {
    if (_active < MAX_CONCURRENT) { _active++; resolve(); }
    else { _waiting.push(() => { _active++; resolve(); }); }
  });
}

function releaseSlot(): void {
  _active = Math.max(0, _active - 1);
  const next = _waiting.shift();
  if (next) next();
}

// ─── Direct loading (browser, CORS-blocked CDN) ──────────────────────────────

function probeImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload  = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

/**
 * Verify the CDN URL loads as an <img>, then hand the URL itself back to the
 * caller. A missing icon (404, offline) still resolves to the placeholder.
 * Goes through the same concurrency queue as fetch() so a burst of icons
 * (the bulk sync, a long grid) cannot start thousands of image loads at once.
 */
async function resolveDirect(cdnUrl: string): Promise<string> {
  await acquireSlot();
  try {
    if (await probeImage(cdnUrl)) {
      _resolved.set(cdnUrl, cdnUrl);
      _failures.delete(cdnUrl);
      return cdnUrl;
    }
    _failures.add(cdnUrl);
    _failureCount++;
    _lastError = `Image failed to load: ${shortUrl(cdnUrl)}`;
    return PLACEHOLDER;
  } finally {
    releaseSlot();
  }
}

// ─── Core resolver ────────────────────────────────────────────────────────────

export async function resolveIconBlobUrl(cdnUrl: string): Promise<string> {
  if (!cdnUrl || cdnUrl === PLACEHOLDER) return PLACEHOLDER;

  const mem = _resolved.get(cdnUrl);
  if (mem) return mem;

  const inflight = _inflight.get(cdnUrl);
  if (inflight) return inflight;

  const promise = (async (): Promise<string> => {
    try {
      // Browser session already known to be CORS-blocked: nothing can be in the
      // cache from this session, so skip the lookup too.
      if (_directOnly) return await resolveDirect(cdnUrl);

      // Cache API hit — no network needed
      const cache = await caches.open(ICON_CACHE_NAME);
      const hit   = await cache.match(cdnUrl);
      if (hit) {
        const blob = await hit.blob();
        const url  = URL.createObjectURL(blob);
        _resolved.set(cdnUrl, url);
        _failures.delete(cdnUrl); // recovered
        return url;
      }

      // CDN fetch — uses Rust reqwest in Tauri (no CORS), browser fetch otherwise
      await acquireSlot();
      try {
        const res = await nativeFetch(cdnUrl);
        if (!res.ok) {
          _failures.add(cdnUrl);
          _failureCount++;
          _lastError = `HTTP ${res.status} ${res.statusText} for ${shortUrl(cdnUrl)}`;
          // Log only the first few failures per session to avoid spamming the
          // event log with 13k duplicate entries when a CDN is down.
          if (_failureCount <= 3) {
            logger.error('icons', `Icon HTTP ${res.status}`, {
              url:    cdnUrl,
              status: res.status,
              statusText: res.statusText,
            }, 'iconBlobCache');
          }
          return PLACEHOLDER;
        }
        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        _resolved.set(cdnUrl, url);
        _failures.delete(cdnUrl);
        await cache.put(
          cdnUrl,
          new Response(blob.slice(0), {
            status: 200,
            headers: { 'Content-Type': blob.type },
          }),
        );
        return url;
      } finally {
        releaseSlot();
      }
    } catch (err) {
      // Browser fetch() to the CDN is rejected with a TypeError when CORS blocks
      // it. Fall back to loading the image directly instead of the placeholder.
      if (err instanceof TypeError && getFetchDiagnostics().backend === 'browser') {
        if (!_directOnly) {
          _directOnly = true;
          logger.info('icons',
            'Browser fetch() cannot read the icon CDN (CORS); loading icons directly. Local icon cache needs the desktop app.',
            { url: cdnUrl, error: err.message }, 'iconBlobCache');
        }
        return await resolveDirect(cdnUrl);
      }
      _failures.add(cdnUrl);
      _failureCount++;
      _lastError = err instanceof Error
        ? `${err.name}: ${err.message}`
        : String(err);
      if (_failureCount <= 3) {
        logger.error('icons', `Icon fetch threw: ${_lastError}`, {
          url: cdnUrl,
          error: err,
        }, 'iconBlobCache');
      }
      return PLACEHOLDER;
    } finally {
      _inflight.delete(cdnUrl);
    }
  })();

  _inflight.set(cdnUrl, promise);
  return promise;
}

function shortUrl(u: string): string {
  return u.length > 80 ? `${u.slice(0, 77)}...` : u;
}

// ─── Public helpers ───────────────────────────────────────────────────────────

export function prewarmIconUrl(cdnUrl: string): void {
  if (!cdnUrl || cdnUrl === PLACEHOLDER) return;
  if (_resolved.has(cdnUrl)) return;
  if (_inflight.has(cdnUrl)) return;
  void resolveIconBlobUrl(cdnUrl);
}

export async function clearIconBlobCache(): Promise<void> {
  await caches.delete(ICON_CACHE_NAME);
  _resolved.clear();
  _inflight.clear();
  _failures.clear();
  _directOnly = false;
  _waiting.length = 0;
  _active = 0;
  _lastError = null;
  _failureCount = 0;
}

// ─── React hook ───────────────────────────────────────────────────────────────

export function useIconBlobUrl(cdnUrl: string): string {
  const [url, setUrl] = useState<string>(() => _resolved.get(cdnUrl) ?? PLACEHOLDER);

  useEffect(() => {
    if (!cdnUrl || cdnUrl === PLACEHOLDER) {
      setUrl(PLACEHOLDER);
      return;
    }

    const hit = _resolved.get(cdnUrl);
    if (hit) { setUrl(hit); return; }

    let cancelled = false;
    resolveIconBlobUrl(cdnUrl).then((resolved) => {
      if (!cancelled) setUrl(resolved);
    });
    return () => { cancelled = true; };
  }, [cdnUrl]);

  return url;
}
