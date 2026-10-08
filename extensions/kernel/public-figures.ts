/**
 * Contract §194.5 item 2: the host's Jev check of whether each cast row is a real public figure of the world outside the story,
 * mentioned as such. `cast.public.job` lists the rows no verdict covers yet, with each row's names and the book's own words
 * about them; Jev answers one Noul per row (family `cast-public-figures`, `runtime/jev/public-figures.ts`); every answered row
 * goes back as a verdict (`cast.public.submit`), public at or above `PUBLIC_FIGURE_AT`. The kernel keeps them beside the cast,
 * so they are asked once per row and cast, whatever campaign or session reads the book next.
 *
 * Run when the table opens, in the background, and before a delivery whose `table.untold_spans` says rows are still unjudged
 * (`public_pending`), so the gate never refuses a public figure only because nobody asked yet. Jev unconfigured or failed
 * submits nothing: everyone stays untold, and the next delivery asks again (after a pause, so a Jev outage does not cost every
 * delivery its wait). The judgement has its own bound (`PUBLIC_FIGURES_JUDGE_MS`); a delivery waits for it only
 * `PUBLIC_FIGURES_WAIT_MS`, and a judgement it stops waiting for lands with the campaign's next run.
 */
import { TaskLease } from "../../runtime/jev/task-context.ts";
import type { DecisionPort } from "../../runtime/jev/decision-port.ts";
import { packDecisionBatch } from "../../runtime/jev/question-packing.ts";
import { PUBLIC_FIGURES_FAMILY, PUBLIC_FIGURES_JUDGE_MS, PUBLIC_FIGURES_PER_BATCH, PUBLIC_FIGURES_VERSION, PUBLIC_FIGURES_WAIT_MS, PUBLIC_FIGURE_AT, judgePublicFigures,
	publicFigureBatch, publicFigureBindings, type CastFigure } from "../../runtime/jev/public-figures.ts";

type Row = Record<string, unknown>;
type Call = (method: string, params: Row) => Promise<unknown>;
/** Jobs one run asks for: a cast bigger than one job (200 rows) is judged in parts. */
const ROUNDS = 3;
/** After a run Jev could not answer, the same campaign is not asked again for this long. */
export const PUBLIC_FIGURES_PAUSE_MS = 60_000;

interface JobPerson { id: string; row_sha256: string; names: string[]; entry?: string }

/** One request's people, split in halves while the packer refuses them; a reason string for people nobody judged. */
async function judgeChunk(people: readonly CastFigure[], decision: DecisionPort, campaign: string, deadlineAt: number, signal: AbortSignal): Promise<Array<number | string>> {
	try { packDecisionBatch(publicFigureBatch(people, campaign)); }
	catch {
		if (people.length < 2) return ["packing_limit"];
		const half = Math.ceil(people.length / 2);
		return [...await judgeChunk(people.slice(0, half), decision, campaign, deadlineAt, signal), ...await judgeChunk(people.slice(half), decision, campaign, deadlineAt, signal)];
	}
	const lease = new TaskLease({ owner: PUBLIC_FIGURES_FAMILY, goal: "Judge whether each person a book names is a real public figure mentioned as such",
		...publicFigureBindings(people, campaign), capabilities: ["decision"], signal,
		budget: { deadlineAt, remainingInputTokens: 200_000, remainingOutputTokens: 60_000, remainingCostUsd: 0.02, remainingActions: 1 } });
	try {
		const judged = await judgePublicFigures(people, decision, lease, campaign);
		return judged.status === "scored" ? judged.figures : people.map(() => judged.reason);
	} catch (error) {
		return people.map(() => signal.aborted ? "late" : error instanceof Error ? error.message : "unavailable");
	} finally {
		lease.close();
	}
}

