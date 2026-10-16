import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, lstatSync, symlinkSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createTestWorkspace, checkTestWorkspaceBudget, cloneTestFiles, shareTestTree, WORKSPACE_RECORD,TEST_OBJECTS,ARCHIVE_RECORD } from '../../scripts/test-workspace.mjs';
import { Daemon, build_parser } from '../play/driver.ts';

function fixture(t) {
  const root = mkdtempSync(join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'test-workspace-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const seed = join(root, 'seed');
  const put = (path, value) => { const full = join(seed, '.coc', path); mkdirSync(resolve(full, '..'), { recursive: true }); writeFileSync(full, value); };
  put('campaigns/table/campaign.json', JSON.stringify({ id: 'table', module_id: 'book' }));
  put('campaigns/table/world.json', '{"state":"initial"}');
  put('repos/table.git/HEAD', 'ref: refs/heads/main\n');
  put('module-campaigns/table/modules/book/module-graph.json', 'private graph');
  put('modules/book/source.pdf', Buffer.alloc(65536, 65));
  put('modules/book/work/attempt/task.json', '{"provenance":true}');
  put('mods/packages/example/mod.json', '{}');
  put('mods/jobs/old/input.json', 'old audit data');
  put('campaigns/other/campaign.json', '{}');
  put('playtests/previous/events.jsonl', 'previous results');
  return { root, seed, put };
}
function supportsCoW(t, root) {
  const a = join(root, 'probe-a'), b = join(root, 'probe-b'); writeFileSync(a, 'probe');
  try { cloneTestFiles([[a, b]]); return true; }
  catch (error) { if (['ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV'].includes(error.code)) { t.skip('Filesystem cannot provide forced reflinks'); return false; } throw error; }
}

test('two views share one seed with private writes, complete dependencies and exact provenance', t => {
  const { root, seed } = fixture(t); if (!supportsCoW(t, root)) return;
  const a = join(root, 'a'), b = join(root, 'b');
  const first = createTestWorkspace({ seed, destination: a, campaign: 'table' });
  createTestWorkspace({ seed, destination: b, campaign: 'table' });
  assert.equal(first.status, 'ready'); assert.equal(checkTestWorkspaceBudget(a).growthBytes, 0);
  for (const path of ['campaigns/table/world.json', 'repos/table.git/HEAD', 'modules/book/source.pdf', 'modules/book/work/attempt/task.json', 'module-campaigns/table/modules/book/module-graph.json', 'mods/packages/example/mod.json']) {
    assert.deepEqual(readFileSync(join(a, '.coc', path)), readFileSync(join(seed, '.coc', path)));
    assert.notEqual(lstatSync(join(a, '.coc', path)).ino, lstatSync(join(seed, '.coc', path)).ino);
  }
  for (const path of ['campaigns/other', 'playtests', 'mods/jobs']) assert.equal(existsSync(join(a, '.coc', path)), false);
  assert.match(first.files.find(row => row.path.endsWith('world.json')).sha256, /^[a-f0-9]{64}$/);
  const world = '.coc/campaigns/table/world.json';
  writeFileSync(join(a, world), 'changed first view');
  assert.equal(readFileSync(join(b, world), 'utf8'), '{"state":"initial"}');
  assert.equal(readFileSync(join(seed, world), 'utf8'), '{"state":"initial"}');
  assert.ok(checkTestWorkspaceBudget(a).growthBytes > 0);
  writeFileSync(join(seed, world), 'changed source');
  assert.equal(readFileSync(join(b, world), 'utf8'), '{"state":"initial"}');
});

test('admission refuses oversized seeds, links and existing destinations before copying', t => {
  const { root, seed, put } = fixture(t), destination = join(root, 'new');
  assert.throws(() => createTestWorkspace({ seed, destination, campaign: '../table' }), /campaign id/);
  assert.throws(() => createTestWorkspace({ seed, destination, campaign: 'table', limits: { seedBytes: 1 } }), /budget/);
  assert.equal(existsSync(destination), false);
  assert.throws(() => createTestWorkspace({ seed, destination, campaign: 'table', limits: { growthBytes: 1024 ** 3 } }), /reviewed/);
  mkdirSync(destination); writeFileSync(join(destination, 'result'), 'preserve');
  assert.throws(() => createTestWorkspace({ seed, destination, campaign: 'table' }), /existing/);
  assert.equal(readFileSync(join(destination, 'result'), 'utf8'), 'preserve');
  put('modules/book/target', 'private'); symlinkSync(join(seed, '.coc/modules/book/target'), join(seed, '.coc/modules/book/writable-link'));
  assert.throws(() => createTestWorkspace({ seed, destination: join(root, 'linked'), campaign: 'table' }), /fixture references/);
  assert.equal(existsSync(join(root, 'linked')), false);
});

test('managed live input is refused at the growth budget without sending a player prompt', async t => {
  const { root, seed } = fixture(t); if (!supportsCoW(t, root)) return;
  const home = join(root, 'home'); createTestWorkspace({ seed, destination: home, campaign: 'table', limits: { growthBytes: 5 } });
  writeFileSync(join(home, '.coc/new-result.json'), '123456');
  assert.throws(() => checkTestWorkspaceBudget(home), /admission refused/);
  assert.equal(JSON.parse(readFileSync(join(home, WORKSPACE_RECORD))).status, 'ready');
  const old = process.env.PI_COC_HOME; process.env.PI_COC_HOME = home;
  try {
    const response = await Daemon.prototype.handle_turn.call({ turn_in_progress: false, _run_turn() { assert.fail('Over-budget input reached the child'); } }, 'next input', 10);
    assert.equal(response.ok, false); assert.match(response.error, /admission refused/);
  } finally { if (old === undefined) delete process.env.PI_COC_HOME; else process.env.PI_COC_HOME = old; }
  assert.equal(readFileSync(join(home, '.coc/new-result.json'), 'utf8'), '123456');
  assert.equal(build_parser().parse_args(['start', '--campaign', 'table', '--seed-home', seed]).seed_home, seed);
  assert.throws(() => build_parser().parse_args(['start', '--campaign', 'table', '--seed-home']), /requires a retained/);
});

test('an open seed is protected before a destination is created', async t => {
  const { root, seed } = fixture(t), destination = join(root, 'blocked');
  const child = spawn(process.execPath, ['--input-type=module', '-e', 'import fs from "node:fs";fs.openSync(process.argv[1],"r");process.stdout.write("ready");setInterval(()=>{},1000);', join(seed, '.coc/campaigns/table/world.json')], { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => child.kill());
  await new Promise((accept, reject) => { child.stdout.once('data', accept); child.once('error', reject); });
  assert.throws(() => createTestWorkspace({ seed, destination, campaign: 'table' }), /open by process/);
  assert.equal(existsSync(destination), false);
});

test('run event logs consume the same budget as workspace changes', t => {
  const { root, seed } = fixture(t); if (!supportsCoW(t, root)) return;
  const evidence = join(root, 'evidence'), home = join(evidence, 'workspace');
  createTestWorkspace({ seed, destination: home, campaign: 'table', limits: { growthBytes: 5 } });
  assert.equal(checkTestWorkspaceBudget(home, evidence).growthBytes, 0);
  writeFileSync(join(evidence, 'events.jsonl'), '123456');
  assert.throws(() => checkTestWorkspaceBudget(home, evidence), /admission refused/);
  assert.equal(readFileSync(join(evidence, 'events.jsonl'), 'utf8'), '123456');
});

test('generic sharing covers binary assets, archives, logs, tiny files and empty directories', t => {
  const { root } = fixture(t); if (!supportsCoW(t, root)) return;
  const source = join(root, 'all-types'); mkdirSync(join(source, 'empty'), {recursive:true});
  const samples = new Map([['image.png',Buffer.from([0,255,1,128,0])],['source.pdf',Buffer.from('%PDF-1.7\n')],['snapshot.tar.gz',Buffer.from([31,139,8,0,255])],['events.jsonl',Buffer.from('{"event":1}\n')],['tiny.json',Buffer.from('{}')],['state.sqlite',Buffer.from('SQLite format 3\0')]]);
  for (const [name, bytes] of samples) writeFileSync(join(source,name),bytes);
  const a=join(root,'view-a'),b=join(root,'view-b'),first=shareTestTree(source,a),second=shareTestTree(source,b);
  assert.equal(first.files,samples.size);assert.equal(first.tree_sha256,second.tree_sha256);
  assert.equal(lstatSync(join(a,'empty')).isDirectory(),true);
  for(const [name,bytes] of samples){assert.deepEqual(readFileSync(join(a,name)),bytes);assert.notEqual(lstatSync(join(a,name)).ino,lstatSync(join(source,name)).ino);writeFileSync(join(a,name),'changed');assert.deepEqual(readFileSync(join(b,name)),bytes);assert.deepEqual(readFileSync(join(source,name)),bytes);}
  shareTestTree(join(source,'source.pdf'),join(root,'renamed.pdf'));
  assert.deepEqual(readFileSync(join(root,'renamed.pdf')),samples.get('source.pdf'));
  assert.throws(()=>shareTestTree(source,join(root,'too-large'),{limits:{seedBytes:1}}),/budget/);
  assert.equal(existsSync(join(root,'too-large')),false);
});

test('archived content references materialize as private writable regular files',t=>{
  const{root,seed}=fixture(t);if(!supportsCoW(t,root))return;
  const data=Buffer.from(JSON.stringify({test:randomUUID()})),digest=createHash('sha256').update(data).digest('hex'),directory=join(TEST_OBJECTS,digest.slice(0,2)),object=join(directory,digest+'-0600.json');mkdirSync(directory,{recursive:true});writeFileSync(object,data,{flag:'wx',mode:0o400});t.after(()=>rmSync(object));
  const world=join(seed,'.coc/campaigns/table/world.json');rmSync(world);symlinkSync(object,world);writeFileSync(join(seed,ARCHIVE_RECORD),JSON.stringify({kind:'test-data-archive'}));
  assert.throws(()=>checkTestWorkspaceBudget(seed),/Read-only test archive/);
  assert.throws(()=>shareTestTree(world,join(seed,'new.json')),/Read-only test archive/);
  assert.throws(()=>createTestWorkspace({seed,destination:join(seed,'new-view'),campaign:'table'}),/Read-only test archive/);
  const standalone=join(root,'standalone.json');shareTestTree(world,standalone);assert.equal(lstatSync(standalone).isFile(),true);assert.equal(lstatSync(standalone).mode&0o777,0o600);assert.deepEqual(readFileSync(standalone),data);
  const view=join(root,'private');createTestWorkspace({seed,destination:view,campaign:'table'});const privateWorld=join(view,'.coc/campaigns/table/world.json');assert.equal(lstatSync(privateWorld).isFile(),true);assert.equal(lstatSync(privateWorld).mode&0o777,0o600);writeFileSync(privateWorld,'changed');assert.deepEqual(readFileSync(object),data);
  const tree=join(root,'tree');shareTestTree(seed,tree);assert.equal(existsSync(join(tree,ARCHIVE_RECORD)),false);assert.equal(lstatSync(join(tree,'.coc/campaigns/table/world.json')).isFile(),true);
});
