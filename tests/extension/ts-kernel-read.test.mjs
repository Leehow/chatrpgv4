import {expected as outcome, withoutPostFreezeIdentity, withoutPostFreezeRecovery} from "./oracle-fixture.mjs";
import {pythonOracleRoot} from "../python-oracle.mjs";
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ROOT=resolve(import.meta.dirname,'../..'),CONTENT=join(ROOT,'content');
const temporary=await mkdtemp(join(tmpdir(),'coc read oracle '));
after(()=>rm(temporary,{recursive:true,force:true}));
const exports=[
  ['json',['parsePythonJson','pythonJsonDumps','canonicalJson','PythonFloat']],
  ['context',['createKernelContext']],
  ['rules/tables',['RuleTables']],
  ['combat/engine',['CombatSession']],
  ['combat/receipts',['recordCombatRolls','recordCombatDamage']],
  ['combat/execution',['executeCombatResolve']],
  ['resolve/context',['SettleContext']],
  ['capabilities',['REGISTERED_CONDITION_PATHS','RESOLVER_NAMES']],
  ['read/campaign',['CampaignSnapshot']],
  ['read/module-graph',['ModuleGraph','conditionStatus']],
  ['read/content',['DirectorGraph','TextGraph','Ontology']],
  ['read/director',['score','signals','directorSection']],
  ['read/rule-facts',['evaluateCondition','factsFromState','semanticName']],
  ['read/mechanics',['mechanics']],
  ['read/capsule',['fitBudget','fittedModuleSection','npcEntry','npcView','presentSection','investigatorView']],
  ['read/session-view',['SessionView']],
  ['read/mods',['publicSheet','objectLook']],
];
await build({stdin:{contents:exports.map(([file,names])=>`export {${names.join(',')}} from ${JSON.stringify(join(ROOT,'kernel-ts',file+'.ts'))};`).join('\n'),
  resolveDir:ROOT,sourcefile:'read-oracle-api.ts',loader:'ts'},outfile:join(temporary,'api.mjs'),bundle:true,platform:'node',format:'esm',target:'node22',logLevel:'silent'});
const api=await import(pathToFileURL(join(temporary,'api.mjs')).href);
const clone=value=>api.parsePythonJson(api.pythonJsonDumps(value));
const json=async path=>api.parsePythonJson(await readFile(path,'utf8'));
const graphPath=join(temporary,'module-graph.json');
const raw=await json(join(CONTENT,'starters/the-haunting/module-graph.json'));
raw.nodes.push(...['east','west'].map(side=>({node_id:`npc-${side}-doctor`,node_kind:'npc',name:`Doctor ${side}`,aliases:['The Doctor'],
  summary:`A ${side} specialist.`,visibility:'keeper',properties:{agenda:'Keep the records private',secret:`${side} confidential evidence`,knowledge:['The archive is open.']}})));
await writeFile(graphPath,api.pythonJsonDumps(raw));
const graphBytes=await readFile(graphPath),dossier=(await json(join(CONTENT,'modules/module-graph-contract-v3.json'))).actor_dossier;
const graph=new api.ModuleGraph('the-haunting',raw,createHash('sha256').update(graphBytes).digest('hex'),dossier);
const scene=graph.kind('scene')[0],sceneId=scene.node_id,sceneHandle=graph.handle(scene),npc=graph.kind('npc')[0];
const party=[{id:'alice',name:'Alice',occupation:'Journalist',current_hp:8,current_san:45,current_mp:9,current_luck:40,
  characteristics:{CON:55},derived:{HP:12},conditions:[],skills:{Listen:60,'Spot Hidden':60},equipment:[],weapons:[]}];
const world={active_scene:sceneHandle,npc_presence:{[graph.handle(npc)]:sceneHandle,'east-doctor':sceneHandle,'west-doctor':sceneHandle},
  discovered_clues:[],flags:{'door-open':true,'alarm-off':false},clock:{minutes:60}};

