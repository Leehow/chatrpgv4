import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {presentDocument,documentPresentationStatus,validateDocumentReading,validateDocumentReference} from '../../extensions/mods/document-presentation.ts';
import {DOCUMENT_PRESENTATION_REFERENCE_PROTOCOL} from '../../runtime/jev/presentation-references.ts';
import {waitFor} from './wait.mjs';

const part=(packet,name)=>packet.sources.find(source=>source.alias===packet.parts[name]);
const operation=(source,value)=>value===source.text?{source:source.alias,action:'keep'}:{source:source.alias,action:'translate',text:value};
const readingArtifact=(packet,{title=part(packet,'title').text,text=part(packet,'text').text}={})=>({
  protocol:DOCUMENT_PRESENTATION_REFERENCE_PROTOCOL,
  texts:[operation(part(packet,'title'),title),operation(part(packet,'text'),text)],
});

test('reading cache preserves source, edits and reset across languages and changed source', async()=>{
  const home=await mkdtemp(join(tmpdir(),'paper-reading-'));
  const requests=[];
  const runner=async request=>{
    const input=JSON.parse(await readFile(join(request.cwd,'request.json'),'utf8'));requests.push(input);
    await writeFile(join(request.cwd,'result.json'),JSON.stringify(readingArtifact(input,{
      title:input.play_language==='zh-Hans'?'委托纸条':part(input,'title').text,
      text:part(input,'text').text===''?'':input.play_language==='zh-Hans'?'每天 $20。\n—— Knott':part(input,'text').text})));
    return {ok:true,code:0,timedOut:false,ms:1,stderr:'',command:[]};
  };
  const source={name:"Knott's slip",text:'$20 per day.\n— Knott',original:'$20 per day.\n— Knott',
    version:'one',player_edited:false,play_language:'zh-Hans'};
  const before=structuredClone(source);
  try {
    const first=await presentDocument({home,runner},source);
    assert.equal(first.text,'每天 $20。\n—— Knott');assert.equal(first.original,first.text);
    assert.equal(first.display_name,'委托纸条');assert.equal(first.name,source.name);
    assert.deepEqual(source,before);assert.equal(requests.length,1);
    const edited=await presentDocument({home,runner},{...source,text:'My English annotation',player_edited:true,version:'two'});
    assert.equal(edited.text,'My English annotation');assert.equal(edited.original,first.original);
    assert.equal(requests.length,1);
    assert.equal((await presentDocument({home,runner},{...source,version:'reset'})).text,first.text);
    assert.equal(requests.length,1);
    assert.equal((await presentDocument({home,runner},{...source,play_language:'en'})).text,source.text);
    assert.equal(requests.length,2);
    const blank=await presentDocument({home,runner},{...source,text:'',original:''});
    assert.equal(blank.text,'');assert.equal(blank.original,'');assert.equal(requests.length,3);
    await presentDocument({home,runner},{...source,text:'Changed NPC text'});
    assert.equal(requests.length,4);
  } finally {await rm(home,{recursive:true,force:true});}
});

test('title and body keep selections remain separate and preserve exact bytes',async t=>{
  const home=await mkdtemp(join(tmpdir(),'paper-reference-'));t.after(()=>rm(home,{recursive:true,force:true}));
  const exact='Same\r\nbytes 😀';let rawArtifact;
  const source={name:exact,text:exact,original:exact,version:'one',player_edited:false,play_language:'en'};
  const result=await presentDocument({home,runner:async request=>{
    const packet=JSON.parse(await readFile(join(request.cwd,'request.json'),'utf8'));
    assert.equal(packet.protocol,DOCUMENT_PRESENTATION_REFERENCE_PROTOCOL);
    assert.deepEqual(packet.parts,{title:'text:0',text:'text:1'});
    assert.deepEqual(packet.sources,[{alias:'text:0',text:exact},{alias:'text:1',text:exact}]);
    rawArtifact=readingArtifact(packet);
    assert.ok(!JSON.stringify(rawArtifact).includes(exact));
    await writeFile(join(request.cwd,'result.json'),JSON.stringify(rawArtifact));
    return {ok:true,code:0,timedOut:false,ms:1,stderr:'',command:[]};
  }},source);
  assert.equal(result.display_name,exact);assert.equal(result.text,exact);assert.equal(result.original,exact);
  assert.deepEqual(rawArtifact.texts,[{source:'text:0',action:'keep'},{source:'text:1',action:'keep'}]);
});

