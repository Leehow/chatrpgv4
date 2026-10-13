/** Native standalone judge evidence tools: citation refuses leave only refusal rows. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {copyFileSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {ROOT} from './support.ts';
import {temporaryPath} from './npc-support.ts';
test('native judge CLI preserves questions, turns, truth, cited records and refusal evidence',t=>{
 const dir=String(temporaryPath(t)),script=join(dir,'judge-tools.ts');copyFileSync(join(ROOT,'tests/play/judge-tools.ts'),script);
 const packet={questions:[{id:'secret_leak',question:'Was a secret disclosed?',good_answer:'Keep undiscovered truth concealed.'}],turns:[{turn:0,player_message:null,keeper_text:'The office is quiet.',receipts:[]},{turn:1,player_message:'I knock.',keeper_text:'The door opens. A brass key rests on the desk.',receipts:[{kind:'clue'}]}],module_truth:[{kind:'clue',visibility:'public',name:'Key',summary:'A brass key.'},{kind:'secret',visibility:'keeper',name:'Ward',summary:'A private ward.'}]};
 writeFileSync(join(dir,'judge-packet.json'),JSON.stringify(packet));
 const run=(...args:string[])=>{const r=spawnSync(process.execPath,[script,...args],{encoding:'utf8'});assert.equal(r.error,undefined);return r;};
 assert.ok(run('questions').stdout.includes('[secret_leak]\nWas a secret disclosed?\nKeep undiscovered truth concealed.'));
 assert.ok(run('turns').stdout.includes("turn 0: player='(opening: no player input)' keeper='The office is quiet.' receipts=0"));
 assert.deepEqual(JSON.parse(run('turn','1').stdout),packet.turns[1]);assert.equal(run('turn','99').status,1);
 assert.equal(run('truth','--kind','clue').stdout,'clue\tpublic\tKey\tA brass key.\n');
 const input=['record','--metric','secret_leak','--turn','1','--verdict','ok','--quote','The door opens.'];
 for(const [index,value,reason] of [[2,'vibes',"'vibes' is not one of this run's questions: ['secret_leak']"],[4,'99','turn 99 is not in this run'],[6,'unknown',"verdict must be one of ('ok', 'violation')"],[8,'  ','a finding without a quote is not a finding'],[8,'Invented words.','that sentence does not occur in turn 1']] as const){const args=[...input];args[index]=value;const r=run(...args);assert.equal(r.status,2);assert.equal(r.stderr,'refused: '+reason+'\n');}
 assert.equal(existsSync(join(dir,'judgement.jsonl')),false);
 const refused=readFileSync(join(dir,'judge-refusals.jsonl'),'utf8').trim().split('\n').map(x=>JSON.parse(x));assert.equal(refused.length,5);assert.ok(refused.every(r=>Object.hasOwn(r,'quote')&&Object.hasOwn(r,'reason')));
 const r=run(...input,'--why','The fiction answered the declared action.');assert.equal(r.status,0);assert.equal(r.stdout,'recorded ok for secret_leak at turn 1\n');assert.deepEqual(JSON.parse(readFileSync(join(dir,'judgement.jsonl'),'utf8')),{metric:'secret_leak',turn:1,verdict:'ok',quote:'The door opens.',why:'The fiction answered the declared action.'});
 const normalized=[...input];normalized[8]='Ｔｈｅ　ｄｏｏｒ　ｏｐｅｎｓ．';assert.equal(run(...normalized).status,0);assert.equal(readFileSync(join(dir,'judgement.jsonl'),'utf8').trim().split('\n').length,2);
});
