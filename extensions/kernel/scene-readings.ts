/**
 * Contract §22.4.7 (SL-47): a move into a scene not yet read lands on the book's text; the scene's record lands when read.
 *
 * SL-45's replay of the batch-4 table's t18 (SL-29 book A): with the lease sized and the slot given at once, one `detail` read of
 * the bar plus its review still took 98-118 s against the 120 s foreground wait, and the move was refused. The book's
 * native text of the scene was on its pages all along. The move now lands on that text; the reading continues on a
 * blocking slot; the reviewed record is carried to the Keeper once it lands.
 *
 * This module is the host's list of those scene readings, per campaign, read by the hybrid engine through the
 * `coc:source-answers` port before each model step (§135.31.2): the scene's text to carry once, the reading still pending
 * (its row names the scene), and the record that landed (or could not be read), carried once. Like the consultations'
 * list it lives in the extension, so it outlives a reopen of the same campaign in this process; a restart loses it, and
 * the scene's record is then what `look focus=scene` returns once the reading has published.
 */
type Row = Record<string, any>;

/** What the Keeper is told beside the scene's text (Keeper-only, system language); also the legacy apply result's note. */
export const SCENE_TEXT_NOTE = 'The move landed on the book\'s own text for this scene: its pages are carried here once. The scene\'s reviewed '
	+ 'record (its exits, the people there, the things and clues) is still being read and lands on a later note. Narrate the arrival from '
	+ 'these pages; do not invent exits, people, clues or numbers they do not state, and do not put the reading into the fiction.';

export interface SceneReading {
	scene: string;
	pages: Array<{page: number; pdf_label?: string; text: string}>;
	turn: number;
	since: number;
	state: 'pending' | 'landed' | 'unavailable';
	reason?: string;
	/** The pages were carried (once). */
	textCarried?: boolean;
	/** The settled record was carried (once). */
	recordCarried?: boolean;
}
export interface SceneReadingsTake {
	pending: Array<{focus: string; question: string; since_turn: number; purpose: 'detail'; scene: string}>;
	texts: Array<{scene: string; pages: SceneReading['pages']}>;
	records: Array<{scene: string; since_turn: number; unavailable?: string}>;
}

export class SceneReadings {
	private lists = new Map<string, SceneReading[]>();
	private readonly record: (row: Row) => void;
	private readonly now: () => number;
	constructor(record: (row: Row) => void, now: () => number = Date.now) { this.record = record; this.now = now; }

	/** A move landed on `scene`'s text: keep the pages to carry once, and follow `settled` (the scene's reading) to its end. */
	register(campaign: string, scene: string, pages: SceneReading['pages'], turn: number, settled: Promise<Row> | undefined): SceneReading {
		const list = this.lists.get(campaign) ?? [];
		this.lists.set(campaign, list);
		const existing = list.find(entry => entry.scene === scene && entry.state === 'pending');
		if (existing) return existing;
		const entry: SceneReading = {scene, pages, turn, since: this.now(), state: 'pending'};
		list.push(entry);
		const settle = (state: 'landed' | 'unavailable', reason?: string) => {
			if (entry.state !== 'pending') return;
			entry.state = state;
			if (reason) entry.reason = reason;
			this.record({lane: 'reading', event: state === 'landed' ? 'scene_record_landed' : 'scene_record_unavailable', campaign, turn, scene,
				ms: this.now() - entry.since, ...(reason ? {reason} : {})});
		};
		void (settled ?? Promise.reject(new Error('no reading to follow'))).then(
			response => response?.state === 'ready' ? settle('landed') : settle('unavailable', String(response?.state ?? 'no_record')),
			failure => settle('unavailable', String(failure?.details?.reason ?? failure?.code ?? 'reading_failed')));
		return entry;
	}

	/** Before a model step: the reads still pending, the texts not yet carried (once), the records settled and not yet carried (once). */
	take(campaign: string): SceneReadingsTake {
		const list = this.lists.get(campaign) ?? [];
		const pending = list.filter(entry => entry.state === 'pending')
			.map(entry => ({focus: entry.scene, question: '', since_turn: entry.turn, purpose: 'detail' as const, scene: entry.scene}));
		const texts = list.filter(entry => !entry.textCarried && entry.pages.length).map(entry => { entry.textCarried = true; return {scene: entry.scene, pages: entry.pages}; });
		const records = list.filter(entry => entry.state !== 'pending' && !entry.recordCarried).map(entry => {
			entry.recordCarried = true;
			return {scene: entry.scene, since_turn: entry.turn, ...(entry.state === 'unavailable' ? {unavailable: entry.reason ?? 'reading_failed'} : {})};
		});
		this.lists.set(campaign, list.filter(entry => !(entry.recordCarried && (entry.textCarried || !entry.pages.length))));
		return {pending, texts, records};
	}
}
