# Post-mortems

Bugs worth not repeating: the date, the bug, the gotcha, the fix. Newest last.

---

**Date:** 2026-04-14
**The Bug:** "Server Disconnected" error in Claude Desktop MCP configuration.
**The "Gotcha":** The Windows username `Nuclear Spaceship` contains a space. When the path was used directly in the MCP config JSON, the space broke path resolution - the server process failed to launch silently, surfacing only as a generic disconnection error.
**The Fix:** Use forward slashes in all paths within the config JSON, and wrap the server command with a `cmd /c` wrapper so Windows resolves the spaced path correctly. Example config shape:

```json
{
  "command": "cmd",
  "args": ["/c", "C:/Users/Nuclear Spaceship/...path-to-server..."]
}
```

---

**Date:** 2026-05-20
**The Bug:** ModCard V3 rarity radial glow rendered invisibly. Corner-dodge lights worked fine, but the main halo behind the icon never appeared.
**The "Gotcha":** Two layered failures in the `radial-gradient()` config:
1. `calc(var(--card-w) * var(--v3-art-glow-radius))` with `--v3-art-glow-radius: 53%` resolved to `calc(170px * 53%)` - **invalid CSS** (length × percentage is not allowed in `calc()`). The entire `background` declaration was dropped silently and `getComputedStyle` returned an empty string for `background-image`.
2. After fixing #1 by making the radius a unitless multiplier (`0.53`), the gradient *did* render but was still barely visible. Old defaults were `transparent 70%, color 125%` - the full-color stop sat at 125% of the circle's radius, *outside* the drawn area. The visible region at the edge only reached ~30% of target alpha, and `mix-blend-mode: screen` washed away what little remained.
**The Fix:**
1. Knob is unitless: `--v3-art-glow-radius: 0.55` → `calc(var(--card-w) * 0.55)` resolves to a valid length. Never add `%` or `px` to this knob.
2. Renamed `center`/`feather` to `inner`/`outer` so the second stop sits at ≤ 100% by default: `--v3-art-glow-inner: 35%` and `--v3-art-glow-outer: 100%`. Gradient stops are now `transparent 0%, transparent var(--inner), var(--color) var(--outer)`. Color reaches full strength at the gradient's drawn edge.
**Lesson:** When a CSS gradient renders empty, suspect `calc(length * %)` first. When it renders faintly, check whether your last color stop is inside the gradient's drawn extent - anything past 100% silently clips the color you expected to see.

---

**Date:** 2026-05-29
**The Bug:** Codex passive descriptions never appeared on warframe pages even after a full CI codex rebuild ran successfully. Ability icons added in the *same commit* (`de0d3bf`) DID land, so the wiring looked correct and the silence felt impossible.
**The "Gotcha":** WFCD's `api.warframestat.us/<category>` endpoints accept a `?only=<field-list>` query that **filters the response server-side**. The codex fetcher uses this aggressively to keep payloads small. The previous session added `passiveDescription` to the parser interface, the parser body, the enricher, the worker types, the frontend types, AND wired `PassiveBlock` into the Warframe + Sentinel block sets - every layer except the upstream `?only=` filter in `cloudflare-worker/src/config.ts`. So WFCD stripped `passiveDescription` from the response before it ever reached the parser, and every downstream layer silently emitted nothing. Ability icons survived because `imageName` was already in the `?only=` list from an earlier addition. Diagnosis took: fetch the live blob → count occurrences of `"passiveDescription"` → zero → suspect upstream → curl WFCD raw (`api.warframestat.us/warframes/Ember`) → field IS present → trace back through the worker config to find the filter.
**The Fix:** Single-line addition to `cloudflare-worker/src/config.ts:49` - added `passiveDescription` to the `?only=` list on `wfcdWarframesUrl`:
```ts
wfcdWarframesUrl: 'https://api.warframestat.us/warframes?only=uniqueName,name,description,passiveDescription,polarities,...'
```
Sentinels were unaffected - `wfcdSentinelsUrl` points at the unfiltered GitHub fallback JSON, so it always carries every field.
**Lesson:** **WFCD's `?only=` filter is an upstream firewall.** Every new field added anywhere in the worker pipeline must also be added to the corresponding `?only=` list in `config.ts`, or the rest of the wiring is dead code. Failure mode is silent - no errors, no warnings, just missing data downstream. Sanity check whenever adding a worker field: grep `config.ts` for the URL, confirm the field name appears in the query string.

