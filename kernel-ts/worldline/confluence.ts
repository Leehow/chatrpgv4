/** Confluence planning and post-commit landing through the captured worldline history. */
import { join } from 'node:path';
import { RpcError } from '../errors.js';
import { isJsonObject, orderedObject, parsePythonJson, pythonJsonDumps, sha256Text } from '../json.js';
import { writeTextAtomic } from '../fileio.js';
import type { ModuleGraph } from '../read/module-graph.js';
import { array, clone, entries, integer, normalize, number, repr, row, sorted, string, truth, values, type Row } from '../read/values.js';
import { nowIso } from '../write/store.js';
import { abortMerge, blob, checkout, commitIfDirty, createBranch, deleteBranch, head, lineCommit, mergeParents, restoreTree, SAVE_KEEP, tree, within, type WorldlineContext } from './history.js';
import { newLine, registry, validateName } from './identity.js';
import { generateEchoes, mergeEchoes, readEchoes, writeEchoes } from './echoes.js';
import { parseDispositions, report, settle, spentItemKey, type ConfluenceState } from './confluence-plan.js';
export { DISPOSITIONS, BOOK, MIRRORED, conflictId, engineView, parseDispositions, report, settle, spentItemKey } from './confluence-plan.js';
export type { ConfluenceState } from './confluence-plan.js';
function candidateRows(text: string): Row[] {
    const rows: Row[] = [];
    for (const line of text.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/)) {
        if (!line.trim())
            continue;
        try {
            const value = parsePythonJson(line);
            if (isJsonObject(value))
                rows.push(value);
        }
        catch { /* The current line reader skips malformed candidate rows. */ }
    }
    return rows;
}
export async function engineSaves(context: WorldlineContext, line: string): Promise<Row> {
    const saves: Array<[
        string,
        string
    ]> = [];
    for (const path of await tree(context, `wl/${line}`, 'save/', true)) {
        if (within(path, SAVE_KEEP))
            continue;
        const raw = await blob(context, `wl/${line}`, path);
        if (raw !== null)
            saves.push([path, sha256Text(raw).slice(0, 16)]);
    }
    return orderedObject(saves);
}
export async function spentItems(context: WorldlineContext, line: string): Promise<Set<string>> {
    const spent = new Set<string>();
    for (const path of await tree(context, `wl/${line}`, 'turns/')) {
        const raw = await blob(context, `wl/${line}`, path);
        if (raw === null)
            continue;
        let record: any;
        try {
            record = parsePythonJson(raw);
        }
        catch {
            continue;
        }
        for (const receipt of isJsonObject(record) ? array(record.receipts) : []) {
            if (!isJsonObject(receipt) || receipt.kind !== 'item')
                continue;
            const quantity = receipt.quantity;
            if ((integer(quantity) || typeof quantity === 'boolean') && number(quantity) < 0) {
                spent.add(spentItemKey(string(receipt.subject), normalize(string(receipt.name || ''))));
            }
        }
    }
    return spent;
}
export async function lineState(context: WorldlineContext, line: string): Promise<ConfluenceState> {
    const raw = await blob(context, `wl/${line}`, 'world.json');
    if (raw === null)
        throw new RpcError('invalid_params', `worldline ${repr(line)} has no committed world`, {
            fix: 'merge lines that have played at least one turn',
            details: {
                line
            }
        });
    const party = new Map<string, Row>();
    for (const path of await tree(context, `wl/${line}`, 'party/')) {
        const content = await blob(context, `wl/${line}`, path);
        if (content === null)
            continue;
        try {
            const sheet = parsePythonJson(content);
            if (isJsonObject(sheet) && truth(sheet.id))
                party.set(string(sheet.id), sheet);
        }
        catch { /* Match the existing committed-sheet reader. */ }
    }
    const candidates = candidateRows(await blob(context, `wl/${line}`, 'memory/candidates.jsonl') || '');
    return {
        line,
        world: parsePythonJson(raw) as Row,
        party: orderedObject(party),
        candidates,
        spent: await spentItems(context, line),
        engines: await engineSaves(context, line)
    };
}
export async function plan(context: WorldlineContext, graph: ModuleGraph, meta: Row, effect: Row, source: string, turnNumber: number): Promise<Row> {
    const lines = registry(meta);
    const name = validateName(effect.name, 'name');
    if (Object.hasOwn(lines, name) || await lineCommit(context, name) !== null)
        throw new RpcError('invalid_params', `worldline ${repr(name)} already exists`, {
            fix: 'the confluence makes a new line; pick a name no line has',
            details: {
                lines: sorted(Object.keys(lines))
            },
        });
    const wanted = effect.lines;
    if (!Array.isArray(wanted) || wanted.length < 2)
        throw new RpcError('invalid_params', 'a confluence needs at least two lines', {
            fix: 'lines: ["<a>", "<b>"]',
            details: {
                lines: wanted ?? null
            }
        });
    const chosen: string[] = [];
    for (const value of wanted) {
        const line = validateName(value, 'lines');
        const registered = lines[line];
        if (!isJsonObject(registered) || await lineCommit(context, line) === null)
            throw new RpcError('invalid_params', `no worldline ${repr(line)}`, {
                fix: 'merge lines this campaign has',
                details: {
                    lines: sorted(Object.keys(lines))
                }
            });
        if (registered.status === 'merged')
            throw new RpcError('invalid_params', `worldline ${repr(line)} was already merged`, {
                details: {
                    line,
                    status: 'merged'
                }
            });
        if (chosen.includes(line))
            throw new RpcError('invalid_params', `worldline ${repr(line)} is named twice`, {
                details: {
                    line
                }
            });
        chosen.push(line);
    }
    if (!chosen.includes(source))
        throw new RpcError('invalid_params', 'a confluence must include the line at the table', {
            fix: `add ${repr(source)} to lines, or switch to one of them first`,
            details: {
                active: source,
                lines: chosen
            }
        });
    const into = effect.into != null ? graph.handle(graph.scene(string(effect.into))) : null;
    const states: ConfluenceState[] = [];
    for (const line of chosen)
        states.push(await lineState(context, line));
    const settled = settle(report(graph, states, into), parseDispositions(effect.dispositions));
    const parents: Row[] = [];
    for (const line of chosen)
        parents.push({
            line,
            turn: Math.trunc(number(row(lines[line]).last_turn || 0)),
            commit: await lineCommit(context, line)
        });
    return {
        operation: 'merge',
        line: name,
        mode: null,
        lines: chosen,
        from: {
            line: source,
            turn: turnNumber,
            commit: null
        },
        loop: Math.max(...chosen.map(line => Math.trunc(number(row(lines[line]).loop || 0)))),
        parents,
        into: settled.into,
        report: settled
    };
}
async function writeState(context: WorldlineContext, settled: Row): Promise<void> {
    await context.campaign.writeWorld(settled.world);
    for (const sheet of values(settled.party))
        await context.campaign.writeSheet(sheet);
    await restoreTree(context, `wl/${string(settled.engine_line)}`, 'save', SAVE_KEEP);
}
async function writeMemory(context: WorldlineContext, planRow: Row): Promise<void> {
    const rows = new Map<string, Row>();
    for (const parent of array(planRow.parents)) {
        const candidates = candidateRows(await blob(context, `wl/${string(parent.line)}`, 'memory/candidates.jsonl') || '');
        for (const candidate of candidates) {
            const id = string(candidate.id);
            if (!rows.has(id))
                rows.set(id, candidate);
        }
    }
    await writeTextAtomic(join(context.campaign.directory, 'memory', 'candidates.jsonl'), sorted(rows.keys()).map(id => pythonJsonDumps(rows.get(id)!) + '\n').join(''));
}
async function writeMergedEchoes(context: WorldlineContext, meta: Row, parents: string[]): Promise<void> {
    const lines = registry(meta);
    const fresh: Row[] = [];
    for (const line of parents.slice(1))
        fresh.push(...await generateEchoes(context, line, Math.trunc(number(row(lines[line]).loop || 0))));
    await writeEchoes(context, mergeEchoes(await readEchoes(context), fresh));
}
export async function perform(context: WorldlineContext, _graph: ModuleGraph, planRow: Row, turnNumber: number): Promise<Row> {
    const meta = clone(await context.campaign.readCampaign());
    const before = clone(meta);
    const source = string(planRow.from.line);
    const target = string(planRow.line);
    const parents = array(planRow.parents).map(parent => string(parent.line));
    const base = await commitIfDirty(context, `worldline ${source}: sealed at turn ${turnNumber}`) || await head(context);
    let created = false;
    let lines: Row = {};
    try {
        const start = await lineCommit(context, parents[0]);
        await createBranch(context, target, string(start));
        created = true;
        await checkout(context, target);
        await mergeParents(context, parents.slice(1));
        await writeState(context, planRow.report);
        await writeMemory(context, planRow);
        await writeMergedEchoes(context, meta, parents);
        lines = clone(registry(meta));
        for (const name of parents)
            if (isJsonObject(lines[name])) {
                lines[name].status = 'merged';
                lines[name].last_commit = await lineCommit(context, name);
            }
        const next = newLine(context.campaign.id, target, 'merge', Math.trunc(number(planRow.loop)), clone(planRow.parents[0]), {
            parents: [...planRow.parents]
        });
        lines = orderedObject([...entries(lines), [target, next]]);
        meta.worldlines = lines;
        meta.active_worldline = target;
        await context.campaign.writeCampaign(meta);
        const landed = await commitIfDirty(context, `worldline ${target}: ${parents.join(', ')} flowed together at turn ${turnNumber}`);
        lines[target].last_commit = landed || await head(context);
        lines[target].last_turn = await context.kernel.snapshots.pathExists(join(context.campaign.directory, 'turn.json')) ? (await context.campaign.readTurn()).turn ?? null : null;
        await context.campaign.writeCampaign(meta);
    }
    catch (error) {
        try {
            await abortMerge(context);
            await checkout(context, source, true);
            if (created)
                await deleteBranch(context, target);
            await context.campaign.writeCampaign(before);
        }
        catch { /* Rollback is best effort; preserve the original failure. */ }
        throw error;
    }
    return {
        operation: 'merge',
        line: target,
        from: source,
        mode: null,
        loop: Math.trunc(number(planRow.loop)),
        lines: parents,
        seal: base,
        commit: lines[target].last_commit ?? null,
        conflicts: planRow.report.conflicts.length
    };
}
export function receiptOf(planRow: Row, turnNumber: number, callId: string, label: string | null, mint: (base: string) => string): Row {
    return {
        id: mint(`merge:${planRow.line}-t${turnNumber}`),
        kind: 'worldline',
        call_id: callId,
        operation: 'merge',
        line: planRow.line,
        mode: null,
        loop: Math.trunc(number(planRow.loop)),
        lines: [...planRow.lines],
        from: {
            line: planRow.from.line,
            turn: turnNumber
        },
        conflicts: planRow.report.conflicts.length,
        label,
        visibility: 'public',
        at: nowIso()
    };
}
