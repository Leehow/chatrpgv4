/**
 * The damage receipt must carry what was applied (contract section 16.2, decision of 2026-09-12).
 *
 * The persona benchmark measured this four times in four different tables
 * (docs/player-persona-benchmark-20260911.md section 4.8): an extreme or critical success settles
 * at maximum damage -- which is the rule -- but the receipt reported the dice as rolled, so the
 * card said "damage 1" while eight hit points came off, twice fatally. Nothing the player could
 * see explained the difference.
 *
 * This compiles `combat/evidence.ts` and `combat/snapshot.ts` directly and drives the projection
 * with a damage record of the shape `extremeDamage` leaves behind, rather than hunting for a dice
 * seed that produces an extreme success.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ROOT = resolve(import.meta.dirname, '../..');
const parent = join(ROOT, '.coc/playtests/runtime-consolidation/checks');
await mkdir(parent, { recursive: true });
const evidence = await mkdtemp(join(parent, 'damage-receipt-'));
await build({
  stdin: {
    contents: `export {damageEvidenceRows, externalDamageReceipt} from ${JSON.stringify(join(ROOT, 'kernel-ts/combat/evidence.ts'))};`,
    resolveDir: ROOT, loader: 'ts', sourcefile: 'damage-receipt.ts',
  },
  outfile: join(evidence, 'api.mjs'), bundle: true, platform: 'node', format: 'esm',
  target: 'node22', packages: 'external', logLevel: 'silent',
});
const api = await import(pathToFileURL(join(evidence, 'api.mjs')).href);
after(() => {});

/** One round holding one turn, which is all `damageEvidenceRows` needs to find its command. */
const rounds = [{ round: 1, turns: [{ turn_id: 't1', resolution_command_id: 'cmd-1' }] }];

/** The shape `CombatEngine.extremeDamage` leaves: the dice rolled 1, the engine applied 8. */
const extremeDamage = {
  damage_roll_id: 'roll-1', source_turn_id: 't1', source_actor_id: 'thomas-hayes',
  target_actor_id: 'walter-corbitt', weapon_id: 'club', die: '1D8', die_rolls: [1],
  rolled_total: 1, raw_damage: 8, damage_multiplier: 1, hp_before: 16, hp_delta: -8, hp_after: 8,
  armor_absorbed: 0, armor_before: 0, armor_after: 0, extreme_damage: true,
  extreme_breakdown: 'extreme: max_weapon(8)+max_db(0)', impale_or_max: true, is_impale: false,
  weapon_effect_ids: [], status_after: {}, provenance: {},
};

test('an extreme success reports the damage it applied, not the dice it rolled', () => {
  const [row] = api.damageEvidenceRows('combat-1', rounds, [extremeDamage]);
  assert.equal(row.payload.dice.total, 8, 'the card prints the applied damage');
  assert.deepEqual(row.payload.dice.raw, [1], 'the dice stay auditable');
  assert.equal(row.payload.rolled_total, 1, 'the roll is still reported as rolled');
  assert.equal(row.payload.combat_damage_receipt.total, 8);
  assert.equal(row.payload.combat_damage_receipt.rolled_total, 1);
  // The whole point: the player can now derive the hit points they lost from the card.
  assert.equal(row.payload.dice.total, extremeDamage.hp_before - extremeDamage.hp_after);
});

test('an ordinary hit is unchanged: applied equals rolled', () => {
  const ordinary = { ...extremeDamage, raw_damage: 5, rolled_total: 5, die: '1D6', die_rolls: [5],
    hp_before: 16, hp_delta: -5, hp_after: 11, extreme_damage: false, impale_or_max: false,
    extreme_breakdown: undefined };
  const [row] = api.damageEvidenceRows('combat-1', rounds, [ordinary]);
  assert.equal(row.payload.dice.total, 5);
  assert.equal(row.payload.rolled_total, 5);
});

test('a record with no applied total falls back to the roll rather than reporting nothing', () => {
  const legacy = { ...extremeDamage };
  delete legacy.raw_damage;
  const [row] = api.damageEvidenceRows('combat-1', rounds, [legacy]);
  assert.equal(row.payload.dice.total, 1);
});
