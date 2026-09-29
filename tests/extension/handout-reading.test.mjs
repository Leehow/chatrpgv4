/**
 * Reading a pictured handout in the player's language (contract §155).
 *
 * The child is a deterministic stand-in for the zero-tool Pi child: it is handed the same things the
 * real one is (`cwd` with the copied image, `@file` attachments, an empty tool allowlist, a brief) and
 * answers the way the real one does -- as a stream of assistant events through `request.onEvent`.
 * Nothing here decides a language: whether a picture "is already in the play language" is the
 * stand-in's `keep`, exactly as it is the model's in production.
 */
import assert from 'node:assert/strict';
import {after,before,test} from 'node:test';
import {createHash} from 'node:crypto';
import {cp,mkdir,mkdtemp,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {knownNames,parseReading,readHandout,validateReading} from '../../extensions/module/handout-reading.ts';

const repo=resolve(import.meta.dirname,'../..');
const PNG=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from('pretend pixels of a clipping')]);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const READING='translate\nGrave Robbers Strike Martin\'s Beach Again!\n\nBy our reporter Chen\n\nLast night the cemetery was dug over once more.\n\nThe sheriff urges residents to report suspicious persons […]';

let scratch;
before(async()=>{scratch=await mkdtemp(join(tmpdir(),'handout-reading-'));});
after(()=>rm(scratch,{recursive:true,force:true}));

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
/** The stand-in child. `say(tag)` is what it writes for a play language; deltas arrive `gap` ms apart. */
async function table(name,{bytes=PNG,say=()=>READING,gap=0,chunk=7}={}){
  const home=await mkdtemp(join(scratch,`${name}-`));
  const contentRoot=join(home,'content');
  await mkdir(join(contentRoot,'setup'),{recursive:true});
  await cp(join(repo,'content/setup/handout-reading.md'),join(contentRoot,'setup/handout-reading.md'));
  const path=join(home,'clipping.png');await writeFile(path,bytes);
  const calls=[];
  const runner=async request=>{
    const image=(await readdir(request.cwd)).find(file=>file.startsWith('image.'));
    const call={request,image,imageBytes:image?await readFile(join(request.cwd,image)):null,progressSeenBeforeEnd:0};
    calls.push(call);
    const reply=runner.reply(request);
    if(reply instanceof Error)return {ok:false,code:1,timedOut:false,ms:3,stderr:'Error: provider refused',command:[]};
    request.onEvent({type:'message_start',message:{role:'assistant'}});
    for(let at=0;at<reply.length;at+=chunk){
      request.onEvent({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:reply.slice(at,at+chunk)}});
      if(gap)await delay(gap);
      call.progressSeenBeforeEnd=runner.progress.length;
    }
    request.onEvent({type:'message_end',message:{role:'assistant',content:[{type:'text',text:reply}]}});
    return {ok:true,code:0,timedOut:false,ms:9,stderr:'',command:[],usage:{inputTokens:11,outputTokens:5,costUsd:0.002,actions:1,unknownCalls:0}};
  };
  runner.progress=[];
  runner.reply=request=>say((/Play language: (\S+)/.exec(request.brief)||[])[1]);
  const options=(over={})=>({home,contentRoot,campaign:'one',play_language:'en',image:{path,media_type:'image/png',sha256:sha(bytes)},
    vision:true,model:'table/vision',thinking:'low',runner,onProgress:partial=>runner.progress.push(partial),...over});
  return {home,contentRoot,path,calls,runner,options};
}

test('a reading is parsed as it grows: the verdict line, then the title, then the body',()=>{
  const seen=[];
  for(let end=0;end<=READING.length;end++){
    const parsed=parseReading(READING.slice(0,end),false);
    assert.equal(parsed.invalid,false,READING.slice(0,end));
    seen.push(parsed);
  }
  // Nothing is known until the verdict line has ended.
  assert.equal(seen[0].mode,undefined);assert.equal(parseReading('trans',false).mode,undefined);assert.equal(parseReading('translate',false).mode,undefined);
  assert.equal(parseReading('translate\n',false).mode,'translate');
  // The title fills before the body starts, and both only ever grow.
  assert.deepEqual(parseReading('translate\nGrave Rob',false),{mode:'translate',invalid:false,title:'Grave Rob',text:''});
  assert.equal(parseReading('translate\nGrave Robbers\n\nBy our rep',false).text,'By our rep');
  for(let index=1;index<seen.length;index++){
    assert.ok(seen[index].title.startsWith(seen[index-1].title)||seen[index-1].mode===undefined);
    assert.ok(seen[index].text.startsWith(seen[index-1].text));
  }
  const final=parseReading(READING,true);
  assert.equal(final.title,"Grave Robbers Strike Martin's Beach Again!");
  assert.ok(final.text.startsWith('By our reporter Chen\n\nLast night'));assert.ok(final.text.endsWith('suspicious persons […]'));
  assert.equal(parseReading('keep',true).mode,'keep');
  assert.equal(parseReading('  KEEP\r\n',true).mode,'keep');
  assert.equal(parseReading('Sure! Here is the translation',false).mode,undefined);
  assert.equal(parseReading('Sure!\nHere',false).invalid,true);
});

