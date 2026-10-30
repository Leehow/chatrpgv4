/**
 * Contract §276: whether a plain carried row is a writing surface, kept beside the equipment jobs so each row is asked once.
 * The host's Jev question writes these; so does the Keeper's own attempt to write in a row nobody has judged yet.
 */
import {jsonDigest} from '../json.js';
import {row, string, type Row} from '../read/values.js';
import type {CampaignWritePort} from '../transactions.js';

export const EQUIPMENT_PREPARATION = 'equipment-preparation.json';
export const SURFACE_VERSION = '1';
export const WRITING_SURFACES: readonly string[] = ['paper','notebook','book'];
export const surfaceKey = (actor: unknown, value: unknown): string => jsonDigest([actor,value] as Row[]);
/** The row's writing surface, or null where none was found: no verdict, a failed question or the answer `none`. */
export function writingSurfaceOf(ledger: Row, actor: unknown, value: unknown): string | null {
    const verdict = row(row(ledger.surfaces)[surfaceKey(actor,value)]);
    return verdict.version === SURFACE_VERSION && WRITING_SURFACES.includes(string(verdict.surface)) ? string(verdict.surface) : null;
}
/**
 * The Keeper wrote in a carried row no verdict covers (the host's question failed, or Jev is not configured): that attempt
 * is the evidence, so the row is kept as `paper` and the background preparation registers it. A row Jev answered keeps
 * its answer, `none` included. True when a verdict was written.
 */
export async function claimWritingSurface(campaign: CampaignWritePort, actor: string, value: unknown): Promise<boolean> {
    const ledger = row(await campaign.readSave(EQUIPMENT_PREPARATION) ?? {entries:{}}), judged = ledger.surfaces = row(ledger.surfaces),
        key = surfaceKey(actor,value);
    if (row(judged[key]).version === SURFACE_VERSION) return false;
    judged[key] = {actor,row:value as Row,surface:'paper',version:SURFACE_VERSION,source:'keeper_write'};
    await campaign.writeSave(EQUIPMENT_PREPARATION,{entries:{},...ledger});
    return true;
}
