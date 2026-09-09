/** The checkpoint follows committed history and is rebuilt only when it disagrees. */
import { jsonDigest } from '../json.js';
import { row, array, number, integer, truth, string, clone, type Row } from '../read/values.js';
import { CampaignWriter, freshTurn, nowIso } from './store.js';
import { head } from './history.js';
import { oneLine } from './text.js';
const PATH = 'save/continuation/latest.json';
const intLike = (value: any): boolean => integer(value) || typeof value === 'boolean';
export async function readCheckpoint(campaign: CampaignWriter): Promise<Row | null> {
    try {
        const value = await campaign.read(PATH);
        return intLike(value.turn) && truth(value.commit) ? value : null;
    }
    catch {
        return null;
    }
}
export function checkpointFromRecord(campaign: string, record: Row, fallback: Row, worldline: string | null = null): Row {
    const snapshot = record.world && typeof record.world === 'object' && !Array.isArray(record.world) ? record.world : fallback;
    const scene = row(snapshot.scene),
        session = snapshot.session;
    return {
        schema: 1,
        campaign,
        worldline,
        turn: number(record.turn),
        commit: record.commit ?? null,
        at: nowIso(),
        scene: {
            name: scene.name ?? null,
            display_name: scene.display_name ?? null
        },
        clock: {
            minutes: Math.trunc(number(row(snapshot.clock).minutes))
        },
        investigators: [...array(snapshot.investigators)],
        session: session && typeof session === 'object' && !Array.isArray(session)
            ? {
                kind: session.kind ?? null,
                status: session.status ?? null,
                round: session.round ?? null
            } : null,
        pending_choice: Object.hasOwn(snapshot, 'pending_choice') ? snapshot.pending_choice : record.pending_choice ?? null,
        receipts_digest: jsonDigest(array(record.receipts)),
        one_line: oneLine(number(record.turn), snapshot, record.rendered_text)
    };
}
export const writeCheckpoint = (campaign: CampaignWriter, checkpoint: Row): Promise<void> => campaign.write(PATH, checkpoint);
export async function syncCheckpoint(campaign: CampaignWriter, snapshot: Row, worldline: string): Promise<[
    Row | null,
    boolean
]> {
    const checkpoint = await readCheckpoint(campaign),
        current = await head(campaign.context, campaign.id);
    if (current.sha == null || current.turn == null)
        return [checkpoint, false];
    if (checkpoint?.commit === current.sha && checkpoint.turn === current.turn)
        return [checkpoint, false];
    const record = await campaign.readTurnRecord(current.turn);
    if (!record || record.closed_by !== 'narrate')
        return [checkpoint, false];
    if (record.commit !== current.sha) {
        record.commit = current.sha;
        await campaign.writeTurnRecord(record);
    }
    const rebuilt = checkpointFromRecord(campaign.id, record, snapshot, worldline);
    await writeCheckpoint(campaign, rebuilt);
    return [rebuilt, true];
}
export async function readableTurn(campaign: CampaignWriter): Promise<Row | null> {
    try {
        const turn = await campaign.readTurn();
        return intLike(turn.turn) && typeof turn.state === 'string' ? turn : null;
    }
    catch {
        return null;
    }
}
export async function rebuildTurn(campaign: CampaignWriter, checkpoint: Row | null): Promise<Row | null> {
    const records = await campaign.records();
    let turn: Row;
    if (!checkpoint) {
        if (records.length || (await head(campaign.context, campaign.id)).turn != null)
            return null;
        turn = freshTurn(0);
    }
    else {
        const asked = records.filter(record => number(record.turn) > number(checkpoint.turn) && record.closed_by === 'ask').sort((a, b) => number(a.turn) - number(b.turn)).at(-1);
        turn = asked ? freshTurn(number(asked.turn), 'asked', asked.pending_choice ?? null) : freshTurn(number(checkpoint.turn) + 1);
    }
    await campaign.writeTurn(turn);
    return turn;
}
export function resumeView(checkpoint: Row | null, rebuilt: boolean): Row | null {
    if (!checkpoint)
        return null;
    return {
        turn: checkpoint.turn,
        commit: checkpoint.commit,
        worldline: checkpoint.worldline ?? null,
        scene: checkpoint.scene ?? null,
        clock: checkpoint.clock ?? null,
        session: checkpoint.session ?? null,
        one_line: checkpoint.one_line ?? null,
        rebuilt
    };
}
