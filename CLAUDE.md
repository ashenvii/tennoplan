# Tennoplan

Offline-first Warframe companion. Today it is a React 19 + Vite web app on Cloudflare with a Cloudflare Worker API. The Tauri 2 desktop shell is a scaffold with no logic yet. Desktop is the goal, the web app is the foundation, and there is no rewrite (`docs/decisions/0001`).

## Where truth lives

1. **Code and the checks below** say what exists. Verify before trusting any note.
2. **`docs/decisions/`** says what was decided and why. Newest approved decision wins; superseded ones stay, marked.
3. **This file** holds rules, invariants, and commands. It loses to code and decisions.
4. **`HANDOFF.md`** is the current task, verified state, blockers, and next steps. It is overwritten each session and loaded at session start.
5. **`docs/`** holds the rest: `architecture.md`, `roadmap.md`, `data-sources.md`, `field-notes.md`, `research.md`, `post-mortems.md`, and one spec per finished page (`docs/decisions/0007`). All project documentation lives in this repo only.
6. Auto-memory holds the author's working preferences only. It is not authority for project state.

If two sources disagree, say so and ask. Do not pick silently.

## Session start and end

- **Start:** read `HANDOFF.md`, run `git status` and `git log -5`, check `docs/decisions/` for the topic. Verify any claim you will build on.
- **End:** overwrite `HANDOFF.md` (done, verified, blockers, next, one commit hash). Add a decision file only if the author approved a new decision. Update this file only if a rule or command changed.
- Do not append session logs anywhere.

## Verify

```bash
npx tsc -b                                   # root app type-check (tsc --noEmit does nothing here)
cd cloudflare-worker && npx tsc --noEmit     # worker type-check, NOT covered by the root command
cd cloudflare-worker && npm run build-codex  # full codex build, no production effect (writes ignored dist/)
npm run build                                # tsc -b && vite build
node --test scripts/*.test.mjs               # icon cache, mods list, description tokens (no runner to install)
```

Run the worker type-check and `build-codex` before merging any change under `cloudflare-worker/`, including `fieldNotes.ts`. There is no test runner. `scripts/*.test.mjs` are small `node:test` checks on pure logic (they transpile the real source with the installed TypeScript). UI behaviour is checked by running the app. Do not report a check as passing unless you ran it.

## Git and deploy

- Commit messages are written in the author's voice, with no attribution trailers.
- "git push dev" means `git push origin Development`. Updating `main` is `git merge Development --no-ff` from `main`. Never force-push or delete branches without asking.
- Pushing to `main` triggers `deploy.yml` (frontend and worker) and, for pipeline paths, `build-codex.yml`. That is production. Ask first.
- Three Cloudflare Workers exist (checked 2026-10-25). The API is `app` (`cloudflare-worker/`, config `wrangler.toml`, serves `/v1/*`, cron `*/5`). The frontend is `tennoplan`, deployed from the repo root by CI using the config the Vite Cloudflare plugin generates (the `deploy.yml` job label still says "web worker"). `web` is an older frontend copy, last deployed 2026-06-13, still serving an old build; CI no longer updates it. There is no root `wrangler.jsonc` (it was deleted on purpose in `77d8916` after it overwrote the API worker). Do not run `wrangler deploy` by hand from the root. Deploy the API only with `cd cloudflare-worker && npm run deploy`.
- Cloudflare Free allows 1,000 KV writes a day for the account. Do not tighten the worldstate cron without checking (`docs/decisions/0002`).

## Architecture

Hexagonal. `src/core/` imports nothing from React, Dexie, zustand, or fetch (checked 2026-10-25).

```
src/core/domain/       pure types and entities
src/core/services/     pure business logic
src/adapters/          fetch, Dexie (db.ts, schema v9), item and asset adapters
src/services/          sync engines (StaticDataService, WorldstateSync, ...)
src/features/<tab>/    one vertical slice per tab
src/store/             Zustand stores
src/components/layout/ AppShell, Sidebar, Header
src/tokens/            TS design tokens
cloudflare-worker/     API, cron, and the codex build scripts
```

Navigation has no router: `useNavigationStore` drives the sidebar and top-bar tabs.

Types mirrored in two files must change together: `cloudflare-worker/src/types.ts` and `src/core/domain/tennoplanApi.ts`.

### Codex access pattern (use everywhere)

The codex is the canonical detail view. Every other surface is a window into it.

