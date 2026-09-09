import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import { RpcError } from "./errors.js";

export type FlockOperation = "sh" | "ex" | "shnb" | "exnb" | "un";
export type Flock = (fd: number, operation: FlockOperation) => Promise<void>;
export type LockMode = "shared" | "exclusive";
export interface LockLease { release(): Promise<void> }
export interface LockOptions { readonly nonblocking?: boolean; readonly createParents?: boolean }
export interface AdvisoryLocks {
  acquire(path: string, mode: LockMode, options?: LockOptions): Promise<LockLease | null>;
}

/** A native flock operation is mandatory; lock-file creation is never a lock. */
export function createAdvisoryLocks(flock?: Flock): AdvisoryLocks {
  return Object.freeze({
    async acquire(path: string, mode: LockMode, options: LockOptions = {}): Promise<LockLease | null> {
      if (!flock) throw new RpcError("not_implemented", "POSIX advisory locking is unavailable for this kernel");
      if (mode !== "shared" && mode !== "exclusive") throw new TypeError("invalid advisory lock mode");
      if (options.createParents) await mkdir(dirname(path), { recursive: true });
      const handle = await open(path, "a+");
      const operation = `${mode === "shared" ? "sh" : "ex"}${options.nonblocking ? "nb" : ""}` as FlockOperation;
      try { await flock(handle.fd, operation); }
      catch (error) {
        await handle.close();
        if (options.nonblocking && ["EAGAIN", "EWOULDBLOCK"].includes((error as NodeJS.ErrnoException).code ?? "")) return null;
        throw error;
      }
      let release: Promise<void> | undefined;
      return Object.freeze({
        release(): Promise<void> {
          release ??= (async () => {
            try { await flock(handle.fd, "un"); }
            finally { await handle.close(); }
          })();
          return release;
        },
      });
    },
  });
}

/** How often a bounded wait re-offers for the lock. Short enough to be invisible when it frees. */
const LOCK_POLL_MS = 50;
/**
 * A bounded wait for an exclusive lease, or null when the deadline passes.
 *
 * A blocking flock has no deadline, and a holder that stops answering makes every waiter wait with
 * it. That is not serialization, it is a stall the waiter cannot name: the RPC transport gives up
 * on its own timeout and reports a generic internal failure with nothing in it that says another
 * process is holding this campaign. A deadline lets the caller say so.
 */
async function acquireExclusive(locks: AdvisoryLocks, path: string, timeoutMs?: number): Promise<LockLease | null> {
  if (timeoutMs === undefined) return locks.acquire(path, "exclusive", { createParents: true });
  const deadline = Date.now() + Math.max(0, timeoutMs);
  for (;;) {
    const lease = await locks.acquire(path, "exclusive", { createParents: true, nonblocking: true });
    if (lease) return lease;
    if (Date.now() >= deadline) return null;
    await new Promise<void>(resolve => { const timer = setTimeout(resolve, LOCK_POLL_MS); timer.unref?.(); });
  }
}
export async function withExclusiveLock<T>(locks: AdvisoryLocks, path: string, action: () => Promise<T>,
  options: { readonly timeoutMs?: number; readonly timeout?: () => Error } = {}): Promise<T> {
  const lease = await acquireExclusive(locks, path, options.timeoutMs);
  if (!lease) {
    if (options.timeoutMs === undefined) throw new Error("blocking advisory lock returned no lease");
    throw options.timeout?.() ?? new RpcError("internal", `advisory lock ${path} is held elsewhere`,
      { details: { reason: "lock_timeout", path } });
  }
  try { return await action(); }
  finally { await lease.release(); }
}
