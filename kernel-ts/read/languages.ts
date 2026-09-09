/**
 * The play languages this build knows, as data: `content/languages.json` is the closed set, the
 * default tag a campaign or session falls back to when it carries none, and per tag the script
 * class the delivery guard obliges. Nothing in code names a tag; adding a language is adding an
 * entry here plus its UI words and `localized_labels` rows (host decision 2026-09-09, contract §23).
 */
import { join } from "node:path";
import type { KernelContext } from "../context.js";
import { RpcError, internalError } from "../errors.js";
import { isJsonObject } from "../json.js";
import { row, repr, type Row } from "./values.js";
export interface PlayLanguage {
    readonly autonym: string;
    /** The script class `write/text.ts` obliges for player-facing text, or null: unchecked. */
    readonly script: string | null;
}
export interface PlayLanguages {
    readonly default: string;
    /** Every declared tag, in file order: the accepted values of `play_language`. */
    readonly tags: readonly string[];
    readonly languages: Readonly<Record<string, PlayLanguage>>;
}
const FILE = "languages.json";
const loaded = new WeakMap<KernelContext, Promise<PlayLanguages>>();
function contentError(message: string): RpcError {
    return new RpcError("campaign_not_ready", `content/${FILE} is not usable: ${message}`, {
        fix: `restore content/${FILE}: a \`default\` tag and a \`languages\` object keyed by tag, each entry with an \`autonym\` and an optional \`script\` class`,
        details: { languages: { reason: message } },
    });
}
function parse(raw: unknown): PlayLanguages {
    if (!isJsonObject(raw))
        throw contentError("not a JSON object");
    if (!isJsonObject(raw.languages))
        throw contentError("`languages` is not an object keyed by tag");
    const languages: Record<string, PlayLanguage> = {};
    for (const [tag, entry] of Object.entries(raw.languages)) {
        if (!tag.trim())
            throw contentError("a language tag is empty");
        if (!isJsonObject(entry))
            throw contentError(`language ${repr(tag)} is not an object`);
        const autonym = typeof entry.autonym === "string" && entry.autonym.trim() ? entry.autonym.trim() : tag;
        const script = typeof entry.script === "string" && entry.script.trim() ? entry.script.trim() : null;
        languages[tag] = Object.freeze({ autonym, script });
    }
    const tags = Object.keys(languages);
    if (!tags.length)
        throw contentError("declares no play language");
    if (typeof raw.default !== "string" || !Object.hasOwn(languages, raw.default))
        throw contentError("`default` is not one of the declared languages");
    return Object.freeze({ default: raw.default, tags: Object.freeze(tags), languages: Object.freeze(languages) });
}
/** The declared languages, read once per kernel context through the same reader every content file uses. */
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
/** `meta.play_language` when the campaign, draft or session carries one, else the data default. */
export async function playLanguageOf(context: KernelContext, meta: Row | null | undefined): Promise<string> {
    const tag = row(meta).play_language;
    return typeof tag === "string" && tag.trim() ? tag : (await playLanguages(context)).default;
}
/** The script class `tag` obliges, or null: a tag declared without one, or not declared at all, is unchecked. */
export async function playLanguageScript(context: KernelContext, tag: string): Promise<string | null> {
    return (await playLanguages(context)).languages[tag]?.script ?? null;
}
