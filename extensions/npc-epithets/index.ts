/**
 * The epithet lane (contract §176.3; owner ruling 2026-10-04 on docs/specs/graph-epithets.md).
 *
 * Every book person gets the word this table calls them by before anyone meets them. `epithets.job` lists the untold
 * people still without a word, with what a stranger sees of them; a zero-tool subsession on the fast model writes one word
 * per request, for one person it sees by their role and looks alone (§199.5: no id, no other person); `epithets.submit`
 * checks every word on its own and keeps the accepted ones. The kernel folds them into the world at the next safe moment
 * (§176.1), so the Keeper reads them from the capsule and every tool resolves them.
 *
 * Unlike the journal lane this one runs in both modes: during character creation, so the opening already has the words,
 * and at a table, after every committed turn, which catches people a PDF reading lands later. It asks once when the session
 * and the bridge are both up, and never backfills: `epithets.job` answering `job_id: null` is the ordinary ending. A big
 * cast comes in parts, a few jobs per trigger. One retry per person carries the kernel's refusal verbatim; a person still
 * refused is offered again by the next job.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveLaneModel, runLane } from "../lanes/subsession.ts";
import { createLaneQueue, type KernelCall, type LaneJob } from "../lanes/queue.ts";
import { createLaneTelemetry } from "../lanes/telemetry.ts";

const MODEL_ENV = "PI_COC_EPITHETS_MODEL";
/** Jobs per trigger: a cast larger than one job (24 people) is asked for in parts. */
const ROUNDS = 4;
/** §199.5: people asked at once, each their own request; bounded so one job cannot fan out across the provider. */
const CONCURRENCY = 3;
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

/**
 * §199.5: the model is asked about one person per request and answers one word. The person reaches it as their `role` and
 * `looks` only: never their id (a handle is made from the Keeper's summary, TR-F2), never anyone else's row (TR-F2: Sofia,
 * with no row of her own, was given her neighbour's glasses and beard).
 */
export function epithetSystemPrompt(packet: EpithetPacket): string {
	const language = packet.play_language ?? "the campaign's play language";
	const max = packet.budget?.max_chars ?? DEFAULT_MAX_CHARS;
	return [
		// The kernel's instruction is passed on verbatim, rewriting nothing.
		packet.instruction ?? `Give the person below the word this table will call them by, written in the play language ${language}.`,
		"Only the one person below is asked about here: word them from their own role and looks.",
		"",
		"Answer with one JSON object only, no code fence and no explanation:",
		'{"word":"..."}',
		"Field rules:",
		`- word is at most ${max} characters, written in the play language ${language}.`,
		"- write no key other than word.",
	].join("\n");
}

/** What the model reads for one person: the play language, their role and looks, the words in use, and on a retry why. */
export function epithetUserInput(packet: EpithetPacket, person: Person, taken: readonly string[], refusal?: string): string {
	const shown = { ...(person.role ? { role: person.role } : {}), ...(person.looks ? { looks: person.looks } : {}) };
	return [
		`[Play language] ${packet.play_language ?? "(unknown)"}`,
		"[Person]",
		JSON.stringify(shown),
		"[Taken: words already in use, give none of them]",
		JSON.stringify(taken),
		// The second attempt is told why the first was refused, in the kernel's own words, as the journal lane's is (§103.6).
		...(refusal ? ["", "[Your previous word for this person was refused; give a new word]", refusal] : []),
	].join("\n");
}

/** Closed shape only: `{word}`, within the budget. The rest is the kernel's check. */
export function shapeEpithet(parsed: unknown, packet: EpithetPacket): string | undefined {
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
	if (Object.keys(parsed).some((key) => key !== "word")) return undefined;
	const word = (parsed as { word?: unknown }).word;
	const max = packet.budget?.max_chars ?? DEFAULT_MAX_CHARS;
	if (typeof word !== "string" || !word.trim() || word.trim().length > max) return undefined;
	return word.trim();
}

