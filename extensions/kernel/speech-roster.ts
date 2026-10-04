/**
 * The people speech attribution may name (contract §128.3), read off the capsule's `present[]` rows.
 *
 * A person on stage as the capsule gives them: `name` is `present[].name`; `called` and `address` are the table's own
 * name and form of address (§79); `untold` says the player has not been told the book's name (§103), and `label` is the
 * epithet the table uses meanwhile. A creature's row (`kind: "creature"`, a budget stub included, §180.4) is a body, not
 * a speaker: §180.3 keeps it out, so a span naming one stays a label, as one naming nobody does.
 */
export interface RosterPerson { name: string; called?: string; address?: string; untold: boolean; label?: string }

const text = (value: unknown): string | undefined => typeof value === "string" && value.length > 0 ? value : undefined;

export function speechRoster(present: readonly unknown[]): RosterPerson[] {
	return present.flatMap((row): RosterPerson[] => {
		const entry = (row ?? {}) as Record<string, unknown>;
		const name = text(entry.name);
		if (!name || entry.kind === "creature") return [];
		const called = (entry.called ?? {}) as Record<string, unknown>, untold = entry.untold as Record<string, unknown> | undefined;
		const calledName = text(called.name), address = text(called.address), label = text(untold?.label);
		return [{ name, untold: !!untold && typeof untold === "object", ...(calledName ? { called: calledName } : {}),
			...(address ? { address } : {}), ...(label ? { label } : {}) }];
	});
}
