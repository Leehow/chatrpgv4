/**
 * Contract §176.3: the epithet lane's two methods. `epithets.job` lists the book people still untold and without a word,
 * with what a stranger sees of them; `epithets.submit` checks each word on its own and writes the accepted ones to the
 * lane's file. The world takes them at the next safe moment (`foldPersonWords`, §176.1).
 *
 * Both answer while the campaign is `setting_up`, as well as at a table: character creation takes minutes, and the opening is
 * where the investigator first meets everyone, so the words are wanted before it.
 */
import { createHash } from 'node:crypto';
import type { KernelContext } from '../context.js';
import { RpcError } from '../errors.js';
import type { HandlerGroup } from '../handlers.js';
import { CampaignSnapshot, loadCampaignModule } from '../read/campaign.js';
import { playLanguageOf } from '../read/languages.js';
import type { ModuleGraph } from '../read/module-graph.js';
import { npcsPresent } from '../read/capsule.js';
import { EPITHETS_PER_JOB, WORD_LIMIT, readEpithets, submitEpithets, tableWord, untoldBookPeople, wordsInUse } from '../read/person-words.js';
import { personAppearance } from '../first-sight/index.js';
import { bookCast, moduleSourceSha, tellGuard, untoldUnread } from '../read/cast.js';
import { castPages, unreadEntry } from '../cast/entry.js';
import { prepareNameHistory } from '../journal/name-history.js';
import { array, repr, row, string, type Row } from '../read/values.js';

const text = (value: unknown): string => typeof value === 'string' ? value : '';
import type { createWriteRuntime } from '../write/index.js';

const STATUSES: readonly string[] = ['setting_up', 'ready_for_table', 'active'];

/** The lane's instruction (§176.3), in the system language; the word itself is written in the play language it names. */
export function epithetInstruction(language: string): string {
    return [
        `Give each person below the word this table will call them by until someone says their name, written in the play language ${language}.`,
        'It names who they are (the owner, the trucker, the cook, the old soldier) together with the one visible thing only they have here -- something they carry or wear, a mark, a habit -- joined the way a person would say it aloud, like a nickname: \'the owner with the oily rag\', \'the bad-teeth trucker\'. Never a run of nouns with nothing joining them, never without who they are, and never a sentence.',
        'The word is what an investigator would see of them, or be told about them, on first meeting (looks, trade, role); never a secret, a motive, a cause, what happens to them, or anything the book reveals later.',
        'Each person\'s looks is about that person alone; take nothing from anyone else.',
        'No name, nickname or part of a name of anyone; never age, height, build or sex alone; no word listed under taken, and no word you give another person here.',
        'Each word must tell this person from everyone else at the table.',
    ].join(' ');
}

