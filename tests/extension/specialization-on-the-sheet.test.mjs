/**
 * A module's named specialization must reach the card, and a blank group row must never answer
 * for it (contract §52).
 *
 * The real table: a 1895 ferryman, a module rule node reading "困难难度驾船 pilot (boat)；每条小艇上
 * 只有一名调查员可以投，用以保证小艇不翻", and a card with no `Pilot (Boat)` row at all -- only
 * the printed `Pilot ( ___ )` group row at its base chance of 1. The Keeper settled `Pilot` at
 * hard, twice, and the arithmetic did the rest: six crates of cargo in the water, the boat over,
 * the investigator pinned under the keel, the opening motive gone. Swim 70, Navigate 70 and
 * CON 65 were never touched.
 *
 * Two ends had to be wrong at once for that to happen, and this file guards both:
 *
 *   - the catalog could not name `Pilot (Boat)`. `specialization_groups.Pilot` declared its
 *     members and nothing derived a skill identity from them, so no chargen, no module and no
 *     Keeper could ever put that row on a card. The catalog registers `Fighting (Brawl)` and
 *     `Firearms (Handgun)` by hand, which is why those groups work and Pilot, Science and Survival
 *     do not. Here the group declaration itself is the identity.
 *
 *   - the group row answered anyway. `Pilot` is not an ability; it is a blank the investigator
 *     never filled in, and its 1% is the cost of the blank. A check that resolves to it now
 *     refuses with what the card actually carries, unless the card answers unambiguously.
 *
 * What is deliberately *not* refused: a specialization the card lacks still rolls its own
 * rulebook base (an untrained skill is rollable in CoC 7e), and a group row the investigator
 * spent points on -- one specialization taken and never named -- still answers.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ROOT = resolve(import.meta.dirname, '../..');
const temporary = await mkdtemp(join(tmpdir(), 'pi-coc specialization '));
after(async () => { await rm(temporary, { recursive: true, force: true }); });
await build({
  stdin: {
    contents: [
      "export {createKernelContext} from './kernel-ts/context.ts';",
      "export {RuleTables} from './kernel-ts/rules/tables.ts';",
      "export {PythonRandom} from './kernel-ts/random.ts';",
      "export {CheckArithmetic} from './kernel-ts/resolve/arithmetic.ts';",
      "export {SkillResolver, specializationIdentity} from './kernel-ts/rules/skills.ts';",
      "export {Chargen} from './kernel-ts/setup/chargen.ts';",
      "export {executeCheck} from './kernel-ts/resolve/basic.ts';",
    ].join('\n'),
    resolveDir: ROOT,
    loader: 'ts',
    sourcefile: 'specialization.ts',
  },
  outfile: join(temporary, 'api.mjs'),
  bundle: true, packages: 'external', format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent',
});
const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);
const kernel = await api.createKernelContext({ workspace: join(temporary, 'workspace'), content: join(ROOT, 'content') });
after(() => kernel.git.close());
const tables = new api.RuleTables(kernel);
const arithmetic = await api.CheckArithmetic.create(tables);
const skillsDoc = await tables.load('skills');
const groups = skillsDoc.specialization_groups;
const catalog = await tables.skillsTable();

/** Thomas Reed as the real table built him: the printed group rows and nothing in them. */
const FERRYMAN = {
  id: 'inv-thomas-reed',
  name: 'Thomas Reed',
  characteristics: { STR: 60, CON: 65, SIZ: 60, DEX: 60, APP: 55, INT: 65, POW: 55, EDU: 70, LUCK: 50 },
  skills: { Swim: 70, Navigate: 70, 'Spot Hidden': 50, Pilot: 1, Science: 1, Medicine: 1, Survival: 10 },
};
/** The same card once the specialization reaches it. */
const BOATMAN = { ...FERRYMAN, skills: { ...FERRYMAN.skills, 'Pilot (Boat)': 60 } };
/** A Military Officer: Survival is occupational, so points landed on the group row itself. */
const OFFICER = { ...FERRYMAN, id: 'inv-officer', skills: { ...FERRYMAN.skills, Survival: 60 } };

function table(sheet) {
  const rolls = [];
  return {
    rolls,
    context: {
      tables, arithmetic,
      rng: new api.PythonRandom('specialization'),
      actorId: sheet.id,
      sheetById: id => (id === sheet.id ? sheet : null),
      npcNode: () => null,
      addRoll(input) { rolls.push(input); return `roll:${rolls.length}`; },
    },
  };
}
const settle = (context, args) => api.executeCheck(context, args, { decision_ref: null });
async function refusal(run) {
  try { await run(); }
  catch (error) { return error; }
  return assert.fail('the kernel settled a check it should have refused');
}

