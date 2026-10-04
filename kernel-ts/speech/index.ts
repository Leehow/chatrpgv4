/**
 * Contract §165: the NPC speech edit lane's two kernel RPCs, in the §12.8 lane style -- no `call_id`, no look at the
 * turn state, a result that lands by `turn` however late it comes.
 *
 * - `speech.job {campaign, turn}` hands the lane what it reads (§165.3, §165.9): the contributing package's words, the
 *   turn's player text and prose, its marked text and speech rows (the card was drawn from the same delivery), and one
 *   row per line the lane edits, with the speaker's mask when they are bound to a person. It writes nothing.
 * - `speech.edit {campaign, turn, lines, model}` lands an edit (§165.5.1) as the `speech_edit` overlay on the turn
 *   record. The delivered fields -- `text`, `rendered_text`, `marked_text`, `speech` -- are never rewritten: memory
 *   anchors, quote locators, span derivation and delivery digests all compare against them. A record that no longer
 *   carries the lines the edit was made from is `stale` and nothing is written.
 */
import type { KernelContext } from '../context.js';
import type { HandlerGroup } from '../handlers.js';
import { RpcError } from '../errors.js';
import { isJsonObject } from '../json.js';
import { loadCampaignModule } from '../read/campaign.js';
import { voiceMaskOf } from '../read/capsule.js';
import { activeMods, readModCatalog } from '../read/mods.js';
import { array, integer, number, row, string, type Row } from '../read/values.js';
import { createWriteRuntime } from '../write/index.js';
import { nowIso } from '../write/store.js';
import { speechEditLaneOwners } from './lane.js';

/** Shape bounds only: a line is a spoken line of one delivery, and a model label is `provider/id`. */
const LINE_LIMIT = 4000;
const MODEL_LIMIT = 200;

function committedTurn(value: unknown): number {
    if (!integer(value) || number(value) < 0)
        throw new RpcError('invalid_params', 'params.turn must be a committed turn number');
    return number(value);
}
/** The delivery the lane works from: a narrate record that carries its marked text. Anything else is not editable. */
const editable = (record: Row | null): record is Row => !!record && record.closed_by === 'narrate' && typeof record.marked_text === 'string';
/**
 * §165.3 as amended 2026-10-01: the lane edits every line not spoken by the investigator -- an NPC bound to a handle
 * (`who.npc`), or one the table knows only by a label (`who.label`, an NPC not yet named). Which `who` key is present
 * decides; a label's words are never read. Whether a labelled line is written rather than spoken is the lane model's
 * call under the package's own rule.
 */
const filled = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0;
const otherSpeaker = (line: unknown): boolean => {
    const who = row(row(line).who);
    return who.investigator === undefined && (filled(who.npc) || filled(who.label));
};

/** §165.5.1: the closed shape of `lines`; every refusal names the row. */
function editedLines(value: unknown): Array<{ index: number; original: string; edited: string }> {
    if (!Array.isArray(value) || !value.length)
        throw new RpcError('invalid_params', 'params.lines must be a non-empty list of {index, original, edited}');
    const seen = new Set<number>();
    return value.map((entry, at) => {
        const line = isJsonObject(entry) ? entry as Row : undefined;
        if (!line || Object.keys(line).some(key => !['index', 'original', 'edited'].includes(key)) || !integer(line.index) || number(line.index) < 0)
            throw new RpcError('invalid_params', `lines[${at}] must be {index, original, edited} with index a speech row number`, { details: { index: at } });
        const index = number(line.index);
        if (seen.has(index))
            throw new RpcError('invalid_params', `lines[${at}] names speech row ${index} twice`, { details: { index: at } });
        seen.add(index);
        for (const key of ['original', 'edited'] as const)
            if (typeof line[key] !== 'string' || !line[key].trim() || line[key].length > LINE_LIMIT)
                throw new RpcError('invalid_params', `lines[${at}].${key} must be a non-empty line`, { details: { index: at } });
        if (line.edited.includes('{{') || line.edited.includes('}}'))
            throw new RpcError('invalid_params', `lines[${at}].edited carries marker syntax`, { fix: 'an edited line is spoken words only, no {{ or }}', details: { index: at } });
        return { index, original: line.original as string, edited: line.edited as string };
    }).sort((a, b) => a.index - b.index);
}

