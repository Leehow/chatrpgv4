/**
 * Contract §22.4.3 (SL-36): an in-turn source consultation never holds the turn.
 *
 * Long gate #3 (`longgate3-haunting-1058`): five `lookup kind=source source_mode=answer` calls on the Haunting's window
 * cost 42-110 s each, a read plus a review, serial, in the foreground; the five turns walled 63-159 s where the other
 * fifteen had a median of 33 s. The ruling "Reading never holds a turn" (b): a consultation gets a short allowance
 * (`SOURCE_ANSWER_ALLOWANCE_MS`, below); past it the lookup answers `pending` with what the book's index
 * holds, the reading goes on in the background, and the answer is carried to the Keeper once, in a later clerk note
 * (§135.31.2). A completed answer is memoised in the campaign fork (`module.json` `reading.answers`) and a later question
 * on the same focus is answered from it (`memo`).
 *
 * This module is the host's side of that: the Keeper-facing results of the two new outcomes, and the per-campaign list of
 * consultations that went pending, which the hybrid engine reads through the `coc:source-answers` port before each model
 * step. The list lives in the extension, not in a table's state, so it outlives a reopen of the same campaign in this
 * process; a restart loses it, and then the memo is what answers the repeated lookup at once.
 *
 * Contract §135.20.1 (SL-102): the same list keeps the answers the Keeper was handed at a scene -- a landed consultation,
 * an answer inside the allowance, the memo's answers -- and hands them back on each run's first step while the party stays
 * there (a turn's request keeps no earlier turn's notes or tool results), deduplicated, bounded, dropped when the scene
 * changes. And a consultation asked here on an earlier turn that is still being read gets what is left of one allowance at
 * the next turn's first step (`settle`): on long gate #24 all five repeated lookups were an answer that landed 0.25-5 s
 * into that step, after its note had already said `pending`.
 */
import {CARRIED_VIEW_BYTES, HELD_ANSWERS_BYTES} from '../../runtime/jev/carried-views.ts';

type Row = Record<string, any>;

/**
 * §22.4.3 (SL-36): the named default of the in-turn source-answer allowance. On the Haunting's window a consultation was a
 * read of 18-45 s plus a review of 18-29 s; the allowance is what a turn may spend on one, not what one costs. A memo hit
 * or an exact accepted answer returns at once; an attached reading that lands inside it is returned whole.
 */
export const SOURCE_ANSWER_ALLOWANCE_MS = 8_000;
/** The allowance in force: `PI_COC_SOURCE_ANSWER_ALLOWANCE_MS` (milliseconds, 0 or more) overrides the named default. */
export function sourceAnswerAllowanceMs(env: NodeJS.ProcessEnv = process.env): number {
	const raw = env.PI_COC_SOURCE_ANSWER_ALLOWANCE_MS?.trim(), value = Number(raw);
	return raw && Number.isFinite(value) && value >= 0 ? value : SOURCE_ANSWER_ALLOWANCE_MS;
}

/** What the Keeper is told when a consultation outlives its allowance (Keeper-only, system language). */
export const PENDING_ANSWER_NOTE = 'The book is still being read for this question: the answer is not here yet, and this turn goes on without it. '
	+ 'The reading continues in the background; when it lands it is carried to you once, in a later clerk note (carried view focus source_answer), '
	+ 'and it is kept in the campaign memo, so the same lookup on a later turn answers at once. Until then use what is already known: the carried '
	+ 'source passages, the capsule, and the index rows here (where the book treats this focus). Narrate what the investigator does while the '
	+ 'answer is not there; do not narrate what the book would say, do not put the reading into the fiction, and do not send this lookup again '
	+ 'this turn. The pending read is the clerk\'s business, not the player\'s.';
/** What the Keeper is told when the campaign memo answers a consultation (Keeper-only, system language). */
export const MEMO_ANSWER_NOTE = 'The campaign has already checked the book on this focus: these are those answers, each with the question it '
	+ 'answered, and no new reading was made. They are source consultations, not prepared material. If none of them answers your question, '
	+ 'repeat the lookup with retry: true to have the book read for it (past a short allowance it is carried to you on a later turn).';

