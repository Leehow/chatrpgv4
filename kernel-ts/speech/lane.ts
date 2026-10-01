/**
 * Contract §165.2: who supplies the NPC speech edit lane's words.
 *
 * The base owns the mechanism and no wording. A package names one Markdown file in `contributes.speech_edit_lane`: the
 * lane's instruction and its demonstrations, frozen with the package version like every package file (§26). The lane
 * runs for a campaign only when exactly one enabled package contributes it; none means no lane, two or more means the
 * lane does not run and the contributors are named. Which packages are enabled is the campaign's own locks, so a
 * language-scoped package (§153) applies wherever its lock is on; nothing here reads a language.
 */
import { RpcError } from "../errors.js";
import { array, row, string, type Row } from "../read/values.js";

/** Contract §165.9: a package contributing the lane requires this, so a build that predates the lane marks it
 *  incompatible (§28.9) instead of refusing an unknown contribution. */
export const SPEECH_EDIT_LANE_CAPABILITY = "speech.edit.lane.v1";

const decode = (bytes: Uint8Array): string => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const label = (manifest: Row): string => `${string(manifest.id ?? "?")} ${string(manifest.version ?? "?")}`;
function refuse(manifest: Row, reason: string, message: string, fix: string): never {
    throw new RpcError("invalid_params", `${label(manifest)}: ${message}`, {
        fix,
        details: { mod: string(manifest.id ?? "?"), version: string(manifest.version ?? "?"), field: "contributes.speech_edit_lane", reason },
    });
}

/** Checked with the rest of the manifest (`manifestFrom`), once the contribution path is known to name a package file. */
export function validateSpeechEditLaneDeclaration(manifest: Row, files: ReadonlyMap<string, Uint8Array>): void {
    const path = row(manifest.contributes).speech_edit_lane;
    if (path == null)
        return;
    if (!array(manifest.requires).includes(SPEECH_EDIT_LANE_CAPABILITY))
        refuse(manifest, "speech_edit_lane_capability", `contributes.speech_edit_lane needs ${SPEECH_EDIT_LANE_CAPABILITY} in requires`,
            `add ${SPEECH_EDIT_LANE_CAPABILITY} to requires, or remove contributes.speech_edit_lane`);
    let text = "";
    try { text = decode(files.get(string(path))!).trim(); }
    catch { text = ""; }
    if (!text)
        refuse(manifest, "speech_edit_lane_text", "contributes.speech_edit_lane must name non-empty UTF-8 Markdown",
            "write the lane's instruction and demonstrations into the named file, or remove contributes.speech_edit_lane");
}

export interface SpeechEditLaneOwner { mod: string; version: string; text: string }

/**
 * §165.2: every enabled package of the campaign that contributes the lane, in load order, with its file's text.
 * `active` is `activeMods`' answer (enabled, locked, in load order). The caller decides what one, none or several mean.
 */
export function speechEditLaneOwners(active: readonly Row[]): SpeechEditLaneOwner[] {
    const owners: SpeechEditLaneOwner[] = [];
    for (const mod of active) {
        const path = row(mod.contributes).speech_edit_lane;
        const files = mod.files instanceof Map ? mod.files as ReadonlyMap<string, Uint8Array> : undefined;
        if (typeof path !== "string" || !files?.has(path))
            continue;
        let text = "";
        try { text = decode(files.get(path)!).trim(); }
        catch { text = ""; }
        if (text)
            owners.push({ mod: string(mod.id), version: string(mod.version), text });
    }
    return owners;
}
