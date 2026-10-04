/**
 * The epithet lane (contract §176.3; owner ruling 2026-10-04 on docs/specs/graph-epithets.md).
 *
 * Every book person gets the word this table calls them by before anyone meets them. `epithets.job` lists the untold
 * people still without a word, with what a stranger sees of them; a zero-tool subsession on the fast model writes one word
 * each; `epithets.submit` checks every word on its own and keeps the accepted ones. The kernel folds them into the world at
 * the next safe moment (§176.1), so the Keeper reads them from the capsule and every tool resolves them.
 *
 * Unlike the journal lane this one runs in both modes: during character creation, so the opening already has the words,
 * and at a table, after every committed turn, which catches people a PDF reading lands later. It asks once when the session
 * and the bridge are both up, and never backfills: `epithets.job` answering `job_id: null` is the ordinary ending. A big
 * cast comes in parts, a few jobs per trigger. One retry carries the kernel's refusals verbatim; a person still refused is
 * offered again by the next job.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveLaneModel, runLane } from "../lanes/subsession.ts";
import { createLaneQueue, type KernelCall, type LaneJob } from "../lanes/queue.ts";
import { createLaneTelemetry } from "../lanes/telemetry.ts";

const MODEL_ENV = "PI_COC_EPITHETS_MODEL";
/** Jobs per trigger: a cast larger than one job (24 people) is asked for in parts. */
const ROUNDS = 4;
const DEFAULT_MAX_CHARS = 60;

interface Person { id?: string; role?: string; looks?: string }
/** The job packet from `epithets.job`; only these fields are read, and nothing else reaches the prompt. */
export interface EpithetPacket {
	job_id?: string | null;
	waiting?: string;
	play_language?: string;
	people?: Person[];
	taken?: string[];
	budget?: { max_chars?: number };
	instruction?: string;
}
export interface EpithetEntry { id: string; word: string }

export function epithetSystemPrompt(packet: EpithetPacket): string {
	const language = packet.play_language ?? "the campaign's play language";
	const max = packet.budget?.max_chars ?? DEFAULT_MAX_CHARS;
	return [
		// The kernel's instruction is passed on verbatim, rewriting nothing.
		packet.instruction ?? `Give each person below the word this table will call them by, written in the play language ${language}.`,
		"",
		"Answer with one JSON object only, no code fence and no explanation:",
		'{"epithets":[{"id":"<the person\'s id, copied exactly>","word":"..."}]}',
		"Field rules:",
		"- id is one of the ids listed under People, copied exactly; one word per person, every person listed.",
		`- word is at most ${max} characters, written in the play language ${language}.`,
		"- write no key other than id and word.",
	].join("\n");
}

export function epithetUserInput(packet: EpithetPacket, refusals?: string): string {
	const people = (packet.people ?? []).map((person) => ({ id: person.id, ...(person.role ? { role: person.role } : {}), ...(person.looks ? { looks: person.looks } : {}) }));
	return [
		`[Play language] ${packet.play_language ?? "(unknown)"}`,
		"[People]",
		JSON.stringify(people),
		"[Taken: words already in use, give none of them]",
		JSON.stringify(packet.taken ?? []),
		// The second attempt is told why the first was refused, in the kernel's own words, as the journal lane's is (§103.6).
		...(refusals ? ["", "[Your previous words for these people were refused; give each of them a new word]", refusals] : []),
	].join("\n");
}

/** Closed shape only: `{epithets: [{id, word}]}`, ids from the packet, each once, words within the budget. The rest is the kernel's check. */
export function shapeEpithets(parsed: unknown, packet: EpithetPacket): EpithetEntry[] | undefined {
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
	if (Object.keys(parsed).some((key) => key !== "epithets")) return undefined;
	const raw = (parsed as { epithets?: unknown }).epithets;
	if (!Array.isArray(raw) || raw.length === 0) return undefined;
	const allowed = new Set((packet.people ?? []).map((person) => person.id).filter((id): id is string => typeof id === "string"));
	const max = packet.budget?.max_chars ?? DEFAULT_MAX_CHARS, seen = new Set<string>(), out: EpithetEntry[] = [];
	for (const value of raw) {
		if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
		if (Object.keys(value).some((key) => key !== "id" && key !== "word")) return undefined;
		const { id, word } = value as { id?: unknown; word?: unknown };
		if (typeof id !== "string" || !allowed.has(id) || seen.has(id)) return undefined;
		if (typeof word !== "string" || !word.trim() || word.trim().length > max) return undefined;
		seen.add(id);
		out.push({ id, word: word.trim() });
	}
	return out;
}