/**
 * §22.4.3.1 (SL-58): what the Keeper is told when a `prepare` consultation outlives its allowance (Keeper-only, system
 * language). Unlike an `answer` past its allowance, this reading keeps its blocking slot (the Keeper asked for this
 * material now), so it is not competing with background work for a slot; it is only not the turn's own wait any more.
 */
export const PENDING_PREPARE_NOTE = 'The book is still being read to prepare this material: it is not ready yet, and this turn goes on without it. '
	+ 'The reading keeps its own slot and continues; when it settles it is carried to you once, in a later clerk note (carried view focus '
	+ 'source_answer). Until then use what is already known: the carried source passages, the capsule, and the index rows here (where the book '
	+ 'treats this focus). Narrate what the investigator does while the material is not there; do not narrate what the book would say, do not put '
	+ 'the reading into the fiction, and do not send this lookup again this turn. The pending read is the clerk\'s business, not the player\'s.';

export interface PendingAnswer {
	/** The consultation's identity for this list: focus and question as the Keeper sent them. */
	key: string;
	focus: string;
	question: string;
	jobId?: string;
	turn: number;
	since: number;
	state: 'pending' | 'landed' | 'unavailable';
	answer?: Row;
	reason?: string;
	carried?: boolean;
	/** §22.4.3.1 (SL-58): `'answer'` (default) is a checked consultation; `'prepare'` is source material being prepared. */
	kind: 'answer' | 'prepare';
	/** §135.20.1 (SL-102): the scene the party was at when the Keeper asked (the table's active scene), when known. */
	scene?: string;
}
/**
 * §135.20.1 (SL-102): an answer the Keeper was handed at a scene, kept while the party stays there. `run` is the run whose
 * request already holds it (the run it was carried in, or whose own lookup returned it): §135.23 keeps a run's request
 * append-only, so it is not carried twice in one run; a later run's request has none of it, so it is carried again.
 */
export interface HeldAnswer {
	/** `[focus, question]`: the same question on the same focus is the same answer (a newer one replaces it). */
	key: string;
	focus: string;
	question: string;
	scene: string;
	turn: number;
	answer: Row;
	/** What the entry costs the carried section: its view's bytes, capped at one carried view (`CARRIED_VIEW_BYTES`). */
	bytes: number;
	run?: string;
}
/** What the engine takes before a model step: the consultations still reading, and those that settled and were not yet carried. */
export interface SourceAnswersTake {
	pending: Array<{focus: string; question: string; since_turn: number; purpose?: string; scene?: string}>;
	landed: Array<{focus: string; question: string; since_turn: number; answer?: Row; unavailable?: string}>;
	/** §135.20.1 (SL-102): the answers held at the scene the engine is at, not yet in this run's request, newest first. */
	held?: Array<{focus: string; question: string; since_turn: number; answer: Row}>;
	/** §135.20.1: landed answers the Keeper's own lookup already returned in this run, so not carried again (named, never silent). */
	handed?: Array<{focus: string; since_turn: number}>;
	/** §22.4.7 (SL-47): the book's text of scenes a move landed on, once each. */
	texts?: Array<{scene: string; pages: Array<{page: number; pdf_label?: string; text: string}>}>;
	/** §22.4.7: scenes whose reviewed record settled since, once each (`unavailable` when the reading failed). */
	records?: Array<{scene: string; since_turn: number; unavailable?: string}>;
}
/** The `coc:source-answers` port (§135.31.2): the kernel extension answers it for the table's campaign. */
export interface SourceAnswersPort {
	campaign: string;
	/** §135.20.1: `scene` is where the run is (held answers of any other scene are dropped); `run` is the run taking. */
	take(at?: {scene?: string; run?: string}): SourceAnswersTake;
	/** §135.20.1: at a run's first model step, wait out what is left of one allowance for this scene's earlier consultations. */
	settle?(input: {scene: string; turn: number; elapsed_ms: number}): Promise<SettleReport>;
}
/** §135.20.1: what a first-step wait did: the foci it waited on, how long, and how many landed or are still reading. */
export interface SettleReport {
	foci: string[];
	waited_ms: number;
	bound_ms: number;
	landed: number;
	pending: number;
}
/** §135.20.1: the held key of an answer: its focus and the question it answered, as the Keeper sent them. */
export const heldKey = (focus: string, question: string): string => JSON.stringify([focus, question]);
/** §135.20.1: an answer worth holding carries a checked answer the Keeper can read (structure only: a nonempty `answer`). */
const readable = (answer: Row | undefined): answer is Row => !!answer && typeof answer.answer === 'string' && answer.answer.trim().length > 0;