---

**Date:** 2026-05-29 (later)
**The Bug:** Same `passiveDescription` field disappeared again after being fixed in commit `54242bf`. The user ran the CI workflow manually and saw the field land in the blob once, then the next 6-hour scheduled rebuild silently produced a blob without the field again. This kept toggling on every cron tick. Investigation showed every layer on `Development` was correct: parser, enricher, types, `?only=` filter, frontend wiring, schema-version bump, `cache: 'no-cache'`. None of it explained why the worker output kept regressing.
**The "Gotcha":** GitHub Actions' `schedule` trigger always runs from the repository's default branch (`main`), regardless of which branch the workflow file was last touched on. The workflow's `push` trigger filtered to `branches: [main]` only. Commit `54242bf` (the field-filter fix) only existed on `Development` - `main` still had the old config without `passiveDescription` in the `?only=` list. So:
- The user's manual `workflow_dispatch` from `Development` produced a correct blob (it used Development's config).
- The next scheduled cron run (every 6h) ran from `main`, used the old config, and overwrote KV with a blob missing the field.
- This repeated indefinitely, with the field appearing on manual runs and disappearing on schedule.
The frontend, the parser, the enricher, the cache-busting - all of it was investigated for hours before suspecting the actual culprit: the workflow's branch-of-record at scheduled trigger time.
**The Fix:** Cherry-pick the worker-config commit to `main`:
```bash
git checkout main
git cherry-pick 54242bf
git push origin main   # triggers the workflow's `push to main` path because config.ts changed
```
Result: `main` rebuilt with the fix, KV got a correct blob, future scheduled runs use the now-correct main config.
**Lesson:** **CI scheduled triggers run from the default branch.** Any worker pipeline fix has to land on `main`, not just `Development`, to survive past the next cron tick. Future-proof move: change `build-codex.yml`'s `push` trigger to also watch `Development`, OR add a `branch: Development` selector to `workflow_dispatch`, OR adopt a discipline of merging worker-only fixes to main quickly. The cheapest path is the third - cherry-pick small worker fixes to main as soon as they prove out on Development.

---

**Date:** 2026-06-12
**The Bug:** While tokenizing `ItemTile` icon sizes (`--item-tile-icon`, DIM-style), every live test in the Claude preview browser said CSS width was being *ignored* on the tile icons: inline `width: 40px` computed to 64px, `width: 40px !important` ALSO computed to 64px, with no matching stylesheet rules, no `min-width` clamp, no zoom, no transform. Several rounds were burned adding speculative fixes (`flex-basis`, `min-width: 0`) chasing a phantom "Chromium replaced-flex-item sizing quirk." One poked element later got *stuck* at 40px with the same inline style as its 64px siblings, deepening the confusion.
**The "Gotcha":** Nothing was wrong with the CSS. The element had a tiny CSS `transition` (~1e-05s) on its sizing properties, and the preview tab runs *backgrounded* - backgrounded tabs don't advance animation/compositor frames, so the transition stayed frozen at progress 0 indefinitely. Both `getComputedStyle().width` and `getBoundingClientRect()` report the *interpolated* value, i.e. the pre-change value, no matter how long you `setTimeout` (timers fire; animation clocks don't tick). The smoking gun was `getComputedStyle(el).flexBasis` returning a transition-interpolation snapshot: `calc(min(64px, 100%) + (0 * min(40px, 100%)) + (0 * min(120px, 100%)) + …)` - a sum of all queued transition targets, each weighted by progress **0**. The "stuck at 40px" element was the same effect in reverse: a frame *did* advance once mid-experiments, committing whatever target was current at that instant.
**The Fix:** Disable the transition for the duration of the measurement - then every value resolved exactly as specified, proving the shipped token mechanism correct with zero product-code changes:
```js
el.style.transition = 'none';
// ...change var / measure getBoundingClientRect()...
el.style.transition = '';
```
**Lesson:** When a *headless/backgrounded* browser claims CSS is being ignored - especially when even `!important` inline styles "don't apply" - suspect a frozen transition/animation before suspecting the cascade. Check `getComputedStyle()` for `calc(a + (0 * b) + …)` interpolation snapshots; that pattern is conclusive. Set `transition: none` while measuring in any eval-based verification. And revert speculative fixes once the real cause is found - the `flex-basis` band-aid added mid-chase was removed; only `min-width: 0` was kept (it addresses a real, separate flex-item flooring behavior).