test('the rules table declares the members, and the identity is derived from that declaration', () => {
  assert.deepEqual(groups.Pilot.specializations, ['Aircraft', 'Boat'], 'the group names its own members');
  assert.ok(!Object.hasOwn(catalog, 'Pilot (Boat)'), 'the catalog prints no row of its own for it');
  const boat = api.specializationIdentity(groups, catalog, 'Pilot (Boat)');
  assert.deepEqual(boat, { canonical: 'Pilot (Boat)', group: 'Pilot', member: 'Boat', base: 1 });
  assert.equal(api.specializationIdentity(groups, catalog, 'pilot boat').canonical, 'Pilot (Boat)');
  assert.equal(api.specializationIdentity(groups, catalog, 'Pilot (Aircraft)').canonical, 'Pilot (Aircraft)');
});

test('an enumerating group admits only the members it declares; an open one admits what was named', () => {
  assert.equal(api.specializationIdentity(groups, catalog, 'Pilot (Submarine)'), null, 'Pilot enumerates two vehicles');
  assert.equal(groups.Survival.open, true);
  assert.equal(groups.Survival.specializations, null, 'terrain is not a list this repository gets to write');
  assert.equal(api.specializationIdentity(groups, catalog, 'Survival (Tidal Marsh)').canonical, 'Survival (Tidal Marsh)');
  assert.equal(api.specializationIdentity(groups, catalog, 'Cooking (Soup)'), null, 'a phrase naming no declared group is not a skill');
});

test('a specialization the catalog already carries keeps its one identity, under either spelling', () => {
  assert.equal(api.specializationIdentity(groups, catalog, 'Science (Biology)').canonical, 'Science (Biology)');
  // `Medicine` is registered flat with `group: "Science"`. A second `Science (Medicine)` identity
  // would leave a card's Medicine value sitting behind a name nothing resolves to.
  assert.equal(api.specializationIdentity(groups, catalog, 'Science (Medicine)').canonical, 'Medicine');
  assert.equal(api.specializationIdentity(groups, catalog, 'Fighting (Brawl)').canonical, 'Fighting (Brawl)');
});

test('the resolver names and prices a specialization the catalog does not print', async () => {
  const resolver = await api.SkillResolver.create(tables, FERRYMAN);
  assert.equal(resolver.resolveExplicit('Pilot (Boat)'), 'Pilot (Boat)');
  assert.equal(resolver.targetValue('Pilot (Boat)'), 1, "an untaken specialization is worth its group's base");
  assert.ok(!resolver.canonicalNames().includes('Pilot (Boat)'), 'derivation adds no catalog rows');
  const sheet = await api.SkillResolver.create(tables, BOATMAN);
  assert.equal(sheet.targetValue('Pilot (Boat)'), 60, 'a card that carries the row is the value');
  assert.deepEqual(sheet.findInText('he takes the tiller of the boat'), ['Pilot (Boat)'],
    'a row on the card lets the keeper reach it by the specialization in prose');
});

test('the blank group row is refused, and the refusal names what the card does carry', async () => {
  const { context, rolls } = table(FERRYMAN);
  const error = await refusal(() => settle(context, {
    skill: 'Pilot', difficulty: 'hard', difficulty_basis: 'explicit',
    goal: 'keep the skiff from broaching',
    stakes: { on_failure: 'the skiff goes over and the cargo is lost' },
  }));
  assert.equal(error.name, 'RpcError');
  assert.equal(error.code, 'needs');
  assert.equal(error.details.needs.field, 'skill');
  assert.equal(error.details.group.name, 'Pilot');
  assert.deepEqual(error.details.group.specializations, ['Aircraft', 'Boat']);
  assert.equal(error.details.group.base_chance, 1);
  assert.equal(error.details.group.sheet_row, 1, 'the card row that would have answered is on the record');
  assert.deepEqual(error.details.group.carried_on_sheet, []);
  assert.ok(error.details.needs.options.includes('Swim'), 'the card has values the keeper can use');
  assert.ok(error.details.needs.options.includes('Navigate'));
  assert.deepEqual(rolls, [], 'a refused request must not mint a roll receipt');
  assert.match(String(error.message), /is a group skill, not a check/i);
  const fix = String(error.fix);
  assert.match(fix, /Name the specialization/i);
  assert.match(fix, /do not narrate it/i);
  assert.match(fix, /do not read it to the player/i);
});

test('the same refusal when the group row is reached through prose rather than by name', async () => {
  const resolver = await api.SkillResolver.create(tables, FERRYMAN);
  assert.deepEqual(resolver.findInText('he will pilot the skiff across'), ['Pilot'],
    'prose naming the group still lands on the group row');
  const { context } = table(FERRYMAN);
  const error = await refusal(() => settle(context, { skill: 'Pilot', difficulty: 'regular' }));
  assert.equal(error.code, 'needs');
  assert.equal(error.details.group.name, 'Pilot');
});