/** A consultation's answer as the Keeper reads it: the checked answer or the memo's answers, never host keys. */
export function settledAnswer(response: Row): Row | undefined {
	if (response?.source_answer && typeof response.source_answer === 'object') return response.source_answer;
	if (Array.isArray(response?.memo) && response.memo.length) return memoAnswer(response.memo);
	return undefined;
}
/** The lookup's result for a memo hit: every memoised answer on the focus, each with its question. */
export function memoAnswer(memo: Row[]): Row {
	return {status: 'memo', answers: memo.map(entry => ({question: entry.question, ...(entry.source_answer ?? {})})), note: MEMO_ANSWER_NOTE};
}
/** The lookup's result past the allowance: `pending`, with the index rows the kernel returned for the focus. */
export function pendingAnswer(response: Row, read: {focus: string; question: string}): Row {
	return {status: 'pending', focus: read.focus, index: Array.isArray(response.index) ? response.index : [], note: PENDING_ANSWER_NOTE};
}
/** §22.4.3.1 (SL-58): the `prepare` lookup's result past the allowance: `pending`, with whatever index rows came back. */
export function pendingPrepare(response: Row, read: {focus: string; question: string}): Row {
	return {status: 'pending', focus: read.focus, index: Array.isArray(response.index) ? response.index : [], note: PENDING_PREPARE_NOTE};
}
/**
 * §22.4.3.1 (SL-58): a `prepare` consultation's landing -- the material became ready, was settled unusable, or (via the
 * rejection branch in `register`, below) failed reading. Never a checked answer: `prepare` publishes graph material, not
 * an answer artifact, so `settledAnswer` does not apply to it.
 */
export function preparedLanding(response: Row): Row {
	if (response?.state === 'unusable') return {status: 'material_unusable', reason: response.reason ?? null};
	return {status: 'material_ready'};
}

export class PendingAnswers {
	private lists = new Map<string, PendingAnswer[]>();
	/** §135.20.1 (SL-102): the answers the Keeper was handed, per campaign, oldest first; one scene's survive a take. */
	private shelves = new Map<string, HeldAnswer[]>();
	/** §135.20.1: each pending entry's end (it has left `pending` once this settles); what `settle` waits on. */
	private ends = new WeakMap<PendingAnswer, Promise<void>>();
	private readonly record: (row: Row) => void;
	private readonly now: () => number;
	constructor(record: (row: Row) => void, now: () => number = Date.now) { this.record = record; this.now = now; }