---

**Date:** 2026-06-13
**The Bug:** The frontend had been silently absent from production since 2026-06-02. During this session the user asked to "deploy" the reviewed changes, but it was unclear *how* - CLAUDE.md said the frontend ships via root `npm run deploy` ("web" worker), while `.github/workflows/deploy.yml` had a `deploy-frontend` job running `wrangler pages deploy dist --project-name=tennoplan`. Two contradictory deploy paths, and no obvious sign the frontend had ever updated.
**The "Gotcha":** No `tennoplan` Pages project exists (`wrangler pages project list` is empty) - so the CI `deploy-frontend` Pages job had been **failing silently on every run for over a month**, never deploying anything. Worse, `main`'s copy of `deploy.yml` had *dropped the frontend job entirely* (it only deployed the worker), so neither branch's CI actually shipped the frontend. The real live frontend is the **"web" worker** (root config → vite-generated `dist/wrangler.json`), which had only ever been updated by a manual `npm run deploy` - last run 2026-06-02. A green-looking pipeline masked a month-stale production.
**The Fix:** Confirm the real target before deploying - `wrangler deployments list --name web` (exists, last 2026-06-02) vs `wrangler pages project list` (empty). Deploy manually (`npm run deploy` → https://web.tennoplan.workers.dev, verified 200), then rewrite `deploy.yml`'s `deploy-frontend` to build the SPA + `wrangler deploy` the "web" worker on `main` (validated by a subsequent green CI run that deployed frontend + worker). A related footgun surfaced while merging: `main`'s `deploy-worker` uses `command: deploy --config wrangler.toml` precisely because, without it, wrangler walks up the tree and can grab the root config (a stray root `wrangler.jsonc` once overwrote the worker with the SPA bundle).
**Lesson:** A CI deploy job pointing at a **non-existent target fails silently** and can hide a months-stale production. Never trust a green-ish pipeline - verify the deploy actually changed the live artifact (`deployments list`, or curl the URL + check the asset hash). Keep ONE documented deploy path; when CLAUDE.md and the CI workflow disagree, that disagreement is itself the bug.

---

**Date:** 2026-06-13
**The Bug:** Codex v2 phase B added per-category R2 chunks + a KV manifest, published by `upload-codex.ts`. On the **first** CI run after phase B shipped, the chunks/manifest would never publish - `/v1/codex/manifest` would 503 forever - even though every line of the new code "worked" in isolation.
**The "Gotcha":** `upload-codex`'s long-standing skip-unchanged gate (`if remote.contentHash === new.contentHash → bump metadata.lastSync and return`) returned **before** the newly-added `publishChunks()` call. Because the codex *content* was unchanged from the last (pre-phase-B, monolith-only) publish, the very first phase-B run hit that early-return and published nothing - the chunks/manifest never bootstrapped. The optimization silently assumed the chunks already existed; on day one they didn't. (Caught in review before merge, but it would have shipped a dead endpoint.)
**The Fix:** In the skip-unchanged branch, check the *live manifest's* own presence/hash and publish chunks if it's missing or stale - while still skipping the expensive 17MB monolith rewrite:
```ts
const liveManifest = await kvGet('codex:manifest');
const manifestCurrent = !!liveManifest &&
  JSON.parse(liveManifest).contentHash === metadata.contentHash;
if (!manifestCurrent) await publishChunks();   // bootstrap / drift
```
Go-live log confirmed: `content unchanged but manifest missing/stale - bootstrapping chunk publish` → all 11 chunks + manifest published.
**Lesson:** A "skip if unchanged" gate is only safe if **everything it gates already exists**. When you add a *new* published artifact behind an *existing* change-signal gate, the gate must bootstrap that artifact on first run - check the artifact's own presence, not just the old change signal.

---

**Date:** 2026-06-13
**The Bug:** Verifying the codex delta sync through `preview_eval` (Claude preview browser), every attempt to read async IndexedDB / dynamic-import state returned `{}` - the eval appeared to silently "lose" the data.
**The "Gotcha":** `preview_eval` serializes the expression's return value **synchronously** - it does NOT await a returned Promise. A returned Promise JSON-serializes to `{}`. So `(() => new Promise(...))()` or `import('…').then(…)` returned directly always yields `{}`, regardless of how the async work goes.
**The Fix:** Stash the async result on `window` and read it in a **second** eval:
```js
// eval 1 - kick off, store, return a sync sentinel
(() => { window.__x = 'pending'; doAsync().then(r => window.__x = r).catch(e => window.__x = {error:String(e)}); return 'go'; })()
// eval 2 - read the resolved value
window.__x
```
**Lesson:** For any async verification through `preview_eval`, use the window-stash + second-read pattern. Together with the 2026-06-12 "backgrounded preview freezes transitions" entry, these are the two recurring preview-based-verification gotchas - both stem from `preview_eval` being a synchronous snapshot of a tab that doesn't advance its own clocks.

---

**Date:** 2026-06-13
**The Bug:** The Codex tab (and every codex-powered surface) rendered empty "no data" in the production build, even though the backend served all 9008 items and a locally-built client worked perfectly.
**The "Gotcha":** `VITE_WORLDSTATE_WORKER_URL` drives BOTH the codex and worldstate sync, and Vite inlines `import.meta.env.VITE_*` at **build** time. `.env` is **gitignored** (only `.env.example` is committed), so CI had no local fallback and injected the value from a GitHub Actions secret - **but that secret never existed** (`gh secret list` showed only the two Cloudflare secrets). So CI-built bundles baked in an empty URL → `StaticDataService.ENDPOINT = null` → "codex sync disabled" → only synthetic currency rows survived → empty codex + dead live pages. The live site worked only because it was last shipped via a local `npm run deploy` (which reads local `.env`); the next push to `main` would have re-emptied it.
**The Fix:** Two layers. (1) Added `src/lib/config/workerBase.ts` - a hardcoded production default (`https://app.tennoplan.workers.dev`) used whenever the env var is absent/blank; both `StaticDataService` and `WorldstateSync` import `WORKER_BASE` from there, so a missing env var can never brick the app again. (2) Created the missing repo secret: `gh secret set VITE_WORLDSTATE_WORKER_URL --body "https://app.tennoplan.workers.dev"`. The URL is not sensitive (it's already in `.env.example` + `build-codex.yml`).
**Fast triage next time:** grep the deployed JS bundle for `app.tennoplan.workers.dev` - if the service that reads it lacks the literal, the env var was empty at build.

---

**Date:** 2026-06-13
**The Bug:** The Sortie reward POOL never appeared anywhere in the app - `db.dropLocations` held zero `Sortie Reward` rows on every client, so the Activities → Sortie card had nothing to show.
**The "Gotcha":** The client drop normaliser (`dropsService.normaliseDropPayload`) typed `sortieRewards` as `{ rewardType, drops }[]` and read `s.drops` per entry. But drops.warframestat.us ships `sortieRewards` as a **FLAT reward array** (`[{ itemName, rarity, chance }, …]`, 17 entries - the whole pool is one table). `s.drops` was always `undefined` → `normaliseRewards([])` → `continue` on every entry → the entire section silently produced zero rows. (The CI codex parser already treated it as a flat array via `toReward` - only the client copy was wrong.)
**The Fix:** In `dropsService.ts`, parse the flat array directly - `normaliseRewards(raw.sortieRewards)` → one `Sortie Reward` DropLocation holding all 17 rewards. Changed `RawDropPayload.sortieRewards` to `RawDropEntry[]` and bumped `DropDataService.PARSER_VERSION` 4 → 5 to force a re-parse on existing caches. Verified: all 17 real sortie rewards now land in Dexie and render as codex tiles (13/17 resolve to quick-look-able entries; the rest are generic Rivens/Legendary Core).
**Note:** `src/core/services/dropRateService.ts` carries the *same* wrong sortie shape, but it's dead code (its `useDropRates` hook is defined and never imported) - harmless, candidate for removal.

---

**Date:** 2026-06-13
**The Bug:** In the local Tauri build the Codex stayed empty even after clicking Settings → "Clear Local Data" to refresh it. Console: `Codex stale (0 items) - auto-refreshing…` then `Codex unchanged (manifest). 0 items remain.` - the delta sync declared itself current while the table was empty. (Distinct from the CI-secret bug above: here the worker URL was correctly configured - the worldstate synced fine - so it was purely a codex delta-sync stranding bug.)
**The "Gotcha":** Codex v2 delta sync keeps a per-category chunk-hash map in `settings['codex:chunkHashes']` and only downloads chunks whose hash differs. The `304` (manifest-unchanged) path already guarded "hashes intact but rows gone." The `toFetch === 0` (manifest 200, all hashes match) path did NOT. Two ways to reach the stranded state: (1) "Clear Local Data" (`SettingsPage` Danger Zone) wiped `tennoplanItems` + `syncMetadata` + `cache` but **not** `codex:chunkHashes`; (2) IndexedDB quota eviction dropping the table independently. Either way the hash map outlived the rows → next sync fetched the manifest, saw every hash still matching → `toFetch = 0` → returned `not-modified` → the empty codex never repopulated. The 4 "items remaining" were just the synthetic currencies re-added afterward.
**The Fix:** Two layers, both in this session. (1) `performDeltaSync` (StaticDataService): when `toFetch === 0 && removed === 0`, trust "not-modified" only if `localCount >= manifest.itemCount`; otherwise log + force `toFetch = manifest.chunks.slice()` (re-download every chunk). This SELF-HEALS the stuck state on next launch with zero user action - verified: staged the exact state (0 rows + intact 11-category hash map + no metadata), reloaded, codex repopulated to 9008. (2) `SettingsPage` Danger Zone now also calls `clearCodexChunkHashes()` so a manual clear fully resets codex state and can't recreate the strand.
**Lesson:** A content-addressed/chunk-hash cache has TWO pieces of truth (the hash map AND the rows). Any guard that says "nothing changed, skip the download" must verify the rows still exist, not just that the hashes match - on EVERY path (304 and 200), and every wipe site must clear the hash map together with the rows it describes.

---

**Date:** 2026-06-15
**The Bug:** A full batch of authored "Cephalon's Notes" (the Warframe `fieldNotes`) appeared to do nothing in production - the user opened Hildryn Prime in the live app and saw the Stat Profile + Description but **no Cephalon's Notes section at all**, despite every note being written, committed, type-checked, and reported "done." ("I dont see jack ass nothing done.")
**The "Gotcha":** The notes were committed on `Development`, but the codex blob is rebuilt by CI **from `main`** (`build-codex.yml` runs main's copy of `fieldNotes.ts`). Nothing had been merged to main, so the live codex carried `fieldNotes: false` on every Warframe, and `CephalonNotesBlock` returns `null` when notes are absent → the section silently renders nothing. "Done" meant authored + committed, **not published.** A second trap layered on top: the deepened notes dropped the top-level `points` array in favour of `sections`, so the sections-aware frontend MUST ship in the same push as the new data - the old block only read `points` and would have rendered just the tldr.
**The Fix:** Merge `Development`→`main` with `--no-ff`; the push to main **auto-fires** `build-codex.yml` (path-filtered to `cloudflare-worker/src/codex/**` + `types.ts`) AND `deploy.yml`, so the codex data and the sections-aware frontend ship together. Verify on the rebuilt chunk (`/v1/codex/chunk/<Category>-<hash>.json`), not just locally.
**Lesson:** Codex `fieldNotes` are invisible until **merged to main + a codex rebuild** - committing on Development is not shipping. Whenever the report is "I wrote it but it doesn't show," check the publish path (Is it on `main`? Did the codex CI rebuild?) before re-auditing the code. And if a data change alters the field shape the UI reads, ship the UI change in the same push.

---

**Date:** 2026-06-15 (later)
**The Bug:** Right after a codex rebuild that removed the Trivia sections, the live `GET /v1/codex/manifest` still pointed at the **old** Warframe chunk (`Warframe-07ae677…`, with Trivia) for several minutes - and a cache-buster query (`?cb=<ts>`) didn't change it - making it look like the rebuild had silently skipped publishing the new content.
**The "Gotcha":** The build HAD published. The CI run log showed `[upload-codex] R2 put chunks/Warframe-fafb4a88….json` (a NEW immutable chunk key) and `published codex:manifest`. The stale read was **Cloudflare KV eventual consistency** - the `codex:manifest` KV value can take a few minutes to propagate to the edge POP serving the request, while the monolith `codex:current` happened to propagate first (so `/v1/codex` was already fresh while `/v1/codex/manifest` lagged). No CDN cache was involved - the response had **no `cf-cache-status` header** (served straight from the worker reading KV), which is exactly why the query-string cache-buster did nothing.
**The Fix:** Don't trust `/v1/codex/manifest` in the first few minutes after a rebuild. Verify via either (a) the monolith `GET /v1/codex` (often propagates first), or (b) fetch the new immutable chunk **key straight from the run log** (`[upload-codex] R2 put chunks/<Category>-<newhash>.json`) and read it directly - content-addressed + `Cache-Control: immutable`, so it's always the right bytes. Re-poll the manifest ~1 min later and it catches up.
**Lesson:** A green `build-codex` run can be momentarily *contradicted* by a stale `/v1/codex/manifest` - that's KV propagation lag, not a failed publish. Confirm the chunk key changed (run log) or read the monolith before concluding the rebuild didn't ship. (Note: the content-hash recipe in `build-codex.ts` strips only `lastUpdated`/`dataVersion`, so it DOES include `fieldNotes` - note edits correctly move the chunk key and republish; no skip-unchanged false-negative.)

---

**Date:** 2026-06-16
**The Bug:** A whole sweep of authored weapon Cephalon's Notes (melee + sentinel + arch, 4 commits) never went live. The `build-codex` CI workflow had been **failing on every run for hours** and serving last-good (the codex was frozen at the prior "rifles" build), yet local `npx tsc -b` passed clean every time so nothing looked wrong.
**The "Gotcha":** TWO layers. (1) `cloudflare-worker/src/codex/fieldNotes.ts` had **11 ASCII apostrophes inside single-quoted TS strings** (`'…target's…'`, `'…Shade's…'`, `'…Baro Ki'Teer…'`) - each one prematurely closes its string literal. (2) The reason it shipped anyway: **the root `npx tsc -b` does NOT type-check the `cloudflare-worker/` project** (it's a separate tsconfig). CI builds the codex with `tsx scripts/build-codex.ts` (esbuild), which DID choke - `fieldNotes.ts:9884:64: ERROR: Expected "]" but found "s"` - but that error only ever appeared in CI logs, never in the local check I was running. So the syntax error rode through 4 commits + a merge to main invisibly.
**The Fix:** Convert every interior apostrophe to U+2019 (`'`, RIGHT SINGLE QUOTATION MARK) so it's harmless inside a single-quoted string - done with a node script using `String.fromCharCode(0x2019)` (the Edit tool and PowerShell-backtick both mangle the codepoint; node writing UTF-8 is the reliable path). Detection: scan note lines starting with `'` or `tldr: '` for an **odd count** of ASCII `'` (broken delimiter) AND single-quoted lines with any interior `'`.
**Lesson:** Before merging ANY `cloudflare-worker` change (especially `fieldNotes.ts`), run the checks the root build skips: `cd cloudflare-worker && npx tsc --noEmit -p tsconfig.json` AND `npm run build-codex` (the real CI command - it also prints the `applied N, UNMATCHED keys` line, see next entry). A green root `tsc -b` is NOT proof the worker compiles. Possessive apostrophes in single-quoted note strings must always be U+2019.

---

**Date:** 2026-06-16 (related)
**The Bug:** ~170 of the authored weapon notes silently attached to **nothing** - written, committed, shipped, but invisible in the app. A user accuracy audit (the Kohm) prompted the dig that exposed it.
**The "Gotcha":** The note `keys` are weapon `uniqueName`s, and for the melee/arch/sentinel batches I had **guessed** them from plausible-looking paths instead of pulling the real ones from the codex. DE's internal asset names are unguessable and bear no relation to the display name: Nikana = `…/KatanaAndWakizashi/Katana`, Tipedo = `…/Staff/MonkSpade/TnoMonkStaff`, Orthos = `…/Polearms/PolearmWeapon`, Hirudo = `…/InfWFAccompanyingSparring/InfestedKogake`, Prova = `…/ClanTech/Energy/ElectroProd`, Broken Scepter = `…/GrnQueenSceptreWeapon`. `applyFieldNotes` ignores unmatched keys (they just don't bind), so there was zero error - the build even prints the count: `[build-codex] Cephalon's Notes: applied 714, UNMATCHED keys (fix these): […]`, which I'd never looked at. A worse layer underneath: 15 notes described weapons that **don't exist** (phantom "Feral Claw"/"Brawler Claws"/"Defiled Snapdragon", or confused identities with mid-sentence self-corrections like `'Arca Titron… no - Arca Plasmor is a gun. Ohma -'`) - memory hallucination, not just a wrong key.
**The Fix:** Deleted the 15 hallucinated/phantom notes. Re-keyed the rest with a build-time resolver: normalise each note's weapon name (from its own `tldr`) → look up the real `uniqueName` in the freshly-built `dist/codex/current.json`, with per-note variant disambiguation (Prime/Wraith/Kuva already-used keys excluded). Result: **714 → 864 applied, 0 unmatched.** (Footgun found along the way: my first resolver filtered proposals with `!live.has(u)` - but a valid target is ALWAYS in the live set; that's the whole point. The check was inverted, yielding 0 matches.)
**Lesson:** Always resolve note keys from the actual codex chunk/`current.json` - NEVER guess a `uniqueName` from the display name (this is already CLAUDE.md's join rule; I violated it). And the `applied N, UNMATCHED keys (fix these)` line in the build output is the canary - read it every build; a non-empty unmatched list means dead notes.