test('pending polls reuse work and surface a preparation failure for retry',async()=>{
  const home=await mkdtemp(join(tmpdir(),'paper-poll-'));
  let calls=0;
  const runner=async()=>{calls++;return{ok:false,code:1,timedOut:false,ms:1,stderr:'',command:[]};};
  const source={name:'Slip',text:'Hello',original:'Hello',version:'one',play_language:'en'};
  try {
    assert.deepEqual(documentPresentationStatus({home,runner},source),{pending:true});
    assert.deepEqual(documentPresentationStatus({home,runner},source),{pending:true});
    let failure;
    for(let round=0;round<100;round++){
      await new Promise(resolve=>setTimeout(resolve,5));
      try{documentPresentationStatus({home,runner},source);}catch(error){failure=error;break;}
    }
    assert.match(failure?.message||'',/could not be prepared/);assert.equal(calls,1);
  } finally {await rm(home,{recursive:true,force:true});}
});

test('separate owners isolate pending work and poll failures while retaining accepted disk reuse',async()=>{
  const home=await mkdtemp(join(tmpdir(),'paper-owners-'));
  const firstController=new AbortController(),secondController=new AbortController();
  const jobs=new Map();
  let calls=0;
  const runner=request=>new Promise(resolve=>{
    calls++;
    let settled=false;
    const finish=ok=>{
      if(settled)return;
      settled=true;request.signal.removeEventListener('abort',cancel);
      resolve({ok,code:ok?0:1,timedOut:false,ms:1,stderr:'',command:[]});
    };
    const cancel=()=>finish(false);
    jobs.set(request.signal,{async complete(){
      const packet=JSON.parse(await readFile(join(request.cwd,'request.json'),'utf8'));
      await writeFile(join(request.cwd,'result.json'),JSON.stringify(readingArtifact(packet,{title:'Second owner reading',text:'Independent completed text'})));
      finish(true);
    }});
    request.signal.addEventListener('abort',cancel,{once:true});
    if(request.signal.aborted)cancel();
  });
  const firstOptions={home,owner:{},runner,signal:firstController.signal};
  const secondOptions={home,owner:{},runner,signal:secondController.signal};
  const source={name:'Shared slip',text:'Same source',original:'Same source',version:'one',play_language:'en'};
  // A wall-clock deadline from the suite's one wait vocabulary, not 200 rounds of 5ms: under
  // whole-suite load a second is not long, and a short budget turns a slow box into a red test.
  const reach=(read,label)=>waitFor(read,{label:`the owned presentation to ${label}`});
  const first=presentDocument(firstOptions,source).catch(error=>error);
  const second=presentDocument(secondOptions,source).catch(error=>error);
  try {
    assert.deepEqual(documentPresentationStatus({...firstOptions},source),{pending:true});
    assert.deepEqual(documentPresentationStatus({...firstOptions},source),{pending:true});
    assert.deepEqual(documentPresentationStatus({...secondOptions},source),{pending:true});
    await reach(()=>jobs.size===2,'start both jobs');
    assert.equal(calls,2);
    firstController.abort();
    assert.match((await first).message,/could not be prepared/);
    const failure=await reach(()=>{
      try{documentPresentationStatus({...firstOptions},source);}catch(error){return error;}
    });
    assert.match(failure.message,/could not be prepared/);
    assert.deepEqual(documentPresentationStatus({...secondOptions},source),{pending:true});
    await jobs.get(secondController.signal).complete();
    const result=await second;
    assert.equal(result.text,'Independent completed text');
    const view=await reach(()=>{
      const value=documentPresentationStatus({...secondOptions},source);return !value.pending&&value;
    });
    assert.equal(view.display_name,'Second owner reading');
    assert.equal(view.text,result.text);
    const cached=await presentDocument({home,owner:{},runner:async()=>{throw new Error('Accepted disk cache should be reused');}},source);
    assert.equal(cached.text,result.text);
    assert.equal(calls,2);
    assert.equal(source.text,'Same source');
  } finally {
    firstController.abort();secondController.abort();
    await Promise.all([first,second]);
    await rm(home,{recursive:true,force:true});
  }
});

test('the artifact gate rejects invented blank-paper writing and oversized text',()=>{
  assert.throws(()=>validateDocumentReading({title:'Paper',text:'Invented letter'},{text:''}));
  assert.throws(()=>validateDocumentReading({title:'Paper',text:'x'.repeat(64001)},{text:'source'}));
  assert.throws(()=>validateDocumentReading({title:'Paper',text:''},{text:'source'}));
  const request={protocol:DOCUMENT_PRESENTATION_REFERENCE_PROTOCOL,play_language:'en',
    sources:[{alias:'text:0',text:'Paper'},{alias:'text:1',text:''}],parts:{title:'text:0',text:'text:1'}};
  assert.doesNotThrow(()=>validateDocumentReference(readingArtifact(request),request));
  assert.throws(()=>validateDocumentReference({protocol:DOCUMENT_PRESENTATION_REFERENCE_PROTOCOL,
    texts:[{source:'text:0',action:'keep'},{source:'text:99',action:'keep'}]},request));
});

