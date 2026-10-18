/**
 * The memory and NPC journal lanes share scheduling, not jobs or RPCs (contract §12.8, §17.10).
 * Each factory call owns its queue, backfill budget and cancellation controller independently.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { AsyncLocalStorage } from "node:async_hooks";

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
	/**
	 * Bus events that queue a job for the bridged campaign, beside committed turns: the epithet lane asks again when the
	 * book's cast lands (`coc:cast-published`, §177.5). A payload naming another campaign is not this table's.
	 */
	wakeOn?: readonly string[];
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
	const committed = new Set<string>();
	type Owner = {ctx: ExtensionContext; raw: NonNullable<typeof bridge>; bridge: NonNullable<typeof bridge>; signal: AbortSignal; backfill?:boolean; credited?:boolean};
	const owners = new AsyncLocalStorage<Owner>();
	const valid = (owner: Owner) => !stopped && !owner.signal.aborted && owner.raw === bridge && owner.ctx === ctx;
	function prepareInitial(): void {
		if (!options.initialJob || stopped || !ctx || !bridge || initialCampaigns.has(bridge.campaign)) return;
		initialCampaigns.add(bridge.campaign);
		queue.push({campaign: bridge.campaign});
	}

	function nextJob(): LaneJob | undefined {
		if (!ctx || !bridge || Date.now() < pauseUntil || agentRunning || foregroundPending) return undefined;
		// Committed turns are FIFO and always precede backfill, even after the agent has settled.
		const queued = queue.shift();
		if (queued) return queued;
		if (stopped || backfillDone || backfillLeft <= 0 || !bridge || !ctx) return undefined;
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
				const raw = bridge!;
				const owner: Owner = {ctx: ctx!, raw, signal, backfill:job.backfill, bridge: {campaign: raw.campaign, call: async (method, params) => {
					if (!valid(owner)) throw new DOMException("The background job owner is no longer active", "AbortError");
					return raw.call(method, params);
				}}};
				try {
					const outcome = await owners.run(owner, () => options.runJob(job));
					if (outcome?.deferred && valid(owner)) {
						queue.unshift(job);
						break;
					}
				} catch (error) {
					// A broken job must not block the next one; its lane owns the telemetry.
					if (valid(owner)) await owners.run(owner, () => options.onError(job, error));
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
		const owner = owners.getStore();
		if (owner && !valid(owner)) return;
		if (stopped || !Number.isFinite(milliseconds) || milliseconds <= 0) return;
		const duration = Math.min(60_000, Math.max(1, Math.floor(milliseconds)));
		const until = Date.now() + duration;
		if (until <= pauseUntil) return;
		clearTimeout(pauseTimer); pauseUntil = until;
		pauseTimer = setTimeout(() => {pauseTimer = undefined; pauseUntil = 0; if (!stopped) wake();}, duration);
	}

	pi.events.on("coc:kernel-bridge", (data) => {
		const payload = (data ?? {}) as { campaign?: string; call?: KernelCall };
		const next = typeof payload.call === "function" && payload.campaign
			? { campaign: payload.campaign, call: payload.call }
			: undefined;
		if (bridge?.campaign !== next?.campaign || bridge?.call !== next?.call) {
			lanes.abort();
			lanes = new AbortController();
			bridge = next;
			for (let i = queue.length - 1; i >= 0; i--) if (queue[i].campaign !== next?.campaign) queue.splice(i, 1);
			clearPause();
		}
		prepareInitial();
		// Either the bridge or session_start may arrive first. Only the second can start backfill.
		if (bridge && ctx && !stopped) wake();
	});

	for (const name of options.wakeOn ?? []) pi.events.on(name, (data) => {
		const payload = (data ?? {}) as { campaign?: string };
		if (stopped || !bridge || (payload.campaign && payload.campaign !== bridge.campaign)) return;
		if (!queue.some(job => job.campaign === bridge!.campaign && job.turn === undefined && !job.backfill)) queue.push({ campaign: bridge.campaign });
		wake();
	});

	pi.events.on("coc:turn-committed", (data) => {
		const payload = (data ?? {}) as { campaign?: string; turn?: number; commit?: string; job_id?: string };
		if (stopped || !bridge || payload.campaign !== bridge.campaign || typeof payload.turn !== "number") return;
		if (options.accept && !options.accept(payload as Record<string, unknown>)) return;
		const key = JSON.stringify([payload.campaign, payload.turn, payload.commit ?? payload.job_id ?? null]);
		if (committed.has(key)) return;
		committed.add(key);
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
		lanes.abort();
		ctx = sessionCtx;
		stopped = false;
		agentRunning = false;
		foregroundPending = false;
		lanes = new AbortController();
		clearPause();
		queue.length = 0;
		initialCampaigns.clear();
		committed.clear();
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
		get ctx() { const owner = owners.getStore(); return owner ? valid(owner) ? owner.ctx : undefined : ctx; },
		get bridge() { const owner = owners.getStore(); return owner ? valid(owner) ? owner.bridge : undefined : bridge; },
		get signal() { return owners.getStore()?.signal ?? lanes.signal; },
		get stopped() { const owner = owners.getStore(); return stopped || !!owner && !valid(owner); },
		stopBackfill() { const owner = owners.getStore(); if (!owner || valid(owner)) backfillDone = true; },
		/** A cached no-op consumes no new-work slot. Only its active backfill owner can credit it, once. */
		creditBackfill() { const owner=owners.getStore();if(!owner?.backfill||owner.credited||!valid(owner)||backfillDone)return false;owner.credited=true;backfillLeft++;return true; },
		pauseFor,
	};
}
