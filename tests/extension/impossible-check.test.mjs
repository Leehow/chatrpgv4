/**
 * A check whose effective target the difficulty drives below 1 is not a hard check (contract §45).
 *
 * CoC 7e gives an unlisted skill its rulebook base chance, and Pilot's is 1. Halve that for hard and
 * the effective target is 0: 1d100 has no face at or below 0, so the roll cannot succeed, the
 * failure is authored rather than rolled, and every stake the keeper hung on it lands by
 * arithmetic. Two real tables settled exactly that -- `Pilot` at hard, `effective_target: 0`,
 * `push_eligible: true` -- and the product printed "需困难 · ≤0" on the player's own mechanics card
 * before drowning the investigator.
 *
 * What this guards: the refusal happens before the die, so no receipt, no failure and no
 * push eligibility exist for an unrollable request; the legal neighbour (the same base 1 at regular,
 * where 1% is still a chance) still rolls; and the refusal reaches the keeper as a repairable
 * request rather than as something to say out loud.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ROOT = resolve(import.meta.dirname, '../..');
const temporary = await mkdtemp(join(tmpdir(), 'pi-coc impossible check '));
after(async () => { await rm(temporary, { recursive: true, force: true }); });
await build({
  stdin: {
    contents: [
      "export {createKernelContext} from './kernel-ts/context.ts';",
      "export {RuleTables} from './kernel-ts/rules/tables.ts';",
      "export {PythonRandom} from './kernel-ts/random.ts';",
      "export {CheckArithmetic} from './kernel-ts/resolve/arithmetic.ts';",
      "export {executeCheck, executePush} from './kernel-ts/resolve/basic.ts';",
    ].join('\n'),
    resolveDir: ROOT,
    loader: 'ts',
    sourcefile: 'impossible-check.ts',
  },
  outfile: join(temporary, 'api.mjs'),
  bundle: true, packages: 'external', format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent',
});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);
const kernel = await api.createKernelContext({ workspace: join(temporary, 'workspace'), content: join(ROOT, 'content') });
after(() => kernel.git.close());
const tables = new api.RuleTables(kernel);
const arithmetic = await api.CheckArithmetic.create(tables);

/** Thomas Reed as the real table had him: no Pilot row, so `Pilot (Boat)` -- the specialization the
 *  module actually named -- falls to the rulebook base of 1. The real table sent the bare group
 *  skill `Pilot`; §52 now refuses that before this guard is reached, as a request to repair, so
 *  the check here is written the way §52 makes the Keeper write it. Same skill, same base, same
 *  arithmetic: 1 halved for hard is 0, and 1d100 has no face at or below 0. */
const SHEET = {
  id: 'inv-thomas-reed',
  name: 'Thomas Reed',
  characteristics: { STR: 60, CON: 65, SIZ: 60, DEX: 60, APP: 55, INT: 65, POW: 55, EDU: 70, LUCK: 50 },
  skills: { Swim: 70, Navigate: 70, 'Spot Hidden': 50 },
};

function table() {
  const rolls = [];
  return {
    rolls,
    context: {
      tables,
      arithmetic,
      rng: new api.PythonRandom('impossible-check'),
      actorId: SHEET.id,
      sheetById: id => (id === SHEET.id ? SHEET : null),
      npcNode: () => null,
      addRoll(input) { rolls.push(input); return `roll:${rolls.length}`; },
    },
  };
}

const settle = (context, args) => api.executeCheck(context, args, { decision_ref: null });

async function refusal(run) {
  try { await run(); }
  catch (error) { return error; }
  return assert.fail('the kernel settled a check that 1d100 cannot pass');
}

test('the rule tables, not this file, say 1 is the lowest target a die can answer', () => {
  assert.equal(arithmetic.minimumTarget, 1);
  assert.equal(arithmetic.effectiveTarget(1, 'regular'), 1);
  assert.equal(arithmetic.effectiveTarget(1, 'hard'), 0);
  assert.equal(arithmetic.effectiveTarget(70, 'hard'), 35);
  assert.equal(arithmetic.assertRollable(1, 'regular', 'Pilot (Boat)'), 1);
});

test('base 1 at hard is refused before the die, with nothing rolled and nothing landed', async () => {
  const { context, rolls } = table();
  const error = await refusal(() => settle(context, {
    skill: 'Pilot (Boat)', difficulty: 'hard', difficulty_basis: 'explicit',
    goal: 'hold the boat steady against the surf',
    stakes: { on_failure: 'the boat capsizes and she is pulled under' },
  }));
  assert.equal(error.name, 'RpcError');
  assert.equal(error.code, 'invalid_params');
  assert.equal(error.details.reason, 'effective_target_below_minimum');
  assert.equal(error.details.skill, 'Pilot (Boat)');
  assert.equal(error.details.base_target, 1);
  assert.equal(error.details.difficulty, 'hard');
  assert.equal(error.details.effective_target, 0);
  assert.equal(error.details.minimum_target, 1);
  assert.deepEqual(rolls, [], 'a refused request must not mint a roll receipt');
});

test('the refusal tells the keeper what to send instead, and that it is not something to say', async () => {
  const { context } = table();
  const error = await refusal(() => settle(context, { skill: 'Pilot (Boat)', difficulty: 'hard' }));
  const fix = String(error.fix);
  assert.match(fix, /keeper/i, 'the fix must name who it is addressed to');
  assert.match(fix, /not fiction/i);
  assert.match(fix, /do not narrate it/i);
  assert.match(fix, /do not read it to the player/i);
  assert.match(fix, /Nothing was rolled and nothing happened/i);
  assert.match(fix, /skill or characteristic this investigator's sheet gives a usable value in/i);
  assert.match(fix, /lower the difficulty until the effective target is at least 1/i);
  assert.match(fix, /ask them for nothing/i);
});

test('base 1 at regular is a legal 1% chance and still rolls', async () => {
  const { context, rolls } = table();
  const result = await settle(context, { skill: 'Pilot (Boat)', difficulty: 'regular' });
  assert.equal(result.data.skill, 'Pilot (Boat)');
  assert.equal(result.data.base_target, 1);
  assert.equal(result.data.effective_target, 1);
  assert.equal(result.data.required_target, 1);
  assert.equal(result.data.threshold, 1);
  assert.ok(result.data.roll >= 1 && result.data.roll <= 100);
  assert.equal(rolls.length, 1, 'a rollable check still settles into a receipt');
});

test('an ordinary skill at hard is untouched', async () => {
  const { context, rolls } = table();
  const result = await settle(context, { skill: 'Swim', difficulty: 'hard' });
  assert.equal(result.data.base_target, 70);
  assert.equal(result.data.effective_target, 35);
  assert.equal(rolls.length, 1);
});

test('no unrollable check is ever offered as pushable, and a push cannot rescue one', async () => {
  const { context, rolls } = table();
  const error = await refusal(() => api.executePush(context, {
    canonical_roll_receipt: { skill: 'Pilot (Boat)', target: 1, difficulty: 'hard', outcome: 'failure', pushed: false, bonus: 0, penalty: 0 },
    original_check_decision_id: 'roll:pilot-t2-c4',
  }, { decision_ref: null }));
  assert.equal(error.code, 'invalid_params');
  assert.equal(error.details.effective_target, 0);
  assert.equal(error.details.pushed, true);
  assert.match(String(error.fix), /pushed roll repeats the same target/i);
  assert.deepEqual(rolls, [], 'a push of an unrollable check must not roll either');
});
