/**
 * §14.19.1: a recorded opening (`module.json` `opening_choice`) is a campaign's, held in that campaign's fork. The shared
 * library holds no table's opening: one stored there by older code (live7 du-1101b, cs-1101b: a setup's choice written to the
 * library and cloned into later forks) is ignored by every reader and dropped on the library's next write.
 *
 * The one opening the library does record is the book's own: a reference whose only entry is the book's, published with no
 * `start_scene` asked (§14.19.8 rule 1). It is marked `of: 'book'`; an unmarked library choice is always a table's.
 */
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { KernelContext } from '../context.js';
import { appendJsonl } from '../fileio.js';
import { row, string, truth, type Row } from '../read/values.js';
import { nowIso } from '../write/store.js';

/** The marker on an `opening_choice` that is the book's sole reference entry, not any table's choice. */
export const BOOK_OPENING = 'book';

/** Whether this module metadata is a campaign's fork (`campaign_scope`), not the shared library. */
export const isCampaignFork = (meta: Row): boolean => typeof meta?.campaign_scope === 'string' && meta.campaign_scope !== '';

/** Whether this `opening_choice` is the book's own opening (its sole reference entry), which the library may keep. */
export const isBookOpening = (choice: unknown): boolean => row(choice).of === BOOK_OPENING && truth(row(choice).start_scene);

/**
 * The opening this module metadata records: a fork's `opening_choice.start_scene`; on the library only the book's own
 * (`of: 'book'`), never a table's.
 */
export function ownOpeningChoice(meta: Row): string {
    const choice = row(meta?.opening_choice);
    if (!truth(choice.start_scene)) return '';
    return isCampaignFork(meta) || isBookOpening(choice) ? string(choice.start_scene) : '';
}

/** §14.19.1: drops a table's opening stored on the library; a fork's, and the library's book opening, are kept. */
export function dropForeignOpening(meta: Row): void {
    if (!ownOpeningChoice(meta)) delete meta.opening_choice;
}

const reported = new Set<string>();

/** The campaign's recorded opening and node handles, remembered per campaign file stamps (mtime + size) so a steady-state read costs two stats. */
const anchors = new Map<string, { stamp: string; opening: string; handles: Row }>();

async function campaignAnchor(context: KernelContext, directory: string): Promise<{ opening: string; handles: Row }> {
    const stamp = async (name: string): Promise<string> => {
        try { const info = await stat(join(directory, name)); return `${info.mtimeMs}:${info.size}`; } catch { return ''; }
    };
    const key = `${context.stateRoot}\u0000${directory}`, now = `${await stamp('campaign.json')}|${await stamp('world.json')}`, known = anchors.get(key);
    if (known?.stamp === now) return known;
    const read = async (name: string): Promise<Row> =>
        await context.snapshots.pathExists(join(directory, name)) ? row(await context.snapshots.readJson(join(directory, name))) : {};
    const saved = await read('campaign.json'), world = await read('world.json');
    const entry = { stamp: now, opening: typeof saved.opening_scene === 'string' ? saved.opening_scene : '',
        handles: { ...row(row(saved.setup).node_handles), ...row(world.node_handles) } };
    anchors.set(key, entry);
    return entry;
}

/**
 * §14.19.10: a fork made before 14.19.8 may still hold the opening it cloned from the library (live7 du-1101b: entry-2
 * against a campaign on entry-1). On every read of a fork's metadata the campaign's own opening (`campaign.json`
 * `opening_scene`, as a node id: the scene id itself, else back through the `node_handles` the campaign recorded) wins
 * over a differing `opening_choice`, and one `fork_opening_mismatch` telemetry row is appended per campaign and module per
 * process. A campaign that names no opening, or one that cannot be placed on a scene of the graph, leaves the fork's value.
 * `sceneIds` loads the book's scene ids, and is asked only on a mismatch the handles cannot settle.
 */
export async function anchorForkOpening(context: KernelContext, meta: Row, sceneIds: () => Promise<Set<string>>): Promise<void> {
    // Advisory: a missing campaign/world/graph file or any read failure leaves the metadata as it was, so the caller's own checks speak.
    const original = meta.opening_choice;
    try { await anchorForkOpeningUnchecked(context, meta, sceneIds); } catch { if (original === undefined) delete meta.opening_choice; else meta.opening_choice = original; }
}

async function anchorForkOpeningUnchecked(context: KernelContext, meta: Row, sceneIds: () => Promise<Set<string>>): Promise<void> {
    if (!isCampaignFork(meta) || !truth(row(meta.opening_choice).start_scene)) return;
    const campaign = string(meta.campaign_scope), moduleId = string(meta.id), fork = string(row(meta.opening_choice).start_scene);
    const directory = join(context.campaignsRoot, campaign), { opening, handles } = await campaignAnchor(context, directory);
    if (!opening || opening === fork) return;
    if (handles[fork] === opening) return;
    let target = Object.keys(handles).find(id => handles[id] === opening) ?? '';
    if (!target) { const scenes = await sceneIds(); if (scenes.has(opening)) target = opening; }
    if (!target || target === fork) return;
    meta.opening_choice = { start_scene: target, at: nowIso() };
    const key = `${campaign}\u0000${moduleId}`;
    if (reported.has(key)) return;
    reported.add(key);
    await appendJsonl(join(directory, 'telemetry.jsonl'), { at: nowIso(), lane: 'reading', event: 'fork_opening_mismatch',
        campaign, module_id: moduleId, fork_choice: fork, campaign_opening: target });
}
