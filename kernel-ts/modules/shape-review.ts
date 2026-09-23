/**
 * Contract §136.20: which pointers of a drafted node's mechanical shapes an independent reviewer must
 * support against the page image, whether or not the reader listed them in `critical`.
 *
 * One function for both ends of the review, as `obligation-review.ts` is for obligations: the kernel's
 * draft check adds these pointers to `required_review` (the publication gate), and the extension's
 * `reviewUnits` assigns the same pointers to its reviewer units. So this file has no imports and both
 * sides load it.
 *
 * Every leaf is listed, strings included: `numericPaths` sees only numbers, so a dice string such as
 * `"1D4+2"`, an enum, a skill path or an `_unstated` flag would otherwise reach review only when the
 * reader happened to list it. The caller unions these with `numericPaths`; a number appears in both.
 */

type Json = Record<string, unknown>;
const plain = (value: unknown): value is Json => value != null && typeof value === "object" && !Array.isArray(value);
const token = (key: string): string => key.replace(/~/g, "~0").replace(/\//g, "~1");

/**
 * The seats a drafted node states a shape in, as pointers under the node: the record view's
 * `mechanics` container (§136.1) and an actor's `combat` (the registered `tactic` seat). The record view
 * is `properties.runtime_projection.record` when the node has one, otherwise `properties` -- `recordOf`'s
 * rule, so these are the values the validator checks and the kernel reads.
 */
function seats(node: unknown): Array<{ key: string; value: unknown; at: string }> {
    if (!plain(node) || !plain(node.properties)) return [];
    const props = node.properties, projection = props.runtime_projection;
    const record = plain(projection) && plain(projection.record) ? projection.record : props;
    const at = record === props ? "/properties" : "/properties/runtime_projection/record";
    return ["mechanics", "combat"].filter(key => Object.hasOwn(record, key)).map(key => ({ key, value: record[key], at: `${at}/${key}` }));
}

/** Whether a drafted node states a mechanical shape: its record view carries `mechanics` or `combat`. */
export function statesMechanics(node: unknown): boolean {
    return seats(node).length > 0;
}

function leaves(value: unknown, at: string): string[] {
    if (plain(value)) {
        const keys = Object.keys(value);
        return keys.length ? keys.flatMap(key => leaves(value[key], `${at}/${token(key)}`)) : [at];
    }
    if (Array.isArray(value)) return value.length ? value.flatMap((item, index) => leaves(item, `${at}/${index}`)) : [at];
    return [at];
}

/** Every leaf of the node's shape seats as a JSON pointer under `base` (the node's pointer, e.g. `/nodes/3`). */
export function shapeReviewPaths(node: unknown, base: string): string[] {
    return seats(node).flatMap(seat => leaves(seat.value, `${base}${seat.at}`));
}
