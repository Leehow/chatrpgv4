/**
 * Contract §168.4: an `owed` annotation that does not hold is left out, and the write goes on as an ordinary write.
 *
 * `owed` (§158.5) is optional: it asks for a row the post review found told to be landed on the told basis. Every refusal
 * the kernel gives for it begins "Leave owed out", and until 2026-10-02 the whole batch went with it. On the installed
 * App's Blood Road table (turn 3) the Keeper copied the capsule's §51.4 `unrecorded` line into `owed` on its
 * `apply npc`; `owed_unknown` refused the batch, and the embedded narration that finally described the station and the
 * three men under its awning was never delivered.
 *
 * Leaving the field out never buys the told basis: without `owed` the batch is an ordinary write and is reviewed as one
 * (`toldAdmission` admits on `told` only when every effect names a row). Only the effect that does not hold loses its
 * field, so another effect's valid row is still landed as told and an owed time row is never landed twice.
 */

/** The kernel's own refusal reasons for an `owed` field (`kernel-ts/owed/land.ts`). */
export const OWED_REFUSALS: ReadonlySet<string> = new Set(["owed_unknown", "owed_mismatch", "owed_not_told", "owed_kind", "owed_unresolved"]);

export interface OwedLeftOut { owed: unknown; reason: string; kind: unknown; index: number }

type Effect = Record<string, unknown>;
const named = (effect: Effect): string | undefined => typeof effect.owed === "string" ? effect.owed.trim() : undefined;

/**
 * Before admission: removes each `owed` that names no row of `open` (the owed rows the host last read from the capsule)
 * and returns what it removed. `open` undefined means the host has read no capsule yet, and nothing is removed: the
 * kernel then decides, and its refusal is handled by `leaveOutRefused`.
 */
export function leaveOutUnknownOwed(effects: unknown, open: readonly Record<string, unknown>[] | undefined): OwedLeftOut[] {
	if (!open || !Array.isArray(effects)) return [];
	const names = new Set(open.map(row => typeof row.name === "string" ? row.name.trim() : "").filter(Boolean));
	const left: OwedLeftOut[] = [];
	effects.forEach((effect, index) => {
		if (!effect || typeof effect !== "object" || !Object.hasOwn(effect, "owed")) return;
		const name = named(effect as Effect);
		if (name && names.has(name)) return;
		left.push({ owed: (effect as Effect).owed, reason: "owed_unknown", kind: (effect as Effect).kind, index });
		delete (effect as Effect).owed;
	});
	return left;
}

/**
 * After the kernel refused a batch for an `owed` field (`details.field: "owed"`): removes it from the effects the refusal
 * names -- those carrying the refused name, or for `owed_kind` those of the refused kind -- and returns what it removed.
 * An empty result means the refusal was not about `owed` or names no effect of this batch, and it stands.
 */
export function leaveOutRefused(details: Record<string, unknown> | undefined, effects: unknown): OwedLeftOut[] {
	if (!details || details.field !== "owed" || typeof details.reason !== "string" || !OWED_REFUSALS.has(details.reason) || !Array.isArray(effects)) return [];
	const reason = details.reason, refused = typeof details.owed === "string" ? details.owed.trim() : undefined;
	const left: OwedLeftOut[] = [];
	effects.forEach((effect, index) => {
		if (!effect || typeof effect !== "object" || !Object.hasOwn(effect, "owed")) return;
		const hit = reason === "owed_kind" ? (effect as Effect).kind === details.kind : refused !== undefined ? named(effect as Effect) === refused : !named(effect as Effect);
		if (!hit) return;
		left.push({ owed: (effect as Effect).owed, reason, kind: (effect as Effect).kind, index });
		delete (effect as Effect).owed;
	});
	return left;
}

/** The one line the Keeper reads beside a result that landed without the fields it left out. */
export function owedLeftOutNote(left: readonly OwedLeftOut[]): string {
	const names = left.map(entry => JSON.stringify(typeof entry.owed === "string" ? entry.owed : entry.owed ?? null)).join(", ");
	return `owed ${names} did not name an open owed row this effect lands (${[...new Set(left.map(entry => entry.reason))].join(", ")}), so it was left out and the effect landed as an ordinary write. ` +
		"Use owed only with a name from the capsule's owed section, exactly as written there; the unrecorded section's lines are not owed rows.";
}
