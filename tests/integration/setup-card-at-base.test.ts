/** 1026i: the card reports the listed skills the points walk never reached. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kernel} from './support.ts';
import {CAMPAIGN,profile,pyMethod} from './setup-native-support.ts';
import {draft} from './setup-card.test.ts';

async function test_a_named_skill_the_points_never_reached_is_reported_at_base(kernel:any){
// 1026i: a player's "speaks English" sat sixth in a list whose budget ran out at the third, and the
// card came back with English 1 and nothing said. The walk stays priority ordered; the card says
// which listed skills got no points so the model can reorder before the player reads it.
let semantic:any=(await profile());
Object.assign(semantic,{name:"周衡",occupation:"Antiquarian",age:41,sex:"男",own_language:"中文",
  occupation_skills:["Appraise","Art and Craft (Fine Art)","History","Library Use","Spot Hidden","Language (Other: English)","Law","Psychology"],interest_skills:["Archaeology"]});
let card:any=(await draft(kernel,semantic,{numbers:{characteristics:{EDU:40}}}));
assert.equal(card.sheet.skills["Language (Other: English)"],1);
assert.ok(card.at_base.includes("Language (Other: English)"),String(card.at_base));
assert.ok(!card.at_base.includes("Appraise"),String(card.at_base));
let moved:any=(await pyMethod(kernel,"ok",["setup.revise",({campaign:CAMPAIGN,profile:{occupation_skills:["Language (Other: English)","Appraise","Art and Craft (Fine Art)","History","Library Use","Spot Hidden","Law","Psychology"]}})],{}));
assert.ok(moved.sheet.skills["Language (Other: English)"]>1,String(moved.sheet.skills["Language (Other: English)"]));
assert.ok(!moved.at_base.includes("Language (Other: English)"),String(moved.at_base));
}
test("test_a_named_skill_the_points_never_reached_is_reported_at_base",async(t)=>{await test_a_named_skill_the_points_never_reached_is_reported_at_base(await kernel(t,{}));});
