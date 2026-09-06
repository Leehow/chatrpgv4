/**
 * The memory extraction lane (contract §12.3, §12.8).
 *
 * When the kernel extension's narrate commits it puts `coc:turn-committed` on the bus, and this
 * catches it: `memory.job` takes a closed job packet, a zero-tool subsession extracts candidate
 * assertions, `memory.submit` writes them down. One retry on failure, then `memory.fail`, and the
 * job goes to the backlog to await an explicit redispatch.
 *
 * Three boundaries written down straight from the contract: extraction never blocks narrate (the
 * whole lane is after the delivery and is not awaited); only one job runs at a time and the rest
 * queue; whatever has not finished at process exit does not hold up shutdown and is left to the
 * next default dispatch of `memory.job`. Candidates are never promoted automatically — only
 * candidates are submitted here.
 *
 * Backfill (#20 in contract §12.8): the holes left by the previous session are filled by that
 * default dispatch. Once the bridge is up at `session_start`, jobs are asked for one at a time with
 * a `memory.job` carrying no `turn`, at most `PI_COC_MEMORY_BACKFILL` of them (5 by default), and
 * the kernel answering `job_id: null` ends it. Backfill yields to the table: no new job starts
 * while a turn is open, and a freshly committed turn always goes ahead of it.
 */

import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { cocHome, cocMode } from "../lanes/host.ts";
import { resolveLaneModel, runLane } from "../lanes/subsession.ts";

/** The closed fields and closed enums of a candidate assertion (contract §12.3). No extra field is ever sent to the kernel. */
const CANDIDATE_KINDS: ReadonlySet<string> = new Set([
	"world_event",
	"knowledge",
	"belief",
	"relationship",
	"player_assertion",
	"player_preference",
	"keeper_correction",
]);
const PRIVACY: ReadonlySet<string> = new Set(["player_safe", "keeper_only"]);
const STATES: ReadonlySet<string> = new Set(["accurate", "uncertain", "distorted"]);

const DEFAULT_MAX_CANDIDATES = 12;
const DEFAULT_MAX_STATEMENT_CHARS = 400;
/** How many turns one session may backfill at most (#20); `PI_COC_MEMORY_BACKFILL=0` turns the whole backfill off. */
const DEFAULT_BACKFILL_JOBS = 5;

/** The budget is read at `session_start`, not at module top level: the test harness loads this several times in one process. */
function backfillBudget(): number {
	const raw = process.env.PI_COC_MEMORY_BACKFILL?.trim();
	if (!raw) return DEFAULT_BACKFILL_JOBS;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_BACKFILL_JOBS;
}

interface Candidate {
	kind: string;
	subject: string;
	statement: string;
	knowers?: string[];
	entities?: string[];
	privacy?: string;
	state?: string;
	confidence?: number;
}

/** The job packet from `memory.job`; only the fields it lists are read, and nothing else reaches the prompt. */
interface JobPacket {
	job_id?: string | null;
	turn?: number;
	commit?: string;
	scene?: { name?: string; display_name?: string };
	present?: unknown[];
	investigators?: Array<{ id?: string; name?: string }>;
	player_text?: string;
	keeper_text?: string;
	committed_facts?: unknown[];
	known_entities?: Array<{ name?: string; kind?: string }>;
	prior?: Array<Record<string, unknown>>;
	budget?: { max_candidates?: number; max_statement_chars?: number };
	instruction?: string;
}

type KernelCall = (method: string, params: Record<string, unknown>) => Promise<unknown>;

/**
 * One extraction job. With a `turn` it is the turn just committed; without one it is the default
 * dispatch (backfill), where the kernel picks a turn whose job is unfinished and not in the
 * backlog (contract §12.3).
 */
interface Job {
	campaign: string;
	turn?: number;
	backfill?: boolean;
}

function names(rows: unknown): string {
	if (!Array.isArray(rows) || rows.length === 0) return "(none)";
	return rows
		.map((row) => {
			if (typeof row === "string") return row;
			const record = (row ?? {}) as Record<string, unknown>;
			const name = record.name ?? record.id;
			return typeof name === "string" ? name : JSON.stringify(row);
		})
		.join(", ");
}

function lines(rows: unknown): string {
	if (!Array.isArray(rows) || rows.length === 0) return "(none)";
	return rows.map((row) => `- ${typeof row === "string" ? row : JSON.stringify(row)}`).join("\n");
}

