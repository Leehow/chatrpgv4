/**
 * Contract §190.2: the ledger follows the told position. §201.1: and the clues the story told. §216.1: and the time it told.
 *
 * After a delivery the host reads where the delivered text leaves the party (a Jev lane over places this module
 * enumerates, `table.owe.options`) and, when the read clears its bars, names the place through `table.owe`. The kernel
 * projects it as §158.3 projects a review's owed move: the quote is anchored in what that turn delivered, the place must
 * be a graph scene, and the row goes onto the turn record and into `owed.json` with its `owed_state` warning; a newer
 * owed move supersedes an older one. §158.4's clerk lands it first on the next run.
 *
 * Nothing here reads prose. The place and the sentence come from the host's structured answer; the kernel checks that
 * the sentence is in the delivered text, that the place exists, and that the ledger still lacks it. A told clue (§201.1)
 * is projected the same way: the clue the host's read named must be the book's, the sentence must be delivered, and the
 * ledger must still lack the clue; §158.4's clerk lands it first on the next run. When the book finds that clue by a
 * check (§201.2) the row says so, and whether the told turn passed it.
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
import { closeSatisfied, clueOf, describe, mergeOwed, owedBands, owedNames, owedSatisfied, readOwed, resolveOwedEquipment, sceneOf, writeOwed } from './index.js';
import { bandRows } from '../rules/bands.js';
import { ROUTE_TRAVEL_ROWS } from '../modules/route-travel.js';
import { checkPassed, clueCheck } from '../read/clue-check.js';
import { containers, sceneOfPlace } from '../read/places.js';

/** The source `table.owe` takes for a move (closed). */
export const TOLD_SOURCE = 'told-position';
/** §201.1: the source `table.owe` takes for a clue (closed). Each source owes one kind. */
export const TOLD_CLUE_SOURCE = 'told-clue';
/** §216.1: the source `table.owe` takes for time (closed). */
export const TOLD_TIME_SOURCE = 'told-time';
/** The most candidates `table.owe.options` lists, and its default (`told_position.max_candidates` overrides it per call). */
export const TOLD_OPTIONS_LIMIT = Object.freeze({ max: 64, fallback: 24 });
/** §201.1: the most clues `table.owe.options` lists, and its default (`told_clue.max_candidates` overrides it per call). */
export const TOLD_CLUE_LIMIT = Object.freeze({ max: 64, fallback: 24 });

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
    // §204.7: the places it lies in, nearest first (§204.1), each as the scene it is walked to by.
    for (const place of containers(graph, scene)) add(sceneOfPlace(graph, place), 'within');
    for (const node of graph.kind('scene')) if (graph.isTableEntity(node)) add(node, 'table');
    for (const node of graph.kind('scene'))
        if (!graph.isTableEntity(node) && (!window || placePages(node).some(page => page >= window.first && page <= window.last))) add(node, 'window');
    return rows;
}

/**
 * §201.1: the book's clues a delivered text may have given that the ledger still lacks -- the clues of the delivered scene,
 * then of the scenes the party left during that turn, then of the trail newest first: the places the party has stood. A
 * clue the table has found, or that turn landed, is not one. In that order, up to `limit`. Each row says where the book
 * puts it (`scene`, `source`), how the book has it found (`delivery_kind`) and, when the book makes finding it a check of
 * a named skill, that check (§201.2).
 */
export function toldClueCandidates(graph: ModuleGraph, world: Row, scene: Row, record: Row, limit: number): Row[] {
    const rows: Row[] = [], seen = new Set<string>();
    const landed = new Set(array(record.receipts).map(row).filter(receipt => receipt.kind === 'clue').map(receipt => string(receipt.clue)));
    const add = (place: Row | null | undefined, source: string) => {
        if (!place || place.node_kind !== 'scene') return;
        for (const id of graph.sceneClueIds(place)) {
            if (rows.length >= limit) return;
            const node = graph.nodes.get(id);
            if (!node) continue;
            const handle = graph.handle(node);
            if (seen.has(handle) || landed.has(handle) || graph.discovered(world, node)) continue;
            seen.add(handle);
            const check = clueCheck(graph, node), delivery = graph.clueProfile(node).delivery_kind;
            rows.push({ name: handle, summary: chars(words(string(node.summary || node.name)), 300), scene: graph.handle(place), source,
                delivery_kind: typeof delivery === 'string' && delivery ? delivery : 'unknown', ...(check ? { check } : {}) });
        }
    };
    add(scene, 'here');
    const left = array(record.receipts).map(row).filter(receipt => receipt.kind === 'move' && !truth(receipt.renamed) && typeof receipt.from === 'string')
        .map(receipt => string(receipt.from)).reverse();
    for (const handle of left) add(graph.find(handle, ['scene']), 'left');
    for (const handle of [...array(world.scene_trail)].reverse()) add(graph.find(string(handle), ['scene']), 'back');
    return rows;
}

