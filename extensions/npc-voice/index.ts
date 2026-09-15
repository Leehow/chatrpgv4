/**
 * The NPC voice lane (contract §40.5, the §17.10 shape, scheduling shared with §12.8).
 *
 * Most imported books give most people no printed speech at all, so most people at most tables
 * have nothing for the Keeper to perform from. This lane writes two short lines per person — one
 * at ease, one under strain — and `voice.submit` files them under this package's own dossier word
 * (§28.7), where they reach the Keeper as `sounds like`. They are Keeper-facing material like
 * `voice`: never the journal, never `table.view`, never the player.
 *
 * The boundaries are the journal lane's own: the lane never blocks narrate (everything here is
 * after the delivery and is not awaited); only one job runs at a time and the rest queue; whatever
 * has not finished at process exit is left to a later dispatch. One job is one person, and a
 * person whose lines are already written — authored by the book or established here — is never
 * offered, so this lane calls a model once per person for the life of a campaign.
 *
 * Draining: `voice.job` names no turn. A committed turn may leave several people needing lines
 * (a crowded scene), so a commit drains the queue — asking again until the kernel answers
 * `job_id: null` — with a ceiling of MAX_JOBS_PER_COMMIT so one turn can never turn into an
 * unbounded run of model calls. Backfill is one drain of the same kind behind
 * `PI_COC_NPCVOICE_BACKFILL`, asked with `backfill: true` so the kernel widens the order to every
 * named NPC of the graph; a table that opens on a crowded scene is covered by its second turn.
 *
 * Retries: at most one per person per session (contract §40.5). A job that fails twice is failed
 * to the kernel and the person is retired for this session; because a failed job is offered again,
 * meeting a retired person ends the drain rather than spinning on them.
 */

import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { appendJsonl, cocHome, cocMode } from "../lanes/host.ts";
import { resolveLaneModel, runLane } from "../lanes/subsession.ts";
import { createLaneQueue, type KernelCall, type LaneJob } from "../lanes/queue.ts";

/** Fallbacks only: the kernel's job packet carries the real budget, and these stand in when it does not. */
const DEFAULT_LINES = 2;
const DEFAULT_MAX_CHARS = 120;
/** One commit can leave several people needing lines; it can never leave an unbounded number. */
const MAX_JOBS_PER_COMMIT = 6;
/** Two attempts is one retry (contract §40.5). */
const MAX_ATTEMPTS = 2;

/** The job packet from `voice.job`; only the fields §40.5 lists are read, and nothing else reaches the prompt. */
interface JobPacket {
	job_id?: string | null;
	play_language?: string;
	module?: { title?: string; era?: string };
	coarse_language?: boolean;
	npc?: {
		handle?: string;
		name?: string;
		role?: string;
		wants?: string;
		fears?: string;
		hides?: string;
		voice?: string;
		speaks?: string;
		would_lie_about?: unknown;
		deflect_lines?: unknown;
		knowledge?: unknown;
	};
	documents?: unknown;
	budget?: { lines?: number; max_chars?: number };
	instruction?: string;
}

/** One dossier line of the packet, or nothing: an absent field is absent from the prompt, never filled in. */
function field(label: string, value: unknown): string[] {
	if (typeof value === "string" && value.trim()) return [`[${label}] ${value.trim()}`];
	if (!Array.isArray(value)) return [];
	const rows = value.flatMap((row) => (typeof row === "string" && row.trim() ? [row.trim()] : []));
	return rows.length ? [`[${label}] ${rows.join(" | ")}`] : [];
}

