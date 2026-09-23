// SL-11 scope 1 measurement: which of the gate turn's Keeper look/lookup calls would the read step's candidate bodies
// have made unnecessary? Replays the gate table's own state (a byte copy of campaign game-b5367f88 before turn 1) on the
// emitted kernel, builds the run's candidates and bodies exactly as the read step does, re-issues each recorded Keeper
// read with its recorded parameters, and checks what of its answer the bodies already carried.
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
// node experiments/single-loop-routing/sl11-measure-lookups.mjs [fixture]   (default: fixtures/gate-turn1)
const R=import.meta.dirname, W=join(R,'../..');
const {materialize,readFixture,removeTree}=await import(join(R,'fixture.mjs'));
const {startKernel}=await import(join(R,'kernel.mjs'));
const {buildCandidates}=await import(W+'/runtime/jev/candidates.ts');
const {readCandidateBodies}=await import(W+'/runtime/jev/candidate-bodies.ts');
const fixtureDir=process.argv[2]??'gate-turn1';
const {turn:fx}=readFixture(fixtureDir);const ws=materialize(fixtureDir);const campaign=fx.campaign;
spawnSync('git',['--git-dir',join(ws,'.coc/repos',campaign+'.git'),'--work-tree',join(ws,'.coc/campaigns',campaign),'reset','--hard',fx.commit_before]);
const k=startKernel({workspace:ws});
const call=(m,p)=>k.call(m,{campaign,...p});
const quiet=async m=>{try{return await call(m,{})}catch{return {}}};
async function readStep(label){
  const [capsule,applyOptions,resolveOptions]=await Promise.all([call('table.capsule',{}),quiet('table.apply.options'),quiet('table.resolve.options')]);
  const candidates=buildCandidates({capsule,applyOptions,resolveOptions,located:[],answering:[]},fx.player_input);
  const issued=await readCandidateBodies({candidates,capsule,call});
  console.log(`--- read ${label}: scene ${capsule.where?.scene}; candidates ${candidates.map(c=>c.key).join(', ')}`);
  console.log(`    bodies ${issued.bodies.map(b=>`${b.family}:${b.name}${b.truncated?'(truncated:'+(b.omitted_fields||[]).join('/')+')':''}`).join(', ')}; ${issued.bytes} B, ${issued.reads} kernel reads, ${issued.ms} ms; omitted ${JSON.stringify(issued.omitted)}`);
  return {capsule,issued};
}
const flat=v=>JSON.stringify(v);
/** Is every string value of `answer` (at least 12 characters, identity fields aside) present in the bodies? */
function coverage(answer,issued){
  const text=flat(issued.bodies.map(b=>b.body));const miss=[];let total=0;
  const walk=(v,path)=>{ if(typeof v==='string'){ if(v.length<12)return; total++; if(!text.includes(JSON.stringify(v).slice(1,-1)))miss.push(path);} else if(Array.isArray(v))v.forEach((x,i)=>walk(x,path+'['+i+']')); else if(v&&typeof v==='object')for(const [kk,x] of Object.entries(v))walk(x,path+'.'+kk);};
  walk(answer,'');return {strings:total,covered:total-miss.length,missing:miss.slice(0,12)};
}
try{
  await call('table.player_input',{text:fx.player_input});
  const first=await readStep('turn start');
  const recorded=[
    ['call 1','table.lookup',{kind:'module',query:'knott-keys knott-commission knott-research-leads Handout 1',limit:8}],
    ['call 1','table.lookup',{kind:'source',source_mode:'answer',query:'Steven Knott commission',question:'What exact terms, cash, keys, and address does Knott give when the investigators accept, and what does he say about the Boston Globe?'}],
    ['call 2','table.look',{focus:'clues'}],
  ];
  for(const [label,method,params] of recorded){
    let answer;try{answer=await call(method,params)}catch(e){answer={error:String(e.message).slice(0,160)}}
    console.log(`${label} ${method} ${flat(params).slice(0,90)} -> ${flat(answer).slice(0,140)}`);
    console.log('    coverage by the turn-start bodies:',flat(coverage(answer,first.issued)));
  }
  // The same handles one by one, as the lookup's own fix tells the Keeper to ask (the recorded query mixed words in).
  for(const h of ['knott-keys','knott-commission','knott-research-leads']){const a=await call('table.lookup',{kind:'module',query:h});
    console.log(`    per handle ${h}: coverage`,flat(coverage(a.entities.filter(e=>e.kind==='clue'),first.issued)));}
  const h1=await call('table.lookup',{kind:'module',query:"Handout 1: Mr. Knott's Commission",expected_kind:'handout'});
  console.log('    handout 1 by name: coverage',flat(coverage(h1.entities,first.issued)));
  // The Keeper's batch (call 3): the clues, cash, the keys and the move. The read after that scene change is the read step's.
  await call('table.apply',{call_id:'t1-c1',effects:[{kind:'clue',clue:'knott-commission'},{kind:'clue',clue:'knott-keys'},{kind:'clue',clue:'knott-research-leads'},{kind:'clue',clue:'knott-macario-summary'},{kind:'move',to:'newspaper-morgue'}]});
  const after=await readStep('after the move');
  const arty=await call('table.look',{focus:'npc',name:'Arty Wilmot'});
  console.log(`call 4 table.look {"focus":"npc","name":"Arty Wilmot"} -> ${flat(arty).slice(0,120)}`);
  console.log('    coverage by the post-move bodies:',flat(coverage(arty,after.issued)));
  console.log('    coverage by the turn-start move body (people_there):',flat(coverage({name:arty.name,role:arty.role,untold:arty.untold,wants:arty.wants},first.issued)));
}finally{await k.close();removeTree(ws);}
