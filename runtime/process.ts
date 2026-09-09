/** One bounded host subprocess; the caller retains ownership until its pipes and descendants close. */
import { spawn } from 'node:child_process';

export function runHostProcess(command: string[], options: {cwd: string; env: NodeJS.ProcessEnv;
  signal: AbortSignal; timeoutMs?: number; outputLimit?: number}): Promise<{stdout: string; code: number | null}> {
  if (options.signal.aborted) return Promise.reject(new Error('Runtime operation was cancelled'));
  return new Promise((accept, reject) => {
    const grouped = process.platform !== 'win32';
    const child = spawn(command[0], command.slice(1), {cwd: options.cwd, env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'], detached: grouped});
    let stdout = '', stderr = '', failure: Error | undefined, stopped = false;
    let hardKill: NodeJS.Timeout | undefined;
    const kill = (signal: NodeJS.Signals) => {
      try { if (grouped && child.pid) process.kill(-child.pid, signal); else child.kill(signal); }
      catch { /* The owned process group has already exited. */ }
    };
    const stop = () => {
      if (stopped) return;
      stopped = true;
      kill('SIGTERM');
      hardKill = setTimeout(() => kill('SIGKILL'), 2000);
    };
    const timeout = options.timeoutMs === undefined ? undefined : setTimeout(() => {
      failure = new Error('Runtime helper timed out'); stop();
    }, options.timeoutMs);
    options.signal.addEventListener('abort', stop, {once: true});
    if (options.signal.aborted) stop();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (failure) return;
      stdout += chunk;
      if (Buffer.byteLength(stdout) > (options.outputLimit ?? 4 * 1024 * 1024)) {
        failure = new Error('Runtime helper output exceeded its limit'); stop();
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-2000); });
    child.on('error', error => { failure = error; });
    child.once('exit', () => {
      clearTimeout(timeout);
      if (grouped && child.pid) stop();
    });
    child.once('close', code => {
      clearTimeout(timeout); clearTimeout(hardKill);
      options.signal.removeEventListener('abort', stop);
      if (grouped && child.pid) kill('SIGKILL');
      if (options.signal.aborted) return reject(new Error('Runtime operation was cancelled'));
      if (failure) return reject(failure);
      if (code !== 0 && code !== 1) return reject(new Error(`Runtime helper exited with ${code}${stderr ? `: ${stderr}` : ''}`));
      accept({stdout, code});
    });
  });
}