const OK={ok:true,code:0,timedOut:false,ms:1,stderr:'',command:[]};
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const documentSource={name:'Slip',text:'Source text',original:'Source text',version:'one',player_edited:false,play_language:'en'};
const validReading={title:'Projected title',text:'Projected text'};
async function documentFixture(t) {
 const home=await mkdtemp(join(tmpdir(),'document-attempt-'));
 t.after(()=>rm(home,{recursive:true,force:true}));
 const instructions=await readFile(new URL('../../extensions/mods/document-presentation.md',import.meta.url),'utf8');
 const source={title:documentSource.name,text:documentSource.original,play_language:documentSource.play_language};
 const request={protocol:DOCUMENT_PRESENTATION_REFERENCE_PROTOCOL,play_language:source.play_language,
  sources:[{alias:'text:0',text:source.title},{alias:'text:1',text:source.text}],parts:{title:'text:0',text:'text:1'}};
 const fingerprint=createHash('sha256').update(JSON.stringify([source,instructions])).digest('hex');
 const directory=join(home,'.coc/document-presentations',fingerprint);
 return {options:{home,owner:{}},request,instructions,directory,accepted:join(directory,'accepted.json')};
}

for(const broken of ['malformed','invalid','missing'])for(const repaired of [false,true])
 test(`document ${broken} output uses whole-result repair (repaired=${repaired})`,async t=>{
 const {options,request:packet,directory,accepted}=await documentFixture(t);
 const controller=new AbortController();let calls=0,attempt;
 const task=presentDocument({...options,model:'owner/document',thinking:'medium',signal:controller.signal,runner:async request=>{
  calls++;attempt=request.cwd;
  assert.ok(attempt.startsWith(join(directory,'attempts')+'/'));
  assert.equal(request.model,'owner/document');assert.equal(request.thinking,'medium');
  assert.strictEqual(request.signal,controller.signal);assert.equal(request.timeoutMs,120000);
  assert.equal(request.eventLog,join(attempt,`events-${calls}.jsonl`));
  assert.ok(request.systemPrompt.endsWith('extensions/mods/document-presentation.md'));
  assert.match(await readFile(join(attempt,'check.mjs'),'utf8'),/validateDocumentReference/);
  assert.deepEqual(await json(join(attempt,'request.json')),packet);
  await assert.rejects(readFile(accepted),{code:'ENOENT'});
  await writeFile(request.eventLog,`round ${calls}\n`);
  if(calls===2) {
   assert.match(request.brief,/Read findings.json and repair the retained result/);
   assert.deepEqual(await json(join(attempt,'run-1.json')),OK);
   assert.match((await json(join(attempt,'findings.json'))).error,
    broken==='malformed'?/SyntaxError/:broken==='missing'?/ENOENT/:/Invalid document reading/);
  }
  if(calls===2&&repaired)await writeFile(join(attempt,'result.json'),JSON.stringify(readingArtifact(packet,validReading)));
  else if(broken!=='missing')await writeFile(join(attempt,'result.json'),broken==='malformed'?'not JSON':JSON.stringify({...readingArtifact(packet,validReading),extra:'must reject the entire reading'}));
  return OK;
 }},documentSource);
 if(repaired) {
  assert.equal((await task).text,validReading.text);
  assert.deepEqual(await json(accepted),validReading);
  assert.equal((await presentDocument({home:options.home},documentSource)).display_name,validReading.title);
 } else {
  await assert.rejects(task,error=>{
   if(broken==='malformed')assert.ok(error instanceof SyntaxError);
   else assert.equal(error.code,broken==='missing'?'ENOENT':'preparation_failed');
   return true;
  });
  await assert.rejects(readFile(accepted),{code:'ENOENT'});
  // The same owner may start a fresh attempt after validation exhaustion.
  const retried=await presentDocument({...options,runner:async request=>{
   assert.notEqual(request.cwd,attempt);
   const packet=await json(join(request.cwd,'request.json'));
   await writeFile(join(request.cwd,'result.json'),JSON.stringify(readingArtifact(packet,validReading)));return OK;
  }},documentSource);
  assert.equal(retried.text,validReading.text);
 }
 assert.equal(calls,2);
 for(const round of [1,2]) {
  assert.deepEqual(await json(join(attempt,`run-${round}.json`)),OK);
  assert.equal(await readFile(join(attempt,`events-${round}.jsonl`),'utf8'),`round ${round}\n`);
 }
 assert.ok((await readdir(attempt)).includes('findings.json'),'repair evidence remains after acceptance');
 assert.equal((await readdir(directory)).filter(file=>file.endsWith('.tmp')).length,0);
});

