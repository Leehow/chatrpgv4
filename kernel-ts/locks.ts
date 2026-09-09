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

export async function withExclusiveLock<T>(locks: AdvisoryLocks, path: string, action: () => Promise<T>): Promise<T> {
  const lease = await locks.acquire(path, "exclusive", { createParents: true });
  if (!lease) throw new Error("blocking advisory lock returned no lease");
  try { return await action(); }
  finally { await lease.release(); }
}
