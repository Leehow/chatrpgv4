/** Same-machine comparison of migrated native counterparts and direct TS, with untouched source audit. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { hostname, platform, cpus, loadavg } from 'node:os';
import { resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { build } from 'esbuild';
const root=resolve(import.meta.dirname,'..'),out=resolve(process.argv[2]??'');
if(!process.argv[2])throw new Error('Usage: node scripts/benchmark-test-tiers.mjs <new-report-directory>');
mkdirSync(out,{recursive:false});
const manifest=JSON.parse(readFileSync(join(root,'tests/direct-ts-migration.json'),'utf8'));
const full=JSON.parse(readFileSync(join(root,'tests/ts-migration-manifest.json'),'utf8'));
assert.equal(full.complete,true,'Complete native validation is required before benchmarking the retired controller');
const originals=manifest.groups.flatMap(group=>group.cases.map(entry=>{
  const original=full.files.find(file=>file.source===group.source)?.cases.find(row=>row.name===entry.name);
  assert.equal(original?.status,'validated',`${group.source}::${entry.name} is not validated`);
  assert.ok(original.counterpart?.file&&original.counterpart?.name,entry.name);
  assert.equal(createHash('sha256').update(readFileSync(join(root,original.counterpart.file))).digest('hex'),original.counterpart.sha256,entry.name);
  return {source:group.source,name:entry.name,parameters:entry.parameters,originalKind:group.originalKind,...original.counterpart};
}));
const nativeFiles=[...new Set(originals.map(entry=>entry.file))];
const escape=name=>name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const nativePattern=`^(?:${originals.map(entry=>escape(entry.name)).join('|')})(?:\\s*\\[.*\\])?$`;
const direct=[...new Set(manifest.groups.map(g=>g.direct))];
const env={...process.env,UV_OFFLINE:'1',UV_PYTHON_DOWNLOADS:'never',COC_TEST_NODE:process.execPath,
  COC_RESOURCE_PILOT_API:'',COC_TEST_STORAGE_MODE:'disk',
  COC_TEST_KERNEL_CMD:JSON.stringify([process.execPath,join(root,'build/kernel/rpc.mjs')])};
const hashes=()=>Object.fromEntries([...new Set([...manifest.groups.map(g=>g.source),...direct,...nativeFiles,
  'tests/direct-ts-migration.json','tests/ts-migration-manifest.json','tests/extension/resource-settlement-support.mjs','tests/extension/fast-support.mjs',
  'kernel-ts/testing/fast.ts','kernel-ts/testing/resource-settlement.ts','build/kernel/rpc.mjs'])].map(p=>[p,createHash('sha256').update(readFileSync(join(root,p))).digest('hex')]));
function idle(){
  const p=spawnSync('ps',[platform()==='darwin'?'-U':'-u',String(process.getuid()),'-o','pid=,args='],{encoding:'utf8'});
  assert.equal(p.status,0,p.stderr);
  const others=p.stdout.split('\n').filter(l=>/\bnode\s+(?:--test\b|scripts\/test-(?:integration|storage))/.test(l));
  assert.deepEqual(others,[],'Another test suite is active; preserve and exclude this run');
}
const report={host:hostname(),platform:platform(),cpu:cpus()[0]?.model,node:process.version,
  head:spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim(),
  started:new Date().toISOString(),hashes:hashes(),concurrency:1,defaultFastConcurrency:2,expectedBusinessCases:manifest.businessCaseCount,runs:[],mutations:[],
  scope:'All original business cases through validated native counterparts versus direct TS. RPC counterparts retain real RPC setup; previously internal/oracle cases retain their approved native boundary. Full integration is a separate gate.',
  baselineImplementation:'native TypeScript counterparts; historical original label retained for report compatibility',
  baselineChangedFromHistoricalPython:true,nativeSources:originals};
const save=()=>writeFileSync(join(out,'comparison.json'),JSON.stringify(report,null,2)+'\n');
function run(kind,index,args,program=process.execPath,extraEnv={}){
  idle();const before=loadavg(),start=performance.now();
  const p=spawnSync(program,args,{cwd:root,env:{...env,...extraEnv},encoding:'utf8',maxBuffer:32<<20});
  const seconds=(performance.now()-start)/1000,log=`${kind}-${index}.log`;
  writeFileSync(join(out,log),(p.stdout??'')+'\n'+(p.stderr??''));
  const row={kind,index,program,args,seconds,exit:p.status,signal:p.signal,loadBefore:before,loadAfter:loadavg(),log};
  report.runs.push(row);save();idle();return {p,row};
}
save();
try{
  for(const [index,order] of [['first',['original','direct']],['1',['direct','original']],['2',['original','direct']],['3',['direct','original']]]){
    for(const kind of order){
      const args=kind==='original'?['scripts/test-integration-ts.mjs','--test-reporter=tap','--test-reporter-destination=stdout',`--test-name-pattern=${nativePattern}`,...nativeFiles]:
        ['--test','--test-concurrency=1','--test-reporter=tap',...direct];
      const {p,row}=run(kind,index,args,process.execPath,{COC_TS_TEST_CONCURRENCY:'1'});
      assert.equal(p.status,0,`Failed ${row.log}`);
      assert.match(p.stdout,new RegExp(`# tests ${manifest.businessCaseCount}\\b`));assert.match(p.stdout,new RegExp(`# pass ${manifest.businessCaseCount}\\b`));
      assert.match(p.stdout,/# fail 0\b/);assert.match(p.stdout,/# skipped 0\b/);
      console.log(`${kind} ${index}: ${row.seconds.toFixed(3)} s`);
    }
  }
  for(let index=1;index<=3;index++){
    const {p,row}=run('default-fast',String(index),['scripts/test-fast.mjs','--test-reporter=tap']);
    assert.equal(p.status,0,`Failed ${row.log}`);assert.match(p.stdout,new RegExp(`# tests ${manifest.fastCaseCount}\\b`));assert.match(p.stdout,new RegExp(`# pass ${manifest.fastCaseCount}\\b`));
    console.log(`default fast ${index}: ${row.seconds.toFixed(3)} s`);
  }
  const median=xs=>xs.sort((a,b)=>a-b)[Math.floor(xs.length/2)];
  const seconds=kind=>median(report.runs.filter(r=>r.kind===kind&&r.index!=='first').map(r=>r.seconds));
  report.summary={originalSeconds:seconds('original'),directSeconds:seconds('direct'),defaultFastSeconds:seconds('default-fast'),
    speedup:seconds('original')/seconds('direct'),reductionPercent:(1-seconds('direct')/seconds('original'))*100};save();
  symlinkSync(join(root,'node_modules'),join(out,'node_modules'),'dir');
  const mutations=[
    ['eight-hour-day','kernel-ts/healing/session.ts','DAY_MINUTES = 24 * 60','DAY_MINUTES = 8 * 60','resource-settlement','test_a_day_of_rest_is_one_hit_point_not_three'],
    ['rounded-mp','kernel-ts/healing/mp.ts','wholeHours = Math.floor(total / 60)','wholeHours = Math.round(total / 60)','resource-settlement','test_apply_time_ninety_minutes_grants_one_point_not_a_rounded_two'],
    ['stale-sheet','kernel-ts/healing/resources.ts','await mirrorInvestigator(context, id, { conditions: healed });','void healed;','resource-settlement','test_healing_clears_the_sheet_and_a_healed_wound_does_not_come_back'],
    ['wrong-hp','kernel-ts/setup/chargen.ts','/ number(hp.divisor)), SAN:','/ number(hp.divisor)) + 1, SAN:','chargen-direct','test_derive_values_match_the_rulebook_cases'],
    ['identity-leak','kernel-ts/read/mechanics.ts','receipt[`${key}_is_investigator`] === true','true','mechanics-identity-direct','test_public_identity_is_explicit_and_projection_preserves_canonical_receipt'],
    ['reversed-band','kernel-ts/rules/bands.ts','number(item.min) > number(item.max)','false','rules-bands-direct','test_a_malformed_row_fails_loudly_naming_the_table_and_the_row'],
    ['san-day-not-reset','kernel-ts/healing/day.ts','state.daily_san_lost = 0;','state.daily_san_lost += 0;','sanity-day-direct','test_midnight_closes_the_sanity_day'],
  ];
  for(const [name,file,from,to,testFile,testName] of mutations){
    const output=join(out,`${name}.mjs`);let applied=0;
    await build({entryPoints:[join(root,'kernel-ts/testing/fast.ts')],outfile:output,bundle:true,packages:'external',format:'esm',platform:'node',target:'node22',logLevel:'silent',
      plugins:[{name:'mutation',setup(b){b.onLoad({filter:/\.ts$/},args=>{
        if(args.path!==join(root,file))return;
        const source=readFileSync(args.path,'utf8');assert.equal(source.split(from).length,2);applied++;
        return {contents:source.replace(from,to),loader:'ts'};
      });}}]});assert.equal(applied,1);
    const {p,row}=run('mutation',name,['--test','--test-reporter=tap',`tests/extension/${testFile}.test.mjs`],process.execPath,{COC_RESOURCE_PILOT_API:output});
    const caught=p.status===1&&new RegExp(`not ok \\d+ - ${testName}`).test(p.stdout)&&p.stdout.includes('ERR_ASSERTION');
    report.mutations.push({name,file,from,to,testName,caught,log:row.log});save();assert.ok(caught,`Mutation ${name} escaped its assertion`);
    console.log(`caught ${name}`);
  }
  assert.deepEqual(hashes(),report.hashes);
}catch(error){report.failure=String(error);throw error;}
finally{report.finished=new Date().toISOString();save();}
