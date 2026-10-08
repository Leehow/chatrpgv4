/**
 * Contract §194.3: a document in the player's hands tells the names it prints.
 *
 * Real table TR-F (Cold Harvest): the player held handout #2, the denunciation letter, which prints its writer's name and the
 * accused man's. Both stayed untold, so the Keeper, holding no name for either, told the player the letter bore none.
 *
 * When a delivery (`table.narrate`, or `table.ask`) closes a turn whose receipts hand the player a handout, and the kernel knows
 * that document's text, every untold cast person one of whose printed names stands in the text is told at that delivery,
 * through the path `{{name:}}` uses: the record says who (`told_documents`, which `toldTurn` and `castToldTurn` read), and a graph
 * person's table word becomes the book's name (`person_labels`), as at an introduction.
 *
 * The places are found as §177.15 finds them in prose (`prosePlaces`, the investigator's side's names guarded), and the host
 * asks Jev about each as it asks about the prose's (`table.untold_spans` returns them under `documents`): a place cleared as
 * part of another word (`untold_cleared` with the handout's handle) tells nobody, so the letter's Dallas never tells the station
 * owner. A name two untold people share names neither for certain and tells nobody (§188.8). Strings only: nothing here reads
 * what a word means.
 *
 * The document's text (§194.3's record in the contract):
 * - a text handout: the file `apply handout` wrote (`<campaign>/handouts/<handle>.md`, its heading and body: what the card shows);
 * - a pictured handout the player holds (its image delivered): the words the page transcript read off the pictures of the page
 *   its image is cut from (§191.3 `image_text`), when no other node of the graph is pictured on that page, so the words are
 *   this document's;
 * - nothing else: a handout with no known text tells nothing. The §155 reading is the player's model translation, kept by the
 *   host and never shown to the Keeper or the graph, and its names follow no cast form; a source page's body text is the
 *   Keeper's book around the document, not the document.
 */
import type { KernelContext } from '../context.js';
import { readFile } from 'node:fs/promises';
import type { ModuleGraph } from '../read/module-graph.js';
import { bookCast, knownNamePieces, moduleSourceSha, printedNames, untoldUnread, type CastPerson } from '../read/cast.js';
import { untoldBookPeople } from '../read/person-words.js';
import { pageTranscript } from '../read/page-transcripts.js';
import { isJsonObject } from '../json.js';
import { array, normalize, row, string, type Row } from '../read/values.js';
import type { NameHistory } from '../journal/name-history.js';
import { placeKey, prosePlaces, type ProsePlace } from './names.js';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/** One document a delivery hands over, by its receipt's handle, with the text the kernel knows of it. */
export interface DeliveredDocument { handout: string; text: string }

/** The key `untold_cleared` names a document's place by: the handout's handle beside §177.15's key. */
export const documentPlaceKey = (handout: string, place: { name: string; nth: number }): string => `document:${handout}|${placeKey(place)}`;

/** The first page (1-based) a node's picture is cut from, or null. */
const picturedPage = (node: Row): number | null => {
    for (const source of array(row(node.properties).image_sources)) {
        const page = row(source).page;
        if (Number.isSafeInteger(page) && Number(page) >= 1) return Number(page);
    }
    return null;
};

/** The documents `receipts` hand the player, once each, with their known text; a handout with none is left out. */
export async function deliveredDocuments(context: Pick<KernelContext, 'content' | 'stateRoot' | 'snapshots'>, graph: ModuleGraph, meta: Row,
    receipts: readonly Row[]): Promise<DeliveredDocument[]> {
    const out: DeliveredDocument[] = [], seen = new Set<string>();
    for (const receipt of receipts) {
        if (receipt?.kind !== 'handout' || typeof receipt.handout !== 'string' || !receipt.handout || seen.has(receipt.handout)) continue;
        seen.add(receipt.handout);
        const attachment = row(receipt.attachment);
        if (attachment.available !== true) continue;
        if (typeof attachment.media_type === 'string' && attachment.media_type.startsWith('text/') && typeof attachment.path === 'string' && attachment.path) {
            try {
                const text = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(attachment.path));
                if (text.trim()) out.push({ handout: receipt.handout, text });
            } catch { /* unreadable: a document the kernel cannot read tells nothing */ }
            continue;
        }
        if (!IMAGE_TYPES.includes(string(attachment.image_media_type || attachment.media_type))) continue;
        const found = graph.find(receipt.handout, ['handout', 'asset']), node = found ? graph.survivorOf(found) : null, page = node ? picturedPage(node) : null;
        if (!node || page === null) continue;
        // The page's image text is this document's only when no other node is pictured on that page.
        const own = new Set(graph.groupOf(node).map(member => string(member.node_id)));
        own.add(string(node.node_id));
        if ([...graph.nodes.values()].some(other => !own.has(string(other.node_id)) && array(row(other.properties).image_sources).some(source => row(source).page === page)))
            continue;
        const transcript = await pageTranscript(context, moduleSourceSha(meta), page);
        const text = (transcript?.image_text ?? []).map(block => block.trim()).filter(Boolean).join('\n\n');
        if (text) out.push({ handout: receipt.handout, text });
    }
    return out;
}

