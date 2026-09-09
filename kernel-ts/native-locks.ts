import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { createAdvisoryLocks, type FlockOperation } from "./locks.js";

type NativeFlock = { flockSync(fd: number, operation: FlockOperation): void };

/** Native descriptor locks interoperate with existing Python writers. */
export function nativeAdvisoryLocks() {
  const native = createRequire(import.meta.url)("fs-ext") as NativeFlock;
  if (typeof native.flockSync !== "function") throw new Error("The native advisory lock backend is unavailable");
  return createAdvisoryLocks(async (fd, operation) => {
    const waiting = operation === "ex" || operation === "sh";
    const attempt = waiting ? `${operation}nb` as FlockOperation : operation;
    for (;;) {
      try { native.flockSync(fd, attempt); return; }
      catch (error) {
        if (!waiting || !["EAGAIN", "EWOULDBLOCK"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
        // Blocking libuv workers here would prevent descriptor opens and releases.
        await delay(10);
      }
    }
  });
}
