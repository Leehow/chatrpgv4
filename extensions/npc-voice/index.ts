/**
 * The NPC voice lane (contract §40.5/§40.7, the §17.10 shape, scheduling shared with §12.8).
 *
 * Most imported books give most people no printed speech at all, so most people at most tables
 * have nothing for the Keeper to perform from. This lane writes one speech mask per person — how
 * their speech is marked — and three exchanges showing it in reply, and `voice.submit` files them
 * under this package's own dossier words (§28.7), where they reach the Keeper in the capsule's
 * `voices`. They are Keeper-facing material like `voice`: never the journal, never `table.view`,
 * never the player.
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

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { cocMode } from "../lanes/host.ts";
import { resolveLaneModel, runLane } from "../lanes/subsession.ts";
import { createLaneQueue, type KernelCall, type LaneJob } from "../lanes/queue.ts";
import { createLaneTelemetry } from "../lanes/telemetry.ts";

/** Fallbacks only: the kernel's job packet carries the real budget, and these stand in when it does not. */
const DEFAULT_EXCHANGES = 3;
const DEFAULT_MAX_CHARS = 200;
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
	taken_masks?: unknown;
	budget?: { mask_chars?: number; exchanges?: number; max_chars?: number };
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
	const exchanges = packet.budget?.exchanges ?? DEFAULT_EXCHANGES;
	const maskChars = packet.budget?.mask_chars ?? DEFAULT_MAX_CHARS;
	const maxChars = packet.budget?.max_chars ?? DEFAULT_MAX_CHARS;
	return [
		// The instruction is the fixed passage the kernel writes (contract §40.7); the lane passes it
		// on verbatim, rewriting nothing and adding nothing.
		packet.instruction ??
			"Write how this person is heard, in the campaign's play language: a mask of one line, then three exchanges of a stranger's words and this person's reply.",
		"",
		"Answer with one JSON object only, no code fence and no explanation:",
		'{"voice":{"mask":"...","exchanges":["...","...","..."]}}',
		'or, only for a person the book says does not speak: {"voice":null,"reason":"does_not_speak"}',
		"Field rules:",
		`- mask is one line of 1 to ${maskChars} characters.`,
		`- exchanges is exactly ${exchanges} strings, in that order: a first question brushed off, something ordinary, something that touches what they hide.`,
		`- each exchange is 1 to ${maxChars} characters, on one line, and no two are the same line.`,
		"- write everything in play_language, and write no key other than voice.",
		"- no numbers, no rules, no braces, no other person's name, and nothing the player has not discovered.",
	].join("\n");
}

/** The voice the lane came back with, or the book's silence honoured (§40.7). */
type Voice = { mask: string; exchanges: string[] };
type Lines = { voice: Voice } | { silent: true };
const SILENT_REASON = "does_not_speak";

/** The second zero-tool call of §40.5's voice guard: do a mask and its exchanges honour the book's one-line `voice`,
 *  and does every reply wear the mask? Register only. */
function judgePrompt(): string {
	return [
		"You check a speech mask and three sample exchanges against a book's one-line description of how a person sounds.",
		"Judge register only: manner, temper, how much they say, whether they would raise their voice — never the content.",
		"A reply that contradicts the description (a quiet person shouting, a formal person cursing) does not honour it,",
		"and neither does a reply that does not wear the mask (the address term or the ending habit the mask names is absent from every reply).",
		"Answer with one JSON object only, no code fence and no explanation:",
		'{"honours":true|false,"why":"<at most 120 characters, in English>"}',
	].join("\n");
}

function judgeInput(voice: string, value: Voice): string {
	return [`[Voice the book gives them] ${voice}`, "", `[Mask] ${value.mask}`, "", "[Exchanges]", ...value.exchanges.map((line, index) => `${index + 1}. ${line}`)].join("\n");
}

function shapeVerdict(parsed: unknown): { honours: boolean; why: string } | undefined {
	if (!parsed || typeof parsed !== "object") return undefined;
	const row = parsed as { honours?: unknown; why?: unknown };
	if (typeof row.honours !== "boolean") return undefined;
	return { honours: row.honours, why: typeof row.why === "string" ? row.why.trim().slice(0, 200) : "" };
}

function userInput(packet: JobPacket, objection?: string): string {
	const npc = packet.npc ?? {};
	const documents = Array.isArray(packet.documents)
		? packet.documents.flatMap((row) => (typeof row === "string" && row.trim() ? [row.trim()] : []))
		: [];
	const taken = Array.isArray(packet.taken_masks)
		? packet.taken_masks.flatMap((row) => (typeof row === "string" && row.trim() ? [row.trim()] : []))
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
		"",
		"[Masks other people here already wear]",
		taken.length ? taken.map((mask) => `- ${mask}`).join("\n") : "(none yet)",
		...(objection ? ["", `[A reviewer read your mask and exchanges against the voice the book gives them and objected] ${objection}`, "Rewrite the mask and all three exchanges so they honour that voice."] : []),
	].join("\n");
}

