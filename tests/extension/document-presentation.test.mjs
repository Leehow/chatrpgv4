import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {presentDocument,documentPresentationStatus,validateDocumentReading} from '../../extensions/mods/document-presentation.ts';

test('reading cache preserves source, edits and reset across languages and changed source', async()=>{
  const home=await mkdtemp(join(tmpdir(),'paper-reading-'));
  const requests=[];
  const runner=async request=>{
    const input=JSON.parse(await readFile(join(request.cwd,'request.json'),'utf8'));requests.push(input);
    await writeFile(join(request.cwd,'result.json'),JSON.stringify({
      title:input.play_language==='zh-Hans'?'委托纸条':input.title,
      text:input.text===''?'':input.play_language==='zh-Hans'?'每天 $20。\n—— Knott':input.text}));
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
      await writeFile(join(request.cwd,'result.json'),JSON.stringify({title:'Second owner reading',text:'Independent completed text'}));
      finish(true);
    }});
    request.signal.addEventListener('abort',cancel,{once:true});
    if(request.signal.aborted)cancel();
  });
  const firstOptions={home,owner:{},runner,signal:firstController.signal};
  const secondOptions={home,owner:{},runner,signal:secondController.signal};
  const source={name:'Shared slip',text:'Same source',original:'Same source',version:'one',play_language:'en'};
  const waitFor=async read=>{
    for(let round=0;round<200;round++){
      const result=read();if(result)return result;
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    assert.fail('Owned presentation did not reach its expected state');
  };
  const first=presentDocument(firstOptions,source).catch(error=>error);
  const second=presentDocument(secondOptions,source).catch(error=>error);
  try {
    assert.deepEqual(documentPresentationStatus({...firstOptions},source),{pending:true});
    assert.deepEqual(documentPresentationStatus({...firstOptions},source),{pending:true});
    assert.deepEqual(documentPresentationStatus({...secondOptions},source),{pending:true});
    await waitFor(()=>jobs.size===2);
    assert.equal(calls,2);
    firstController.abort();
    assert.match((await first).message,/could not be prepared/);
    const failure=await waitFor(()=>{
      try{documentPresentationStatus({...firstOptions},source);}catch(error){return error;}
    });
    assert.match(failure.message,/could not be prepared/);
    assert.deepEqual(documentPresentationStatus({...secondOptions},source),{pending:true});
    await jobs.get(secondController.signal).complete();
    const result=await second;
    assert.equal(result.text,'Independent completed text');
    const view=await waitFor(()=>{
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
});
