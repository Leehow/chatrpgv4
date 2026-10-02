/**
 * Contract §168.2: the host's opening message carries the opening's contract, not its craft.
 *
 * Installed App 153469067, Blood Road, new campaign game-717a9e4b (2026-10-02): the message told the Keeper "one
 * sentence of room at most ... the whole opening shorter than the prologue. Introduce at most two new proper names",
 * while narration-craft 2.1.11 asks for the place with everything the book describes of it and the people as people
 * seen. The opening showed one man under the awning and none of the station; the owner read it as empty.
 */
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {openingInstruction} from '../../extensions/kernel/opening-instruction.ts';

const prologue = {scene: '序幕', guide: '', opening: '西德克萨斯，1975年7月……埃索加油站棚下几个男人从你们进镇起就死死盯着你们。\n\n你是谁？', handoff: 'Entrance is 序幕.'};
// Any wording that rations the room, the sentences or the names the opening may use.
const CAP = /\b(at most|no more than|shorter than|one sentence|two sentences|one gesture)\b/i;

test('neither form of the opening rations description, sentences or names', () => {
  for (const text of [openingInstruction({prologue, playLanguage: 'zh-Hans'}), openingInstruction({playLanguage: 'zh-Hans'})]) {
    assert.equal(CAP.test(text), false, text);
    assert.ok(text.includes("the active prose package's opening and first-sight rules"), 'how to open is the prose package\'s');
    assert.ok(text.includes('play_language=zh-Hans'));
    assert.ok(text.includes('Close with narrate'));
  }
});

test('after a setup meeting the visitor is not asked for again and the card is not contradicted', () => {
  const text = openingInstruction({prologue: {...prologue, guide: 'Steven Knott'}, playLanguage: 'zh-Hans'});
  assert.ok(text.includes('the guide (Steven Knott) already knows who the visitor is, so do not ask it again'));
  assert.ok(text.includes('do not repeat its sentences'));
  // Turn 0 told the player 「这趟路上没有人交给你一项必须完成的差事」 while the card bound her to deliver to El Paso.
  assert.ok(text.includes("never state that either of them lacks something"));
  assert.ok(text.endsWith('the only opening writes are ask and narrate.'));
  assert.ok(text.includes(JSON.stringify({...prologue, guide: 'Steven Knott'})));
});

test('a prologue with no guide asked in the host\'s voice: nobody in the scene knows the investigator\'s name until told', () => {
  // Blood Road (guide ""): the station owner greeted three investigators by name -- 「伍兹先生，是吧？」 -- before anyone told him it.
  const text = openingInstruction({prologue, playLanguage: 'zh-Hans'});
  assert.equal(text.includes('already knows who the visitor is'), false);
  assert.ok(text.includes("the people here do not know the investigator's name or business until the investigator tells them"));
  assert.ok(text.includes('let the people present react to the stranger they see'));
  assert.equal(text.includes('who this person is to them'), false);
});

test('the Mod context rides along only when given', () => {
  const text = openingInstruction({playLanguage: 'en', modContext: {first_contact: ['pack']}});
  assert.ok(text.includes('Active Mod context: {"first_contact":["pack"]}'));
  assert.equal(text.includes('Do not call apply or resolve'), false);
});

test('the kernel extension opens the table through this one function', () => {
  const source = readFileSync(new URL('../../extensions/kernel/index.ts', import.meta.url), 'utf8');
  assert.ok(source.includes('openingInstruction({'));
  assert.equal(source.includes('Opening the table:'), false, 'a second inline copy of the opening message');
});