test('the specialization the module named rolls its own base, never the group row wearing its name', async () => {
  const { context, rolls } = table(FERRYMAN);
  const result = await settle(context, { skill: 'Pilot (Boat)', difficulty: 'regular' });
  assert.equal(result.data.skill, 'Pilot (Boat)', 'the receipt says which specialization rolled');
  assert.equal(result.data.base_target, 1);
  assert.equal(result.data.target_source, 'rulebook_base', 'not the sheet: the card carries no such row');
  assert.equal(rolls.length, 1);
});

test('a card that carries the specialization answers the group by it', async () => {
  const { context } = table(BOATMAN);
  const result = await settle(context, { skill: 'Pilot', difficulty: 'hard' });
  assert.equal(result.data.skill, 'Pilot (Boat)', 'one specialization on the card is not ambiguous');
  assert.equal(result.data.base_target, 60);
  assert.equal(result.data.effective_target, 30);
  assert.equal(result.data.target_source, 'sheet');
});

test('a group row the investigator spent points on still answers, by name and by specialization', async () => {
  const byGroup = await settle(table(OFFICER).context, { skill: 'Survival', difficulty: 'regular' });
  assert.equal(byGroup.data.skill, 'Survival');
  assert.equal(byGroup.data.base_target, 60, 'a row above its base chance is a specialization taken and not named');
  const byMember = await settle(table(OFFICER).context, { skill: 'Survival (Arctic)', difficulty: 'regular' });
  assert.equal(byMember.data.skill, 'Survival', 'the receipt names the row that rolled, not the request');
  assert.equal(byMember.data.base_target, 60);
  assert.equal(byMember.data.target_source, 'sheet', 'the substitution is visible on the mechanics card, not silent');
});

test('two specializations of one group on a card is an ambiguity the keeper resolves, not the kernel', async () => {
  const sheet = { ...FERRYMAN, skills: { ...BOATMAN.skills, 'Pilot (Aircraft)': 45 } };
  const error = await refusal(() => settle(table(sheet).context, { skill: 'Pilot', difficulty: 'regular' }));
  assert.equal(error.code, 'needs');
  assert.deepEqual(error.details.needs.options.slice().sort(), ['Pilot (Aircraft)', 'Pilot (Boat)']);
  assert.deepEqual(error.details.group.carried_on_sheet.slice().sort(), ['Pilot (Aircraft)', 'Pilot (Boat)']);
});

test('a skill that is not a group skill is untouched', async () => {
  const { context, rolls } = table(FERRYMAN);
  const swim = await settle(context, { skill: 'Swim', difficulty: 'hard' });
  assert.equal(swim.data.base_target, 70);
  assert.equal(swim.data.effective_target, 35);
  const untrained = await settle(context, { skill: 'Locksmith', difficulty: 'regular' });
  assert.equal(untrained.data.base_target, 1, 'an untrained standalone skill still rolls its rulebook base');
  assert.equal(untrained.data.target_source, 'rulebook_base');
  // Medicine is a specialization of Science that the catalog prints flat; it is a row, not a blank.
  const medicine = await settle(context, { skill: 'Medicine', difficulty: 'regular' });
  assert.equal(medicine.data.skill, 'Medicine');
  assert.equal(rolls.length, 3);
});

test("an occupation's named specialization reaches the card instead of the pending pile", async () => {
  const chargen = await api.Chargen.create(tables, { formulas: { personal_interest_points: 'INT*2' },
    allocation: { default: 'fill', tiers: [] }, interest_allocation: { default: 'fill', tiers: [] }, interest_pool: { exclude: [] } });
  assert.equal(chargen.catalogName('Pilot (aircraft)'), 'Pilot (Aircraft)');
  assert.equal(chargen.catalogName('Science (Physics)'), 'Science (Physics)');
  assert.equal(chargen.catalogName('any two other skills'), null, 'a rulebook choice is still not a skill name');
  const [sheet, receipt] = await chargen.build({ investigatorId: 'inv-flyer', name: 'A Flyer', occupationId: 'Pilot',
    concept: null, age: 30, sex: null, method: 'quick_fire', seed: 'specialization-reaches-the-sheet', era: '1920s' });
  assert.ok(Object.hasOwn(sheet.skills, 'Pilot (Aircraft)'), 'the card carries the specialization the occupation names');
  assert.ok(sheet.skills['Pilot (Aircraft)'] > 1, 'and occupation points reached it');
  assert.ok(sheet.creation.skills.occupation.resolved.includes('Pilot (Aircraft)'));
  assert.ok(!receipt.choices_pending.includes('Pilot (aircraft)'), 'it is no longer a choice nobody made');
  assert.ok(receipt.choices_pending.includes('any two other skills'), 'the choices that really are choices remain');
});
