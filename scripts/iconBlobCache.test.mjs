// Tests for src/lib/icons/iconBlobCache.ts (issue #8).
//
// Run:  node --test scripts/iconBlobCache.test.mjs
//
// The project has no test runner, so this uses node:test and the installed
// `typescript` package to transpile the real module, with the browser globals
// (Cache API, Image, URL.createObjectURL) and the two project imports stubbed.
// Set ICON_CACHE_SRC to test a different copy of the file (for example the
// version from before the fix).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root   = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcPath = process.env.ICON_CACHE_SRC ?? join(root, 'src/lib/icons/iconBlobCache.ts');
const dir    = mkdtempSync(join(tmpdir(), 'iconblobcache-'));

writeFileSync(join(dir, 'react.mjs'),
  'export const useState = () => { throw new Error("hook not under test"); };\n' +
  'export const useEffect = () => {};\n');
writeFileSync(join(dir, 'nativeFetch.mjs'),
  'export const nativeFetch = (...a) => globalThis.__t.nativeFetch(...a);\n' +
  'export const getFetchDiagnostics = () => ({ backend: globalThis.__t.backend });\n');
writeFileSync(join(dir, 'logger.mjs'),
  'const rec = (level) => (...a) => globalThis.__t.logs.push([level, ...a]);\n' +
  'export const logger = { info: rec("info"), warn: rec("warn"), error: rec("error") };\n');

