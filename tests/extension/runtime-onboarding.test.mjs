import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { buildSync } from 'esbuild';
import { createPreparationHost } from '../../runtime/preparation.ts';
import { CocOnboardingHost } from '../../Electron/packages/pi-backend/src/coc-onboarding.ts';

const root = resolve(import.meta.dirname, '../..');
const model = {id: 'fixture/no-provider', thinking: 'low', vision: true};

async function eventually(read, message) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const result = read();
    if (result) return result;
    await delay(20);
  }
  assert.fail(message);
}

function fixture(t, worker) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'runtime onboarding ')));
  const resourceRoot = join(base, 'relocated resources');
  const contentRoot = join(base, 'selected content');
  const home = join(base, 'selected data home');
  const agentHome = join(base, 'selected Pi home');
  for (const path of [resourceRoot, contentRoot, home, agentHome]) mkdirSync(path, {recursive: true});
  symlinkSync(join(root, 'node_modules'), join(resourceRoot, 'node_modules'), 'dir');
  mkdirSync(join(resourceRoot, 'build/pipicoc'), {recursive: true});
  for (const path of ['extensions', 'runtime', 'kernel', 'host']) symlinkSync(join(root, 'build', path), join(resourceRoot, 'build', path), 'dir');
  if (worker) {
    writeFileSync(join(resourceRoot, 'build/pipicoc/onboarding-worker.mjs'), worker);
  } else copyFileSync(join(root, 'build/pipicoc/onboarding-worker.mjs'), join(resourceRoot, 'build/pipicoc/onboarding-worker.mjs'));
  // A content root declares its play languages and holds the product's own captions (contract §23).
  // `zz` is the default and authors nothing, so anything that reaches for a word has to walk the
  // declared languages rather than assume the one the fixture happens to write.
  writeFileSync(join(contentRoot, 'languages.json'), JSON.stringify({default: 'zz',
    languages: {zz: {autonym: 'Zz'}, en: {autonym: 'English'}, qq: {autonym: 'Qq'}}}));
  for (const [tag, word] of [['zz', 'zz sheet'], ['en', 'en sheet']]) {
    mkdirSync(join(contentRoot, 'ui', tag), {recursive: true});
    writeFileSync(join(contentRoot, 'ui', tag, 'sheet.json'), JSON.stringify({clues: word}));
    writeFileSync(join(contentRoot, 'ui', tag, 'onboarding.json'), JSON.stringify({heading: `${tag} heading`}));
  }
  const starter = join(contentRoot, 'starters', 'selected-story');
  mkdirSync(starter, {recursive: true});
  writeFileSync(join(starter, 'starter-listing.json'), JSON.stringify({listed: true, title: {en: 'Selected content'}, blurb: {en: 'Relocated catalog'}}));
  writeFileSync(join(starter, 'module-graph.json'), JSON.stringify({nodes: [{node_kind: 'module', name: 'Selected content'}]}));
  const kernel = join(base, 'kernel transport fixture.mjs');
  // This fixture answers transport/setup calls only. It is not a Keeper or gameplay evidence.
  writeFileSync(kernel, `
import {createInterface} from 'node:readline';
import {appendFileSync,existsSync,mkdirSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const home=process.env.PI_COC_HOME;
createInterface({input:process.stdin}).on('line',line=>{
 const request=JSON.parse(line),p=request.params;
 appendFileSync(join(home,'kernel-events.jsonl'),JSON.stringify({pid:process.pid,method:request.method,cwd:process.cwd(),
  home,agentHome:process.env.PI_CODING_AGENT_DIR,campaign:process.env.PI_COC_CAMPAIGN,value:process.env.RUNTIME_CAPTURED,late:process.env.RUNTIME_LATE})+'\\n');
 let result={};
 if(request.method==='module.list')result={modules:[{id:'owned-module',status:'installed',source:'pdf'}]};
 if(request.method==='setup.occupations')result={occupations:[{name:'Journalist'}]};
 if(request.method==='campaign.list')result={campaigns:existsSync(join(home,'.coc/campaigns'))?readdirSync(join(home,'.coc/campaigns')).map(id=>({id})):[]};
 if(request.method==='campaign.create'){
  const path=join(home,'.coc/campaigns',p.id);mkdirSync(path,{recursive:true});
  writeFileSync(join(path,'campaign.json'),JSON.stringify({id:p.id,status:'setting_up',play_language:p.play_language}));
 }
 if(request.method==='table.view')result={play_language:'en',labels:{}};
 if(request.method==='mods.document.view')result={version:'current'};
 const reply=()=>process.stdout.write(JSON.stringify({id:request.id,ok:true,result})+'\\n');
 if(request.method==='module.list'&&process.env.RUNTIME_DELAY==='1')setTimeout(reply,5000);else reply();
});
`);
  const nodeExecutable = join(base, 'chosen node');
  const quoted = value => "'" + value.replaceAll("'", "'\\''") + "'";
  writeFileSync(nodeExecutable, `#!/bin/sh\nexec ${quoted(process.execPath)} "$@"\n`, {mode: 0o700});
  const env = {...process.env, PI_COC_KERNEL_CMD: JSON.stringify([process.execPath, kernel]), RUNTIME_CAPTURED: 'captured'};
  delete env.RUNTIME_LATE;
  const options = {resourceRoot, contentRoot, agentHome, nodeExecutable, env};
  const active = [];
  t.after(async () => {
    await Promise.allSettled(active.map(owner => owner.close()));
    rmSync(base, {recursive: true, force: true});
  });
  return {base, resourceRoot, contentRoot, home, agentHome, nodeExecutable, env, options, active};
}

