/**
 * nativeFetch — CORS-free HTTP inside Tauri, standard browser fetch elsewhere.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Browser fetch() enforces CORS. CDNs like cdn.warframestat.us don't send
 * Access-Control-Allow-Origin headers on image responses — they're designed
 * for <img> tags, not JS fetch calls. Every fetch() → CORS rejection → "failed".
 *
 * tauri-plugin-http routes requests through Rust's reqwest. reqwest is a
 * native HTTP client — no browser security model, no CORS, no rate-limit flags.
 * This is exactly how desktop apps (Alecaframe, WFInfo, etc.) download assets.
 *
 * DIAGNOSTICS
 * ───────────
 * getFetchDiagnostics() reports whether we're in Tauri, whether the plugin
 * loaded, and the last error — surfaced in the Settings panel so the user
 * can see exactly what went wrong.
 */

const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export type FetchBackend = 'tauri-http' | 'browser' | 'unknown';

export interface FetchDiagnostics {
  isTauri:         boolean;
  pluginLoaded:    boolean;
  pluginLoadError: string | null;
  backend:         FetchBackend;
  lastError:       string | null;
  lastUrl:         string | null;
}

let _tauriFetch:    typeof fetch | null | undefined = undefined;
let _pluginError:   string | null = null;
let _lastError:     string | null = null;
let _lastUrl:       string | null = null;

async function resolveTauriFetch(): Promise<typeof fetch | null> {
  if (_tauriFetch !== undefined) return _tauriFetch;
  if (!IS_TAURI) { _tauriFetch = null; return null; }

  try {
    const mod = await import('@tauri-apps/plugin-http');
    if (typeof mod.fetch !== 'function') {
      _pluginError = 'Plugin module loaded but fetch export is missing';
      _tauriFetch = null;
    } else {
      _tauriFetch = mod.fetch as typeof fetch;
    }
  } catch (err) {
    _pluginError = err instanceof Error ? err.message : String(err);
    _tauriFetch = null;
  }

  return _tauriFetch;
}

export function getFetchDiagnostics(): FetchDiagnostics {
  const pluginLoaded = _tauriFetch !== undefined && _tauriFetch !== null;
  const backend: FetchBackend =
    !IS_TAURI ? 'browser'
    : pluginLoaded ? 'tauri-http'
    : _tauriFetch === null ? 'browser'   // tried, failed → fell back
    :                       'unknown';
  return {
    isTauri:         IS_TAURI,
    pluginLoaded,
    pluginLoadError: _pluginError,
    backend,
    lastError:       _lastError,
    lastUrl:         _lastUrl,
  };
}

export async function nativeFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  _lastUrl = url;
  const impl = await resolveTauriFetch();
  try {
    const res = await (impl ? impl(url, init) : fetch(url, init));
    if (!res.ok) {
      _lastError = `HTTP ${res.status} ${res.statusText} (${url.slice(0, 80)})`;
    } else {
      _lastError = null;
    }
    return res;
  } catch (err) {
    _lastError = err instanceof Error
      ? `${err.name}: ${err.message}`
      : String(err);
    throw err;
  }
}

export interface ConnectionTestResult {
  ok:         boolean;
  url:        string;
  message:    string;
  /** `Error.name` when the request threw (a CORS block is a `TypeError`). */
  errorName?: string;
  backend:    FetchBackend;
  durationMs: number;
}

async function probeOne(url: string): Promise<ConnectionTestResult> {
  const start = performance.now();
  try {
    const res = await nativeFetch(url);
    const duration = Math.round(performance.now() - start);
    const diag = getFetchDiagnostics();
    if (!res.ok) {
      return {
        ok: false, url,
        message: `HTTP ${res.status} ${res.statusText}`,
        backend: diag.backend, durationMs: duration,
      };
    }
    const blob = await res.blob();
    return {
      ok: true, url,
      message: `${(blob.size / 1024).toFixed(1)} KB in ${duration}ms`,
      backend: diag.backend, durationMs: duration,
    };
  } catch (err) {
    const duration = Math.round(performance.now() - start);
    const diag = getFetchDiagnostics();
    return {
      ok: false, url,
      message: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      ...(err instanceof Error && { errorName: err.name }),
      backend: diag.backend, durationMs: duration,
    };
  }
}

/**
 * Connectivity test that's resilient to individual filename rot.
 * Probes up to N URLs from the candidate list — succeeds as soon as ONE works.
 * Only fails if connectivity is truly broken.
 */
export async function testCdnConnection(
  candidateUrls: string[] = [
    // Hardcoded fallbacks — current as of @wfcd/items 1.1274.x naming convention.
    // The startup sync passes real items-map URLs which always reflect the
    // currently-bundled filename scheme.
    'https://cdn.warframestat.us/img/Aya.png',
    'https://cdn.warframestat.us/img/Excalibur.png',
    'https://cdn.warframestat.us/img/Ash.png',
  ],
): Promise<ConnectionTestResult> {
  let last: ConnectionTestResult | null = null;
  for (const url of candidateUrls) {
    const result = await probeOne(url);
    if (result.ok) return result;
    last = result;
  }
  return last ?? {
    ok: false, url: '',
    message: 'No URLs to probe',
    backend: 'unknown', durationMs: 0,
  };
}
