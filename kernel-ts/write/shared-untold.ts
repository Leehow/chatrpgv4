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
import { joinedWord, untoldRosterNames, type RosterName } from '../read/capsule.js';
import { CampaignSnapshot } from '../read/campaign.js';
import { tellGuard } from '../read/cast.js';
import type { ModuleGraph } from '../read/module-graph.js';
import { row, type Row } from '../read/values.js';
import { prepareNameHistory } from '../journal/name-history.js';
import type { KernelContext } from '../context.js';
import { RpcError } from '../errors.js';

/** The names several untold people share, each with every owner's own word, by the exact string the roster renames. */
export function sharedNames(roster: readonly RosterName[]): Map<string, readonly string[]> {
    return new Map(roster.filter(entry => !entry.handle && entry.shown.length > 1).map(entry => [entry.name, entry.shown] as [string, readonly string[]]));
}

/** The joined words `text` writes verbatim, anywhere in it (a marker's text included), each as its owners' own words. */
export function joinedWritten(text: string, roster: readonly RosterName[]): string[][] {
    const found = new Map<string, string[]>();
    for (const entry of roster) {
        if (entry.handle || entry.shown.length < 2) continue;
        const joined = joinedWord(entry.shown);
        if (!found.has(joined) && text.includes(joined)) found.set(joined, [...entry.shown]);
    }
    return [...found.values()];
}

const listed = (words: readonly string[]): string => words.map(word => JSON.stringify(word)).join('; ');

/**
 * What a refusal says about shared names (`shared`, one list of words per name held) and joined words (`joined`): each person
 * by their own word, apart. Never a name: the request's rename would turn it into the joined word again (§177.15).
 */
export function sharedNotice(shared: readonly (readonly string[])[], joined: readonly (readonly string[])[]): string {
    const seen = new Set<string>(), parts: string[] = [];
    for (const words of shared) {
        if (seen.has(joinedWord(words))) continue;
        seen.add(joinedWord(words));
        parts.push(`a name at ▢ is one that ${words.length} different people the investigator has not been told about share, each called here by their own word: ${listed(words)}`);
    }
    for (const words of joined)
        parts.push(`the text writes the words of ${words.length} different people joined into one, as if they were one person: ${listed(words)}`);
    return parts.join('; ');
}

/** The fix every such refusal carries. */
export const SHARED_FIX = 'write the one person you mean by their own word from that list, or describe them; never write those words joined into one, and never their name. Change only those words and send it again';

/**
 * §188.8: a document the investigator holds is text the player reads, so writing a joined word into it is refused like a
 * delivery that writes one (the §185 acceptance table had the Keeper copy a request-only string into a note the investigator
 * wrote). Untold names in documents are not gated here; only the joined word, which is nobody's name in any fiction.
 */
export async function refuseJoinedInDocument(kernel: KernelContext, campaign: string, graph: ModuleGraph, world: Row, text: string): Promise<void> {
    const snapshot = new CampaignSnapshot(kernel, campaign), journal = row(await snapshot.optional('npc-journal.json'));
    const records = prepareNameHistory(await snapshot.files('turns'), tellGuard(graph, world, journal));
    const joined = joinedWritten(text, untoldRosterNames(graph, world, journal, records));
    if (joined.length)
        throw new RpcError('invalid_params', sharedNotice([], joined), { fix: SHARED_FIX, details: { reason: 'untold_name', field: 'object.document.text', joined } });
}
