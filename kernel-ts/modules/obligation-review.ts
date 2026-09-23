/**
 * Contract §134.16: which pointers of a stated obligation an independent reviewer must support against
 * the page image, whether or not the reader listed them in `critical`.
 *
 * One function for both ends of the review: the kernel's draft check adds these pointers to
 * `required_review` (the publication gate), and the extension's `reviewUnits` assigns the same pointers
 * to its reviewer units. Two copies of this rule would let a reviewer unit miss a pointer the gate then
 * demands, so this file has no imports and both sides load it.
 *
 * Numbers (a value's `minimum`) are not listed here: they already enter review through `numericPaths`.
 */

type Json = Record<string, unknown>;
const plain = (value: unknown): value is Json => value != null && typeof value === "object" && !Array.isArray(value);
const token = (key: string): string => key.replace(/~/g, "~0").replace(/\//g, "~1");

/** Whether a node states an obligation: a `requirement` node carrying `properties.obligation` (§134.1). */
export function statesObligation(node: unknown): boolean {
    return plain(node) && node.node_kind === "requirement" && plain(node.properties) && Object.hasOwn(node.properties, "obligation");
}

/**
 * The obligation's fields as JSON pointers under `base` (the node's pointer, e.g. `/nodes/3`): each key of
 * `properties.obligation` other than `demand`, and each key other than `kind` of each demand step. A step
 * that carries nothing but its kind is named whole.
 */
export function obligationReviewPaths(node: unknown, base: string): string[] {
    if (!statesObligation(node)) return [];
    const obligation = (node as { properties: Json }).properties.obligation, at = `${base}/properties/obligation`;
    if (!plain(obligation)) return [at];
    const paths: string[] = [];
    for (const [key, value] of Object.entries(obligation)) {
        if (key !== "demand" || !Array.isArray(value)) {
            paths.push(`${at}/${token(key)}`);
            continue;
        }
        value.forEach((step, index) => {
            const keys = plain(step) ? Object.keys(step).filter(name => name !== "kind") : [];
            if (keys.length) for (const name of keys) paths.push(`${at}/demand/${index}/${token(name)}`);
            else paths.push(`${at}/demand/${index}`);
        });
    }
    return paths;
}