function observe(process) {
  const events = [];
  let pending = '', stderr = '';
  process.child.stdout.setEncoding('utf8');
  process.child.stdout.on('data', chunk => {
    pending += chunk;
    let end;
    while ((end = pending.indexOf('\n')) >= 0) {
      events.push(JSON.parse(pending.slice(0, end)));
      pending = pending.slice(end + 1);
    }
  });
  process.child.stderr.on('data', chunk => {stderr += chunk;});
  const complete = new Promise(resolve => process.child.once('close', (code, signal) => resolve({code, signal, events, stderr})));
  return {events, complete: Promise.all([complete, process.closed]).then(([result]) => result)};
}

function kernelEvents(home) {
  const path = join(home, 'kernel-events.jsonl');
  return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
}

test('the real catalog worker uses captured Node, data, Pi and relocated content inputs', async t => {
  const f = fixture(t);
  const host = createPreparationHost(f.home, f.options);
  f.env.RUNTIME_CAPTURED = 'changed after composition';
  f.options.nodeExecutable = '/missing/late-node';
  const previous = process.env.RUNTIME_LATE;
  process.env.RUNTIME_LATE = 'must not leak';
  t.after(() => {if (previous === undefined) delete process.env.RUNTIME_LATE; else process.env.RUNTIME_LATE = previous;});
  const task = host.start('catalog', {play_language: 'en', home: '/untrusted/override'});
  f.active.push(task);
  assert.equal(task.child.spawnfile, f.nodeExecutable);
  const output = await observe(task).complete;
  assert.equal(output.code, 0, output.stderr);
  assert.deepEqual(output.events.find(event => event.type === 'result').data, {
    presets: [{id: 'selected-story', title: 'Selected content', blurb: 'Relocated catalog'}],
    modules: [{id: 'owned-module', status: 'installed', source: 'pdf'}], occupations: [{name: 'Journalist'}],
  });
  for (const event of kernelEvents(f.home)) {
    assert.equal(event.cwd, f.resourceRoot);
    assert.equal(event.home, f.home);
    assert.equal(event.agentHome, f.agentHome);
    assert.equal(event.value, 'captured');
    assert.equal(event.late, undefined);
    assert.throws(() => process.kill(event.pid, 0), {code: 'ESRCH'});
  }
});

