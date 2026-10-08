/**
 * Contract §151.3 (ticket 03 of docs/specs/jev-decides-llm-writes.md): which draft records a Jev claim-support check
 * may clear, and the evidence file that check leaves in the reading's work directory.
 *
 * One module for both ends, as `review-verdicts.ts` and `obligation-review.ts` are: the host asks Jev only about the
 * records `claimSupportIneligibility` accepts, and the kernel's publication gate refuses a `reviewer: "jev"` row on any
 * record it refuses. Two copies of this rule would let the host clear a record the gate then rejects, so this file has
 * no imports and both sides load it.
 *
 * Eligibility is structural and never reads meaning: a record whose facts live in an image (an image source, a map
 * region, a map's kind, a region-of-page citation) or on a page with no native text keeps the vision reviewer, and so
 * does a record carrying a classification field (§186.6): its contest mark needs a vision reviewer, and Jev never judges
 * a classification.
 */

export const CLAIM_SUPPORT_PROTOCOL = "source-claim-support-v1";
/** The evidence file's name inside the reading's work directory. */
export const CLAIM_SUPPORT_FILE = "claim-support.json";
/** The `reviewer` a review row carries when Jev, not a vision reviewer, supported it. */
export const JEV_REVIEWER = "jev";
/** The gate's stable rules for a refused jev row (§151.3 implementation decision). */
export const JEV_REVIEW_RULES = Object.freeze({
    ineligible: "review_jev_ineligible",
    evidence: "review_jev_evidence",
    overruled: "review_jev_overruled",
} as const);

type Row = Record<string, unknown>;
const plain = (value: unknown): value is Row => value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
/** A JSON integer as either end parses it: a number, or the kernel's bigint for a large one. */
const whole = (value: unknown): number | undefined => {
    const n = typeof value === "bigint" ? Number(value) : value;
    return typeof n === "number" && Number.isSafeInteger(n) ? n : undefined;
};

/** `/claims/<i>` or `/nodes/<i>` for a pointer under a record (canonical ordinals only), else null. */
export function claimRecordRoot(path: unknown): string | null {
    if (typeof path !== "string") return null;
    const match = /^\/(claims|nodes)\/(0|[1-9][0-9]*)(?=\/|$)/.exec(path);
    return match ? match[0] : null;
}

/** Two draft pointers overlap when one is the other or lies under it. */
export function pathsOverlap(left: string, right: string): boolean {
    return left === right || left.startsWith(right + "/") || right.startsWith(left + "/");
}

/** The record a root names, or undefined when the draft has none there. */
export function claimRecord(draft: unknown, root: string): Row | undefined {
    const match = /^\/(claims|nodes)\/(0|[1-9][0-9]*)$/.exec(root);
    if (!match || !plain(draft)) return undefined;
    const collection = draft[match[1]], record = Array.isArray(collection) ? collection[Number(match[2])] : undefined;
    return plain(record) ? record : undefined;
}

/**
 * The physical pages a record cites, ascending and unique, or why they cannot stand for it: `no_source_refs` when it
 * cites nothing, `invalid_ref` for a citation that is not a positive page, `region_ref` for a citation of a region
 * (`box`) -- a region is what an image shows, and native text belongs to the whole page.
 */
export function claimRecordPages(record: Row): {pages: number[]} | {reason: "no_source_refs" | "invalid_ref" | "region_ref"} {
    const refs = record.source_refs;
    if (!Array.isArray(refs) || !refs.length) return {reason: "no_source_refs"};
    const pages = new Set<number>();
    for (const ref of refs) {
        const page = plain(ref) ? whole(ref.page) : undefined;
        if (page === undefined || page < 1) return {reason: "invalid_ref"};
        if (Object.hasOwn(ref as Row, "box")) return {reason: "region_ref"};
        pages.add(page);
    }
    return {pages: [...pages].sort((a, b) => a - b)};
}

/** Every JSON pointer under `value` (RFC 6901 escaped), each prefixed with `at`: what a record carries, field by field. */
function pointersUnder(value: unknown, at: string, out: string[]): string[] {
    if (Array.isArray(value))
        value.forEach((child, index) => { out.push(`${at}/${index}`); pointersUnder(child, `${at}/${index}`, out); });
    else if (plain(value))
        for (const [key, child] of Object.entries(value)) {
            const path = `${at}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
            out.push(path);
            pointersUnder(child, path, out);
        }
    return out;
}

/**
 * Why a record may not be cleared by a text check, or null when it may. `hasText(page)` says whether the host's native
 * text of that physical page is usable (non-empty) for the bound source; the kernel answers it from the evidence file.
 * `classifies(path)` says whether a draft pointer is a classification field (the declared `classification_fields`
 * patterns, `review-verdicts.ts` `classificationMatcher`); both ends pass the same declaration.
 */
export function claimSupportIneligibility(draft: unknown, root: string, hasText: (page: number) => boolean,
    classifies: (path: string) => boolean): string | null {
    const record = claimRecord(draft, root);
    if (!record) return "not_a_record";
    if (root.startsWith("/nodes/")) {
        // §192.1: a node that declares itself distinct from a published one keeps the vision reviewer, which judges that answer.
        if (Object.hasOwn(record, "distinct_from")) return "identity";
        // §199.3: a person's statements of who they are (alive or dead, kin, rank) keep the vision reviewer, which answers them
        // one by one; Jev reads a modifier's attachment literally ("X's late husband" cleared as "X's husband", 2026-10-08).
        // The kind is `review-verdicts.ts` PERSON_KIND; this file has no imports, so the word is repeated here.
        if (record.node_kind === "npc") return "person";
        const properties = plain(record.properties) ? record.properties : {};
        if (Array.isArray(properties.image_sources) && properties.image_sources.length) return "image_source";
        if (Array.isArray(properties.map_regions) && properties.map_regions.length) return "map_region";
        // Contract §39.4: a map's kind is read off the printed picture.
        if (Object.hasOwn(properties, "map_scope")) return "map_scope";
    }
    // §186.6: a record carrying any classification field keeps the vision reviewer, which may contest it.
    if (pointersUnder(record, root, []).some(path => classifies(path))) return "classification_field";
    const cited = claimRecordPages(record);
    if ("reason" in cited) return cited.reason;
    if (cited.pages.some(page => !hasText(page))) return "no_native_text";
    return null;
}
