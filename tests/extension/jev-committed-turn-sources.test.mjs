import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { ContractError } from "../../runtime/jev/contracts.ts";
import {
	committedTurnCatalog,
	TURN_SOURCE_SEGMENT_UTF16_LIMIT,
} from "../../runtime/jev/committed-turn-sources.ts";
import { resolveSourceRef } from "../../runtime/jev/source-ref.ts";

const scope = {
	owner: "memory-owner",
	campaign: "campaign-a",
	worldline: "main",
	loop: 2,
	audience: "keeper",
};

function input(overrides = {}) {
	return {
		scope,
		turn: 14,
		commit: "4ede2b4",
		playerText: "玩家原文。",
		keeperText: "Keeper original.",
		...overrides,
	};
}

function sha256(text) {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

function access(catalog) {
	const snapshots = new Map(catalog.snapshots.map(snapshot => [`${snapshot.resource}:${snapshot.revision}`, snapshot]));
	return {
		scope,
		mode: "active",
		read: (resource, revision) => snapshots.get(`${resource}:${revision}`),
		currentRevision: resource => catalog.snapshots.find(snapshot => snapshot.resource === resource)?.revision,
	};
}

function assertNoSplitSurrogate(text, offset) {
	const before = text.charCodeAt(offset - 1), after = text.charCodeAt(offset);
	assert.equal(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff, false);
}

test("catalog preserves exact CJK, CRLF, emoji, combining marks, and source bindings", () => {
	const playerText = `${"甲".repeat(799)}😀\r\ne\u0301 remains decomposed。\r\n`;
	const keeperText = "第一段。\r\n\r\nSecond paragraph!\n最后？";
	const catalog = committedTurnCatalog(input({ playerText, keeperText }));

	assert.equal(catalog.turn, 14);
	assert.equal(catalog.commit, "4ede2b4");
	assert.deepEqual(catalog.coverage, { complete: true, emptyRoles: [] });
	assert.deepEqual(catalog.snapshots.map(snapshot => ({ resource: snapshot.resource, revision: snapshot.revision, sourceType: snapshot.sourceType })), [
		{ resource: "turn:14:player", revision: sha256(playerText), sourceType: "turn" },
		{ resource: "turn:14:keeper", revision: sha256(keeperText), sourceType: "turn" },
	]);

	for (const role of ["player", "keeper"]) {
		const original = role === "player" ? playerText : keeperText;
		const segments = catalog.segments.filter(segment => segment.role === role);
		assert.equal(segments.map(segment => segment.text).join(""), original);
		segments.forEach((segment, ordinal) => {
			assert.equal(segment.alias, `${role}:${ordinal}`);
			assert.ok(segment.text.length <= TURN_SOURCE_SEGMENT_UTF16_LIMIT);
			assert.equal(resolveSourceRef(segment.ref, access(catalog)), segment.text);
			assertNoSplitSurrogate(original, segment.ref.selector.start);
			assertNoSplitSurrogate(original, segment.ref.selector.end);
		});
	}
	assert.ok(catalog.segments.some(segment => segment.text.includes("\r\n")));
	assert.equal(catalog.segments.map(segment => segment.text).join("").includes("e\u0301"), true);
});

test("duplicate equal occurrences keep distinct ordinals and exact coordinates", () => {
	const duplicate = "同文".repeat(200);
	const exact = `${duplicate}\r\n${duplicate}\r\n`;
	const catalog = committedTurnCatalog(input({ playerText: exact, keeperText: "" }));
	const segments = catalog.segments.filter(segment => segment.role === "player");

	assert.equal(segments.length, 2);
	assert.equal(segments[0].text, segments[1].text);
	assert.notEqual(segments[0].alias, segments[1].alias);
	assert.notDeepEqual(segments[0].ref.selector, segments[1].ref.selector);
	assert.equal(segments.map(segment => segment.text).join(""), exact);
	assert.deepEqual(catalog.coverage.emptyRoles, ["keeper"]);
});

test("short duplicate sentences receive distinct occurrence refs", () => {
	const catalog = committedTurnCatalog(input({ playerText: "Same.\nSame.", keeperText: "" }));
	const segments = catalog.segments.filter(segment => segment.role === "player");

	assert.deepEqual(segments.map(segment => segment.text), ["Same.\n", "Same."]);
	assert.deepEqual(segments.map(segment => segment.alias), ["player:0", "player:1"]);
	assert.deepEqual(segments.map(segment => segment.ref.selector), [
		{ kind: "utf16", start: 0, end: 6 },
		{ kind: "utf16", start: 6, end: 11 },
	]);
});

test("catalog has no twelve-segment cap or silent truncation", () => {
	const playerText = Array.from({ length: 17 }, (_, index) =>
		index % 3 === 0 ? `第${index}句。 ` : index % 3 === 1 ? `Sentence ${index}! ` : `Question ${index}? `).join("");
	const catalog = committedTurnCatalog(input({ playerText, keeperText: "" }));
	const segments = catalog.segments.filter(segment => segment.role === "player");

	assert.equal(segments.length, 17);
	assert.ok(segments.every(segment => segment.text.length < TURN_SOURCE_SEGMENT_UTF16_LIMIT));
	assert.equal(segments.map(segment => segment.text).join(""), playerText);
	assert.equal(catalog.coverage.complete, true);
});

test("syntax boundaries preserve closing quotes and decimals while long unpunctuated text chunks safely", () => {
	const prefix = "Value 3.14 stays. \"Quoted!\"  Next?\r\nParagraph without punctuation\r\n";
	const tail = "x".repeat(1601);
	const playerText = prefix + tail;
	const catalog = committedTurnCatalog(input({ playerText, keeperText: "" }));
	const segments = catalog.segments.filter(segment => segment.role === "player");

	assert.deepEqual(segments.slice(0, 4).map(segment => segment.text), [
		"Value 3.14 stays. ",
		"\"Quoted!\"  ",
		"Next?\r\n",
		"Paragraph without punctuation\r\n",
	]);
	assert.deepEqual(segments.slice(4).map(segment => segment.text.length), [800, 800, 1]);
	assert.ok(segments.every(segment => segment.text.length <= TURN_SOURCE_SEGMENT_UTF16_LIMIT));
	assert.equal(segments.map(segment => segment.text).join(""), playerText);
});

test("empty roles produce snapshots, zero segments, and explicit coverage", () => {
	const catalog = committedTurnCatalog(input({ playerText: "", keeperText: "" }));
	assert.equal(catalog.snapshots.length, 2);
	assert.deepEqual(catalog.snapshots.map(snapshot => snapshot.text), ["", ""]);
	assert.deepEqual(catalog.snapshots.map(snapshot => snapshot.revision), [sha256(""), sha256("")]);
	assert.deepEqual(catalog.segments, []);
	assert.deepEqual(catalog.coverage, { complete: true, emptyRoles: ["player", "keeper"] });
});

test("catalog rejects malformed or incomplete source bindings", () => {
	const cases = [
		{ ...input(), extra: true },
		{ ...input(), turn: -1 },
		{ ...input(), turn: 1.5 },
		{ ...input(), commit: "" },
		{ ...input(), commit: " 4ede2b4 " },
		{ ...input(), playerText: null },
		{ ...input(), scope: { ...scope, owner: "" } },
		{ ...input(), scope: { ...scope, campaign: undefined } },
		{ ...input(), scope: { ...scope, worldline: undefined } },
		{ ...input(), scope: { ...scope, loop: undefined } },
		{ ...input(), scope: { ...scope, audience: "player" } },
		{ ...input(), scope: { ...scope, extra: true } },
	];
	for (const value of cases) assert.throws(() => committedTurnCatalog(value), error =>
		error instanceof ContractError && error.code === "invalid_committed_turn_source");
});

test("catalog clones caller scope and keeps snapshots and refs independent", () => {
	const supplied = input({ playerText: "one.\ntwo.", keeperText: "three." });
	const original = structuredClone(supplied);
	const catalog = committedTurnCatalog(supplied);
	const firstRefOwner = catalog.segments[0].ref.scope.owner;

	supplied.scope.owner = "mutated-input";
	catalog.snapshots[0].scope.owner = "mutated-snapshot";
	catalog.segments[0].ref.scope.owner = "mutated-ref";
	catalog.segments[0].ref.selector.start = 1;
	const keeper = catalog.segments.find(segment => segment.role === "keeper");

	assert.equal(original.scope.owner, "memory-owner");
	assert.equal(catalog.snapshots[1].scope.owner, "memory-owner");
	assert.equal(keeper.ref.scope.owner, firstRefOwner);
	assert.deepEqual(keeper.ref.selector, { kind: "utf16", start: 0, end: 6 });
	assert.equal(catalog.commit, original.commit);
});
