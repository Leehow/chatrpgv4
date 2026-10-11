/**
 * A kernel that never answers, or whose grandchild keeps its pipes open, must fail the call at its deadline
 * and must not keep the host process alive afterwards (the LAN box showed `node --test` hanging for 47+ minutes
 * behind a timed-out `campaign.create`). Each scenario runs in its own node process so "the process exits" is
 * observed, not assumed.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const CLIENT = resolve(ROOT, 'extensions/kernel/client.ts');

// The fake kernel: starts a grandchild that inherits stdout/stderr and sleeps, then reads stdin and never answers.
// `ignore-term` also ignores SIGTERM, so only the SIGKILL escalation ends it.
const KERNEL = `
const { spawn } = require('node:child_process');
const mode = process.argv[1];
spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 25000)'], { stdio: ['ignore', 'inherit', 'inherit'] });
if (mode === 'ignore-term') process.on('SIGTERM', () => {});
process.stdin.resume();
setInterval(() => {}, 1000);
`;

const DRIVER = (mode) => `
import { KernelClient } from ${JSON.stringify(CLIENT)};
const client = new KernelClient({ command: [process.execPath, '-e', ${JSON.stringify(KERNEL)}, ${JSON.stringify(mode)}], cwd: ${JSON.stringify(ROOT)}, inheritEnv: true, timeoutMs: 400, closeGraceMs: 300 });
let timedOut = false;
try { await client.call('campaign.create', {}); } catch (e) { timedOut = /did not answer within 400 ms/.test(String(e.message)); }
try { await client.close(); } catch { /* a shutdown that gave up still has to let go */ }
console.log(timedOut ? 'TIMED_OUT' : 'NO_TIMEOUT');
`;

for (const mode of ['exit-on-term', 'ignore-term']) {
  test(`unresponsive kernel (${mode}): call times out, close() lets go, host exits promptly`, async () => {
    const started = Date.now();
    const child = spawn(process.execPath, ['--input-type=module', '-e', DRIVER(mode)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const killer = setTimeout(() => child.kill('SIGKILL'), 12000);
    const code = await new Promise((done) => child.on('exit', (c, sig) => done(sig ?? c)));
    clearTimeout(killer);
    assert.equal(code, 0, `driver did not exit cleanly (hung or crashed): ${code}\n${err}`);
    assert.match(out, /TIMED_OUT/);
    assert.ok(Date.now() - started < 10000, `host stayed alive ${Date.now() - started} ms after close()`);
  });
}