test('the catalog walks the declared play languages in data order for a title its own tag lacks', async t => {
  const f = fixture(t);
  const host = createPreparationHost(f.home, f.options);
  // Authored under a tag no list in code could hold, so a title only arrives if the fallback walks
  // `languages.json` itself. `qq` is declared last, and the module node's own name is the only
  // other candidate — a catalog that guessed at languages would answer with that name instead.
  writeFileSync(join(f.contentRoot, 'starters/selected-story/starter-listing.json'),
    JSON.stringify({listed: true, title: {qq: 'Authored in qq'}, blurb: {qq: 'Blurb in qq'}}));
  // No `play_language`: the worker settles on the declared default, `zz`, which authors nothing.
  const task = host.start('catalog', {});
  f.active.push(task);
  const output = await observe(task).complete;
  assert.equal(output.code, 0, output.stderr);
  assert.deepEqual(output.events.find(event => event.type === 'result').data.presets,
    [{id: 'selected-story', title: 'Authored in qq', blurb: 'Blurb in qq'}]);
});

test('an onboarding answer carries the words for its own play language, and its refusals carry codes', async t => {
  const f = fixture(t, phaseWorker);
  const host = trackedHost(f);
  // No job yet, so the answer is in the language the data calls the default.
  const empty = await host.invoke({action: 'current'}, 'session-one', model);
  assert.equal(empty.current_import, null);
  assert.equal(empty.ui.tag, 'zz');
  assert.equal(empty.ui.words.onboarding.heading, 'zz heading');
  const job = await host.invoke({action: 'begin', name: 'source.pdf', size: 9, play_language: 'en'}, 'session-one', model);
  assert.equal(job.play_language, 'en');
  assert.equal(job.ui.tag, 'en');
  assert.equal(job.ui.words.onboarding.heading, 'en heading');
  assert.equal(job.ui.words.sheet.clues, 'en sheet');
  const status = await host.invoke({action: 'status', id: job.id}, 'session-one', model);
  assert.equal(status.ui.tag, 'en');
  const code = async (params, session = 'session-one') => {
    const failure = await host.invoke(params, session, model).then(() => undefined, error => error);
    assert.ok(failure, `${params.action} was expected to be refused`);
    return failure.code;
  };
  assert.equal(await code({action: 'status', id: job.id}, 'another-session'), 'import_other_session');
  assert.equal(await code({action: 'status', id: 'not-a-uuid'}), 'unknown_import');
  assert.equal(await code({action: 'begin', name: 'source.txt', size: 9}), 'upload_too_large');
  // `ww` is not declared, so it is refused rather than quietly swapped for the default.
  assert.equal(await code({action: 'select', source: 'starter', module_id: 'selected-story', play_language: 'ww'}), 'invalid_params');
  assert.equal(await code({action: 'hide', id: job.id}), 'scenario_not_ready');
  assert.equal(await code({action: 'chunk', id: job.id, offset: 7, data: 'AAAA'}), 'upload_chunk_invalid');
  assert.equal(await code({action: 'finish', id: job.id}), 'upload_incomplete');
  assert.equal(await code({action: 'converse', id: job.id}), 'guidance_not_ready');
  assert.equal(await code({action: 'nonsense', id: job.id}), 'unknown_action');
});

test('independent real setup workers retain campaign binding and saved presentation artifacts', async t => {
  const f = fixture(t);
  const host = createPreparationHost(f.home, f.options);
  const tasks = ['campaign-one', 'campaign-two'].map(campaign => host.start('converse', {campaign, module_id: 'selected-story', title: campaign, play_language: 'en'}));
  f.active.push(...tasks);
  const outputs = await Promise.all(tasks.map(task => observe(task).complete));
  assert.deepEqual(outputs.map(output => output.events.find(event => event.type === 'result')?.data.campaign).sort(), ['campaign-one', 'campaign-two']);
  assert.equal(new Set(kernelEvents(f.home).map(event => event.pid)).size, 2);
  for (const campaign of ['campaign-one', 'campaign-two']) {
    const saved = JSON.parse(readFileSync(join(f.home, '.coc/campaigns', campaign, 'campaign.json'), 'utf8'));
    assert.equal(saved.id, campaign);
    assert.equal(saved.status, 'setting_up');
    assert.ok(kernelEvents(f.home).some(event => event.campaign === campaign));
  }
  const presentation = host.start('presentation', {campaign: 'campaign-one', play_language: 'en', standing: true});
  f.active.push(presentation);
  const output = await observe(presentation).complete;
  assert.equal(output.code, 0, output.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(f.home, '.coc/campaigns/campaign-one/setup/presentations/standing-en.json'), 'utf8')), {play_language: 'en', texts: {}});
  const possessions = host.start('presentation', {campaign: 'campaign-one', play_language: 'en', possessions: true});
  f.active.push(possessions);
  const carried = await observe(possessions).complete;
  assert.equal(carried.code, 0, carried.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(f.home, '.coc/campaigns/campaign-one/setup/presentations/possessions-en.json'), 'utf8')), {play_language: 'en', texts: {}});
  const clues = host.start('presentation', {campaign: 'campaign-one', play_language: 'en', clues: true});
  f.active.push(clues);
  const found = await observe(clues).complete;
  assert.equal(found.code, 0, found.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(f.home, '.coc/campaigns/campaign-one/setup/presentations/clues-en.json'), 'utf8')), {play_language: 'en', texts: {}});
});

