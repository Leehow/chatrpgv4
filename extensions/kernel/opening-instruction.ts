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
	/** The investigators' names, from `table.open`. */
	party?: string[];
	playLanguage: string;
	modContext?: unknown;
}

export function openingInstruction(facts: OpeningFacts, env: Readonly<Record<string,string|undefined>> = process.env): string {
	const guide = typeof (facts.prologue as { guide?: unknown } | null | undefined)?.guide === "string" ? ((facts.prologue as { guide: string }).guide).trim() : "";
	// A prologue with no guide asked its question in the host's voice, not anyone's in the scene: on Blood Road (guide
	// empty) "the guide already knows who the visitor is" had the station owner greet three different investigators by
	// name before anyone had told him it.
	const known = guide
		? `the guide (${guide}) already knows who the visitor is, so do not ask it again. `
		: "the prologue's question was the host's, not anyone's in the scene: the people here do not know the investigator's name or business until the investigator tells them, and the player is not asked again either. ";
	const react = guide
		? "and let the guide react in their own words to who the visitor turned out to be and put one concrete question or offer to the player. "
		// Dust to Dust (2026-10-02): the investigator opens alone in her lodging, and "put one concrete question or offer to
		// the player" had the narrator ask it -- two options and "where will you start?", the menu the prose package forbids.
		: "and let anyone present react to the stranger they see, in their own words; with nobody present, end on what the investigator perceives, never on a question from the narrator. ";
	const lead = facts.prologue !== undefined && facts.prologue !== null
		? "The setup context records the prior meeting, and the investigator now exists: " + known +
			"The committed prologue below was shown to the player word for word: do not repeat its sentences; continue from where it stops. " +
			// Blood Road (2026-10-02): told only to say this "from the investigator's card", the opening began "Rosa sat alone at the wheel" in
			// the third person by the card's name, and turned to "you" two paragraphs later.
			(guide ? "Say where the investigator stands now -- who this person is to them and what brought the investigator here -- from the investigator's card and the prologue, addressing the investigator as you; "
				: "Say where the investigator stands now and what brought them here, from the investigator's card and the prologue, addressing the investigator as you; ") +
			"never state that either of them lacks something. Then the place and the people present as they are now in front of the investigator, as the active prose package's opening and first-sight rules say, " +
			react +
			"No keys or money were granted. If pending_action exists, preserve that player request instead of asking for the same decision again; " +
			"carry it forward through normal rules and state receipts, never claim unrecorded resources. Committed prologue: " + JSON.stringify(facts.prologue)
		: "There is no prior meeting. Begin the scene, orientation first, addressing the investigator as you: when and where this is, who the investigator is here in public terms, and why they are here; " +
			"then the place and the people present, as the active prose package's opening and first-sight rules say.";
	// Blood Road's prologue, prepared from the book before anyone made a character, welcomes and is stared at in the plural;
	// with one investigator at the table the owner then explained knowing her name by "someone in the car called you", in
	// a car she drove alone.
	const names = (facts.party ?? []).filter(name => typeof name === "string" && name.trim());
	const party = names.length
		? ` The party is ${names.length === 1 ? "one investigator" : `${names.length} investigators`}, ${JSON.stringify(names)}; the book may speak to a group, but nobody else is with them unless the card says so, and people address the party as the number it is.`
		: "";
	return `Opening the table: ${lead}${party} This turn has no player input. The opening is told, not played: set the scene the book opens on -- where and when, who is there and what they are doing, what is seen and said, a letter or paper handed over -- and stop at the moment the investigator must choose, before any danger lands (in an ambush, the sudden silence, not the first shot). Roll nothing, start no combat or chase, move the investigator nowhere, and change no money or health; a roll the book calls for at the start (a Sanity roll at a sight, a chance to notice the ambush) goes in a note named "due at start" with what, who, why and the moment that sets it off, and is settled on the player's first turn when that moment comes, in the light of what they do. Write all player-facing words in play_language=${facts.playLanguage}. ` +
		"Use look only if the opening scene is not already supplied (lookup for missing background). " +
		(env.PI_COC_TURN_PACKET_PROTOTYPE==='1'&&env.PI_COC_TURN_IR==='1'?'Select the opening as one native output {version:5,actions:[...]}: presence enter for who is there, perceive for what is seen, communicate for what is said, material for a paper handed over; the sole author writes the opening and streams it. '
		:env.PI_COC_TURN_PACKET_PROTOTYPE==='1'?'Select the opening using one native output version4 decision packet. Supply interactions and exact content references; the sole author writes the opening and streams it. ':env.PI_COC_ISOLATED_OUTPUT==='1'?"Select the opening in {{compose}} followed immediately by one private JSON expression brief with scene, narrative_content and npc_turns. The host invokes the isolated author, then waits for free player input. ":"Write the opening yourself in the public response beginning with {{public}} and wait for free player input. NPC questions belong naturally in the prose. ") +
		"Do not generate story action menus or options. " +
		(env.PI_COC_TURN_PACKET_PROTOTYPE==='1'?"NPC communication uses structured interactions, never event text or complete dialogue. Record actual mechanical changes through canonical effects. Ordinary speech needs no attempted intention.":"NPCs may speak freely and give information. Record actual changes through the existing effects and event fields; ordinary speech needs no attempted intention.")+" An apply person for their first complete printed name stages its registration until this opening actually introduces them in a successful delivery. These writes do not choose any investigator action. " +
		(facts.modContext !== undefined
			? `An apply clock may pin an opening datetime the book left open. Active Mod context: ${JSON.stringify(facts.modContext)}`
			: "An apply clock may pin an opening datetime the book left open, when the capsule's clock asks for it.");
}
