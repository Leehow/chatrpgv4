import {pythonOracleEnvironment} from "../python-oracle.mjs";
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import test from 'node:test';
import {build} from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const reference = String.raw`
import copy, json, sys
from coc.mods.objects import validate_definition
from coc.mods.documents import validate_seed
from coc.fileio import canonical_json
from coc.errors import RpcError
weapon = {'name':'Fixture weapon','category':'weapon','description':'A fixture.','basis':'An existing profile.',
 'parameters':{'skill':'Firearms (Rifle/Shotgun)','damage':'1d6+1','uses_per_round':1,'magazine':1,'impale':False,'base_range_yards':30.5},
 'player_view':{'description':'A fixture weapon.','fields':['damage','magazine']}}
spell = {'name':'Fixture spell','category':'spell','description':'A fixture.','basis':'An existing profile.',
 'parameters':{'cost_mp':'1d2','cost_sanity':0,'casting_time':'one round','effects':[{'kind':'hp','direction':'gain','amount':'1d3'}]},
 'player_view':{'description':'A fixture spell.','fields':['cost_mp']}}
item = {'name':'Fixture item','category':'item','description':'A fixture.','basis':'An existing profile.',
 'parameters':{'charges':None,'effects':[]},'player_view':{'description':'A fixture item.','fields':[]}}
cases = []
def add(label, value, options=None, kind='definition'):
 cases.append((label,value,options or {},kind))
def parameter(label, template, key, value):
 draft=copy.deepcopy(template); draft['parameters'][key]=value; add(label,draft)
for label, template in [('weapon',weapon),('spell',spell),('item',item)]: add(label,template)
for value in [None,[],1,True,'definition']: add('not-object-'+str(value),value)
add('unsupported',{'error':True,'reason':'Needs more capability','required':['future.v1']})
add('unsupported-null',{'error':True,'required':None})
for key in ['name','description','basis']:
 for value in ['',None,3,'x'*8001]: add('text-'+key+'-'+str(type(value)),{**weapon,key:value})
add('name-boundary',{**weapon,'name':'x'*120}); add('name-over',{**weapon,'name':'x'*121})
add('identity-name',weapon,{'name':'different'}); add('identity-category',weapon,{'category':'spell'})
add('category-list',{**weapon,'category':[]}); add('unknown-field',{**weapon,'private':True})
for key, values in {'damage':[0,-1,0.5,True,'100D10000','101D6','1D10001','1D0','0D1','0-1','1D6'*30],
 'uses_per_round':[0,1.0,True,100,101], 'malfunction':[None,0,100,101,True], 'base_range_yards':[None,-1,0.5,100000,100001,True,float('nan')],
 'magazine':[None,0,1000,1001,1.0], 'initial_ammo':[-1,0,1,2,True], 'impale':[None,1,True], 'adds_damage_bonus':[None,False,1],
 'reload_rounds':[0,1,100,101,1.0]}.items():
 for value in values: parameter(key+'-'+str(value),weapon,key,value)
for field in ['cost_mp','cost_sanity','cost_pow']:
 for value in [0,10000,10001,True,'1D3-1','1D3-2','1D3-1D3','0D1','0-1']:
  parameter(field+'-'+str(value),spell,field,value)
for value in [None,-1,0,10000,10001,1.0,True]: parameter('charges-'+str(value),item,'charges',value)
for value in [None,{},[{}],[{'kind':'condition','value':''}],[{'kind':'hp','direction':'gain','amount':'0-1'}],[{'kind':[],'value':'x'}],[{'kind':'condition','value':'asleep'}]]:
 parameter('effects-'+str(value),item,'effects',value)
for traits in [None,[],[{'name':'weight','value':1.0,'unit':'kg','basis':'fixture'}],[{'name':'weight','value':float('nan')}],
 [{'name':'weight','value':float('inf')}],[{'name':'weight','value':{}}],[{'name':'x','value':1},{'name':'x','value':2}],
 [{'name':'x','value':1,'unit':'a'*1025}],[{'name':str(i),'value':i} for i in range(17)]]:
 add('traits-'+str(len(traits) if isinstance(traits,list) else traits),{**weapon,'traits':traits})
for document in [{'text':'','presentation':'paper'},{'text':chr(0x1f3b2)*64000,'presentation':'notebook'},
 {'text':'a'*64001,'presentation':'paper'},{'handout':'x'*160,'presentation':'book'},{'handout':'x'*161,'presentation':'book'},
 {'text':'x','handout':'y','presentation':'paper'},{'text':'x','presentation':[]},None]:
 add('document-'+str(type(document)),document,kind='document')
 add('carrier-'+str(type(document)),{**item,'document':document})
add('spell-carrier',{**spell,'document':{'text':'x','presentation':'paper'}})
for public in [None,{}, {'description':'','fields':['unknown']},{'description':'','fields':[],'traits':['missing']}]:
 add('public-'+str(public),{**weapon,'player_view':public})
output=[]
for label,value,options,kind in cases:
 source=json.dumps(value,ensure_ascii=True); before=canonical_json(value)
 try: expected={'result':canonical_json(validate_seed(value) if kind=='document' else validate_definition(value,**options))}
 except RpcError as exc: expected={'error':exc.to_json()}
 except Exception as exc: expected={'exception':{'name':type(exc).__name__,'message':str(exc)}}
 assert canonical_json(value)==before
 output.append({'label':label,'source':source,'kind':kind,'options':options,**expected})
print(json.dumps(output,ensure_ascii=True))
`;

test('shared definition and bounded document validation matches Python without mutating input', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'pi-coc-mod-definition-'));
  try {
    await build({stdin:{contents:["export * from './kernel-ts/mods/definition.ts';","export {parsePythonJson,canonicalJson} from './kernel-ts/json.ts';"].join('\n'),resolveDir:ROOT,sourcefile:'mod-definition-test.ts'},
      outfile:join(temporary,'api.mjs'),bundle:true,format:'esm',platform:'node',target:'node22',logLevel:'silent'});
    const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);
    const run = spawnSync('uv', ['run','--frozen','python','-c',reference], {cwd:ROOT,env:pythonOracleEnvironment(),encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024});
    assert.equal(run.error,undefined); assert.equal(run.status,0,run.stderr);
    const digest = value => createHash('sha256').update(value).digest('hex');
    for (const expected of JSON.parse(run.stdout)) {
      const value = api.parsePythonJson(expected.source), before = api.canonicalJson(value);
      let actual;
      try { actual = {result:api.canonicalJson(expected.kind==='document' ? api.validateDocumentSeed(value) : api.validateDefinition(value,expected.options))}; }
      catch (error) { actual = typeof error.toJson==='function' ? {error:error.toJson()} : {exception:{name:error.name,message:error.message}}; }
      const {label,source,kind,options,...outcome} = expected;
      if ('result' in outcome && 'result' in actual) assert.equal(digest(actual.result),digest(outcome.result),label);
      else assert.deepEqual(actual,outcome,label);
      assert.equal(api.canonicalJson(value),before,label+' input mutation');
    }
  } finally { await rm(temporary,{recursive:true,force:true}); }
});