interface Refused { id?: string; word?: string | null; reason?: string; message?: string }
const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 200);
const errorCode = (error: unknown): string | undefined => {
	const code = (error as { code?: unknown } | null)?.code;
	return typeof code === "string" ? code : undefined;
};

export default function (pi: ExtensionAPI) {
	const telemetry = createLaneTelemetry(pi, { lane: "epithets", modelEnv: MODEL_ENV, cwd: () => scheduler.ctx?.cwd });
	const record = (campaign: string, row: Record<string, unknown>) => telemetry.record(campaign, row);

	const scheduler = createLaneQueue(pi, {
		initialJob: true,
		// §177.5: the book's cast landed; its unread people want a word before the request's rename shows them by row id.
		wakeOn: ["coc:cast-published"],
		runJob,
		onError: (job, error) => record(job.campaign, { turn: job.turn, ok: false, reason: "lane_error", detail: errorText(error) }),
	});

	/** One round: the subsession writes the words, then `epithets.submit`. Returns the kernel's answer or a failure. */
	async function attempt(packet: EpithetPacket, campaign: string, call: KernelCall, note: (row: Record<string, unknown>) => Promise<void>, refusals?: string) {
		const lane = await runLane<EpithetEntry[]>({
			ctx: scheduler.ctx as ExtensionContext,
			envName: MODEL_ENV,
			lane: "epithets",
			record: (row) => note({ job_id: packet.job_id, ...row }),
			systemPrompt: epithetSystemPrompt(packet),
			input: epithetUserInput(packet, refusals),
			signal: scheduler.signal,
			shape: (parsed) => shapeEpithets(parsed, packet),
		});
		if (!lane.ok) return { ok: false as const, reason: lane.reason, detail: lane.detail };
		try {
			const answer = (await call("epithets.submit", { campaign, entries: lane.value })) as { written?: unknown[]; refused?: Refused[] };
			return { ok: true as const, model: lane.model, written: Array.isArray(answer?.written) ? answer.written.length : 0, refused: Array.isArray(answer?.refused) ? answer.refused : [] };
		} catch (error) {
			return { ok: false as const, reason: "lane_error", detail: `${errorCode(error) ?? "internal"}: ${errorText(error)}` };
		}
	}

	async function runJob(job: LaneJob): Promise<void> {
		const current = scheduler.bridge, ctx = scheduler.ctx;
		const note = (row: Record<string, unknown>) => record(job.campaign, { ...(typeof job.turn === "number" ? { turn: job.turn } : {}), ...row });
		if (!current || !ctx) return;
		const model = resolveLaneModel(ctx, MODEL_ENV);
		if (!model.ok) {
			await note({ ok: false, reason: "model_unavailable", detail: model.detail });
			return;
		}
		for (let round = 0; round < ROUNDS && !scheduler.stopped; round += 1) {
			const began = Date.now();
			let packet: EpithetPacket;
			try {
				packet = ((await current.call("epithets.job", { campaign: job.campaign })) ?? {}) as EpithetPacket;
			} catch (error) {
				await note({ ok: false, reason: "lane_error", detail: `epithets.job ${errorCode(error) ?? "internal"}: ${errorText(error)}` });
				return;
			}
			// Nothing left to word (or no graph yet): the ordinary ending, written as no row.
			if (typeof packet.job_id !== "string" || !packet.people?.length) return;
			const first = await attempt(packet, job.campaign, current.call, note);
			if (!first.ok) {
				await note({ job_id: packet.job_id, ok: false, ms: Date.now() - began, reason: first.reason, detail: first.detail.slice(0, 200) });
				return;
			}
			let written = first.written, refused = first.refused, retried = false;
			if (refused.length && !scheduler.stopped) {
				// One retry, for the refused people only, with the kernel's own reasons.
				const ids = new Set(refused.map((row) => row.id));
				const again: EpithetPacket = { ...packet, people: (packet.people ?? []).filter((person) => ids.has(person.id)) };
				const reasons = refused.map((row) => `- ${row.id}: ${JSON.stringify(row.word ?? null)} refused (${row.reason}): ${row.message}`).join("\n");
				const second = await attempt(again, job.campaign, current.call, note, reasons);
				retried = true;
				if (second.ok) { written += second.written; refused = second.refused; }
			}
			await note({ job_id: packet.job_id, ok: true, ms: Date.now() - began, model: first.model, people: packet.people.length, written,
				refused: refused.length, ...(retried ? { retried: true } : {}) });
			// A round that wrote nothing would only ask for the same people again.
			if (!written) return;
		}
	}
}
