/** Campaign writes and remembered calls; each RPC reloads authoritative disk state. */
import { readFile, unlink } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import type { KernelContext } from '../context.js';
import type { JsonObject, JsonValue, ReadonlyJson } from '../json.js';
import { jsonDigest, isJsonObject } from '../json.js';
import { appendJsonl, writeJsonAtomic } from '../fileio.js';
import { RpcError } from '../errors.js';
import type { CampaignWritePort, DomainEvent, ResolveCommit, TurnTransaction, WriteMethod, WriteStart } from '../transactions.js';
import { clone, array, row, number, string, repr, type Row } from '../read/values.js';
export const nowIso = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
export const freshTurn = (turn: number, state = 'awaiting_player', pending: Row | null = null): Row => ({
    turn,
    state,
    player_text: null,
    opened_at: nowIso(),
    calls: {},
    receipts: [],
    pending_choice: pending,
});
export const missingContribution = (name: string): never => {
    throw new RpcError('not_implemented', `The ${name} contribution is not implemented in the TypeScript transaction runtime`);
};
export function required(params: Row, key: string, optional = false): string | null {
    const value = params[key];
    if (value == null) {
        if (optional)
            return null;
        throw new RpcError('invalid_params', `params.${key} must be a non-empty string`);
    }
    if (typeof value !== 'string' || !value.trim())
        throw new RpcError('invalid_params', `params.${key} must be a non-empty string`);
    return value;
}
export function parseCallId(value: any): [
    number,
    number
] {
    const match = typeof value === 'string' ? /^t(\d+)-c(\d+)$/.exec(value) : null;
    if (!match)
        throw new RpcError('invalid_params', 'call_id must look like t<turn>-c<n>', {
            fix: 'the extension mints call_id; the model never writes it',
            details: {
                call_id: value ?? null
            },
        });
    return [Number(match[1]), Number(match[2])];
}
export function turnStateError(turn: Row, method: string, allowed: string): RpcError {
    return new RpcError('turn_state', `${method} is not allowed while the turn is ${repr(turn.state)}`, {
        fix: allowed,
        details: {
            turn: turn.turn,
            state: turn.state
        },
    });
}
export const EVENT_TYPES: ReadonlySet<string> = new Set(['turn-started', 'player-declared', 'roll-resolved', 'scene-moved', 'clue-discovered', 'time-advanced',
    'turn-finalized', 'resource-changed', 'decision-settled', 'session-changed', 'choice-asked', 'memory-written', 'setup-completed',
    'handout-shown', 'item-transferred', 'definition-created', 'definition-queued', 'ability-acquired', 'flag-set', 'note-written', 'ruling-made',
    'npc-changed', 'dossier-established', 'journal-written', 'worldline-forked', 'worldline-switched', 'worldline-merged', 'adaptation-accepted',
    'turn-stranded']);
