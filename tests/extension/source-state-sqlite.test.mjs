/** §22.7: kernel-ts/modules/source-state.ts is the source queue/metadata authority. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {mkdir, readFile, writeFile, symlink} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {playtestScratch} from './playtest-scratch.mjs';
import {readerBook} from './name-free-book.mjs';
import {sourceMetadata} from '../../runtime/source-metadata.ts';
const root=resolve(import.meta.dirname,'../..'),scratch=playtestScratch('source-state-sqlite');
const bundle=join(scratch,'api.mjs');
await build({stdin:{contents:`export {SourceState,sourceState} from './kernel-ts/modules/source-state.ts';
export {createKernelContext} from './kernel-ts/context.ts';
export {nativeAdvisoryLocks} from './kernel-ts/native-locks.ts';
export {createKernelRuntime} from './kernel-ts/registry.ts';`,resolveDir:root},outfile:bundle,bundle:true,
 packages:'external',platform:'node',format:'esm',logLevel:'silent'});
const api=await import(pathToFileURL(bundle).href);
let sequence=0;
async function fixture(t){
 const stateRoot=join(scratch,'home-'+(++sequence),'.coc'),directory=join(stateRoot,'modules','book');
 await mkdir(directory,{recursive:true});
 const metadata=Buffer.from('{ "id": "book", "generation": 3, "reading": {"answers":{}} }\n');
 const queue=Buffer.from('[ {"job_id":"read-1","state":"queued","key":"request-1","unknown":{"keep":true}} ]\n');
 await writeFile(join(directory,'module.json'),metadata);await writeFile(join(directory,'deepen-queue.json'),queue);
 await writeFile(join(directory,'source.pdf'),'unchanged source bytes');
 const state=new api.SourceState(stateRoot);t.after(()=>state.close());
 return {stateRoot,directory,state,metadata,queue};
}
test('migration retains exact initial bytes, job order and unknown fields; SQL survives damaged JSON projections',async t=>{
 const f=await fixture(t),first=await f.state.snapshot(f.directory);
 assert.equal(first.revision,1);assert.deepEqual(first.jobs[0].unknown,{keep:true});
 const db=new DatabaseSync(join(f.stateRoot,'source-reading.sqlite'));t.after(()=>db.close());
 const receipt=db.prepare('SELECT * FROM source_imports').get();
 assert.deepEqual(Buffer.from(receipt.metadata_bytes),f.metadata);assert.deepEqual(Buffer.from(receipt.queue_bytes),f.queue);
 assert.deepEqual(await readFile(join(f.stateRoot,receipt.archive,'module.json')),f.metadata);
 await writeFile(join(f.directory,'module.json'),'broken JSON');await writeFile(join(f.directory,'deepen-queue.json'),'[]');
 assert.deepEqual(await f.state.snapshot(f.directory),first);assert.equal((await sourceMetadata(f.directory)).generation,3);
 assert.equal(await readFile(join(f.directory,'source.pdf'),'utf8'),'unchanged source bytes');
});
test('metadata and queue commit together, and a thrown operation publishes neither',async t=>{
 const f=await fixture(t),before=await f.state.snapshot(f.directory);
 await assert.rejects(f.state.transaction(f.directory,async()=>{
  await f.state.update(f.directory,{metadata:{...before.metadata,generation:4},jobs:[{...before.jobs[0],state:'completed'}]});
  throw Error('interrupted publication');
 }),/interrupted publication/);
 assert.deepEqual(await f.state.snapshot(f.directory),before);
 await f.state.update(f.directory,{metadata:{...before.metadata,generation:4},jobs:[{...before.jobs[0],state:'completed'}]});
 const after=await f.state.snapshot(f.directory);assert.equal(after.revision,2);assert.equal(after.metadata.generation,4);assert.equal(after.jobs[0].state,'completed');
});
test('stale writers fail instead of overwriting another owner; unrelated scopes remain isolated',async t=>{
 const f=await fixture(t);await f.state.ensure(f.directory);
 const second=new api.SourceState(f.stateRoot);t.after(()=>second.close());
 let ready,proceed;const started=new Promise(r=>ready=r),gate=new Promise(r=>proceed=r);
 const stale=f.state.transaction(f.directory,async()=>{
  const snapshot=await f.state.snapshot(f.directory);ready();await gate;
  await f.state.update(f.directory,{jobs:[{...snapshot.jobs[0],state:'running',owner:'stale'}]});
 });
 await started;const snapshot=await second.snapshot(f.directory);
 await second.update(f.directory,{jobs:[{...snapshot.jobs[0],state:'running',owner:'winner'}]});proceed();
 await assert.rejects(stale,/Source state changed/);assert.equal((await second.snapshot(f.directory)).jobs[0].owner,'winner');
 const fork=join(f.stateRoot,'module-campaigns','private','modules','book');await mkdir(fork,{recursive:true});
 await second.update(fork,{metadata:{id:'book',campaign_scope:'private'},jobs:[]});
 assert.equal((await second.snapshot(fork)).metadata.campaign_scope,'private');assert.equal((await second.snapshot(f.directory)).metadata.generation,3);
});
test('a database write error rolls back metadata, jobs and revision history as one unit',async t=>{
 const f=await fixture(t),before=await f.state.snapshot(f.directory);
 const db=new DatabaseSync(join(f.stateRoot,'source-reading.sqlite'));t.after(()=>db.close());
 db.exec("CREATE TRIGGER fail_completion BEFORE INSERT ON source_jobs WHEN NEW.state='completed' BEGIN SELECT RAISE(ABORT,'injected failure'); END;");
 await assert.rejects(f.state.update(f.directory,{metadata:{...before.metadata,generation:4},jobs:[{...before.jobs[0],state:'completed'}]}),/injected failure/);
 assert.deepEqual(await f.state.snapshot(f.directory),before);
 assert.equal(db.prepare('SELECT count(*) AS count FROM source_revisions').get().count,1);
});
test('abrupt process exit during an uncommitted SQL write recovers the last accepted revision',async t=>{
 const f=await fixture(t);const before=await f.state.snapshot(f.directory);
 const child=spawn(process.execPath,['--input-type=module','-e',`import {DatabaseSync} from 'node:sqlite';
 const db=new DatabaseSync(process.argv[1]);db.exec("BEGIN IMMEDIATE; UPDATE source_modules SET payload='broken'; DELETE FROM source_jobs;");process.exit(23);`,join(f.stateRoot,'source-reading.sqlite')],{stdio:'ignore'});
 assert.equal(await new Promise(r=>child.once('exit',r)),23);assert.deepEqual(await f.state.snapshot(f.directory),before);
});
test('missing or incompatible authoritative state never reimports legacy exports',async t=>{
 const f=await fixture(t);await f.state.ensure(f.directory);f.state.close();
 const db=new DatabaseSync(join(f.stateRoot,'source-reading.sqlite'));db.exec('PRAGMA user_version=0;');db.close();
 await assert.rejects(f.state.snapshot(f.directory),/schema is missing/);await assert.rejects(sourceMetadata(f.directory),/Unsupported/);
});
test('an escaping symlink cannot import external source bytes',async t=>{
 const f=await fixture(t);await symlink(scratch,join(f.stateRoot,'escape'));
 await assert.rejects(f.state.snapshot(join(f.stateRoot,'escape','book')),/escapes/);
 await symlink(join(f.stateRoot,'modules'),join(f.stateRoot,'alias'));
 await assert.rejects(f.state.snapshot(join(f.stateRoot,'alias','book')),/escapes/,'one directory cannot get two scope identities');
});
test('a damaged imported module cannot be recreated from its remaining JSON export',async t=>{
 const f=await fixture(t);await f.state.ensure(f.directory);
 const db=new DatabaseSync(join(f.stateRoot,'source-reading.sqlite'));t.after(()=>db.close());
 db.exec('DELETE FROM source_jobs; DELETE FROM source_modules;');
 await assert.rejects(f.state.snapshot(f.directory),/legacy JSON cannot restore/);
 await assert.rejects(sourceMetadata(f.directory),/metadata is missing/);
});
test('failed initial import has no partially registered source and remains retryable with all original archives',async t=>{
 const f=await fixture(t);
 await writeFile(join(f.directory,'deepen-queue.json'),JSON.stringify([{job_id:'duplicate'},{job_id:'duplicate'}]));
 await assert.rejects(f.state.ensure(f.directory),/UNIQUE constraint/);
 const db=new DatabaseSync(join(f.stateRoot,'source-reading.sqlite'));t.after(()=>db.close());
 for(const table of ['source_modules','source_jobs','source_revisions','source_imports'])
  assert.equal(db.prepare('SELECT count(*) AS count FROM '+table).get().count,0);
 await writeFile(join(f.directory,'deepen-queue.json'),f.queue);
 assert.equal((await f.state.snapshot(f.directory)).jobs[0].job_id,'read-1');
});
test('failed inspection export does not undo or misreport a committed publication',async t=>{
 const f=await fixture(t),before=await f.state.snapshot(f.directory);
 await mkdir(join(f.directory,'module.json.sqlite-export-'+process.pid));
 await f.state.update(f.directory,{metadata:{...before.metadata,generation:5}});
 assert.equal((await f.state.snapshot(f.directory)).metadata.generation,5);
 assert.equal((await sourceMetadata(f.directory)).generation,5);
 const db=new DatabaseSync(join(f.stateRoot,'source-reading.sqlite'));t.after(()=>db.close());
 assert.ok(db.prepare('SELECT error FROM source_exports').get().error);
});
test('an asynchronous descendant after its transaction closes writes a new revision',async t=>{
 const f=await fixture(t);await f.state.ensure(f.directory);
 let go,later;const gate=new Promise(r=>go=r);
 await f.state.transaction(f.directory,async()=>{
  later=(async()=>{await gate;await f.state.update(f.directory,{metadata:{id:'book',generation:8}});})();
 });
 go();await later;const saved=await f.state.snapshot(f.directory);assert.equal(saved.revision,2);assert.equal(saved.metadata.generation,8);
});
test('real reading handlers serialize concurrent claims and persist exactly one attempt',async t=>{
 const book=await readerBook(api,{root,temporary:scratch,t,seed:'sqlite-claims'});
 const requested=await book.raw('module.read.request',{module_id:book.mid,purpose:'answer',focus:'Dock',question:'Who works here?',foreground:true});
 const context=await api.createKernelContext({workspace:book.home,content:join(root,'content'),locks:api.nativeAdvisoryLocks()});
 const other=api.createKernelRuntime(context);t.after(()=>other.close());
 const claims=await Promise.all([book.raw('module.read.claim',{module_id:book.mid,owner:'first'}),other.handlers['module.read.claim']({module_id:book.mid,owner:'second'})]);
 assert.equal(claims.filter(value=>value.job_id===requested.job_id).length,1);
 const persisted=await api.sourceState(context.stateRoot).snapshot(join(context.stateRoot,'modules',book.mid));
 assert.equal(persisted.jobs.filter(job=>job.job_id===requested.job_id&&job.state==='running').length,1);
});
test('checked answer completion commits its memo and job together, then replays idempotently',async t=>{
 const book=await readerBook(api,{root,temporary:scratch,t,seed:'sqlite-finish'});
 await book.raw('module.read.request',{module_id:book.mid,purpose:'answer',focus:'Dock',question:'Who works here?',foreground:true});
 const job=await book.raw('module.read.claim',{module_id:book.mid,owner:'finish-test'});
 const draft=Buffer.from(JSON.stringify({status:'answered',answer:'Old Mae mends nets.',source_refs:[{page:1}],limitations:''}));
 await writeFile(join(job.work_dir,'draft.json'),draft);
 await writeFile(join(job.work_dir,'review.json'),JSON.stringify({checked:[{paths:['/status','/answer','/source_refs','/limitations'],
  verdict:'supported',source_refs:[{page:1}],reason:'The page prints the net mender.'}],missing:[],draft_sha256:createHash('sha256').update(draft).digest('hex')}));
 await writeFile(join(job.work_dir,'observations.json'),JSON.stringify({file_sha256:job.source.file_sha256,read_pages:[1],full_pages:[1],review_pages:[1]}));
 const state=api.sourceState(book.context.stateRoot),directory=join(book.context.stateRoot,'modules',book.mid);
 const before=await state.snapshot(directory),db=new DatabaseSync(join(book.context.stateRoot,'source-reading.sqlite'));t.after(()=>db.close());
 db.exec("CREATE TRIGGER fail_finish BEFORE INSERT ON source_jobs WHEN NEW.state='completed' BEGIN SELECT RAISE(ABORT,'finish commit failed'); END;");
 const params={module_id:book.mid,job_id:job.job_id,lease:job.lease,outcome:'completed',draft_path:join(job.work_dir,'draft.json'),review_path:join(job.work_dir,'review.json')};
 await assert.rejects(book.raw('module.read.finish',params),/finish commit failed/);
 assert.deepEqual(await state.snapshot(directory),before,'neither memo nor job advances on failed commit');
 db.exec('DROP TRIGGER fail_finish;');
 const done=await book.raw('module.read.finish',params),accepted=await state.snapshot(directory);
 assert.equal(accepted.jobs.find(item=>item.job_id===job.job_id).state,'completed');
 assert.ok(accepted.metadata.reading.completed[job.job_id]);assert.ok(Object.keys(accepted.metadata.reading.answers).length);
 const replay=await book.raw('module.read.finish',params);assert.equal(replay.replayed,true);assert.equal(replay.state,done.state);
 assert.equal((await state.snapshot(directory)).revision,accepted.revision,'replay makes no second publication');
 assert.deepEqual(await readFile(join(job.work_dir,'draft.json')),draft);
});
test('failed claim commit releases its new native descriptors so another owner can claim',async t=>{
 const book=await readerBook(api,{root,temporary:scratch,t,seed:'sqlite-claim-rollback'});
 const requested=await book.raw('module.read.request',{module_id:book.mid,purpose:'answer',focus:'Dock',question:'Who works here?',foreground:true});
 const db=new DatabaseSync(join(book.context.stateRoot,'source-reading.sqlite'));t.after(()=>db.close());
 db.exec("CREATE TRIGGER fail_claim BEFORE INSERT ON source_jobs WHEN NEW.state='running' BEGIN SELECT RAISE(ABORT,'claim commit failed'); END;");
 await assert.rejects(book.raw('module.read.claim',{module_id:book.mid,owner:'loser'}),/claim commit failed/);
 const rolledBack=await api.sourceState(book.context.stateRoot).snapshot(join(book.context.stateRoot,'modules',book.mid));
 assert.equal(rolledBack.jobs.find(job=>job.job_id===requested.job_id).state,'queued');
 assert.equal(rolledBack.jobs.find(job=>job.job_id===requested.job_id).attempts,0);
 db.exec('DROP TRIGGER fail_claim;');
 const context=await api.createKernelContext({workspace:book.home,content:join(root,'content'),locks:api.nativeAdvisoryLocks()});
 const other=api.createKernelRuntime(context);t.after(()=>other.close());
 const claimed=await other.handlers['module.read.claim']({module_id:book.mid,owner:'winner'});
 assert.equal(claimed.job_id,requested.job_id);
 const saved=await api.sourceState(context.stateRoot).snapshot(join(context.stateRoot,'modules',book.mid));
 assert.equal(saved.jobs.find(job=>job.job_id===requested.job_id).attempts,2,'the next attempt keeps the failed claim folder as evidence');
});