/**
 * Shape check, and shape only (contract §40.5): the count the budget names, each line trimmed and
 * bounded, the two distinct, no machine token and no line break. Nothing semantic is judged here —
 * no register detector, no language detector, no word list.
 */
function shapeLines(parsed: unknown, packet: JobPacket): Lines | undefined {
	if (!parsed || typeof parsed !== "object") return undefined;
	const raw = (parsed as { voice?: unknown }).voice;
	// The book's silence, honoured: a null voice with the one closed reason, and nothing else on the object.
	if (raw === null) return (parsed as { reason?: unknown }).reason === SILENT_REASON ? { silent: true } : undefined;
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const wanted = packet.budget?.exchanges ?? DEFAULT_EXCHANGES;
	const maskChars = packet.budget?.mask_chars ?? DEFAULT_MAX_CHARS;
	const maxChars = packet.budget?.max_chars ?? DEFAULT_MAX_CHARS;
	const line = (value: unknown, max: number): string | undefined => {
		if (typeof value !== "string") return undefined;
		const text = value.trim();
		if (text.length < 1 || text.length > max) return undefined;
		if (text.includes("{{") || text.includes("\n") || text.includes("\r")) return undefined;
		return text;
	};
	const mask = line((raw as { mask?: unknown }).mask, maskChars);
	if (mask === undefined) return undefined;
	const rows = (raw as { exchanges?: unknown }).exchanges;
	if (!Array.isArray(rows) || rows.length !== wanted) return undefined;
	const exchanges: string[] = [];
	for (const row of rows) {
		const text = line(row, maxChars);
		if (text === undefined || exchanges.includes(text)) return undefined;
		exchanges.push(text);
	}
	return { voice: { mask, exchanges } };
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

	// The shared writer, which also escalates a streak of failures to the operator (contract §56).
	const telemetry = createLaneTelemetry(pi, {
		lane: "voice", modelEnv: "PI_COC_NPCVOICE_MODEL", cwd: () => scheduler.ctx?.cwd,
	});
	const record = (campaign: string, row: Record<string, unknown>) => telemetry.record(campaign, row);

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

	// ---- One person -------------------------------------------------------

	/** One attempt: the subsession writes the two lines, then `voice.submit`. Failure reasons use `voice.fail`'s closed enum. */
	async function attempt(
		packet: JobPacket,
		jobId: string,
		campaign: string,
		call: KernelCall,
		note: (row: Record<string, unknown>) => Promise<void>,
	): Promise<{ ok: true; model: string; voice_check?: string } | { ok: false; reason: string; detail: string }> {
		const write = (objection?: string) => runLane<Lines>({
			ctx: scheduler.ctx as ExtensionContext,
			envName: "PI_COC_VOICE_MODEL",
			// The four `lane: "lane-call"` rows this round leaves (contract §12.8.1) travel the job's own
			// telemetry, so a backfill round is marked as one there too.
			lane: "voice",
			record: (row) => note({ job_id: jobId, ...row }),
			systemPrompt: systemPrompt(packet),
			input: userInput(packet, objection),
			signal: scheduler.signal,
			shape: (parsed) => shapeLines(parsed, packet),
		});
		let lane = await write();
		if (!lane.ok) {
			// `voice.fail` takes the journal's enum (`invalid | lane_error | model_error`); the lane's own
			// four reasons map onto it exactly as the journal lane maps them.
			return { ok: false, reason: lane.reason === "model_unavailable" ? "lane_error" : "model_error", detail: lane.detail };
		}
		// §40.5's voice guard: when the book gives a `voice`, a second zero-tool call reads the two lines
		// against it and may send them back once with its objection. One bounce, then whatever the rewrite
		// brings is filed: the guard is a nudge, never a gate, and a judge that cannot answer waives.
		let voiceCheck: string | undefined;
		const voice = typeof packet.npc?.voice === "string" ? packet.npc.voice.trim() : "";
		if (voice && "voice" in lane.value) {
			const verdict = await runLane<{ honours: boolean; why: string }>({
				ctx: scheduler.ctx as ExtensionContext, envName: "PI_COC_VOICE_MODEL", lane: "voice",
				record: (row) => note({ job_id: jobId, check: "voice", ...row }),
				systemPrompt: judgePrompt(), input: judgeInput(voice, lane.value.voice), signal: scheduler.signal, shape: shapeVerdict,
			});
			if (!verdict.ok) voiceCheck = "waived";
			else if (verdict.value.honours) voiceCheck = "passed";
			else {
				const again = await write(verdict.value.why || "the mask and exchanges do not honour the voice");
				voiceCheck = "rewritten";
				if (again.ok) lane = again;
				else voiceCheck = "rewrite_failed";
			}
		}
		try {
			await call("voice.submit", "voice" in lane.value
				? { campaign, job_id: jobId, voice: lane.value.voice }
				: { campaign, job_id: jobId, voice: null, reason: SILENT_REASON });
			return { ok: true, model: lane.model, ...(voiceCheck ? { voice_check: voiceCheck } : {}) };
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
					...(outcome.voice_check ? { voice_check: outcome.voice_check } : {}),
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
