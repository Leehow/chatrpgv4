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

import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { appendJsonl, cocHome, cocMode } from "../lanes/host.ts";
import { resolveLaneModel, runLane } from "../lanes/subsession.ts";
import { createLaneQueue, type KernelCall, type LaneJob } from "../lanes/queue.ts";

/** The closed fields and closed enums of a candidate assertion (contract §12.3). No extra field is ever sent to the kernel. */
const CANDIDATE_KINDS: ReadonlySet<string> = new Set([
	"world_event",
	"knowledge",
	"belief",
	"relationship",
	"player_assertion",
	"player_preference",
	"keeper_correction",
	// §13.5. Left out when promise was added, so the lane neither offered it nor let one
	// through: a fifteen-turn table produced 101 candidates and not one promise, and
	// `obligations.promise` and an NPC's `history.promises` had nothing to read.
	"promise",
]);
const PRIVACY: ReadonlySet<string> = new Set(["player_safe", "keeper_only"]);
const STATES: ReadonlySet<string> = new Set(["accurate", "uncertain", "distorted"]);

const DEFAULT_MAX_CANDIDATES = 12;
const DEFAULT_MAX_STATEMENT_CHARS = 400;

interface Candidate {
	kind: string;
	subject: string;
	statement: string;
	knowers?: string[];
	entities?: string[];
	privacy?: string;
	state?: string;
	confidence?: number;
	corrects?: Array<{subject: string; statement: string}>;
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
	task?: string;
	correction?: {kind: string; subject: string; statement: string};
	correction_targets?: Array<{subject: string; statement: string; kind: string}>;
	validation_feedback?: string;
	story_context?: {threads?: Array<{thread?: string}>; last_assessment?: unknown};
}

interface StoryAssessment {
	status: "aligned" | "unclear" | "misframed" | "detached";
	thread: string | null;
	frame: string | null;
	bridge_delivered: boolean;
	delivery_quote: string | null;
}

