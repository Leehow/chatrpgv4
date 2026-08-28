/**
 * Finalize-after asynchronous semantic memory extraction (pi-coc host).
 *
 * This is one derived/advisory lifecycle, not a second Keeper or persistence
 * authority. The canonical gateway schedules it only after a successful,
 * already-finalized turn; the player result is never awaited here. A private
 * zero-tool Pi child returns semantic candidates only. The Python bridge
 * rebuilds machine provenance, validates/applies immutable artifacts, and
 * never materializes/promotes assertions.
 *
 * Execution is bounded: one active extractor plus eight executable FIFO
 * entries. Durable re-arm discoveries beyond that bound stay as semantic
 * refs in a local refill staging map; after each terminal worker, it fills
 * the next bounded slot event-driven. That is not polling and never starts
 * more than nine extractor jobs at once.
 */
import {
  execFileSync,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  realpathSync,
} from "node:fs";
import { homedir } from "node:os";
import {
  delimiter,
  isAbsolute,
  join,
  resolve,
  sep,
} from "node:path";
import {
  PACKAGE_ROOT,
  PLUGIN_ROOT,
  asObject,
  exactKeys,
  nonEmpty,
  safeEnv,
  spawnPiChild,
  terminateTree,
  type ChildRun,
  type JsonObject,
  type PrivateLaunchContext,
} from "./runtime.ts";

export const MEMORY_EXTRACTOR_CONTRACT_ID = "coc.memory-extractor.v1";

const MAX_PENDING_MEMORY_EXTRACTION = 8;
const MAX_EXECUTING_MEMORY_EXTRACTION = 1 + MAX_PENDING_MEMORY_EXTRACTION;
const MEMORY_EXTRACTION_TIMEOUT_MS = 180_000;
const HOST_BRIDGE_TIMEOUT_MS = 60_000;
const MAX_BRIDGE_STDOUT_BYTES = 512 * 1024;
const MAX_BRIDGE_STDERR_BYTES = 64 * 1024;
const REQUIRED_UV_VERSION = "0.11.16";
const EXTRACT_ACTION_ID_PREFIX = "extract-";

/** Semantic refs exactly as the canonical finalize envelope carries them. */
export type MemoryExtractionRefs = {
  campaign_id: string;
  job_id: string;
  episode_id: string;
  timeline_id: string;
  turn_number: number;
  backlog_id: string;
};

/** One durable pending backlog row projected by `memory.extraction_status`. */
export type MemoryExtractionBacklogEntry = {
  backlog_id: string;
  timeline_id: string;
  turn_number: number;
  status: string;
};

/** The deterministic Python host apply bridge request/receipt envelope. */
export type MemoryHostBridgeRequest = JsonObject;

type BridgeCommand = {
  command: string;
  args: readonly string[];
};

type QueueEntry = {
  refs: MemoryExtractionRefs;
  resolve: () => void;
};

export type MemoryExtractionDeps = {
  isCurrent: () => boolean;
  workspaceRoot: () => string;
  launchContext: () => PrivateLaunchContext | null;
  launchExtractor: (
    task: JsonObject,
    launch: PrivateLaunchContext,
    signal?: AbortSignal,
  ) => ChildRun;
  runHostBridge: (
    request: MemoryHostBridgeRequest,
    signal?: AbortSignal,
  ) => Promise<JsonObject>;
  appendAudit: (entry: JsonObject) => void;
};

export type MemoryHostBridgeOptions = {
  /** Test-only shortening of the production 60 second bridge deadline. */
  timeoutMs?: number;
};

export function extractionJobIdFor(
  campaignId: string,
  timelineId: string,
  turnNumber: number,
): string {
  return `${EXTRACT_ACTION_ID_PREFIX}${campaignId}-${timelineId}-turn-${turnNumber}`;
}

function liveKey(refs: { campaign_id: string; job_id: string }): string {
  return `${refs.campaign_id}\u0000${refs.job_id}`;
}

