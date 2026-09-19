/** Bounded source-independent contributions required by ordinary turn closure. */
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { KernelContext } from '../context.js';
import { writeJsonAtomic, appendJsonl } from '../fileio.js';
import { RpcError } from '../errors.js';
import { ModuleGraph } from '../read/module-graph.js';
import { readModCatalog, activeMods } from '../read/mods.js';
import { array, entries, values, clone, row, string, number, integer, truth, sorted, type Row } from '../read/values.js';
import { CampaignWriter, missingContribution, nowIso } from './store.js';
function topological(preferred: string[], active: Row[]): string[] {
    const todo = [...preferred], done: string[] = [];
    while (todo.length) {
        const next = todo.find(id => Object.keys(row(active.find(r => r.id === id)?.dependencies)).every(dep => done.includes(dep)));
        if (next == null)
            throw new RpcError('invalid_params', 'Mod dependency order is cyclic or incomplete');
        done.push(next);
        todo.splice(todo.indexOf(next), 1);
    }
    return done;
}
export async function defaultModPlan(context: KernelContext, world: Row): Promise<{
    world: Row;
    changed: boolean;
    install(): Promise<void>;
}> {
    const staged = clone(world), catalog = await readModCatalog(context), defaultsPath = join(context.stateRoot, 'mods', 'defaults.json');
    const defaults = await context.snapshots.pathExists(defaultsPath) ? row(await context.snapshots.readJson(defaultsPath)) : {};
    const packages = [...catalog.values()], builtin = join(dirname(context.content), 'mods');
    const assertSupported = async (mods: Row[]) => {
        for (const mod of mods) {
            const path = join(builtin, mod.id, 'mod.json');
            if (!await context.snapshots.pathExists(path) || row(await context.snapshots.readJson(path)).version !== mod.version)
                missingContribution(`active Mod ${mod.id}`);
        }
    };
    if (Object.hasOwn(staged, 'objects'))
        missingContribution('object inventory projection');
    if (truth(row(staged.mods).pending) || Object.hasOwn(row(staged.mods), 'pending_order'))
        missingContribution('pending Mod configuration');
    let changed = false, retained: Row[] = [];
    if (Object.hasOwn(staged, 'mods')) {
        const active = await activeMods(context, staged);
        await assertSupported(active);
        if (!Object.hasOwn(staged.mods, 'order')) {
            const ids = new Set([...packages.map(p => p.id), ...Object.keys(row(staged.mods.active))]);
            const path = join(context.stateRoot, 'mods', 'load-order.json');
            const preferred = await context.snapshots.pathExists(path) ? array(await context.snapshots.readJson(path)) : [];
            staged.mods.order = topological([...preferred.filter(id => ids.has(id)), ...sorted([...ids].filter(id => !preferred.includes(id)))], active);
            changed = true;
        }
    }
    else {
        const versionKey = (value: string) => value.split('.').map(Number);
        packages.sort((a, b) => { const x = versionKey(a.version), y = versionKey(b.version); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });
        const latest = new Map<string, Row>();
        for (const mod of packages)
            if (mod.compatible)
                latest.set(mod.id, mod);
        const active = [...latest.values()].filter(mod => Object.hasOwn(defaults, mod.id) ? truth(defaults[mod.id]) : mod.default_enabled);
        await assertSupported(active);
        staged.mods = {
            game_api: 'pipicoc.game.v1',
            active: {},
            state: {},
            pending: {}
        };
        for (const [id, mod] of latest)
            staged.mods.active[id] = {
                version: mod.version,
                digest: mod.digest,
                state_version: mod.state_version,
                enabled: Object.hasOwn(defaults, id) ? defaults[id] : mod.default_enabled,
                settings: clone(mod.settings)
            };
        const path = join(context.stateRoot, 'mods', 'load-order.json'), ids = new Set(packages.map(p => p.id));
        const preferred = await context.snapshots.pathExists(path) ? array(await context.snapshots.readJson(path)) : [];
        staged.mods.order = topological([...preferred.filter(id => ids.has(id)), ...sorted([...ids].filter(id => !preferred.includes(id)))], active);
        await activeMods(context, staged);
        retained = [...latest.values()];
        changed = true;
    }
    return {
        world: staged,
        changed,
        async install() {
            for (const mod of retained) {
                const target = join(context.stateRoot, 'mods', 'packages', mod.id, mod.version);
                if (await context.snapshots.pathExists(target))
                    continue;
                const stage = join(context.stateRoot, 'mods', 'imports', randomUUID().replaceAll('-', ''));
                await mkdir(stage, {
                    recursive: true
                });
                for (const [name, bytes] of mod.files as Map<string, Buffer>) {
                    const path = join(stage, name);
                    await mkdir(dirname(path), {
                        recursive: true
                    });
                    await writeFile(path, bytes);
                }
                await mkdir(dirname(target), {
                    recursive: true
                });
                await rename(stage, target);
            }
        }
    };
}
export function preflightCampaign(meta: Row, world: Row, turn: Row, party: Row[], available: {
    libraryWriteBack?: boolean;
    modManagement?: boolean;
    worldlines?: boolean;
} = {}): void {
    if (!available.libraryWriteBack && party.some(sheet => typeof row(sheet.origin).library_id === 'string' && sheet.origin.library_id))
        missingContribution('investigator library writeback');
    const name = typeof meta.active_worldline === 'string' && meta.active_worldline ? meta.active_worldline : 'main';
    const lines = row(meta.worldlines), line = row(lines[name]);
    if (!available.worldlines && (name !== 'main' || truth(turn.worldline) || Object.keys(lines).some(id => id !== 'main') || line.kind && line.kind !== 'main'))
        missingContribution('worldline transition');
    if (!available.modManagement && (truth(row(world.mods).pending) || Object.hasOwn(row(world.mods), 'pending_order')))
        missingContribution('pending Mod configuration');
}
const emptyNpc = (): Row => ({
    stance: null,
    disclosed: [],
    exchanged: [],
    interactions: [],
    promises: [],
    said: [],
    skills: {},
    turns_present: null
});
function entry(ledger: Row, id: string): Row {
    if (!ledger[id] || typeof ledger[id] !== 'object' || Array.isArray(ledger[id]))
        ledger[id] = emptyNpc();
    return ledger[id];
}
function npcId(graph: ModuleGraph, value: any): string | null {
    if (typeof value !== 'string' || !value.trim())
        return null;
    const node = graph.nodes.get(value) || graph.find(value, ['npc']);
    return node?.node_kind === 'npc' ? node.node_id : null;
}
const intLike = (value: any): boolean => integer(value) || typeof value === 'boolean';
export async function stanceTable(context: KernelContext): Promise<Row> {
    const table = row(await context.snapshots.readJson(join(context.content, 'rulesets', 'coc7', 'rules-json', 'npc-stance.json')));
    if (table.contract_id !== 'coc.npc-stance.v1')
        throw new RpcError('campaign_not_ready', 'npc-stance does not declare coc.npc-stance.v1', {
            fix: 'restore content/rulesets/coc7/rules-json/npc-stance',
            details: {
                stance: {
                    declared: table.contract_id ?? null
                }
            },
        });
    return table;
}
function setStance(item: Row, table: Row, value: number, turn: number, receipt: any, because: Row): void {
    const old = row(item.stance), score = Math.max(number(table.score_range[0]), Math.min(number(table.score_range[1]), Math.trunc(value)));
    const word = array(table.levels).find(level => score <= number(level.at_most))?.value ?? array(table.levels).at(-1)?.value ?? 'neutral';
    item.stance = {
        value: word,
        score,
        since_turn: old.value !== word ? turn : old.since_turn ?? turn,
        because: [...array(old.because), {
                ...because,
                turn,
                receipt: receipt ?? null
            }].slice(-3)
    };
}
export function foldNpcTurn(ledger: Row, graph: ModuleGraph, record: Row, table: Row): void {
    const turn = number(record.turn);
    for (const receipt of array(record.receipts)) {
        const kind = receipt.kind;
        if (kind === 'roll') {
            const against = npcId(graph, receipt.npc), actor = npcId(graph, receipt.actor);
            const family = ['social', 'combat', 'chase', 'psychology'].includes(receipt.family || receipt.roll_kind) ? receipt.family || receipt.roll_kind : null;
            for (const [id, target] of [[against, true], [actor, false]] as const) {
                if (!id || id === against && !target)
                    continue;
                const item = entry(ledger, id), approach = receipt.approach;
                item.interactions.push({
                    turn,
                    kind: family || 'social',
                    receipt: receipt.id ?? null,
                    level: receipt.level ?? null,
                    ...(typeof approach === 'string' ? {
                        approach
                    } : {})
                });
                if (!target)
                    continue;
                if (family === 'combat') {
                    setStance(item, table, number(table.combat_target_score), turn, receipt.id, {
                        how: 'combat'
                    });
                    continue;
                }
                if (family !== 'social' && !(typeof approach === 'string' && Object.hasOwn(row(table.social), approach)))
                    continue;
                const raw = row(row(table.social)[string(approach || '')])[string(receipt.level || '')];
                let delta = intLike(raw) ? number(raw) : 0;
                if (truth(receipt.pushed) && !truth(receipt.passed))
                    delta += number(table.pushed_failure_delta);
                if (delta)
                    setStance(item, table, (intLike(row(item.stance).score) ? number(item.stance.score) : number(table.initial_score)) + delta, turn, receipt.id, {
                        how: 'social',
                        approach: approach ?? null,
                        level: receipt.level ?? null,
                        delta
                    });
            }
        }
        else if (kind === 'clue' || kind === 'item' || kind === 'cash') {
            const id = npcId(graph, kind === 'cash' ? receipt.with : receipt.from);
            if (!id)
                continue;
            const item = entry(ledger, id);
            if (kind === 'clue' && !item.disclosed.some((r: Row) => r.clue === receipt.clue))
                item.disclosed.push({
                    clue: receipt.clue ?? null,
                    turn,
                    receipt: receipt.id ?? null
                });
            if (kind === 'item')
                item.exchanged.push({
                    item: receipt.label || receipt.name || null,
                    turn,
                    receipt: receipt.id ?? null
                });
            if (kind === 'cash') {
                const quick = receipt.settlement === 'spending_level';
                item.exchanged.push({
                    cash: quick ? receipt.purchase_amount ?? null : intLike(receipt.delta) ? Math.abs(number(receipt.delta)) : receipt.delta ?? null,
                    direction: quick || intLike(receipt.delta) && number(receipt.delta) < 0 ? 'paid' : 'received',
                    ...(quick ? { settlement: 'spending_level' } : {}),
                    currency: receipt.currency ?? null,
                    turn,
                    receipt: receipt.id ?? null
                });
            }
        }
        else if (kind === 'npc') {
            const id = npcId(graph, receipt.npc || receipt.name);
            if (!id)
                continue;
            const item = entry(ledger, id), levels = array(table.levels);
            let floor = number(table.score_range[0]);
            for (const level of levels) {
                if (receipt.stance === level.value) {
                    setStance(item, table, floor, turn, receipt.id, {
                        how: 'keeper',
                        stance: receipt.stance,
                        why: receipt.why ?? null
                    });
                    break;
                }
                floor = number(level.at_most) + 1;
            }
            if (typeof row(receipt.skill).name === 'string')
                item.skills[receipt.skill.name] = {
                    value: receipt.skill.value ?? null,
                    turn,
                    receipt: receipt.id ?? null,
                    ...(typeof receipt.why === 'string' ? {
                        why: receipt.why
                    } : {})
                };
            if (receipt.dead === true)
                item.dead = {
                    turn,
                    receipt: receipt.id ?? null,
                    ...(typeof receipt.why === 'string' ? {
                        why: receipt.why
                    } : {})
                };
            else if (receipt.dead === false)
                item.dead = null;
        }
        else if (kind === 'delta' && receipt.resource === 'hp' && intLike(receipt.after) && number(receipt.after) <= 0) {
            const id = npcId(graph, receipt.subject);
            if (id) {
                const item = entry(ledger, id);
                if (!Object.hasOwn(item, 'dead'))
                    item.dead = {
                        turn,
                        receipt: receipt.id ?? null
                    };
            }
        }
    }
    // Who spoke this turn (contract §40.3): a resolved say span names a person by handle.
    for (const line of array(record.speech)) {
        const id = npcId(graph, row(row(line).who).npc);
        if (!id)
            continue;
        const item = entry(ledger, id), spoke = row(item.spoke);
        if (spoke.last_turn === turn)
            continue;
        item.spoke = { turns: number(spoke.turns) + 1, last_turn: turn };
    }
    for (const name of array(row(record.world).present)) {
        const id = npcId(graph, name);
        if (!id)
            continue;
        const item = entry(ledger, id), seen = item.turns_present;
        if (!seen || typeof seen !== 'object' || Array.isArray(seen))
            item.turns_present = {
                first: turn,
                last: turn,
                count: 1
            };
        else if (seen.last !== turn) {
            seen.last = turn;
            seen.count = number(seen.count) + 1;
            if (!Object.hasOwn(seen, 'first'))
                seen.first = turn;
        }
    }
}
export async function readNpcLedger(campaign: CampaignWriter): Promise<Row> {
    try {
        return await campaign.read('npc-ledger.json');
    }
    catch {
        return {};
    }
}
export async function updateNpcLedger(campaign: CampaignWriter, graph: ModuleGraph, record: Row): Promise<void> {
    const ledger = await readNpcLedger(campaign);
    foldNpcTurn(ledger, graph, record, await stanceTable(campaign.context));
    await campaign.write('npc-ledger.json', ledger);
}
export async function rebuildNpcLedger(campaign: CampaignWriter, graph: ModuleGraph): Promise<void> {
    const ledger: Row = {}, table = await stanceTable(campaign.context);
    const names = await campaign.context.snapshots.sortedChildNames(campaign.path('turns'), path => campaign.context.snapshots.isFile(path));
    for (const name of names.filter(n => n.endsWith('.json'))) {
        let record: Row;
        try {
            record = await campaign.read(join('turns', name));
        }
        catch {
            continue;
        }
        if (intLike(record.turn))
            foldNpcTurn(ledger, graph, record, table);
    }
    noteMemory(ledger, graph, (await campaign.context.snapshots.readJsonl(campaign.path('memory/candidates.jsonl'))).map(row));
    await campaign.write('npc-ledger.json', ledger);
}
export function noteMemory(ledger: Row, graph: ModuleGraph, candidates: Row[]): void {
    for (const candidate of candidates) {
        const memory = row(candidate), turn = Object.hasOwn(memory, 'valid_from_turn') ? memory.valid_from_turn : memory.turn ?? null;
        const ids = memory.kind === 'promise' ? [memory.subject] : ['knowledge', 'belief'].includes(memory.kind) ? array(memory.knowers) : [];
        for (const name of ids) {
            const id = npcId(graph, name);
            if (!id || !truth(memory.id))
                continue;
            const list = entry(ledger, id)[memory.kind === 'promise' ? 'promises' : 'said'];
            if (!list.some((item: Row) => item.memory_id === memory.id))
                list.push({
                    memory_id: memory.id,
                    turn
                });
        }
    }
}
export function episode(record: Row): Row {
    const snapshot = row(record.world), receipts = array(record.receipts);
    return {
        episode_id: `ep:t${record.turn}`,
        turn: number(record.turn),
        commit: record.commit ?? null,
        scene: row(snapshot.scene).name ?? null,
        present: [...array(snapshot.present)],
        investigators: array(snapshot.investigators).map(i => string(i.id)),
        receipts: receipts.map(r => r.id),
        clues_discovered: receipts.filter(r => r.kind === 'clue').map(r => r.label || r.clue || null),
        player_chars: Array.from(record.player_text || '').length,
        keeper_chars: Array.from(record.rendered_text || '').length,
        at: nowIso()
    };
}
export function writeEpisode(campaign: CampaignWriter, record: Row): Promise<void> { return appendJsonl(campaign.path('memory/episodes.jsonl'), episode(record)); }
