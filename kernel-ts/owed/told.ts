/**
 * Contract §190.2: the ledger follows the told position.
 *
 * After a delivery the host reads where the delivered text leaves the party (a Jev lane over places this module
 * enumerates, `table.owe.options`) and, when the read clears its bars, names the place through `table.owe`. The kernel
 * projects it as §158.3 projects a review's owed move: the quote is anchored in what that turn delivered, the place must
 * be a graph scene, and the row goes onto the turn record and into `owed.json` with its `owed_state` warning; a newer
 * owed move supersedes an older one. §158.4's clerk lands it first on the next run.
 *
 * Nothing here reads prose. The place and the sentence come from the host's structured answer; the kernel checks that
 * the sentence is in the delivered text, that the place exists, and that the ledger still lacks it.
 */
import type { KernelContext } from '../context.js';
import { RpcError } from '../errors.js';
import type { LoadedModule } from '../read/campaign.js';
import { sceneLabel } from '../read/capsule.js';
import { locateExcerpt } from '../read/excerpt.js';
import { currentHandle, type ModuleGraph } from '../read/module-graph.js';
import type { BriefWindow } from '../read/brief-window.js';
import { array, chars, integer, number, row, string, truth, words, type Row } from '../read/values.js';
import type { CampaignWriter } from '../write/store.js';
import { nowIso } from '../write/store.js';
import { stripMarkers } from '../write/text.js';
import { closeSatisfied, describe, mergeOwed, owedNames, owedSatisfied, readOwed, resolveOwedEquipment, sceneOf, writeOwed } from './index.js';

/** The one source `table.owe` takes (closed). */
export const TOLD_SOURCE = 'told-position';
/** The most candidates `table.owe.options` lists, and its default (`told_position.max_candidates` overrides it per call). */
export const TOLD_OPTIONS_LIMIT = Object.freeze({ max: 64, fallback: 24 });

/**
 * The move receipts that moved the party: neither an owed landing (§158.5, the position an earlier delivery told) nor a
 * rename (a move to where the party stands). §190.2's "a move receipt landed" and `table.owe`'s `superseded` read this.
 */
export function partyMoves(receipts: unknown): Row[] {
    return array(receipts).map(row).filter(receipt => receipt.kind === 'move' && !truth(receipt.renamed) && typeof receipt.owed !== 'string');
}

/** A delivery record: the turn closed by `narrate` or `ask`. */
async function deliveryRecord(campaign: CampaignWriter, turn: unknown): Promise<Row> {
    if (!integer(turn) || number(turn) < 0)
        throw new RpcError('invalid_params', 'params.turn must be a committed turn number', { details: { field: 'turn' } });
    const record = await campaign.readTurnRecord(number(turn));
    if (!record || !['narrate', 'ask'].includes(string(record.closed_by)))
        throw new RpcError('invalid_params', `turn ${turn} has no delivery record to read the told position of`, { details: { turn: number(turn) } });
    return record;
}

/** The scene the delivered record holds (the ledger's position at delivery), else the active scene. */
function deliveredScene(graph: ModuleGraph, world: Row, record: Row): Row {
    const stored = string(row(row(record.world).scene).name);
    return sceneOf(graph, stored ? currentHandle(graph, stored) : '') ?? graph.scene(string(world.active_scene));
}

/** A place's 1-based pages: a ref's `pdf_index + 1` (§187.4's `citedPages`) or its `page` (a §190.1 identity's). */
function placePages(node: Row): number[] {
    return array(node.source_refs).map(row).flatMap(ref => integer(ref.pdf_index) ? [number(ref.pdf_index) + 1] : integer(ref.page) ? [number(ref.page)] : []);
}

/**
 * The places the delivered text may leave the party at, other than where it stood (§190.2's implementation decision):
 * its exits, the trail newest first, the place it lies in, the places this table established, then the book's scenes
 * citing a page of the reading window (every book scene without one). In that order, up to `limit`.
 */
