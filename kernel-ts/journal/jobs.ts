/** Player-side NPC journal: closed job packets and a deterministic merge; no model calls here. */
import { join } from 'node:path';
import { RpcError } from '../errors.js';
import { isJsonObject, jsonDigest } from '../json.js';
import { appendJsonl } from '../fileio.js';
import { CampaignWriter, nowIso } from '../write/store.js';
import { ModuleGraph } from '../read/module-graph.js';
import { personRecord, sceneLabel } from '../read/capsule.js';
import { occurs, nameWords, toldTurn } from './naming.js';
import { array, row, clone, string, number, integer, truth, repr, sorted, length, normalize, type Row } from '../read/values.js';
import { FAILURE_REASONS, committedRecords, logs, proseOf, writeLines } from '../memory/jobs.js';
export const BUDGET = { max_entries: 6, max_description_chars: 300, max_exchange_chars: 200, max_label_chars: 60 };
const FIELDS = ['name', 'description', 'exchange', 'label', 'named'];
const MACHINE = ['commit', 'receipt', 'receipts', 'turn', 'id', 'job_id', 'episode_id', 'call_id', 'source'];
export const jobId = (campaign: string, turn: number) => `journal:${campaign}:t${turn}`;
/** The fixed English instruction; entry prose itself is written by the lane in the campaign's play language. */
const instruction = (language: string) => 'Write an entry only for someone who truly appeared in this turn\'s narrative: they spoke, acted, or were ' +
    'interacted with. Take every name from recordable exactly as given. A description says only what the player can ' +
    'perceive: who this person is, how they look, what they said and did -- never motives, secrets, or keeper-only ' +
    'material. An exchange is one sentence on what passed between this person and the player this turn. When prior ' +
    'already holds a description and this turn added nothing new about who they are, give only the exchange; do not ' +
    `restate the description. Write every word in the campaign's play language (${language}). Never write ids, turn ` +
    'numbers, receipts or any machine key. Names listed under unnamed belong to people the player has not been told ' +
    'the name of: the prose has only described them. For such a person give label, a short phrase in the play language ' +
    'saying how the player would know them from what was shown (looks, role, where they were), carrying no part of the ' +
    "name; the description and the exchange must not name them either. If this turn's narrative actually gave the " +
    "player this person's name, in any spelling, give named: true instead of a label. Someone not listed under " +
    'unnamed takes neither.';
/** The ledger's naming rule: journal keys are graph node ids, never names. */
function npcNode(graph: ModuleGraph, value: any): Row | null {
    if (typeof value !== 'string' || !value.trim())
        return null;
    const node = graph.nodes.get(value) || graph.find(value, ['npc']);
    return node?.node_kind === 'npc' ? node : null;
}
export async function readJournal(campaign: CampaignWriter): Promise<Row> {
    try {
        const value = await campaign.read('npc-journal.json');
        return { schema: 1, entries: row(value.entries) };
    }
    catch {
        return { schema: 1, entries: {} };
    }
}
export function parseJobId(campaign: CampaignWriter, value: any): number {
    const found = typeof value === 'string' ? /^journal:([A-Za-z0-9][A-Za-z0-9._-]{0,63}):t(\d+)$/.exec(value) : null;
    if (!found || found[1] !== campaign.id)
        throw new RpcError('invalid_params', 'job_id must be the journal:<campaign>:t<n> that journal.job returned', { details: { job_id: value ?? null } });
    return Number(found[2]);
}
export async function readJob(campaign: CampaignWriter, id: string): Promise<Row | null> {
    try {
        const value = await campaign.context.snapshots.readJson(campaign.path(join('npc-journal/jobs', id + '.json')));
        return isJsonObject(value) ? clone(value) : null;
    }
    catch {
        return null;
    }
}
const writeJob = (campaign: CampaignWriter, value: Row) => campaign.write(join('npc-journal/jobs', value.job_id + '.json'), value);
export async function defaultJobTurn(campaign: CampaignWriter): Promise<number | null> {
    const skip = new Set((await logs(campaign, 'npc-journal/backlog.jsonl')).filter(value => value.status === 'pending' && (integer(value.turn) || typeof value.turn === 'boolean')).map(value => number(value.turn)));
    for (const turn of [...(await committedRecords(campaign)).keys()].sort((a, b) => b - a)) {
        if (skip.has(turn))
            continue;
        if ((await readJob(campaign, jobId(campaign.id, turn)))?.status === 'done')
            continue;
        return turn;
    }
    return null;
}
/** The deterministic recordable set: present in the turn's world snapshot, referenced by the turn's receipts
 *  (clue.from, roll interactions, npc receipts), or already named in the journal. Graph-only NPCs never enter. */