export class CampaignWriter implements CampaignWritePort {
    readonly directory: string;
    constructor(readonly context: KernelContext, readonly id: string) { this.directory = join(context.campaignsRoot, id); }
    path(name: string): string { return join(this.directory, name); }
    async read(name: string): Promise<Row> { return clone(row(await this.context.snapshots.readJson(this.path(name)))); }
    write(name: string, value: Row): Promise<void> { return writeJsonAtomic(this.path(name), value); }
    readCampaign() { return this.read('campaign.json'); }
    readWorld() { return this.read('world.json'); }
    readTurn() { return this.read('turn.json'); }
    private savePath(name: string): string {
        const root = join(this.directory, 'save'), target = resolve(root, name), path = relative(root, target);
        if (!name || !path || path === '..' || path.startsWith('..' + sep))
            throw new RpcError('invalid_params', 'Save document must remain inside its campaign save directory');
        return target;
    }
    async readSave(name: string): Promise<JsonValue | null> {
        const path = this.savePath(name);
        return await this.context.snapshots.pathExists(path) ? clone(await this.context.snapshots.readJson(path)) as JsonValue : null;
    }
    writeSave(name: string, value: ReadonlyJson): Promise<void> { return writeJsonAtomic(this.savePath(name), value); }
    async removeSave(name: string): Promise<void> {
        try { await unlink(this.savePath(name)); }
        catch(error){ if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error; }
    }
    saveExists(name: string): Promise<boolean> { return this.context.snapshots.pathExists(this.savePath(name)); }
    saveDirectories(name: string): Promise<string[]> {
        return this.context.snapshots.sortedChildNames(this.savePath(name), path => this.context.snapshots.isDirectory(path));
    }
    writeCampaign(value: Row) { return this.write('campaign.json', value); }
    writeWorld(value: Row) { return this.write('world.json', value); }
    writeTurn(value: Row) { return this.write('turn.json', value); }
    writeSheet(value: Row) { return this.write(join('party', `${value.id}.json`), value); }
    recordName(turn: number): string { return join('turns', `${String(turn).padStart(4, '0')}.json`); }
    async readTurnRecord(turn: number): Promise<Row | null> {
        const path = this.recordName(turn);
        return await this.context.snapshots.pathExists(this.path(path)) ? this.read(path) : null;
    }
    writeTurnRecord(value: Row) { return this.write(this.recordName(number(value.turn)), value); }
    async files(folder: string): Promise<Row[]> {
        const names = await this.context.snapshots.sortedChildNames(this.path(folder), path => this.context.snapshots.isFile(path));
        return Promise.all(names.filter(name => name.endsWith('.json')).map(name => this.read(join(folder, name))));
    }
    party() { return this.files('party'); }
    records() { return this.files('turns'); }
    async appendTranscript(turn: number, role: 'player' | 'keeper', text: string): Promise<Row> {
        const entry = {
            turn,
            role,
            text,
            at: nowIso()
        };
        await appendJsonl(this.path('transcript.jsonl'), entry);
        return entry;
    }
    async appendEvent(turn: number, event: DomainEvent, callId?: string): Promise<void> {
        if (!EVENT_TYPES.has(event.type))
            throw new Error(`unknown event type ${event.type}`);
        let count = 0;
        try {
            count = (await readFile(this.path('events.jsonl'), 'utf8')).split('\n').filter(line => line.trim()).length;
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
                throw error;
        }
        await appendJsonl(this.path('events.jsonl'), {
            seq: count + 1,
            turn,
            type: event.type,
            at: nowIso(),
            ...(callId != null ? {
                call_id: callId
            } : {}),
            ...(event.receipt != null ? {
                receipt: event.receipt
            } : {}),
            data: event.data
        });
    }
    telemetry(value: Row) {
        return appendJsonl(this.path('telemetry.jsonl'), {
            at: nowIso(),
            ...value
        });
    }
    async replay(turn: Row, callId: string, params: Row): Promise<Row | null> {
        let stored = row(turn.calls)[callId];
        if (stored == null)
            stored = row((await this.readTurnRecord(parseCallId(callId)[0]))?.calls)[callId];
        if (stored == null)
            return null;
        if (stored.params_sha256 !== jsonDigest(params))
            throw new RpcError('idempotency_conflict', `call_id ${callId} was already used with different params`, {
                fix: 'mint a new call_id for a new call',
                details: {
                    call_id: callId
                },
            });
        return {
            ...stored.result,
            replayed: true
        };
    }
}
export function rememberCall(turn: Row, callId: string, params: Row, result: Row): void {
    turn.calls ??= {};
    turn.calls[callId] = {
        params_sha256: jsonDigest(params),
        result,
        at: nowIso()
    };
}
export function createTurnTransaction(campaign: CampaignWriter, world: Row, turn: Row): TurnTransaction {
    return {
        campaign,
        world,
        turn,
        async beginWrite(method: WriteMethod, params: JsonObject, options = {}): Promise<WriteStart> {
            const [, ordinal] = parseCallId(params.call_id), callId = string(params.call_id);
            const replay = await campaign.replay(turn, callId, params);
            if (replay)
                return {
                    kind: 'replay',
                    result: replay
                };
            const meta = await campaign.readCampaign();
            if (meta.status === 'completed' && method !== 'table.ask' && method !== 'table.narrate') {
                const action = row(params.action), effects = array(params.effects), requested = string(action.decision || '').trim();
                const decision = requested.startsWith('decision:') ? requested : `decision:coc7:${requested}`;
                const accounting = method === 'table.resolve' && action.intent === 'montage'
                    && Object.keys(action).every(key => ['intent', 'goal', 'method', 'decision', 'ending', 'actor', 'scenario_san_reward_expr'].includes(key))
                    && ['decision:coc7:development:end-session', 'decision:coc7:development:settle-ending'].includes(decision);
                const correction = method === 'table.apply' && !Object.hasOwn(row(meta.ending), 'scope') && effects.length === 1
                    && isJsonObject(effects[0]) && effects[0].kind === 'ending' && effects[0].scope === 'chapter'
                    && Object.keys(effects[0]).every(key => ['kind', 'scope', 'summary'].includes(key));
                if (!accounting && !correction)
                    throw new RpcError('campaign_not_ready', 'this campaign is completed; only late development accounting is writable', {
                        fix: 'keep the ending intact; use explicit development:end-session or pending development:settle-ending with intent montage, then narrate',
                    });
            }
            const opening = options.allowOpening && number(turn.turn) === 0 && turn.state === 'awaiting_player';
            if (!['open', 'acting'].includes(turn.state) && !opening)
                throw turnStateError(turn, method, 'wait for player_input to open a turn');
            return {
                kind: 'new',
                callId,
                ordinal
            };
        },
        async touchActing() {
            if (turn.state === 'open') {
                turn.state = 'acting';
                await campaign.writeTurn(turn);
            }
        },
        async commitResolve(commit: ResolveCommit) {
            turn.receipts.push(...commit.receipts);
            turn.state = 'acting';
            rememberCall(turn, commit.callId, commit.params, commit.result);
            await campaign.writeTurn(turn);
            for (const event of commit.events)
                await campaign.appendEvent(number(turn.turn), event, commit.callId);
        },
    };
}