/** One document's places of untold names, as `table.untold_spans` reports them and the delivery reads them. */
export interface DocumentPlaces { handout: string; text: string; places: ProsePlace[] }

/** The untold cast people and the names that stand for them, by normalized name, with what the told checks read for each. */
export interface UntoldNames { owners: Map<string, CastPerson[]>; names: string[] }

/**
 * Every untold cast person by each name that stands for them in the book's text (`printedNames`), normalized: who a place of
 * that name could be. A document's place (§194.3) and a name spoken in a line (§194.5) tell the one owner, and nobody when
 * several share it (§188.8).
 */
export function untoldOwners(graph: ModuleGraph, journal: Row, records: NameHistory): UntoldNames {
    const untold = new Set(untoldBookPeople(graph, journal, records).map(node => string(node.node_id)));
    const unread = new Set(untoldUnread(graph, records).map(person => person.id));
    const cast = bookCast(graph);
    const isUntold = (person: CastPerson) => person.node ? person.nodes.some(node => untold.has(string(node.node_id))) : unread.has(person.id);
    // A name a told person also carries tells nothing new (the roster's rule, §103.8), and a person this campaign added is the table's.
    const known = knownNamePieces(graph, cast.filter(person => !isUntold(person)));
    const owners = new Map<string, CastPerson[]>(), names: string[] = [];
    for (const person of cast.filter(person => isUntold(person) && !isJsonObject(person.node?.campaign_origin))) {
        for (const name of printedNames(graph, person)) {
            const key = normalize(name);
            if ([...name].length < 2 || !key || known.has(key)) continue;
            const list = owners.get(key) ?? [];
            if (!list.includes(person)) list.push(person);
            if (!owners.has(key)) names.push(name);
            owners.set(key, list);
        }
    }
    return { owners, names };
}

/** §194.3: where each document prints an untold person's name, outside every occurrence of a name the investigator's side owns. */
export function documentPlaces(graph: ModuleGraph, journal: Row, records: NameHistory, documents: readonly DeliveredDocument[], guarded: readonly string[]): DocumentPlaces[] {
    if (!documents.length) return [];
    const { names } = untoldOwners(graph, journal, records);
    if (!names.length) return [];
    return documents.flatMap(document => {
        const places = prosePlaces(document.text, names, guarded);
        return places.length ? [{ handout: document.handout, text: document.text, places }] : [];
    });
}

/**
 * What a delivery's documents tell: the record's rows -- each person by identity (`people`: a graph person's handle, someone
 * unread by their cast row's id), which `toldTurn` and `castToldTurn` read, and the names as printed (`names`, evidence) -- and
 * the graph people whose word becomes their name.
 */
export interface DocumentTold { record: Array<{ handout: string; people: string[]; names: string[] }>; introduced: Row[]; told: number; cleared: number; places: number }

/** §194.3: who the documents tell, given the host's cleared places. A place tells its one owner. */
export function documentTold(graph: ModuleGraph, journal: Row, records: NameHistory, documents: readonly DeliveredDocument[], guarded: readonly string[],
    cleared: ReadonlySet<string>): DocumentTold {
    const result: DocumentTold = { record: [], introduced: [], told: 0, cleared: 0, places: 0 };
    if (!documents.length) return result;
    const { owners } = untoldOwners(graph, journal, records), seen = new Set<CastPerson>();
    for (const { handout, places } of documentPlaces(graph, journal, records, documents, guarded)) {
        const people: string[] = [], names: string[] = [];
        for (const place of places) {
            result.places += 1;
            if (cleared.has(documentPlaceKey(handout, place))) { result.cleared += 1; continue; }
            const of = owners.get(normalize(place.name)) ?? [];
            if (of.length !== 1 || seen.has(of[0]!)) continue;
            const person = of[0]!;
            seen.add(person);
            people.push(person.node ? graph.handle(person.node) : person.id);
            names.push(place.name);
            if (person.node) result.introduced.push(person.node);
        }
        if (people.length) result.record.push({ handout, people, names });
    }
    result.told = seen.size;
    return result;
}