/** Validate the closed extractor task handed to the private child. */
export function validateMemoryExtractionTask(input: unknown): JsonObject {
  const task = asObject(input, "memory extractor task");
  exactKeys(task, ["contract_id", "packet", "read"], "memory extractor task");
  if (task.contract_id !== MEMORY_EXTRACTOR_CONTRACT_ID) {
    throw new Error("memory extractor task contract drift");
  }
  const packet = asObject(task.packet, "memory extractor packet");
  exactKeys(
    packet,
    [
      "job_id",
      "episode_id",
      "campaign_id",
      "timeline_id",
      "turn_number",
      "subjects_present",
      "entities",
      "result_contract",
    ],
    "memory extractor packet",
  );
  nonEmpty(packet.job_id, "packet.job_id");
  nonEmpty(packet.episode_id, "packet.episode_id");
  nonEmpty(packet.campaign_id, "packet.campaign_id");
  nonEmpty(packet.timeline_id, "packet.timeline_id");
  if (
    typeof packet.turn_number !== "number"
    || !Number.isInteger(packet.turn_number)
    || packet.turn_number < 1
  ) {
    throw new Error("packet.turn_number must be a positive integer");
  }
  if (!Array.isArray(packet.subjects_present) || !Array.isArray(packet.entities)) {
    throw new Error("packet subjects/entities must be arrays");
  }
  asObject(packet.result_contract, "packet.result_contract");
  // The Python bridge verifies the finalization digest before this point but
  // strips every machine digest/provenance value before the model sees it.
  const read = asObject(task.read, "memory extractor read payload");
  exactKeys(read, ["rendered_text"], "memory extractor read payload");
  nonEmpty(read.rendered_text, "read.rendered_text");
  return task;
}

type ExtractorCandidate = JsonObject;

/**
 * Closed validation of the extractor child's bare JSON result. TS-side this
 * is a bounded framing/shape gate; authoritative schema/privacy/provenance
 * validation happens in the Python core at apply.
 */
export function validateMemoryExtractorResult(
  task: JsonObject,
  value: unknown,
): { job_id: string; candidates: ExtractorCandidate[] } {
  const packet = asObject(task.packet, "memory extractor packet");
  const result = asObject(value, "memory extractor result");
  exactKeys(result, ["job_id", "candidates"], "memory extractor result");
  if (result.job_id !== packet.job_id) {
    throw new Error("memory extractor result job binding drift");
  }
  const rawCandidates = result.candidates;
  if (!Array.isArray(rawCandidates)) {
    throw new Error("memory extractor result candidates must be a list");
  }
  const contract_ = asObject(packet.result_contract, "packet.result_contract");
  const maxCandidates = typeof contract_.max_candidates === "number"
    ? contract_.max_candidates
    : 32;
  if (rawCandidates.length > maxCandidates) {
    throw new Error("memory extractor result exceeds max candidates");
  }
  const candidates: ExtractorCandidate[] = rawCandidates.map((row, index) => {
    const candidate = asObject(row, `memory extractor candidate[${index}]`);
    exactKeys(
      candidate,
      [
        "assertion_id",
        "kind",
        "subject_id",
        "knowers",
        "privacy",
        "state",
        "statement",
        "entities",
        "occurred_turn",
        "valid_from_turn",
      ],
      `memory extractor candidate[${index}]`,
    );
    nonEmpty(candidate.assertion_id, `candidate[${index}].assertion_id`);
    nonEmpty(candidate.kind, `candidate[${index}].kind`);
    nonEmpty(candidate.subject_id, `candidate[${index}].subject_id`);
    nonEmpty(candidate.privacy, `candidate[${index}].privacy`);
    nonEmpty(candidate.state, `candidate[${index}].state`);
    if (typeof candidate.statement !== "string" || !candidate.statement.trim()) {
      throw new Error(`candidate[${index}].statement must be a non-empty string`);
    }
    if (!Array.isArray(candidate.knowers ?? [])) {
      throw new Error(`candidate[${index}].knowers must be a list`);
    }
    return candidate;
  });
  return { job_id: packet.job_id as string, candidates };
}

/**
 * Extract the extractor child's strict bare JSON answer from its event stream:
 * exactly one assistant `message_end` with one non-thinking text part.
 */
