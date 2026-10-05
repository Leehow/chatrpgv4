/** Real stdin/stdout RPC reproduction with controlled accepted artifacts and no model calls. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {cp, mkdir, readFile, readdir, symlink, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {build} from 'esbuild';
import {sourceWeapon, enterSourceEncounter, setFixtureSkill} from '../tests/extension/source-weapon-fixture.mjs';

const root=resolve(import.meta.dirname,'..'), [sourceArg,evidenceArg,expectation='candidate']=process.argv.slice(2);
if(!sourceArg||!evidenceArg||!['baseline','candidate'].includes(expectation))
  throw new Error('Usage: node scripts/check-source-weapon-identity.mjs SOURCE_ROOT NEW_EVIDENCE_DIR baseline|candidate');
const source=resolve(sourceArg), evidence=resolve(evidenceArg);
// mkdir without recursive intentionally refuses overwriting a previous receipt directory.
await mkdir(evidence);
await symlink(join(root,'node_modules'),join(evidence,'node_modules'),'dir');
const bundle=join(evidence,'rpc.mjs'), home=join(evidence,'home');
await mkdir(home);
await build({entryPoints:[join(source,'kernel-ts/rpc.ts')],outfile:bundle,bundle:true,packages:'external',
  format:'esm',platform:'node',target:'node24',logLevel:'silent'});
const fixture=join(evidence,'controlled-items');
await cp(join(root,'mods/enhanced-items'),fixture,{recursive:true});
const manifest=JSON.parse(await readFile(join(fixture,'mod.json'),'utf8'));
manifest.id='source-weapon-fixture'; manifest.version='1.0.0';
manifest.requires=[...new Set([...manifest.requires,'audit.continuity.v1'])];
manifest.contributes={materializer:'creator.md',auditor:'auditor.md'};
await writeFile(join(fixture,'mod.json'),JSON.stringify(manifest));
const child=spawn(process.execPath,[bundle,'--workspace',home,'--content',join(root,'content')],
  {env:{...process.env,PI_OFFLINE:'1',COC_KERNEL_SEED:'source-weapon-cli',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'},stdio:['pipe','pipe','pipe']});
const journal=[], pending=new Map(); let diagnostic='', sequence=0;
child.stderr.setEncoding('utf8'); child.stderr.on('data',text=>{diagnostic+=text;});
const lines=createInterface({input:child.stdout});
lines.on('line',line=>{
  const response=JSON.parse(line); journal.push({direction:'response',...response});
  const waiter=pending.get(response.id); if(!waiter) return;
  pending.delete(response.id); clearTimeout(waiter.timer);
  response.ok?waiter.resolve(response.result):waiter.reject(Object.assign(new Error(response.error.message),response.error));
});
child.on('exit',code=>{
  for(const waiter of pending.values()) {clearTimeout(waiter.timer);waiter.reject(new Error(`Transport closed with exit ${code}; no unreceived action is claimed executed`));}
  pending.clear();
});
const call=(method,params={})=>new Promise((resolve,reject)=>{
  const id=`rpc-${++sequence}`, request={id,method,params:{campaign:'c1',...params}};
  const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`RPC timeout: ${method}; execution unconfirmed`));},20000);
  pending.set(id,{resolve,reject,timer}); journal.push({direction:'request',...request});
  child.stdin.write(JSON.stringify(request)+'\n');
});
let summary;
try {
  await call('kernel.hello');
  await call('campaign.create',{id:'c1',module:'the-haunting',pregen:'thomas-hayes',play_language:'en'});
  await call('mods.install',{path:fixture});
  await call('mods.configure',{id:manifest.id,version:manifest.version,enabled:true});
  const directory=join(home,'.coc/campaigns/c1'), party=join(directory,'party');
  const sheetPath=join(party,(await readdir(party)).find(name=>name.endsWith('.json')));
  const sheet=JSON.parse(await readFile(sheetPath,'utf8'));
  let ordinal=0;
  const game={call,directory,sheetPath,sheet,next:()=>`t1-c${++ordinal}`,
    apply:effects=>call('table.apply',{call_id:`t1-c${++ordinal}`,effects})};
  await setFixtureSkill(game);
  await call('table.open');
  await call('table.narrate',{call_id:'t0-c1',text:'This is a deterministic engineering fixture.'});
  await call('table.player_input',{text:'I use the retained source dagger in the source encounter.'});
  const dagger=await sourceWeapon(game); await enterSourceEncounter(game);
  const result=await call('table.resolve',{call_id:game.next(),action:{intent:'combat',object:dagger.name,usage:'stab',target:'Walter Corbitt',defense:'none',goal:'Controlled source-rule acceptance'}});
  const combat=JSON.parse(await readFile(join(directory,'save/combat.json'),'utf8'));
  const operation=JSON.parse(await readFile(join(directory,'save/combat-operation.json'),'utf8'));
  const world=JSON.parse(await readFile(join(directory,'world.json'),'utf8'));
  const turn=JSON.parse(await readFile(join(directory,'turn.json'),'utf8'));
  const receipts=turn.receipts.filter(row=>result.receipts.includes(row.id));
  const target=combat.participants.find(row=>row.actor_id==='walter-corbitt');
  assert.ok(result.outcome.rolls.length>0,'attack must actually roll');
  assert.equal(combat.weapon_catalog[dagger.usage.id].weapon_id,dagger.usage.id);
  const special=combat.status==='concluded'&&combat.outcome==='investigators_win'&&target.hp_current===0&&target.conditions.includes('dead');
  assert.equal(special,expectation==='candidate');
  if(expectation==='candidate') {
    assert.equal(operation.operation.rulebook_exception,'own_dagger_ignores_spells');
    assert.equal(world.npc_resources['walter-corbitt'].current_hp,0);
    assert.ok(receipts.some(row=>row.kind==='session'&&row.transition==='end'));
  } else {
    assert.equal(operation.operation.rulebook_exception,undefined);
    assert.ok(target.hp_current>0);
  }
  summary={scope:'real deterministic CLI RPC; controlled accepted Mod artifacts; no natural author model',
    source,expectation,no_model_calls:true,runtime_sha256:createHash('sha256').update(await readFile(bundle)).digest('hex'),
    source_identity:dagger.item.source_object??null,usage_weapon_id:dagger.usage.id,affordance:operation.affordance_id,
    exception:operation.operation.rulebook_exception??null,status:combat.status,outcome:combat.outcome,
    target_hp:target.hp_current,target_conditions:target.conditions,special_effect_executed:special,receipts};
  await writeFile(join(evidence,'summary.json'),JSON.stringify(summary,null,2)+'\n');
  process.stdout.write(JSON.stringify({...summary,receipts:summary.receipts.map(row=>({kind:row.kind,resource:row.resource,transition:row.transition,before:row.before,after:row.after}))})+'\n');
} finally {
  child.stdin.end();
  await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));
  await writeFile(join(evidence,'rpc-journal.ndjson'),journal.map(row=>JSON.stringify(row)).join('\n')+'\n');
  await writeFile(join(evidence,'rpc-stderr.log'),diagnostic);
}
