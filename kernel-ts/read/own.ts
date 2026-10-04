/**
 * Contract §179.2: the capsule's `own`, the investigator's own record. What their card says of why they came, what
 * they carry and whom they hold to, and the player's own words from turns the Keeper's history no longer carries.
 *
 * App table `game-8e41c325`, turn 6 (2026-10-04): the player leafed through the investigator's notes and the Keeper
 * wrote the room instead of the page. The card named the notes and nothing in them, and the particulars of the errand
 * -- whom they seek and what she drove -- were the player's own words on turns 2 and 3, which no section carried at
 * the bar: `memory` ranks by who is present, and `recent` holds two turns. Nothing here reads the words for meaning.
 */
import {chars, length, row, type Row} from './values.js';
import {jsonSize} from './capsule.js';

export const OWN_BUDGET = 2048;
/** One backstory category, and one turn's words, at most (§179.2). */
export const CARD_CHARS = 100, SAID_CHARS = 160;
/** A string field's words, or nothing: `string()` renders an absent value as "None". */
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
/** Already projected as `known.investigator.appearance` (§119); every other category is the card's own. */
const SHOWN_ELSEWHERE = new Set(['personal_description']);

/** A category's words: a string, a list of strings joined, else nothing. Shapes differ between setup and pregens. */
function words(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map(item => item.trim()).join('; ');
    return '';
}

function card(sheet: Row): Row {
    const story = row(sheet.backstory), out: Row = {};
    const put = (key: string, value: unknown) => {const held = words(value); if (held) out[key] = chars(held, CARD_CHARS);};
    for (const [key, value] of Object.entries(story)) {
        if (SHOWN_ELSEWHERE.has(key)) continue;
        // A pregen nests categories one level down (`scenario_bound: {description, ...}`); each keeps its path.
        if (value && typeof value === 'object' && !Array.isArray(value))
            for (const [inner, nested] of Object.entries(value as Row)) {if (!SHOWN_ELSEWHERE.has(inner)) put(`${key}.${inner}`, nested);}
        else put(key, value);
    }
    const summary = text(row(sheet.key_connection).summary);
    if (summary) out.key_connection = chars(summary, CARD_CHARS);
    return out;
}

function line(record: Row): Row {
    const spoken = text(record.player_text);
    return length(spoken) > SAID_CHARS ? {turn: record.turn, player: chars(spoken, SAID_CHARS), cut: true} : {turn: record.turn, player: spoken};
}

/**
 * `records` are the committed turn records before this turn; `window` the turns `recent` already carries. The earliest
 * words fill up to half of what the card leaves of the budget, the latest outside the window fill the rest, and
 * `omitted` names the turns between. Position, never relevance: which words matter is the Keeper's to judge.
 */
export function ownSection(sheet: Row | undefined, records: readonly Row[], window: readonly number[], budget = OWN_BUDGET): Row | null {
    if (!sheet) return null;
    const section: Row = {}, held = card(sheet);
    if (Object.keys(held).length) section.card = held;
    // A card longer than the section itself gives up characters from its longest category, never a category.
    while (jsonSize({...section, said: []}) > budget) {
        const [key, value] = Object.entries(held).reduce((a, b) => length(b[1]) > length(a[1]) ? b : a);
        if (length(value) <= 20) break;
        held[key] = chars(value, length(value) - 20);
    }
    const shut = new Set(window.map(Number));
    const earlier = records.filter(record => text(record.player_text) && !shut.has(Number(record.turn))).map(line);
    section.said = [];
    const fits = (rows: Row[]) => jsonSize({...section, said: rows, omitted: [0, 0]}) <= budget;
    const head: Row[] = [], tail: Row[] = [];
    const half = (budget - jsonSize({...section, said: [], omitted: [0, 0]})) / 2;
    let i = 0, j = earlier.length - 1;
    while (i <= j && jsonSize({said: [...head, earlier[i]]}) <= half && fits([...head, earlier[i], ...tail])) head.push(earlier[i++]);
    while (i <= j && fits([...head, earlier[j], ...tail])) tail.unshift(earlier[j--]);
    while (i <= j && fits([...head, earlier[i], ...tail])) head.push(earlier[i++]);
    section.said = [...head, ...tail];
    if (i <= j) section.omitted = [earlier[i].turn, earlier[j].turn];
    return section;
}
