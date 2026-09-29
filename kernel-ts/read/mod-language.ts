/**
 * Contract §153: a language-scoped Mod.
 *
 * The play language is open (§23): the base registers no language, and a package that exists for one names its own
 * tags in `play_languages`. The kernel checks only their shape and compares them with the tag a campaign was created
 * with, never with text. Three things follow from the declaration, and all of them live here:
 *
 * - a fresh world enables the package by default only for a campaign whose declared tag it names (§153.2);
 * - its per-turn instruction is measured against its own ceiling, outside the shared one over every other brief (§153.4);
 * - independently of the declaration, a package requiring `npc.voice.language-addendum.v1` may add a Markdown file to
 *   the voice lane's instruction, after the lane owner's own words (§153.3).
 */
import { RpcError } from "../errors.js";
import { validSourceLanguage } from "../modules/contract.js";
import { array, row, string, type Row } from "./values.js";

export const LANGUAGE_ADDENDUM_CAPABILITY = "npc.voice.language-addendum.v1";
/** Contract §153.4: the UTF-8 bytes one language-scoped package may add to every later turn's capsule. */
export const LANGUAGE_BRIEF_BYTES = 400;

const label = (manifest: Row): string => `${string(manifest.id ?? "?")} ${string(manifest.version ?? "?")}`;
function refuse(manifest: Row, field: string, reason: string, message: string, fix: string, details: Row = {}): never {
    throw new RpcError("invalid_params", `${label(manifest)}: ${message}`, {
        fix,
        details: { mod: string(manifest.id ?? "?"), version: string(manifest.version ?? "?"), field, reason, ...details },
    });
}
const decode = (bytes: Uint8Array): string => new TextDecoder("utf-8", { fatal: true }).decode(bytes);

/** Whether the manifest scopes itself to play languages. Shape is checked at load, so a declared list is a valid one. */
export const declaresLanguages = (mod: Row | null | undefined): boolean => Array.isArray(row(mod).play_languages);

/**
 * §153.2: whether a package may be on by default in a fresh world for a campaign declared in `tag`. A package that
 * declares no `play_languages` is not scoped. A listed tag matches the campaign's tag when it is that tag or a prefix of
 * it ending at a subtag boundary (RFC 4647 basic filtering, case-insensitive as BCP 47 tags are): `zh` matches `zh`,
 * `zh-Hans` and `zh-Hant`; `zh-Hans` matches `zh-Hans` and `zh-Hans-CN`, never `zh-Hant`. No declared tag (`null`, a
 * campaign from before the language was recorded) matches nothing; the data default is never substituted for it.
 */
export function languageAdmits(mod: Row | null | undefined, tag: string | null): boolean {
    if (!declaresLanguages(mod))
        return true;
    if (tag == null)
        return false;
    const campaign = tag.toLowerCase();
    return array(row(mod).play_languages).some(listed => {
        const scope = string(listed).toLowerCase();
        return campaign === scope || campaign.startsWith(`${scope}-`);
    });
}

/**
 * Checked with the rest of the manifest (`manifestFrom`), after the contribution paths are known to name package files:
 * the shape of `play_languages`, the addendum's capability and text, and a language-scoped package's per-turn bytes.
 */
export function validateLanguageDeclaration(manifest: Row, files: ReadonlyMap<string, Uint8Array>): void {
    const contributes = row(manifest.contributes);
    if (Object.hasOwn(manifest, "play_languages")) {
        const tags = manifest.play_languages;
        if (!Array.isArray(tags) || !tags.length || tags.some(tag => !validSourceLanguage(tag))
            || new Set(tags.map(tag => string(tag).toLowerCase())).size !== tags.length)
            refuse(manifest, "play_languages", "play_languages_shape",
                "play_languages must be a non-empty list of distinct BCP 47 language tags",
                "name each play language this package is for as a language tag such as zh or pt-BR, once; the set is open and nothing is registered, or drop the field to leave the package unscoped",
                { value: tags ?? null });
    }
    const addendum = contributes.voice_lane_addendum;
    if (addendum != null) {
        if (!array(manifest.requires).includes(LANGUAGE_ADDENDUM_CAPABILITY))
            refuse(manifest, "contributes.voice_lane_addendum", "voice_lane_addendum_capability",
                `contributes.voice_lane_addendum needs ${LANGUAGE_ADDENDUM_CAPABILITY} in requires`,
                `add ${LANGUAGE_ADDENDUM_CAPABILITY} to requires, or remove contributes.voice_lane_addendum`);
        let text = "";
        try { text = decode(files.get(addendum)!).trim(); }
        catch { text = ""; }
        if (!text)
            refuse(manifest, "contributes.voice_lane_addendum", "voice_lane_addendum_text",
                "contributes.voice_lane_addendum must name non-empty UTF-8 Markdown",
                "write the addendum's lines into the named file, or remove contributes.voice_lane_addendum");
    }
    if (!declaresLanguages(manifest))
        return;
    // §30.7: a later turn carries the brief when there is one, the full instruction otherwise; that is what rides every turn.
    const field = contributes.brief != null ? "brief" : contributes.instructions != null ? "instructions" : null;
    if (field == null)
        return;
    const path = string(contributes[field]), bytes = files.get(path)?.length ?? 0;
    if (bytes > LANGUAGE_BRIEF_BYTES)
        refuse(manifest, `contributes.${field}`, "language_brief_over_budget",
            `the per-turn instruction ${path} is ${bytes} UTF-8 bytes; a package that declares play_languages carries at most ${LANGUAGE_BRIEF_BYTES} bytes each turn`,
            field === "brief"
                ? `shorten ${path} to ${LANGUAGE_BRIEF_BYTES} bytes or fewer; the full instruction still rides the first turn`
                : `add a contributes.brief of ${LANGUAGE_BRIEF_BYTES} bytes or fewer, or shorten ${path} to that size`,
            { path, bytes, limit: LANGUAGE_BRIEF_BYTES });
}

/**
 * §153.3: the voice lane's instruction for a campaign: the owner's `voice_lane` text, then the addendum of every
 * enabled package that contributes one, in load order, each under a heading naming the package. `active` is
 * `activeMods`' answer for the campaign: enabled, locked, in load order.
 */
export function withLanguageAddenda(instruction: string, active: readonly Row[]): string {
    const parts = [instruction];
    for (const mod of active) {
        const path = row(mod.contributes).voice_lane_addendum, files = mod.files instanceof Map ? mod.files as ReadonlyMap<string, Uint8Array> : undefined;
        if (typeof path !== "string" || !files?.has(path))
            continue;
        parts.push(`## Language addendum: ${string(mod.id)}\n\n${decode(files.get(path)!).trim()}`);
    }
    return parts.join("\n\n");
}