test('cancelling a real cold worker awaits kernel exit and permits a fresh owner to retry', async t => {
  const f = fixture(t);
  const slow = createPreparationHost(f.home, {...f.options, env: {...f.env, RUNTIME_DELAY: '1'}});
  const controller = new AbortController();
  const task = slow.start('catalog', {play_language: 'en'}, controller.signal);
  f.active.push(task);
  const result = observe(task);
  const [started] = await eventually(() => kernelEvents(f.home).length && kernelEvents(f.home), 'catalog kernel did not start');
  controller.abort();
  const closed = task.close();
  assert.equal(task.close(), closed);
  await closed;
  const output = await result.complete;
  assert.equal(output.events.some(event => event.type === 'result'), false);
  assert.throws(() => process.kill(started.pid, 0), {code: 'ESRCH'});
  assert.throws(() => slow.start('catalog', {}, controller.signal), /cancelled/);
  const retry = createPreparationHost(f.home, f.options).start('catalog', {play_language: 'en'});
  f.active.push(retry);
  assert.equal((await observe(retry).complete).code, 0);
  assert.ok(existsSync(join(f.home, 'kernel-events.jsonl')));
});

test('an abruptly exiting preparation worker cannot orphan its descendant process', {timeout: 10000}, async t => {
  const f = fixture(t, `
import {spawn} from 'node:child_process';
const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore',process.stdout,process.stderr]});
child.once('spawn',()=>{process.stdout.write(JSON.stringify({type:'descendant',data:{pid:child.pid}})+'\\n');process.exit(1);});
`);
  const task = createPreparationHost(f.home, f.options).start('catalog', {});
  f.active.push(task);
  const output = await observe(task).complete;
  assert.equal(output.code, 1);
  const pid = output.events.find(event => event.type === 'descendant').data.pid;
  await eventually(() => {try {process.kill(pid, 0); return false;} catch (error) {return error.code === 'ESRCH';}}, 'worker descendant survived its owner');
});

const phaseWorker = `
import {appendFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const [action,raw]=process.argv.slice(2),input=JSON.parse(raw),home=input.home;
const emit=(type,data)=>process.stdout.write(JSON.stringify({type,data})+'\\n');
const retained=join(home,'transport-attempts.jsonl');
appendFileSync(retained,JSON.stringify({action,pid:process.pid,campaign:input.campaign})+'\\n');
if(action==='inspect')emit('result',{module_id:'retained-book',page_count:2});
else if(action==='guidance'&&!existsSync(join(home,'resume-ready'))){
 const timer=setInterval(()=>{},1000);
 process.on('SIGTERM',()=>{writeFileSync(join(home,'release-receipt.json'),JSON.stringify({released:true}));clearInterval(timer);process.exitCode=1;});
 emit('progress',{stage:'reading',reviewed:1,review_total:2});
}else if(action==='guidance')emit('result',{module_id:'retained-book',guidance:{scene:'Dock'},guidance_key:'accepted'});
else if(action==='opening')emit('result',{module_id:'retained-book',opening_ready:true});
else if(action==='converse')emit('result',{campaign:input.campaign});
else if(action==='catalog'){
 const timer=setInterval(()=>{},1000);process.on('SIGTERM',()=>{clearInterval(timer);process.exitCode=1;});
 emit('progress',{stage:'catalog-running'});
}
`;

