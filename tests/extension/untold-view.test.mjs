/**
 * Contract §103.1 (owner ruling 2026-10-03): the Keeper's copy of the capsule names an untold person by this table's
 * epithet, or by their handle, and keeps the book's name aside for the moment it is said. On the installed App the
 * Keeper named the station owner, the trucker and the veteran in prose on first sight, from `present[].name`.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {firstSightPeople, untoldView, UNTOLD_VIEW_USE} from '../../extensions/kernel/untold-view.ts';

const capsule = () => ({
  turn: {number: 2},
  present: [
    {name: '拉塞尔·威廉姆斯', untold: {id: 'book-4-lars-williams', use: 'kernel line'}, role: '加油站老板', wants: '外地人早点走'},
    {name: '史蒂夫·布朗', called: {name: '棚下的灰发退伍兵'}, untold: {label: '棚下的灰发退伍兵', id: 'book-4-steve-brown', use: 'kernel line'}},
    {name: '内特·帕特森', role: '退休卡车司机'},
    {name: '内特·帕特森2', truncated: true},
  ],
  first_sight: {head: 'h', people: [{id: 'book-4-lars-williams', name: '拉塞尔·威廉姆斯', described: '高瘦'}, {id: 'book-4-nate-patterson', name: '内特·帕特森', described: '啤酒肚'}]},
});

test('an untold person is named by epithet, else by handle; the book\'s name waits in untold.name; told people are untouched', () => {
  const raw = capsule(), before = JSON.stringify(raw);
  const {capsule: view, names} = untoldView(raw);
  assert.equal(JSON.stringify(raw), before, 'the raw capsule is never changed');
  assert.deepEqual(view.present[0], {name: 'book-4-lars-williams', role: '加油站老板', wants: '外地人早点走',
    untold: {name: '拉塞尔·威廉姆斯', use: UNTOLD_VIEW_USE}});
  assert.equal(view.present[1].name, '棚下的灰发退伍兵');
  assert.deepEqual(view.present[1].untold, {name: '史蒂夫·布朗', label: '棚下的灰发退伍兵', use: UNTOLD_VIEW_USE});
  assert.deepEqual(view.present[2], {name: '内特·帕特森', role: '退休卡车司机'}, 'a person already told keeps the name');
  assert.deepEqual(view.present[3], {name: '内特·帕特森2', truncated: true}, 'a stub has no untold block and stays');
  assert.deepEqual(view.first_sight.people.map(person => person.name), ['book-4-lars-williams', '内特·帕特森']);
  assert.deepEqual([...names.byId], [['book-4-lars-williams', 'book-4-lars-williams'], ['book-4-steve-brown', '棚下的灰发退伍兵']]);
  assert.deepEqual(firstSightPeople([{id: 'book-4-steve-brown', name: '史蒂夫·布朗'}], names), [{id: 'book-4-steve-brown', name: '棚下的灰发退伍兵'}]);
  assert.match(UNTOLD_VIEW_USE, /in prose they are who they look like/);
});

test('a capsule with nobody untold is handed over as it is', () => {
  const plain = {present: [{name: 'A', role: 'x'}]};
  assert.equal(untoldView(plain).capsule, plain);
  assert.equal(untoldView({}).names.byId.size, 0);
});

test('the kernel extension hands the Keeper this view and keeps the bus copy as the kernel wrote it', () => {
  const source = readFileSync(new URL('../../extensions/kernel/index.ts', import.meta.url), 'utf8');
  const emit = source.indexOf('pi.events.emit("coc:capsule"'), view = source.indexOf('const keeperView = untoldView(capsule);');
  assert.ok(emit > 0 && view > emit, 'the bus copy goes out before the view is made');
  assert.ok(source.includes('content: JSON.stringify(keeperView.capsule),'));
  assert.ok(source.includes('firstSightPeople(sight!.people as unknown[], state.untoldNames)'), 'a mid-run first sight follows the same names');
});
