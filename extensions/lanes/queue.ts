/**
 * The memory and NPC journal lanes share scheduling, not jobs or RPCs (contract §12.8, §17.10).
 * Each factory call owns its queue, backfill budget and cancellation controller independently.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export type KernelCall = (method: string, params: Record<string, unknown>) => Promise<unknown>;

/** An explicit committed turn, or a default dispatch whose turn the kernel chooses. */
export interface LaneJob {
	campaign: string;
	turn?: number;
	backfill?: boolean;
}

interface QueueOptions {
	backfillEnv: string;
	/** Rounds of backfill per session when the env is unset; the journal and memory lanes keep 5, the voice lane 0 (§40.5). */
	backfillDefault?: number;
	runJob: (job: LaneJob) => Promise<void>;
	onError: (job: LaneJob, error: unknown) => Promise<void>;
}

/** Read at session_start, never at module load. Zero disables backfill, not committed turns. */
function backfillBudget(envName: string, fallback = 5): number {
	const raw = process.env[envName]?.trim();
	const parsed = raw ? Number.parseInt(raw, 10) : NaN;
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function createLaneQueue(pi: ExtensionAPI, options: QueueOptions) {
	let ctx: ExtensionContext | undefined;
	let bridge: { campaign: string; call: KernelCall } | undefined;
	let lanes = new AbortController();
	let stopped = false;
	let running = false;
	const queue: LaneJob[] = [];
	let backfillLeft = 0;
	let backfillDone = false;
	let agentRunning = false;

	function nextJob(): LaneJob | undefined {
		// Committed turns are FIFO and always precede backfill, even after the agent has settled.
		const queued = queue.shift();
		if (queued) return queued;
		if (stopped || backfillDone || agentRunning || backfillLeft <= 0 || !bridge || !ctx) return undefined;
		backfillLeft -= 1;
		return { campaign: bridge.campaign, backfill: true };
	}

	async function pump(): Promise<void> {
		if (running) return;
		running = true;
		try {
			while (!stopped) {
				const job = nextJob();
				if (!job) break;
				try {
					await options.runJob(job);
				} catch (error) {
					// A broken job must not block the next one; its lane owns the telemetry.
					await options.onError(job, error);
				}
			}
		} finally {
			running = false;
		}
	}

	function wake(): void {
		void pump().catch(() => undefined);
	}

	pi.events.on("coc:kernel-bridge", (data) => {
		const payload = (data ?? {}) as { campaign?: string; call?: KernelCall };
		bridge = typeof payload.call === "function" && payload.campaign
			? { campaign: payload.campaign, call: payload.call }
			: undefined;
		// Either the bridge or session_start may arrive first. Only the second can start backfill.
		if (bridge && ctx && !stopped) wake();
	});

	pi.events.on("coc:turn-committed", (data) => {
		const payload = (data ?? {}) as { campaign?: string; turn?: number };
		if (stopped || !payload.campaign || typeof payload.turn !== "number") return;
		queue.push({ campaign: payload.campaign, turn: payload.turn });
		wake();
	});

	pi.on("agent_start", async () => {
		agentRunning = true;
	});
	// agent_end can schedule recovery/steering runs; only agent_settled closes the whole run.
	pi.on("agent_settled", async () => {
		agentRunning = false;
		if (!stopped) wake();
	});

	pi.on("session_start", async (_event, sessionCtx) => {
		ctx = sessionCtx;
		stopped = false;
		agentRunning = false;
		lanes = new AbortController();
		queue.length = 0;
		backfillLeft = backfillBudget(options.backfillEnv, options.backfillDefault);
		backfillDone = backfillLeft <= 0;
		// Do not reset running: a previous session's continuation still owns the pump until finally.
		if (!backfillDone) wake();
	});

	pi.on("session_shutdown", async () => {
		// Never await the model or fail an unfinished job: the kernel can dispatch it next session.
		stopped = true;
		queue.length = 0;
		backfillLeft = 0;
		backfillDone = true;
		lanes.abort();
		bridge = undefined;
		ctx = undefined;
	});

	// Live reads preserve session reuse and cancellation checks across a lane's async continuations.
	return {
		get ctx() { return ctx; },
		get bridge() { return bridge; },
		get signal() { return lanes.signal; },
		get stopped() { return stopped; },
		stopBackfill() { backfillDone = true; },
	};
}