interface Refused { id?: string; word?: string | null; reason?: string; message?: string }
/** Refusals about the person rather than the word (§176.3): a new word changes neither, so neither is asked again. */
const NOT_RETRIED: ReadonlySet<string> = new Set(["unknown_entity", "settled"]);
const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 200);
const errorCode = (error: unknown): string | undefined => {
	const code = (error as { code?: unknown } | null)?.code;
	return typeof code === "string" ? code : undefined;
};

/** `work` over `items`, at most `limit` at once, in order of start. */
async function eachBounded<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
	let next = 0;
	const worker = async (): Promise<void> => { while (next < items.length) await work(items[next++]!); };
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

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

	/** One person: the subsession writes their word, then `epithets.submit` for them alone. Returns the kernel's answer or a failure. */
	async function attempt(packet: EpithetPacket, person: Person & { id: string }, taken: readonly string[], campaign: string, call: KernelCall,
		note: (row: Record<string, unknown>) => Promise<void>, refusal?: string) {
		const lane = await runLane<string>({
			ctx: scheduler.ctx as ExtensionContext,
			envName: MODEL_ENV,
			lane: "epithets",
			record: (row) => note({ job_id: packet.job_id, ...row }),
			systemPrompt: epithetSystemPrompt(packet),
			input: epithetUserInput(packet, person, taken, refusal),
			signal: scheduler.signal,
			shape: (parsed) => shapeEpithet(parsed, packet),
		});
		if (!lane.ok) return { ok: false as const, reason: lane.reason, detail: lane.detail };
		try {
			const answer = (await call("epithets.submit", { campaign, entries: [{ id: person.id, word: lane.value }] })) as { written?: unknown[]; refused?: Refused[] };
			return { ok: true as const, model: lane.model, word: lane.value, written: Array.isArray(answer?.written) ? answer.written.length : 0,
				refused: Array.isArray(answer?.refused) ? answer.refused : [] };
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
			const people = packet.people.filter((person): person is Person & { id: string } => typeof person.id === "string" && person.id !== "");
			// Every word in use, the words this job writes added as they are accepted, so a later request does not offer them again.
			const taken = [...(packet.taken ?? [])];
			let written = 0, refused = 0, retried = 0, failed = 0, laneModel: string | undefined, failure: { reason: string; detail: string } | undefined;
			await eachBounded(people, CONCURRENCY, async (person) => {
				if (scheduler.stopped) return;
				const first = await attempt(packet, person, taken, job.campaign, current.call, note);
				if (!first.ok) { failed += 1; failure ??= { reason: first.reason, detail: first.detail }; return; }
				laneModel ??= first.model;
				if (first.written) { written += first.written; taken.push(first.word); return; }
				// One retry, for this person only, with the kernel's own reason.
				const why = first.refused.find((row) => row.id === person.id) ?? first.refused[0];
				if (!why || NOT_RETRIED.has(String(why.reason)) || scheduler.stopped) { refused += 1; return; }
				retried += 1;
				const second = await attempt(packet, person, taken, job.campaign, current.call, note,
					`- ${JSON.stringify(why.word ?? null)} refused (${why.reason}): ${why.message}`);
				if (second.ok && second.written) { written += second.written; taken.push(second.word); }
				else refused += 1;
			});
			if (failed === people.length && failure) {
				await note({ job_id: packet.job_id, ok: false, ms: Date.now() - began, reason: failure.reason, detail: failure.detail.slice(0, 200) });
				return;
			}
			await note({ job_id: packet.job_id, ok: true, ms: Date.now() - began, ...(laneModel ? { model: laneModel } : {}), people: people.length, written,
				refused, ...(retried ? { retried } : {}), ...(failed ? { failed } : {}) });
			// A round that wrote nothing would only ask for the same people again.
			if (!written) return;
		}
	}
}
