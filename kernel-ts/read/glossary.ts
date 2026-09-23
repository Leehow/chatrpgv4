/**
 * The player's glossary: the union of every `localized_labels` row in the rules data for one play
 * language, whatever file or nesting the row sits in, keyed as a surface looks a term up -- the row's
 * own key, its `name` and its `abbreviation` (contract §23). No file list, no key whitelist, no tag
 * shortcut: a language whose canonical words are the keys simply has no rows. The first row to claim
 * a key keeps it, in file-name order and then document order, so two files naming one key cannot
 * flicker. Unreadable display data contributes no invented label.
 *
 * One visitor, two readers. The kernel's `playerGlossary` walks the rules files through its snapshot
 * cache; the UI-words presenter lane (`extensions/module/ui-presentation.ts`, contract §23.2), which
 * runs with no kernel, walks the same files through `rulesGlossary` below. Both hand the parsed
 * documents to `glossaryOf`, so the lane is told exactly the terms the kernel projects.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { compareUnicode, isJsonObject, parsePythonJson, pythonObjectEntries, type JsonObject } from "../json.ts";

/** Where the rules data lives under a content root. */
export const RULES_DATA = ["rulesets", "coc7", "rules-json"] as const;

/** The glossary for `language` over parsed rules documents, in the order given. */
export function glossaryOf(documents: Iterable<unknown>, language: string): Record<string, string> {
    const result: Record<string, string> = {};
    if (typeof language !== "string" || !language.trim())
        return result;
    const claim = (key: unknown, word: string) => {
        if (typeof key === "string" && key.trim() && !Object.hasOwn(result, key.trim()))
            result[key.trim()] = word;
    };
    const visit = (value: unknown, key: string | null): void => {
        if (Array.isArray(value)) {
            for (const item of value)
                visit(item, null);
            return;
        }
        if (!isJsonObject(value))
            return;
        const labels = isJsonObject(value.localized_labels) ? value.localized_labels : {};
        const word = labels[language];
        if (typeof word === "string" && word.trim()) {
            claim(key, word.trim());
            claim(value.name, word.trim());
            claim(value.abbreviation, word.trim());
        }
        for (const [child, inner] of pythonObjectEntries(value as JsonObject))
            if (child !== "localized_labels")
                visit(inner, child);
    };
    for (const document of documents)
        visit(document, null);
    return result;
}

/** The same glossary read straight from a content root, for a caller with no kernel. */
export async function rulesGlossary(contentRoot: string, language: string): Promise<Record<string, string>> {
    const root = join(contentRoot, ...RULES_DATA);
    let names: string[];
    try {
        names = (await readdir(root, { withFileTypes: true }))
            .filter(entry => entry.isFile() && entry.name.endsWith(".json")).map(entry => entry.name).sort(compareUnicode);
    }
    catch {
        return {};
    }
    const documents: unknown[] = [];
    for (const name of names) {
        try {
            documents.push(parsePythonJson(await readFile(join(root, name), "utf8")));
        }
        catch { /* unreadable display data contributes nothing */ }
    }
    return glossaryOf(documents, language);
}
