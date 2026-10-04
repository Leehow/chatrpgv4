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
import { normalize, type Row } from '../read/values.js';
import { occurs } from '../journal/naming.js';
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

/**
 * §177.11: the words of `text` that are the Keeper's own -- every resolved `{{name:<who>}}` taken out (the delivery puts the
 * book's name there on purpose) and an unresolved one left as the word it carries -- checked for an untold person's printed
 * name. Table 25 (turn 8): asked his name, the toothless trucker said "call me Ernie", the name of another man of the book
 * the investigator had not met; delivered, it would also have counted that man as told from then on.
 */
export function untoldNamesSaid(text: string, speakers: SpeakerResolver, graph: ModuleGraph, names: readonly string[]): string[] {
    if (!names.length) return [];
    const own = text.replace(NAME_TOKEN, (_token, who: string) => {
        const speaker = speakers(who.trim()) as Row, handle = typeof speaker.npc === 'string' ? speaker.npc : '';
        return handle && graph.find(handle, ['npc']) ? ' ' : who.trim();
    // Every other marker is machine text, not prose: a say token's or a map's handle normalizes to the name it was made from.
    }).replace(/\{\{[^{}\n]*\}\}/g, ' ');
    const said = normalize(own);
    return names.filter(name => occurs(said, normalize(name)));
}

/** `text` with each word replaced by its shown word, in prose only: a marker's own text is left as it is. */
export function replaceInProse(text: string, replacements: ReadonlyMap<string, string>): string {
    const latin = (char: string | undefined) => !!char && /^[A-Za-z0-9]$/.test(char);
    const words = [...replacements.keys()].sort((a, b) => b.length - a.length);
    return text.split(/(\{\{[^{}\n]*\}\})/).map((part, index) => {
        if (index % 2) return part;
        let out = part;
        for (const word of words) {
            let result = '', from = 0;
            for (let at = out.indexOf(word); at >= 0; at = out.indexOf(word, at + 1)) {
                if (at < from || (latin(word[0]) && latin(out[at - 1])) || (latin(word[word.length - 1]) && latin(out[at + word.length]))) continue;
                result += out.slice(from, at) + replacements.get(word)!;
                from = at + word.length;
            }
            out = result + out.slice(from);
        }
        return out;
    }).join('');
}
