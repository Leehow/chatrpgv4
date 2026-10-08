/** Advisory memory lanes and recall share the campaign writer and its lock. */
import { join } from 'node:path';
import type { KernelContext } from '../context.js';
import type { HandlerGroup } from '../handlers.js';
import { RpcError } from '../errors.js';
import { isJsonObject } from '../json.js';
import { CampaignSnapshot, loadCampaignModule } from '../read/campaign.js';
import type { ModuleGraph } from '../read/module-graph.js';
import { readCampaign, unsupported } from '../read/handlers.js';
import { playLanguageOf } from '../read/languages.js';
import { array, row, number, integer, string, truth, repr, chars, type Row } from '../read/values.js';
import { locateExcerpt } from '../read/excerpt.js';
import { createWriteRuntime } from '../write/index.js';
import { CampaignWriter, nowIso } from '../write/store.js';
import { noteMemory, readNpcLedger } from '../write/contributions.js';
import { buildJob, correctionJob, committedRecords, defaultJobTurn, fail, logs, openJob, parseJobId, readJob, submit } from './jobs.js';
import { history, recallMemory, transcript } from './recall.js';
import {validateRecallRequest} from './pages.js';
import {referencedJob, referencedSource, submitReferenced} from './referenced.js';
import {createMemoryEvidenceOwner} from './evidence.js';
import {closeSatisfied, mergeOwed, owedNames, projectOwed, resolveOwedEquipment, readOwed, writeOwed} from '../owed/index.js';
import {applyFirstSight, checkFirstSightItems, FIRST_SIGHT_BUDGET, firstSightSection, fitFirstSight, readFirstSight, turnFirstSight, writeFirstSight} from '../first-sight/index.js';
import {HEAD_FIRST_SIGHT} from '../read/assemble.js';
import {briefWindow} from '../read/brief-window.js';
import {oweTold, toldOptions} from '../owed/told.js';
import {activeMods, effectiveMods} from '../read/mods.js';
import {establishItem, establishProvider, establishReviewOwners, HEAD_ESTABLISH} from '../read/establish.js';
import {historicalSetting} from '../read/historical-setting.js';
import {npcsPresent} from '../read/capsule.js';
/** The verifier's finding kinds, `play_language_mismatch` among them: the kernel makes no language refusal of its own (contract section 23). */
const FINDINGS = ['reveal', 'uncommitted_state', 'player_agency', 'play_language_mismatch', 'unmarked_speech', 'investigator_identity_mismatch'];
/**
 * A `reveal` may name the clue it is about (contract §51.3).
 *
 * The lane's `why` has always carried the handle in prose; a prose sentence is not a subject. The
 * name is canonicalized against this campaign's graph -- the effective one, adaptations included --
 * so what lands on the record is the same handle `apply clue` takes and `discovered_clues` holds. A
 * name that is not a clue here is dropped from the row rather than failing the finding: the lane
 * guessed a word, and the rest of what it saw is still worth keeping.
 */
function revealedClue(graph: ModuleGraph, finding: Row): string | null {
    if (finding.kind !== 'reveal' || typeof finding.clue !== 'string' || !finding.clue.trim()) return null;
    try { return graph.handle(graph.clue(finding.clue.trim())); }
    catch { return null; }
}
/**
 * Contract §130.4 as amended by §158.3: the continuity review's verdict on a delivery the player has already read.
 * Every row points forward -- what the player was told is what happened (owner ruling 2026-09-29) -- and none
 * carries the reviewer's own `fix`, which was written for an unpublished draft and is executed literally if it
 * arrives (§34.7).
 */
