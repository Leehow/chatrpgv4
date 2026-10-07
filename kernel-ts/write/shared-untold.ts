/**
 * Contract §188.8 (real table nr07-blood-road-1, 2026-10-07): a name several people share whom the investigator has not been
 * told about is shown in the Keeper's request as all their words joined (§177.4), and that joined word is never one person's
 * name. Blood Road has two untold men called by one first name, the trailer squatter and the hardware store owner. The player
 * asked about the name; the Keeper echoed it; §177.11's gate held the delivery, and its second delivery replaced the name with
 * the roster's shown word, which for a shared name is the joined word: the player read it in four turns as if it were one
 * person's name, once as the name the investigator asked the town about.
 *
 * So the gate offers each owner's own word apart, never substitutes a shared name, and holds a delivery or a document that
 * writes a joined word verbatim. The joined words are the roster's own (`untoldRosterNames`, `joinedWord`): exact strings the
 * kernel built, never a reading of the text's punctuation.
 */
import { joinedWord, rosterWord, untoldRosterNames, type RosterName } from '../read/capsule.js';
import { nameToken } from './names.js';
import { CampaignSnapshot } from '../read/campaign.js';
import { bookCast, tellGuard } from '../read/cast.js';
import type { ModuleGraph } from '../read/module-graph.js';
import { row, type Row } from '../read/values.js';
import { prepareNameHistory } from '../journal/name-history.js';
import type { KernelContext } from '../context.js';
import { RpcError } from '../errors.js';

/** The names several untold people share, by the exact string the roster renames, each with the roster's row for it. */
export function sharedNames(roster: readonly RosterName[]): Map<string, RosterName> {
    return new Map(roster.filter(entry => !entry.handle && entry.shown.length > 1).map(entry => [entry.name, entry] as [string, RosterName]));
}

/** The roster rows whose joined word `text` writes verbatim, anywhere in it (a marker's text included). */
export function joinedWritten(text: string, roster: readonly RosterName[]): RosterName[] {
    const found = new Map<string, RosterName>();
    for (const entry of roster) {
        if (entry.handle || entry.shown.length < 2) continue;
        const joined = joinedWord(entry.shown);
        if (!found.has(joined) && text.includes(joined)) found.set(joined, entry);
    }
    return [...found.values()];
}

/**
 * NR-08b: one person a shared name or a joined word stands for -- their own word (`rosterWord`) and, for someone the graph
 * has, the token that has their name said (`say_name`, §176.8: the one their untold block carries). The token is the path
 * the fiction takes when that person gives the name or is called by it: the delivery puts in the name the book gives them
 * and tells them (§103.8). Someone the reader has not reached yet has no token: no node for the delivery to name.
 */
export type Candidate = { word: string; say_name?: string };
export function candidatesOf(graph: ModuleGraph, world: Row, journal: Row, entry: RosterName): Candidate[] {
    const cast = bookCast(graph);
    return entry.ids.map(id => {
        const person = cast.find(each => each.id === id), word = person ? rosterWord(graph, world, journal, person) : id;
        return person?.node ? { word, say_name: nameToken(word) } : { word };
    });
}

const listed = (people: readonly Candidate[]): string =>
    people.map(person => person.say_name ? `${JSON.stringify(person.word)} (say_name ${person.say_name})` : JSON.stringify(person.word)).join('; ');

/**
 * What a refusal says about shared names (`shared`, one list of words per name held) and joined words (`joined`): each person
 * by their own word, apart. Never a name: the request's rename would turn it into the joined word again (§177.15).
 */
export function sharedNotice(shared: readonly (readonly Candidate[])[], joined: readonly (readonly Candidate[])[]): string {
    const seen = new Set<string>(), parts: string[] = [];
    for (const people of shared) {
        const key = joinedWord(people.map(person => person.word));
        if (seen.has(key)) continue;
        seen.add(key);
        parts.push(`a name at \u25a2 is one that ${people.length} different people the investigator has not been told about share, each called here by their own word: ${listed(people)}`);
    }
    for (const people of joined)
        parts.push(`the text writes the words of ${people.length} different people joined into one, as if they were one person: ${listed(people)}`);
    return parts.join('; ');
}

/**
 * The fix every such refusal carries. NR-08b (real table nr08-blood-road-1, turns 8 and 9): without the token in it, the Keeper
 * whose fiction had the hardware store's man give his name was refused about thirty times, the refusal budget ran out, and two
 * turns delivered nothing.
 */
export const SHARED_FIX = 'when the fiction has one of them give this name or be called by it, write that person\'s say_name from that list exactly where the name is said: the delivery puts in the name the book gives that person, and tells them. Otherwise call the one you mean by their own word from that list, or describe them. Never write the name itself, and never those words joined into one. Change only those words and send it again';

/**
 * §188.8: a document the investigator holds is text the player reads, so writing a joined word into it is refused like a
 * delivery that writes one (the §185 acceptance table had the Keeper copy a request-only string into a note the investigator
 * wrote). Untold names in documents are not gated here; only the joined word, which is nobody's name in any fiction.
 */
export async function refuseJoinedInDocument(kernel: KernelContext, campaign: string, graph: ModuleGraph, world: Row, text: string): Promise<void> {
    const snapshot = new CampaignSnapshot(kernel, campaign), journal = row(await snapshot.optional('npc-journal.json'));
    const records = prepareNameHistory(await snapshot.files('turns'), tellGuard(graph, world, journal));
    const joined = joinedWritten(text, untoldRosterNames(graph, world, journal, records)).map(entry => candidatesOf(graph, world, journal, entry));
    if (joined.length)
        throw new RpcError('invalid_params', sharedNotice([], joined), { fix: SHARED_FIX, details: { reason: 'untold_name', field: 'object.document.text', joined } });
}