function systemPrompt(packet: JobPacket): string {
	const maxCandidates = packet.budget?.max_candidates ?? DEFAULT_MAX_CANDIDATES;
	const maxChars = packet.budget?.max_statement_chars ?? DEFAULT_MAX_STATEMENT_CHARS;
	return [
		// The instruction is the passage the kernel writes in play_language (contract §12.3); the lane
		// passes it on verbatim, rewriting nothing and adding nothing.
		packet.instruction ??
			"Write only the facts, knowledge, beliefs, relationships and player assertions new to this turn, in the campaign's play_language; write no numbers and no die faces.",
		"",
		"Answer with one JSON object only, no code fence and no explanation:",
		'{"candidates":[{"kind":"...","subject":"...","knowers":["..."],"statement":"...","entities":["..."],"privacy":"player_safe","state":"accurate","confidence":0.8}]}',
		"Field rules:",
		"- kind is one of: world_event, knowledge, belief, relationship, player_assertion, player_preference, keeper_correction.",
		"- privacy is player_safe or keeper_only; state is accurate, uncertain or distorted; confidence is a decimal from 0 to 1.",
		"- names in subject, knowers and entities must come from the available names below, or be one of the reserved subjects world, party, keeper, player.",
		"- world_event must have subject world; relationship must have exactly one entity.",
		`- statement is 1 to ${maxChars} characters, one sentence saying one thing.`,
		"- write no key other than the ones listed above, and in particular no turn number, commit, receipt id or entry id.",
		`- at most ${maxCandidates} rows; do not repeat anything already in the existing candidates; with nothing new, answer {"candidates":[]}.`,
	].join("\n");
}

function userInput(packet: JobPacket): string {
	return [
		`[Location] ${packet.scene?.display_name ?? packet.scene?.name ?? "(unknown)"}`,
		`[Present] ${names(packet.present)}`,
		`[Investigators] ${names(packet.investigators)}`,
		`[Available names] ${names(packet.known_entities)}`,
		"",
		"[What the player said this turn]",
		packet.player_text?.trim() || "(nothing)",
		"",
		"[The prose the Keeper delivered this turn]",
		packet.keeper_text?.trim() || "(nothing)",
		"",
		"[Committed facts]",
		lines(packet.committed_facts),
		"",
		"[Existing candidates: do not restate these]",
		lines(packet.prior),
	].join("\n");
}

/** Shape check: closed fields and closed enums; an unrecognised row is dropped whole. Whether the content is right (names, ambiguity) is the kernel's check. */
function shapeCandidates(parsed: unknown, packet: JobPacket): Candidate[] | undefined {
	if (!parsed || typeof parsed !== "object") return undefined;
	const raw = Array.isArray(parsed) ? parsed : (parsed as { candidates?: unknown }).candidates;
	if (!Array.isArray(raw)) return undefined;
	const limit = packet.budget?.max_candidates ?? DEFAULT_MAX_CANDIDATES;
	const candidates: Candidate[] = [];
	for (const entry of raw) {
		if (!entry || typeof entry !== "object") continue;
		const row = entry as Record<string, unknown>;
		if (typeof row.kind !== "string" || !CANDIDATE_KINDS.has(row.kind)) continue;
		if (typeof row.subject !== "string" || row.subject.trim().length === 0) continue;
		if (typeof row.statement !== "string" || row.statement.trim().length === 0) continue;
		const knowers = Array.isArray(row.knowers) ? row.knowers.filter((n): n is string => typeof n === "string") : undefined;
		const entities = Array.isArray(row.entities) ? row.entities.filter((n): n is string => typeof n === "string") : undefined;
		candidates.push({
			kind: row.kind,
			subject: row.subject.trim(),
			statement: row.statement.trim(),
			...(knowers?.length ? { knowers } : {}),
			...(entities?.length ? { entities } : {}),
			...(typeof row.privacy === "string" && PRIVACY.has(row.privacy) ? { privacy: row.privacy } : {}),
			...(typeof row.state === "string" && STATES.has(row.state) ? { state: row.state } : {}),
			...(typeof row.confidence === "number" && row.confidence >= 0 && row.confidence <= 1
				? { confidence: row.confidence }
				: {}),
		});
		if (candidates.length >= limit) break;
	}
	return candidates;
}

/** The code of a kernel error envelope is read structurally: instanceof is unreliable across extensions (two module instances). */
function errorCode(error: unknown): string | undefined {
	const code = (error as { code?: unknown } | null)?.code;
	return typeof code === "string" ? code : undefined;
}

function errorText(error: unknown): string {
	return (error instanceof Error ? error.message : String(error)).slice(0, 200);
}