/**
 * §216.1: the told turn's own clock -- its `time` receipts (an owed landing says so) and whether a session was running at
 * delivery -- so the host's told-time read can skip a turn that already charged its time.
 */
function toldTime(record: Row): Row {
    const receipts = array(record.receipts).map(row).filter(receipt => receipt.kind === 'time').map(receipt => ({
        minutes: integer(receipt.minutes) ? number(receipt.minutes) : 0, ...(typeof receipt.band === 'string' ? { band: receipt.band } : {}),
        ...(typeof receipt.owed === 'string' ? { owed: receipt.owed } : {}) }));
    const session = row(record.world).session;
    return { receipts, session: session !== null && session !== undefined };
}

/** §216.1: the time-cost rows an act can take (the road rows left out: a journey is its move's), as `rules.bands` lists them. */
async function actTimeBands(context: KernelContext): Promise<Row[]> {
    return (await bandRows(context, 'time.band')).filter(entry => !ROUTE_TRAVEL_ROWS.includes(entry.handle))
        .map(entry => ({ handle: entry.handle, min: entry.min, max: entry.max, ...(entry.default !== undefined ? { default: entry.default } : {}),
            ...(entry.covers ? { covers: entry.covers } : {}) }));
}

/**
 * `table.owe.options`: the delivered scene, that turn's move, clue and time receipts, and the place, clue and time-cost
 * candidates (read-only).
 */