	/**
	 * A consultation outlived its allowance: keep it, and follow `settled` (the same reading) to its end. A second
	 * pending ask of the same focus and question of the same kind is the same entry. Telemetry never writes the question
	 * (§22 #65) but always names the kind (§22.4.3.1, SL-58): `'answer'` (the default) or `'prepare'`. `scene` (§135.20.1)
	 * is where the party was when the Keeper asked.
	 */
	register(campaign: string, read: {focus: string; question: string}, turn: number, jobId: string | undefined, settled: Promise<Row> | undefined,
		kind: 'answer' | 'prepare' = 'answer', scene?: string): PendingAnswer {
		const key = JSON.stringify([kind, read.focus, read.question]), list = this.lists.get(campaign) ?? [];
		this.lists.set(campaign, list);
		const existing = list.find(entry => entry.key === key && entry.state === 'pending');
		if (existing) return existing;
		const entry: PendingAnswer = {key, focus: read.focus, question: read.question, ...(jobId ? {jobId} : {}), turn, since: this.now(), state: 'pending', kind,
			...(scene ? {scene} : {})};
		list.push(entry);
		this.record({lane: 'reading', event: 'answer_pending', campaign, turn, focus: read.focus, purpose: kind, ...(jobId ? {job_id: jobId} : {})});
		const settle = (state: 'landed' | 'unavailable', fields: Partial<PendingAnswer>) => {
			if (entry.state !== 'pending') return;
			Object.assign(entry, {state}, fields);
			this.record({lane: 'reading', event: state === 'landed' ? 'answer_landed' : 'answer_unavailable', campaign, turn, focus: read.focus, purpose: kind,
				...(jobId ? {job_id: jobId} : {}), ms: this.now() - entry.since, ...(fields.reason ? {reason: fields.reason} : {}),
				...(fields.answer ? {status: fields.answer.status ?? null} : {})});
		};
		this.ends.set(entry, (settled ?? Promise.reject(new Error('no reading to follow'))).then(response => {
			const answer = kind === 'prepare' ? preparedLanding(response) : settledAnswer(response);
			if (answer) settle('landed', {answer});
			else settle('unavailable', {reason: 'no_answer'});
		}, failure => settle('unavailable', {reason: String(failure?.details?.reason ?? failure?.code ?? 'reading_failed')})));
		return entry;
	}

	/**
	 * §135.20.1 (SL-102): the Keeper was handed these answers at `scene` (a lookup inside its allowance, the memo's answers, or a
	 * consultation that landed); `run` is the run whose request now holds them. The same question on the same focus is one
	 * entry, and the newer answer replaces the older one. A scene's shelf keeps its newest answers within `HELD_ANSWERS_BYTES`;
	 * an older one that no longer fits is dropped with a `held_dropped` row (reason `budget`), never silently.
	 */
	hold(campaign: string, scene: string | undefined, answers: ReadonlyArray<{focus: string; question: string; answer: Row | undefined}>, turn: number, run?: string): void {
		if (!scene) return;
		const shelf = this.shelves.get(campaign) ?? [];
		this.shelves.set(campaign, shelf);
		for (const {focus, question, answer} of answers) {
			if (!readable(answer)) continue;
			const key = heldKey(focus, question), at = shelf.findIndex(entry => entry.key === key && entry.scene === scene);
			const previous = at >= 0 ? shelf.splice(at, 1)[0] : undefined;
			const view = {question, ...answer};
			shelf.push({key, focus, question, scene, turn, answer, bytes: Math.min(Buffer.byteLength(JSON.stringify(view), 'utf8'), CARRIED_VIEW_BYTES),
				...(run ?? previous?.run ? {run: run ?? previous!.run} : {})});
		}
		let total = 0;
		const kept = new Set<HeldAnswer>();
		for (const entry of [...shelf].reverse()) {
			if (entry.scene !== scene) { kept.add(entry); continue; }
			if (total + entry.bytes > HELD_ANSWERS_BYTES) continue;
			total += entry.bytes;
			kept.add(entry);
		}
		const dropped = shelf.filter(entry => !kept.has(entry));
		if (dropped.length) this.record({lane: 'reading', event: 'held_dropped', campaign, turn, reason: 'budget', scene, foci: dropped.map(entry => entry.focus)});
		this.shelves.set(campaign, shelf.filter(entry => kept.has(entry)));
	}