export default function (pi: ExtensionAPI) {
	// The setup process has no turns and so no memory to extract: it registers nothing and subscribes to nothing (contract §14.4).
	if (cocMode() === "setup") return;

	let ctx: ExtensionContext | undefined;
	let bridge: { campaign: string; call: KernelCall } | undefined;
	let lanes = new AbortController();
	let stopped = false;
	let running = false;
	/** Freshly committed turns, first come first served; backfill always queues behind this (#20). */
	const queue: Job[] = [];
	/** How many backfills this session has left; `backfillDone` stops when the kernel answers `job_id: null`. */
	let backfillLeft = 0;
	let backfillDone = false;
	/** An agent running means a turn is open: backfill starts no new job then, so it does not compete with the delivery. */
	let agentRunning = false;

	// ---- Telemetry --------------------------------------------------------

	async function record(campaign: string, row: Record<string, unknown>): Promise<void> {
		const line = { lane: "memory", ...row };
		let cwd: string | undefined;
		try {
			pi.appendEntry("coc-telemetry", line);
			// After the session is disposed the ctx getters throw (docs/pi-host-contract.md §5), and the
			// lane's continuation may well land after that: read it, treat a throw as "no workspace",
			// and never let the exception out of the lane.
			cwd = ctx?.cwd;
		} catch {
			/* telemetry must not break a lane */
		}
		if (!cwd) return;
		const path = join(cocHome(cwd), ".coc", "campaigns", campaign, "telemetry.jsonl");
		try {
			await mkdir(dirname(path), { recursive: true });
			await appendFile(path, `${JSON.stringify(line)}\n`, "utf8");
		} catch {
			/* same as above */
		}
	}

	// ---- One extraction ---------------------------------------------------

	/** One attempt: the subsession extracts candidates, then `memory.submit`. Failure reasons use `memory.fail`'s closed enum. */
	async function attempt(
		packet: JobPacket,
		jobId: string,
		campaign: string,
		call: KernelCall,
	): Promise<{ ok: true; candidates: number; model: string } | { ok: false; reason: string; detail: string }> {
		const lane = await runLane<Candidate[]>({
			ctx: ctx as ExtensionContext,
			envName: "PI_COC_MEMORY_MODEL",
			systemPrompt: systemPrompt(packet),
			input: userInput(packet),
			signal: lanes.signal,
			shape: (parsed) => shapeCandidates(parsed, packet),
		});
		if (!lane.ok) {
			return { ok: false, reason: lane.reason === "model_unavailable" ? "lane_error" : "model_error", detail: lane.detail };
		}
		try {
			await call("memory.submit", { campaign, job_id: jobId, candidates: lane.value });
			return { ok: true, candidates: lane.value.length, model: lane.model };
		} catch (error) {
			const code = errorCode(error);
			return {
				ok: false,
				reason: code === "invalid_params" ? "invalid" : "lane_error",
				detail: `${code ?? "internal"}: ${errorText(error)}`,
			};
		}
	}

	async function runJob(job: Job): Promise<void> {
		const began = Date.now();
		// Every backfill telemetry row carries `backfill: true` (contract §12.8): extraction at the table and filling holes stay apart.
		const note = (row: Record<string, unknown>) =>
			record(job.campaign, { ...(job.backfill ? { backfill: true } : {}), ...row });
		const current = bridge;
		if (!current || !ctx) {
			await note({ turn: job.turn, ok: false, reason: "lane_error", detail: "the kernel bridge is gone; the lane cannot run" });
			return;
		}
		// Resolve the model first: if it cannot be resolved, do not take the job away from the kernel, or it lands in the backlog for nothing.
		const model = resolveLaneModel(ctx, "PI_COC_MEMORY_MODEL");
		if (!model.ok) {
			await note({ turn: job.turn, ok: false, reason: "model_unavailable", detail: model.detail });
			return;
		}

		let packet: JobPacket;
		try {
			// The default dispatch carries no `turn`: the kernel picks a turn not yet extracted and not in the backlog (contract §12.3).
			packet = ((await current.call("memory.job", {
				campaign: job.campaign,
				...(typeof job.turn === "number" ? { turn: job.turn } : {}),
			})) ?? {}) as JobPacket;
		} catch (error) {
			await note({
				turn: job.turn,
				ok: false,
				ms: Date.now() - began,
				reason: "lane_error",
				detail: `memory.job ${errorCode(error) ?? "internal"}: ${errorText(error)}`,
			});
			return;
		}
		const jobId = typeof packet.job_id === "string" ? packet.job_id : undefined;
		if (!jobId) {
			if (job.backfill) {
				// The default dispatch came back empty: there are no holes left, so this session asks no more (#20).
				// That is backfill's ordinary ending, and it writes no telemetry — one "nothing to do" line per opening is noise.
				backfillDone = true;
				return;
			}
			// Nothing to extract for this turn (already extracted, or in the backlog awaiting an explicit redispatch).
			await note({ turn: job.turn, ok: true, ms: Date.now() - began, skipped: "no_job" });
			return;
		}

		let last: { ok: false; reason: string; detail: string } | undefined;
		for (let tries = 0; tries < 2 && !stopped; tries += 1) {
			const outcome = await attempt(packet, jobId, job.campaign, current.call);
			if (outcome.ok) {
				await note({
					turn: packet.turn ?? job.turn,
					job_id: jobId,
					ok: true,
					ms: Date.now() - began,
					model: outcome.model,
					candidates: outcome.candidates,
					...(tries > 0 ? { retried: true } : {}),
				});
				return;
			}
			last = outcome;
		}
		if (stopped) return;
		const failure = last ?? { reason: "lane_error", detail: "the lane never started" };
		try {
			await current.call("memory.fail", {
				campaign: job.campaign,
				job_id: jobId,
				reason: failure.reason,
				detail: failure.detail,
			});
		} catch (error) {
			await note({
				turn: packet.turn ?? job.turn,
				job_id: jobId,
				ok: false,
				reason: "lane_error",
				detail: `memory.fail did not land either: ${errorText(error)}`,
			});
			return;
		}
		await note({
			turn: packet.turn ?? job.turn,
			job_id: jobId,
			ok: false,
			ms: Date.now() - began,
			model: `${model.model.provider}/${model.model.id}`,
			reason: failure.reason,
			detail: failure.detail.slice(0, 200),
			failed: true,
		});
	}

	/**
	 * The next job to run. A freshly committed turn always goes first: backfill only starts when the
	 * queue is empty, no turn is open, the budget is not spent, and the kernel has not yet said there
	 * are no holes left (#20).
	 */
	function nextJob(): Job | undefined {
		const queued = queue.shift();
		if (queued) return queued;
		if (stopped || backfillDone || agentRunning || backfillLeft <= 0) return undefined;
		const current = bridge;
		if (!current || !ctx) return undefined;
		backfillLeft -= 1;
		return { campaign: current.campaign, backfill: true };
	}

	/** Only one job runs at a time; the rest queue and never overlap. */
	async function pump(): Promise<void> {
		if (running) return;
		running = true;
		try {
			while (!stopped) {
				const job = nextJob();
				if (!job) break;
				try {
					await runJob(job);
				} catch (error) {
					// However badly a lane breaks it is still only a lane: it must not become an unhandled
					// rejection, and it must not block the next job in the queue.
					await record(job.campaign, {
						turn: job.turn,
						ok: false,
						reason: "lane_error",
						detail: errorText(error),
					});
				}
			}
		} finally {
			running = false;
		}
	}

	// ---- Bus --------------------------------------------------------------

	// The kernel extension loads first but only emits the bridge in session_start: both orders must be caught.
	pi.events.on("coc:kernel-bridge", (data) => {
		const payload = (data ?? {}) as { campaign?: string; call?: KernelCall };
		bridge = typeof payload.call === "function" && payload.campaign
			? { campaign: payload.campaign, call: payload.call }
			: undefined;
		// Backfill must still start when the bridge arrives after this extension's session_start; the
		// other order is kicked by session_start itself (there is no ctx yet, so the pump spins once and returns).
		if (bridge && ctx && !stopped) void pump().catch(() => undefined);
	});

	pi.events.on("coc:turn-committed", (data) => {
		const payload = (data ?? {}) as { campaign?: string; turn?: number };
		if (stopped || !payload.campaign || typeof payload.turn !== "number") return;
		queue.push({ campaign: payload.campaign, turn: payload.turn });
		void pump().catch(() => undefined);
	});

	// No backfill while a turn is open (#20): an agent running is the player's turn running, and that
	// includes the delivery, the steer and the recovery runs. `agent_settled` is "this run really
	// finished"; it is emitted in a finally, so it is never missed.
	pi.on("agent_start", async () => {
		agentRunning = true;
	});

	pi.on("agent_settled", async () => {
		agentRunning = false;
		if (!stopped) void pump().catch(() => undefined);
	});

	pi.on("session_start", async (_event, sessionCtx) => {
		ctx = sessionCtx;
		stopped = false;
		agentRunning = false;
		lanes = new AbortController();
		queue.length = 0;
		// The backfill budget is per session (#20 in contract §12.8): by now the kernel extension has
		// already emitted the bridge (extension session_start handlers run serially in load order, kernel first).
		backfillLeft = backfillBudget();
		backfillDone = backfillLeft <= 0;
		if (!backfillDone) void pump().catch(() => undefined);
	});

	pi.on("session_shutdown", async () => {
		// Shutdown does not wait for the lane: queued jobs are dropped, in-flight ones cut off, and whatever was not extracted comes back on the next default dispatch of `memory.job`.
		stopped = true;
		queue.length = 0;
		backfillLeft = 0;
		backfillDone = true;
		lanes.abort();
		bridge = undefined;
		ctx = undefined;
	});
}
