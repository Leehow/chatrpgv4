/**
 * An `object` effect that leaves out `definition` while its own batch defines exactly the thing it adopts.
 *
 * The kernel then looks the instance name up as a definition and refuses (`No accepted definition named ...`), with the
 * fix "set definition to one of: <the batch's definitions>". On the installed App's Blood Road table (2026-10-02, turn 2)
 * the Keeper sent `{define, name: "35毫米相机"}` and `{object, adopt: "35毫米相机", name: "罗莎的35毫米相机"}`, was refused,
 * and resent the same batch with `definition: "35毫米相机"` -- a model round trip for a field the batch already named.
 *
 * The host fills it only on an exact match: the object's `adopt` (or, failing that, its `name`) is the `name` of a
 * `define` in the same batch. Anything else is left for the kernel to refuse as before.
 */
type Effect = Record<string, unknown>;

/** Fills, in place, `definition` on each object effect whose adopted or own name is a definition of the same batch. */
export function fillObjectDefinitions(effects: unknown): number {
	if (!Array.isArray(effects)) return 0;
	const defined = new Set(effects.filter((effect): effect is Effect => !!effect && typeof effect === "object" && (effect as Effect).kind === "define")
		.map((effect) => effect.name).filter((name): name is string => typeof name === "string" && name.trim() !== ""));
	let filled = 0;
	for (const effect of effects as Effect[]) {
		if (!effect || typeof effect !== "object" || effect.kind !== "object" || effect.definition != null) continue;
		const match = [effect.adopt, effect.name].find((name): name is string => typeof name === "string" && defined.has(name));
		if (!match) continue;
		effect.definition = match;
		filled++;
	}
	return filled;
}
