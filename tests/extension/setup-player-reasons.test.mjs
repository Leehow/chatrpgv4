/**
 * The player's reason for a setup wait or refusal (contract §14.19.4, SL-100): chosen from the result's
 * closed codes, never from its prose; nothing for a refusal of the guide's own call; and the setup
 * prompt names the very field the host emits, so the guide is told to use what it is given.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { playerReason } from "../../extensions/onboarding/reasons.ts";

const REPO = join(import.meta.dirname, "..", "..");

test("each setup wait and refusal the player can be told about has its own reason", () => {
	const reasons = {
		skeleton: playerReason({ code: "needs", reason: "reading_timeout", purpose: "skeleton" }),
		opening: playerReason({ code: "needs", reason: "reading_timeout", purpose: "opening" }),
		guidance: playerReason({ code: "needs", reason: "reading_timeout", purpose: "guidance" }),
		failed: playerReason({ code: "needs", reason: "reading_failed" }),
		choice: playerReason({ code: "needs_choice" }),
		blockedChoice: playerReason({ code: "setup_blocked", blockedBy: "guidance_at_turn_start", cause: "needs_choice" }),
		blockedRetry: playerReason({ code: "setup_blocked", blockedBy: "guidance_at_create_campaign", cause: "preparation_failed" }),
		blockedStale: playerReason({ code: "setup_blocked", blockedBy: "guidance_at_turn_start", cause: "guidance_not_ready" }),
		blockedPackages: playerReason({ code: "setup_blocked", blockedBy: "package_context", cause: "invalid_params" }),
		guidanceFailed: playerReason({ code: "guidance_failed", cause: "preparation_failed" }),
		openingPreparing: playerReason({ code: "campaign_not_ready", reason: "opening_preparing" }),
	};
	for (const [name, text] of Object.entries(reasons)) assert.equal(typeof text, "string", `${name} has a reason`);
	// Distinct causes are told apart: which reading is still running, a question, a retry, a stale starter, the packages.
	assert.equal(new Set([reasons.skeleton, reasons.opening, reasons.guidance, reasons.failed, reasons.choice, reasons.blockedRetry,
		reasons.blockedStale, reasons.blockedPackages, reasons.openingPreparing]).size, 9);
	// Each reading the host knows is named for what it reads, never the line an unknown purpose falls back to.
	const unknown = playerReason({ code: "needs", reason: "reading_timeout", purpose: "not-a-purpose" });
	for (const name of ["skeleton", "opening", "guidance"]) assert.notEqual(reasons[name], unknown, `${name} says what is being read`);
	assert.equal(reasons.blockedChoice, reasons.choice, "a block on the missing opening says what the question itself says");
	assert.equal(reasons.guidanceFailed, reasons.blockedRetry, "a failed guidance preparation reads the same wherever it failed");
});

test("a reading wait says roughly how long it has been, once it has been a minute", () => {
	const fresh = playerReason({ code: "needs", reason: "reading_timeout", purpose: "skeleton", minutes: 0 });
	const later = playerReason({ code: "needs", reason: "reading_timeout", purpose: "skeleton", minutes: 7 });
	assert.ok(!/\d/.test(fresh), fresh);
	assert.match(later, /\b7 minutes\b/);
	assert.ok(later.startsWith(fresh.split(" Nothing is needed")[0]), "the same wait, with the time added");
});

test("a refusal of the guide's own call has no reason for the player", () => {
	for (const facts of [{}, { code: "invalid_params" }, { code: "needs", reason: "source_window_required" }, { code: "brief_incomplete" }])
		assert.equal(playerReason(facts), undefined, JSON.stringify(facts));
});

test("the setup prompt tells the guide to use the field the host emits", () => {
	const prompt = readFileSync(join(REPO, "prompts/setup.md"), "utf8");
	assert.ok(prompt.includes("`player_reason`"), "the guide is told what the player_reason field is for");
	assert.ok(prompt.includes("`needs_choice`") && prompt.includes("`start_scene`"), "and how a book with several openings is answered");
});