const js = ts.transpileModule(readFileSync(srcPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
  .replace(/from ['"]react['"]/, `from './react.mjs'`)
  .replace(/from ['"]@\/lib\/http\/nativeFetch['"]/, `from './nativeFetch.mjs'`)
  .replace(/from ['"]@\/adapters\/logging\/logger['"]/, `from './logger.mjs'`);
writeFileSync(join(dir, 'iconBlobCache.mjs'), js);

const CDN   = 'https://cdn.warframestat.us/img/MeleeDamageMod.jpg';
const OTHER = 'https://cdn.warframestat.us/img/AbilityRangeMod.jpg';
let n = 0;

/** Fresh module instance (the module keeps session state) plus fake browser globals. */
async function setup({ backend, nativeFetch, imageOk = () => true, imageGate = null }) {
  const stored = new Map();
  const t = { backend, nativeFetch, logs: [], fetchCalls: 0, imageProbes: [], puts: [], activeProbes: 0, maxActiveProbes: 0 };
  const wrapped = (...a) => { t.fetchCalls++; return nativeFetch(...a); };
  t.nativeFetch = wrapped;
  globalThis.__t = t;
  globalThis.caches = {
    open: async () => ({
      match: async (u) => stored.get(u),
      put:   async (u, r) => { t.puts.push(u); stored.set(u, r); },
    }),
    delete: async () => true,
  };
  globalThis.URL.createObjectURL = () => 'blob:fake-' + (++n);
  globalThis.Image = class {
    set src(u) {
      t.imageProbes.push(u);
      t.maxActiveProbes = Math.max(t.maxActiveProbes, ++t.activeProbes);
      Promise.resolve(imageGate).then(() => {
        t.activeProbes--;
        imageOk(u) ? this.onload?.() : this.onerror?.();
      });
    }
  };
  const mod = await import(pathToFileURL(join(dir, 'iconBlobCache.mjs')).href + '?v=' + (++n));
  return { mod, t };
}

const corsBlocked = () => Promise.reject(new TypeError('Failed to fetch'));
const okImage = () => Promise.resolve(new Response(new Blob(['img'], { type: 'image/jpeg' }), { status: 200 }));

test('browser, CORS-blocked fetch: icon loads directly instead of the placeholder', async () => {
  const { mod, t } = await setup({ backend: 'browser', nativeFetch: corsBlocked });
  const out = await mod.resolveIconBlobUrl(CDN);
  assert.equal(out, CDN);
  assert.deepEqual(t.imageProbes, [CDN]);
  assert.equal(t.puts.length, 0, 'nothing can be written to the icon cache in this mode');
});

test('browser, CORS-blocked fetch: later icons skip fetch() and the result is remembered', async () => {
  const { mod, t } = await setup({ backend: 'browser', nativeFetch: corsBlocked });
  await mod.resolveIconBlobUrl(CDN);
  assert.equal(t.fetchCalls, 1);
  assert.equal(await mod.resolveIconBlobUrl(OTHER), OTHER);
  assert.equal(t.fetchCalls, 1, 'no second doomed fetch');
  assert.equal(await mod.resolveIconBlobUrl(CDN), CDN);
  assert.equal(t.imageProbes.length, 2, 'repeat lookup is served from memory');
  assert.equal(t.logs.filter(([l]) => l === 'error').length, 0, 'CORS fallback is not logged as an error');
  assert.equal(t.logs.filter(([l]) => l === 'info').length, 1, 'fallback is logged once');
});

test('browser, CORS-blocked fetch, icon genuinely missing: falls back to the placeholder', async () => {
  const { mod, t } = await setup({ backend: 'browser', nativeFetch: corsBlocked, imageOk: () => false });
  assert.equal(await mod.resolveIconBlobUrl(CDN), mod.PLACEHOLDER);
  const d = mod.getCacheDiagnostics();
  assert.equal(d.failureCount, 1);
  assert.deepEqual(d.failedUrls, [CDN]);
  assert.equal(t.puts.length, 0);
});

test('missing icon is retried later, not cached as a permanent failure', async () => {
  let up = false;
  const { mod } = await setup({ backend: 'browser', nativeFetch: corsBlocked, imageOk: () => up });
  assert.equal(await mod.resolveIconBlobUrl(CDN), mod.PLACEHOLDER);
  up = true;
  assert.equal(await mod.resolveIconBlobUrl(CDN), CDN);
});

test('Tauri backend: blob URL is created and written to the icon cache', async () => {
  const { mod, t } = await setup({ backend: 'tauri-http', nativeFetch: okImage });
  const out = await mod.resolveIconBlobUrl(CDN);
  assert.match(out, /^blob:fake-/);
  assert.deepEqual(t.puts, [CDN]);
  assert.equal(t.imageProbes.length, 0, 'no direct loading when the native fetch works');
});

test('Tauri backend: a cache hit needs no network', async () => {
  const { mod, t } = await setup({ backend: 'tauri-http', nativeFetch: okImage });
  await mod.resolveIconBlobUrl(CDN);
  const calls = t.fetchCalls;
  // New module instance, same Cache API store: simulates an app restart.
  const second = await import(pathToFileURL(join(dir, 'iconBlobCache.mjs')).href + '?v=' + (++n));
  assert.match(await second.resolveIconBlobUrl(CDN), /^blob:fake-/);
  assert.equal(t.fetchCalls, calls);
});

test('Tauri backend: HTTP 404 gives the placeholder and no direct-load fallback', async () => {
  const { mod, t } = await setup({
    backend: 'tauri-http',
    nativeFetch: () => Promise.resolve(new Response('nope', { status: 404, statusText: 'Not Found' })),
  });
  assert.equal(await mod.resolveIconBlobUrl(CDN), mod.PLACEHOLDER);
  assert.equal(t.imageProbes.length, 0);
  assert.equal(t.puts.length, 0);
});

test('Tauri backend: a network error is not masked by direct loading', async () => {
  const { mod, t } = await setup({ backend: 'tauri-http', nativeFetch: corsBlocked });
  assert.equal(await mod.resolveIconBlobUrl(CDN), mod.PLACEHOLDER);
  assert.equal(t.imageProbes.length, 0);
});

test('browser, fetch succeeds (CDN later sends CORS headers): blob and cache path is used', async () => {
  const { mod, t } = await setup({ backend: 'browser', nativeFetch: okImage });
  assert.match(await mod.resolveIconBlobUrl(CDN), /^blob:fake-/);
  assert.deepEqual(t.puts, [CDN]);
});

test('empty and placeholder inputs short-circuit', async () => {
  const { mod, t } = await setup({ backend: 'browser', nativeFetch: corsBlocked });
  assert.equal(await mod.resolveIconBlobUrl(''), mod.PLACEHOLDER);
  assert.equal(await mod.resolveIconBlobUrl(mod.PLACEHOLDER), mod.PLACEHOLDER);
  assert.equal(t.fetchCalls, 0);
});

test('direct loading respects the concurrency cap (15) and still resolves every icon', async () => {
  let open;
  const gate = new Promise((r) => { open = r; });
  const { mod, t } = await setup({ backend: 'browser', nativeFetch: corsBlocked, imageGate: gate });
  const urls = Array.from({ length: 60 }, (_, i) => `https://cdn.warframestat.us/img/Icon${i}.png`);
  const pending = urls.map((u) => mod.resolveIconBlobUrl(u));
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(t.maxActiveProbes <= 15, `at most 15 probes at once, saw ${t.maxActiveProbes}`);
  open();
  assert.deepEqual(await Promise.all(pending), urls);
  assert.ok(t.maxActiveProbes <= 15, `at most 15 probes at once, saw ${t.maxActiveProbes}`);
});

test('clearIconBlobCache leaves direct mode so fetch() is tried again', async () => {
  const { mod, t } = await setup({ backend: 'browser', nativeFetch: corsBlocked });
  await mod.resolveIconBlobUrl(CDN);
  assert.equal(t.fetchCalls, 1);
  await mod.resolveIconBlobUrl(OTHER);
  assert.equal(t.fetchCalls, 1, 'still in direct mode');
  await mod.clearIconBlobCache();
  await mod.resolveIconBlobUrl('https://cdn.warframestat.us/img/Third.png');
  assert.equal(t.fetchCalls, 2, 'fetch() is attempted again after the reset');
});
