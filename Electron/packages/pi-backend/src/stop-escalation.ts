import { execFile, execFileSync } from "node:child_process";

export type StopEscalationDelays = {
  /**
   * Legacy descendant windows. A turn abort/cut-in must never signal pi's
   * descendants — background subagent workers are descendants of the same pi
   * process and must keep running — so this and `killDescendantsMs` now only
   * contribute to the total bound before the pi process itself is escalated.
   */
  termDescendantsMs: number;
  /** After `termDescendantsMs`: legacy SIGKILL-descendants window. See above. */
  killDescendantsMs: number;
  /** After the full window: SIGKILL the pi process itself. */
  killPiMs: number;
};

export const DEFAULT_STOP_ESCALATION_DELAYS: StopEscalationDelays = {
  termDescendantsMs: 3_000,
  killDescendantsMs: 2_000,
  killPiMs: 2_000,
};

export type ProcessIdentity = {
  pid: number;
  startTime: string;
  command: string;
};

/** Snapshot pinned at abort time. Later live PID changes must not be signalled. */
export type StopEscalationSnapshot = {
  piPid: number;
  piIdentity?: ProcessIdentity;
  /** Host ownership fence, rechecked around final asynchronous verification. */
  isCurrent?: () => boolean;
};

export type StopEscalationHooks = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
  listDescendants: (pid: number) => number[] | Promise<number[]>;
  identify: (pid: number) => ProcessIdentity | undefined | Promise<ProcessIdentity | undefined>;
  kill: (pid: number, signal: NodeJS.Signals) => void;
};

type EscalationRun = {
  cancelled: boolean;
  timers: unknown[];
  snapshot: StopEscalationSnapshot;
};

/** Recursively list child PIDs of `pid` via `pgrep -P`. Never returns `pid` itself. */
export function listDescendantPids(pid: number): number[] {
  if (!Number.isInteger(pid) || pid <= 0) return [];
  const seen = new Set<number>();
  const walk = (parent: number) => {
    let stdout = "";
    try {
      stdout = execFileSync("pgrep", ["-P", String(parent)], {
        encoding: "utf8",
        timeout: 1_000,
      });
    } catch {
      return;
    }
    for (const token of stdout.split(/\s+/)) {
      const child = Number.parseInt(token, 10);
      if (!Number.isInteger(child) || child <= 0 || seen.has(child)) continue;
      seen.add(child);
      walk(child);
    }
  };
  walk(pid);
  return [...seen];
}

/** `ps` start-time + argv. Empty/missing process → undefined. */
export function readProcessIdentity(pid: number): ProcessIdentity | undefined {
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  try {
    const startTime = execFileSync("ps", ["-p", String(pid), "-o", "lstart="], {
      encoding: "utf8",
      timeout: 1_000,
    }).trim();
    const command = execFileSync("ps", ["-p", String(pid), "-o", "args="], {
      encoding: "utf8",
      timeout: 1_000,
    }).trim();
    if (!startTime && !command) return undefined;
    return { pid, startTime, command };
  } catch {
    return undefined;
  }
}

/** Collect the existing ps identity fields without blocking the host event loop. */
export async function readProcessIdentityAsync(pid: number): Promise<ProcessIdentity | undefined> {
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  const query = (field: string) => new Promise<string>((resolve, reject) => {
    execFile("ps", ["-p", String(pid), "-o", field], { encoding: "utf8", timeout: 1_000 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout.trim());
    });
  });
  try {
    const [startTime, command] = await Promise.all([query("lstart="), query("args=")]);
    const identity = { pid, startTime, command };
    return isCompleteIdentity(identity) ? identity : undefined;
  } catch {
    return undefined;
  }
}