export async function toldOptions(context: KernelContext, loaded: { campaign: CampaignWriter; snapshot: { world: Row }; module: LoadedModule }, window: BriefWindow | null, params: Row): Promise<Row> {
    if (Object.keys(params).some(key => !['campaign', 'turn', 'limit', 'clue_limit'].includes(key)))
        throw new RpcError('invalid_params', 'Told-position options accept the bound campaign, the delivered turn, an optional limit and an optional clue_limit');
    if (params.limit !== undefined && (!integer(params.limit) || number(params.limit) < 1 || number(params.limit) > TOLD_OPTIONS_LIMIT.max))
        throw new RpcError('invalid_params', `limit must be an integer from 1 to ${TOLD_OPTIONS_LIMIT.max}`);
    if (params.clue_limit !== undefined && (!integer(params.clue_limit) || number(params.clue_limit) < 1 || number(params.clue_limit) > TOLD_CLUE_LIMIT.max))
        throw new RpcError('invalid_params', `clue_limit must be an integer from 1 to ${TOLD_CLUE_LIMIT.max}`);
    const { campaign, snapshot, module } = loaded, graph = module.graph, world = snapshot.world;
    const record = await deliveryRecord(campaign, params.turn), scene = deliveredScene(graph, world, record);
    const receipts = array(record.receipts).map(row);
    const moved = receipts.filter(receipt => receipt.kind === 'move').map(receipt => ({ to: string(receipt.to),
        ...(typeof receipt.owed === 'string' ? { owed: receipt.owed } : {}), ...(truth(receipt.renamed) ? { renamed: true } : {}) }));
    // §201.4: the clues the delivered turn landed, so the host's read can count one the text did not give (never acted on).
    const landed = receipts.filter(receipt => receipt.kind === 'clue').map(receipt => ({ clue: string(receipt.clue),
        summary: chars(words(string(receipt.summary || receipt.label || '')), 300), ...(typeof receipt.owed === 'string' ? { owed: receipt.owed } : {}) }));
    return { version: 1, turn: number(params.turn),
        scene: { name: graph.handle(scene), display_name: sceneLabel(graph, world, scene), summary: chars(words(string(scene.summary || graph.prose(scene))), 300) },
        moved, candidates: toldCandidates(graph, world, scene, window, params.limit === undefined ? TOLD_OPTIONS_LIMIT.fallback : number(params.limit)), window,
        clues: toldClueCandidates(graph, world, scene, record, params.clue_limit === undefined ? TOLD_CLUE_LIMIT.fallback : number(params.clue_limit)),
        clue_receipts: landed, time: toldTime(record), time_bands: await actTimeBands(context) };
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
    if (params.source === TOLD_CLUE_SOURCE) return oweToldClue(context, loaded, params, fix);
    if (params.source === TOLD_TIME_SOURCE) return oweToldTime(context, loaded, params, fix);
    if (params.source !== TOLD_SOURCE)
        throw new RpcError('invalid_params', `source must be ${TOLD_SOURCE}, ${TOLD_CLUE_SOURCE} or ${TOLD_TIME_SOURCE}`, { details: { field: 'source' } });
    const effect = row(params.effect);
    // §213.2: `{kind: "move", unlisted: true}` -- the text has the party leave for a place none of the candidates is.
    const unlisted = effect.kind === 'move' && effect.unlisted === true && Object.keys(effect).every(key => key === 'kind' || key === 'unlisted');
    if (!unlisted && (effect.kind !== 'move' || typeof effect.to !== 'string' || !effect.to.trim() || Object.keys(effect).some(key => key !== 'kind' && key !== 'to')))
        throw new RpcError('invalid_params', 'effect must be {kind: "move", to: <place>} or {kind: "move", unlisted: true}', { details: { field: 'effect' } });
    if (typeof params.quote !== 'string' || !params.quote.trim())
        throw new RpcError('invalid_params', 'quote must be the delivered sentence that tells where the party ends up', { details: { field: 'quote' } });
    const { campaign, module } = loaded, graph = module.graph, turn = number(params.turn);
    const record = await deliveryRecord(campaign, params.turn), rendered = string(record.rendered_text || '');
    const world = await campaign.readWorld(), party = await campaign.party();
    const dropped = (reason: string): Row => ({ turn, owed: null, dropped: reason });
    const quote = locateExcerpt(rendered, params.quote) ?? locateExcerpt(rendered, stripMarkers(params.quote));
    if (unlisted) return oweDeparture(context, loaded, record, turn, quote, fix);
    const scene = sceneOf(graph, string(effect.to).trim()), target = scene ? graph.handle(scene) : '';
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

/**
 * §213.2: the delivered text has the party leave the scene the ledger holds for a place the table does not have (the read's
 * `moved` cleared its bar and its `place` was `none`, confidently). The departure is owed like any told position, but no
 * effect can be issued for it -- the place has no name the kernel could write -- so the row carries no `effect`: it is the
 * Keeper's (`clerk: false` in the capsule), landed by an ordinary `apply move` (with `establish` and `via` for a new place),
 * which supersedes it (§158.4); a ledger that no longer stands where the party left from satisfies it. While it is open no
 * clerk move is built from the position the party left (§158.4's `owedMoveOpen`).
 */
async function oweDeparture(context: KernelContext, loaded: { campaign: CampaignWriter; module: { graph: ModuleGraph } }, record: Row, turn: number,
    quote: string | null, fix: string): Promise<Row> {
    const { campaign, module } = loaded, graph = module.graph;
    const world = await campaign.readWorld(), party = await campaign.party();
    const dropped = (reason: string): Row => ({ turn, owed: null, dropped: reason });
    const from = graph.handle(deliveredScene(graph, world, record));
    const again = array(record.owed).map(row).find(entry => entry.source === TOLD_SOURCE && entry.kind === 'move' && quote !== null
        && entry.quote === quote && row(entry.departure).from === from);
    if (again) return { turn, owed: string(again.name) };
    if (partyMoves(record.receipts).length) return dropped('move_landed');
    if (await movedSince(campaign, turn)) return dropped('superseded');
    if (!quote) return dropped('quote_not_delivered');
    let ledger = resolveOwedEquipment(await readOwed(context, campaign.id), party);
    const taken = new Set([...owedNames(ledger), ...array(record.owed).map(entry => string(row(entry).name))]);
    let index = 1;
    while (taken.has(`t${turn}-owed-${index}`)) index++;
    const at = nowIso(), label = sceneLabel(graph, world, deliveredScene(graph, world, record));
    const entry: Row = { name: `t${turn}-owed-${index}`, turn, kind: 'move', effect: null, departure: { from }, quote,
        what: chars(`departure from ${label} (${from}) to a place the table does not have yet: land it with an ordinary apply move to that place `
            + '(establish {summary} and via when the table has no such place), without owed; that move closes this row', 300),
        source: TOLD_SOURCE, at };
    if (owedSatisfied(graph, world, entry, party)) return dropped('satisfied');
    ledger = closeSatisfied(graph, world, mergeOwed(ledger, [entry], at), at, party).ledger;
    await writeOwed(context, campaign.id, ledger);
    record.owed = [...array(record.owed), entry];
    record.warnings = [...array(record.warnings), { lane: TOLD_SOURCE, kind: 'owed_state', quote: chars(quote, 120), why: chars(string(entry.what), 200),
        owed: entry.name, fix, at }];
    await campaign.writeTurnRecord(record);
    return { turn, owed: string(entry.name), departure: true };
}

/**
 * §201.1: `table.owe {campaign, turn, effect: {kind: "clue", clue}, quote, source: "told-clue"}` -> `{turn, owed: name | null,
 * dropped?, check?, check_skipped?}`. The clue the host's read found the delivered text gave: it must be a clue of the
 * book, the quote must be in what that turn delivered, and the ledger must still lack it. A clue that turn landed is no
 * debt (`clue_landed`); one the table has found since is `satisfied`. As with a told position, a clue the kernel cannot
 * owe is an answer, never an error. §201.2: when the book finds the clue by a check of a named skill, the row carries
 * `check` and, when no roll of that skill passed in the told turn, `check_skipped: true` -- the story gave the clue
 * without the roll; the row still lands it (§158: what was told stands), and the count is the operator's.
 */
async function oweToldClue(context: KernelContext, loaded: { campaign: CampaignWriter; module: { graph: ModuleGraph } }, params: Row, fix: string): Promise<Row> {
    const effect = row(params.effect);
    if (effect.kind !== 'clue' || typeof effect.clue !== 'string' || !effect.clue.trim() || Object.keys(effect).some(key => key !== 'kind' && key !== 'clue'))
        throw new RpcError('invalid_params', 'effect must be {kind: "clue", clue: <clue>}', { details: { field: 'effect' } });
    if (typeof params.quote !== 'string' || !params.quote.trim())
        throw new RpcError('invalid_params', 'quote must be the delivered sentence that gives the clue', { details: { field: 'quote' } });
    const { campaign, module } = loaded, graph = module.graph, turn = number(params.turn);
    const record = await deliveryRecord(campaign, params.turn), rendered = string(record.rendered_text || '');
    const world = await campaign.readWorld(), party = await campaign.party();
    const dropped = (reason: string): Row => ({ turn, owed: null, dropped: reason });
    const quote = locateExcerpt(rendered, params.quote) ?? locateExcerpt(rendered, stripMarkers(params.quote));
    const clue = clueOf(graph, effect.clue), handle = clue ? graph.handle(clue) : '';
    // The same read sent again answers the row it wrote.
    const again = array(record.owed).map(row).find(entry => entry.source === TOLD_CLUE_SOURCE && entry.kind === 'clue' && quote !== null
        && entry.quote === quote && row(entry.effect).clue === handle);
    if (again) return { turn, owed: string(again.name), ...checkOf(again) };
    if (!clue) return dropped('unknown_clue');
    if (array(record.receipts).map(row).some(receipt => receipt.kind === 'clue' && string(receipt.clue) === handle)) return dropped('clue_landed');
    if (!quote) return dropped('quote_not_delivered');
    const owedEffect: Row = { kind: 'clue', clue: handle };
    const check = clueCheck(graph, clue), skipped = !!check && !checkPassed(check, array(record.receipts));
    let ledger = resolveOwedEquipment(await readOwed(context, campaign.id), party);
    const taken = new Set([...owedNames(ledger), ...array(record.owed).map(entry => string(row(entry).name))]);
    let index = 1;
    while (taken.has(`t${turn}-owed-${index}`)) index++;
    const at = nowIso();
    const entry: Row = { name: `t${turn}-owed-${index}`, turn, kind: 'clue', effect: owedEffect, quote, what: describe(graph, owedEffect), source: TOLD_CLUE_SOURCE,
        ...(check ? { check: { ...check }, ...(skipped ? { check_skipped: true } : {}) } : {}), at };
    if (owedSatisfied(graph, world, entry, party)) return dropped('satisfied');
    ledger = closeSatisfied(graph, world, mergeOwed(ledger, [entry], at), at, party).ledger;
    await writeOwed(context, campaign.id, ledger);
    record.owed = [...array(record.owed), entry];
    record.warnings = [...array(record.warnings), { lane: TOLD_CLUE_SOURCE, kind: 'owed_state', quote: chars(quote, 120), why: chars(string(entry.what), 200),
        owed: entry.name, fix, at }];
    await campaign.writeTurnRecord(record);
    return { turn, owed: string(entry.name), ...checkOf(entry) };
}

/** The `check` and `check_skipped` an owed clue row carries, for the answer. */
function checkOf(entry: Row): Row {
    return entry.check ? { check: entry.check, ...(entry.check_skipped === true ? { check_skipped: true } : {}) } : {};
}

/**
 * §216.1: `table.owe {campaign, turn, effect: {kind: "time", band}, quote, source: "told-time"}` -> `{turn, owed: name | null,
 * dropped?}`. The time the host's read found the delivered text told the investigators spending, as a row of the rules'
 * time-cost table an act can take (never a road's: a journey is its move's). The quote must be in what that turn delivered;
 * a turn that charged its own time (`time_landed`) or ran a session owes none. A turn owes told time once: a second call
 * for a turn holding a told-time row answers that row. As with a told position, what the kernel cannot owe is an answer,
 * never an error. The row has no `satisfied` state: it closes only when a receipt lands it, and the kernel rolls its band.
 */
async function oweToldTime(context: KernelContext, loaded: { campaign: CampaignWriter; module: { graph: ModuleGraph } }, params: Row, fix: string): Promise<Row> {
    const effect = row(params.effect);
    if (effect.kind !== 'time' || typeof effect.band !== 'string' || !effect.band.trim() || Object.keys(effect).some(key => key !== 'kind' && key !== 'band'))
        throw new RpcError('invalid_params', 'effect must be {kind: "time", band: <a time-cost row>}', { details: { field: 'effect' } });
    if (typeof params.quote !== 'string' || !params.quote.trim())
        throw new RpcError('invalid_params', 'quote must be the delivered sentence that tells the time spent', { details: { field: 'quote' } });
    const { campaign, module } = loaded, graph = module.graph, turn = number(params.turn);
    const record = await deliveryRecord(campaign, params.turn), rendered = string(record.rendered_text || '');
    const party = await campaign.party();
    const dropped = (reason: string): Row => ({ turn, owed: null, dropped: reason });
    // One told time per turn: the same read sent again, or another one, answers the row the first wrote.
    const again = array(record.owed).map(row).find(entry => entry.source === TOLD_TIME_SOURCE && entry.kind === 'time');
    if (again) return { turn, owed: string(again.name) };
    const band = effect.band.trim();
    if (!(await owedBands(context)).time.includes(band)) return dropped('unknown_band');
    const clock = toldTime(record);
    if (array(clock.receipts).some(receipt => typeof row(receipt).owed !== 'string')) return dropped('time_landed');
    if (clock.session === true) return dropped('session');
    const quote = locateExcerpt(rendered, params.quote) ?? locateExcerpt(rendered, stripMarkers(params.quote));
    if (!quote) return dropped('quote_not_delivered');
    const owedEffect: Row = { kind: 'time', band };
    let ledger = resolveOwedEquipment(await readOwed(context, campaign.id), party);
    const taken = new Set([...owedNames(ledger), ...array(record.owed).map(entry => string(row(entry).name))]);
    let index = 1;
    while (taken.has(`t${turn}-owed-${index}`)) index++;
    const at = nowIso();
    const entry: Row = { name: `t${turn}-owed-${index}`, turn, kind: 'time', effect: owedEffect, quote, what: describe(graph, owedEffect), source: TOLD_TIME_SOURCE, at };
    ledger = mergeOwed(ledger, [entry], at);
    await writeOwed(context, campaign.id, ledger);
    record.owed = [...array(record.owed), entry];
    record.warnings = [...array(record.warnings), { lane: TOLD_TIME_SOURCE, kind: 'owed_state', quote: chars(quote, 120), why: chars(string(entry.what), 200),
        owed: entry.name, fix, at }];
    await campaign.writeTurnRecord(record);
    return { turn, owed: string(entry.name) };
}