test('a finished reading is keep, or a translation with a title; anything else is refused with the reason',()=>{
  assert.deepEqual(validateReading('keep'),{keep:true,title:'',text:''});
  assert.deepEqual(validateReading(READING).keep,false);
  assert.deepEqual(validateReading('translate\nOnly a title'),{keep:false,title:'Only a title',text:''});
  assert.equal(validateReading('translate\nTitle\n\nBody with trailing space   \n\n').text,'Body with trailing space');
  for(const [bad,reason] of [['',/first line must be keep or translate/],['Here you go\ntranslate',/first line/],['translate',/needs a title/],['translate\n\n\n',/needs a title/],
    [`translate\n${'x'.repeat(641)}`,/title is longer/],[`translate\nT\n\n${'y'.repeat(64001)}`,/body is longer/]])
    assert.throws(()=>validateReading(bad),error=>error.code==='preparation_failed'&&reason.test(error.message),JSON.stringify(bad).slice(0,40));
});

test('the names the table already uses are its saved projections for this tag, capped',async()=>{
  const {home}=await table('names');
  const folder=join(home,'.coc/campaigns/one/setup/presentations');await mkdir(folder,{recursive:true});
  await writeFile(join(folder,'standing-en.json'),JSON.stringify({play_language:'en',texts:{'马丁滩':"Martin's Beach",'陈某':'','same':'same','警':'X'}}));
  await writeFile(join(folder,'clues-en.json'),JSON.stringify({play_language:'en',texts:{'守夜人':'the night watchman'}}));
  await writeFile(join(folder,'3-en.json'),JSON.stringify({play_language:'en',texts:{'公墓':'DRAFT-WORD'}}));
  await writeFile(join(folder,'journal-en.json'),JSON.stringify({play_language:'fr',texts:{'警长':'WRONG-LANGUAGE'}}));
  await writeFile(join(folder,'broken-en.json'),'{');
  assert.deepEqual(await knownNames(home,'one','en'),{'马丁滩':"Martin's Beach",'守夜人':'the night watchman'});
  assert.deepEqual(await knownNames(home,'../escape','en'),{});
  assert.deepEqual(await knownNames(home,'none-yet','en'),{});
  const many={};for(let index=0;index<400;index++)many[`name-${String(index).padStart(3,'0')}`]=`shown-${index}`;
  await writeFile(join(folder,'possessions-en.json'),JSON.stringify({play_language:'en',texts:many}));
  const capped=await knownNames(home,'one','en');
  assert.ok(Object.keys(capped).length<=150,'one request never carries more than 150 names');
});

test('the picture goes to a child with no tools as an attachment, on the table model, and the reading comes back',async()=>{
  const t=await table('shape');
  const reading=await readHandout(t.options());
  assert.deepEqual([reading.keep,reading.title],[false,"Grave Robbers Strike Martin's Beach Again!"]);
  assert.ok(reading.text.startsWith('By our reporter Chen'));assert.equal(reading.digest,sha(PNG));
  const [call]=t.calls,request=call.request;
  // A zero-tool child: an empty allowlist, the picture as `@image.png`, the table's model, the lane's effort.
  assert.equal(request.tools,'');assert.deepEqual(request.attachments,['image.png']);
  assert.equal(call.image,'image.png');assert.deepEqual(call.imageBytes,PNG);
  assert.equal(request.model,'table/vision');assert.equal(request.thinking,'low');
  assert.ok(request.systemPrompt.endsWith('setup/handout-reading.md'));
  assert.ok(request.eventLog.startsWith(request.cwd),'the child\'s event stream is kept as evidence next to the picture');
  assert.match(request.brief,/^Play language: en\n/);
  assert.equal(t.calls.length,1,'one model round for one reading');
});