	/**
	 * Before a model step (§135.31.2): the consultations still pending, and the settled ones not yet carried -- each of
	 * those exactly once; taking them marks them carried and drops them from the list.
	 *
	 * §135.20.1 (SL-102), when the engine says where it is (`at.scene`) and which run is taking (`at.run`): a landed answer
	 * goes on the shelf of the scene it was asked at; one the Keeper's own lookup already returned in this run is not carried
	 * again (`handed`); every answer held at `at.scene` that this run's request does not hold yet comes back as `held`, newest
	 * first; and the shelves of every other scene are dropped (a `held_dropped` row, reason `scene_change`).
	 */
	take(campaign: string, at: {scene?: string; run?: string} = {}): SourceAnswersTake {
		const list = this.lists.get(campaign) ?? [];
		const pending = list.filter(entry => entry.state === 'pending').map(entry => ({focus: entry.focus, question: entry.question, since_turn: entry.turn, purpose: entry.kind}));
		const settled = list.filter(entry => entry.state !== 'pending' && !entry.carried);
		for (const entry of settled) entry.carried = true;
		this.lists.set(campaign, list.filter(entry => !entry.carried));
		const landed: SourceAnswersTake['landed'] = [], handed: NonNullable<SourceAnswersTake['handed']> = [];
		for (const entry of settled) {
			const answer = entry.state === 'landed' && entry.kind === 'answer' ? entry.answer : undefined;
			const already = at.run !== undefined && readable(answer) && entry.scene !== undefined
				&& this.shelf(campaign).some(held => held.key === heldKey(entry.focus, entry.question) && held.scene === entry.scene && held.run === at.run);
			if (readable(answer) && (!at.scene || entry.scene === at.scene)) this.hold(campaign, entry.scene, [{focus: entry.focus, question: entry.question, answer}], entry.turn, at.run);
			if (already) { handed.push({focus: entry.focus, since_turn: entry.turn}); continue; }
			landed.push({focus: entry.focus, question: entry.question, since_turn: entry.turn,
				...(entry.state === 'landed' ? {answer: entry.answer} : {unavailable: entry.reason ?? 'reading_failed'})});
		}
		if (!at.scene) return {pending, landed, ...(handed.length ? {handed} : {})};
		const shelf = this.shelf(campaign), gone = shelf.filter(entry => entry.scene !== at.scene);
		if (gone.length) this.record({lane: 'reading', event: 'held_dropped', campaign, reason: 'scene_change', scene: at.scene, foci: gone.map(entry => entry.focus)});
		const here = shelf.filter(entry => entry.scene === at.scene);
		this.shelves.set(campaign, here);
		// Without a run the landed ones of this take are the only thing known to be in hand: they are not repeated as held.
		const now = new Set(landed.map(entry => heldKey(entry.focus, entry.question)));
		const due = here.filter(entry => at.run === undefined ? !now.has(entry.key) : entry.run !== at.run).reverse();
		for (const entry of due) if (at.run !== undefined) entry.run = at.run;
		return {pending, landed, ...(handed.length ? {handed} : {}),
			held: due.map(entry => ({focus: entry.focus, question: entry.question, since_turn: entry.turn, answer: entry.answer}))};
	}

	/**
	 * §135.20.1 (SL-102): at a run's first model step, wait for the `answer` consultations asked at `scene` on an earlier turn
	 * than `turn` that are still being read -- at most `ms` (what is left of one allowance), and not at all when there are none.
	 * Past the bound the note carries them `pending`, as before. Never throws; the reading is never cancelled.
	 */
	async settle(campaign: string, input: {scene: string; turn: number; ms: number}): Promise<SettleReport> {
		const due = (this.lists.get(campaign) ?? []).filter(entry => entry.state === 'pending' && entry.kind === 'answer'
			&& entry.scene === input.scene && entry.turn < input.turn);
		const bound = Math.max(0, input.ms), began = this.now();
		if (due.length && bound > 0) {
			let timer: ReturnType<typeof setTimeout> | undefined;
			await Promise.race([Promise.all(due.map(entry => this.ends.get(entry) ?? Promise.resolve())),
				new Promise<void>(resolve => { timer = setTimeout(resolve, bound); })]).catch(() => undefined);
			if (timer) clearTimeout(timer);
		}
		return {foci: due.map(entry => entry.focus), waited_ms: due.length && bound > 0 ? this.now() - began : 0, bound_ms: bound,
			landed: due.filter(entry => entry.state !== 'pending').length, pending: due.filter(entry => entry.state === 'pending').length};
	}

	private shelf(campaign: string): HeldAnswer[] { return this.shelves.get(campaign) ?? []; }
}
