/**
 * Contract §135.27.1.3: the launcher's notices reach the App.
 *
 * `piLaunch` hands its notices to the Pi child as `PI_COC_HOST_NOTICES`; the kernel extension takes them once at
 * `session_start` and places each as a §55 service notice -- the channel the App already projects -- and removes them
 * from every model request. These run a real Pi session with the real extensions (`harness.mjs`); the projection
 * half of the path is pinned in `Electron/packages/pi-backend/test/a-notice-reaches-the-screen.test.ts`.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { customMessages, openTable, waitForIdle } from "./harness.mjs";
import { HOST_NOTICES_ENV } from "../../runtime/host-notices.ts";

// The marker is what the request is searched for: a serialized request escapes quotes, so a quoted error never matches.
const MARKER = "host-notice-marker-7f3a";
const UNPARSABLE = { notice: "models_json_unparsable", path: "/agent/models.json", error: `Unexpected token at ${MARKER}` };
const COMMENTS = { notice: "models_json_operator_comments", path: "/agent/models.json", missing: ["opencode-go/deepseek-v4-flash"] };

const placed = (table) => customMessages(table.session, "coc-delivery").filter((message) => message.details?.host_notice);

/** A Keeper reply that records the request it answered, then lands a turn. */
function recording(seen) {
	return [
		(context) => {
			seen.push(JSON.stringify(context.messages));
			return fauxAssistantMessage([fauxToolCall("narrate", { text: "The hallway is quiet." })], { stopReason: "toolUse" });
		},
		fauxAssistantMessage("Should never be consumed."),
	];
}

test("a play table places the launcher's notices as service notices before any turn, once", async (t) => {
	const seen = [];
	const table = await openTable({ env: { [HOST_NOTICES_ENV]: JSON.stringify([UNPARSABLE, COMMENTS]) }, responses: recording(seen) });
	t.after(() => table.dispose());

	const notices = placed(table);
	assert.deepEqual(notices.map((message) => message.details.host_notice), ["models_json_unparsable", "models_json_operator_comments"]);
	for (const message of notices) {
		assert.equal(message.display, true);
		assert.equal(message.details.coc_delivery, true);
		assert.ok(Number.isSafeInteger(message.details.turn), "an integer turn makes it closed noise once a boundary follows");
	}
	assert.ok(notices[0].content.includes(UNPARSABLE.path) && notices[0].content.includes(MARKER), notices[0].content);
	assert.ok(notices[1].content.includes("opencode-go/deepseek-v4-flash"), notices[1].content);
	assert.equal(process.env[HOST_NOTICES_ENV], undefined, "taken: a reload or a lane child does not see them again");

	await table.session.prompt("I listen at the door.");
	await waitForIdle(table.session);
	assert.equal(seen.length, 1, "the Keeper was asked once");
	assert.ok(seen[0].includes("I listen at the door."), "the search reaches the request: the player's own words are found in it");
	assert.ok(!seen[0].includes(MARKER), "the Keeper's request carries no host notice");
	// Placed before the player's turn, so the turn's boundary follows them.
	const rows = table.session.messages;
	const firstNotice = rows.findIndex((message) => message.role === "custom" && message.details?.host_notice);
	const firstPlayer = rows.findIndex((message) => message.role === "user");
	assert.ok(firstNotice >= 0 && firstNotice < firstPlayer, `notice at ${firstNotice}, player at ${firstPlayer}`);
	assert.equal(placed(table).length, 2, "no turn places them again");
});

test("a setup session places the notice at turn 0 and the setup guide's request never carries it", async (t) => {
	const seen = [];
	const table = await openTable({ mode: "setup", campaign: null, env: { [HOST_NOTICES_ENV]: JSON.stringify([UNPARSABLE]) },
		responses: [(context) => { seen.push(JSON.stringify(context.messages)); return fauxAssistantMessage("Which book shall we play?"); }] });
	t.after(() => table.dispose());

	const notices = placed(table);
	assert.equal(notices.length, 1);
	assert.equal(notices[0].details.turn, 0);
	await table.session.prompt("Let's start.");
	await waitForIdle(table.session);
	assert.equal(seen.length, 1, "the setup guide was asked once");
	assert.ok(seen[0].includes("Let's start."), "the search reaches the request: the player's own words are found in it");
	assert.ok(!seen[0].includes(MARKER), "the setup guide's request carries no host notice");
});

test("no notices, or only malformed ones, place nothing", async (t) => {
	for (const value of [undefined, "not json", JSON.stringify([{ notice: "models_json_unparsable" }, { notice: "something_else", path: "/x" }])])
		await t.test(String(value), async (t) => {
			const table = await openTable({ env: { [HOST_NOTICES_ENV]: value }, responses: [] });
			t.after(() => table.dispose());
			assert.deepEqual(placed(table), []);
			assert.equal(process.env[HOST_NOTICES_ENV], undefined);
		});
});