function systemPrompt(packet: JobPacket): string {
	const lines = packet.budget?.lines ?? DEFAULT_LINES;
	const maxChars = packet.budget?.max_chars ?? DEFAULT_MAX_CHARS;
	return [
		// The instruction is the fixed passage the kernel writes (contract §40.5); the lane passes it
		// on verbatim, rewriting nothing and adding nothing.
		packet.instruction ??
			"Write two lines this person would actually say, in the campaign's play language: one at ease, brushing off a stranger's first question, and one under strain, pressed on the thing they hide.",
		"",
		"Answer with one JSON object only, no code fence and no explanation:",
		'{"sample_lines":["...","..."]}',
		"Field rules:",
		`- exactly ${lines} strings, in that order: at ease first, under strain second.`,
		`- each line is 1 to ${maxChars} characters, on one line, and the two are not the same line.`,
		"- write the lines in play_language, and write no key other than sample_lines.",
		"- no numbers, no rules, no braces, and nothing the player has not discovered.",
	].join("\n");
}

function userInput(packet: JobPacket): string {
	const npc = packet.npc ?? {};
	const documents = Array.isArray(packet.documents)
		? packet.documents.flatMap((row) => (typeof row === "string" && row.trim() ? [row.trim()] : []))
		: [];
	return [
		`[Play language] ${packet.play_language ?? "(unstated)"}`,
		`[Coarse language] ${packet.coarse_language === false ? "off" : "on"}`,
		`[Book] ${packet.module?.title ?? "(unknown)"}${packet.module?.era ? ` — ${packet.module.era}` : ""}`,
		"",
		`[Person] ${npc.name ?? "(unnamed)"}`,
		...field("Role", npc.role),
		...field("Wants", npc.wants),
		...field("Fears", npc.fears),
		...field("Hides", npc.hides),
		...field("Voice the book gives them", npc.voice),
		...field("Speaks", npc.speaks),
		...field("Would lie about", npc.would_lie_about),
		...field("Deflects with", npc.deflect_lines),
		...field("Knows", npc.knowledge),
		"",
		"[Their own documents]",
		documents.length ? documents.join("\n\n") : "(none)",
	].join("\n");
}

/**
 * Shape check, and shape only (contract §40.5): the count the budget names, each line trimmed and
 * bounded, the two distinct, no machine token and no line break. Nothing semantic is judged here —
 * no register detector, no language detector, no word list.
 */
function shapeLines(parsed: unknown, packet: JobPacket): string[] | undefined {
	if (!parsed || typeof parsed !== "object") return undefined;
	const raw = Array.isArray(parsed) ? parsed : (parsed as { sample_lines?: unknown }).sample_lines;
	const wanted = packet.budget?.lines ?? DEFAULT_LINES;
	const maxChars = packet.budget?.max_chars ?? DEFAULT_MAX_CHARS;
	if (!Array.isArray(raw) || raw.length !== wanted) return undefined;
	const lines: string[] = [];
	for (const row of raw) {
		if (typeof row !== "string") return undefined;
		const line = row.trim();
		if (line.length < 1 || line.length > maxChars) return undefined;
		if (line.includes("{{") || line.includes("\n") || line.includes("\r")) return undefined;
		if (lines.includes(line)) return undefined;
		lines.push(line);
	}
	return lines;
}

/** The code of a kernel error envelope is read structurally: instanceof is unreliable across extensions (two module instances). */
function errorCode(error: unknown): string | undefined {
	const code = (error as { code?: unknown } | null)?.code;
	return typeof code === "string" ? code : undefined;
}

function errorText(error: unknown): string {
	return (error instanceof Error ? error.message : String(error)).slice(0, 200);
}

/** `voice:<campaign>:<handle>`: the handle is the job's last colon-separated part when the packet omits it. */
function handleOf(packet: JobPacket, jobId: string): string {
	const named = packet.npc?.handle;
	if (typeof named === "string" && named.trim()) return named.trim();
	const tail = jobId.slice(jobId.lastIndexOf(":") + 1);
	return tail || jobId;
}

