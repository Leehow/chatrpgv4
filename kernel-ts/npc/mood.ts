/**
 * What a person feels right now (contract §161).
 *
 * One short line the Keeper writes with `apply npc mood`, in the campaign's play language because it is the person's
 * inner state, not system text. It stands alone in its npc effect, mints an ordinary keeper-only `npc` receipt, folds
 * into the person's ledger entry at turn close (`mood`, with the replaced lines in `mood_earlier`), and the present
 * card shows it as `now` before the dossier, because it is what decides how their next line sounds.
 *
 * Nothing here reads what the line says or which language it is in. The checks are format only: not empty once
 * trimmed, at most `MOOD_TEXT_LIMIT` characters, no line break, no `{{` marker. The same line written again is
 * accepted and minted again; nothing compares one line with another.
 */
import {RpcError} from '../errors.js';
import {array, row, type Row} from '../read/values.js';

/** The capability a package that tells the Keeper to write or read the mood requires (§161.6). */
export const MOOD_CAPABILITY = 'npc.mood.v1';
/** The longest line, in characters (code points, as the schema's `maxLength` counts them). */
export const MOOD_TEXT_LIMIT = 120;
/** How many replaced lines the ledger keeps (`mood_earlier`, oldest first). */
const EARLIER_KEPT = 2;
/**
 * The npc fields a mood cannot share its effect with (§161.1): every other change to the person, and the host-only
 * carriers of what an act brings out. Moving or re-standing the person in the same batch is a second effect.
 */
export const MOOD_CONFLICTS: readonly string[] = Object.freeze([
    'to', 'stance', 'dead', 'skill', 'archetype', 'conditions', 'defense', 'action', 'disposition',
    'intends', 'intent_ref', 'intent_outcome', 'outcome', 'spend_turn', 'reunion', '_draws', '_produces',
]);

const LINE_BREAK = /[\r\n\u2028\u2029]/;

/** The line a mood effect carries, trimmed, or the `mood_text` refusal that says what is wrong with its shape. */
export function moodText(value: unknown): string {
    const refuse = (message: string, extra: Row = {}): never => {
        throw new RpcError('invalid_params', message, {
            fix: `write what this person feels right now as one short line in the play language: at most ${MOOD_TEXT_LIMIT} characters, no line break, no markers`,
            details: {field: 'npc.mood', reason: 'mood_text', ...extra},
        });
    };
    if (typeof value !== 'string' || !value.trim()) return refuse('npc.mood is an empty line');
    const text = value.trim(), length = Array.from(text).length;
    if (length > MOOD_TEXT_LIMIT) return refuse(`npc.mood is ${length} characters; a mood is one short line of at most ${MOOD_TEXT_LIMIT}`, {length, max: MOOD_TEXT_LIMIT});
    if (LINE_BREAK.test(text)) return refuse('npc.mood carries a line break; a mood is one line');
    if (text.includes('{{')) return refuse('npc.mood carries a {{ marker; a mood is the person\'s own line, not markup');
    return text;
}

/** The line the person's ledger entry holds now, or null: what a new mood replaces (`previous` on its receipt). */
export function moodLine(entry: Row): string | null {
    const text = row(row(entry).mood).text;
    return typeof text === 'string' && text ? text : null;
}

/**
 * Fold one receipt's `mood` into a ledger entry at turn close. The newest written last in the turn wins; the line it
 * replaces -- the one the ledger held before this turn -- moves to `mood_earlier` (the last `EARLIER_KEPT`), so a line
 * superseded within the same turn is not history. A fold, not a check: the writer refused anything malformed. A person
 * never given a mood gains neither key.
 */
export function foldMood(item: Row, mood: unknown, turn: number, receipt: unknown, why: unknown): void {
    const text = row(mood).text;
    if (typeof text !== 'string' || !text) return;
    const before = row(item.mood);
    if (typeof before.text === 'string' && before.since_turn !== turn)
        item.mood_earlier = [...array(item.mood_earlier), {text: before.text, since_turn: before.since_turn ?? null, until_turn: turn}].slice(-EARLIER_KEPT);
    item.mood = {text, since_turn: turn, receipt: receipt ?? null, ...(typeof why === 'string' && why.trim() ? {why} : {})};
}

/** The present card's `now` (§161.3): the ledger's mood, or null when none was ever written. */
export function moodNow(entry: Row): Row | null {
    const mood = row(row(entry).mood);
    return typeof mood.text === 'string' && mood.text ? {feels: mood.text, since_turn: mood.since_turn ?? null} : null;
}
