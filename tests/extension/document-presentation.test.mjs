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

test('the artifact gate rejects invented blank-paper writing and oversized text',()=>{
  assert.throws(()=>validateDocumentReading({title:'Paper',text:'Invented letter'},{text:''}));
  assert.throws(()=>validateDocumentReading({title:'Paper',text:'x'.repeat(64001)},{text:'source'}));
  assert.throws(()=>validateDocumentReading({title:'Paper',text:''},{text:'source'}));
});
