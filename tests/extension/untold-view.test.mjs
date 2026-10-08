/**
 * Contract §103.5 (owner ruling 2026-10-03): the Keeper's copy of the capsule names an untold person by this table's
 * epithet, or by their handle. On the installed App the Keeper named the station owner, the trucker and the veteran in
 * prose on first sight, from `present[].name`. §194.1 (owner ruling 2026-10-08, two ledgers): the row carries the book's
 * name beside it as `book_name`, and the request renames only handles (`renameHandles`).
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {firstSightPeople, renameHandles, renameUntold, sayName, untoldNote, untoldPeople, untoldView, UNTOLD_VIEW_USE} from '../../extensions/kernel/untold-view.ts';

const capsule = () => ({
  turn: {number: 2},
  present: [
    {name: '拉塞尔·威廉姆斯', untold: {id: 'book-4-lars-williams', use: 'kernel line'}, role: '加油站老板', wants: '外地人早点走'},
    {name: '史蒂夫·布朗', called: {name: '棚下的灰发退伍兵'}, untold: {label: '棚下的灰发退伍兵', id: 'book-4-steve-brown', use: 'kernel line'}},
    {name: '内特·帕特森', role: '退休卡车司机'},
    {name: '内特·帕特森2', truncated: true},
    {name: '拉斯', truncated: true, untold: {label: '带油布的加油站老板', id: 'book-4-lars-williams-2', say_name: '{{name:带油布的加油站老板}}'}},
  ],
  first_sight: {head: 'h', people: [{id: 'book-4-lars-williams', name: '拉塞尔·威廉姆斯', described: '高瘦'}, {id: 'book-4-nate-patterson', name: '内特·帕特森', described: '啤酒肚'}]},
});

test('an untold person is named by epithet, else by handle, with the book\'s name beside as book_name (§194.1); told people are untouched', () => {
  const raw = capsule(), before = JSON.stringify(raw);
  const {capsule: view, names} = untoldView(raw);
  assert.equal(JSON.stringify(raw), before, 'the raw capsule is never changed');
  assert.deepEqual(view.present[0], {name: 'book-4-lars-williams', book_name: '拉塞尔·威廉姆斯', role: '加油站老板', wants: '外地人早点走',
    untold: {say_name: '{{name:book-4-lars-williams}}', use: UNTOLD_VIEW_USE}});
  assert.equal(view.present[1].name, '棚下的灰发退伍兵');
  // §176.5: the name token is ready to copy, built from the word the row shows.
  assert.deepEqual(view.present[1].untold, {label: '棚下的灰发退伍兵', say_name: '{{name:棚下的灰发退伍兵}}', use: UNTOLD_VIEW_USE});
  assert.equal(sayName('the clerk'), '{{name:the clerk}}');
  assert.equal(view.present[1].book_name, '史蒂夫·布朗', '§194.1: the Keeper holds the book\'s name, beside the word prose uses');
  for (const row of view.present.slice(0, 2)) {
    const {book_name: _book, ...rest} = row;
    assert.ok(!JSON.stringify(rest).includes('拉塞尔') && !JSON.stringify(rest).includes('史蒂夫'), 'the book\'s name only in book_name: name and the token are the word');
  }
  assert.deepEqual(view.present[2], {name: '内特·帕特森', role: '退休卡车司机'}, 'a person already told keeps the name');
  assert.deepEqual(view.present[3], {name: '内特·帕特森2', truncated: true}, 'a stub of someone told has no untold block and stays');
  // §176.8: a stub the budget cut keeps its untold block, and the view shows it like any untold row, the kernel's token kept.
  assert.deepEqual(view.present[4], {name: '带油布的加油站老板', book_name: '拉斯', truncated: true,
    untold: {label: '带油布的加油站老板', say_name: '{{name:带油布的加油站老板}}', use: UNTOLD_VIEW_USE}});
  assert.deepEqual(view.first_sight.people.map(person => person.name), ['book-4-lars-williams', '内特·帕特森']);
  assert.deepEqual(view.first_sight.people.map(person => person.book_name), ['拉塞尔·威廉姆斯', undefined], 'the first sight carries the book\'s name beside the word too');
  assert.deepEqual([...names.byId], [['book-4-lars-williams', 'book-4-lars-williams'], ['book-4-steve-brown', '棚下的灰发退伍兵'],
    ['book-4-lars-williams-2', '带油布的加油站老板']]);
  assert.deepEqual(firstSightPeople([{id: 'book-4-steve-brown', name: '史蒂夫·布朗'}], names), [{id: 'book-4-steve-brown', name: '棚下的灰发退伍兵', book_name: '史蒂夫·布朗'}]);
  assert.match(UNTOLD_VIEW_USE, /in prose they are who they look like/);
  // §194.1: the line says the Keeper knows the name and the investigator has not heard it; never that the Keeper lacks it.
  assert.match(UNTOLD_VIEW_USE, /has not heard this person's name\. You know it \(`book_name`\)/);
  assert.doesNotMatch(UNTOLD_VIEW_USE, /do not have/);
  assert.match(UNTOLD_VIEW_USE, /put `say_name` there exactly/, 'the line says how the name is said: copy the token');
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

test("§103.5 renameUntold: every host message and tool result names an untold person as the Keeper's copy does; the player and the Keeper keep theirs", () => {
  const people = untoldPeople({ people: [{ name: "拉塞尔·威廉姆斯", id: "book-4-lars-williams", shown: "book-4-lars-williams" },
    { name: "Arty", id: "arty", shown: "the bartender" }, { name: "", shown: "x" }, { name: "same", shown: "same" }] });
  assert.deepEqual(people.map((person) => person.name), ["拉塞尔·威廉姆斯", "Arty"], "rows without two different names are dropped");
  const messages = [
    { role: "user", content: "拉塞尔·威廉姆斯在吗？" },
    { role: "assistant", content: [{ type: "text", text: "拉塞尔·威廉姆斯" }] },
    { role: "custom", customType: "coc-clerk", content: JSON.stringify({ present: [{ name: "拉塞尔·威廉姆斯" }],
      note: "Initialize the authored presence of 拉塞尔·威廉姆斯 at 埃索加油站; the Party of Arty" }) },
    { role: "custom", customType: "coc-capsule", content: JSON.stringify({ present: [{ name: "book-4-lars-williams", untold: { name: "拉塞尔·威廉姆斯", use: "u" } }] }) },
    { role: "toolResult", toolName: "look", content: [{ type: "text", text: "{\"name\":\"拉塞尔·威廉姆斯\"}" }, { type: "image", data: "x" }] },
  ];
  const before = structuredClone(messages), out = renameUntold(messages, people);
  assert.deepEqual(messages, before, "the input messages are not changed");
  assert.equal(out[0], messages[0], "the player's words stay");
  assert.equal(out[1], messages[1], "the Keeper's own prose stays");
  assert.deepEqual(JSON.parse(out[2].content), { present: [{ name: "book-4-lars-williams" }],
    note: "Initialize the authored presence of book-4-lars-williams at 埃索加油站; the Party of the bartender" }, "Arty inside Party is a different word");
  assert.equal(JSON.parse(out[3].content).present[0].untold.name, "book-4-lars-williams", "§103.8: no seat keeps the book's name");
  assert.equal(out[4].content[0].text, "{\"name\":\"book-4-lars-williams\"}");
  assert.equal(out[4].content[1], messages[4].content[1]);
  // §176.8: a tool result that had a name renamed says a name was there and gives the token that says it; host messages,
  // JSON whose people already carry the token, are renamed only.
  assert.deepEqual(out[4].content[2], { type: "text", text: untoldNote(["book-4-lars-williams"]) });
  assert.match(out[4].content[2].text, /the book's name for them stands wherever the result has it/);
  assert.doesNotMatch(out[4].content[2].text, /do not have/, '§194.1: the Keeper is never told it lacks the name');
  assert.match(out[4].content[2].text, /\{\{name:book-4-lars-williams\}\}/);
  assert.equal(out[2].content.includes("[untold names]") || out[3].content.includes("[untold names]"), false);
  const plain = { role: "toolResult", content: "Arty waits by the door." };
  assert.equal(renameUntold([plain], people)[0].content, `the bartender waits by the door.\n\n${untoldNote(["the bartender"])}`);
  const nobody = { role: "toolResult", content: [{ type: "text", text: "The door is locked." }] };
  assert.equal(renameUntold([nobody], people)[0], nobody, "a result naming nobody untold is handed over as it is");
  assert.deepEqual(renameUntold(messages, []), messages);
  const longest = renameUntold([{ role: "custom", content: "Steve Brown and Steve" }], untoldPeople({ people: [{ name: "Steve", shown: "s1" }, { name: "Steve Brown", shown: "s2" }] }));
  assert.equal(longest[0].content, "s2 and s1", "the longer name is renamed first");
});

test('§194.1 renameHandles: the request keeps every book name as written and still shows a handle as the table\'s word', () => {
  const roster = {people: untoldPeople({people: [
    {name: '拉塞尔·威廉姆斯', id: 'book-4-lars-williams', shown: '带油布的加油站老板'},
    {name: '拉斯', id: 'book-4-lars-williams', shown: '带油布的加油站老板'},
    {name: 'book-4-lars-williams', id: 'book-4-lars-williams', shown: '带油布的加油站老板', handle: true},
    {name: 'npc-lars', id: 'book-4-lars-williams', shown: '带油布的加油站老板', handle: true}]}), protected: []};
  const book = {role: 'toolResult', toolName: 'lookup', content: [{type: 'text', text: '拉塞尔·威廉姆斯（拉斯）在柜台后。'}]};
  assert.equal(renameHandles([book], roster)[0], book, 'a result naming the untold by the book\'s names reaches the Keeper as it is, no note');
  const clerk = {role: 'custom', customType: 'coc-clerk', content: 'Initialize the authored presence of 拉塞尔·威廉姆斯 (npc-lars)'};
  assert.equal(renameHandles([clerk], roster)[0].content, 'Initialize the authored presence of 拉塞尔·威廉姆斯 (带油布的加油站老板)',
    'a host message keeps the name; its node id is shown as the word');
  const handle = {role: 'toolResult', toolName: 'look', content: [{type: 'text', text: '{"id":"book-4-lars-williams","name":"拉塞尔·威廉姆斯"}'}]};
  const [out] = renameHandles([handle], roster);
  assert.equal(out.content[0].text, '{"id":"带油布的加油站老板","name":"拉塞尔·威廉姆斯"}');
  assert.deepEqual(out.content[1], {type: 'text', text: untoldNote(['带油布的加油站老板'])}, 'the note rides only where a handle was renamed');
  assert.deepEqual(renameHandles([handle], roster.people), [out], 'bare rows are read the same way');
});
