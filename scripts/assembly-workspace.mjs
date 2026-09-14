import { spawn } from 'node:child_process';
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, renameSync, rmSync, chmodSync, writeSync } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, open, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const DIAGNOSTIC_NAMES = [
  'result.json', 'failure.json',
  'python-build-tool.log', 'npm-ci.log', 'fs-ext-build.log', 'native-smoke.log', 'git-smoke.log',
];
export const DIAGNOSTIC_LIMIT_BYTES = 256 * 1024;
const STOP_GRACE_MS = 2_000;
const STOP_KILL_MS = 2_000;
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
const within = (root, path) => path === root || path.startsWith(root + sep);
const dump = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });

// One removable subscription per operation, retained throughout asynchronous cleanup.
// Imported assembly aborts its own work; it never exits or signals its host process.
export function assemblySignals(signal) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  const handlers = SIGNALS.map(name => [name, () => controller.abort(new Error(`Assembly interrupted by ${name}`))]);
  for (const [name, handler] of handlers) process.on(name, handler);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  return {
    signal: controller.signal,
    dispose() {
      for (const [name, handler] of handlers) process.removeListener(name, handler);
      signal?.removeEventListener('abort', abort);
    },
  };
}

async function makeWritable(path) {
  const info = await lstat(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (!info || info.isSymbolicLink()) return;
  await chmod(path, (info.mode & 0o777) | (info.isDirectory() ? 0o700 : 0o600));
  if (info.isDirectory()) for (const name of await readdir(path)) await makeWritable(join(path, name));
}

// Synchronous output removal keeps the identity check and removal in one JS turn.
// Symlinks inside any owned tree are unlinked, never traversed or chmod'ed.
export function removeAssemblyTreeSync(path) {
  const info = lstatSync(path, { throwIfNoEntry: false });
  if (!info) return;
  if (!info.isSymbolicLink()) {
    chmodSync(path, (info.mode & 0o777) | (info.isDirectory() ? 0o700 : 0o600));
    if (info.isDirectory()) for (const name of readdirSync(path)) removeAssemblyTreeSync(join(path, name));
  }
  rmSync(path, { force: true, recursive: info.isDirectory() });
}

async function copyDiagnostics(work, evidence) {
  const files = [];
  for (const name of DIAGNOSTIC_NAMES) {
    // Do not follow a log replaced by a symlink or walk a dependency/toolchain tree.
    const info = await lstat(join(work, name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (!info?.isFile()) continue;
    const source = await open(join(work, name), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const { size } = await source.stat();
      const truncated = size > DIAGNOSTIC_LIMIT_BYTES;
      let bytes;
      if (truncated && name.endsWith('.json')) {
        bytes = Buffer.from(JSON.stringify({ truncated: true, originalBytes: size, reason: 'Diagnostic JSON exceeds the retention limit' }) + '\n');
      } else {
        const buffer = Buffer.alloc(Math.min(size, DIAGNOSTIC_LIMIT_BYTES));
        const { bytesRead } = await source.read(buffer, 0, buffer.length, Math.max(0, size - buffer.length));
        bytes = buffer.subarray(0, bytesRead);
      }
      await writeFile(join(evidence, name), bytes, { mode: 0o600 });
      files.push({ name, originalBytes: size, retainedBytes: bytes.length, truncated, selection: name.endsWith('.log') ? 'tail' : 'json' });
    } finally { await source.close(); }
  }
  await dump(join(evidence, 'diagnostics.json'), { limitBytesPerFile: DIAGNOSTIC_LIMIT_BYTES, files });
}

function stopError(pid) {
  const error = new Error(`Assembly child group ${pid} did not stop after SIGKILL; cleanup cannot remove live work`);
  error.code = 'ASSEMBLY_CHILD_STOP_TIMEOUT';
  return error;
}

// Leases last only until this command's group and pipes settle, not until the whole
// build ends. Once ESRCH is observed the pgid is retired and is never signalled again.
function ownChild(child, signal, release) {
  let groupOwned = Boolean(child.pid), stopping, spawnError, rejectStop;
  const closed = new Promise(accept => child.once('close', (code, exitSignal) => accept({ code, signal: exitSignal })));
  const exited = new Promise(accept => {
    child.once('exit', accept);
    child.once('error', error => { spawnError = error; if (!child.pid) accept(); });
  });
  const failedStop = new Promise((_, reject) => { rejectStop = reject; });
  const alive = () => {
    if (!groupOwned) return false;
    try { process.kill(-child.pid, 0); return true; }
    catch (error) {
      if (error.code === 'EPERM') return true;
      if (error.code !== 'ESRCH') throw error;
      groupOwned = false;
      return false;
    }
  };
  const send = name => {
    if (!alive()) return;
    try { process.kill(-child.pid, name); }
    catch (error) {
      // Darwin may report EPERM while a group is exiting. It is not proof of
      // absence: keep waiting, and fail the stop deadline if ESRCH never arrives.
      if (error.code === 'EPERM') return;
      if (error.code !== 'ESRCH') throw error;
      groupOwned = false;
    }
  };
  const wait = async milliseconds => {
    const until = Date.now() + milliseconds;
    while (alive()) {
      if (Date.now() >= until) return false;
      await delay(20);
    }
    return true;
  };
  const stop = () => {
    if (stopping) return stopping;
    stopping = (async () => {
      send('SIGTERM');
      if (await wait(STOP_GRACE_MS)) return;
      send('SIGKILL');
      if (!await wait(STOP_KILL_MS)) throw stopError(child.pid);
    })();
    stopping.catch(error => { stopping = undefined; rejectStop(error); });
    return stopping;
  };
  const abort = () => { void stop(); };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const settled = Promise.race([
    exited.then(async () => {
      // A successful parent may leave descendants holding inherited pipes. Stop
      // them at parent exit, rather than waiting for the close event they prevent.
      await stop();
      const result = await closed;
      if (spawnError) throw spawnError;
      return result;
    }),
    failedStop,
  ]);
  const lease = { child, closed, settled, stop, release: () => { signal?.removeEventListener('abort', abort); release(lease); } };
  settled.then(lease.release, () => { if (!groupOwned) lease.release(); });
  return lease;
}

export class AssemblyWorkspace {
  constructor({ output, outputFd, work, evidence, signal }) {
    Object.assign(this, { output, outputFd, work, evidence, signal });
    this.resource = join(work, 'resources');
    this.cache = join(work, 'archives');
    this.children = new Set();
    this.outputPublished = false;
    this.cleanupPromise = null;
  }

  assertActive() {
    this.signal?.throwIfAborted();
    if (this.cleanupPromise) throw new Error('Assembly workspace is closing');
  }

  trackChild(child) {
    const lease = ownChild(child, this.signal, lease => this.children.delete(lease));
    this.children.add(lease);
    return lease;
  }

  async run(command, args, { cwd, env, log, timeout = 600_000 } = {}) {
    this.assertActive();
    let logFd = log ? openSync(log, 'w', 0o600) : undefined;
    let lease, timer, timedOut = false, logError, collecting = true;
    const chunks = [], errors = [];
    try {
      const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      lease = this.trackChild(child);
      const collect = list => bytes => {
        if (!collecting) return;
        list.push(bytes);
        if (logFd === undefined || logError) return;
        try { writeSync(logFd, bytes); }
        catch (error) { logError = error; void lease.stop(); }
      };
      child.stdout.on('data', collect(chunks));
      child.stderr.on('data', collect(errors));
      timer = setTimeout(() => { timedOut = true; void lease.stop(); }, timeout);
      const { code, signal } = await lease.settled;
      this.signal?.throwIfAborted();
      if (logError) throw logError;
      const stdout = Buffer.concat(chunks).toString('utf8'), stderr = Buffer.concat(errors).toString('utf8');
      if (timedOut || code !== 0) throw new Error(`${basename(command)} ${args[0] ?? ''} failed (${timedOut ? 'timeout' : signal ?? code}); ${log ? `see ${log}` : stderr.trim().slice(-2000)}`);
      return { stdout, stderr, code };
    } finally {
      // A failed stop may leave pipes alive. Keep draining them, but revoke both
      // buffering and log writes before the descriptor can be reused by a caller.
      collecting = false;
      chunks.length = errors.length = 0;
      clearTimeout(timer);
      const fd = logFd;
      logFd = undefined;
      if (fd !== undefined) closeSync(fd);
    }
  }

  async stopChildren() {
    const results = await Promise.allSettled([...this.children].map(async lease => {
      await lease.stop();
      await lease.closed;
      lease.release();
    }));
    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (errors.length) {
      const error = new AggregateError(errors, 'Assembly child shutdown could not be confirmed');
      error.cleanupBlocked = true;
      throw error;
    }
  }

  ownsOutput() {
    if (this.outputFd === undefined) return false;
    const expected = fstatSync(this.outputFd), actual = lstatSync(this.output, { throwIfNoEntry: false });
    return actual?.isDirectory() && actual.dev === expected.dev && actual.ino === expected.ino;
  }

  async publish() {
    this.assertActive();
    await this.stopChildren();
    this.assertActive();
    // mkdir reserved this directory exclusively. Never rename over someone else's
    // directory; the held fd prevents inode reuse from looking like ownership.
    if (!this.ownsOutput() || readdirSync(this.output).length) throw new Error(`Runtime output ownership changed: ${this.output}`);
    const entries = readdirSync(this.resource).sort((a, b) => Number(a === 'assembly.json') - Number(b === 'assembly.json'));
    for (const name of entries) {
      if (!this.ownsOutput()) throw new Error(`Runtime output ownership changed: ${this.output}`);
      renameSync(join(this.resource, name), join(this.output, name));
    }
    this.outputPublished = true;
  }

  async cleanup({ preserveOutput = this.outputPublished } = {}) {
    if (this.cleanupPromise) return this.cleanupPromise;
    this.cleanupPromise = (async () => {
      // A stop timeout is not proof of shutdown. Surface it and do not race a live
      // group with removal. Normal failure/cancellation still removes all heavy work.
      try { await this.stopChildren(); }
      catch (error) {
        try {
          await dump(join(this.evidence, 'cleanup.json'), { message: error.message, errors: error.errors?.map(item => ({ message: item.message, code: item.code })) });
        } catch (diagnosticError) { error.diagnosticError = diagnosticError; }
        throw error;
      }
      const errors = [];
      try { await makeWritable(this.work); } catch (error) { errors.push(error); }
      try { await copyDiagnostics(this.work, this.evidence); } catch (error) { errors.push(error); }
      try { await rm(this.work, { recursive: true, force: true }); } catch (error) { errors.push(error); }
      try {
        if (!preserveOutput && this.ownsOutput()) removeAssemblyTreeSync(this.output);
      } catch (error) { errors.push(error); }
      if (this.outputFd !== undefined) { closeSync(this.outputFd); this.outputFd = undefined; }
      if (errors.length) {
        await dump(join(this.evidence, 'cleanup.json'), { errors: errors.map(error => error.message) });
        throw new AggregateError(errors, `Assembly workspace cleanup failed; evidence at ${this.evidence}`);
      }
      return this.evidence;
    })();
    try { return await this.cleanupPromise; }
    catch (error) { this.cleanupPromise = null; throw error; }
  }
}

export async function createAssemblyWorkspace({ repo, output, signal } = {}) {
  if (typeof repo !== 'string' || !repo) throw new Error('Assembly workspace requires a repository path');
  if (typeof output !== 'string' || !output) throw new Error('Assembly workspace requires an output path');
  repo = await realpath(resolve(repo));
  output = resolve(repo, output);
  const roots = [join(repo, '.build.noindex'), join(repo, '.tmp')];
  if (!roots.some(root => output !== root && within(root, output))) throw new Error('Runtime assembly output must be a dedicated .build.noindex or .tmp staging directory');
  const outputParent = dirname(output), diagnosticsParent = join(repo, '.build.noindex');
  await mkdir(outputParent, { recursive: true });
  await mkdir(diagnosticsParent, { recursive: true });
  const resolvedParent = await realpath(outputParent);
  if (!roots.some(root => within(root, resolvedParent))) {
    throw new Error('Runtime staging parent resolves outside the repository staging roots');
  }
  // Keep diagnostics outside any disposable outer App stage, and never follow a
  // staging-root symlink into another repository or historical evidence directory.
  if (await realpath(diagnosticsParent) !== diagnosticsParent) throw new Error('Assembly diagnostics root must not be a symlink');
  let outputFd, work, evidence, workspace;
  try {
    try { mkdirSync(output, { mode: 0o700 }); }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error(`Runtime output already exists; choose a fresh staging path: ${output}`);
      throw error;
    }
    outputFd = openSync(output, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    work = await mkdtemp(join(outputParent, '.package-runtime-'));
    evidence = await mkdtemp(join(diagnosticsParent, 'assembly-'));
    workspace = new AssemblyWorkspace({ output, outputFd, work, evidence, signal });
    await mkdir(workspace.resource);
    await mkdir(workspace.cache);
    return workspace;
  } catch (error) {
    if (workspace) await workspace.cleanup({ preserveOutput: false });
    else {
      if (work) removeAssemblyTreeSync(work);
      if (outputFd !== undefined) {
        const actual = lstatSync(output, { throwIfNoEntry: false }), expected = fstatSync(outputFd);
        if (actual?.dev === expected.dev && actual?.ino === expected.ino) removeAssemblyTreeSync(output);
        closeSync(outputFd);
      }
    }
    throw error;
  }
}
