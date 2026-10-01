import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {api, table} from './object-usages-fixture.mjs';

const weapon = {name: 'Service-revolver', profile: '.38 Revolver', damage_die: '1D10', skill: 'Firearms (Handgun)'};
const owner = {id: 'jack', name: 'Jack', equipment: [weapon.name], weapons: [weapon]};
const entry = {name: 't0-owed-4', turn: 0, kind: 'object', effect: null, quote: null, what: weapon.name,
  object: {name: weapon.name, category: 'weapon'}, job: 'retained-review'};

test('an already owned executable printed weapon satisfies an unresolved missing-weapon report, with exact ownership', () => {
  assert.equal(api.owedSatisfied({}, {}, entry, [owner]), true);
  for (const party of [[], [{...owner, weapons: []}], [{...owner, equipment: []}], [owner, {...owner, id: 'other', name: 'Other'}],
    [{...owner, weapons: [{...weapon, damage_die: undefined}]}], [{...owner, equipment: [{name: weapon.name, object_id: 'managed'}]}]])
    assert.equal(api.owedSatisfied({}, {}, entry, party), false);
  assert.equal(api.owedSatisfied({}, {}, {...entry, quote: 'You acquired another revolver.'}, [owner]), false);
  assert.equal(api.owedSatisfied({}, {}, {...entry, object: {...entry.object, category: 'item'}}, [owner]), false);
  assert.equal(api.owedSatisfied({}, {}, {...entry, object: {...entry.object, owner: 'Other'}}, [owner]), false);
});

test('a fresh missing report does not mint false debt for the same already executable weapon', async () => {
  const result = await api.projectOwed({}, {}, {}, {turn: 0}, {missing: [{name: weapon.name, category: 'weapon'}]},
    'review', new Set(), [owner]);
  assert.deepEqual(result.rows, []);
});

test('an unresolved effect-less row cannot be guessed into an object transfer or poison another effect silently', async t => {
  const game = await table(t);
  await writeFile(join(game.directory, 'owed.json'), JSON.stringify({open: [entry], closed: []}));
  const before = await game.call('table.look', {focus: 'time'});
  await assert.rejects(game.call('table.apply', {call_id: game.next(), effects: [
    {kind: 'time', minutes: 25, why: 'Ordinary travel.'},
    {kind: 'object', name: weapon.name, to: game.sheet.name, owed: entry.name},
  ]}), error => error.details?.reason === 'owed_unresolved');
  assert.deepEqual(await game.call('table.look', {focus: 'time'}), before, 'the failed batch remains atomic');
});

test('legacy false weapon debt leaves the capsule and closes durably on ordinary settlement, without a duplicate instance', async t => {
  const game = await table(t);
  const sheet = JSON.parse(await readFile(game.sheetPath, 'utf8'));
  sheet.equipment.push(weapon.name); sheet.weapons.push(weapon);
  await writeFile(game.sheetPath, JSON.stringify(sheet));
  await writeFile(join(game.directory, 'owed.json'), JSON.stringify({open: [entry], closed: []}));
  assert.equal((await game.call('table.capsule')).owed.some(row => row.name === entry.name), false);
  await game.call('table.apply', {call_id: game.next(), effects: [{kind: 'time', band: 'speak_briefly', why: 'One ordinary exchange.'}]});
  const ledger = JSON.parse(await readFile(join(game.directory, 'owed.json'), 'utf8'));
  assert.equal(ledger.open.some(row => row.name === entry.name), false);
  assert.equal(ledger.closed.find(row => row.name === entry.name).how, 'satisfied');
  const current = JSON.parse(await readFile(game.sheetPath, 'utf8'));
  assert.equal(current.equipment.filter(row => row === weapon.name || row.name === weapon.name).length, 1);
});