const REFERENCE=String.raw`
import copy,json,sys
from pathlib import Path
from coc.errors import RpcError
from coc.module_graph import ModuleGraph
from coc import capsule,director,render
from coc.rules.graph import evaluate_condition,facts_from_state,semantic_name
from coc.ontology import Ontology
from coc.sessions import SessionView
from coc.mods.objects import public_sheet,look
p=json.load(sys.stdin)
graph=ModuleGraph('the-haunting',Path(p['graph_path']))
def captured(fn):
    try: return {'value':fn()}
    except RpcError as error: return {'error':error.to_json()}
op=p['operation']
if op=='graph':
    output=[]
    for case in p['cases']:
        args=([graph.nodes[case['node']]] if case.get('node') else [])+case.get('args',[])
        output.append(captured(lambda case=case,args=args:getattr(graph,case['python'])(*args)))
elif op=='conditions':
    output=[evaluate_condition(c['expression'],c['facts']) for c in p['cases']]
elif op=='semantic_names': output=[semantic_name(value) for value in p['names']]
elif op=='ontology':
    from coc.rules.graph import REGISTERED_CONDITION_PATHS
    from coc.rules.runtime import RulesEngine
    from coc.rules.tables import RuleTables
    content=Path(p['content']);manifest=json.loads((content/'rulesets/coc7/manifest.json').read_text())
    rule_graph=json.loads((content/'rulesets/coc7'/manifest['entry_points']['rule_graph']).read_text())
    text_graph=json.loads((content/'craft/text-graph.json').read_text())
    dg=director.DirectorGraph(content/'director')
    absent=Path(p['absent_content']);assert not absent.exists()
    engine=RulesEngine(absent,RuleTables(absent/'rulesets/coc7/rules-json'))
    output=[Ontology(Path(c['path'])).validate(rule_node_ids=[n['node_id'] for n in rule_graph['nodes']],
      director_node_ids=dg.nodes,text_node_ids=[n['node_id'] for n in text_graph['nodes']],registered_paths=REGISTERED_CONDITION_PATHS,
      capabilities=engine.resolver_index(),module_node_ids=lambda name:list(graph.nodes) if name=='the-haunting' else None) for c in p['cases']]
elif op=='director_invalid': output=captured(lambda:director.DirectorGraph(Path(p['directory'])).digest)
elif op=='facts':
    output=[facts_from_state(c['state'],c['sheet'],elapsed_minutes=c['minutes'],extra=c.get('extra',{})) for c in p['cases']]
elif op=='director':
    dg=director.DirectorGraph(Path(p['content'])/'director')
    output=[director.score(dg,c['signals'],graph.nodes[c['scene']],can_move=c['canMove'],overlap=c['overlap'],pressure_available=c['pressureAvailable']) for c in p['cases']]
elif op=='signals':
    output=[]
    for c in p['cases']:
        output.append(director.signals(graph,c['world'],graph.nodes[c['scene']],c['turn'],party=c['party'],
          present=[graph.nodes[n] for n in c['present']],undiscovered_here=c['undiscovered'],records={r['turn']:r for r in c['records']},
          session=c['session'],clock_near_full=c['nearFull'],conditions_of=lambda s:c['conditions'].get(s['id'],[]),
          sanity_of=lambda s:c['sanity'].get(s['id']),worldline=c.get('worldline')))
elif op=='grounding':
    dg=director.DirectorGraph(Path(p['content'])/'director');ontology=Ontology(Path(p['content'])/'ontology/system-ontology.json')
    output=[]
    for c in p['cases']:
        output.append(capsule.director_section(dg,ontology,graph,c['world'],graph.nodes[c['scene']],c['turn'],c['party'],
          [graph.nodes[n] for n in c['present']],{r['turn']:r for r in c['records']},c['session'],clock_near_full=c['nearFull'],
          memory_rows=c.get('memory',[]),conditions_of=lambda s:c['conditions'].get(s['id'],[]),
          sanity_of=lambda s:c['sanity'].get(s['id']),worldline=c.get('worldline')))
elif op=='mechanics': output=render.mechanics(p['receipts'],p['placed'])
elif op=='budget':
    output=[]
    for c in p['cases']:
        section=copy.deepcopy(c['section']);cut=capsule.fit_budget(section,c['budget'],drop=c['drop']);output.append({'section':section,'cut':cut})
elif op=='module_budget': output=[capsule.fitted_module_section(graph,budget) for budget in p['budgets']]
elif op=='sessions':
    output=[]
    for c in p['cases']:
        view=SessionView(Path(c['directory']),graph,c['party'],c['world'])
        output.append({'active':view.active_session(),'pending':view.pending_choice(),'combat':view.combat_view(),
          'chase':view.chase_view(),'facts':view.facts(c['party'][0]['id'],c['minutes'])})
elif op=='npc':
    node=graph.nodes[p['node']];memories={r['id']:r for r in p['memories']}
    output={'entry':capsule.npc_entry(graph,p['world'],node,p['ledger'],memories),
      'view':capsule.npc_view(graph,p['world'],node,p['ledger']),
      'present':capsule.present_section(graph,p['world'],graph.nodes[p['scene']],p['ledger'],p['memories']),
      'investigator':capsule.investigator_view(p['sheet'])}
elif op=='objects': output=[captured(lambda:public_sheet(p['world'],p['sheet']))]+[captured(lambda name=name:look(p['world'],name)) for name in p['names']]
else: raise ValueError(op)
json.dump(output,sys.stdout,ensure_ascii=False)
`;
function oracle(operation,data) {
  // Keyed by the question, not by the order it was asked in: the runner is free to reorder.
  // A question can carry a path or an id minted for this run; those are the run, not the question.
  const question=api.pythonJsonDumps({operation,...data})
    .replaceAll(ROOT,'<root>').replace(/\/(?:private\/)?(?:tmp|var)\/[^"']*/g,'<temp>')
    .replace(/\b[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\b/g,'<id>');
  const key=`read-${operation}-${createHash('sha256').update(question).digest('hex').slice(0,16)}`;
  return api.parsePythonJson(outcome(key,()=>{
    const result=spawnSync('uv',['run','--frozen','python','-c',REFERENCE],{cwd:ROOT,
      env:{...process.env,PYTHONPATH: join(pythonOracleRoot(), "kernel"),PYTHONDONTWRITEBYTECODE:'1',UV_OFFLINE:'1',UV_NO_SYNC:'1'},
      input:api.pythonJsonDumps({operation,graph_path:graphPath,content:CONTENT,...data}),encoding:'utf8',maxBuffer:8*1024*1024,timeout:30000});
    assert.equal(result.status,0,result.stderr||String(result.error));
    return result.stdout;
  },REFERENCE));
}
function captured(run) {try{return {value:run()};}catch(error){if(typeof error.toJson==='function')return withoutPostFreezeRecovery({error:error.toJson()});throw error;}}
function same(actual,expected,label) {assert.equal(api.canonicalJson(actual),api.canonicalJson(expected),label);}
async function rows(t,cases,expected,run) {for(const [index,entry] of cases.entries())await t.test(entry.label||String(index),async()=>same(await run(entry,index),expected[index],entry.label));}

test('ModuleGraph read methods match Python on authored material and ambiguous aliases',async t=>{
  const cases=[];
  for(const node of [...graph.kind('scene').slice(0,2),...graph.kind('npc').slice(0,2)]) {
    cases.push({label:`entity ${node.node_id}`,python:'entity_view',typescript:'entityView',node:node.node_id});
    if(node.node_kind==='scene')for(const [python,typescript] of [['scene_exits','sceneExits'],['scene_clue_ids','sceneClueIds'],['scene_assets','sceneAssets'],['scene_endings','sceneEndings']])
      cases.push({label:`${python} ${node.node_id}`,python,typescript,node:node.node_id});
    else for(const [python,typescript] of [['actor_profile','actorProfile'],['npc_knows','npcKnows'],['npc_beliefs','npcBeliefs'],['npc_would_say','npcWouldSay']])
      cases.push({label:`${python} ${node.node_id}`,python,typescript,node:node.node_id});
  }
  for(const name of [sceneHandle,graph.displayName(npc),'The Doctor','unlisted-person'])cases.push({label:`resolve ${name}`,python:'resolve',typescript:'resolve',args:[name]});
  for(const query of ['doctor','Knott','library','corridor'])cases.push({label:`search ${query}`,python:'search',typescript:'search',args:[query]});
  const before=api.pythonJsonDumps(raw),expected=oracle('graph',{cases});
  await rows(t,cases,expected,c=>{
    const result=captured(()=>graph[c.typescript](...(c.node?[graph.nodes.get(c.node)]:[]),...(c.args||[])));
    // The entity view grew `destination_identity` after the freeze; it is dropped from the live side
    // here and asserted in `destination-identity.test.mjs`. See POST_FREEZE_ENTITY_FIELDS for why the
    // captured outcome is evidence and is not edited to match.
    return c.typescript==='entityView'&&result.value?{...result,value:withoutPostFreezeIdentity(result.value)}:result;
  });
  assert.equal(api.pythonJsonDumps(raw),before);
  assert.deepEqual(await readFile(graphPath),graphBytes);
});

test('condition evaluation preserves unresolved gates and Python scalar comparisons',async t=>{
  const cases=[
    {label:'missing registered fact stays unresolved',expression:{op:'eq',path:'actor.resources.hp',value:0},facts:{}},
    {label:'unknown path stays unresolved',expression:{op:'exists',path:'not.registered'},facts:{'not.registered':true}},
    {label:'false fact exists',expression:{op:'exists',path:'actor.conditions.dead'},facts:{'actor.conditions.dead':false}},
    {label:'false dominates unresolved conjunction',expression:{op:'all',of:[{op:'eq',path:'actor.resources.hp',value:1},{op:'exists',path:'actor.conditions.dead'}]},facts:{}},
    {label:'true dominates unresolved alternative',expression:{op:'any',of:[{op:'eq',path:'actor.resources.hp',value:1},{op:'exists',path:'actor.conditions.dead'}]},facts:{'actor.conditions.dead':true}},
    {label:'negation keeps unresolved',expression:{op:'not',of:{op:'eq',path:'actor.resources.hp',value:1}},facts:{}},
    {label:'empty all',expression:{op:'all',of:[]},facts:{}},
    {label:'invalid not arity',expression:{op:'not',of:[]},facts:{}},
    {label:'Python bool equals integer',expression:{op:'eq',path:'actor.resources.hp',value:true},facts:{'actor.resources.hp':1}},
    {label:'Python float equals integer',expression:{op:'eq',path:'actor.resources.hp',value:new api.PythonFloat(1)},facts:{'actor.resources.hp':1}},
    {label:'nested numeric equality',expression:{op:'eq',path:'actor.conditions',value:[new api.PythonFloat(1)]},facts:{'actor.conditions':[1]}},
    {label:'large integer differs from rounded adjacent float',expression:{op:'eq',path:'actor.resources.hp',value:new api.PythonFloat(9007199254740992)},facts:{'actor.resources.hp':9007199254740993n}},
    {label:'nested large integer differs from rounded adjacent float',expression:{op:'eq',path:'actor.conditions',value:[{value:new api.PythonFloat(9007199254740992)}]},facts:{'actor.conditions':[{value:9007199254740993n}]}},
    {label:'exact representable large integer equals float',expression:{op:'eq',path:'actor.resources.hp',value:new api.PythonFloat(9007199254740992)},facts:{'actor.resources.hp':9007199254740992n}},
    {label:'condition membership',expression:{op:'not-contains',path:'actor.conditions',value:'dead'},facts:{'actor.conditions':['major_wound']}},
    {label:'mixed ordering stays unresolved',expression:{op:'lt',path:'actor.resources.hp',value:'one'},facts:{'actor.resources.hp':1}},
    {label:'Unicode code point ordering',expression:{op:'gt',path:'actor.id',value:'\ufffd'},facts:{'actor.id':'\u{1f680}'}},
  ];
  await rows(t,cases,oracle('conditions',{cases}),c=>api.evaluateCondition(c.expression,c.facts));
});

test('investigator facts retain wound-clock boundaries and explicit unknown overrides',async t=>{
  const state={investigator_id:'alice',current_hp:3,current_san:45,current_mp:9,current_luck:40,conditions:['major_wound'],
    wound_ledger:[{wound_id:'older',status:'active',occurred_elapsed_minutes:-60},{wound_id:'recent',status:'active',occurred_elapsed_minutes:10}],major_wound_recovery_ledger:[]};
  const cases=[
    {label:'absent state',state:{},sheet:{},minutes:null},
    {label:'one minute before weekly recovery',state,sheet:party[0],minutes:10089},
    {label:'weekly recovery becomes due',state,sheet:party[0],minutes:10090},
    {label:'recovery attempt resets baseline',state:{...state,major_wound_recovery_ledger:[{wound_id:'recent',attempt_elapsed_minutes:10090}]},sheet:party[0],minutes:10091},
    {label:'malformed wound blocks due projection',state:{...state,wound_ledger:[{status:'active',occurred_elapsed_minutes:10}]},sheet:party[0],minutes:11000},
    {label:'float timestamp is not integer evidence',state:{...state,wound_ledger:[{wound_id:'float',status:'active',occurred_elapsed_minutes:new api.PythonFloat(10)}]},sheet:party[0],minutes:11000},
    {label:'explicit null rescuer count stays unknown',state:{},sheet:{},minutes:null,extra:{'intent.rescuer_count':null}},
    {label:'boolean elapsed time is invalid',state,sheet:party[0],minutes:true},
  ];
  await rows(t,cases,oracle('facts',{cases}),c=>api.factsFromState(c.state,c.sheet,c.minutes,c.extra||{}));
});

test('Director signals and authored scoring match the Python decision table',async t=>{
  const base={world,scene:sceneId,turn:{turn:4,pending_choice:null},party,present:[npc.node_id],undiscovered:2,
    records:[{turn:3,player_text:'Inspect the papers',intents:['investigate'],world:{scene:{name:sceneHandle}},receipts:[{kind:'roll',passed:false,pushed:true,level:'failure'}]},
      {turn:2,player_text:'Wait',world:{scene:{name:sceneHandle}},receipts:[]}],session:null,nearFull:false,conditions:{alice:[]},sanity:{},worldline:{loop_count:2,echoes_here:1,loop_available:true}};
  const cases=[{...base,label:'stalled source investigation'},
    {...base,label:'worst investigator drives rescue',party:[...party,{...party[0],id:'bob',name:'Bob',current_hp:0}],conditions:{bob:['major_wound']}},
    {...base,label:'SAN loss within scene',records:[{turn:3,player_text:'See it',world:{scene:{name:sceneHandle}},receipts:[{kind:'delta',resource:'san',subject:'alice',before:45,after:40}]}]},
    {...base,label:'live bout and pending player choice',turn:{turn:4,pending_choice:{name:'pending'}},sanity:{alice:{bout_active:true}},session:{kind:'sanity_bout',status:'active'}}];
  const expected=oracle('signals',{cases});
  // The frozen oracle predates the turn floor's structural signals (empty_turns, repeat_input, previous_close,
  // docs/specs/turn-floor.md D3) and the obstacle signal that followed it (blocked_attempts, contract §40);
  // preserve its remaining projection.
  const FLOOR_SIGNALS=['empty_turns','repeat_input','previous_close','blocked_attempts'];
  const withoutFloor=sig=>Object.fromEntries(Object.entries(sig).filter(([key])=>!FLOOR_SIGNALS.includes(key)));
  const withoutFloorBecause=section=>({...section,because:section.because.filter(line=>!FLOOR_SIGNALS.some(name=>line.startsWith(name+' = ')))});
  await rows(t,cases,expected,c=>withoutFloor(api.signals({...c,graph,scene:graph.nodes.get(c.scene),present:c.present.map(id=>graph.nodes.get(id)),conditions:s=>c.conditions[s.id]||[],sanity:s=>c.sanity[s.id]||null})));
  const dg=new api.DirectorGraph(await json(join(CONTENT,'director/director-graph.json')),await json(join(CONTENT,'director/director-graph-manifest.json')));
  const quiet={...expected[0],intent:'none',undiscovered_here:0,agenda_npc_present:0,dramatic_question:false,exit_condition_met:false,main_line_complete:false,
    stalled_turns:0,turns_in_scene:1,hp_state:'healthy',sanity_state:'stable',session:'none',last_roll:'none',pushed_fail_pending:false,pending_choice:false,clock_near_full:false};
  const scored=[{label:'baseline is not a trigger',signals:quiet},...expected.map((signals,index)=>({label:`derived signals ${index}`,signals})),
    {label:'fumble override',signals:{...quiet,last_roll:'fumble'}},{label:'choice override',signals:{...quiet,pending_choice:true}},
    {label:'session override precedes dying',signals:{...quiet,session:'combat',hp_state:'dying',last_roll:'fumble'}},
    ...dg.structureTypes.map(structure_type=>({label:`weighted stalled transition ${structure_type}`,signals:{...quiet,structure_type,intent:'stuck',stalled_turns:4,turns_in_scene:5,pushed_fail_pending:true}}))]
    .map(c=>({...c,scene:sceneId,canMove:true,overlap:c.signals.intent==='stuck'?2:0,pressureAvailable:true}));
  await rows(t,scored,oracle('director',{cases:scored}),c=>api.score(dg,c.signals,scene,c));
  const names=['decision:coc7:combat:attack','decision:mods:weapon:repair','rule:coc7:combat:attack','decision:short','legacy'];
  same(names.map(api.semanticName),oracle('semantic_names',{names}),'semantic decision names');
  const ontology=new api.Ontology(await json(join(CONTENT,'ontology/system-ontology.json')));
  const grounded=[cases[0],{...base,label:'subsystem decision grounding',session:{kind:'combat',status:'active'}},cases[1]];
  // The frozen oracle predates explicit unknown-check wording; preserve its remaining projection.
  const withoutGates=section=>({...section,...(section.reveal?{reveal:section.reveal.map(({gate,...clue})=>clue)}:{})});
  await rows(t,grounded,oracle('grounding',{cases:grounded}).map(withoutGates),c=>{
    const selected=graph.nodes.get(c.scene),present=c.present.map(id=>graph.nodes.get(id));
    const sig=api.signals({...c,graph,scene:selected,present,undiscovered:graph.sceneClueIds(selected).filter(id=>!c.world.discovered_clues.includes(graph.handle(graph.nodes.get(id)))).length,
      conditions:s=>c.conditions[s.id]||[],sanity:s=>c.sanity[s.id]||null});
    const section=api.directorSection(dg,ontology,graph,c.world,selected,sig,c.memory||[],present);
    if(section.reveal)assert.deepEqual(section.reveal.map(clue=>clue.gate),[
      'environmental: check unspecified','environmental: check unspecified','obvious: check unspecified',
      'obvious: check unspecified','environmental: check unspecified']);
    return withoutGates(withoutFloorBecause(section));
  });
});

test('ontology rejects invalid graph references against independent node and capability pools',async t=>{
  const directorGraph=await json(join(CONTENT,'director/director-graph.json'));
  const dg=new api.DirectorGraph(directorGraph,await json(join(CONTENT,'director/director-graph-manifest.json')));
  const textGraph=await json(join(CONTENT,'craft/text-graph.json'));
  const craft=new api.TextGraph(textGraph,await json(join(CONTENT,'craft/text-graph-manifest.json')),await json(join(CONTENT,'craft/beat-directives.json')),dg.beats);
  const manifest=await json(join(CONTENT,'rulesets/coc7/manifest.json'));
  const ruleIds=(await json(join(CONTENT,'rulesets/coc7',manifest.entry_points.rule_graph))).nodes.map(node=>node.node_id);
  const valid={contract_id:'coc.system-ontology-registry.v1',graphs:[
    {graph_id:'rule:coc7',graph_kind:'rule'},{graph_id:'state:live',graph_kind:'live-state'},
    {graph_id:'execution:current',graph_kind:'execution'},{graph_id:'director:current',graph_kind:'director'},
    {graph_id:'text:current',graph_kind:'text'},{graph_id:'module:the-haunting',graph_kind:'module'},
  ],references:[
    {ref_id:'ref:rule',graph_id:'rule:coc7',semantic_id:ruleIds[0]},
    {ref_id:'ref:state',graph_id:'state:live',semantic_id:'fact:current',locator:api.REGISTERED_CONDITION_PATHS[0]},
    {ref_id:'ref:execution',graph_id:'execution:current',semantic_id:'executor:current',locator:api.RESOLVER_NAMES[0]},
    {ref_id:'ref:director',graph_id:'director:current',semantic_id:directorGraph.nodes[0].node_id},
    {ref_id:'ref:text',graph_id:'text:current',semantic_id:textGraph.nodes[0].node_id},
    {ref_id:'ref:module',graph_id:'module:the-haunting',semantic_id:sceneId},
  ],relations:[{relation_id:'grounding',relation_kind:'grounded-by',from_ref:'ref:director',to_ref:'ref:rule'}]};
  const cases=[{label:'independent valid pools',raw:valid},
    {label:'bad rule node',change:value=>{value.references[0].semantic_id='rule:missing';}},
    {label:'unknown live-state locator',change:value=>{value.references[1].locator='actor.unregistered';}},
    {label:'unknown executor locator',change:value=>{value.references[2].locator='unregistered.executor';}},
    {label:'missing relation endpoint',change:value=>{value.relations[0].to_ref='ref:missing';}},
  ];
  for(const [index,c] of cases.entries()){
    c.raw=clone(valid);c.change?.(c.raw);delete c.change;
    c.path=join(temporary,`ontology-${index}.json`);await writeFile(c.path,api.pythonJsonDumps(c.raw));
  }
  const expected=oracle('ontology',{cases,absent_content:join(temporary,'absent-executor-content')});
  assert.deepEqual(expected[0],[]);
  for(const finding of expected.slice(1))assert.equal(finding.length,1);
  await rows(t,cases,expected,c=>new api.Ontology(c.raw).validate(ruleIds,dg,craft,async name=>name==='the-haunting'?[...graph.nodes.keys()]:null));
});

test('Director graph digest mismatch returns the same refusal as Python',async()=>{
  const directory=join(temporary,'invalid Director');await mkdir(directory);
  const source=await json(join(CONTENT,'director/director-graph.json'));
  const manifest={...await json(join(CONTENT,'director/director-graph-manifest.json')),graph_content_digest:'0'.repeat(64)};
  await writeFile(join(directory,'director-graph.json'),api.pythonJsonDumps(source));
  await writeFile(join(directory,'director-graph-manifest.json'),api.pythonJsonDumps(manifest));
  const expected=oracle('director_invalid',{directory});
  assert.equal(expected.error.code,'campaign_not_ready');
  // The frozen oracle's refusal carries the digest of the graph it was frozen against; the graph has since
  // gained the turn-floor rules (docs/specs/turn-floor.md D3), so the live digest is checked against the
  // graph itself and the rest of the refusal against the oracle.
  const refusal=captured(()=>new api.DirectorGraph(source,manifest).digest);
  const withoutActual=value=>{const copy=JSON.parse(JSON.stringify(value));delete copy.error.details.director.actual;return copy;};
  const live=(await json(join(CONTENT,'director/director-graph-manifest.json'))).graph_content_digest;
  assert.equal(refusal.error.details.director.actual,live,'the refusal names the live digest');
  same(withoutActual(refusal),withoutActual(expected),'Director manifest refusal');
});

test('mechanics match Python without exposing unlabeled NPC identities',async()=>{
  const path=join(temporary,'handout.md'),text='# Handout\n\n'+('Evidence \u{1f680} '.repeat(900));await writeFile(path,text);
  const receipts=[
    {id:'roll:one',kind:'roll',skill:'Listen',roll:22,target:55,threshold:55,difficulty:'regular',level:'regular',passed:true,actor:'secret-npc',actor_label:'Hidden name',visibility:'keeper',call_id:'t1-c1',family:'core-check'},
    {id:'dice:one',kind:'roll',form:'dice',skill:'Damage',expression:'1D6',faces:[4],total:4,actor:'alice',actor_label:'Alice',actor_is_investigator:true},
    {id:'delta:one',kind:'delta',resource:'hp',before:12,after:8,subject:'alice',subject_is_investigator:true,subject_label:'Alice'},
    {id:'delta:hidden',kind:'delta',resource:'hp',before:8,after:5,subject:'secret-npc'},
    {id:'move:rename',kind:'move',renamed:true,from:'room',to:'room'},
    {id:'move:one',kind:'move',from:'room',to:'hall',minutes:3,to_label:'Hall'},
    {id:'clue:one',kind:'clue',clue:'paper',label:'Paper',summary:' A dated letter. '},
    {id:'time:one',kind:'time',minutes:60},
    {id:'item:one',kind:'item',name:'Key',quantity:0,subject:'alice',subject_label:'Alice'},
    {id:'cash:one',kind:'cash',subject:'alice',before:new api.PythonFloat(5),after:new api.PythonFloat(3.5),currency:'USD'},
    {id:'session:one',kind:'session',family:'combat',transition:'start',round:1},
    {id:'choice:one',kind:'choice',option:'dodge'},
    {id:'line:one',kind:'worldline',operation:'fork',line:'alternate',mode:'if',loop:0,from:{line:'main',turn:2}},
    {id:'paper:one',kind:'handout',name:'Handout',attachment:{path,media_type:'text/markdown',available:true}},
    {id:'note:one',kind:'note',text:'No mechanics projection'},
  ];
  const placed={'listen':'roll:one','damage':'delta:one'},before=api.pythonJsonDumps(receipts);
  const live=api.mechanics(receipts,placed,new Map([[path,text]])),frozen=oracle('mechanics',{receipts,placed});
  // The handout's attachment carries this run's own temporary path; the captured outcome carries
  // the run it was captured in. The path is the run, not the projection.
  //
  // The second and third narrowings are fields the capture predates. §59 replaced the handout row's
  // `available` boolean with the three-state `document`, because a boolean could not tell a card
  // with no page from a card nobody had answered for. §80 dropped the clue row's `summary`: it is
  // the module's own sentence, written for the Keeper and carrying staging and agendas the player
  // has not earned, and the row now opens into the Keeper's account of how this table got the clue
  // instead. The capture's inputs are frozen along with its outcome, so no `how` can be added to
  // them here; the real path is covered by `clue-summary-is-keeper-only.test.mjs`. The name is
  // dropped from the comparison and asserted just below, against what the capture recorded.
  //
  // The fourth is the same shape: §95 added `bonus` and `penalty` to the roll row, because a bonus
  // or penalty die changes which d100 was kept and the card that draws the roll could not say one
  // was there. The capture predates them, so they are narrowed out of the comparison and asserted
  // just below; the real path is covered by `tests/kernel/test_declared_dice.py`.
  const narrowed=value=>api.pythonJsonDumps(value)
    .replace(/"(?:\/private)?\/(?:var|tmp)\/[^"]*handout\.md"/g,'"<attachment>"')
    .replace(/, ?"(?:available|document)": ?(?:true|false|"[a-z]+")/g,'')
    .replace(/, ?"(?:bonus|penalty)": ?\d+/g,'')
    .replace(/, ?"summary": ?"A dated letter\."/g,'');
  assert.equal(narrowed(live),narrowed(frozen),'mechanics');
  const liveRoll=live.find(item=>item.kind==='roll'),frozenRoll=frozen.find(item=>item.kind==='roll');
  assert.equal(frozenRoll.bonus,undefined,'the capture predates the two counts');
  assert.equal(liveRoll.bonus,0,'a roll with neither die says so rather than leaving the card to guess');
  assert.equal(liveRoll.penalty,0);
  const liveHandout=live.find(item=>item.kind==='handout'),frozenHandout=frozen.find(item=>item.kind==='handout');
  assert.equal(frozenHandout.available,true,'the capture recorded the boolean this replaced');
  assert.equal(liveHandout.document,'ready','an attached handout projects as `ready` where the capture said `available: true`');
  assert.equal(liveHandout.available,undefined,'the boolean is gone, not doubled: one field answers this question');
  const liveClue=live.find(item=>item.kind==='clue'),frozenClue=frozen.find(item=>item.kind==='clue');
  assert.equal(frozenClue.summary,'A dated letter.','the capture recorded the module sentence this replaced');
  assert.equal(liveClue.summary,undefined,'and the projection no longer copies it across');
  assert.equal(liveClue.how,undefined,'nothing was filed for this clue, so the row offers nothing to open');
  assert.equal(api.pythonJsonDumps(receipts),before);
});

test('public combat keeps attack, damage and each HP change attached to safe table names',async()=>{
  const npcId=graph.handle(npc);
  async function settle({actor='alice',skill=99,defense='none',shots=null,named=true,firearm=false}={}) {
    const kernel=await api.createKernelContext({workspace:temporary,content:CONTENT,seed:'combat-cards'});
    const tables=new api.RuleTables(kernel),session=await api.CombatSession.create('cards','scene/test',1,kernel.rng,tables);
    session.weaponCatalog.card_gun={weapon_id:'card_gun',skill:'Firearms (Handgun)',damage:'1D3',uses_per_round:'3',magazine:10};
    for(const id of ['alice',npcId])session.addParticipant(id,id==='alice'?'investigator':'npc',{
      dex:60,combatSkill:id===actor?skill:99,firearmsSkill:99,build:0,hpMax:100,weapons:[{weapon_id:shots||firearm?'card_gun':'unarmed'}]});
    session.beginRound();
    const target=actor==='alice'?npcId:'alice';
    const turn=session.declareAndResolveTurn(actor,'Attack',{action:'attack',targetActorId:target,defenseKind:defense,weaponId:shots||firearm?'card_gun':'unarmed',...(shots?{shots}: {})});
    const [rolls]=session.drainPending();
    const world={person_labels:named?{[npcId]:{name:'The masked visitor'}}:{}};
    const context=new api.SettleContext(kernel,{campaign:{id:'cards'},world,turn:{turn:1,receipts:[]}},
      {party}, {graph},tables,session.arithmetic,{},'t1-c1',1,party[0],party[0],{});
    const damages=api.recordCombatRolls(context,turn,rolls,session.damageChain,1);
    api.recordCombatDamage(context,damages);
    return {rows:api.mechanics(context.receipts),context,session,turn};
  }
  for(const actor of ['alice',npcId]) {
    const {rows}=await settle({actor});
    const source=actor==='alice'?'Alice':'The masked visitor',target=actor==='alice'?'The masked visitor':'Alice';
    const attack=rows.find(row=>row.combat_action==='attack'),die=rows.find(row=>row.kind==='dice'),hp=rows.find(row=>row.kind==='change');
    assert.equal(attack.actor_label,source);assert.equal(attack.target_label,target);
    assert.equal(die.actor_label,source);assert.equal(die.target_label,target);
    assert.equal(hp.subject_label,target);assert.equal(hp.source_label,source);assert.equal(hp.source_receipt,die.receipt);
    assert.equal(hp.before,100);assert.ok(hp.after<100);
    assert.ok(rows.every(row=>row.actor!==npcId&&row.subject!==npcId));
  }
  const miss=await settle({skill:1});assert.equal(miss.rows.some(row=>row.kind==='dice'||row.kind==='change'),false);
  const counter=await settle({skill:1,defense:'fight_back'});
  assert.equal(counter.rows.find(row=>row.combat_action==='defense').actor_label,'The masked visitor');
  assert.equal(counter.rows.find(row=>row.kind==='dice').target_label,'Alice');
  assert.equal(counter.rows.find(row=>row.kind==='change').source_label,'The masked visitor');
  const burst=await settle({shots:3}),changes=burst.rows.filter(row=>row.kind==='change');
  assert.ok(changes.length>=2);
  assert.equal(new Set(changes.map(row=>row.source_receipt)).size,changes.length);
  for(let i=1;i<changes.length;i++)assert.equal(changes[i].before,changes[i-1].after);
  const cover=await settle({actor:npcId,firearm:true,defense:'dive_for_cover'});
  assert.ok(cover.turn.cover_reroll_roll_id,'the real engine took the successful dive branch');
  const rerollReceipt=cover.context.receipts.find(row=>row.engine_roll_id===cover.turn.cover_reroll_roll_id);
  const reroll=cover.rows.find(row=>row.receipt===rerollReceipt.id);
  assert.equal(reroll.public_combat,true);assert.equal(reroll.combat_action,'attack');
  assert.equal(reroll.actor_label,'The masked visitor');assert.equal(reroll.target_label,'Alice');
  const hidden=await settle({actor:npcId,named:false});
  assert.equal(hidden.rows.find(row=>row.combat_action==='attack').actor_label,undefined);
  assert.ok(!JSON.stringify(hidden.rows).includes(graph.displayName(npc)));
  hidden.context.addRoll({actor:npcId,skill:'Listen',target:60,threshold:60,roll:30,level:'regular',passed:true});
  assert.equal(api.mechanics(hidden.context.receipts).at(-1).actor_label,undefined,'noncombat NPC remains anonymous');
  const hiddenCombat={...counter.context.receipts.find(row=>row.combat_action==='defense'),visibility:'concealed'};
  assert.equal(api.mechanics([hiddenCombat])[0].target_label,undefined);
});

test('executeCombatResolve declares then defends, emits HP exactly once and mirrors the real damage',async()=>{
  const npcId=graph.handle(npc);
  for(const {actor,destroy} of [{actor:'alice',destroy:false},{actor:npcId,destroy:false},{actor:'alice',destroy:true}]) {
    const kernel=await api.createKernelContext({workspace:temporary,content:CONTENT,seed:'combat-cards'});
    const tables=new api.RuleTables(kernel),session=await api.CombatSession.create('execute-cards','scene/test',1,kernel.rng,tables);
    for(const id of ['alice',npcId])session.addParticipant(id,id==='alice'?'investigator':'npc',{
      dex:id===actor?80:50,combatSkill:99,build:0,hpMax:100,weapons:[{weapon_id:'unarmed'}]});
    session.beginRound();
    const target=actor==='alice'?npcId:'alice',jsonFiles=new Map();
    const localParty=[{...structuredClone(party[0]),current_hp:100,derived:{HP:100}}];
    const world={active_scene:sceneHandle,clock:{minutes:0},npc_resources:{[npcId]:{current_hp:100}},person_labels:{[npcId]:{name:'The masked visitor'}}};
    const campaign={id:'execute-cards',readSave:async name=>jsonFiles.get(join('save',name))??null,
      writeSave:async(name,value)=>jsonFiles.set(join('save',name),structuredClone(value)),writeSheet:async()=>{},writeWorld:async()=>{}};
    const snapshot={party:localParty,jsonFiles,records:[],saved:name=>jsonFiles.get(join('save',name))??null,sanity:()=>null};
    const context=new api.SettleContext(kernel,{campaign,world,turn:{turn:1,receipts:[]}},snapshot,{graph},tables,session.arithmetic,{},'t1-c1',1,localParty[0],localParty[0],{});
    if(destroy)jsonFiles.set(join('save','combat-operation.json'),{operation:{investigator_weapon_id:'unarmed',rulebook_exception:'own_dagger_ignores_spells',on_success:{kind:'destroy_target',outcome:'investigators_win',rule_ref:'test.destroy'}}});
    await session.save(context);
    const declared=await api.executeCombatResolve(context,{action_kind:'attack',actor_id:actor,target_npc_id:target,weapon_id:'unarmed'});
    assert.equal(declared.data.pending_attack.target_actor_id,target);
    assert.equal(context.receipts.some(row=>row.kind==='roll'||row.resource==='hp'),false);
    const settled=await api.executeCombatResolve(context,{action_kind:'defend',actor_id:target,defense_kind:'none'});
    assert.equal(settled.data.pending_attack,null);
    const saved=await context.readSave('combat.json'),damage=saved.damage_chain;
    const hp=context.receipts.filter(row=>row.kind==='delta'&&row.resource==='hp');
    assert.equal(damage.length,1);assert.equal(hp.length,damage.length+Number(destroy),'only destroy_target adds a terminal HP delta');
    assert.equal(hp[0].before,damage[0].hp_before);assert.equal(hp[0].after,damage[0].hp_after);
    if(destroy){assert.equal(hp[1].before,hp[0].after);assert.equal(hp[1].after,0);}
    const die=context.receipts.find(row=>row.id===hp[0].source_receipt);
    assert.equal(die.form,'dice');assert.equal(die.actor,actor);
    const rows=api.mechanics(context.receipts),changes=rows.filter(row=>row.kind==='change'&&row.resource==='hp');
    for(const change of changes){
      assert.equal(change.subject_label,target==='alice'?'Alice':'The masked visitor');
      assert.equal(change.source_label,actor==='alice'?'Alice':'The masked visitor');
      assert.equal(change.source_receipt,die.id);
    }
    assert.deepEqual(context.effects.filter(effect=>effect.kind==='hp'),hp.map(({before,after})=>({kind:'hp',subject:target,before,after})));
    assert.equal(hp.at(-1).subject_label,context.subjectLabel(target),'Keeper receipt keeps its established label');
    assert.equal(target==='alice'?localParty[0].current_hp:world.npc_resources[npcId].current_hp,destroy?0:damage[0].hp_after);
  }
});

test('capsule budget cuts match Python for nested lists, Unicode and module rosters',async t=>{
  const cases=[
    {label:'recent drops oldest',section:[1,2,3].map(turn=>({turn,text:'A scene detail '.repeat(10)})),budget:230,drop:'oldest'},
    {label:'ranked memory drops last',section:[1,2,3].map(turn=>({turn,text:'Retained thought '.repeat(10)})),budget:240,drop:'last'},
    {label:'inner facts trim before outer NPC',section:[{name:'Alice',facts:['long fact '.repeat(20),'another fact '.repeat(20)]},{name:'Bob',facts:['short']}],budget:150,drop:'last'},
    {label:'single Unicode row remains present',section:[{name:'Witness',text:'\u{1f680}'.repeat(300)}],budget:80,drop:'oldest'},
    {label:'scalar dictionary has no removable row',section:{summary:'fixed'.repeat(40)},budget:30,drop:'last'},
  ];
  await rows(t,cases,oracle('budget',{cases}),c=>{const section=clone(c.section);return {section,cut:api.fitBudget(section,c.budget,c.drop)};});
  const budgets=[2048,900,400,120],expected=oracle('module_budget',{budgets});
  for(const [index,budget] of budgets.entries())await t.test(`module budget ${budget}`,()=>same(api.fittedModuleSection(graph,budget),expected[index],`module ${budget}`));
});

test('saved session views match Python without constructing engine writers',async t=>{
  const home=join(temporary,'sessions');await mkdir(home);
  const context=await api.createKernelContext({workspace:home,content:CONTENT,seed:'read-fixture'});
  const combat={status:'active',current_round:2,initiative_cursor:0,current_initiative:[{actor_id:'alice'}],participants:[{actor_id:'alice',side:'investigator',hp_current:8,hp_max:12,conditions:[],weapons:['pistol']},{actor_id:graph.handle(npc),side:'npc',hp_current:9,hp_max:9,conditions:[]}],weapon_catalog:{pistol:{magazine:6}}};
  const chase={status:'active',current_round:1,initiative_cursor:0,rounds:[{dex_order:['alice']}],participants:[{actor_id:'alice',side:'pursuer',hp:8,position:0,movement_actions:2,movement_actions_remaining:0,mov_adjusted:8},{actor_id:graph.handle(npc),side:'quarry',hp:9,position:1,mov_adjusted:8}],location_chain:[{index:0,label:'Street'},{index:1,label:'Gate'},{index:2,label:'End'}]};
  const sanity={bout_active:true,current_hp:8,san_current:40,temporary_insane:true,indefinite_insane:false,permanently_insane:false,bout_rounds_remaining:3,active_bout_id:'bout-one',bouts_of_madness:[{bout_id:'bout-one',duration_rounds:5,bout_result:'flight',bout_kind:'realtime',mode:'realtime'}],active_delusion:{},recovery_trigger:{due_elapsed_minutes:60}};
  const cases=[
    {label:'combat pending firearm defense',saves:{'combat.json':{...combat,pending_attack:{actor_id:graph.handle(npc),target_actor_id:'alice',resolution_hint:'firearm_attack',allowed_defenses:['dive_for_cover','fight_back']}}}},
    {label:'active chase exhausted movement',saves:{'chase.json':chase}},
    {label:'chase positional conflict',saves:{'chase.json':{...chase,participants:chase.participants.map(p=>({...p,position:0}))}}},
    {label:'canonical sanity snapshot path',saves:{'sanity-state/alice.json':sanity,'sanity-gain-pending/alice.json':{san_gain:2}}},
    {label:'combat priority over concurrent bout',saves:{'combat.json':combat,'sanity-state/alice.json':sanity}},
  ];
  const retained=new Map();
  for(const [index,c] of cases.entries()) {
    c.id=`case-${index}`;c.directory=join(home,'.coc/campaigns',c.id);c.party=party;c.world=world;c.minutes=60;
    for(const [name,value] of Object.entries({...c.saves,'../party/alice.json':party[0]})){
      const path=join(c.directory,'save',name),bytes=api.pythonJsonDumps(value);await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes);retained.set(path,bytes);
    }
  }
  const expected=oracle('sessions',{cases});
  await rows(t,cases,expected,async c=>{
    const saved=new api.CampaignSnapshot(context,c.id);await saved.preload();const view=new api.SessionView(saved,graph,party,world);
    return {active:view.activeSession(),pending:view.pendingChoice(),combat:view.combatView(),chase:view.chaseView(),facts:view.facts('alice',60)};
  });
  for(const [path,bytes] of retained)assert.equal(await readFile(path,'utf8'),bytes,path);
});

test('NPC dossiers and public object views preserve their different secrecy boundaries',async t=>{
  const doctor=graph.nodes.get('npc-east-doctor'),ledger={[doctor.node_id]:{stance:{value:'friendly',because:[{how:'keeper',turn:2,stance:'friendly',why:'Helped at the gate'}]},turns_present:{count:3,last:4},promises:[{memory_id:'promise-one',turn:2}]}},memories=[{id:'promise-one',statement:'Return the borrowed key.',status:'candidate'}];
  const expected=oracle('npc',{node:doctor.node_id,scene:sceneId,world,ledger,memories,sheet:party[0]});
  // The frozen oracle predates §103's opening-turn reminder. Assert that new TS behavior directly,
  // then compare only the unchanged dossier fields; never rewrite the historical oracle.
  const dossier = value => {
    assert.ok(value.untold);
    assert.equal(value.untold.label, undefined);
    assert.match(value.untold.use, /apply person/);
    // §11.5.2 (SL-07) gave the Keeper's card of one person its standing defence; the oracle predates it. This doctor
    // has no numbers, so the rule has nothing to compare and the card names no word.
    if (Object.hasOwn(value, 'combat_tactic')) assert.deepEqual(value.combat_tactic, {defense: null, basis: 'rule-default'});
    // §11.5.3 (SL-08) added the card's disposition and standing action; without the disposition table (this call passes
    // none) the card states no inference input, and without an override or an authored word it names no action.
    if (Object.hasOwn(value, 'combat_disposition')) assert.deepEqual(value.combat_disposition, {disposition: null, basis: null});
    if (Object.hasOwn(value, 'combat_standing')) assert.deepEqual(value.combat_standing, {action: null, basis: 'rule-default'});
    const {untold, combat_tactic, combat_disposition, combat_standing, ...legacy} = value;
    if (legacy.history?.promises) legacy.history = {...legacy.history, promises: legacy.history.promises.map(promise => {
      assert.equal(promise.authority, 'conversation_report', 'Current promise projections preserve their conversational authority');
      const {authority, ...historical} = promise;
      return historical;
    })};
    return legacy;
  };
  same({entry:dossier(api.npcEntry(graph,world,doctor,ledger,new Map(memories.map(m=>[m.id,m])))),view:dossier(api.npcView(graph,world,doctor,ledger)),
    present:api.presentSection(graph,world,scene,ledger,memories).map(dossier),investigator:api.investigatorView(party[0])},expected,'NPC/public investigator projections');
  const definitions={case:{id:'case',name:'Case',category:'item',description:'Private compartment',basis:'Source',parameters:{},traits:[],player_view:{description:'A leather case',fields:[]}},
    paper:{id:'paper',name:'Letter',category:'item',description:'Hidden source provenance',basis:'Source',parameters:{},traits:[],player_view:{description:'A folded letter',fields:[]}},
    pistol:{id:'pistol',name:'Pistol',category:'weapon',description:'Secret tuning',basis:'Source',parameters:{damage:'1D10',magazine:6,hidden_modifier:9},traits:[{name:'visible'},{name:'secret'}],player_view:{description:'A pistol',fields:['damage','magazine'],traits:['visible']}}};
  const carried={kind:'investigator',id:'alice',name:'Alice'},instances={case:{id:'case-one',name:'Case',definition:'case',owner:carried,quantity:1,state:{condition:'intact'}},
    letter:{id:'letter-one',name:'Letter',definition:'paper',owner:{kind:'object',id:'case-one',name:'Case'},quantity:1,state:{condition:'intact'},document:{text:'Edited note',original:'Original note',presentation:'paper'}},
    pistol:{id:'pistol-one',name:'Pistol',definition:'pistol',owner:carried,quantity:1,state:{condition:'intact',ammo:4}},
    hidden:{id:'hidden-one',name:'Other letter',definition:'paper',owner:{kind:'npc',id:'east-doctor',name:'Doctor east'},quantity:1,state:{condition:'intact'},document:{text:'NPC secret',original:'NPC secret',presentation:'paper'}}};
  // Instance dictionaries are keyed by canonical object ids, as persisted by the kernel.
  const objectWorld={objects:{definitions,instances:Object.fromEntries(Object.values(instances).map(item=>[item.id,item]))}};
  const sheet={...party[0],weapons:[{name:'Pistol',object_id:'pistol-one',weapon_id:'pistol-one',hidden_modifier:9,ammo:6}]},names=[null,'Letter','Pistol','missing'];
  const before=api.pythonJsonDumps({objectWorld,sheet}),reference=oracle('objects',{world:objectWorld,sheet,names});
  await rows(t,[{label:'public sheet'},...names.map(name=>({label:`object look ${name}`}))],reference,(_c,index)=>captured(()=>index===0?api.publicSheet(objectWorld,sheet):api.objectLook(objectWorld,names[index-1])));
  assert.equal(api.pythonJsonDumps({objectWorld,sheet}),before);
});
