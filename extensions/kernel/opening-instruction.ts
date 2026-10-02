/**
 * Contract §168.2: the host's message that opens the table (turn 0, no player input).
 *
 * It carries the opening's contract and nothing of its craft. Until 2026-10-02 it also said "one sentence of room at
 * most, one gesture per line of speech, and the whole opening shorter than the prologue. Introduce at most two new
 * proper names", caps from the 2026-09-16 opening pass that the prose package has since replaced with the opposite
 * rule (narration-craft "Opening the table": the place with everything the book describes of it, the people as people
 * seen). The host's more specific line won: on the installed App's Blood Road table the opening showed one of the
 * three men under the awning and none of the station, and the player could not tell where they were or who was there.
 * How to open is the prose package's; this message says only what is true of this turn.
 */

/** What the table knows when it opens: the committed setup prologue (absent without a setup meeting), the play
 *  language, and the active Mod context when the opening may settle Mod first-contact checks. */
export interface OpeningFacts {
	prologue?: unknown;
	playLanguage: string;
	modContext?: unknown;
}

export function openingInstruction(facts: OpeningFacts): string {
	const guide = typeof (facts.prologue as { guide?: unknown } | null | undefined)?.guide === "string" ? ((facts.prologue as { guide: string }).guide).trim() : "";
	// A prologue with no guide asked its question in the host's voice, not anyone's in the scene: on Blood Road (guide
	// empty) "the guide already knows who the visitor is" had the station owner greet three different investigators by
	// name before anyone had told him it.
	const known = guide
		? `the guide (${guide}) already knows who the visitor is, so do not ask it again. `
		: "the prologue's question was the host's, not anyone's in the scene: the people here do not know the investigator's name or business until the investigator tells them, and the player is not asked again either. ";
	const react = guide
		? "and let the guide react in their own words to who the visitor turned out to be and put one concrete question or offer to the player. "
		: "and let the people present react to the stranger they see and put one concrete question or offer to the player. ";
	const lead = facts.prologue !== undefined && facts.prologue !== null
		? "The setup context records the prior meeting, and the investigator now exists: " + known +
			"The committed prologue below was shown to the player word for word: do not repeat its sentences; continue from where it stops. " +
			(guide ? "Say where the investigator stands now -- who this person is to them and what brought the investigator here -- from the investigator's card and the prologue; "
				: "Say where the investigator stands now and what brought them here, from the investigator's card and the prologue; ") +
			"never state that either of them lacks something. Then the place and the people present as they are now in front of the investigator, as the active prose package's opening and first-sight rules say, " +
			react +
			"No keys or money were granted. If pending_action exists, preserve that player request instead of asking for the same decision again; " +
			"carry it forward through normal rules and state receipts, never claim unrecorded resources. Committed prologue: " + JSON.stringify(facts.prologue)
		: "There is no prior meeting. Begin the scene, orientation first: when and where this is, who the investigator is here in public terms, and why they are here; " +
			"then the place and the people present, as the active prose package's opening and first-sight rules say.";
	return `Opening the table: ${lead} This turn has no player input. Write all player-facing words in play_language=${facts.playLanguage}. ` +
		"Use look to see the opening scene (lookup for background). Close with narrate and wait for free player input. NPC questions belong naturally in the prose. " +
		"Do not generate story action menus or options. " +
		(facts.modContext !== undefined
			? `The opening may settle registered Mod first-contact checks and define/place new objects when the fiction requires them; ordinary adventure actions wait for the player. Active Mod context: ${JSON.stringify(facts.modContext)}`
			: "Do not call apply or resolve before the first player turn; the only opening writes are ask and narrate.");
}