interface MemoryExtraction { candidates: Candidate[]; story?: StoryAssessment }

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
		packet.story_context?.threads?.length
			? '{"candidates":[...],"story":{"status":"aligned|unclear|misframed|detached","thread":"supplied thread name or null","frame":"exact player excerpt or null","bridge_delivered":false,"delivery_quote":null}}'
			: '{"candidates":[{"kind":"...","subject":"...","knowers":["..."],"statement":"...","entities":["..."],"privacy":"player_safe","state":"accurate","confidence":0.8}]}',
		"Field rules:",
		// Built from the set above so the two can never disagree again.
		`- kind is one of: ${[...CANDIDATE_KINDS].join(", ")}.`,
		"- privacy is player_safe or keeper_only; state is accurate, uncertain or distorted; confidence is a decimal from 0 to 1.",
		"- subject is a name from the available names below, or one of the reserved subjects world, party, keeper, player, as the candidate kind allows; world_event must use subject world; player_assertion and player_preference must use subject player; relationship must have exactly one entity.",
		"- knowers is optional; its names must be known NPC or investigator names from the available names below, or party, keeper or player.",
		"- entities is optional; its names must be actual semantic names supplied in the available names below, for the people, clues, scenes or other entities the statement is about. Never put the reserved words world, party, keeper or player in entities; do not put player in entities.",
		"- only keeper_correction may include corrects: an array of at most 12 exact {subject,statement} pairs from correction_targets. Use [] if the correction has no matching earlier target. Do not restate withdrawn claims as knowledge; memory reports are not proof of module truth.",
		'Correction shape: {"kind":"keeper_correction","subject":"keeper","statement":"the correction","corrects":[{"subject":"exact supplied subject","statement":"exact earlier statement"}]}',
		`- statement is 1 to ${maxChars} characters, one sentence saying one thing.`,
		"- write no key other than the ones listed above, and in particular no turn number, commit, receipt id or entry id.",
		packet.task === 'reconcile_correction'
			? "- Return exactly one candidate copying the supplied correction unchanged and attaching corrects. This repairs links only, not the prior statement."
			: `- at most ${maxCandidates} rows; do not repeat anything already in the existing candidates; with nothing new, answer {"candidates":[]}.`,
		...(packet.story_context?.threads?.length ? [
			"Story assessment rules:",
			"- Assess the player's expressed causal frame, not activity, distance, brevity or compliance with an expected route.",
			"- aligned: the player frame explicitly demonstrates the selected core causal claim and its present stakes, then either acts with that understanding or knowingly declines involvement. The supplied selected thread must also have at least one acquired supporting or contradicting evidence row. A correct guess without acquired evidence stays an uncertain player assertion, not established alignment.",
			"- refusing a commission, clue, route, destination, NPC request or authored hook without demonstrating the deeper selected causal connection is never aligned to that core thread.",
			"- unclear: no reliable frame is expressed, including ordinary exploration, short replies, jokes, quiet play and one side action. Unclear never creates a compulsory beat.",
			"- misframed: an explicit causal account conflicts with or leaves disconnected public acquired evidence needed for the ongoing investigation.",
			"- detached: the player chooses an ongoing direction with no currently visible path to the selected core thread, without demonstrated understanding at that core level. This respects the refused hook and causes a bridge to follow the chosen direction; it does not retry the refused offer or force a return.",
			"- aligned, misframed and detached must choose one exact story_context.threads name and copy an exact nonempty excerpt from player_text as frame. Unclear uses thread:null and frame:null.",
			"- bridge_delivered is true only when keeper_text explicitly makes that causal relation or a source-backed consequence relevant to the chosen direction. Then delivery_quote copies the exact passage. Atmosphere, a menu and merely naming a route do not count. False uses delivery_quote:null.",
			"- bridge_delivered may be true only when the selected story_context thread contains at least one acquired supporting or contradicting evidence row. With no acquired evidence, a warning, atmosphere, analogy, menu, route name or unsupported assertion is never a delivered bridge. New information must first land through its existing clue or handout authority and receipt, so it appears as acquired evidence."
		] : []),
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
		"",
		"[Earlier correction targets: copy subject and statement exactly; these reports are not verified facts]",
		lines(packet.correction_targets),
		...(packet.story_context?.threads?.length ? ["", "[Keeper-only story context: assess only against these supplied unresolved threads and evidence]", JSON.stringify(packet.story_context)] : []),
		...(packet.correction ? ["", "[Existing correction to link; copy unchanged]", JSON.stringify(packet.correction)] : []),
		...(packet.validation_feedback ? ["", "[Previous attempt failed: fix only the reported output, format or reference problem; preserve the intended facts and story assessment]", packet.validation_feedback] : []),
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
		if (Object.hasOwn(row, 'corrects') && (row.kind !== 'keeper_correction' || !Array.isArray(row.corrects) || row.corrects.length > 12
			|| row.corrects.some(ref => !ref || typeof ref !== 'object' || Object.keys(ref).length !== 2 || typeof ref.subject !== 'string' || typeof ref.statement !== 'string')))
			return undefined;
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
			...(Array.isArray(row.corrects) ? {corrects: row.corrects.map(ref => ({subject: ref.subject, statement: ref.statement}))} : {}),
		});
		if (candidates.length >= limit) break;
	}
	return candidates;
}