export function createSpeechHandlers(context: KernelContext, writer: ReturnType<typeof createWriteRuntime>): HandlerGroup {
    return Object.freeze({
        'speech.job': async (params): Promise<Row> => {
            const turn = committedTurn(params.turn), campaign = await writer.campaign(params);
            const record = await campaign.readTurnRecord(turn);
            if (!record || record.closed_by !== 'narrate')
                return { turn, lane: null, reason: 'no_record' };
            const speech = array(record.speech);
            const rows = speech.flatMap((line, index) => otherSpeaker(line) ? [{ index, line: row(line) }] : []);
            if (!rows.length)
                return { turn, lane: null, reason: 'no_npc_lines' };
            if (!editable(record))
                return { turn, lane: null, reason: 'no_record' };
            const world = await campaign.readWorld(), owners = speechEditLaneOwners(await activeMods(context, world, await readModCatalog(context)));
            if (!owners.length)
                return { turn, lane: null, reason: 'none' };
            if (owners.length > 1)
                return { turn, lane: null, reason: 'conflict', contributors: owners.map(({ mod, version }) => ({ mod, version })) };
            const meta = await campaign.readCampaign(), graph = (await loadCampaignModule(context, string(meta.module_id), world, campaign.id)).graph;
            const [owner] = owners;
            return {
                turn,
                lane: { mod: owner.mod, version: owner.version },
                instruction: owner.text,
                player_text: typeof record.player_text === 'string' ? record.player_text : '',
                rendered_text: string(record.rendered_text ?? ''),
                marked_text: record.marked_text,
                speech,
                lines: rows.map(({ index, line }) => {
                    // A label row's speaker is the label, and nobody's dossier is theirs yet, so it carries no mask.
                    // §180.3: a speaker is a person; a row written before creatures were told apart may name one, and it has no mask.
                    const who = row(line.who), node = filled(who.npc) ? graph.find(string(who.npc), ['npc']) : null;
                    const mask = node ? voiceMaskOf(graph, world, node) : undefined;
                    return { index, speaker: filled(who.npc) ? string(who.name || who.npc) : string(who.label), ...(mask ? { voice_mask: mask } : {}), text: string(line.text) };
                }),
            };
        },
        'speech.edit': async (params): Promise<Row> => {
            const turn = committedTurn(params.turn), lines = editedLines(params.lines);
            if (typeof params.model !== 'string' || !params.model.trim() || params.model.length > MODEL_LIMIT)
                throw new RpcError('invalid_params', 'params.model must name the model the edit came from');
            const campaign = await writer.campaign(params), record = await campaign.readTurnRecord(turn);
            // Rolled back, forked, replaced or re-delivered: the lines this edit was made from are not this record's.
            if (!editable(record))
                return { ok: false, reason: 'stale' };
            const speech = array(record.speech);
            if (lines.some(line => speech[line.index] === undefined || string(row(speech[line.index]).text) !== line.original))
                return { ok: false, reason: 'stale' };
            const investigator = lines.find(line => !otherSpeaker(speech[line.index]));
            if (investigator)
                throw new RpcError('invalid_params', `speech row ${investigator.index} is not a line the lane edits`, {
                    fix: 'only NPC and labelled lines are edited; investigator rows are never sent', details: { index: investigator.index } });
            const model = params.model.trim(), prior = row(record.speech_edit);
            if (prior.model === model && JSON.stringify(prior.lines) === JSON.stringify(lines))
                return { ok: true, turn, replayed: true };
            record.speech_edit = { lines, model, at: nowIso() };
            await campaign.writeTurnRecord(record);
            return { ok: true, turn };
        },
    });
}
