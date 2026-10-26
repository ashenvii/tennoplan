// Tests for src/lib/mods/dedupeMods.ts (issue #6).
//
// Run:  node --test scripts/dedupeMods.test.mjs
//
// Transpiles the real module with the installed `typescript` package (the
// project has no test runner). The fixtures mirror records from the live codex
// (enriched-20261026): Serration's three tiers, a Focus ability that shares a
// name with a warframe mod, and the 43 identical "Unfused Artifact" entries.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir  = mkdtempSync(join(tmpdir(), 'dedupemods-'));
writeFileSync(join(dir, 'dedupeMods.mjs'), ts.transpileModule(
  readFileSync(join(root, 'src/lib/mods/dedupeMods.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText);
const { dedupeMods, compareMods } = await import(pathToFileURL(join(dir, 'dedupeMods.mjs')).href);

const stats = (n, last) => Array.from({ length: n }, (_, i) => [i === n - 1 ? last : `+${i}% Damage`]);
const mod = (uniqueName, over = {}) => ({
  uniqueName, name: 'Mod', imageName: 'Mod.jpg', rarity: 'Common', drain: 4,
  polarity: 'madurai', type: 'Rifle Mod', description: '', levelStats: [], compatName: 'RIFLE',
  tradeable: true, isSet: false, isAugment: false, isExilus: false, ...over,
});

const SERRATION = [
  mod('/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod',
    { name: 'Serration', rarity: 'Uncommon', levelStats: stats(11, '+165% Damage') }),
  mod('/Lotus/Upgrades/Mods/Rifle/Beginner/WeaponDamageAmountModBeginner',
    { name: 'Serration', rarity: 'Uncommon', drain: 2, levelStats: stats(4, '+40% Damage') }),
  mod('/Lotus/Upgrades/Mods/Rifle/Intermediate/WeaponDamageAmountModIntermediate',
    { name: 'Serration', rarity: 'Uncommon', levelStats: stats(6, '+90% Damage') }),
];

test('all three Serration tiers are kept, in rank order', () => {
  const out = dedupeMods(SERRATION);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((m) => m.levelStats.length), [4, 6, 11]);
  assert.deepEqual(out.map((m) => m.levelStats.at(-1)[0]),
    ['+40% Damage', '+90% Damage', '+165% Damage']);
});

test('the full-rank Serration is reachable by its uniqueName', () => {
  const out = dedupeMods(SERRATION);
  assert.ok(out.some((m) => m.uniqueName === '/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod'));
});

test('same name from different systems (Focus ability vs warframe mod) are both kept', () => {
  const out = dedupeMods([
    mod('/Lotus/Powersuits/Excalibur/SlashDashAugmentCard',
      { name: 'Surging Dash', rarity: 'Rare', polarity: 'zenurik', compatName: 'EXCALIBUR', levelStats: stats(4, 'Augment') }),
    mod('/Lotus/Upgrades/Focus/Tactic/Active/DashWaveFocusUpgrade',
      { name: 'Surging Dash', rarity: 'Uncommon', polarity: 'naramon', compatName: 'MOD', levelStats: stats(6, 'Wave') }),
  ]);
  assert.equal(out.length, 2);
});

test('records identical in every content field collapse to one, keeping the first uniqueName', () => {
  const twins = Array.from({ length: 43 }, (_, i) =>
    mod(`/Lotus/Types/Railjack/Engineering/Artifact${String(i).padStart(2, '0')}`,
      { name: 'Unfused Artifact', rarity: 'Common', compatName: 'PLEXUS', levelStats: [] }));
  const out = dedupeMods([...twins].reverse());
  assert.equal(out.length, 1);
  assert.equal(out[0].uniqueName, '/Lotus/Types/Railjack/Engineering/Artifact00', 'stable choice, independent of input order');
});

test('a difference in any content field keeps both records', () => {
  const base = mod('/a', { name: 'X', levelStats: stats(4, 'a') });
  for (const over of [
    { rarity: 'Rare' }, { polarity: 'naramon' }, { drain: 9 }, { type: 'Other' }, { compatName: 'MELEE' },
    { description: 'different' }, { imageName: 'Other.jpg' }, { levelStats: stats(5, 'a') },
    { tradeable: false }, { isAugment: true }, { isExilus: true }, { isSet: true }, { wikiUrl: 'https://wiki.example/x' },
  ]) {
    assert.equal(dedupeMods([base, { ...base, uniqueName: '/b', ...over }]).length, 2, JSON.stringify(over));
  }
});

test('names compare case-insensitively when collapsing identical records', () => {
  assert.equal(dedupeMods([mod('/a', { name: 'Vitality' }), mod('/b', { name: 'vitality' })]).length, 1);
});

test('mods with no repeated name pass through unchanged and sorted by name', () => {
  const out = dedupeMods([mod('/c', { name: 'Zeta' }), mod('/a', { name: 'Alpha' }), mod('/b', { name: 'Mid' })]);
  assert.deepEqual(out.map((m) => m.name), ['Alpha', 'Mid', 'Zeta']);
});

test('empty input and input order are not mutated', () => {
  assert.deepEqual(dedupeMods([]), []);
  const input = [mod('/b', { name: 'B' }), mod('/a', { name: 'A' })];
  const copy = [...input];
  dedupeMods(input);
  assert.deepEqual(input, copy);
});

test('compareMods orders by name, then rank count, then uniqueName', () => {
  const a = mod('/a', { name: 'S', levelStats: stats(4, 'x') });
  const b = mod('/b', { name: 'S', levelStats: stats(6, 'x') });
  const c = mod('/c', { name: 'S', levelStats: stats(6, 'x') });
  assert.ok(compareMods(a, b) < 0);
  assert.ok(compareMods(b, c) < 0);
});