function identityFieldPresent(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** Fail-closed: missing start time or argv on either side is a mismatch. */
export function isCompleteIdentity(identity: ProcessIdentity | undefined): identity is ProcessIdentity {
  return Boolean(
    identity &&
      Number.isInteger(identity.pid) &&
      identity.pid > 0 &&
      identityFieldPresent(identity.startTime) &&
      identityFieldPresent(identity.command),
  );
}

export function identitiesMatch(
  expected: ProcessIdentity | undefined,
  actual: ProcessIdentity | undefined,
): boolean {
  if (!isCompleteIdentity(expected) || !isCompleteIdentity(actual)) return false;
  if (expected.pid !== actual.pid) return false;
  if (expected.startTime !== actual.startTime) return false;
  if (expected.command !== actual.command) return false;
  return true;
}

export function defaultStopEscalationHooks(): StopEscalationHooks {
  return {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id as NodeJS.Timeout),
    listDescendants: listDescendantPids,
    identify: readProcessIdentityAsync,
    kill: (pid, signal) => {
      try {
        process.kill(pid, signal);
      } catch {
        /* already gone */
      }
    },
  };
}

/**
 * Abort-unresponsive turn ladder (Swift scheduleStopEscalation parity).
 * Never signals a process group (`kill(-pid)`) and never signals pi's
 * descendants: background subagent workers live under the same pi process and
 * must survive a turn abort/cut-in (close()/session teardown owns their
 * explicit cleanup). The only escalation target is the snapshotted pi pid
 * itself, bounded by termDescendantsMs + killDescendantsMs + killPiMs, so a
 * hung abort can never block forever.
 */
export class StopEscalationScheduler {
  private readonly runs = new Map<string, EscalationRun>();

  constructor(
    private readonly hooks: StopEscalationHooks = defaultStopEscalationHooks(),
    private readonly delays: StopEscalationDelays = DEFAULT_STOP_ESCALATION_DELAYS,
  ) {}

  start(
    sessionId: string,
    snapshot: StopEscalationSnapshot,
    onForceStopped?: (signaled: boolean) => void,
  ): void {
    this.cancel(sessionId);
    const run: EscalationRun = {
      cancelled: false,
      timers: [],
      snapshot: { piPid: snapshot.piPid, piIdentity: snapshot.piIdentity, isCurrent: snapshot.isCurrent },
    };
    this.runs.set(sessionId, run);

    const arm = (ms: number, fn: () => void) => {
      const id = this.hooks.setTimeout(() => {
        if (run.cancelled) return;
        fn();
      }, ms);
      run.timers.push(id);
    };

    const signalPi = async (): Promise<boolean> => {
      if (run.cancelled || run.snapshot.isCurrent?.() === false) return false;
      const expected = run.snapshot.piIdentity;
      if (!isCompleteIdentity(expected)) {
        console.warn(
          `[stop-escalation] skip SIGKILL pi pid=${run.snapshot.piPid}: incomplete abort snapshot`,
        );
        return false;
      }
      const actual = await this.hooks.identify(run.snapshot.piPid);
      if (run.cancelled || run.snapshot.isCurrent?.() === false) return false;
      if (!identitiesMatch(expected, actual)) {
        console.warn(
          `[stop-escalation] skip SIGKILL pi pid=${run.snapshot.piPid}: identity mismatch or incomplete`,
        );
        return false;
      }
      this.hooks.kill(run.snapshot.piPid, "SIGKILL");
      return true;
    };

    arm(
      this.delays.termDescendantsMs + this.delays.killDescendantsMs + this.delays.killPiMs,
      () => {
        void (async () => {
          const signaled = await signalPi();
          if (!run.cancelled && run.snapshot.isCurrent?.() !== false) onForceStopped?.(signaled);
        })();
      },
    );
  }

  cancel(sessionId: string): void {
    const run = this.runs.get(sessionId);
    if (!run) return;
    run.cancelled = true;
    this.runs.delete(sessionId);
    for (const id of run.timers) this.hooks.clearTimeout(id);
  }

  cancelAll(): void {
    for (const sessionId of [...this.runs.keys()]) this.cancel(sessionId);
  }
}
