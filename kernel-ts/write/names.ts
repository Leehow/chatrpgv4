/**
 * Contract §103.8 (owner ruling, 2026-10-03): the Keeper does not hold the name of a person nobody has named to the
 * investigator. When the fiction has that name said -- the person gives it, someone calls them by it, a paper shows it --
 * the Keeper writes `{{name:<who>}}` at that point, with `who` as it writes the person anywhere else (the handle, or the
 * word this table calls them), and the delivery carries the name the book gives them. The prose then shows that name, so
 * the person is told from this turn on by the ordinary rule (`toldTurn`, journal/naming.ts).
 *
 * Resolved by the say token's own resolver, so `who` means the same person in both tokens. A token naming nobody is left
 * as the word written, with the token gone, and reported; nothing is refused (§34.14: a token is a rendering hint).
 */
import type { ModuleGraph } from '../read/module-graph.js';
import type { Row } from '../read/values.js';
import type { SpeakerResolver } from './speech-pass.js';

const NAME_TOKEN = /\{\{name:([^{}\n]{1,80})\}\}/g;

/** §176.8: the token that has `who`'s name said, as every untold block carries it (`say_name`). */
export const nameToken = (who: string): string => `{{name:${who}}}`;

export interface NamedText { text: string; named: string[]; unresolved: string[] }

/** `text` with every `{{name:<who>}}` replaced by the book's name for that person; the handles named, and the words that named nobody. */
export function withNames(text: string, speakers: SpeakerResolver, graph: ModuleGraph): NamedText {
    const named: string[] = [], unresolved: string[] = [];
    const out = text.replace(NAME_TOKEN, (_token, who: string) => {
        const said = who.trim(), speaker = speakers(said) as Row, handle = typeof speaker.npc === 'string' ? speaker.npc : '';
        const node = handle ? graph.find(handle, ['npc']) : null;
        if (!node) {
            unresolved.push(said);
            return said;
        }
        if (!named.includes(handle)) named.push(handle);
        return graph.displayName(node);
    });
    return { text: out, named, unresolved };
}