const CONTINUITY_LANE = 'continuity-review';
const FORWARD: Readonly<Record<string, string>> = Object.freeze({
    continuity_conflict: 'Already delivered and read: it is what happened, and so is what it contradicts. Do not rewrite, retract or correct either; make the logic hold in the fiction from here on, without explaining it.',
    unsettled_object: 'Narrated without reaching the object: it happened. Register it with an ordinary apply as something the investigator already has, and do not narrate it again or explain it.',
    continuity_finding: 'Already delivered and read: it is what happened. Do not rewrite, retract or correct it, and do not apologise or explain. Where the ledger disagrees with it, bring the ledger forward with an ordinary apply and carry on in the fiction.',
    source_conflict: 'Already delivered and read: do not rewrite or retract it. Reconcile it with the source in the fiction from here on, without explaining it.',
    owed_state: 'Already told: the player was told this happened, so it did, and the ledger owes it. Land it with an ordinary apply as something that already happened (the clerk lands it first when it can) and carry on from there. Do not narrate it again, correct it, retract it or explain it.'
});
/** `owed`: the rows §158.3 recorded for an owed-capable job; they replace that job's `unsettled_object` rows. */
function continuityRows(accepted: Row, rendered: string, owed: Row[] | null = null): Row[] {
    const rows: Row[] = [], at = nowIso();
    const add = (kind: string, quote: unknown, why: string, extra: Row = {}) => {
        if (rows.length >= 10 || !why.trim()) return;
        const anchored = locateExcerpt(rendered, quote);
        rows.push({ lane: CONTINUITY_LANE, kind, quote: anchored ? chars(anchored, 120) : null,
            why: chars(why, 200), ...extra, fix: FORWARD[kind], at });
    };
    for (const conflict of array(row(accepted.continuity_review).conflicts)) add('continuity_conflict', conflict.claim, string(conflict.reason));
    if (owed) for (const entry of owed) add('owed_state', entry.quote, string(entry.what), { owed: entry.name });
    else for (const missing of array(accepted.missing)) add('unsettled_object', null, `${string(missing.name)} (${string(missing.category)}): ${string(missing.reason)}`);
    for (const finding of array(accepted.findings)) add('continuity_finding', null, string(finding.reason));
    for (const claim of array(row(accepted.source_review).claims)) if (claim.verdict !== 'supported') add('source_conflict', claim.quote, string(claim.reason));
    return rows;
}
function acceptedVerdict(accepted: Row): string {
    const review = row(accepted.continuity_review);
    if (typeof review.verdict === 'string') return review.verdict;
    const source = row(accepted.source_review);
    return array(accepted.missing).length || array(accepted.findings).length || (Object.keys(source).length && source.verdict !== 'supported') ? 'revise' : 'pass';
}
async function warnContinuity(context: KernelContext, campaign: CampaignWriter, graph: ModuleGraph, params: Row): Promise<Row> {
    const turn = number(params.turn), mode = params.mode, job = params.job, unreviewed = params.unreviewed;
    if (!['pre', 'post'].includes(mode as string))
        unsupported('mode', mode, ['pre', 'post'], `unknown review mode ${repr(mode)}`);
    const byJob = typeof job === 'string' && /^[0-9a-f]{64}$/.test(job);
    if (byJob === isJsonObject(unreviewed) || (!byJob && (typeof row(unreviewed).cause !== 'string' || !string(row(unreviewed).cause).trim())))
        throw new RpcError('invalid_params', 'a continuity record names either the accepted review job or why the delivery went unreviewed', {
            fix: 'pass job (the review job id) or unreviewed {cause, service}' });
    const record = await campaign.readTurnRecord(turn);
    if (!record || !['narrate', 'ask'].includes(string(record.closed_by)))
        throw new RpcError('invalid_params', `turn ${turn} has no delivery record to anchor the review to`, { details: { turn } });
    const prior = row(record.continuity_review);
    // Idempotent for the same job, and a reading that happened is never overwritten by a later report
    // that nothing was read (a replayed delivery prepares a second pin that can only come back stale).
    if (byJob ? prior.job === job : prior.reviewed === true)
        return { turn, lane: CONTINUITY_LANE, accepted: 0, dropped: [], continuity_review: prior };
    let review: Row, rows: Row[] = [], owed: Row[] = [], owedDropped: Row[] = [];
    if (byJob) {
        const root = join(context.stateRoot, 'mods', 'jobs', string(job));
        let identity: Row, request: Row, accepted: Row;
        try {
            [identity, request, accepted] = await Promise.all(['identity.json', 'request.json', 'accepted.json']
                .map(async name => row(await context.snapshots.readJson(join(root, name)))));
        } catch {
            throw new RpcError('invalid_params', 'the review job has no accepted report', { details: { job } });
        }
        if (identity.campaign !== campaign.id || number(identity.turn) !== turn || request.role !== 'audit'
            || string(row(request.input).text) !== string(record.text))
            throw new RpcError('invalid_params', 'the review job did not read this delivery', { details: { job, turn } });
        // §158.3: an owed-capable job names what the delivered text established and no receipt carries; it becomes
        // owed state on the record and in the campaign's owed ledger, never a request to avoid it next time.
        const owedCapable = row(request.continuity_review).owed === true;
        if (owedCapable) {
            const world = await campaign.readWorld(), at = nowIso();
            let ledger = resolveOwedEquipment(await readOwed(context, campaign.id),await campaign.party());
            // A retry after the ledger was written but the record was not reuses this job's rows instead of minting twins.
            const already = ledger.open.filter(entry => entry.job === job);
            if (already.length) owed = already;
            else ({ rows: owed, dropped: owedDropped } = await projectOwed(context, graph, world, record, accepted, string(job), owedNames(ledger), await campaign.party()));
            ledger = closeSatisfied(graph, world, mergeOwed(ledger, owed, at), at, await campaign.party()).ledger;
            await writeOwed(context, campaign.id, ledger);
            record.owed = owed;
        }
        rows = continuityRows(accepted, string(record.rendered_text || ''), owedCapable ? owed : null);
        review = { mode, reviewed: true, verdict: acceptedVerdict(accepted), job, warnings: rows.length, at: nowIso() };
    } else {
        const cause = row(unreviewed);
        review = { mode, reviewed: false, cause: chars(string(cause.cause), 200), service: cause.service !== false, warnings: 0, at: nowIso() };
    }
    if (rows.length) record.warnings = [...array(record.warnings), ...rows];
    record.continuity_review = review;
    await campaign.writeTurnRecord(record);
    await campaign.telemetry({ lane: CONTINUITY_LANE, event: 'recorded', turn, mode, reviewed: review.reviewed, verdict: review.verdict ?? null, warnings: rows.length,
        ...(owed.length ? { owed: owed.length } : {}), ...(owedDropped.length ? { owed_dropped: owedDropped } : {}) });
    return { turn, lane: CONTINUITY_LANE, accepted: rows.length, dropped: [], continuity_review: review };
}
async function warn(context: KernelContext, loaded: { campaign: CampaignWriter; module: { graph: ModuleGraph } }, params: Row): Promise<Row> {
    const { campaign, module } = loaded;
    const turn = params.turn, lane = params.lane, findings = params.findings;
    if (!integer(turn) || number(turn) < 0)
        throw new RpcError('invalid_params', 'params.turn must be a committed turn number');
    if (lane === CONTINUITY_LANE)
        return warnContinuity(context, campaign, module.graph, params);
    if (lane !== 'verifier')
        unsupported('lane', lane, ['verifier', CONTINUITY_LANE], `unknown lane ${repr(lane)}`);
    if (!Array.isArray(findings))
        throw new RpcError('invalid_params', 'params.findings must be a list');
    const record = await campaign.readTurnRecord(number(turn));
    if (!record || record.closed_by !== 'narrate')
        throw new RpcError('invalid_params', `turn ${turn} has no narrate record to anchor findings to`, { details: { turn } });
    const rendered = string(record.rendered_text || ''), accepted: Row[] = [], dropped: Row[] = [], unanchored: Row[] = [];
    for (const [index, finding] of findings.entries()) {
        if (!isJsonObject(finding))
            throw new RpcError('invalid_params', `findings[${index}] must be an object`, { details: { index } });
        const kind = finding.kind, quote = finding.quote;
        if (!FINDINGS.includes(kind as string))
            throw new RpcError('invalid_params', `findings[${index}].kind ${repr(kind)} is not a finding kind`, { fix: `one of ${repr(FINDINGS)}`, details: { index } });
        // Contract §139: the quote is located with quotation marks as one class, and the record keeps the prose's own text.
        const anchored = locateExcerpt(rendered, quote);
        if (!anchored) {
            dropped.push({ index, kind, reason: 'quote is not a substring of rendered_text' });
            unanchored.push({ index, kind, quote: chars(string(quote), 80) });
            continue;
        }
        if (accepted.length >= 10) {
            dropped.push({ index, kind, reason: 'more than 10 findings' });
            continue;
        }
        const clue = revealedClue(module.graph, finding as Row);
        accepted.push({ lane, kind, quote: chars(anchored, 120), why: chars(string(finding.why || ''), 200), ...(clue ? { clue } : {}), at: nowIso() });
    }
    const warnings = [...array(record.warnings), ...accepted];
    record.warnings = warnings;
    await campaign.writeTurnRecord(record);
    const named = accepted.filter(value => typeof value.clue === 'string').length;
    await campaign.telemetry({ lane, turn, ok: true, findings: findings.length, accepted: accepted.length, dropped: dropped.length, clues: named,
        ...(unanchored.length ? { unanchored } : {}) });
    return { turn, lane, accepted: accepted.length, dropped, warnings: warnings.map(value => ({ kind: value.kind, quote: value.quote, why: value.why, ...(value.clue ? { clue: value.clue } : {}) })) };
}
/**
 * Contract §168.5: what the host's first-sight check found a delivery showed of the place and people it owed. Like
 * `table.warn` it lands after the turn it read has closed and takes no call id: an item with nothing missing is shown,
 * any other is an open row the next capsule carries as `missing`. The record keeps the turn's results for a fork.
 */
