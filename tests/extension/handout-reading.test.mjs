/**
 * Reading a pictured handout in the player's language (contract §155).
 *
 * The child is a deterministic stand-in for the tool-enabled Pi reader: it opens the same files the
 * real one is given (`image.<ext>`, `request.json`), writes the same artifact and runs the real
 * `check.mjs` the host wrote, against the real emitted validator. Nothing here decides a language:
 * whether a text "is already in the play language" is the stand-in's `keep`, exactly as it is the
 * model's in production.
 */
import assert from 'node:assert/strict';
import {after,before,test} from 'node:test';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cp,mkdir,mkdtemp,readFile,readdir,symlink,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {promisify} from 'node:util';
import {build} from 'esbuild';

const repo=resolve(import.meta.dirname,'../..');
const root=await mkdtemp(join(tmpdir(),'handout-reading-root-'));
process.env.PI_COC_RESOURCE_ROOT=root;
for(const [source,out] of [['extensions/module/handout-reading.ts','build/extensions/module/handout-reading.mjs'],
  ['extensions/mods/document-presentation.ts','build/extensions/mods/document-presentation.mjs']])
  await build({entryPoints:[join(repo,source)],outfile:join(root,out),bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
await symlink(join(repo,'node_modules'),join(root,'node_modules'));
const {readHandout,validateTranscription,composeTranscription,knownNames,TRANSCRIPTION_ROLES}=await import('../../extensions/module/handout-reading.ts');
after(()=>rm(root,{recursive:true,force:true}));

const run=promisify(execFile);
const PNG=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from('pretend pixels of a clipping')]);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const CLIPPING=[
  {role:'headline',text:'盗墓贼又光顾马丁滩啦！'},
  {role:'byline',text:'本报记者 陈某'},
  {role:'body',text:'昨夜，马丁滩公墓再次遭人翻掘，守夜人称未见形迹。'},
  {role:'body',text:'警长呼吁居民报告可疑之人[…]'},
];
const ENGLISH=[{role:'headline',text:'Grave robbers visit Martin Beach again!'},{role:'body',text:'The cemetery was dug over last night.'}];
const dust={'盗墓贼又光顾马丁滩啦！':"Grave Robbers Strike Martin's Beach Again!",
  '本报记者 陈某\n\n昨夜，马丁滩公墓再次遭人翻掘，守夜人称未见形迹。\n\n警长呼吁居民报告可疑之人[…]':
  "By our reporter Chen\n\nLast night the Martin's Beach cemetery was dug over once more; the night watchman saw no one.\n\nThe sheriff urges residents to report suspicious persons […]"};

let scratch;
before(async()=>{scratch=await mkdtemp(join(tmpdir(),'handout-reading-'));});
after(()=>rm(scratch,{recursive:true,force:true}));

async function table(name,{transcript=CLIPPING,bytes=PNG}={}){
  const home=await mkdtemp(join(scratch,`${name}-`));
  const contentRoot=join(home,'content');
  await mkdir(join(contentRoot,'setup'),{recursive:true});
  for(const file of ['handout-transcription.md','handout-reading.md'])await cp(join(repo,'content/setup',file),join(contentRoot,'setup',file));
  const path=join(home,'clipping.png');await writeFile(path,bytes);
  const calls=[];
  /** The stand-in reader. `translate` maps a source string to the player-language string it should write. */
  const runner=async request=>{
    const files=await readdir(request.cwd);
    if(files.includes('request.json')){
      const packet=JSON.parse(await readFile(join(request.cwd,'request.json'),'utf8'));
      calls.push({phase:'projection',model:request.model,thinking:request.thinking,packet});
      const title=packet.sources.find(s=>s.alias===packet.parts.title),text=packet.sources.find(s=>s.alias===packet.parts.text);
      const operation=source=>{
        const shown=runner.translate(source.text,packet.play_language);
        return shown===source.text?{source:source.alias,action:'keep'}:{source:source.alias,action:'translate',text:shown};
      };
      await writeFile(join(request.cwd,'result.json'),JSON.stringify({protocol:packet.protocol,texts:[operation(title),operation(text)]}));
    }else{
      const image=files.find(name=>name.startsWith('image.'));
      calls.push({phase:'transcription',model:request.model,thinking:request.thinking,image,imageBytes:await readFile(join(request.cwd,image))});
      await writeFile(join(request.cwd,'transcription.json'),JSON.stringify({blocks:transcript}));
    }
    const checked=await run(process.execPath,['check.mjs'],{cwd:request.cwd}).then(()=>null,error=>error);
    if(checked)throw new Error(`the checker refused the stand-in's artifact: ${checked.stderr||checked.message}`);
    return {ok:true,code:0,timedOut:false,ms:7,stderr:'',command:[],usage:{inputTokens:11,outputTokens:5,costUsd:0.002,actions:3,unknownCalls:0}};
  };
  runner.translate=(text,tag)=>tag==='en'?dust[text]??text:text;
  const options=(over={})=>({home,contentRoot,campaign:'one',play_language:'en',image:{path,media_type:'image/png',sha256:sha(bytes)},
    vision:true,transcribeWith:{model:'table/vision',thinking:'low'},projectWith:{model:'lane/fast',thinking:'low'},runner,...over});
  return {home,contentRoot,path,calls,runner,options,phases:name=>calls.filter(call=>call.phase===name)};
}

