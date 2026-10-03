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
	/** Prepare the current campaign once when both session and bridge are ready; never a backfill. */
	initialJob?: boolean;
	/** The variable naming this lane's backfill budget; a lane with none never backfills (the speech edit lane, §165). */
	backfillEnv?: string;
	/** Rounds of backfill per session when the env is unset; the journal and memory lanes keep 5, the voice lane 0 (§40.5). */
	backfillDefault?: number;
	/**
	 * Which committed turns this lane queues, read off the `coc:turn-committed` payload before any kernel call; absent,
	 * every one. The speech edit lane takes only a delivery with a line not the investigator's in its `speech` (§165.3).
	 */
	accept?: (payload: Record<string, unknown>) => boolean;
	runJob: (job: LaneJob) => Promise<void | {deferred: true}>;
	onError: (job: LaneJob, error: unknown) => Promise<void>;
}

/** Read at session_start, never at module load. Zero disables backfill, not committed turns. */
function backfillBudget(envName: string | undefined, fallback = 5): number {
	if (!envName) return 0;
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
	let foregroundPending = false;
	let pauseUntil = 0, pauseTimer: ReturnType<typeof setTimeout> | undefined;
	const initialCampaigns = new Set<string>();
	function prepareInitial(): void {
		if (!options.initialJob || stopped || !ctx || !bridge || initialCampaigns.has(bridge.campaign)) return;
		initialCampaigns.add(bridge.campaign);
		queue.push({campaign: bridge.campaign});
	}

	function nextJob(): LaneJob | undefined {
		if (Date.now() < pauseUntil) return undefined;
		// Committed turns are FIFO and always precede backfill, even after the agent has settled.
		const queued = queue.shift();
		if (queued) return queued;
		if (stopped || backfillDone || agentRunning || foregroundPending || backfillLeft <= 0 || !bridge || !ctx) return undefined;
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
				const signal = lanes.signal;
				try {
					const outcome = await options.runJob(job);
					if (outcome?.deferred && !stopped && !signal.aborted) {
						queue.unshift(job);
						break;
					}
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
	function clearPause(): void {
		clearTimeout(pauseTimer); pauseTimer = undefined; pauseUntil = 0;
	}
	function pauseFor(milliseconds: number): void {
		if (stopped || !Number.isFinite(milliseconds) || milliseconds <= 0) return;
		const duration = Math.min(60_000, Math.max(1, Math.floor(milliseconds)));
		const until = Date.now() + duration;
		if (until <= pauseUntil) return;
		clearTimeout(pauseTimer); pauseUntil = until;
		pauseTimer = setTimeout(() => {pauseTimer = undefined; pauseUntil = 0; if (!stopped) wake();}, duration);
	}

	pi.events.on("coc:kernel-bridge", (data) => {
		const payload = (data ?? {}) as { campaign?: string; call?: KernelCall };
		bridge = typeof payload.call === "function" && payload.campaign
			? { campaign: payload.campaign, call: payload.call }
			: undefined;
		prepareInitial();
		// Either the bridge or session_start may arrive first. Only the second can start backfill.
		if (bridge && ctx && !stopped) wake();
	});

	pi.events.on("coc:turn-committed", (data) => {
		const payload = (data ?? {}) as { campaign?: string; turn?: number };
		if (stopped || !payload.campaign || typeof payload.turn !== "number") return;
		if (options.accept && !options.accept(payload as Record<string, unknown>)) return;
		queue.push({ campaign: payload.campaign, turn: payload.turn });
		wake();
	});

	// Pi defers settled-handler prompts and reports idle during their async preflight.
	// The sender reserves foreground synchronously, before calling sendUserMessage.
	pi.events.on("coc:foreground-pending", () => {
		if (!stopped) foregroundPending = true;
	});
	pi.on("agent_start", async () => {
		foregroundPending = false;
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
		foregroundPending = false;
		lanes = new AbortController();
		clearPause();
		queue.length = 0;
		initialCampaigns.clear();
		backfillLeft = backfillBudget(options.backfillEnv, options.backfillDefault);
		backfillDone = backfillLeft <= 0;
		// Do not reset running: a previous session's continuation still owns the pump until finally.
		prepareInitial();
		if (queue.length || !backfillDone) wake();
	});

	pi.on("session_shutdown", async () => {
		// Never await the model or fail an unfinished job: the kernel can dispatch it next session.
		stopped = true;
		clearPause();
		foregroundPending = false;
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
		pauseFor,
	};
}