function shapeExtraction(parsed: unknown, packet: JobPacket): MemoryExtraction | undefined {
	const candidates = shapeCandidates(parsed, packet);
	if (!candidates) return undefined;
	const required = Boolean(packet.story_context?.threads?.length);
	if (!required) return {candidates};
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
	const story = (parsed as {story?: unknown}).story;
	if (!story || typeof story !== 'object' || Array.isArray(story)) return undefined;
	const value = story as Record<string, unknown>, keys = Object.keys(value).sort();
	if (keys.join(',') !== 'bridge_delivered,delivery_quote,frame,status,thread') return undefined;
	if (!['aligned', 'unclear', 'misframed', 'detached'].includes(String(value.status))) return undefined;
	const supplied = packet.story_context?.threads ?? [], unclear = value.status === 'unclear',
		threads = supplied.map(row => row.thread).filter((name): name is string => typeof name === 'string');
	if (unclear ? value.thread !== null || value.frame !== null : typeof value.thread !== 'string' || !threads.includes(value.thread) || typeof value.frame !== 'string' || !value.frame.trim() || !packet.player_text?.includes(value.frame)) return undefined;
	const selected = supplied.find(row => row.thread === value.thread) as ({supporting?: unknown[]; contradicting?: unknown[]} | undefined);
	const selectedEvidence = (selected?.supporting?.length ?? 0) + (selected?.contradicting?.length ?? 0);
	if (value.status === 'aligned' && selected && !selectedEvidence) return undefined;
	if (typeof value.bridge_delivered !== 'boolean') return undefined;
	if (value.bridge_delivered && !selectedEvidence) return undefined;
	if (value.bridge_delivered ? typeof value.delivery_quote !== 'string' || !value.delivery_quote.trim() || !packet.keeper_text?.includes(value.delivery_quote) : value.delivery_quote !== null) return undefined;
	return {candidates, story: value as unknown as StoryAssessment};
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

	const scheduler = createLaneQueue(pi, {
		backfillEnv: "PI_COC_MEMORY_BACKFILL",
		runJob,
		onError: (job, error) => record(job.campaign, {
			turn: job.turn, ok: false, reason: "lane_error", detail: errorText(error),
		}),
	});

	// ---- Telemetry --------------------------------------------------------

	async function record(campaign: string, row: Record<string, unknown>): Promise<void> {
		const line = { lane: "memory", ...row };
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

	// ---- One extraction ---------------------------------------------------

	/** One attempt: the subsession extracts candidates, then `memory.submit`. Failure reasons use `memory.fail`'s closed enum. */
	async function attempt(
		packet: JobPacket,
		jobId: string,
		campaign: string,
		call: KernelCall,
		note: (row: Record<string, unknown>) => Promise<void>,
	): Promise<{ ok: true; candidates: number; model: string; story?: StoryAssessment } | { ok: false; reason: string; detail: string }> {
		const lane = await runLane<MemoryExtraction>({
			ctx: scheduler.ctx as ExtensionContext,
			envName: "PI_COC_MEMORY_MODEL",
			// The four `lane: "lane-call"` rows this round leaves (contract §12.8.1) travel the job's own
			// telemetry, so a backfill round is marked as one there too.
			lane: "memory",
			record: (row) => note({ turn: packet.turn, job_id: jobId, ...row }),
			systemPrompt: systemPrompt(packet),
			input: userInput(packet),
			signal: scheduler.signal,
			shape: (parsed) => shapeExtraction(parsed, packet),
		});
		if (!lane.ok) {
			return { ok: false, reason: lane.reason === "model_unavailable" ? "lane_error" : "model_error", detail: lane.detail };
		}
		try {
			await call("memory.submit", { campaign, job_id: jobId, candidates: lane.value.candidates,
				...(lane.value.story ? {story: lane.value.story} : {}) });
			return { ok: true, candidates: lane.value.candidates.length, model: lane.model, story: lane.value.story };
		} catch (error) {
			const code = errorCode(error);
			return {
				ok: false,
				reason: code === "invalid_params" ? "invalid" : "lane_error",
				detail: `${code ?? "internal"}: ${errorText(error)}`,
			};
		}
	}

	async function runJob(job: LaneJob): Promise<void> {
		const began = Date.now();
		// Every backfill telemetry row carries `backfill: true` (contract §12.8): extraction at the table and filling holes stay apart.
		const note = (row: Record<string, unknown>) =>
			record(job.campaign, { ...(job.backfill ? { backfill: true } : {}), ...row });
		const current = scheduler.bridge;
		const ctx = scheduler.ctx;
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
				scheduler.stopBackfill();
				return;
			}
			// Nothing to extract for this turn (already extracted, or in the backlog awaiting an explicit redispatch).
			await note({ turn: job.turn, ok: true, ms: Date.now() - began, skipped: "no_job" });
			return;
		}

		let last: { ok: false; reason: string; detail: string } | undefined;
		for (let tries = 0; tries < 2 && !scheduler.stopped; tries += 1) {
			const outcome = await attempt(packet, jobId, job.campaign, current.call, note);
			if (outcome.ok) {
				await note({
					turn: packet.turn ?? job.turn,
					job_id: jobId,
					ok: true,
					ms: Date.now() - began,
					model: outcome.model,
					candidates: outcome.candidates,
					...(outcome.story ? {story_status: outcome.story.status, bridge_delivered: outcome.story.bridge_delivered} : {}),
					...(tries > 0 ? { retried: true } : {}),
				});
				return;
			}
			last = outcome;
			if (outcome.reason === 'invalid' || outcome.reason === 'model_error') packet = {...packet, validation_feedback: outcome.detail};
		}
		if (scheduler.stopped) return;
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
}
