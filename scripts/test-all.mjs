/** Complete offline gate, bounded to two workers per lane and run serially. */
import { spawn } from 'node:child_process';
const root = new URL('..', import.meta.url);
let child;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => child?.kill(signal));
for (const args of [
  ['scripts/build-runtime.mjs'],
  ['scripts/test-extension.mjs', '--test-concurrency=2'],
  ['--test', '--test-concurrency=2', '--test-timeout=60000', 'experiments/single-loop-routing/loop.test.mjs'],
  ['scripts/test-integration.mjs', ...process.argv.slice(2)],
]) {
  const code = await new Promise((accept, reject) => {
    child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit' });
    child.once('error', reject); child.once('exit', (status, signal) => accept(status ?? ({SIGINT:130,SIGTERM:143,SIGHUP:129}[signal] ?? 1)));
  });
  if (code) { process.exitCode = code; break; }
}
