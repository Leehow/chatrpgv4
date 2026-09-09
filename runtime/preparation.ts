/** Host-only launch adapter for the existing onboarding JSONL worker. */
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import type { Readable } from 'node:stream';
import { KernelError } from '../extensions/kernel/client.ts';
import { composeRuntimeContext, type RuntimeHostOptions } from './host.ts';

export interface PreparationProcess {
  readonly child: ChildProcessByStdio<null, Readable, Readable>;
  readonly closed: Promise<void>;
  close(): Promise<void>;
}

export function createPreparationHost(home: string, options: RuntimeHostOptions = {}) {
  const context = composeRuntimeContext({owner: 'preparation', home}, options);
  const entrypoint = context.entrypoints.onboardingWorker;
  try { accessSync(entrypoint, constants.R_OK); }
  catch { throw new KernelError({code: 'internal', message: 'The preparation worker is unavailable',
    details: {reason: 'runtime_configuration'}}); }
  const configuration = JSON.stringify({layout: context.layout, backend: context.backend, resourceRoot: context.resourceRoot,
    contentRoot: context.contentRoot, agentHome: context.agentHome, nodeExecutable: context.nodeExecutable,
    kernelEntrypoint: context.entrypoints.kernel});

  return Object.freeze({home: context.home,
    start(action: string, input: Record<string, unknown>, signal?: AbortSignal): PreparationProcess {
      if (signal?.aborted) throw new KernelError({code: 'internal', message: 'Preparation was cancelled',
        details: {reason: 'runtime_cancelled'}});
      const grouped = process.platform !== 'win32';
      const child = spawn(context.nodeExecutable, [entrypoint, action,
        JSON.stringify({...input, home: context.home}), configuration], {
        cwd: context.resourceRoot, detached: grouped,
        env: {...context.env, PI_COC_CAMPAIGN: typeof input.campaign === 'string' ? input.campaign : undefined,
          ...(context.layout === 'source' ? {ELECTRON_RUN_AS_NODE: '1', PYTHONDONTWRITEBYTECODE: '1'} : {})}, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let ended = false, stopping = false;
      let escalation: NodeJS.Timeout | undefined, deadline: NodeJS.Timeout | undefined;
      let rejectClosed!: (error: Error) => void;
      const closed = new Promise<void>((resolveClosed, reject) => {
        rejectClosed = reject;
        child.once('close', () => {
          ended = true;
          clearTimeout(escalation); clearTimeout(deadline);
          signal?.removeEventListener('abort', cancel);
          resolveClosed();
        });
      });
      // Consumers report launch errors through the existing JSONL completion path.
      child.on('error', () => undefined);
      child.once('exit', () => {
        if (grouped && child.pid) {
          try { process.kill(-child.pid, 'SIGTERM'); }
          catch { /* A clean worker has already closed all of its descendants. */ }
          armEscalation(2000);
        }
      });
      function armEscalation(ms: number) {
        if (escalation || ended) return;
        escalation = setTimeout(() => {
          try {
            if (grouped && child.pid) process.kill(-child.pid, 'SIGKILL');
            else child.kill('SIGKILL');
          } catch { /* The child may have completed while cancellation was delivered. */ }
          deadline = setTimeout(() => rejectClosed(new KernelError({code: 'internal',
            message: 'Preparation shutdown did not complete after SIGKILL', details: {reason: 'runtime_shutdown'}})), 2000);
          deadline.unref?.();
        }, ms);
        escalation.unref?.();
      }
      function close(): Promise<void> {
        if (ended || stopping) return closed;
        stopping = true;
        child.kill('SIGTERM');
        armEscalation(10000);
        return closed;
      }
      function cancel() { void close().catch(() => undefined); }
      signal?.addEventListener('abort', cancel, {once: true});
      return Object.freeze({child, closed, close});
    },
  });
}
