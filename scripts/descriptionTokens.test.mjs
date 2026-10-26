// Tests for issue #7: unresolved |TOKEN| placeholders in descriptions.
//
// Run:  node --test scripts/descriptionTokens.test.mjs
//
// Covers two pure modules, transpiled with the installed `typescript` package
// (the project has no test runner):
//   - cloudflare-worker/scripts/lib/challengeCounts.ts  (build time: known values)
//   - src/lib/text/descriptionTokens.ts                 (app: readable fallback)
// The strings are taken from the live codex (enriched-20261026).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir  = mkdtempSync(join(tmpdir(), 'desctokens-'));

async function load(relPath, name) {
  const out = ts.transpileModule(readFileSync(join(root, relPath), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  writeFileSync(join(dir, name), out);
  return import(pathToFileURL(join(dir, name)).href);
}

const { fillChallengeCount } = await load('cloudflare-worker/scripts/lib/challengeCounts.ts', 'challengeCounts.mjs');
const { fillDescriptionTokens, tokenLabel, TOKEN_PATTERN } = await load('src/lib/text/descriptionTokens.ts', 'descriptionTokens.mjs');

// ── Known values: Nightwave challenge counts from PE+ ─────────────────────────

test('known token: |COUNT| is filled from requiredCount', () => {
  assert.equal(fillChallengeCount('Kill |COUNT| Enemies while Aim Gliding', 15), 'Kill 15 Enemies while Aim Gliding');
});

test('known token: every |COUNT| in the text is filled and other markup is untouched', () => {
  assert.equal(
    fillChallengeCount('Kill |COUNT| Enemies with <DT_FIRE>Heat Damage. (|COUNT| total)', 150),
    'Kill 150 Enemies with <DT_FIRE>Heat Damage. (150 total)',
  );
});

test('known token: a missing, zero, negative, fractional or non-numeric count is not guessed', () => {
  for (const bad of [undefined, null, 0, -3, 2.5, NaN, '15', {}]) {
    assert.equal(fillChallengeCount('Kill |COUNT| Enemies.', bad), null, String(bad));
  }
});

// ── Unresolved tokens: readable fallback, nothing invented ────────────────────

test('unresolved: Excalibur passive reads as a sentence, with no raw pipes and no number', () => {
  const out = fillDescriptionTokens('Excalibur deals |DAMAGE|% increased damage and attacks |SPEED|% faster when wielding swords.');
  assert.equal(out, 'Excalibur deals (damage)% increased damage and attacks (speed)% faster when wielding swords.');
  assert.ok(!out.includes('|'));
  assert.ok(!/\d/.test(out), 'no statistic is invented');
});

test('unresolved: underscores become spaces, case is lowered', () => {
  assert.equal(tokenLabel('AFFINITY_SHARE'), '(affinity share)');
  assert.equal(fillDescriptionTokens('Gain |PUNCH_THROUGH| Punch Through.'), 'Gain (punch through) Punch Through.');
});

test('unresolved: lowercase token names from the data are handled (|val|)', () => {
  assert.equal(fillDescriptionTokens('frozen for |val|s.'), 'frozen for (val)s.');
});

test('unresolved: a token that is repeated is rewritten each time', () => {
  assert.equal(fillDescriptionTokens('If killed with |STACKS| stacks, those |STACKS| stacks are consumed'),
    'If killed with (stacks) stacks, those (stacks) stacks are consumed');
});

test('unresolved: Nightwave challenges PE+ lacks keep a readable |COUNT|', () => {
  assert.equal(fillDescriptionTokens('Kill |COUNT| enemies with a Primary Bow.'), 'Kill (count) enemies with a Primary Bow.');
});

// ── Text without tokens, and markup that is not a token ───────────────────────

test('no tokens: text is returned unchanged', () => {
  const plain = "Excalibur epitomizes the warrior spirit. His master swordsmanship deals high damage.";
  assert.equal(fillDescriptionTokens(plain), plain);
  assert.equal(fillDescriptionTokens(''), '');
});

test('angle-bracket markup and newlines are not touched by the token step', () => {
  const s = 'Inflicts <DT_SLASH_COLOR>Slash Status.\\nNext line';
  assert.equal(fillDescriptionTokens(s), s);
});

test('text that merely contains pipes is not mistaken for a token', () => {
  for (const s of ['A | B | C', 'x || y', 'a|b', '|5| of them', 'range 3 | 4']) {
    assert.equal(fillDescriptionTokens(s), s, s);
  }
});

test('TOKEN_PATTERN is global, so callers iterate with their own RegExp copy', () => {
  const re = new RegExp(TOKEN_PATTERN);
  const names = [...'a |ONE| b |TWO_X|'.matchAll(re)].map((m) => m[1]);
  assert.deepEqual(names, ['ONE', 'TWO_X']);
});