/** Each person's probability of being a public figure, a reason string where nobody answered; requests run in parallel under one bound. */
export async function judgeFigures(people: readonly CastFigure[], decision: DecisionPort, campaign: string, boundMs = PUBLIC_FIGURES_JUDGE_MS): Promise<Array<number | string>> {
	const startedAt = Date.now(), deadlineAt = startedAt + boundMs, signal = AbortSignal.timeout(boundMs), chunks: CastFigure[][] = [];
	for (let at = 0; at < people.length; at += PUBLIC_FIGURES_PER_BATCH) chunks.push(people.slice(at, at + PUBLIC_FIGURES_PER_BATCH));
	return (await Promise.all(chunks.map(chunk => judgeChunk(chunk, decision, campaign, deadlineAt, signal)))).flat();
}

export interface PublicFigureJudge {
	/**
	 * Judge the campaign's unjudged cast rows and submit the verdicts; true when any verdict was kept. `wait: false` is a delivery's
	 * hook: it returns false at once while another run for the campaign is in flight (the hook runs inside the kernel client's
	 * queue, and a run started through that queue cannot finish while the hook waits for it), and it waits for the judgement it
	 * starts at most `PUBLIC_FIGURES_WAIT_MS`; a judgement it stops waiting for keeps running, and its verdicts are submitted by
	 * the campaign's next run, through that run's own call.
	 */
	(campaign: string, call: Call, options?: { wait?: boolean }): Promise<boolean>;
}