function collectNamed(graph: ModuleGraph, record: Row, entries: Row): Array<[string, string]> {
    const named: Array<[string, string]> = [], seen = new Set<string>();
    const add = (node: Row | null) => {
        if (!node)
            return;
        const key = `${node.node_id} ${graph.displayName(node)}`;
        if (seen.has(key))
            return;
        seen.add(key);
        named.push([graph.displayName(node), string(node.node_id)]);
    };
    for (const name of array(row(record.world).present))
        add(npcNode(graph, name));
    // A resolved say span is a person who spoke (contract §40.3); the handle resolves through find.
    for (const line of array(record.speech))
        add(npcNode(graph, row(row(line).who).npc));
    for (const receipt of array(record.receipts)) {
        if (receipt.kind === 'clue')
            add(npcNode(graph, receipt.from));
        else if (receipt.kind === 'npc')
            add(npcNode(graph, receipt.npc) || npcNode(graph, receipt.handle));
        else if (receipt.kind === 'roll') {
            add(npcNode(graph, receipt.npc));
            add(npcNode(graph, receipt.actor));
        }
    }
    for (const [id, value] of Object.entries(entries)) {
        const name = string(row(value).name).trim();
        if (name)
            named.push([name, id]);
    }
    return named;
}
export async function buildJob(campaign: CampaignWriter, graph: ModuleGraph, language: string, turn: number, party: Row[], world: Row): Promise<Row> {
    const committed = await committedRecords(campaign), record = committed.get(turn);
    if (!record)
        throw new RpcError('invalid_params', `turn ${turn} has no committed record`, { fix: 'only turns closed by narrate have journal jobs', details: { turn, committed_turns: [...committed.keys()].sort((a, b) => a - b) } });
    const snapshot = row(record.world), scene = graph.scene(string(row(snapshot.scene).name || world.active_scene));
    const display = sceneLabel(graph, world, scene);
    const journal = await readJournal(campaign), named = collectNamed(graph, record, journal.entries);
    const recordable = sorted(new Set(named.map(([name]) => name)));
    // §103: who the records have shown the player a name for, by turn -- the deterministic floor the lane's `named` sits on.
    const told: Row = {}, words: Row = {};
    for (const [, id] of named) {
        const node = graph.nodes.get(id);
        if (!node || words[id] !== undefined)
            continue;
        words[id] = nameWords(graph, node);
        const at = toldTurn(graph, node, committed.values(), turn);
        if (at != null)
            told[id] = at;
    }
    const isNamed = (id: string) => integer(row(journal.entries[id]).named_at) || told[id] !== undefined;
    const unnamed = sorted(new Set(named.filter(([, id]) => !isNamed(id)).map(([name]) => name)));
    const prior: Row[] = [], namedPrior = new Set<string>();
    for (const [name, id] of named) {
        if (namedPrior.has(name) || !isJsonObject(journal.entries[id]))
            continue;
        namedPrior.add(name);
        const stored = row(journal.entries[id]), node = graph.nodes.get(id);
        const label = string((node ? personRecord(world, graph.handle(node)).name : '') || stored.label || '').trim();
        prior.push({ name, ...(label && !isNamed(id) ? { label } : {}), description: string(stored.description), last_seen_turn: number(stored.last_seen_turn) });
    }
    const present = array(snapshot.present).map(name => npcNode(graph, name)).filter(truth) as Row[];
    return { job_id: jobId(campaign.id, turn), turn, commit: record.commit ?? null,
        scene: { name: graph.handle(scene), display_name: display },
        present: present.map(node => graph.displayName(node)),
        investigators: party.map(sheet => ({ id: string(sheet.id), name: string(sheet.name) })),
        player_text: record.player_text ?? null, keeper_text: proseOf(record.rendered_text),
        speech: array(record.speech).flatMap(line => npcNode(graph, row(row(line).who).npc) ? [{ name: string(row(row(line).who).name), text: string(row(line).text) }] : []),
        recordable, unnamed, prior, budget: { ...BUDGET }, instruction: instruction(language), _named: named, _told: told, _words: words };
}
export async function openJob(campaign: CampaignWriter, packet: Row): Promise<Row> {
    const named = packet._named, told = packet._told, words = packet._words;
    delete packet._named;
    delete packet._told;
    delete packet._words;
    const existing = await readJob(campaign, packet.job_id);
    if (!existing || !['done', 'failed'].includes(existing.status))
        await writeJob(campaign, { job_id: packet.job_id, turn: packet.turn, commit: packet.commit, status: 'open', opened_at: nowIso(), packet, named, told, words });
    return packet;
}
function reject(index: number, message: string, fix: string, details: Row = {}): never {
    throw new RpcError('invalid_params', message, { fix, details: { index, ...details } });
}
type Validated = { id: string; name: string; description: string | null; exchange: string | null; label: string | null; named: boolean };
/** `stored` is the journal's entries: whether a person already has a row decides whether a label is owed (§103). */
function validateEntries(job: Row, entries: any, stored: Row): Validated[] {
    if (!Array.isArray(entries))
        throw new RpcError('invalid_params', 'params.entries must be a list');
    if (entries.length > BUDGET.max_entries)
        throw new RpcError('invalid_params', `at most ${BUDGET.max_entries} entries per job`, { fix: 'keep the ones who mattered most this turn', details: { index: BUDGET.max_entries } });
    const named = array(job.named).map(pair => [string(array(pair)[0]), string(array(pair)[1])] as [string, string]);
    const recordable = sorted(new Set(named.map(([name]) => name)));
    // §103: named to the player by the journal's own record or by the records the job scanned; the closed `unnamed` list is the rest.
    // A batch is read in order: a row that named or labelled a person answers for the rows after it.
    const told = row(job.told), words = row(job.words), namedInBatch = new Set<string>(), rowsInBatch = new Set<string>();
    const isNamed = (id: string) => integer(row(stored[id]).named_at) || told[id] !== undefined || namedInBatch.has(id);
    const unnamed = sorted(new Set(named.filter(([, id]) => !isNamed(id)).map(([name]) => name)));
    const carries = (text: string, id: string) => array(words[id]).map(string).some(word => word && occurs(normalize(text), word));
    return entries.map((entry, i) => {
        if (!isJsonObject(entry))
            return reject(i, `entries[${i}] must be an object`, 'give a name from recordable, with a description and/or an exchange');
        const machine = sorted(Object.keys(entry).filter(key => MACHINE.includes(key))), unknown = sorted(Object.keys(entry).filter(key => !FIELDS.includes(key)));
        if (machine.length)
            return reject(i, `entries[${i}] carries machine keys ${repr(machine)}`, 'drop them; the kernel attaches turn, scene and job itself', { fields: machine });
        if (unknown.length)
            return reject(i, `entries[${i}] has unknown fields ${repr(unknown)}`, `allowed fields: ${sorted(FIELDS).join(', ')}`, { fields: unknown });
        const name = typeof entry.name === 'string' ? entry.name.trim() : '';
        if (!name)
            return reject(i, `entries[${i}].name must be a name from recordable`, `use one of: ${recordable.join(', ')}`, { field: 'name' });
        const ids = [...new Set(named.filter(([candidate]) => candidate === name).map(([, id]) => id))];
        if (!ids.length)
            return reject(i, `entries[${i}].name ${repr(name)} is not recordable this turn`, `use one of: ${recordable.join(', ')}`, { field: 'name', name, recordable });
        if (ids.length > 1)
            return reject(i, `entries[${i}].name ${repr(name)} names ${ids.length} different people`, `recordable is the closed set: ${recordable.join(', ')}`, { field: 'name', name, recordable });
        const description = entry.description ?? null, exchange = entry.exchange ?? null;
        if (description !== null && (typeof description !== 'string' || length(description.trim()) < 1 || length(description.trim()) > BUDGET.max_description_chars))
            return reject(i, `entries[${i}].description must be 1–${BUDGET.max_description_chars} characters`, 'shorten it, or omit it to keep the stored one');
        if (exchange !== null && (typeof exchange !== 'string' || length(exchange.trim()) < 1 || length(exchange.trim()) > BUDGET.max_exchange_chars))
            return reject(i, `entries[${i}].exchange must be 1–${BUDGET.max_exchange_chars} characters`, 'one sentence on what passed between them and the player this turn');
        const id = ids[0], label = entry.label ?? null, namedNow = entry.named ?? null;
        if (namedNow !== null && namedNow !== true)
            return reject(i, `entries[${i}].named must be true or absent`, "give named: true only when this turn's narrative gave the player this person's name; otherwise leave it out", { field: 'named' });
        if (label !== null) {
            if (typeof label !== 'string' || length(label.trim()) < 1 || length(label.trim()) > BUDGET.max_label_chars || label.includes('\n') || label.includes('{{'))
                return reject(i, `entries[${i}].label must be a single line of 1–${BUDGET.max_label_chars} characters`, 'a short phrase saying how the player would know this person from what was shown', { field: 'label' });
            if (isNamed(id))
                return reject(i, `entries[${i}].label: ${repr(name)} has been named to the player already`, `give label only for a name listed under unnamed: ${unnamed.join(', ') || '(none)'}`, { field: 'label', name, unnamed });
            if (carries(label, id))
                return reject(i, `entries[${i}].label carries the name ${repr(name)}`, 'a label says how the player would know them and never names them', { field: 'label', name });
        }
        if (!isNamed(id) && namedNow !== true) {
            for (const [field, text] of [['description', description], ['exchange', exchange]] as Array<[string, any]>)
                if (typeof text === 'string' && carries(text, id))
                    return reject(i, `entries[${i}].${field} names ${repr(name)}, whom the player has not been told the name of`, "write it without the name, or give named: true if this turn's narrative gave the player the name", { field, name, unnamed });
            if (label === null && !isJsonObject(stored[id]) && !rowsInBatch.has(id))
                return reject(i, `entries[${i}]: ${repr(name)} has not been named to the player and has no label`, "give label (how the player would know them, carrying no part of the name), or named: true if this turn's narrative gave the player the name", { field: 'label', name, unnamed });
        }
        rowsInBatch.add(id);
        if (namedNow === true)
            namedInBatch.add(id);
        return { id, name, description: description === null ? null : string(description).trim(), exchange: exchange === null ? null : string(exchange).trim(), label: label === null ? null : string(label).trim(), named: namedNow === true };
    });
}
export async function appendBacklog(campaign: CampaignWriter, id: string, turn: number, reason: string, detail: any): Promise<Row> {
    const value = { job_id: id, turn, reason, detail: detail ?? null, at: nowIso(), status: 'pending' };
    await appendJsonl(campaign.path('npc-journal/backlog.jsonl'), value);
    return value;
}
async function recoverBacklog(campaign: CampaignWriter, id: string): Promise<void> {
    const rows = await logs(campaign, 'npc-journal/backlog.jsonl');
    let changed = false;
    for (const value of rows)
        if (value.job_id === id && value.status === 'pending') {
            value.status = 'recovered';
            value.recovered_at = nowIso();
            changed = true;
        }
    if (changed)
        await writeLines(campaign, 'npc-journal/backlog.jsonl', rows);
}
export async function submit(campaign: CampaignWriter, job: Row, entries: any): Promise<[
    Row,
    boolean
]> {
    const id = string(job.job_id), turn = number(job.turn);
    const digest = jsonDigest(entries ?? null);
    if (job.status === 'done') {
        if (job.entries_sha256 === digest)
            return [clone(row(job.result)), true];
        throw new RpcError('idempotency_conflict', `job ${id} already completed with different entries`, { fix: 'a completed job is final; nothing to resubmit', details: { job_id: id } });
    }
    const journal = await readJournal(campaign);
    let validated: Validated[];
    try {
        validated = validateEntries(job, entries, journal.entries);
    }
    catch (error) {
        if (error instanceof RpcError && error.code === 'invalid_params')
            await appendBacklog(campaign, id, turn, 'invalid', error.message);
        throw error;
    }
    const scene = string(row(row(job.packet).scene).display_name), told = row(job.told);
    // §103: the turn the player was first shown a name, taken from the record whenever it has one -- also for a row
    // the lane wrote nothing new about this turn. The lane's `named` can only add a turn the record could not see.
    const nameAt = (stored: Row, at: number) => { if (!integer(stored.named_at) || number(stored.named_at) > at) stored.named_at = at; };
    for (const [id, at] of Object.entries(told))
        if (isJsonObject(journal.entries[id]) && integer(at))
            nameAt(row(journal.entries[id]), number(at));
    for (const entry of validated) {
        // First sight creates the entry already counted for this turn; later turns advance it, at most once per turn.
        const fresh = !isJsonObject(journal.entries[entry.id]);
        if (fresh)
            journal.entries[entry.id] = { name: entry.name, description: '', first_seen_turn: turn, last_seen_turn: turn, seen_count: 1, exchanges: [] };
        const stored = row(journal.entries[entry.id]);
        if (entry.label !== null)
            stored.label = entry.label;
        if (integer(told[entry.id]))
            nameAt(stored, number(told[entry.id]));
        if (entry.named)
            nameAt(stored, turn);
        if (entry.description !== null)
            stored.description = entry.description;
        if (!fresh && turn > number(stored.last_seen_turn)) {
            stored.last_seen_turn = turn;
            stored.seen_count = number(stored.seen_count) + 1;
        }
        if (entry.exchange !== null)
            stored.exchanges = [...array(stored.exchanges), { turn, scene, summary: entry.exchange }];
    }
    await campaign.write('npc-journal.json', journal);
    const result = { job_id: id, turn, entries: validated.length };
    await writeJob(campaign, { ...job, status: 'done', entries_sha256: digest, submitted: entries, result, completed_at: nowIso() });
    await recoverBacklog(campaign, id);
    return [result, false];
}
export async function fail(campaign: CampaignWriter, job: Row | null, id: string, turn: number, reason: any, detail: any): Promise<Row> {
    if (!FAILURE_REASONS.includes(reason))
        throw new RpcError('invalid_params', `reason ${repr(reason)} is not a failure reason`, { fix: `one of: ${FAILURE_REASONS.join(', ')}` });
    const value = await appendBacklog(campaign, id, turn, reason, detail);
    if (job && job.status !== 'done')
        await writeJob(campaign, { ...job, status: 'failed', failed_at: nowIso(), reason, detail: detail ?? null });
    return { job_id: id, turn, status: value.status, reason };
}
