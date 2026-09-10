/**
 * The play language is open (host decision 2026-09-09, contract section 23): any BCP-47-shaped tag
 * a player names is a play language, and nothing here validates membership, authors a table for a
 * tag, or guesses a language from text. `content/languages.json` holds only `default`, the tag a
 * campaign or session falls back to when it carries none, and `suggested`, the tags a picker offers
 * first. The shape is the one definition `validSourceLanguage` exports: the kernel has no second
 * pattern and no list of accepted tags.
 */
import { join } from "node:path";
import type { KernelContext } from "../context.js";
import { RpcError, internalError } from "../errors.js";
import { isJsonObject } from "../json.js";
import { validSourceLanguage } from "../modules/contract.js";
import { row, repr, type Row } from "./values.js";
export interface PlayLanguages {
    readonly default: string;
    /** The tags a picker offers first, in file order; free text is always accepted beside them. */
    readonly suggested: readonly string[];
}
const FILE = "languages.json";
const loaded = new WeakMap<KernelContext, Promise<PlayLanguages>>();
function contentError(message: string): RpcError {
    return new RpcError("campaign_not_ready", `content/${FILE} is not usable: ${message}`, {
        fix: `restore content/${FILE}: a \`default\` language tag and an optional \`suggested\` list of language tags`,
        details: { languages: { reason: message } },
    });
}
function parse(raw: unknown): PlayLanguages {
    if (!isJsonObject(raw))
        throw contentError("not a JSON object");
    if (!validSourceLanguage(raw.default))
        throw contentError("`default` is not a language tag");
    const listed = raw.suggested ?? [];
    if (!Array.isArray(listed))
        throw contentError("`suggested` is not a list");
    const suggested: string[] = [];
    for (const tag of listed) {
        if (!validSourceLanguage(tag))
            throw contentError(`suggested entry ${repr(tag)} is not a language tag`);
        suggested.push(tag);
    }
    return Object.freeze({ default: raw.default, suggested: Object.freeze(suggested) });
}
/** The default and the suggested tags, read once per kernel context through the same reader every content file uses. */
export function playLanguages(context: KernelContext): Promise<PlayLanguages> {
    let pending = loaded.get(context);
    if (!pending) {
        pending = context.snapshots.readJson(join(context.content, FILE)).then(parse, error => {
            if (error instanceof RpcError)
                throw error;
            throw contentError(`unreadable: ${internalError(error).message.replace(/^[A-Za-z]+Error: /, "")}`);
        });
        loaded.set(context, pending);
        void pending.catch(() => loaded.delete(context));
    }
    return pending;
}
export async function defaultPlayLanguage(context: KernelContext): Promise<string> {
    return (await playLanguages(context)).default;
}
/** `meta.play_language` when the campaign, draft or session carries a tag-shaped one, else the data default. */
export async function playLanguageOf(context: KernelContext, meta: Row | null | undefined): Promise<string> {
    const tag = row(meta).play_language;
    return validSourceLanguage(tag) ? tag : (await playLanguages(context)).default;
}
