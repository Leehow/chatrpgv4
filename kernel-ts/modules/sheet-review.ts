/**
 * Contract §207.2: which pointers of a pregenerated investigator's sheet an independent reviewer must support against the
 * page image, under either review policy.
 *
 * One function for both ends of the review, as `shape-review.ts` is for mechanical shapes: the kernel's draft check adds
 * these pointers to `required_review` (the publication gate), and the extension's review units assign the same pointers to
 * their reviewers. So this file has no imports and both sides load it.
 *
 * Every leaf of the sheet's numbers is listed, strings included (a damage bonus, a weapon's dice): the numbers become the
 * player's card, and §22.3 asks a result for every enumerable number. The words of the sheet (name, occupation, background)
 * are reviewed with their record's root.
 */

type Json = Record<string, unknown>;
const plain = (value: unknown): value is Json => value != null && typeof value === "object" && !Array.isArray(value);
const token = (key: string): string => key.replace(/~/g, "~0").replace(/\//g, "~1");

/** The sheet's sections whose every leaf is owed. */
export const SHEET_REVIEW_SECTIONS: readonly string[] = Object.freeze(["age", "characteristics", "derived", "skills", "weapons", "cash"]);

function leaves(value: unknown, at: string): string[] {
    if (plain(value)) {
        const keys = Object.keys(value);
        return keys.length ? keys.flatMap(key => leaves(value[key], `${at}/${token(key)}`)) : [at];
    }
    if (Array.isArray(value)) return value.length ? value.flatMap((item, index) => leaves(item, `${at}/${index}`)) : [at];
    return [at];
}

/** Every owed leaf of a drafted node's sheet as a JSON pointer under `base` (the node's pointer, e.g. `/nodes/3`). */
export function sheetReviewPaths(node: unknown, base: string): string[] {
    if (!plain(node) || !plain(node.properties) || !plain(node.properties.sheet)) return [];
    const sheet = node.properties.sheet;
    return SHEET_REVIEW_SECTIONS.filter(key => Object.hasOwn(sheet, key)).flatMap(key => leaves(sheet[key], `${base}/properties/sheet/${token(key)}`));
}