export function toldCandidates(graph: ModuleGraph, world: Row, scene: Row, window: BriefWindow | null, limit: number): Row[] {
    const rows: Row[] = [], seen = new Set<string>([string(scene.node_id)]);
    const add = (node: Row | null | undefined, source: string) => {
        if (!node || rows.length >= limit || node.node_kind !== 'scene' || seen.has(string(node.node_id))) return;
        seen.add(string(node.node_id));
        const name = graph.handle(node), display = sceneLabel(graph, world, node);
        const aliases = [...new Set(array(node.aliases).filter(value => typeof value === 'string' && value.trim() && value !== display && value !== name).map(string))].slice(0, 6);
        rows.push({ name, ...(display !== name ? { display_name: display } : {}), ...(aliases.length ? { aliases } : {}),
            summary: chars(words(string(node.summary || graph.prose(node))), 160), source });
    };
    for (const exit of graph.sceneExits(scene)) add(graph.find(string(exit.to), ['scene']), 'exit');
    for (const handle of [...array(world.scene_trail)].reverse()) add(graph.find(string(handle), ['scene']), 'back');
    for (const rel of graph.out.get(scene.node_id) ?? []) if (rel.relation_kind === 'located-in') add(graph.nodes.get(rel.to_node_id), 'within');
    for (const node of graph.kind('scene')) if (graph.isTableEntity(node)) add(node, 'table');
    for (const node of graph.kind('scene'))
        if (!graph.isTableEntity(node) && (!window || placePages(node).some(page => page >= window.first && page <= window.last))) add(node, 'window');
    return rows;
}

/** `table.owe.options`: the delivered scene, that turn's move receipts and the candidates (read-only). */
export async function toldOptions(loaded: { campaign: CampaignWriter; snapshot: { world: Row }; module: LoadedModule }, window: BriefWindow | null, params: Row): Promise<Row> {
    if (Object.keys(params).some(key => !['campaign', 'turn', 'limit'].includes(key)))
        throw new RpcError('invalid_params', 'Told-position options accept the bound campaign, the delivered turn and an optional limit');
    if (params.limit !== undefined && (!integer(params.limit) || number(params.limit) < 1 || number(params.limit) > TOLD_OPTIONS_LIMIT.max))
        throw new RpcError('invalid_params', `limit must be an integer from 1 to ${TOLD_OPTIONS_LIMIT.max}`);
    const { campaign, snapshot, module } = loaded, graph = module.graph, world = snapshot.world;
    const record = await deliveryRecord(campaign, params.turn), scene = deliveredScene(graph, world, record);
    const moved = array(record.receipts).map(row).filter(receipt => receipt.kind === 'move').map(receipt => ({ to: string(receipt.to),
        ...(typeof receipt.owed === 'string' ? { owed: receipt.owed } : {}), ...(truth(receipt.renamed) ? { renamed: true } : {}) }));
    return { version: 1, turn: number(params.turn),
        scene: { name: graph.handle(scene), display_name: sceneLabel(graph, world, scene), summary: chars(words(string(scene.summary || graph.prose(scene))), 300) },
        moved, candidates: toldCandidates(graph, world, scene, window, params.limit === undefined ? TOLD_OPTIONS_LIMIT.fallback : number(params.limit)), window };
}

/** Whether a move moved the party in a turn after `turn` (a later record, or the turn open now). */
async function movedSince(campaign: CampaignWriter, turn: number): Promise<boolean> {
    const current = await campaign.readTurn(), now = number(current.turn);
    if (now > turn && partyMoves(current.receipts).length) return true;
    for (let later = turn + 1; later <= now; later++)
        if (partyMoves((await campaign.readTurnRecord(later))?.receipts).length) return true;
    return false;
}

/**
 * `table.owe {campaign, turn, effect: {kind: "move", to}, quote, source: "told-position"}` -> `{turn, owed: name | null,
 * dropped?}`. A place the kernel cannot owe is an answer, never an error: the host's read was a reading, not a write the
 * Keeper must repair.
 */
