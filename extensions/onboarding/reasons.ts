/**
 * What the player is told about a setup wait or refusal (contract §14.19.4, SL-100).
 *
 * The setup guide used to paraphrase the machine half of a result -- `message`, `fix`, job ids,
 * the reader's token budget -- straight to the player ("the job changed its number, so it is moving",
 * "we hit a quota once"). The host now hands it one sentence written for the player beside that
 * machine half, as §55's notices do for the Keeper; the machine text stays machine-facing.
 *
 * The sentence is picked from the result's closed codes (the kernel's and the reading service's error
 * codes, a reading's `purpose`, a block's `kind`), never from its prose, and nothing here reads what
 * the guide writes. It is English, like every host string (§16.1): the guide says it in the table's
 * play_language, the first of §23's two legs. The product's caption lane (§23) projects host-placed
 * words the player reads directly; a sentence the guide relays is the guide's to write.
 */

/** The closed facts a reason is chosen by. Every field is a contract code or enum value, never prose. */
export interface ReasonFacts {
	/** The result's code: a kernel or reading-service error code, or the host's own (`setup_blocked`, `guidance_failed`). */
	code?: string;
	/** For a block or a failed guidance preparation, the preparer's or kernel's code underneath it. */
	cause?: string;
	/** For a block, its kind (`guidance_at_create_campaign`, `guidance_at_turn_start`, `package_context`). */
	blockedBy?: string;
	/** `details.reason` of a `needs` refusal (`reading_timeout`, `reading_failed`, `opening_preparing`, ...). */
	reason?: string;
	/** `details.read.purpose` of a reading wait (`skeleton`, `opening`, `guidance`, ...). */
	purpose?: string;
	/** Whole minutes this setup has already waited on the same reading, when it has waited before. */
	minutes?: number;
}

const OPENING_CHOICE = "The book can begin in more than one place, and which opening to play is your choice; setup goes on from the one you pick.";

/** What is being read, by the reading's purpose (§22.2's closed set). */
const READING: Record<string, string> = {
	skeleton: "The book is still being read: its contents and scenes are being mapped, which takes several minutes for a long book.",
	opening: "The opening scene you chose is still being read from the book, and your choice is kept.",
	guidance: "The introduction for your character is still being prepared from the book.",
};

const GUIDANCE_RETRY = "The introduction for your character could not be prepared from the book this time. It is tried again with your next message, and nothing you chose is lost.";

function elapsed(minutes: number | undefined): string {
	return minutes !== undefined && minutes >= 1 ? ` It has been at this for about ${minutes} minute${minutes === 1 ? "" : "s"}.` : "";
}

/** The reason for a guidance preparation that did not produce guidance, by its cause. */
function guidanceReason(cause: string | undefined): string {
	if (cause === "needs_choice") return OPENING_CHOICE;
	if (cause === "guidance_not_ready") return "This starter's prepared introduction is missing or out of date in this installation, so character setup cannot go on with it.";
	return GUIDANCE_RETRY;
}

/**
 * One sentence for the player, or undefined when the result is about the guide's own call (a
 * misspelt parameter, a step out of order): the player hears nothing about those.
 */
export function playerReason(facts: ReasonFacts): string | undefined {
	const {code, cause, blockedBy, reason, purpose} = facts;
	if (code === "setup_blocked") {
		if (blockedBy === "package_context") return "One of this campaign's add-on packages (Mods) cannot be read, so setup is paused until it is repaired or turned off in the Mods panel.";
		return guidanceReason(cause);
	}
	if (code === "guidance_failed") return guidanceReason(cause);
	if (code === "needs_choice") return OPENING_CHOICE;
	if (reason === "reading_timeout")
		return `${READING[purpose ?? ""] ?? "The book is still being read."}${elapsed(facts.minutes)} Nothing is needed from you now: you can wait, and your next message checks on it again.`;
	if (reason === "reading_failed") return "Reading this part of the book did not work out this time. It is being tried again, and nothing you chose is lost.";
	if (reason === "opening_preparing") return "Your card is saved. The opening scene is still being prepared from the book, and the table opens as soon as it is ready.";
	if (code === "bad_pdf") return "This PDF could not be opened. Check that the file is there and readable, or choose another book.";
	if (code === "vision_required") return "The reading model chosen in the settings cannot look at page images, so this PDF cannot be read until a model that can is selected.";
	return undefined;
}
