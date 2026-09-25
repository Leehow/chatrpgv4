/**
 * Contract §22.4.7 (SL-47): a move into a scene not yet read lands on the book's text; the scene's record lands when read.
 * Contract §22.4.7.1 (SL-56): a check or write on a person not yet read lands on the book's text; the person's record lands
 * when read. Contract §22.3.3 (SL-57): a reading refused twice settles `unusable`, and the Keeper is told once.
 *
 * SL-45's replay of the batch-4 table's t18 (SL-29 book A): with the lease sized and the slot given at once, one `detail` read of
 * the bar plus its review still took 98-118 s against the 120 s foreground wait, and the move was refused. The book's
 * native text of the scene was on its pages all along. The move now lands on that text; the reading continues on a
 * blocking slot; the reviewed record is carried to the Keeper once it lands. The batch-7 table's t10/t11 held two turns
 * 124 and 131 s on a person's record the same way; a person now lands on the book's text too.
 *
 * This module is the host's list of those readings, per campaign, read by the hybrid engine through the
 * `coc:source-answers` port before each model step (§135.31.2): the text to carry once, the reading still pending
 * (its row names the scene or the person), and the record that landed (or could not be read), carried once. Like the
 * consultations' list it lives in the extension, so it outlives a reopen of the same campaign in this process; a restart
 * loses it, and the record is then what `look` returns once the reading has published.
 */
type Row = Record<string, any>;

/** What the Keeper is told beside the scene's text (Keeper-only, system language); also the legacy apply result's note. */
export const SCENE_TEXT_NOTE = 'The move landed on the book\'s own text for this scene: its pages are carried here once. The scene\'s reviewed '
	+ 'record (its exits, the people there, the things and clues) is still being read and lands on a later note. Narrate the arrival from '
	+ 'these pages; do not invent exits, people, clues or numbers they do not state, and do not put the reading into the fiction.';
/** §22.4.7.1: what the Keeper is told beside a person's text on the legacy engine (Keeper-only, system language). */
export const PERSON_TEXT_NOTE = 'This person is played on the book\'s own text: the passage or pages that name them are carried here once. Their '
	+ 'reviewed record (numbers, what they know, how they act) is still being read and lands on a later note. Play them from this text; do not '
	+ 'invent numbers or facts it does not state, and do not put the reading into the fiction.';

export interface SceneReading {
	/** The focus the reading reads (a scene handle, a person's handle or given name). */
	scene: string;
	/** §22.4.7.1: the person this entry is about (their display name), when it is a person's. */
	person?: string;
	pages: Array<{page: number; pdf_label?: string; text: string}>;
	turn: number;
	since: number;
	state: 'pending' | 'landed' | 'unavailable' | 'unusable';
	reason?: string;
	/** The pages were carried (once). */
	textCarried?: boolean;
	/** The settled record was carried (once). */
	recordCarried?: boolean;
}
export interface SceneReadingsTake {
	pending: Array<{focus: string; question: string; since_turn: number; purpose: 'detail'; scene?: string; person?: string}>;
	texts: Array<{scene: string; pages: SceneReading['pages']; person?: string}>;
	records: Array<{scene: string; since_turn: number; unavailable?: string; unusable?: string; person?: string}>;
}

export class SceneReadings {
	private lists = new Map<string, SceneReading[]>();
	/** §22.3.3: the foci whose unusable settlement this campaign's Keeper was already told, in this process. */
	private settledShown = new Map<string, Set<string>>();
	private readonly record: (row: Row) => void;
	private readonly now: () => number;
	constructor(record: (row: Row) => void, now: () => number = Date.now) { this.record = record; this.now = now; }

	/**
	 * A move landed on `scene`'s text, or (with `person`) a check or write landed on a person's text: keep the pages to carry
	 * once, and follow `settled` (the focus's reading) to its end.
	 */
	register(campaign: string, scene: string, pages: SceneReading['pages'], turn: number, settled: Promise<Row> | undefined, person?: string): SceneReading {
		const list = this.lists.get(campaign) ?? [];
		this.lists.set(campaign, list);
		const existing = list.find(entry => entry.scene === scene && entry.state === 'pending');
		if (existing) return existing;
		const entry: SceneReading = {scene, ...(person ? {person} : {}), pages, turn, since: this.now(), state: 'pending'};
		list.push(entry);
		const kind = person ? 'person' : 'scene';
		const settle = (state: 'landed' | 'unavailable' | 'unusable', reason?: string) => {
			if (entry.state !== 'pending') return;
			entry.state = state;
			if (reason) entry.reason = reason;
			this.record({lane: 'reading', event: `${kind}_record_${state}`, campaign, turn, ...(person ? {person, focus: scene} : {scene}),
				ms: this.now() - entry.since, ...(reason ? {reason} : {})});
		};
		void (settled ?? Promise.reject(new Error('no reading to follow'))).then(
			response => response?.state === 'ready' ? settle('landed')
				// §22.3.3 (SL-57): refused twice, the focus is settled and will not be read again unless asked.
				: response?.state === 'unusable' ? settle('unusable', String(response?.reason ?? 'unusable'))
				: settle('unavailable', String(response?.state ?? 'no_record')),
			failure => settle('unavailable', String(failure?.details?.reason ?? failure?.code ?? 'reading_failed')));
		return entry;
	}

	/** Before a model step: the reads still pending, the texts not yet carried (once), the records settled and not yet carried (once). */
	take(campaign: string): SceneReadingsTake {
		const list = this.lists.get(campaign) ?? [];
		const shown = this.settledShown.get(campaign) ?? new Set<string>();
		this.settledShown.set(campaign, shown);
		const pending = list.filter(entry => entry.state === 'pending')
			.map(entry => ({focus: entry.scene, question: '', since_turn: entry.turn, purpose: 'detail' as const,
				...(entry.person ? {person: entry.person} : {scene: entry.scene})}));
		const texts = list.filter(entry => !entry.textCarried && entry.pages.length).map(entry => { entry.textCarried = true;
			return {scene: entry.scene, pages: entry.pages, ...(entry.person ? {person: entry.person} : {})}; });
		const records = list.filter(entry => entry.state !== 'pending' && !entry.recordCarried).flatMap(entry => {
			entry.recordCarried = true;
			// §22.3.3: a settlement is told once per campaign and focus; a later landing on the same settled focus says nothing more.
			if (entry.state === 'unusable') {
				if (shown.has(entry.scene)) return [];
				shown.add(entry.scene);
			}
			return [{scene: entry.scene, since_turn: entry.turn, ...(entry.person ? {person: entry.person} : {}),
				...(entry.state === 'unavailable' ? {unavailable: entry.reason ?? 'reading_failed'} : {}),
				...(entry.state === 'unusable' ? {unusable: entry.reason ?? 'unusable'} : {})}];
		});
		this.lists.set(campaign, list.filter(entry => !(entry.recordCarried && (entry.textCarried || !entry.pages.length))));
		return {pending, texts, records};
	}
}
