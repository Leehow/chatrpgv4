/** A refused investigator action never proposes replacing the player's declared action. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {kernel,opening,resolve,resolveErr,receipts} from './rules-rpc-support.ts';
import {clientFor,hayesTurn,corbittsTurn,editFight,CORBITT,INVESTIGATOR} from './rules-fight-fixtures.ts';
async function decisions(k:any){const names=[...new Set<string>((await k.ok('table.resolve.options',{campaign:'c1'})).decisions.filter((r:any)=>r.family==='combat').map((r:any)=>r.name))].sort();assert.ok(names.length>=4&&names.includes('combat:attack')&&names.includes('combat:maneuver'));return names;}
const escapeRegex=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const named=(fix:string,names:string[])=>names.filter(name=>fix.includes(name)||new RegExp(`\\b${escapeRegex(name.split(':')[1])}\\b`,'i').test(fix)).sort();
const demand={intent:'combat',decision:'combat:maneuver',goal:'挥拳威逼，逼他把钱交出来',method:'一拳逼他把钱交出来',target:'Walter Corbitt',weapon:'unarmed'};
test('current combat action offers carry the closed parameters a real maneuver and end require',async t=>{
 const k=await clientFor(t),n=await hayesTurn(k),session=(await k.table('look',{focus:'session'})).session;
 const maneuver=session.actions.find((action:any)=>action.decision==='combat:maneuver');
 assert.deepEqual(maneuver.goals,['disarm','escape','ongoing_disadvantage','push']);
 assert.ok(maneuver.weapons.includes('unarmed'));
 assert.deepEqual(session.actions.find((action:any)=>action.decision==='combat:end').outcomes,['fled','investigators_win','monsters_win','stalemate']);
 const proposed=await resolve(k,`t1-c${n}`,{intent:'combat',decision:maneuver.decision,actor:maneuver.actor,
  goal:maneuver.goals.find((goal:string)=>goal==='push'),weapon:maneuver.weapons.find((weapon:string)=>weapon==='unarmed'),
  target:maneuver.targets[0],method:'Move the opponent away from the doorway without a damaging blow'});
 assert.equal(proposed.decision,'combat:maneuver');
 assert.equal(proposed.outcome.status,'resolved');
 assert.ok(proposed.outcome.rolls.length>=2);
 assert.equal(proposed.session.pending_defense,null);
 assert.equal(proposed.session.turn_of,CORBITT);
 assert.ok(proposed.session.participants.find((person:any)=>person.name===CORBITT).conditions.includes('prone'));
 const ending=proposed.session.actions.find((action:any)=>action.decision==='combat:end');
 const ended=await resolve(k,`t1-c${n+1}`,{intent:'combat',decision:ending.decision,actor:ending.actor,
  outcome:ending.outcomes.find((outcome:string)=>outcome==='stalemate'),goal:'Both sides stop fighting',method:'End the exchange'});
 assert.equal(ended.outcome.combat_outcome,'stalemate');
 assert.equal((await k.table('look',{focus:'session'})).session,null);
});
const cases:Record<string,(k:any)=>Promise<[string,any]>>={
 maneuver_whose_goal_is_the_demand:async k=>['combat:maneuver',await resolveErr(k,`t1-c${await hayesTurn(k)}`,demand)],
 defence_with_nothing_to_answer:async k=>['combat:defend',await resolveErr(k,`t1-c${await hayesTurn(k)}`,{intent:'combat',decision:'combat:defend',defense:'dodge',goal:'躲开',method:'侧身'})],
 blow_out_of_turn:async k=>['combat:attack',await resolveErr(k,`t1-c${await corbittsTurn(k)}`,{intent:'combat',goal:'hit him',method:'fists',target:'Walter Corbitt',weapon:'unarmed'})],
 blow_while_a_defence_is_owed:async k=>{const n=await hayesTurn(k);await resolve(k,`t1-c${n}`,{intent:'combat',goal:'hit him',method:'fists',target:'Walter Corbitt',weapon:'unarmed'});return ['combat:attack',await resolveErr(k,`t1-c${n+1}`,{intent:'combat',goal:'hit him again',method:'fists',target:'Walter Corbitt',weapon:'unarmed'})];},
 flight_while_held:async k=>{const n=await hayesTurn(k);editFight(k,{investigator:{conditions:['grappled']}});return ['combat:flee',await resolveErr(k,`t1-c${n}`,{intent:'flee',decision:'combat:flee',goal:'get away',method:'run for the stairs'})];},
 flight_with_no_fight:async k=>{await opening(k,'钱呢？你说的二十块，现在就给我。');return ['combat:flee',await resolveErr(k,'t1-c1',{intent:'flee',decision:'combat:flee',goal:'get away',method:'run'})];},
};
for(const [name,run] of Object.entries(cases))test(`test_an_investigators_refused_fight_action_names_no_other_fight_decision [${name}]`,async t=>{const k=await clientFor(t),[refused,error]=await run(k);assert.ok(['needs','turn_state'].includes(error.code));assert.ok(error.fix);const names=await decisions(k);assert.ok(names.includes(refused));assert.deepEqual(named(error.fix,names.filter(name=>name!==refused)),[]);});
test('test_the_maneuver_refusal_still_names_the_four_and_changes_nothing',async t=>{const k=await clientFor(t),n=await hayesTurn(k),count=(await receipts(k)).length,error=await resolveErr(k,`t1-c${n}`,demand);assert.equal(error.code,'needs');assert.equal(error.details.needs.field,'goal');assert.deepEqual(error.details.needs.options.slice().sort(),['disarm','escape','ongoing_disadvantage','push']);const s=(await k.table('look',{focus:'session'})).session;assert.equal(s.turn_of,INVESTIGATOR);assert.equal(s.pending_defense,null);assert.equal((await receipts(k)).length,count);});
test('test_an_npcs_held_flight_still_names_his_way_free',async t=>{const k=await clientFor(t),n=await corbittsTurn(k);editFight(k,{corbitt:{conditions:['grappled']}});const e=await resolveErr(k,`t1-c${n}`,{actor:'Walter Corbitt',intent:'flee',goal:'get away',method:'run for the stairs'});assert.equal(e.details.actor,CORBITT);assert.deepEqual(named(e.fix,await decisions(k)),['combat:maneuver']);});
// 1026j An Amaranthine Desire T12: the NPC's grab sent without action.actor was read as the investigator attacking himself;
// the refusal offered the NPC as the target and the Keeper swapped the two until the three-strikes stop.
test('an NPC\'s fight action sent without its actor is told whose turn it is',async t=>{
 const k=await clientFor(t),n=await corbittsTurn(k);
 const error=await resolveErr(k,`t1-c${n}`,{intent:'combat',goal:'grab the ledger back',method:'wrench his wrist',target:INVESTIGATOR,weapon:'unarmed',defense:'fight_back'});
 assert.equal(error.code,'turn_state',JSON.stringify(error));
 assert.equal(error.details.turn_of,CORBITT);
 assert.match(error.fix,/action\.actor/);
});
