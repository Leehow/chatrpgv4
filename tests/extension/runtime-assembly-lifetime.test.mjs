import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, copyFile, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { assembleRuntime } from '../../scripts/package-runtime.mjs';
import { createAssemblyWorkspace, DIAGNOSTIC_LIMIT_BYTES, removeAssemblyTreeSync } from '../../scripts/assembly-workspace.mjs';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
const present = path => lstat(path).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const groupAlive = pid => {
  try { process.kill(-pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; if (error.code === 'EPERM') return true; throw error; }
};
const listenerCounts = () => SIGNALS.map(signal => process.listenerCount(signal));

async function until(check, label, timeout = 8_000) {
  const start = Date.now();
  while (!await check()) {
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${label}`);
    await delay(15);
  }
}

async function tempRepo(t) {
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'pi-coc-assembly-test-')));
  t.after(() => removeAssemblyTreeSync(repo));
  return repo;
}

async function workspaceFixture(t, signal) {
  const repo = await tempRepo(t);
  const workspace = await createAssemblyWorkspace({ repo, output: '.tmp/runtime', signal });
  t.after(() => workspace.cleanup().catch(() => {}));
  return { repo, workspace };
}

async function assemblerFixture(t) {
  const repo = await tempRepo(t);
  // This profile passes input validation only. Every operation below stops before
  // extracting/installing any runtime, and an explicit archive prevents downloads.
  const bytes = 'not an archive; the tar command is stubbed in isolated signal tests';
  const archive = { url: 'https://invalid.example/node.tar.gz', sha256: createHash('sha256').update(bytes).digest('hex') };
  await mkdir(join(repo, 'pipicoc'), { recursive: true });
  await writeFile(join(repo, 'pipicoc/runtime-dependencies.json'), JSON.stringify({
    schemaVersion: 1, platform: process.platform, architecture: process.arch,
    production: {}, requiredEntries: [], resourceDirectories: [], hostAssets: [], node: archive, git: archive,
  }));
  await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'assembly-fixture', version: '1.0.0', type: 'module', dependencies: {} }));
  await writeFile(join(repo, 'package-lock.json'), JSON.stringify({ packages: {} }));
  await writeFile(join(repo, 'archive.tar.gz'), bytes);
  return repo;
}

function testProcess(t, command, args, options = {}) {
  const child = spawn(command, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'], ...options });
  let stdout = '', stderr = '';
  child.stdout?.on('data', bytes => { stdout += bytes; });
  child.stderr?.on('data', bytes => { stderr += bytes; });
  const closed = new Promise((accept, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => accept({ code, signal, stdout, stderr }));
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed.catch(() => {});
  });
  return { child, closed };
}

// The descendant deliberately keeps writing until it really exits. A marker is
// outside work so the test can prove no chmod/removal occurs before group shutdown.
const WRITER = `
const fs = require('node:fs'), path = require('node:path');
const [work, notice, pgid, mode] = process.argv.slice(1);
const write = () => { fs.mkdirSync(work, {recursive:true}); fs.writeFileSync(path.join(work, 'writer.log'), 'still running'); };
write(); const timer = setInterval(write, 5);
process.on('SIGTERM', () => {
  fs.writeFileSync(path.join(notice, 'stopping.json'), JSON.stringify({pid:process.pid}));
  if (mode !== 'stubborn') setTimeout(() => { clearInterval(timer); process.exit(0); }, 250);
});
fs.writeFileSync(path.join(notice, 'ready.json'), JSON.stringify({pid:process.pid, pgid:Number(pgid) || process.pid, work}));
if (process.send) process.send('ready');
`;

function orphanParent(work, notice, inherited) {
  return `
const {spawn} = require('node:child_process');
const child = spawn(process.execPath, ['-e', ${JSON.stringify(WRITER)}, ${JSON.stringify(work)}, ${JSON.stringify(notice)}, String(process.pid), 'stubborn'],
  {stdio:['ignore', ${JSON.stringify(inherited ? 'inherit' : 'ignore')}, ${JSON.stringify(inherited ? 'inherit' : 'ignore')}, 'ipc']});
child.once('message', () => { console.log('parent completed'); process.exit(0); });
`;
}

function reapFixtureGroup(t, notice) {
  t.after(async () => {
    if (!await present(join(notice, 'ready.json'))) return;
    const { pgid } = await json(join(notice, 'ready.json'));
    if (groupAlive(pgid)) process.kill(-pgid, 'SIGKILL');
    await until(() => !groupAlive(pgid), 'fixture group exit');
  });
}

test('actual assembler failure cleans work, preserves diagnostics, and detaches signal handlers', async t => {
  const repo = await assemblerFixture(t), before = listenerCounts();
  let failure;
  try { await assembleRuntime({ repo, output: '.tmp/runtime', nodeArchive: 'missing.tar.gz' }); }
  catch (error) { failure = error; }
  assert.match(failure?.message ?? '', /Supplied archive is missing/);
  const evidence = failure.message.match(/Assembly evidence retained at (.+)$/m)?.[1];
  assert.ok(evidence?.startsWith(join(repo, '.build.noindex/')));
  assert.equal((await json(join(evidence, 'failure.json'))).diagnostics, evidence);
  assert.deepEqual(await readdir(join(repo, '.tmp')), []);
  assert.deepEqual(listenerCounts(), before);
});

test('successful publication keeps the receipt and output; only bounded known diagnostics survive outer-stage removal', async t => {
  const repo = await tempRepo(t), stage = join(repo, '.build.noindex/pipicoc/package-stub');
  const workspace = await createAssemblyWorkspace({ repo, output: join(stage, 'runtime') });
  await writeFile(join(workspace.resource, 'assembly.json'), '{"valid":true}\n');
  await writeFile(join(workspace.resource, 'payload'), 'runtime\n');
  await writeFile(join(workspace.work, 'result.json'), '{"ok":true}\n');
  await writeFile(join(workspace.work, 'native-smoke.log'), 'finished\n');
  for (const name of ['archives', 'dependencies/node_modules', 'node-toolchain', 'previous.app']) {
    await mkdir(join(workspace.work, name), { recursive: true });
    await writeFile(join(workspace.work, name, 'npm-ci.log'), 'not a retained root log');
  }
  await writeFile(join(workspace.work, 'unknown.log'), 'not retained');
  await workspace.publish();
  await workspace.cleanup();
  assert.equal(await present(workspace.work), false);
  assert.deepEqual(await json(join(workspace.output, 'assembly.json')), { valid: true });
  assert.equal(await readFile(join(workspace.output, 'payload'), 'utf8'), 'runtime\n');
  assert.deepEqual((await readdir(workspace.evidence)).sort(), ['diagnostics.json', 'native-smoke.log', 'result.json']);
  const receipt = { assemblyEvidence: workspace.evidence };
  removeAssemblyTreeSync(stage);
  assert.deepEqual(await json(join(receipt.assemblyEvidence, 'result.json')), { ok: true });
});

test('failure removes owned read-only partials without touching historical data or symlink targets', async t => {
  const { repo, workspace } = await workspaceFixture(t);
  const outside = join(repo, '.coc/historical');
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, 'turn.json'), 'historical evidence');
  await chmod(join(outside, 'turn.json'), 0o400);
  await chmod(outside, 0o500);
  const before = [(await lstat(outside)).mode, (await lstat(join(outside, 'turn.json'))).mode];
  await symlink(outside, join(workspace.work, 'external'));
  await symlink(join(outside, 'turn.json'), join(workspace.work, 'npm-ci.log'));
  await writeFile(join(workspace.output, 'partial'), 'not published');
  await mkdir(join(workspace.work, 'dependencies/node_modules'), { recursive: true });
  await writeFile(join(workspace.work, 'failure.json'), '{"message":"stub failure"}\n');
  await chmod(join(workspace.work, 'failure.json'), 0o400);
  await chmod(join(workspace.work, 'dependencies'), 0o500);
  await chmod(workspace.work, 0o500);
  await chmod(workspace.output, 0o500);
  await workspace.cleanup({ preserveOutput: false });
  assert.equal(await present(workspace.work), false);
  assert.equal(await present(workspace.output), false);
  assert.deepEqual(await json(join(workspace.evidence, 'failure.json')), { message: 'stub failure' });
  assert.equal(await present(join(workspace.evidence, 'npm-ci.log')), false);
  assert.equal(await readFile(join(outside, 'turn.json'), 'utf8'), 'historical evidence');
  assert.deepEqual([(await lstat(outside)).mode, (await lstat(join(outside, 'turn.json'))).mode], before);
});

test('oversized logs retain a bounded tail and oversized JSON remains valid with truncation recorded', async t => {
  const { workspace } = await workspaceFixture(t);
  const file = await open(join(workspace.work, 'npm-ci.log'), 'w');
  await file.truncate(DIAGNOSTIC_LIMIT_BYTES * 20);
  await file.write('last log line\n', DIAGNOSTIC_LIMIT_BYTES * 20 - 14);
  await file.close();
  await writeFile(join(workspace.work, 'result.json'), JSON.stringify({ huge: 'x'.repeat(DIAGNOSTIC_LIMIT_BYTES * 2) }));
  await workspace.cleanup();
  assert.equal((await lstat(join(workspace.evidence, 'npm-ci.log'))).size, DIAGNOSTIC_LIMIT_BYTES);
  assert.ok((await readFile(join(workspace.evidence, 'npm-ci.log'), 'utf8')).endsWith('last log line\n'));
  assert.equal((await json(join(workspace.evidence, 'result.json'))).truncated, true);
  const { files } = await json(join(workspace.evidence, 'diagnostics.json'));
  assert.equal(files.length, 2);
  for (const entry of files) { assert.equal(entry.truncated, true); assert.ok(entry.retainedBytes <= DIAGNOSTIC_LIMIT_BYTES); }
});

test('concurrent operations reserve the same output exclusively; the loser cannot remove the winner', async t => {
  const repo = await tempRepo(t);
  const outcomes = await Promise.allSettled([
    createAssemblyWorkspace({ repo, output: '.tmp/runtime' }),
    createAssemblyWorkspace({ repo, output: '.tmp/runtime' }),
  ]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(outcomes.find(result => result.status === 'rejected').reason.message, /already exists/);
  const winner = outcomes.find(result => result.status === 'fulfilled').value;
  await writeFile(join(winner.resource, 'assembly.json'), '{"winner":true}');
  await winner.publish();
  await winner.cleanup();
  await assert.rejects(createAssemblyWorkspace({ repo, output: winner.output }), /already exists/);
  assert.deepEqual(await json(join(winner.output, 'assembly.json')), { winner: true });
  assert.deepEqual(await readdir(join(repo, '.tmp')), ['runtime']);
});

test('publication and failure cleanup never overwrite or delete an externally replaced output', async t => {
  const { repo, workspace } = await workspaceFixture(t);
  await rename(workspace.output, join(repo, '.tmp/original-reservation'));
  await mkdir(workspace.output);
  await writeFile(join(workspace.output, 'foreign'), 'another owner');
  await assert.rejects(workspace.publish(), /ownership changed/);
  await workspace.cleanup({ preserveOutput: false });
  assert.equal(await readFile(join(workspace.output, 'foreign'), 'utf8'), 'another owner');
});

for (const kind of ['directory', 'file', 'dangling-link']) test(`pre-existing ${kind} output is rejected untouched`, async t => {
  const repo = await tempRepo(t), output = join(repo, '.tmp/runtime');
  await mkdir(dirname(output), { recursive: true });
  if (kind === 'directory') { await mkdir(output); await writeFile(join(output, 'keep'), 'keep'); }
  else if (kind === 'file') await writeFile(output, 'keep');
  else await symlink(join(repo, 'missing'), output);
  const before = await lstat(output);
  await assert.rejects(createAssemblyWorkspace({ repo, output }), /already exists/);
  const after = await lstat(output);
  assert.equal(after.ino, before.ino); assert.equal(after.mode, before.mode);
  assert.deepEqual(await readdir(dirname(output)), ['runtime']);
});

test('command success, failure, spawn error and timeout retire their child-group leases promptly', async t => {
  const { workspace } = await workspaceFixture(t);
  const result = await workspace.run(process.execPath, ['-e', "console.log('ok')"], { log: join(workspace.work, 'native-smoke.log') });
  assert.equal(result.stdout, 'ok\n');
  await assert.rejects(workspace.run(process.execPath, ['-e', 'process.exit(7)']), /failed \(7\)/);
  await assert.rejects(workspace.run(join(workspace.work, 'no-such-executable'), []), /ENOENT/);
  await assert.rejects(workspace.run(process.execPath, ['-e', 'setInterval(()=>{},10)'], { timeout: 50 }), /timeout/);
  assert.equal(workspace.children.size, 0, 'finished commands leave no stale pgids for later cleanup');
  await workspace.cleanup();
  assert.equal(await readFile(join(workspace.evidence, 'native-smoke.log'), 'utf8'), 'ok\n');
});

for (const [inherited, timeout] of [[true, 6_000], [false, 6_000], [true, 1_000]]) test(`exited parent with descendant ${inherited ? 'inheriting pipes' : 'ignoring stdio'}${timeout === 1_000 ? ' after timeout' : ''} is stopped and confirmed before cleanup`, { timeout: 12_000 }, async t => {
  const { repo, workspace } = await workspaceFixture(t);
  reapFixtureGroup(t, repo);
  const running = workspace.run(process.execPath, ['-e', orphanParent(workspace.work, repo, inherited)], { timeout });
  await until(() => present(join(repo, 'stopping.json')), 'descendant shutdown');
  const { pgid } = await json(join(repo, 'ready.json'));
  assert.equal(groupAlive(pgid), true, 'the descendant outlives its parent');
  assert.equal(await present(workspace.work), true);
  if (timeout === 1_000) await assert.rejects(running, /timeout/);
  else assert.equal((await running).stdout, 'parent completed\n');
  assert.equal(groupAlive(pgid), false, 'group absence, not merely a sent SIGKILL, permits cleanup');
  assert.equal(workspace.children.size, 0);
  await workspace.cleanup();
  assert.equal(await present(workspace.work), false);
});

test('stop-confirmation timeout is explicit and does not delete live work; a later confirmation permits cleanup', { timeout: 12_000 }, async t => {
  const { workspace } = await workspaceFixture(t);
  const { child } = testProcess(t, process.execPath, ['-e', 'setInterval(()=>{},10)']);
  workspace.trackChild(child);
  const originalKill = process.kill;
  // Withhold delivery only to this real fixture group. Its zero-signal liveness
  // query stays real, so the deadline must not count a still-running group as gone.
  // Restore delivery before retrying cleanup; no test process is left alive.
  process.kill = function(pid, signal) {
    if (pid === -child.pid && (signal === 'SIGTERM' || signal === 'SIGKILL')) return true;
    return originalKill.call(this, pid, signal);
  };
  try {
    await assert.rejects(workspace.cleanup(), error => error.cleanupBlocked && error.errors.some(item => item.code === 'ASSEMBLY_CHILD_STOP_TIMEOUT'));
    assert.equal(await present(workspace.work), true);
    assert.equal(await present(workspace.output), true);
    assert.match((await json(join(workspace.evidence, 'cleanup.json'))).errors[0].message, /did not stop after SIGKILL/);
  } finally { process.kill = originalKill; }
  await workspace.cleanup();
  assert.equal(await present(workspace.work), false);
});

async function signalSandbox(t, route, orphan = false, diagnosticWriteCode) {
  const repo = await assemblerFixture(t);
  for (const path of ['scripts/assembly-workspace.mjs', 'scripts/package-runtime.mjs', 'pipicoc/package.mjs', 'pipicoc/package-config.mjs', 'runtime/deployment.mjs', 'pipicoc/product.json']) {
    await mkdir(dirname(join(repo, path)), { recursive: true });
    await copyFile(join(REPO, path), join(repo, path));
  }
  const preload = join(repo, 'preload.mjs');
  await writeFile(preload, `
import cp from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import {join,basename} from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
const repo=${JSON.stringify(repo)}, spawn=cp.spawn, rm=fsp.rm, rmSync=fs.rmSync, writeFile=fsp.writeFile, kill=process.kill;
const diagnosticWriteCode=${JSON.stringify(diagnosticWriteCode)};
const WRITER=${JSON.stringify(WRITER)};
const workPath=()=>{
  const parent=${JSON.stringify(route === 'packager')} ? join(repo,'.build.noindex/pipicoc',fs.readdirSync(join(repo,'.build.noindex/pipicoc'))[0]) : join(repo,'.tmp');
  return join(parent,fs.readdirSync(parent).find(name=>name.startsWith('.package-runtime-')));
};
cp.spawn=(command,args,options)=>{
  if(command!=='/usr/bin/tar')throw new Error('Unexpected assembly command: '+command);
  const child=${JSON.stringify(orphan)}
    ? spawn(process.execPath,['-e',(${orphanParent.toString()})(workPath(),repo,true)],options)
    : spawn(process.execPath,['-e',${JSON.stringify(WRITER)},workPath(),repo,'0','graceful'],options);
  if(diagnosticWriteCode)process.kill=(pid,signal)=>{
    if(pid===-child.pid&&(signal==='SIGTERM'||signal==='SIGKILL'))return true;
    return kill(pid,signal);
  };
  return child;
};
cp.execFileSync=(command,args)=>{
  if(command==='/bin/ps')return '';
  if(command==='npm')return '';
  throw new Error('Unexpected packaging command: '+command);
};
fsp.writeFile=async(path,...args)=>{
  if(diagnosticWriteCode&&basename(path)==='cleanup.json')throw Object.assign(new Error('Injected diagnostic write failure'),{code:diagnosticWriteCode});
  return writeFile(path,...args);
};
fsp.rm=async(path,options)=>{
  if(basename(path).startsWith('.package-runtime-')){
    const {pgid}=JSON.parse(fs.readFileSync(join(repo,'ready.json'),'utf8'));
    let stopped=false;try{process.kill(-pgid,0);}catch(error){if(error.code!=='ESRCH')throw error;stopped=true;}
    fs.writeFileSync(join(repo,'cleanup-started.json'),JSON.stringify({stopped,work:path}));
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  return rm(path,options);
};
fs.rmSync=(path,options)=>{
  if(basename(path).startsWith('package-')){
    const entries=fs.readdirSync(join(repo,'.build.noindex')).filter(name=>name.startsWith('assembly-'));
    const evidence=entries.map(name=>join(repo,'.build.noindex',name));
    if(!diagnosticWriteCode&&!evidence.some(path=>fs.existsSync(join(path,'failure.json'))))throw new Error('Outer purge raced diagnostics');
    fs.writeFileSync(join(repo,'outer-purged.json'),JSON.stringify({evidence}));
  }
  return rmSync(path,options);
};
globalThis.fetch=()=>{throw new Error('Network is forbidden in assembly lifecycle tests');};
syncBuiltinESMExports();
`);
  const driver = join(repo, 'imported.mjs');
  await writeFile(driver, `
import {assembleRuntime} from './scripts/package-runtime.mjs';
const signals=${JSON.stringify(SIGNALS)}, before=signals.map(name=>process.listenerCount(name));
try{await assembleRuntime({repo:${JSON.stringify(repo)},output:'.tmp/runtime',nodeArchive:'archive.tar.gz',gitArchive:'archive.tar.gz'});process.exitCode=2;}
catch(error){console.error(error.message);process.exitCode=1;}
console.log(JSON.stringify({before,after:signals.map(name=>process.listenerCount(name))}));
`);
  const blockedDriver = join(repo, 'blocked-outer.mjs');
  if (diagnosticWriteCode) await writeFile(blockedDriver, `
import fs from 'node:fs';
try { await import('./pipicoc/package.mjs'); }
catch(error) {
  fs.writeFileSync(${JSON.stringify(join(repo, 'blocked-result.json'))},JSON.stringify({
    cleanupBlocked:error.cleanupBlocked===true,diagnosticCode:error.diagnosticError?.code,
    stopCodes:error.errors?.map(item=>item.code),message:error.message,
  }));
  process.exit(1);
}
process.exit(2);
`);
  const entry = route === 'imported' ? [driver] : route === 'cli'
    ? [join(repo, 'scripts/package-runtime.mjs'), '--repo', repo, '--output', '.tmp/runtime', '--node-archive', 'archive.tar.gz', '--git-archive', 'archive.tar.gz']
    : [diagnosticWriteCode ? blockedDriver : join(repo, 'pipicoc/package.mjs')];
  const operation = testProcess(t, process.execPath, ['--import', preload, ...entry], { env: {
    ...process.env, PIPICOC_NODE_ARCHIVE: join(repo, 'archive.tar.gz'), PIPICOC_GIT_ARCHIVE: join(repo, 'archive.tar.gz'),
    PIPICOC_APP_HOME: join(repo, 'package-home'), PIPICOC_APP_BUNDLE: join(repo, 'unused-output.app'),
  } });
  reapFixtureGroup(t, repo);
  return { repo, ...operation };
}

for (const [route, orphan] of [['imported', false], ['cli', false], ['packager', false], ['imported', true]]) for (const signal of SIGNALS) {
  test(`${route}${orphan ? ' with exited parent and inherited pipes' : ''}: real ${signal} and repeated signals during cleanup preserve diagnostics without stopping unrelated children`, { timeout: 12_000 }, async t => {
    const { repo, child, closed } = await signalSandbox(t, route, orphan);
    const unrelated = testProcess(t, process.execPath, ['-e', 'setInterval(()=>{},20)']);
    await until(() => present(join(repo, 'ready.json')), 'owned child ready');
    child.kill(signal);
    await until(() => present(join(repo, 'cleanup-started.json')), 'asynchronous cleanup');
    const cleanup = await json(join(repo, 'cleanup-started.json'));
    assert.equal(cleanup.stopped, true, 'owned group was confirmed absent before removal');
    child.kill(signal);
    await delay(50);
    child.kill(signal);
    const result = await closed;
    assert.equal(result.signal, null, `repeated ${signal} did not invoke the default termination path: ${result.stderr}`);
    assert.notEqual(result.code, 0);
    assert.equal(await present(cleanup.work), false);
    assert.equal(unrelated.child.exitCode, null);
    assert.equal(unrelated.child.signalCode, null);
    assert.equal(process.kill(unrelated.child.pid, 0), true);
    const evidence = (await readdir(join(repo, '.build.noindex'))).filter(name => name.startsWith('assembly-'));
    assert.equal(evidence.length, 1);
    assert.match((await json(join(repo, '.build.noindex', evidence[0], 'failure.json'))).message, new RegExp(signal));
    if (route === 'imported') { const { before, after } = JSON.parse(result.stdout.trim()); assert.deepEqual(after, before); }
    if (route === 'packager') {
      assert.deepEqual(await readdir(join(repo, '.build.noindex/pipicoc')), []);
      const receipt = await json(join(repo, 'outer-purged.json'));
      assert.equal(await present(join(receipt.evidence[0], 'failure.json')), true);
      assert.equal(await present(join(repo, 'unused-output.app')), false);
    } else assert.deepEqual(await readdir(join(repo, '.tmp')), []);
  });
}

test('blocked cleanup plus diagnostic ENOSPC preserves the original safety error and the real outer stage', { timeout: 15_000 }, async t => {
  const { repo, child, closed } = await signalSandbox(t, 'packager', false, 'ENOSPC');
  await until(() => present(join(repo, 'ready.json')), 'owned child ready');
  const { pgid, work } = await json(join(repo, 'ready.json'));
  try {
    child.kill('SIGTERM');
    const result = await closed;
    assert.equal(result.signal, null);
    assert.equal(result.code, 1);
    const blocked = await json(join(repo, 'blocked-result.json'));
    assert.equal(blocked.cleanupBlocked, true, JSON.stringify(blocked));
    assert.equal(blocked.diagnosticCode, 'ENOSPC');
    assert.ok(blocked.stopCodes.includes('ASSEMBLY_CHILD_STOP_TIMEOUT'));
    assert.equal(groupAlive(pgid), true, 'the test really withheld delivery to a live group');
    assert.equal(await present(work), true, 'the inner work is still in use');
    assert.equal(await present(dirname(work)), true, 'the outer stage was not purged');
    assert.equal(await present(join(repo, 'outer-purged.json')), false);
  } finally {
    // Reaping is test teardown, after observing the safety failure, not production
    // cleanup pretending the withheld stop was confirmed.
    if (groupAlive(pgid)) process.kill(-pgid, 'SIGKILL');
    await until(() => !groupAlive(pgid), 'blocked fixture group exit');
  }
});

test('run with a log discards late stdout after failed stop and cannot write a reused FD', { timeout: 15_000 }, async t => {
  const repo = await tempRepo(t), driver = join(repo, 'fd-reuse.mjs');
  await writeFile(driver, `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {createAssemblyWorkspace} from ${JSON.stringify(new URL('../../scripts/assembly-workspace.mjs', import.meta.url).href)};
const repo=${JSON.stringify(repo)}, workspace=await createAssemblyWorkspace({repo,output:'.tmp/runtime'});
const log=join(workspace.work,'npm-ci.log'), sentinel=join(repo,'sentinel'), trigger=join(repo,'late-output');
const originalOpen=fs.openSync, originalKill=process.kill, sentinelFDs=[];
let logFD, lateBytes=0, afterReturn=false;
fs.openSync=(path,...args)=>{const fd=originalOpen(path,...args);if(path===log)logFD=fd;return fd;};
syncBuiltinESMExports();
try {
  const running=workspace.run(process.execPath,['-e',
    "const fs=require('node:fs');console.log('early');let sent=false;setInterval(()=>{if(!sent&&fs.existsSync(process.argv[1])){sent=true;const bytes=Buffer.alloc(65536,120);let n=0;const emit=()=>{if(n++===256){process.stderr.write('late stderr');return;}if(process.stdout.write(bytes))setImmediate(emit);else process.stdout.once('drain',emit);};emit();}},5);",
    trigger],{log,timeout:100});
  const lease=[...workspace.children][0], pid=lease.child.pid;
  fs.openSync=originalOpen;syncBuiltinESMExports();
  process.kill=(target,signal)=>{if(target===-pid&&(signal==='SIGTERM'||signal==='SIGKILL'))return true;return originalKill(target,signal);};
  lease.child.stdout.on('data',bytes=>{if(afterReturn)lateBytes+=bytes.length;});
  await assert.rejects(running,error=>error.code==='ASSEMBLY_CHILD_STOP_TIMEOUT');
  afterReturn=true;
  global.gc();const before=process.memoryUsage().arrayBuffers;
  fs.writeFileSync(sentinel,'sentinel must not change');
  for(let count=0;count<64;count++){
    const fd=fs.openSync(sentinel,'a');sentinelFDs.push(fd);if(fd===logFD)break;
  }
  assert.ok(sentinelFDs.includes(logFD),'the released log FD was actually reused');
  fs.writeFileSync(trigger,'emit late output');
  const deadline=Date.now()+5000;
  while(lateBytes<16*1024*1024){if(Date.now()>deadline)throw new Error('Late stdout did not drain');await delay(10);}
  await delay(50);global.gc();
  const retained=process.memoryUsage().arrayBuffers-before;
  assert.ok(fs.readFileSync(sentinel,'utf8')==='sentinel must not change','late data must not reach the reused FD');
  assert.ok(retained<4*1024*1024,'returned runner retained late output buffers: '+retained);
  assert.equal(originalKill(pid,0),true,'the late output came from the still-live child');
  console.log(JSON.stringify({lateBytes,retained,reusedFD:true}));
} finally {
  process.kill=originalKill;fs.openSync=originalOpen;syncBuiltinESMExports();
  for(const fd of sentinelFDs)fs.closeSync(fd);
  await workspace.cleanup();
}
`);
  const { closed } = testProcess(t, process.execPath, ['--expose-gc', driver]);
  const result = await closed;
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.signal, null);
  const observation = JSON.parse(result.stdout.trim());
  assert.equal(observation.reusedFD, true);
  assert.ok(observation.lateBytes >= 16 * 1024 * 1024);
});