test('a transcription is one object of role-tagged blocks and nothing else',()=>{
  assert.deepEqual(validateTranscription({blocks:CLIPPING}).blocks.length,4);
  for(const bad of [null,[],{},{blocks:[]},{blocks:[{role:'body',text:'x'}],extra:1},{blocks:[{role:'body'}]},{blocks:[{role:'body',text:'  '}]},
    {blocks:[{role:'paragraph',text:'x'}]},{blocks:[{role:'body',text:'x',note:'y'}]},{blocks:'text'},
    {blocks:[{role:'body',text:'x'.repeat(8001)}]},{blocks:Array.from({length:201},()=>({role:'body',text:'x'}))}])
    assert.throws(()=>validateTranscription(bad),error=>error.code==='preparation_failed'&&/Invalid handout transcription/.test(error.message),JSON.stringify(bad)?.slice(0,60));
  assert.ok(TRANSCRIPTION_ROLES.includes('headline')&&TRANSCRIPTION_ROLES.includes('caption'));
});

test('the first headline is the title and every other block follows in reading order',()=>{
  assert.deepEqual(composeTranscription({blocks:CLIPPING}),{title:'盗墓贼又光顾马丁滩啦！',
    text:'本报记者 陈某\n\n昨夜，马丁滩公墓再次遭人翻掘，守夜人称未见形迹。\n\n警长呼吁居民报告可疑之人[…]'});
  assert.deepEqual(composeTranscription({blocks:[{role:'body',text:'first'},{role:'headline',text:'Head'},{role:'body',text:'second'}]}),{title:'Head',text:'first\n\nsecond'});
  assert.deepEqual(composeTranscription({blocks:[{role:'label',text:'Wanted'}]}),{title:'Wanted',text:''});
});

test('known names are the campaign\'s own saved projections whose source string is in the text',async()=>{
  const {home}=await table('names');
  const folder=join(home,'.coc/campaigns/one/setup/presentations');await mkdir(folder,{recursive:true});
  await writeFile(join(folder,'standing-en.json'),JSON.stringify({play_language:'en',texts:{'马丁滩':"Martin's Beach",'陈某':'','不在文中':'Absent','警':'X'}}));
  await writeFile(join(folder,'clues-en.json'),JSON.stringify({play_language:'en',texts:{'守夜人':'the night watchman'}}));
  await writeFile(join(folder,'3-en.json'),JSON.stringify({play_language:'en',texts:{'公墓':'DRAFT-WORD'}}));
  await writeFile(join(folder,'journal-en.json'),JSON.stringify({play_language:'fr',texts:{'警长':'WRONG-LANGUAGE'}}));
  await writeFile(join(folder,'broken-en.json'),'{');
  const names=await knownNames(home,'one','en','盗墓贼又光顾马丁滩啦！ 守夜人称 警长');
  assert.deepEqual(names,{'马丁滩':"Martin's Beach",'守夜人':'the night watchman'});
  assert.deepEqual(await knownNames(home,'../escape','en','马丁滩'),{});
  assert.deepEqual(await knownNames(home,'none-yet','en','马丁滩'),{});
});