export async function oweTold(context: KernelContext, loaded: { campaign: CampaignWriter; module: { graph: ModuleGraph } }, params: Row, fix: string): Promise<Row> {
    if (Object.keys(params).some(key => !['campaign', 'turn', 'effect', 'quote', 'source'].includes(key)))
        throw new RpcError('invalid_params', 'table.owe takes campaign, turn, effect, quote and source');
    if (params.source !== TOLD_SOURCE)
        throw new RpcError('invalid_params', `source must be ${TOLD_SOURCE}`, { details: { field: 'source' } });
    const effect = row(params.effect);
    if (effect.kind !== 'move' || typeof effect.to !== 'string' || !effect.to.trim() || Object.keys(effect).some(key => key !== 'kind' && key !== 'to'))
        throw new RpcError('invalid_params', 'effect must be {kind: "move", to: <place>}', { details: { field: 'effect' } });
    if (typeof params.quote !== 'string' || !params.quote.trim())
        throw new RpcError('invalid_params', 'quote must be the delivered sentence that tells where the party ends up', { details: { field: 'quote' } });
    const { campaign, module } = loaded, graph = module.graph, turn = number(params.turn);
    const record = await deliveryRecord(campaign, params.turn), rendered = string(record.rendered_text || '');
    const world = await campaign.readWorld(), party = await campaign.party();
    const dropped = (reason: string): Row => ({ turn, owed: null, dropped: reason });
    const quote = locateExcerpt(rendered, params.quote) ?? locateExcerpt(rendered, stripMarkers(params.quote));
    const scene = sceneOf(graph, effect.to.trim()), target = scene ? graph.handle(scene) : '';
    // The same read sent again answers the row it wrote.
    const again = array(record.owed).map(row).find(entry => entry.source === TOLD_SOURCE && entry.kind === 'move' && quote !== null
        && entry.quote === quote && row(entry.effect).to === target);
    if (again) return { turn, owed: string(again.name) };
    if (partyMoves(record.receipts).length) return dropped('move_landed');
    if (await movedSince(campaign, turn)) return dropped('superseded');
    if (!quote) return dropped('quote_not_delivered');
    if (!scene) return dropped('unknown_scene');
    const delivered = deliveredScene(graph, world, record);
    if (target === graph.handle(delivered)) return dropped('same_scene');
    const exit = graph.sceneExits(delivered).find(entry => entry.to === target);
    const minutes = exit && integer(exit.travel_minutes) && number(exit.travel_minutes) >= 0 ? number(exit.travel_minutes) : 0;
    const owedEffect: Row = { kind: 'move', to: target, via: `Told in the delivery of turn ${turn}.`, travel_minutes: minutes };
    let ledger = resolveOwedEquipment(await readOwed(context, campaign.id), party);
    const taken = new Set([...owedNames(ledger), ...array(record.owed).map(entry => string(row(entry).name))]);
    let index = 1;
    while (taken.has(`t${turn}-owed-${index}`)) index++;
    const at = nowIso();
    const entry: Row = { name: `t${turn}-owed-${index}`, turn, kind: 'move', effect: owedEffect, quote, what: describe(graph, owedEffect), source: TOLD_SOURCE, at };
    if (owedSatisfied(graph, world, entry, party)) return dropped('satisfied');
    ledger = closeSatisfied(graph, world, mergeOwed(ledger, [entry], at), at, party).ledger;
    await writeOwed(context, campaign.id, ledger);
    record.owed = [...array(record.owed), entry];
    record.warnings = [...array(record.warnings), { lane: TOLD_SOURCE, kind: 'owed_state', quote: chars(quote, 120), why: chars(string(entry.what), 200),
        owed: entry.name, fix, at }];
    await campaign.writeTurnRecord(record);
    return { turn, owed: string(entry.name) };
}