for(const ending of ['provider','timeout','cancel-success','cancel-failure','throw'])
 test(`document ${ending} retains failure identity and clears owner pending work`,async t=>{
 const {options,accepted}=await documentFixture(t);
 const controller=new AbortController(),expected=new Error('owner runner threw');
 let attempt,calls=0;
 const outcome=ending==='cancel-success'?OK:{...OK,ok:false,code:1,timedOut:ending==='timeout',stderr:'Error: provider unavailable'};
 await assert.rejects(presentDocument({...options,signal:controller.signal,runner:async request=>{
  calls++;attempt=request.cwd;
  if(ending==='throw')throw expected;
  const packet=await json(join(attempt,'request.json'));
  await writeFile(join(attempt,'result.json'),JSON.stringify(readingArtifact(packet,validReading)));
  if(ending.startsWith('cancel'))controller.abort();
  return outcome;
 }},documentSource),error=>{
  if(ending==='throw')assert.strictEqual(error,expected);
  else {
   assert.equal(error.code,ending.startsWith('cancel')?'presentation_timeout':'preparation_failed');
   if(ending.startsWith('cancel'))assert.equal(error.message,'Document reading could not be prepared');
   else assert.match(error.message,ending==='timeout'?/the run timed out/:/provider unavailable/);
  }
  return true;
 });
 assert.equal(calls,1);
 await assert.rejects(readFile(accepted),{code:'ENOENT'});
 await assert.rejects(readFile(join(attempt,'findings.json')),{code:'ENOENT'});
 if(ending==='throw')await assert.rejects(readFile(join(attempt,'run-1.json')),{code:'ENOENT'});
 else assert.deepEqual(await json(join(attempt,'run-1.json')),outcome);
 const result=await presentDocument({...options,runner:async request=>{
  calls++;assert.notEqual(request.cwd,attempt);
  const packet=await json(join(request.cwd,'request.json'));
  await writeFile(join(request.cwd,'result.json'),JSON.stringify(readingArtifact(packet,validReading)));return OK;
 }},documentSource);
 assert.equal(result.text,validReading.text);assert.equal(calls,2);
});

test('same-owner callers share a single in-flight reading and later owners reuse its fingerprint cache',async t=>{
 const {options,directory}=await documentFixture(t);
 let calls=0,started,release,checkedOwner;
 const running=new Promise(resolve=>{started=resolve;});
 const gate=new Promise(resolve=>{release=resolve;});
 const joined=new Promise(resolve=>{checkedOwner=resolve;});
 const runner=async request=>{
  calls++;started();await gate;
  const packet=await json(join(request.cwd,'request.json'));
  await writeFile(join(request.cwd,'result.json'),JSON.stringify(readingArtifact(packet,validReading)));return OK;
 };
 const first=presentDocument({...options,runner},documentSource);
 await running;
 const second=presentDocument({...options,runner,get owner(){checkedOwner();return options.owner;}},{...documentSource,version:'two'});
 // cacheFor is reached after the accepted-file miss; hold the first runner until then.
 await joined;
 assert.deepEqual(documentPresentationStatus({...options,runner},documentSource),{pending:true});
 release();
 const results=await Promise.all([first,second]);
 assert.equal(calls,1);assert.equal(results[0].text,results[1].text);
 assert.equal((await readdir(join(directory,'attempts'))).length,1);
 const cached=await presentDocument({home:options.home,owner:{},runner:async()=>assert.fail('accepted cache must bypass the runner')},documentSource);
 assert.equal(cached.text,validReading.text);
});

test('document fingerprints include instructions and reject invalid cache entries without changing source or edits',async t=>{
 const {options,instructions,directory,accepted}=await documentFixture(t);
 await mkdir(directory,{recursive:true});
 await writeFile(accepted,JSON.stringify({title:'Partial cached title'}));
 let calls=0;
 const runner=async request=>{
  calls++;const packet=await json(join(request.cwd,'request.json'));
  await writeFile(join(request.cwd,'result.json'),JSON.stringify(readingArtifact(packet,validReading)));return OK;
 };
 const source={...documentSource,text:'Player annotation',player_edited:true};
 const before=structuredClone(source);
 const first=await presentDocument({...options,runner},source);
 assert.equal(first.text,'Player annotation');assert.equal(first.original,validReading.text);
 assert.equal(calls,1);assert.deepEqual(source,before);
 assert.deepEqual(await json(accepted),validReading);
 const resourceRoot=join(options.home,'resources');
 const prompts=join(resourceRoot,'extensions/mods');await mkdir(prompts,{recursive:true});
 await writeFile(join(prompts,'document-presentation.md'),instructions+'\nUpdated instruction.\n');
 const changed=await presentDocument({...options,runner,resourceRoot},source);
 assert.equal(changed.text,'Player annotation');assert.equal(calls,2);
 assert.deepEqual(await presentDocument({...options,resourceRoot},source),changed);
 assert.equal((await readdir(join(options.home,'.coc/document-presentations'))).length,2);
});