test('one image is transcribed once for every campaign and language, on the table model; the projection runs on the lane',async()=>{
  const t=await table('shared');
  const first=await readHandout(t.options());
  assert.equal(first.title,"Grave Robbers Strike Martin's Beach Again!");
  assert.match(first.text,/^By our reporter Chen\n\nLast night the Martin's Beach cemetery/);
  assert.equal(first.keep,false);assert.equal(first.digest,sha(PNG));
  // The reader opened the delivered bytes under a name that says what they are.
  const [transcription]=t.phases('transcription');
  assert.equal(transcription.image,'image.png');assert.deepEqual(transcription.imageBytes,PNG);
  // Two models for two steps: the table's for the picture, the lane's for the words.
  assert.equal(transcription.model,'table/vision');assert.equal(t.phases('projection')[0].model,'lane/fast');

  // Another campaign, another language: no second reader run for the picture.
  const second=await readHandout(t.options({campaign:'two',play_language:'fr'}));
  assert.equal(t.phases('transcription').length,1,'the transcription is the image\'s, not the campaign\'s');
  assert.equal(t.phases('projection').length,2);
  assert.equal(second.keep,true,'the stand-in answered keep for a tag it has nothing for');
  // The same table again: everything is on disk.
  await readHandout(t.options());
  assert.equal(t.phases('transcription').length,1);assert.equal(t.phases('projection').length,2);
  const cached=await readdir(join(t.home,'.coc/handout-readings',sha(PNG)));
  assert.ok(cached.some(name=>/^transcription-[a-f0-9]{12}\.json$/.test(name)));
});

test('a picture already in the play language is kept, decided by the model and never by code',async()=>{
  const t=await table('keep',{transcript:ENGLISH});
  const reading=await readHandout(t.options());
  assert.equal(reading.keep,true);
  assert.equal(reading.title,'Grave robbers visit Martin Beach again!');
  assert.equal(reading.text,'The cemetery was dug over last night.');
  // The request the model saw carries no language verdict of ours.
  assert.deepEqual(Object.keys(t.phases('projection')[0].packet).sort(),['parts','play_language','protocol','sources']);
});

test('a text-only table model refuses to transcribe, and a cached transcription needs no vision',async()=>{
  const t=await table('blind');
  await assert.rejects(readHandout(t.options({vision:false})),error=>error.code==='model_without_images');
  assert.equal(t.calls.length,0,'no child ran on a model that cannot see');
  await readHandout(t.options());
  assert.equal(t.phases('transcription').length,1);
  const cached=await readHandout(t.options({vision:false,play_language:'de'}));
  assert.ok(cached.title,'the projection alone needs no image input');
  assert.equal(t.phases('transcription').length,1);
});

test('the names the table already uses reach the projection, and a new name re-projects',async()=>{
  const t=await table('standing');
  await readHandout(t.options());
  assert.equal(t.phases('projection')[0].packet.known_names,undefined,'no saved names, no field');
  const folder=join(t.home,'.coc/campaigns/one/setup/presentations');await mkdir(folder,{recursive:true});
  await writeFile(join(folder,'standing-en.json'),JSON.stringify({play_language:'en',texts:{'马丁滩':"Martin's Beach"}}));
  await readHandout(t.options());
  const second=t.phases('projection');
  assert.equal(second.length,2,'a newly projected name changes the cache key');
  assert.deepEqual(second[1].packet.known_names,{'马丁滩':"Martin's Beach"});
  await readHandout(t.options());
  assert.equal(t.phases('projection').length,2,'the same names reuse the accepted reading');
});

test('an edited instruction file re-reads or re-projects; an unchanged one reuses',async()=>{
  const t=await table('instructions');
  await readHandout(t.options());
  assert.deepEqual([t.phases('transcription').length,t.phases('projection').length],[1,1]);
  const reading=join(t.contentRoot,'setup/handout-reading.md');
  await writeFile(reading,(await readFile(reading,'utf8'))+'\nPrefer short sentences.\n');
  await readHandout(t.options());
  assert.deepEqual([t.phases('transcription').length,t.phases('projection').length],[1,2],'a new reading instruction re-projects only');
  const transcription=join(t.contentRoot,'setup/handout-transcription.md');
  await writeFile(transcription,(await readFile(transcription,'utf8'))+'\nRead slowly.\n');
  await readHandout(t.options());
  assert.deepEqual([t.phases('transcription').length,t.phases('projection').length],[2,2],'a new transcription instruction reads the picture again');
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

test('every model round leaves a cost row: phase, model, effort, rounds, wall time and tokens',async()=>{
  const t=await table('telemetry');
  await readHandout(t.options());
  const rows=(await readFile(join(t.home,'.coc/handout-readings/telemetry.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(rows.map(row=>[row.phase,row.model,row.round]),[['transcription','table/vision',1],['projection','lane/fast',1]]);
  for(const row of rows)assert.deepEqual([row.sha256,row.ms,row.input_tokens,row.output_tokens,row.cost_usd,row.ok],[sha(PNG),7,11,5,0.002,true]);
  assert.equal(rows[0].thinking,'low');
});

test('the checker the child runs refuses a malformed transcription and names why',async()=>{
  const t=await table('checker');
  const refused=[];
  await readHandout(t.options({runner:async request=>{
    if(!(await readdir(request.cwd)).includes('request.json')){
      await writeFile(join(request.cwd,'transcription.json'),JSON.stringify({blocks:[{role:'paragraph',text:'x'}]}));
      refused.push(await run(process.execPath,['check.mjs'],{cwd:request.cwd}).then(()=>null,error=>error));
    }
    return t.runner(request);
  }}));
  assert.ok(refused[0],'the malformed artifact failed the checker');
  assert.notEqual(refused[0].code,0);
  assert.match(refused[0].stderr,/role must be one of headline, deck, byline/);
});