interface Verdict { id: string; row_sha256: string; noul: number; public: boolean }
/** One job's answers: the verdicts Jev gave, the reasons for the rows it did not answer, and how long Jev took. */
interface Judged { jobId: string; people: number; verdicts: Verdict[]; reasons: string[]; ms: number }
const LATE = Symbol("late");
/** The promise's value, or `LATE` once `ms` have passed first; the promise itself runs on. */
function within<T>(promise: Promise<T>, ms: number): Promise<T | typeof LATE> {
	let timer: NodeJS.Timeout | undefined;
	const late = new Promise<typeof LATE>(resolve => { timer = setTimeout(() => resolve(LATE), Math.max(0, ms)); });
	return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

export function createPublicFigureJudge(deps: { decision: () => DecisionPort | undefined; record: (row: Row) => void; waitMs?: number; judgeMs?: number;
	pauseMs?: number }): PublicFigureJudge {
	const running = new Map<string, Promise<boolean>>(), paused = new Map<string, number>();
	/** A judgement its run stopped waiting for (a delivery's hook went on): Jev only, no kernel call in it. */
	const judging = new Map<string, Promise<void>>();
	/** Verdicts such a judgement got, for the campaign's next run to submit through its own call. */
	const held = new Map<string, Judged>();
	const note = (row: Row) => { try { deps.record(row); } catch { /* telemetry never decides anything here */ } };
	const pause = (campaign: string) => { paused.set(campaign, Date.now() + (deps.pauseMs ?? PUBLIC_FIGURES_PAUSE_MS)); };
	const isPaused = (campaign: string) => (paused.get(campaign) ?? 0) > Date.now();

	/** One job asked of Jev under the judgement's own bound; undefined when Jev answered no row (noted, and the campaign paused). */
	async function judge(campaign: string, jobId: string, people: readonly JobPerson[], decision: DecisionPort): Promise<Judged | undefined> {
		const began = Date.now();
		const answers = await judgeFigures(people.map(person => ({ names: Array.isArray(person.names) ? person.names : [], ...(typeof person.entry === "string" ? { entry: person.entry } : {}) })),
			decision, campaign, deps.judgeMs ?? PUBLIC_FIGURES_JUDGE_MS);
		const ms = Date.now() - began;
		const verdicts = people.flatMap((person, i) => typeof answers[i] === "number" && Number.isFinite(answers[i])
			? [{ id: person.id, row_sha256: person.row_sha256, noul: answers[i] as number, public: (answers[i] as number) >= PUBLIC_FIGURE_AT }] : []);
		const reasons = answers.filter((value): value is string => typeof value === "string");
		if (!verdicts.length) {
			pause(campaign);
			note({ lane: "public-figures", event: "fallback", job_id: jobId, people: people.length, reason: reasons[0] ?? "unavailable", ms });
			return undefined;
		}
		return { jobId, people: people.length, verdicts, reasons, ms };
	}

	/** One job's verdicts submitted through the caller's call; true when any was kept. A part Jev did not answer pauses the campaign. */
	async function submit(campaign: string, call: Call, judged: Judged, late: boolean): Promise<boolean> {
		const answer = (await call("cast.public.submit", { campaign, version: PUBLIC_FIGURES_VERSION, verdicts: judged.verdicts })) as Row;
		note({ lane: "public-figures", event: "judged", job_id: judged.jobId, people: judged.people, judged: judged.verdicts.length,
			public: judged.verdicts.filter(verdict => verdict.public).length, written: answer?.written ?? null, ms: judged.ms, ...(late ? { late: true } : {}),
			...(judged.reasons.length ? { partial: judged.reasons[0] } : {}), figures: judged.verdicts.map(verdict => Math.round(verdict.noul * 100) / 100) });
		// A part Jev did not answer is asked again by the next run, after the pause.
		if (judged.reasons.length) pause(campaign);
		return Number(answer?.written) > 0;
	}

	/** `waitUntil` is a delivery's: past it the run returns and leaves its judgement running. */
	async function run(campaign: string, call: Call, waitUntil: number | undefined): Promise<boolean> {
		let kept = false;
		const ready = held.get(campaign);
		if (ready) { held.delete(campaign); kept = await submit(campaign, call, ready, true); }
		// A judgement still in flight covers the rows a new job would list; a pause stands after the held verdicts are in.
		if (judging.has(campaign) || isPaused(campaign)) return kept;
		let decision: DecisionPort | undefined;
		try { decision = deps.decision(); } catch { decision = undefined; }
		if (!decision) return kept;
		for (let round = 0; round < ROUNDS; round++) {
			const job = (await call("cast.public.job", { campaign, version: PUBLIC_FIGURES_VERSION })) as Row;
			const people = Array.isArray(job?.people) ? (job.people as JobPerson[]).filter(person => typeof person?.id === "string" && typeof person.row_sha256 === "string") : [];
			if (typeof job?.job_id !== "string" || !people.length) return kept;
			const began = Date.now(), judgement = judge(campaign, job.job_id, people, decision);
			const judged = waitUntil === undefined ? await judgement : await within(judgement, waitUntil - Date.now());
			if (judged === LATE) {
				// The delivery goes on with these people untold; their verdicts land with the campaign's next run.
				judging.set(campaign, judgement.then(late => { if (late) held.set(campaign, late); }, () => undefined).finally(() => judging.delete(campaign)));
				note({ lane: "public-figures", event: "deferred", job_id: job.job_id, people: people.length, ms: Date.now() - began });
				return kept;
			}
			if (!judged) return kept;
			kept = await submit(campaign, call, judged, false) || kept;
			if (judged.reasons.length) return kept;
		}
		return kept;
	}
	return (campaign, call, options = {}) => {
		const flying = running.get(campaign);
		if (flying) return options.wait === false ? Promise.resolve(false) : flying;
		if (isPaused(campaign) && !held.has(campaign)) return Promise.resolve(false);
		const waitUntil = options.wait === false ? Date.now() + (deps.waitMs ?? PUBLIC_FIGURES_WAIT_MS) : undefined;
		const started = run(campaign, call, waitUntil).catch(error => {
			note({ lane: "public-figures", event: "fallback", reason: "error", message: error instanceof Error ? error.message.slice(0, 160) : "unknown" });
			return false;
		}).finally(() => running.delete(campaign));
		running.set(campaign, started);
		return started;
	};
}
