import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {TranscriptStore,TRANSCRIPT_RECORD_SCHEMA,sha256} from '../../extensions/module/transcript-store.ts';
import {readSourcePageText} from '../../extensions/module/source-page-text.ts';
import {build} from 'esbuild';
const SHA='a'.repeat(64),VERSION='sqlite-test-native-v1',LINES=['Exact source line'];
const record=(version=VERSION)=>({schema:TRANSCRIPT_RECORD_SCHEMA,transcript_version:'transcript-v1',file_sha256:SHA,page:1,
  pdf_label:'1',native:{extraction_version:version,text_sha256:sha256(LINES[0]),line_count:1},text:LINES[0],text_sha256:sha256(LINES[0]),
  markdown:LINES[0],image_text:[],figures:[],dropped:[],unplaced:[],free_removed:0,attempts:1,model:'fixture/vision',thinking:'low',at:'2026-10-10T00:00:00Z'});
async function fixture(t){const home=await mkdtemp(join(tmpdir(),'sqlite-transcripts-'));t.after(()=>rm(home,{recursive:true,force:true}));
  return {home,store:new TranscriptStore({home,contentRoot:home,extractionVersion:VERSION})};}

test('transcript import preserves legacy bytes and SQL loss never resurrects stale page JSON',async t=>{
  const {home,store}=await fixture(t),legacy=store.recordPath(SHA,1),bytes=JSON.stringify(record(),null,2)+'\n';
  await mkdir(store.dir(SHA),{recursive:true});await writeFile(legacy,bytes);
  assert.deepEqual((await store.read(SHA,1)).record,record());assert.equal(await readFile(legacy,'utf8'),bytes);
  const path=join(store.root,'transcripts.sqlite'),db=new DatabaseSync(path,{readOnly:true});
  const imported=db.prepare('SELECT * FROM transcript_imports').get();
  assert.equal(Buffer.from(imported.bytes).toString(),bytes);assert.equal(imported.digest,sha256(bytes));db.close();
  await writeFile(legacy,'{stale-invalid-json');assert.deepEqual((await store.read(SHA,1)).record,record());
  await rm(path);await assert.rejects(store.read(SHA,1),/authoritative SQLite database is missing/);
  const result=await readSourcePageText({pdf:'fixture.pdf',options:{pages:[1],expected_file_sha256:SHA},store,
    nativeText:async()=>({file_sha256:SHA,page_count:1,extraction_version:VERSION,snapshots:[{page:1,pdf_label:'1',text:LINES[0],text_sha256:sha256(LINES[0]),revision:'native-revision'}],errors:[]}),
    digest:async()=>SHA});
  assert.equal(result.pages[0].layer,'native');assert.equal(result.pages[0].text,LINES[0]);
});

test('transcript versions coexist, publish once and preserve shipped seed precedence',async t=>{
  const {home,store}=await fixture(t),older=new TranscriptStore({home,contentRoot:home,extractionVersion:'older'});
  assert.equal(await older.put(record('older'),LINES),'stored');assert.equal(await store.put(record(),LINES),'stored');
  assert.equal(await store.put({...record(),markdown:'replacement'},LINES),'exists');
  assert.equal((await older.read(SHA,1)).record.native.extraction_version,'older');
  assert.equal((await store.readPages(SHA,[1])).get(1).markdown,LINES[0]);
  const seed=join(home,'source-transcripts',SHA);await mkdir(seed,{recursive:true});
  await writeFile(join(seed,'page-0001.json'),JSON.stringify({...record(),markdown:'shipped seed'}));
  assert.equal((await store.read(SHA,1)).source,'seed');assert.equal((await store.readPages(SHA,[1])).get(1).markdown,'shipped seed');
  const db=new DatabaseSync(join(store.root,'transcripts.sqlite'),{readOnly:true});
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transcript_records').get().n,2);db.close();
  await rm(join(store.root,'transcripts.sqlite'));
  assert.equal((await store.readPages(SHA,[1,2])).get(1).markdown,'shipped seed');
  assert.deepEqual([...await store.recordedPages(SHA)],[1]);
});

test('independent page producers have one claim winner and a crashed owner can be replaced without stale release',async t=>{
  const {home,store}=await fixture(t);await store.put(record(),LINES);
  const module=pathToFileURL(join(import.meta.dirname,'../../extensions/module/transcript-store.ts')).href;
  const run=()=>new Promise((resolve,reject)=>{
    const code='import {TranscriptStore} from '+JSON.stringify(module)+';const store=new TranscriptStore({home:process.argv[1],contentRoot:process.argv[1],extractionVersion:'+JSON.stringify(VERSION)+'});'
      +'const claim=await store.claim('+JSON.stringify(SHA)+',2,1000,10000);console.log(claim?"won":"held");';
    const child=spawn(process.execPath,['--input-type=module','-e',code,home]);let output='';
    child.stdout.on('data',part=>output+=part);child.on('error',reject);child.on('close',code=>code===0?resolve(output.trim()):reject(Error('claim child failed:'+output)));
  });
  const results=await Promise.all(Array.from({length:4},run));assert.equal(results.filter(value=>value==='won').length,1);
  assert.equal(await store.claim(SHA,2,1000,10500),null);
  const replacement=await store.claim(SHA,2,1000,12000);assert(replacement);await replacement.release();
  assert.equal(await store.claimedElsewhere(SHA,2,1000,12000),false);
});

test('the real kernel text projection reads SQL-only pages and never stale legacy after SQL failure',async t=>{
  const {home,store}=await fixture(t),compiled=join(home,'projection.mjs');
  await build({stdin:{contents:"export {pageTranscript} from './kernel-ts/read/page-transcripts.ts';export {snapshots} from './kernel-ts/snapshots.ts';",
    resolveDir:join(import.meta.dirname,'../..'),sourcefile:'projection-entry.ts'},outfile:compiled,bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
  const {pageTranscript,snapshots}=await import(pathToFileURL(compiled).href),context={content:home,stateRoot:join(home,'.coc'),snapshots};
  assert.equal(await pageTranscript(context,SHA,1),null);
  await store.put(record(),LINES);
  await assert.rejects(readFile(store.recordPath(SHA,1)),error=>error.code==='ENOENT');
  assert.deepEqual(await pageTranscript(context,SHA,1),{text:LINES[0],image_text:[]});
  await writeFile(store.recordPath(SHA,1),JSON.stringify({...record(),image_text:['Stale legacy image text']}));
  assert.deepEqual(await pageTranscript(context,SHA,1),{text:LINES[0],image_text:[]});
  await rm(join(store.root,'transcripts.sqlite'));
  assert.equal(await pageTranscript(context,SHA,1),null);
});