test('the reading is reported while it is being written, only ever growing, and never once the child is done',async()=>{
  const t=await table('stream',{gap:40,chunk:9});
  const reading=await readHandout(t.options());
  const reports=t.runner.progress;
  assert.ok(reports.length>=4,`the player saw ${reports.length} states of the reading`);
  assert.ok(t.calls[0].progressSeenBeforeEnd>=3,'reports arrived while the child was still writing');
  assert.equal(reports[0].text,'','the title arrives before any of the body');
  for(let index=1;index<reports.length;index++){
    assert.ok(reports[index].title.startsWith(reports[index-1].title));
    assert.ok(reports[index].text.startsWith(reports[index-1].text));
    assert.ok(reports[index].title.length>reports[index-1].title.length||reports[index].text.length>reports[index-1].text.length,'a repeat is not a report');
  }
  assert.deepEqual(reports.at(-1),{title:reading.title,text:reading.text},'the last report is the finished reading');
});

test('a burst of tiny deltas is one report, not one per delta',async()=>{
  const t=await table('burst',{chunk:1});
  await readHandout(t.options());
  assert.ok(t.runner.progress.length<=3,`${t.runner.progress.length} reports for ${READING.length} deltas`);
  assert.equal(t.runner.progress.at(-1).title,"Grave Robbers Strike Martin's Beach Again!");
});

test('a picture already in the play language is kept, decided by the model, and no text is reported',async()=>{
  const t=await table('keep',{say:()=>'keep'});
  const reading=await readHandout(t.options());
  assert.deepEqual([reading.keep,reading.title,reading.text],[true,'','']);
  assert.deepEqual(t.runner.progress,[]);
  const again=await readHandout(t.options());
  assert.equal(again.keep,true);assert.equal(t.calls.length,1,'the verdict is cached like a reading');
});

test('one image is read once per language: the cache is the image\'s, keyed by digest, tag and instruction',async()=>{
  const t=await table('cache',{say:tag=>tag==='fr'?'translate\nTitre\n\nCorps':READING});
  await readHandout(t.options());
  assert.equal(t.calls.length,1);
  // Another campaign, the same language: on disk.
  t.runner.progress.length=0;
  const second=await readHandout(t.options({campaign:'two'}));
  assert.equal(t.calls.length,1,'the same picture in the same language is not read again');
  assert.equal(second.title,"Grave Robbers Strike Martin's Beach Again!");
  assert.deepEqual(t.runner.progress.at(-1),{title:second.title,text:second.text},'a cached reading is reported whole, at once');
  // Another language is another reading.
  const french=await readHandout(t.options({play_language:'fr'}));
  assert.equal(t.calls.length,2);assert.equal(french.title,'Titre');
  // An edited instruction file re-reads; an unchanged one reuses.
  const prompt=join(t.contentRoot,'setup/handout-reading.md');
  await writeFile(prompt,(await readFile(prompt,'utf8'))+'\nPrefer short sentences.\n');
  await readHandout(t.options());
  assert.equal(t.calls.length,3);
  await readHandout(t.options());
  assert.equal(t.calls.length,3);
  const files=await readdir(join(t.home,'.coc/handout-readings',sha(PNG),'readings'));
  assert.equal(files.filter(name=>/^en-[a-f0-9]{12}\.json$/.test(name)).length,2,'the old instruction\'s reading stays as evidence');
});