async function firstSight(context: KernelContext, loaded: { campaign: CampaignWriter; module: { graph: ModuleGraph } }, params: Row): Promise<Row> {
    const { campaign, module } = loaded, turn = params.turn;
    if (!integer(turn) || number(turn) < 0)
        throw new RpcError('invalid_params', 'params.turn must be a committed turn number');
    const record = await campaign.readTurnRecord(number(turn));
    if (!record || !['narrate', 'ask'].includes(string(record.closed_by)))
        throw new RpcError('invalid_params', `turn ${turn} has no delivery record for a first-sight check`, { details: { turn } });
    const { results, dropped } = checkFirstSightItems(module.graph, params.items), at = nowIso();
    if (results.length) {
        await writeFirstSight(context, campaign.id, applyFirstSight(await readFirstSight(context, campaign.id), number(turn), results, at));
        record.first_sight = turnFirstSight(record.first_sight, results, at);
        await campaign.writeTurnRecord(record);
    }
    const shown = results.filter(result => !result.missing.length).map(result => ({ kind: result.kind, id: result.id }));
    const open = results.filter(result => result.missing.length).map(result => ({ kind: result.kind, id: result.id, missing: result.missing }));
    await campaign.telemetry({ lane: 'first-sight', event: 'recorded', turn: number(turn), shown: shown.length, open: open.length,
        ...(dropped.length ? { dropped } : {}) });
    return { turn: number(turn), shown, open, dropped };
}
export function createMemoryHandlers(context: KernelContext, writer: ReturnType<typeof createWriteRuntime>): HandlerGroup {
    const evidence = createMemoryEvidenceOwner(context, params => writer.campaign(params));
    async function load(params: Row) {
        const campaign = await writer.campaign(params), snapshot = new CampaignSnapshot(context, campaign.id);
        snapshot.meta = await campaign.readCampaign();
        snapshot.jsonFiles.set('campaign.json', snapshot.meta);
        const referencedCompletion = snapshot.meta.status === 'completed' && (params.mode === 'referenced' || params.referenced !== undefined);
        if (snapshot.meta.status !== 'active' && !referencedCompletion)
            throw new RpcError('campaign_not_ready', `campaign ${repr(campaign.id)} is ${repr(snapshot.meta.status)}`, {
                ...(snapshot.meta.status === 'setting_up' ? { fix: string(row(await context.snapshots.readJson(context.content + '/setup/steps.json')).table_open_fix).replaceAll('{campaign}', campaign.id) } : {}),
                details: { status: snapshot.meta.status }
            });
        snapshot.world = await campaign.readWorld();
        const module = await loadCampaignModule(context, string(snapshot.meta.module_id), snapshot.world, campaign.id);
        snapshot.jsonFiles.set('world.json', snapshot.world);
        if (!Object.hasOwn(snapshot.world, 'scene_trail'))
            await writer.read.repairLegacyTrail!(snapshot);
        return { campaign, snapshot, module };
    }
    async function jobFor(loaded: Awaited<ReturnType<typeof load>>, id: any): Promise<[
        Row | null,
        number
    ]> {
        const { campaign, snapshot, module } = loaded, turn = parseJobId(campaign, id);
        let job = await readJob(campaign, string(id));
        if (!job && (await committedRecords(campaign)).has(turn)) {
            const packet = string(id).startsWith('reconcile:') ? await correctionJob(campaign, module.graph, await campaign.party(), string(id))
                : await buildJob(campaign, module.graph, await playLanguageOf(context, snapshot.meta), turn, await campaign.party(), snapshot.world);
            if (packet) await openJob(campaign, packet);
            job = await readJob(campaign, string(id));
        }
        return [job, turn];
    }
    return Object.freeze({
        'memory.evidence': evidence,
        'memory.source': async (params) => {
            if (!integer(params.turn) || number(params.turn) < 0) throw new RpcError('invalid_params', 'params.turn must be a committed turn number');
            return referencedSource(await writer.campaign(params), number(params.turn));
        },
        'table.warn': async (params) => warn(context, await load(params), params),
        'table.first_sight': async (params) => firstSight(context, await load(params), params),
        // Contract §190.2: the places a delivered text may leave the party at, and the owed move the host's read names.
        'table.owe.options': async (params) => {
            const loaded = await load(params);
            return toldOptions(loaded, await briefWindow(context, loaded.module, loaded.snapshot.world), params);
        },
        'table.owe': async (params) => oweTold(context, await load(params), params, FORWARD.owed_state),
        // Contract §168.5: the first sight owed where the party stands now, for a run that moved after its capsule was read.
        'table.first_sight.view': async (params): Promise<Row> => {
            const { campaign, snapshot, module } = await load(params);
            let scene: Row;
            try { scene = module.graph.scene(string(snapshot.world.active_scene)); }
            catch { return { first_sight: null }; }
            const section = firstSightSection(module.graph, snapshot.world, scene, await readFirstSight(context, campaign.id));
            if (!section) return { first_sight: null };
            fitFirstSight(section, FIRST_SIGHT_BUDGET);
            return { first_sight: section, head: HEAD_FIRST_SIGHT.trim() };
        },
        // Contract §203.4: the establishing duty where the party stands now (a run that moved after its capsule was read, the
        // delivery check, the look), with the review's instruction when exactly one active package words it. Read-only.
        'table.establish.view': async (params): Promise<Row> => {
            if (params.look !== undefined && typeof params.look !== 'boolean') throw new RpcError('invalid_params', 'params.look must be boolean when supplied');
            const { campaign, snapshot, module } = await load(params);
            let scene: Row;
            try { scene = module.graph.scene(string(snapshot.world.active_scene)); }
            catch { return { establish: null, head: '', review: null }; }
            const active = await activeMods(context, snapshot.world), effective = effectiveMods(active);
            const turn = await campaign.readTurn();
            const item = establishItem(module.graph, snapshot.world, scene, establishProvider(effective), await snapshot.turnRecords(),
                { opening: number(turn.turn) === 0, look: params.look === true, receipts: array(turn.receipts) });
            const owners = establishReviewOwners(effective);
            // What the review reads beside the draft: who the table seats here, and the setting's period.
            const present = item ? npcsPresent(module.graph, snapshot.world, scene).filter(node => node.node_kind === 'npc')
                .map(node => module.graph.displayName(node)) : [];
            const setting = item ? row(await historicalSetting(snapshot, module).catch(() => ({}))) : {}, era = typeof setting.era === 'string' ? setting.era : '';
            return { establish: item, head: item ? HEAD_ESTABLISH.trim() : '',
                ...(item ? { present, era: era || null } : {}),
                review: owners.length === 1 ? { ...owners[0] } : null,
                ...(owners.length > 1 ? { contributors: owners.map(owner => ({ mod: owner.mod, version: owner.version })) } : {}) };
        },
        'memory.job': async (params) => {
            const { campaign, snapshot, module } = await load(params);
            if (params.mode != null && params.mode !== 'referenced') throw new RpcError('invalid_params', 'Unknown memory job protocol');
            if (params.job_id != null) {
                parseJobId(campaign, params.job_id);
                if (!string(params.job_id).startsWith('reconcile:')) throw new RpcError('invalid_params', 'Use turn for an extraction job, or job_id for a retained reconciliation');
                const [job] = await jobFor({campaign, snapshot, module}, params.job_id);
                if (!job?.correction) throw new RpcError('invalid_params', 'No matching correction reconciliation job');
                if (job.worldline !== (snapshot.meta.active_worldline ?? 'main')) throw new RpcError('invalid_params', 'Correction job belongs to another worldline');
                return job.packet;
            }
            let turn = params.turn;
            if (turn == null) {
                if (params.exclude_turns !== undefined && (params.mode !== 'referenced' || !Array.isArray(params.exclude_turns)
                    || params.exclude_turns.length > 128 || params.exclude_turns.some(value => !integer(value) || number(value) < 0)))
                    throw new RpcError('invalid_params', 'Referenced memory exclusions must be at most 128 turn numbers');
                turn = await defaultJobTurn(campaign, {referenced: params.mode === 'referenced', exclude: array(params.exclude_turns).map(number)});
                if (turn == null) {
                    const packet = await correctionJob(campaign, module.graph, await campaign.party());
                    return packet ? openJob(campaign, packet) : { job_id: null, turn: null };
                }
            }
            else if (!integer(turn) || number(turn) < 0)
                throw new RpcError('invalid_params', 'params.turn must be a committed turn number');
            if (params.mode === 'referenced') return referencedJob(campaign, module.graph, await playLanguageOf(context, snapshot.meta), number(turn), await campaign.party(), snapshot.world);
            const existing = await readJob(campaign, `extract:${campaign.id}:t${turn}`);
            if (existing?.protocol === 'memory-reference-v1') throw new RpcError('invalid_params', 'This memory job requires the referenced protocol');
            return openJob(campaign, await buildJob(campaign, module.graph, await playLanguageOf(context, snapshot.meta), number(turn), await campaign.party(), snapshot.world));
        },
        'memory.submit': async (params) => {
            const loaded = await load(params), { campaign, module } = loaded;
            const turn = parseJobId(campaign, params.job_id);
            const job = params.referenced !== undefined ? await readJob(campaign, string(params.job_id)) : (await jobFor(loaded, params.job_id))[0];
            if (!job)
                throw new RpcError('invalid_params', `no extraction job for turn ${turn}`, { fix: 'call memory.job first', details: { job_id: params.job_id ?? null } });
            if (params.referenced !== undefined) {
                if (params.candidates !== undefined || params.story !== undefined) throw new RpcError('invalid_params', 'Referenced and legacy submissions cannot be combined');
                return submitReferenced(campaign, module.graph, await campaign.party(), job, params.referenced);
            }
            if (job.protocol === 'memory-reference-v1') throw new RpcError('invalid_params', 'This memory job requires the referenced protocol');
            const [result, replayed] = await submit(campaign, module.graph, await campaign.party(), job, params.candidates, params.story);
            if (replayed)
                return { ...result, replayed: true };
            const written = new Set(array(result.written));
            if (written.size) {
                const rows = (await logs(campaign, 'memory/candidates.jsonl')).filter(value => written.has(string(value.id)));
                if (rows.length) {
                    const ledger = await readNpcLedger(campaign);
                    noteMemory(ledger, module.graph, rows);
                    await campaign.write('npc-ledger.json', ledger);
                }
            }
            if (result.story) await campaign.telemetry({lane: 'story', event: 'assessment', turn,
                status: row(result.story).status, thread: row(result.story).thread,
                bridge_delivered: row(result.story).bridge_delivered});
            await campaign.appendEvent(turn, { type: 'memory-written', data: { job_id: result.job_id, turn, candidates: result.candidates, superseded: array(result.superseded).length } });
            return result;
        },
        'memory.fail': async (params) => {
            const loaded = await load(params), [job, turn] = await jobFor(loaded, params.job_id);
            return fail(loaded.campaign, job, string(params.job_id), turn, params.reason, params.detail);
        },
        'table.recall': async (params) => {
            validateRecallRequest(params);
            if (params.query !== undefined) throw new RpcError('needs', 'Semantic memory queries require their typed host owner',
                {fix: 'Use the configured memory-query host, or omit query and use ordinary direct recall.', details: {reason: 'memory_query_requires_host'}});
            const contextRead = params._context_read === true;
            const { campaign: snapshot, module } = await readCampaign(context, params, false, true, writer.read, contextRead), what = params.what;
            if (!['history', 'memory', 'transcript'].includes(what as string))
                unsupported('what', what, ['history', 'memory', 'transcript'], `unknown recall kind ${repr(what)}`);
            if (!contextRead) await writer.read.touchActing!(snapshot);
            const campaign = await writer.campaign(params), current = number(snapshot.turn.turn);
            return what === 'transcript' ? transcript(campaign, current, params) : what === 'history' ? history(campaign, current, params) : recallMemory(campaign, module.graph, snapshot.world, params);
        }
    });
}