export default function (pi: ExtensionAPI) {
	// The setup process has no turns and so nobody to hear: it registers nothing and subscribes to nothing.
	if (cocMode() === "setup") return;

	/** Attempts spent on a person this session; MAX_ATTEMPTS of them is the retry budget of §40.5. */
	const attempts = new Map<string, number>();
	/** People whose budget is spent: the kernel keeps offering their failed job, and this lane keeps declining. */
	const retired = new Set<string>();
	/** One telemetry row per retired person, not one per commit that meets them again. */
	const noticed = new Set<string>();

	const scheduler = createLaneQueue(pi, {
		backfillEnv: "PI_COC_NPCVOICE_BACKFILL",
		// Off unless asked (user ruling 2026-09-15): a fifty-person book would spend fifty model calls at
		// the door on people the table may never meet; "present or met first" already covers play.
		backfillDefault: 0,
		runJob,
		onError: (job, error) => record(job.campaign, { ok: false, reason: "lane_error", detail: errorText(error) }),
	});

	pi.on("session_start", async () => {
		// The retry budget is per session (contract §40.5), so it is cleared with the session and not
		// with the campaign: a table reopened is a table that may try a failed person once more.
		attempts.clear();
		retired.clear();
		noticed.clear();
	});

	// ---- Telemetry --------------------------------------------------------

	async function record(campaign: string, row: Record<string, unknown>): Promise<void> {
		const line = { lane: "voice", ...row };
		let cwd: string | undefined;
		try {
			pi.appendEntry("coc-telemetry", line);
			// After the session is disposed the ctx getters throw (docs/pi-host-contract.md §5), and the
			// lane's continuation may well land after that: read it, treat a throw as "no workspace",
			// and never let the exception out of the lane.
			cwd = scheduler.ctx?.cwd;
		} catch {
			/* telemetry must not break a lane */
		}
		if (!cwd) return;
		const path = join(cocHome(cwd), ".coc", "campaigns", campaign, "telemetry.jsonl");
		await appendJsonl(path, line);
	}

	// ---- One person -------------------------------------------------------

	/** One attempt: the subsession writes the two lines, then `voice.submit`. Failure reasons use `voice.fail`'s closed enum. */
	async function attempt(
		packet: JobPacket,
		jobId: string,
		campaign: string,
		call: KernelCall,
		note: (row: Record<string, unknown>) => Promise<void>,
	): Promise<{ ok: true; model: string } | { ok: false; reason: string; detail: string }> {
		const lane = await runLane<string[]>({
			ctx: scheduler.ctx as ExtensionContext,
			envName: "PI_COC_VOICE_MODEL",
			// The four `lane: "lane-call"` rows this round leaves (contract §12.8.1) travel the job's own
			// telemetry, so a backfill round is marked as one there too.
			lane: "voice",
			record: (row) => note({ job_id: jobId, ...row }),
			systemPrompt: systemPrompt(packet),
			input: userInput(packet),
			signal: scheduler.signal,
			shape: (parsed) => shapeLines(parsed, packet),
		});
		if (!lane.ok) {
			// `voice.fail` takes the journal's enum (`invalid | lane_error | model_error`); the lane's own
			// four reasons map onto it exactly as the journal lane maps them.
			return { ok: false, reason: lane.reason === "model_unavailable" ? "lane_error" : "model_error", detail: lane.detail };
		}
		try {
			await call("voice.submit", { campaign, job_id: jobId, sample_lines: lane.value });
			return { ok: true, model: lane.model };
		} catch (error) {
			const code = errorCode(error);
			return {
				ok: false,
				reason: code === "invalid_params" ? "invalid" : "lane_error",
				detail: `${code ?? "internal"}: ${errorText(error)}`,
			};
		}
	}

	/** One person, start to finish: at most MAX_ATTEMPTS tries, then `voice.fail` and a retirement. */
	async function runPerson(
		packet: JobPacket,
		jobId: string,
		handle: string,
		campaign: string,
		call: KernelCall,
		note: (row: Record<string, unknown>) => Promise<void>,
		modelLabel: string,
	): Promise<boolean> {
		const began = Date.now();
		let last: { ok: false; reason: string; detail: string } | undefined;
		const spent = attempts.get(handle) ?? 0;
		for (let tries = spent; tries < MAX_ATTEMPTS && !scheduler.stopped; tries += 1) {
			attempts.set(handle, tries + 1);
			const outcome = await attempt(packet, jobId, campaign, call, note);
			if (outcome.ok) {
				await note({
					npc: handle, job_id: jobId, ok: true, ms: Date.now() - began, model: outcome.model,
					...(tries > spent ? { retried: true } : {}),
				});
				return true;
			}
			last = outcome;
		}
		if (scheduler.stopped) return false;
		retired.add(handle);
		const failure = last ?? { reason: "lane_error", detail: "the lane never started" };
		try {
			await call("voice.fail", { campaign, job_id: jobId, reason: failure.reason, detail: failure.detail });
		} catch (error) {
			await note({
				npc: handle, job_id: jobId, ok: false, reason: "lane_error",
				detail: `voice.fail did not land either: ${errorText(error)}`,
			});
			return false;
		}
		await note({
			npc: handle, job_id: jobId, ok: false, ms: Date.now() - began, model: modelLabel,
			reason: failure.reason, detail: failure.detail.slice(0, 200), failed: true,
		});
		return false;
	}

	// ---- One dispatch -----------------------------------------------------

	async function runJob(job: LaneJob): Promise<void> {
		// Every backfill telemetry row carries `backfill: true`: writing at the table and filling holes stay apart.
		const note = (row: Record<string, unknown>) =>
			record(job.campaign, { ...(job.backfill ? { backfill: true } : {}), ...row });
		const current = scheduler.bridge;
		const ctx = scheduler.ctx;
		if (!current || !ctx) {
			await note({ ok: false, reason: "lane_error", detail: "the kernel bridge is gone; the lane cannot run" });
			return;
		}
		// Resolve the model first: if it cannot be resolved, do not take a job away from the kernel, or
		// a person is marked attempted for nothing.
		const model = resolveLaneModel(ctx, "PI_COC_VOICE_MODEL");
		if (!model.ok) {
			await note({ ok: false, reason: "model_unavailable", detail: model.detail });
			return;
		}
		const modelLabel = `${model.model.provider}/${model.model.id}`;

		for (let dispatched = 0; dispatched < MAX_JOBS_PER_COMMIT && !scheduler.stopped; dispatched += 1) {
			let packet: JobPacket;
			try {
				packet = ((await current.call("voice.job", {
					campaign: job.campaign,
					...(job.backfill ? { backfill: true } : {}),
				})) ?? {}) as JobPacket;
			} catch (error) {
				await note({
					ok: false, reason: "lane_error",
					detail: `voice.job ${errorCode(error) ?? "internal"}: ${errorText(error)}`,
				});
				return;
			}
			const jobId = typeof packet.job_id === "string" ? packet.job_id : undefined;
			if (!jobId) {
				// Nobody left needing lines. That is the ordinary ending and it writes no telemetry — one
				// "nothing to do" line per commit is noise. A backfill that ends here asks no more this session.
				if (job.backfill) scheduler.stopBackfill();
				return;
			}
			const handle = handleOf(packet, jobId);
			if (retired.has(handle) || (attempts.get(handle) ?? 0) >= MAX_ATTEMPTS) {
				// A failed job is offered again (§40.5) and the kernel's order is fixed, so the same person
				// would come back on every further ask: end the drain instead of spinning on them.
				if (!noticed.has(handle)) {
					noticed.add(handle);
					await note({ npc: handle, job_id: jobId, ok: false, reason: "lane_error", skipped: "retry_budget" });
				}
				return;
			}
			// A person who could not be written is the end of this drain: their failed job is offered
			// again, and burning the rest of the ceiling on a lane that is already failing helps nobody.
			if (!await runPerson(packet, jobId, handle, job.campaign, current.call, note, modelLabel)) return;
		}
	}
}
