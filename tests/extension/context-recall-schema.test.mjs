import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Check } from "typebox/value";
import { COC_TOOL_NAMES, COC_TOOLS } from "../../extensions/kernel/tools.ts";

const recall = COC_TOOLS.find((tool) => tool.name === "recall");
const schema = recall.parameters;
const properties = schema.properties;
const sections = ["cards", "timeline", "events", "diff", "hits"];

// Public schema checks only: RPC pagination and live continuity have separate acceptance seams.
test("bounded recall keeps the seven verbs and existing query filters, exposing promise", () => {
	assert.equal(COC_TOOL_NAMES.length, 7);
	assert.equal(recall.method, "table.recall");
	assert.deepEqual(schema.required, ["what"]);
	assert.deepEqual(properties.what.enum, ["transcript", "memory", "history"]);
	assert.deepEqual(properties.kinds.items.enum, [
		"world_event", "knowledge", "belief", "relationship", "promise",
		"player_assertion", "player_preference", "keeper_correction",
	]);
	for (const args of [
		{ what: "transcript" },
		{ what: "transcript", turns: [1, 3], role: "keeper", read: { turn: 2, role: "keeper" } },
		{ what: "memory", about: ["Mira"], kinds: ["promise", "keeper_correction"], turns: [0, 80], include_superseded: true, limit: 12 },
		{ what: "history", turns: [1, 20], types: ["turn-finalized", "clue-discovered"], diff: [1, 20] },
	]) assert.ok(Check(schema, args), JSON.stringify(args));
	assert.match(properties.limit.description, /defaults to 12, capped at 20/);
	assert.match(properties.limit.description, /page.limit takes precedence/);
});

test("transcript read has only semantic turn/role and optional bounded text positions", () => {
	assert.deepEqual(Object.keys(properties.read.properties).sort(), ["limit", "offset", "role", "turn"]);
	assert.deepEqual(properties.read.required, ["turn", "role"]);
	assert.deepEqual(properties.read.properties.role.enum, ["player", "keeper"]);
	assert.ok(Check(schema, { what: "transcript", read: { turn: 7, role: "player", offset: 0, limit: 4096 } }));
	for (const read of [
		{ turn: 7 }, { role: "player" }, { turn: 7, role: "other" },
		{ turn: 7, role: "player", offset: -1 }, { turn: 7, role: "player", offset: 0.5 },
		{ turn: 7, role: "player", limit: 0 }, { turn: 7, role: "player", limit: 1.5 },
	]) assert.equal(Check(schema, { what: "transcript", read }), false, JSON.stringify(read));
	assert.match(properties.read.description, /cards only, never implicit full entries/);
});

test("listing and structured detail locations use the closed public section vocabulary", () => {
	assert.deepEqual(Object.keys(properties.page.properties).sort(), ["limit", "offset", "section"]);
	assert.deepEqual(properties.page.required ?? [], []);
	assert.deepEqual(properties.page.properties.section.enum, sections);
	assert.deepEqual(Object.keys(properties.detail.properties).sort(), ["index", "limit", "offset", "section"]);
	assert.deepEqual(properties.detail.required, ["section", "index"]);
	assert.deepEqual(properties.detail.properties.section.enum, sections);
	for (const section of sections) {
		assert.ok(Check(properties.page, { section, offset: 0, limit: 20 }));
		assert.ok(Check(properties.detail, { section, index: 0 }));
		assert.ok(Check(properties.detail, { section, index: 3, offset: 4096, limit: 1 }));
	}
	assert.ok(Check(properties.page, {}));
	for (const page of [{ section: "all" }, { offset: -1 }, { offset: 1.5 }, { limit: 0 }, { limit: 0.5 }]) {
		assert.equal(Check(properties.page, page), false, JSON.stringify(page));
	}
	for (const detail of [
		{}, { section: "events" }, { index: 0 }, { section: "all", index: 0 },
		{ section: "events", index: -1 }, { section: "events", index: 1.5 },
		{ section: "events", index: 0, offset: -1 }, { section: "events", index: 0, offset: 0.5 },
		{ section: "events", index: 0, limit: 0 }, { section: "events", index: 0, limit: 0.5 },
	]) assert.equal(Check(properties.detail, detail), false, JSON.stringify(detail));
	assert.match(properties.detail.description, /bounded original JSON text pages/);
});

test("recall documents bounds, defaults, exact-source authority and complete continuation args", () => {
	for (const phrase of [
		/12 KiB of JSON including metadata/, /20 listing rows/, /4096 Unicode code points/,
		/byte pressure may shorten/, /cards only/, /never automatic entries/,
		/defaults to the latest 20 turns/, /diff if diff is supplied, events if types is supplied, otherwise timeline/,
		/page\.section/, /conversation_report candidates, not module truth/,
		/status, state, correction and supersession\/source annotations/,
		/verification_scope record_integrity_only/, /complete original matches the canonical turn record before slicing/,
		/next, read or detail references as complete recall arguments/, /preserving their query filters/,
		/stale or unknown continuation/, /page-0 refresh/, /no all-text escape/,
	]) assert.match(recall.description, phrase);
	assert.match(properties.turns.description, /transcript defaults to the last 3 turns/);
	assert.match(properties.page.properties.limit.description, /defaults to 20 and capped at 20/);
	assert.match(properties.page.properties.section.description, /diff if diff is supplied, events if types is supplied, otherwise timeline/);
	for (const textMode of [properties.read, properties.detail]) {
		assert.equal(textMode.properties.offset.minimum, 0);
		assert.match(textMode.properties.offset.description, /Unicode code-point offset/);
		assert.match(textMode.properties.offset.description, /defaults to 0/);
		assert.equal(textMode.properties.limit.minimum, 1);
		assert.match(textMode.properties.limit.description, /defaults to and is capped at 4096/);
	}
});

test("internal snapshots and context identity stay hidden while the declared skill annotation is exposed", () => {
	assert.deepEqual(Object.keys(properties).sort(), [
		"about", "detail", "diff", "include_superseded", "kinds", "limit", "page", "query", "read", "role", "turns", "types", "using_skill", "what",
	]);
	assert.match(properties.query.description, /memory only/);
	assert.match(properties.using_skill.description, /host-only annotation/);
	const visible = JSON.stringify(recall);
	for (const internal of ["_snapshot", "_context", "source_revision", "call_id"]) {
		assert.equal(visible.includes(internal), false, internal);
	}
});