export function parseExtractorEvents(events: readonly JsonObject[]): unknown {
  const terminals: unknown[] = [];
  for (const event of events) {
    if (event.type !== "message_end") continue;
    const message = event.message && typeof event.message === "object"
      ? event.message as JsonObject
      : null;
    if (!message || message.role !== "assistant" || !Array.isArray(message.content)) continue;
    const parts = (message.content as unknown[]).filter((part) => {
      const row = part && typeof part === "object" ? part as JsonObject : null;
      return !row || row.type !== "thinking";
    });
    if (parts.length !== 1) throw new Error("extractor framing not one text part");
    const part = parts[0] as JsonObject;
    if (part.type !== "text" || typeof part.text !== "string" || !part.text.trim()) {
      throw new Error("extractor framing not one text part");
    }
    terminals.push(JSON.parse(part.text));
  }
  if (terminals.length !== 1) throw new Error("extractor framing not one terminal");
  return terminals[0];
}

function isProjectVenvUv(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return normalized.endsWith("/.venv/bin/uv")
    || normalized.endsWith("/.venv/Scripts/uv.exe");
}

function canonicalExecutable(candidate: string): string | null {
  try {
    const executable = realpathSync(candidate);
    if (!isAbsolute(executable)) return null;
    if (process.platform !== "win32") accessSync(executable, constants.X_OK);
    return executable;
  } catch {
    return null;
  }
}

function uvNames(): readonly string[] {
  return process.platform === "win32"
    ? ["uv.exe", "uv.cmd", "uv.bat", "uv"]
    : ["uv"];
}

function findUvOnPath(pathValue: string | undefined): string | null {
  for (const rawDirectory of (pathValue ?? "").split(delimiter)) {
    const directory = rawDirectory ? resolve(rawDirectory) : process.cwd();
    for (const name of uvNames()) {
      const executable = canonicalExecutable(join(directory, name));
      if (executable !== null) return executable;
    }
  }
  return null;
}

function requireExactUv(candidate: string, label: string): string {
  const executable = canonicalExecutable(candidate);
  if (executable === null) {
    throw new Error(`cannot execute required uv at ${label}`);
  }
  if (isProjectVenvUv(candidate) || isProjectVenvUv(executable)) {
    throw new Error("refusing uv from .venv/bin; required uv is an external project manager");
  }
  let version: string;
  try {
    version = String(execFileSync(executable, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5_000,
    })).trim();
  } catch {
    throw new Error(`cannot run required uv at ${executable}`);
  }
  if (!new RegExp(`^uv ${REQUIRED_UV_VERSION}(?:\\s|$)`).test(version)) {
    throw new Error(
      `required uv ${REQUIRED_UV_VERSION}, found ${JSON.stringify(version)} at ${executable}`,
    );
  }
  return executable;
}

/**
 * Same contract as `pi/bin/pi-coc`: prefer an explicitly configured absolute
 * executable, otherwise use the first PATH uv (which the launcher pins and
 * prepends), then `$HOME/.local/bin/uv`; reject venv shims and any version
 * other than uv 0.11.16. The returned executable is a canonical absolute
 * path, so `spawn` never relies on a late PATH lookup.
 */
export function resolveRequiredUvExecutable(
  env: Record<string, string | undefined> = process.env,
): string {
  const configured = env.COC_PI_UV_PATH ?? env.UV_BIN;
  if (configured !== undefined) {
    if (!isAbsolute(configured)) {
      throw new Error("COC_PI_UV_PATH/UV_BIN must be an absolute uv executable");
    }
    return requireExactUv(configured, configured);
  }
  const pathCandidate = findUvOnPath(env.PATH);
  if (pathCandidate !== null) return requireExactUv(pathCandidate, pathCandidate);
  const homeCandidate = join(homedir(), ".local", "bin", "uv");
  if (existsSync(homeCandidate)) return requireExactUv(homeCandidate, homeCandidate);
  throw new Error(
    `required uv ${REQUIRED_UV_VERSION} was not found; add it to PATH or install it at ~/.local/bin/uv`,
  );
}