test('the names the table already uses reach the brief',async()=>{
  const t=await table('standing');
  const folder=join(t.home,'.coc/campaigns/one/setup/presentations');await mkdir(folder,{recursive:true});
  await writeFile(join(folder,'standing-en.json'),JSON.stringify({play_language:'en',texts:{'马丁滩':"Martin's Beach"}}));
  await readHandout(t.options());
  assert.match(t.calls[0].request.brief,/Names this table already uses[^\n]*\n- 马丁滩 -> Martin's Beach\n/);
  const bare=await table('bare');
  await readHandout(bare.options());
  assert.doesNotMatch(bare.calls[0].request.brief,/Names this table already uses/);
});

test('a text-only table model refuses to read, and a cached reading needs no image input',async()=>{
  const t=await table('blind');
  await assert.rejects(readHandout(t.options({vision:false})),error=>error.code==='model_without_images');
  assert.equal(t.calls.length,0,'no child ran on a model that cannot see');
  await readHandout(t.options());
  const cached=await readHandout(t.options({vision:false,campaign:'two'}));
  assert.ok(cached.title);assert.equal(t.calls.length,1);
  await assert.rejects(readHandout(t.options({vision:false,play_language:'de'})),error=>error.code==='model_without_images');
});

test('the image a job is given must be the bytes the host checked',async()=>{
  const t=await table('swapped');
  await writeFile(t.path,Buffer.concat([PNG,Buffer.from('tampered')]));
  await assert.rejects(readHandout(t.options()),error=>error.code==='handout_not_available');
  await assert.rejects(readHandout(t.options({image:{path:join(t.home,'missing.png'),media_type:'image/png',sha256:sha(PNG)}})),error=>error.code==='handout_not_available');
  for(const bad of [{image:{path:t.path,media_type:'text/html',sha256:sha(PNG)}},{image:{path:t.path,media_type:'image/png',sha256:'abc'}},
    {campaign:'../x'},{play_language:'not a tag'}])
    await assert.rejects(readHandout(t.options(bad)),error=>error.code==='invalid_params',JSON.stringify(bad));
  assert.equal(t.calls.length,0);
});

test('a reading the model got wrong is refused, kept out of the cache and the next ask starts again',async()=>{
  let answer='Sure! Here is the translation:\nTitle\n\nBody';
  const t=await table('wrong',{say:()=>answer});
  await assert.rejects(readHandout(t.options()),error=>error.code==='preparation_failed'&&/first line must be keep or translate/.test(error.message));
  await assert.rejects(readdir(join(t.home,'.coc/handout-readings',sha(PNG),'readings')),{code:'ENOENT'});
  answer=READING;
  assert.ok((await readHandout(t.options())).title);
  assert.equal(t.calls.length,2);
});

test('a child that fails, and a job that is cancelled, are told apart',async()=>{
  const t=await table('fail');
  t.runner.reply=()=>new Error('provider');
  await assert.rejects(readHandout(t.options()),error=>error.code==='preparation_failed'&&/provider refused/.test(error.message));
  const controller=new AbortController();
  const original=t.runner.reply;
  t.runner.reply=request=>{controller.abort();return original(request);};
  await assert.rejects(readHandout(t.options({signal:controller.signal})),error=>error.code==='presentation_timeout');
});

/** A child that writes exactly these deltas, far enough apart that each one is its own report. */
const scripted=(deltas,{messages=[]}={})=>async request=>{
  request.onEvent({type:'message_start',message:{role:'assistant'}});
  for(const delta of deltas){
    if(delta===null){request.onEvent({type:'message_start',message:{role:'assistant'}});continue;}
    request.onEvent({type:'message_update',assistantMessageEvent:{type:'text_delta',delta}});
    await delay(170);
  }
  const text=deltas.filter(delta=>delta!==null).join('');
  request.onEvent({type:'message_end',message:{role:'assistant',content:[{type:'text',text:messages.at(-1)??text}]}});
  return {ok:true,code:0,timedOut:false,ms:1,stderr:'',command:[]};
};

test('a message that starts again replaces what was written: no half-written title is ever shown twice',async()=>{
  const t=await table('restart');
  const reading=await readHandout(t.options({runner:scripted(['translate\nHalf a tit',null,'translate\nTitle\n\nBody'],{messages:['translate\nTitle\n\nBody']})}));
  assert.deepEqual([reading.title,reading.text],['Title','Body']);
  const titles=t.runner.progress.map(partial=>partial.title);
  assert.ok(titles.includes('Half a tit'));
  assert.ok(titles.every(title=>!title.includes('translate')),`the discarded message leaked into ${JSON.stringify(titles)}`);
  assert.deepEqual(t.runner.progress.at(-1),{title:'Title',text:'Body'});
});

test('a delta that changes nothing the player can see is not a report',async()=>{
  const t=await table('quiet');
  await readHandout(t.options({runner:scripted(['translate\n','Title','\n','\n','Body'])}));
  const keys=t.runner.progress.map(partial=>JSON.stringify(partial));
  assert.equal(new Set(keys).size,keys.length,`the same state was reported twice: ${keys.join(' ')}`);
  assert.deepEqual(t.runner.progress.at(-1),{title:'Title',text:'Body'});
});

test('every model round leaves a cost row: phase, model, effort, wall time and tokens',async()=>{
  const t=await table('telemetry');
  await readHandout(t.options());
  const rows=(await readFile(join(t.home,'.coc/handout-readings/telemetry.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(rows.length,1);
  assert.deepEqual([rows[0].phase,rows[0].model,rows[0].thinking,rows[0].sha256,rows[0].ms,rows[0].input_tokens,rows[0].output_tokens,rows[0].cost_usd,rows[0].ok],
    ['reading','table/vision','low',sha(PNG),9,11,5,0.002,true]);
});