1. **Click, quick-look.** Call `useQuickLook.open(uniqueName, name?)`. The `CodexQuickLook` sheet is mounted once in `AppShell`.
2. **Quick-look, full entry.** "Open full entry" calls `useNavigationStore.openCodexEntry(uniqueName, name?)`, which opens `CodexEntryPage` with a back link.

Rules: resolve by `uniqueName`, never by display name (name is a fallback only). Every category, including mods, renders as a page from block sets (`blockSets.ts`), never a modal. One smart-window component, one deep-link channel, tokens-only styling.

### Data invariants

- Live-first contract and the Pulse poll: `docs/decisions/0002`. Never couple bounty rotation to the planet cycle.
- Codex is built in CI and shipped as R2 chunks with delta sync. The monolith `/v1/codex` stays as the permanent fallback: `docs/decisions/0003`.
- Item name, id, and icon come from the codex through `src/adapters/items/codexCatalog.ts`. `fallback-items-map.json` is frozen, never regenerate it, add no new consumers: `docs/decisions/0004`.
- Weapon notes are keyed by real codex `uniqueName`, and the card owns the numbers: `docs/decisions/0006`.
- Leave alone unless a verified problem needs it: the codex pipeline, R2 chunking and delta sync, Pulse, `peplusSchemaGuard.ts`, the `uniqueName` resolution contract.

## Tabs

| Tab | State (checked in code 2026-10-25) |
|---|---|
| Codex | Implemented, the largest feature |
| Celestial Pendulum | Implemented: tab strip, world detail, bounty board |
| Settings | Implemented |
| Dailies & Weeklies, Void Reliquaries, Ascension Registry, Solar Rail Feed, and the rest | Empty "Systems Initializing" stubs. Old systems were scrapped on purpose; rebuild live-first on the shared worldstate layer |

Completion state belongs only to Dailies & Weeklies. Other tabs may show a small flag that links there.

## Design system

Canonical spec is `.impeccable.md`. Read it before building UI. Priority: the author's reference image or description, then images in `Reference-for-Tennoplan/cinematic-variants/<tab>/` (local only, not in git), then `.impeccable.md`. Layout beats colour: match panel arrangement and grid before styling.

- Use CSS variables and the `.typo-*` / `.panel-*` classes in `src/index.css`. No hardcoded hex.
- Noto Serif for headlines, Inter for body. No glassmorphism, no gradient text, no side-stripe card borders. Gold is an accent.
- 4pt spacing scale only (4/8/12/16/24/32/48/64). Motion is ease-out, 150 to 300 ms, no bounce.
- Theme "Mutalist Glow": `--color-bg-primary` #080a08, `--color-bg-secondary` #13180f, `--color-accent-gold` #dbb058, `--color-accent-jade` #58e88a (`accent-teal` is a deprecated alias), `--color-text-primary` #e3e8de, `--color-text-muted` #959e8a, `--color-border-default` #252e23. Stat tints: health #e25c5c, shield #b07cd6, energy #6da8e8.
- Codex block labels use `className="typo-section-label"` directly. Do not redefine `.label` in a module.
- Component styles go in `Component.module.css` with `clsx`. `ModCardV3` is the only mod card to edit.

## Data sources

| Source | Use |
|---|---|
| `api.warframestat.us`, WFCD `warframe-items` | Item universe, worldstate fallback |
| Public Export Plus (npm) | DE's own export, primary for stats, damage, build cost |
| `drops.warframestat.us` | Drop tables, folded into the codex |
| `api.warframe.market/v2` | Prices, not integrated yet |
| Cloudflare KV and R2 | Worldstate, codex manifest and chunks |
| GitHub Actions | Codex build every 6h, deploy on push to `main` |

Data flow is in `docs/architecture.md`. Field-level coverage of each source is in `docs/data-sources.md` (written 2026-05-27, not re-verified).

## Workflows

- **Research:** read `docs/research.md` before researching the Warframe ecosystem, competitors, or data sources, and append dated, sourced findings after. Never start a parallel research file.
- **Post-mortem:** when asked to "archive this bug" or "post-mortem", append to `docs/post-mortems.md` with: date, the bug, the gotcha, the fix.
- **New page:** finish one page completely before the next. When it is done, write its spec as `docs/<page>.md` (see `docs/celestial-pendulum.md`). Do not leave `.md` files inside `src/`.
- **Windows files:** read and write UTF-8 explicitly (`[IO.File]::ReadAllText/WriteAllText` with `UTF8Encoding`). `Get-Content` corrupts non-ASCII text.