export function createEpithetHandlers(context: KernelContext, writer: ReturnType<typeof createWriteRuntime>): HandlerGroup {
    async function load(params: Row): Promise<{ campaign: any; meta: Row; world: Row; graph: ModuleGraph | null; moduleMeta: Row; journal: Row; records: Row[] }> {
        const campaign = await writer.campaign(params), meta = await campaign.readCampaign();
        if (!STATUSES.includes(string(meta.status)))
            throw new RpcError('campaign_not_ready', `campaign ${repr(campaign.id)} is ${repr(meta.status)}`, { details: { status: meta.status } });
        const world = await context.snapshots.pathExists(campaign.path('world.json')) ? await campaign.readWorld() : {};
        let graph: ModuleGraph | null = null, moduleMeta: Row = {};
        try { const loaded = await loadCampaignModule(context, string(meta.module_id), world, campaign.id); graph = loaded.graph; moduleMeta = row(loaded.meta); }
        catch { graph = null; }
        const snapshot = new CampaignSnapshot(context, campaign.id);
        const journal = row(await snapshot.optional('npc-journal.json')), records = await snapshot.files('turns');
        return { campaign, meta, world, graph, moduleMeta, journal, records };
    }
    return Object.freeze({
        'epithets.job': async (params): Promise<Row> => {
            const { campaign, meta, world, graph, moduleMeta, journal, records } = await load(params);
            // A module still being read has no graph yet; the next ask finds it.
            if (!graph) return { job_id: null, waiting: 'graph' };
            const stored = await readEpithets(campaign);
            const has = (id: string) => !!tableWord(world, id) || !!text(row(row(stored.people)[id]).word);
            const history = prepareNameHistory(records, tellGuard(graph, world, journal));
            // §192.3: a copy of someone is that person, shown by their word: the lane words the node that stands for them only.
            const wanting = untoldBookPeople(graph, journal, history).filter(node => !has(graph.handle(node)) && !graph.isVariant(node));
            // §177.5: the people the book names whom the reader has not reached are given a word too, after the graph's people,
            // so the request's rename can show them by it rather than by the cast row's id.
            const unread = untoldUnread(graph, history).filter(person => !has(person.id));
            if (!wanting.length && !unread.length) return { job_id: null };
            // Who is in the room first: the active scene's people, else the opening scene's, then the book's order.
            const sceneId = text(world.active_scene || meta.opening_scene || '');
            let first = new Set<string>();
            try { if (sceneId) first = new Set(npcsPresent(graph, world, graph.scene(sceneId)).filter(node => graph.isPerson(node)).map(node => graph.handle(node))); }
            catch { first = new Set(); }
            const ordered = [...wanting.filter(node => first.has(graph.handle(node))), ...wanting.filter(node => !first.has(graph.handle(node)))]
                .slice(0, EPITHETS_PER_JOB);
            const people: Row[] = ordered.map(node => {
                // §194.4: what a stranger sees (the first-sight description), else how they stand to the investigators; never the
                // node's summary, which is the Keeper's account of them (TR-F: the victim Pyotr Abramov was called "the creature that mutated two families").
                const role = text(graph.npcProfile(node).relationship_to_investigators).trim();
                const looks = (personAppearance(graph, node) ?? '').trim() || role;
                return { id: graph.handle(node), ...(role ? { role } : {}), ...(looks ? { looks } : {}) };
            });
            // An unread person has no record yet; what the lane sees of them is their own entry on the page that first names them
            // (§194.4), from their printed name to the next printed name of someone else of the cast or the paragraph's end.
            const reading = unread.slice(0, Math.max(0, EPITHETS_PER_JOB - people.length));
            if (reading.length) {
                const pages = await castPages(context, campaign.id, string(meta.module_id), moduleSourceSha(moduleMeta)), cast = bookCast(graph);
                for (const person of reading) {
                    const looks = await unreadEntry(graph, cast, person, pages);
                    people.push({ id: person.id, ...(looks ? { looks } : {}) });
                }
            }
            const language = await playLanguageOf(context, meta);
            const job_id = `epithets:${campaign.id}:${createHash('sha256').update(people.map(person => person.id).join('\n')).digest('hex').slice(0, 12)}`;
            return { job_id, play_language: language, people, taken: wordsInUse(world, journal, stored, graph), budget: { max_chars: WORD_LIMIT },
                instruction: epithetInstruction(language) };
        },
        'epithets.submit': async (params): Promise<Row> => {
            const { campaign, world, graph, journal, records } = await load(params);
            if (!graph)
                throw new RpcError('campaign_not_ready', `campaign ${repr(campaign.id)} has no graph yet`, { fix: 'ask epithets.job again once the module is read' });
            if (!Array.isArray(params.entries))
                throw new RpcError('invalid_params', 'params.entries must be a list of {id, word}', { details: { field: 'entries' } });
            const result = await submitEpithets(campaign, graph, world, journal, records, params.entries);
            await campaign.telemetry({ lane: 'epithets', event: 'submitted', written: array(result.written).length, refused: array(result.refused).length });
            return result;
        },
    });
}