function appendStderrTail(current: string, chunk: Buffer): string {
  const next = current + chunk.toString("utf8");
  if (Buffer.byteLength(next, "utf8") <= MAX_BRIDGE_STDERR_BYTES) return next;
  return next.slice(-MAX_BRIDGE_STDERR_BYTES);
}

/**
 * Execute one private bridge request in an isolated process group.
 *
 * Request transport is exactly one JSON value written to stdin then closed.
 * Any JSON/write/output/exit failure rejects; callers leave the durable row
 * pending rather than trusting a partial bridge response. On abort/timeout,
 * the detached uv parent and every Python/grandchild in its process group are
 * terminated through runtime's bounded SIGTERM → SIGKILL `terminateTree`.
 */
export function defaultRunMemoryHostBridge(
  bridgeCommand: () => BridgeCommand,
  workspaceRoot: () => string,
  options: MemoryHostBridgeOptions = {},
) {
  const timeoutMs = options.timeoutMs ?? HOST_BRIDGE_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
    throw new Error("memory host bridge timeout must be a positive finite number");
  }
  return async (
    request: MemoryHostBridgeRequest,
    signal?: AbortSignal,
  ): Promise<JsonObject> => {
    if (signal?.aborted) {
      throw new Error("memory host bridge aborted before launch");
    }
    const resolved = bridgeCommand();
    if (!isAbsolute(resolved.command)) {
      throw new Error("memory host bridge command must be absolute");
    }
    let input: string;
    try {
      input = JSON.stringify(request);
    } catch (error) {
      throw new Error(
        `memory host bridge request is not JSON serializable: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
    if (!input) throw new Error("memory host bridge request serialized to no JSON");

    const child = spawn(resolved.command, [...resolved.args], {
      cwd: workspaceRoot(),
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
      env: safeEnv(),
    }) as ChildProcessWithoutNullStreams;
    // Register the terminal listener before touching stdin: a tiny bridge
    // may read one request and exit fast enough to otherwise race setup.
    const closePromise = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolveClose, rejectClose) => {
      child.once("error", (error) => rejectClose(error));
      child.once("close", (code, closeSignal) => resolveClose({
        code,
        signal: closeSignal,
      }));
    });

    let termination: Promise<void> | null = null;
    const terminate = (): Promise<void> => {
      if (termination === null) termination = terminateTree(child);
      return termination;
    };
    let aborted = false;
    let timedOut = false;
    let stdoutTooLarge = false;
    const abortBridge = () => {
      aborted = true;
      void terminate().catch(() => {});
    };
    signal?.addEventListener("abort", abortBridge, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      void terminate().catch(() => {});
    }, timeoutMs);

    let stdout = "";
    let stdoutBytes = 0;
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdoutTooLarge) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_BRIDGE_STDOUT_BYTES) {
        stdoutTooLarge = true;
        void terminate().catch(() => {});
        return;
      }
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendStderrTail(stderr, chunk);
    });

    let resolveWrite!: () => void;
    let rejectWrite!: (error: Error) => void;
    let writeSettled = false;
    const writePromise = new Promise<void>((resolveWritePromise, rejectWritePromise) => {
      resolveWrite = resolveWritePromise;
      rejectWrite = rejectWritePromise;
    });
    const settleWriteError = (error: Error) => {
      if (writeSettled) return;
      writeSettled = true;
      rejectWrite(error);
    };
    const settleWriteSuccess = () => {
      if (writeSettled) return;
      writeSettled = true;
      resolveWrite();
    };
    const onStdinError = (error: Error) => settleWriteError(error);
    child.stdin.on("error", onStdinError);
    child.stdin.once("finish", settleWriteSuccess);
    child.once("close", () => {
      settleWriteError(new Error("memory host bridge exited before request stdin flushed"));
    });
    try {
      // `end` both writes the one canonical JSON request and closes stdin.
      child.stdin.end(input, "utf8");
    } catch (error) {
      settleWriteError(error instanceof Error ? error : new Error("bridge stdin write failed"));
    }

    try {
      const [, closed] = await Promise.all([writePromise, closePromise]);
      if (timedOut) throw new Error(`memory host bridge timed out after ${timeoutMs}ms`);
      if (aborted || signal?.aborted) {
        throw new Error("memory host bridge aborted (session shutdown)");
      }
      if (stdoutTooLarge) {
        throw new Error(`memory host bridge stdout exceeded ${MAX_BRIDGE_STDOUT_BYTES} bytes`);
      }
      if (closed.code !== 0) {
        throw new Error(
          `memory host bridge exited ${closed.code ?? closed.signal ?? "unknown"}: ${stderr.trim().slice(-200)}`,
        );
      }
      let receipt: JsonObject;
      try {
        receipt = asObject(JSON.parse(stdout.trim()), "memory host bridge receipt");
      } catch (error) {
        throw new Error(
          `memory host bridge returned invalid JSON: ${error instanceof Error ? error.message : "unknown"}`,
        );
      }
      if (typeof receipt.status !== "string" || !receipt.status.trim()) {
        throw new Error("memory host bridge receipt has no status");
      }
      return receipt;
    } catch (error) {
      if (child.exitCode === null) {
        try { await terminate(); } catch { /* preserve the original transport failure */ }
      }
      if (timedOut) throw new Error(`memory host bridge timed out after ${timeoutMs}ms`);
      if (aborted || signal?.aborted) {
        throw new Error("memory host bridge aborted (session shutdown)");
      }
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abortBridge);
      child.stdin.removeListener("error", onStdinError);
      if (termination !== null) {
        try { await termination; } catch { /* close/error was already surfaced above */ }
      }
    }
  };
}

/**
 * Default production command: exact uv 0.11.16, canonical absolute binary,
 * frozen project lock, then the private Python bridge. An explicitly
 * configured host bridge remains supported only when it is absolute.
 */
export function memoryHostBridgeCommand(
  env: Record<string, string | undefined> = process.env,
): BridgeCommand {
  const configured = env.COC_PI_MEMORY_EXTRACTION_HOST_COMMAND;
  if (configured) {
    if (!isAbsolute(configured)) {
      throw new Error("COC_PI_MEMORY_EXTRACTION_HOST_COMMAND must be absolute");
    }
    const command = canonicalExecutable(configured);
    if (command === null) {
      throw new Error("COC_PI_MEMORY_EXTRACTION_HOST_COMMAND is not executable");
    }
    return { command, args: [] };
  }
  return {
    command: resolveRequiredUvExecutable(env),
    args: [
      "run",
      "--project",
      PACKAGE_ROOT,
      "--frozen",
      "python",
      join(PLUGIN_ROOT, "scripts", "coc_memory_extraction_host_apply.py"),
    ],
  };
}

export class MemoryExtractionDispatcher {
  private deps: MemoryExtractionDeps | null = null;
  /** Active + executable FIFO only; therefore always <= 9. */
  private live = new Set<string>();
  private pendingQueue: QueueEntry[] = [];
  /** Durable refs discovered by re-arm/direct overflow; no child is active. */
  private refillQueue = new Map<string, QueueEntry>();
  private active: {
    key: string;
    controller: AbortController;
    settle: Promise<void>;
  } | null = null;
  private closing = false;

  start(deps: MemoryExtractionDeps): void {
    this.deps = deps;
    this.closing = false;
  }

  async shutdown(): Promise<void> {
    this.closing = true;
    for (const entry of this.pendingQueue.splice(0)) entry.resolve();
    for (const entry of this.refillQueue.values()) entry.resolve();
    this.refillQueue.clear();
    if (this.active !== null) {
      this.active.controller.abort(new Error("session_shutdown"));
      try { await this.active.settle; } catch { /* settle is own-guarded */ }
      this.active = null;
    }
    this.live.clear();
  }

  /** Executable active+queued identities, never the unbounded durable feed. */
  liveKeys(): string[] {
    return [...this.live];
  }

  has(key: string): boolean {
    return this.live.has(key) || this.refillQueue.has(key);
  }

  private entryFor(refs: MemoryExtractionRefs): QueueEntry & { settle: Promise<void> } {
    let resolve!: () => void;
    const settle = new Promise<void>((resolveSettle) => { resolve = resolveSettle; });
    void settle.catch(() => {});
    return { refs, resolve, settle };
  }

  private executionSlots(): number {
    return this.pendingQueue.length + (this.active === null ? 0 : 1);
  }

  private tracked(key: string): boolean {
    return this.live.has(key) || this.refillQueue.has(key);
  }

  /**
   * Queue one durable identity. The first nine are executable; further rows
   * are staged as refs only and move into a bounded slot after each terminal
   * worker. This keeps restart re-arm event-driven without a status poll.
   */
  schedule(refs: MemoryExtractionRefs): Promise<void> {
    const deps = this.deps;
    if (deps === null || this.closing || !deps.isCurrent()) return Promise.resolve();
    const key = liveKey(refs);
    if (this.tracked(key)) {
      deps.appendAudit({
        status: "deduped",
        campaign_id: refs.campaign_id,
        job_id: refs.job_id,
        backlog_id: refs.backlog_id,
      });
      return Promise.resolve();
    }
    const entry = this.entryFor(refs);
    this.refillQueue.set(key, entry);
    this.refill();
    return entry.settle;
  }

  /**
   * Re-arm all pending durable rows once for this lifecycle boundary. It only
   * records semantic refs; completion/failure refills the bounded executor
   * FIFO until this snapshot drains. It never probes status again itself.
   */
  rearm(
    campaignId: string,
    entries: readonly MemoryExtractionBacklogEntry[],
  ): void {
    const deps = this.deps;
    if (deps === null || this.closing || !deps.isCurrent()) return;
    for (const entry of entries) {
      if (entry.status !== "pending") continue;
      const refs: MemoryExtractionRefs = {
        campaign_id: campaignId,
        job_id: extractionJobIdFor(campaignId, entry.timeline_id, entry.turn_number),
        episode_id: `episode-${campaignId}-${entry.timeline_id}-turn-${entry.turn_number}`,
        timeline_id: entry.timeline_id,
        turn_number: entry.turn_number,
        backlog_id: entry.backlog_id,
      };
      const key = liveKey(refs);
      if (this.tracked(key)) continue;
      this.refillQueue.set(key, this.entryFor(refs));
    }
    this.refill();
  }

  private refill(): void {
    const deps = this.deps;
    if (deps === null || this.closing || !deps.isCurrent()) return;
    this.pump();
    while (
      this.executionSlots() < MAX_EXECUTING_MEMORY_EXTRACTION
      && this.refillQueue.size > 0
      && !this.closing
      && deps.isCurrent()
    ) {
      const next = this.refillQueue.entries().next().value as
        | [string, QueueEntry]
        | undefined;
      if (next === undefined) break;
      const [key, entry] = next;
      this.refillQueue.delete(key);
      if (this.live.has(key)) continue;
      this.live.add(key);
      this.pendingQueue.push(entry);
      this.pump();
    }
  }

  private pump(): void {
    const deps = this.deps;
    if (deps === null || this.active !== null || this.closing) return;
    const next = this.pendingQueue.shift();
    if (next === undefined) return;
    const controller = new AbortController();
    const key = liveKey(next.refs);
    const settle = this.runOne(next.refs, controller, next.resolve)
      .catch(() => {})
      .finally(() => {
        this.live.delete(key);
        if (this.active !== null && this.active.key === key) this.active = null;
        // One terminal worker opens one bounded slot. Refill the durable
        // snapshot before starting the next child; no status polling occurs.
        this.refill();
      });
    this.active = { key, controller, settle };
  }

  private async runOne(
    refs: MemoryExtractionRefs,
    controller: AbortController,
    resolve: () => void,
  ): Promise<void> {
    const deps = this.deps!;
    try {
      await this.extractOne(refs, controller, deps);
    } catch (error) {
      deps.appendAudit({
        status: "failed",
        campaign_id: refs.campaign_id,
        job_id: refs.job_id,
        backlog_id: refs.backlog_id,
        failure_class: "dispatcher_error",
        detail: error instanceof Error ? error.message.slice(-200) : "unknown",
      });
    } finally {
      resolve();
    }
  }

  private async extractOne(
    refs: MemoryExtractionRefs,
    controller: AbortController,
    deps: MemoryExtractionDeps,
  ): Promise<void> {
    const prepared = await deps.runHostBridge({
      schema_version: 1,
      command: "prepare",
      workspace_root: deps.workspaceRoot(),
      campaign_id: refs.campaign_id,
      backlog_id: refs.backlog_id,
    }, controller.signal);
    if (!deps.isCurrent() || controller.signal.aborted) return;
    if (prepared.status !== "ready") {
      deps.appendAudit({
        status: "skipped",
        reason: String(prepared.reason ?? prepared.status ?? "unknown"),
        campaign_id: refs.campaign_id,
        job_id: refs.job_id,
        backlog_id: refs.backlog_id,
      });
      return;
    }
    const task = validateMemoryExtractionTask({
      contract_id: MEMORY_EXTRACTOR_CONTRACT_ID,
      packet: asObject(prepared.packet, "bridge packet"),
      read: asObject(prepared.read, "bridge read payload"),
    });

    const launch = deps.launchContext();
    if (launch === null) {
      await this.recordFailure(
        deps, refs, "producer_unavailable", "no model launch context", controller.signal,
      );
      return;
    }
    const timeout = setTimeout(
      () => controller.abort(new Error("extraction timeout")),
      MEMORY_EXTRACTION_TIMEOUT_MS,
    );
    let events: JsonObject[];
    try {
      const run = deps.launchExtractor(task, launch, controller.signal);
      await run.activation;
      events = await run.completion;
    } catch (error) {
      await this.recordFailure(
        deps,
        refs,
        controller.signal.aborted ? "producer_timeout" : "producer_unavailable",
        error instanceof Error ? error.message : "extractor child failed",
        controller.signal,
      );
      return;
    } finally {
      clearTimeout(timeout);
    }
    if (!deps.isCurrent() || controller.signal.aborted) return;

    let result: { job_id: string; candidates: ExtractorCandidate[] };
    try {
      result = validateMemoryExtractorResult(task, parseExtractorEvents(events));
    } catch (error) {
      await this.recordFailure(
        deps,
        refs,
        "invalid_result",
        error instanceof Error ? error.message : "extractor result invalid",
        controller.signal,
      );
      return;
    }

    const receipt = await deps.runHostBridge({
      schema_version: 1,
      command: "apply",
      workspace_root: deps.workspaceRoot(),
      campaign_id: refs.campaign_id,
      backlog_id: refs.backlog_id,
      result: { job_id: result.job_id, candidates: result.candidates },
    }, controller.signal);
    if (receipt.status === "applied" || receipt.status === "already_applied") {
      deps.appendAudit({
        status: "applied",
        campaign_id: refs.campaign_id,
        job_id: refs.job_id,
        backlog_id: refs.backlog_id,
        applied: receipt.applied,
        backlog_status: receipt.backlog_status,
      });
      return;
    }
    deps.appendAudit({
      status: "failed",
      campaign_id: refs.campaign_id,
      job_id: refs.job_id,
      backlog_id: refs.backlog_id,
      failure_class: String(receipt.error_kind ?? receipt.status ?? "bridge_failed"),
      backlog_status: receipt.backlog_status,
    });
  }

  private async recordFailure(
    deps: MemoryExtractionDeps,
    refs: MemoryExtractionRefs,
    errorKind: string,
    detail: string,
    signal?: AbortSignal,
  ): Promise<void> {
    deps.appendAudit({
      status: "failed",
      campaign_id: refs.campaign_id,
      job_id: refs.job_id,
      backlog_id: refs.backlog_id,
      failure_class: errorKind,
      detail: detail.slice(-200),
    });
    try {
      await deps.runHostBridge({
        schema_version: 1,
        command: "record_failure",
        workspace_root: deps.workspaceRoot(),
        campaign_id: refs.campaign_id,
        backlog_id: refs.backlog_id,
        error_kind: errorKind,
        detail: detail.slice(-500),
      }, signal);
    } catch {
      // The canonical backlog is already durable/pending. Failure enrichment
      // must never block the next worker or turn.
    }
  }
}