function trackedHost(f) {
  const entrypoint = join(f.resourceRoot, 'build/runtime/preparation.mjs');
  mkdirSync(dirname(entrypoint), {recursive: true});
  buildSync({entryPoints: [join(root, 'runtime/preparation.ts')], outfile: entrypoint,
    bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', logLevel: 'silent'});
  const host = new CocOnboardingHost({repo: f.resourceRoot, home: f.home, agentDir: f.agentHome,
    contentRoot: f.contentRoot, nodeExecutable: f.nodeExecutable, env: f.env});
  f.active.push(host);
  return host;
}

test('tracked onboarding retains uploads and progress across pause, host restart and campaign binding', async t => {
  const f = fixture(t, phaseWorker);
  const first = trackedHost(f);
  let job = await first.invoke({action: 'begin', name: 'source.pdf', size: 9, play_language: 'en'}, 'session-one', model);
  await first.invoke({action: 'chunk', id: job.id, offset: 0, data: Buffer.from('%PDF-test').toString('base64')}, 'session-one', model);
  await first.invoke({action: 'finish', id: job.id}, 'session-one', model);
  const jobPath = join(f.home, '.coc/imports', job.id, 'job.json');
  await eventually(() => JSON.parse(readFileSync(jobPath, 'utf8')).preparation.guidance.progress?.reviewed === 1, 'guidance progress was not saved');
  await first.invoke({action: 'pause', id: job.id, target: 'all'}, 'session-one', model);
  const closing = first.close();
  assert.equal(first.close(), closing);
  await closing;
  assert.deepEqual(JSON.parse(readFileSync(join(f.home, 'release-receipt.json'), 'utf8')), {released: true});
  assert.equal(readFileSync(join(dirname(jobPath), 'source.pdf'), 'utf8'), '%PDF-test');
  assert.match(readFileSync(join(dirname(jobPath), 'events.jsonl'), 'utf8'), /"reviewed":1/);
  const resumed = trackedHost(f);
  job = await resumed.invoke({action: 'status', id: job.id}, 'session-one', model);
  assert.equal(job.preparation.guidance.state, 'paused');
  assert.equal(job.preparation.guidance.progress.reviewed, 1);
  await assert.rejects(resumed.invoke({action: 'status', id: job.id}, 'another-session', model), /another session/);
  writeFileSync(join(f.home, 'resume-ready'), 'ready');
  await resumed.invoke({action: 'resume', id: job.id}, 'session-one', model);
  await eventually(() => JSON.parse(readFileSync(jobPath, 'utf8')).preparation.opening.state === 'ready', 'opening did not resume');
  job = await resumed.invoke({action: 'converse', id: job.id}, 'session-one', model);
  const campaign = job.campaign;
  assert.equal((await resumed.invoke({action: 'converse', id: job.id}, 'session-one', model)).campaign, campaign);
  assert.equal(readFileSync(join(dirname(jobPath), 'source.pdf'), 'utf8'), '%PDF-test');
  assert.equal(JSON.parse(readFileSync(jobPath, 'utf8')).state, 'conversing');
});

test('tracked host close includes cold catalog work and rejects any later launch', async t => {
  const f = fixture(t, phaseWorker);
  const host = trackedHost(f);
  const task = host.invoke({action: 'catalog'}, 'session-one', model);
  const rejected = assert.rejects(task, /interrupted|closed|cancelled/i);
  const attempt = await eventually(() => {
    const path = join(f.home, 'transport-attempts.jsonl');
    return existsSync(path) && JSON.parse(readFileSync(path, 'utf8').trim());
  }, 'cold catalog did not start');
  await host.close();
  await rejected;
  assert.throws(() => process.kill(attempt.pid, 0), {code: 'ESRCH'});
  await assert.rejects(host.invoke({action: 'catalog'}, 'session-one', model), /closed/);
});
