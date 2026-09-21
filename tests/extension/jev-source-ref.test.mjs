import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ContractError } from "../../runtime/jev/contracts.ts";
import {
	codePointRangeToUtf16,
	issueSourceRef,
	resolveSourceRef,
	sourceRefCatalog,
} from "../../runtime/jev/source-ref.ts";
import { memoryStatementView, sourceQuote } from "../../runtime/jev/source-ref-legacy.ts";

const scope = Object.freeze({
	owner: "campaign-owner",
	campaign: "campaign-a",
	worldline: "main",
	loop: 3,
	audience: "keeper",
});

function error(code, action) {
	assert.throws(action, (caught) => caught instanceof ContractError && caught.code === code);
}

function snapshot(overrides = {}) {
	return {
		scope,
		resource: "native:module-a:page-7",
		revision: "rev-7",
		sourceType: "native_text",
		text: "default source",
		...overrides,
	};
}

function accessFor(source, { mode = "active", activeRevision = source.revision, requestScope = scope } = {}) {
	return {
		scope: requestScope,
		mode,
		read(resource, revision) {
			return resource === source.resource && revision === source.revision ? source : undefined;
		},
		currentRevision(resource) {
			return resource === source.resource ? activeRevision : undefined;
		},
	};
}

test("duplicate native text stays pinned to its issued UTF-16 occurrence without normalization or reanchor", () => {
	const text = "first\r\nCafe\u0301\r\nsecond\r\nCafe\u0301\r\n";
	const source = snapshot({ text });
	const first = text.indexOf("Cafe\u0301");
	const second = text.lastIndexOf("Cafe\u0301");
	assert.notEqual(first, second);

	const firstRef = issueSourceRef(source, { kind: "utf16", start: first, end: first + "Cafe\u0301".length });
	const secondRef = issueSourceRef(source, { kind: "utf16", start: second, end: second + "Cafe\u0301".length });
	const access = accessFor(source);
	assert.equal(resolveSourceRef(firstRef, access), "Cafe\u0301");
	assert.equal(resolveSourceRef(secondRef, access), "Cafe\u0301");
	assert.notDeepEqual(firstRef.selector, secondRef.selector);
	assert.equal(resolveSourceRef(issueSourceRef(source, { kind: "utf16", start: 0, end: text.length }), access), text);
	assert.equal(text.includes("\r\n"), true);
	assert.equal(text.includes("e\u0301"), true);
});

test("UTF-16 ranges accept astral boundaries but reject every surrogate split", () => {
	const source = snapshot({ text: "A\u{1F600}B" });
	const access = accessFor(source);
	const emoji = issueSourceRef(source, { kind: "utf16", start: 1, end: 3 });
	assert.equal(resolveSourceRef(emoji, access), "\u{1F600}");
	for (const selector of [
		{ kind: "utf16", start: 1, end: 2 },
		{ kind: "utf16", start: 2, end: 3 },
	]) error("split_surrogate", () => issueSourceRef(source, selector));
	for (const selector of [
		{ kind: "utf16", start: -1, end: 0 },
		{ kind: "utf16", start: 3, end: 2 },
		{ kind: "utf16", start: 0, end: 5 },
	]) error("invalid_source_range", () => issueSourceRef(source, selector));
});

test("legacy code-point positions convert exactly at empty, astral, end, and out-of-range boundaries", () => {
	const text = "A\u{1F600}e\u0301";
	assert.deepEqual(codePointRangeToUtf16(text, 0, 0), { start: 0, end: 0 });
	assert.deepEqual(codePointRangeToUtf16(text, 1, 2), { start: 1, end: 3 });
	assert.deepEqual(codePointRangeToUtf16(text, 2, 4), { start: 3, end: 5 });
	assert.deepEqual(codePointRangeToUtf16(text, 4, 4), { start: 5, end: 5 });
	for (const range of [[-1, 0], [1, 0], [0, 5], [1.5, 2]]) {
		error("invalid_code_point_range", () => codePointRangeToUtf16(text, range[0], range[1]));
	}
});

test("field selectors materialize only exact allowlisted scalar paths", () => {
	const record = {
		title: "Case notes",
		facts: { count: 7, known: false, missing: null },
		rows: [{ label: "first" }, { label: "second" }],
	};
	const source = snapshot({
		resource: "record:case-notes",
		sourceType: "record",
		record,
		allowedFields: [
			["title"],
			["facts", "count"],
			["facts", "known"],
			["facts", "missing"],
			["rows", "1", "label"],
		],
	});
	const access = accessFor(source);
	for (const [path, expected] of [
		[["title"], "Case notes"],
		[["facts", "count"], 7],
		[["facts", "known"], false],
		[["facts", "missing"], null],
		[["rows", "1", "label"], "second"],
	]) {
		const ref = issueSourceRef(source, { kind: "field", path });
		assert.equal(resolveSourceRef(ref, access), expected);
	}
	for (const path of [["facts"], ["rows", "0", "label"], ["missing"], ["rows", "01", "label"]]) {
		error("source_field_not_allowed", () => issueSourceRef(source, { kind: "field", path }));
	}
	error("invalid_source_selector", () => issueSourceRef(source, { kind: "field", path: ["__proto__"] }));
});

test("field resolution rejects missing, prototype, accessor, and non-scalar fields", () => {
	const prototypeRecord = Object.create({ secret: "inherited" });
	const prototypeSource = snapshot({
		resource: "record:prototype",
		sourceType: "record",
		record: prototypeRecord,
		allowedFields: [["secret"]],
	});
	error("source_field_missing", () => issueSourceRef(prototypeSource, { kind: "field", path: ["secret"] }));

	const accessorRecord = {};
	Object.defineProperty(accessorRecord, "secret", { enumerable: true, get() { return "computed"; } });
	const accessorSource = snapshot({
		resource: "record:accessor",
		sourceType: "record",
		record: accessorRecord,
		allowedFields: [["secret"]],
	});
	error("source_field_missing", () => issueSourceRef(accessorSource, { kind: "field", path: ["secret"] }));

	const objectSource = snapshot({
		resource: "record:object",
		sourceType: "record",
		record: { nested: { not: "scalar" }, values: [1, 2] },
		allowedFields: [["nested"], ["values"]],
	});
	for (const path of [["nested"], ["values"]])
		error("source_field_not_scalar", () => issueSourceRef(objectSource, { kind: "field", path }));
});

test("active reads reject stale revisions both before and after materialization while historical reads stay pinned", () => {
	const source = snapshot({ text: "Pinned statement" });
	const ref = issueSourceRef(source, { kind: "utf16", start: 0, end: source.text.length });
	let reads = 0;
	const staleBefore = {
		scope,
		mode: "active",
		read() { reads += 1; return source; },
		currentRevision() { return "rev-8"; },
	};
	error("stale_source_ref", () => resolveSourceRef(ref, staleBefore));
	assert.equal(reads, 0);

	let revisionChecks = 0;
	const staleAfter = {
		scope,
		mode: "active",
		read() { return source; },
		currentRevision() { return revisionChecks++ === 0 ? "rev-7" : "rev-8"; },
	};
	error("stale_source_ref", () => resolveSourceRef(ref, staleAfter));
	assert.equal(revisionChecks, 2);

	const historical = accessFor(source, { mode: "historical", activeRevision: "rev-8" });
	assert.equal(resolveSourceRef(ref, historical), "Pinned statement");
});

test("scope, schema, type, and snapshot forgeries fail instead of widening access", () => {
	const source = snapshot({ text: "Protected" });
	const ref = issueSourceRef(source, { kind: "utf16", start: 0, end: source.text.length });
	for (const changedScope of [
		{ ...scope, owner: "other-owner" },
		{ ...scope, campaign: "other-campaign" },
		{ ...scope, worldline: "other-line" },
		{ ...scope, loop: 4 },
		{ ...scope, audience: "player" },
		{ owner: scope.owner, campaign: scope.campaign, audience: scope.audience },
	]) error("source_scope_mismatch", () => resolveSourceRef(ref, accessFor(source, { requestScope: changedScope })));

	error("invalid_source_ref", () => resolveSourceRef({ ...ref, version: 2 }, accessFor(source)));
	error("invalid_source_selector", () => resolveSourceRef({ ...ref, selector: { kind: "utf16", start: 0, end: source.text.length, url: "x" } }, accessFor(source)));
	error("source_snapshot_mismatch", () =>
		resolveSourceRef({ ...ref, sourceType: "record" }, accessFor(source)));
	error("source_snapshot_mismatch", () =>
		resolveSourceRef(ref, accessFor({ ...source, scope: { ...scope, audience: "player" } })));
	error("source_revision_unavailable", () =>
		resolveSourceRef(ref, { ...accessFor(source), read() { return undefined; } }));
});

test("catalog exposes only host ordinals, pins references, and revalidates selected reads", () => {
	const source = snapshot({ text: "left / right" });
	const refs = [
		issueSourceRef(source, { kind: "utf16", start: 0, end: 4 }),
		issueSourceRef(source, { kind: "utf16", start: 7, end: 12 }),
	];
	const access = accessFor(source);
	const catalog = sourceRefCatalog(refs, access);
	assert.deepEqual(catalog.candidates, [{ ordinal: 0, value: "left" }, { ordinal: 1, value: "right" }]);
	for (const candidate of catalog.candidates) {
		assert.deepEqual(Object.keys(candidate).sort(), ["ordinal", "value"]);
		assert.equal(JSON.stringify(candidate).includes("resource"), false);
		assert.equal(JSON.stringify(candidate).includes("revision"), false);
	}
	refs[0].selector.start = 1;
	assert.equal(catalog.select(0).value, "left");
	error("unknown_source_ordinal", () => catalog.select(-1));
	error("unknown_source_ordinal", () => catalog.select(2));
	error("unknown_source_ordinal", () => catalog.select(0.5));

	let revision = "rev-7";
	const changingAccess = { ...accessFor(source), currentRevision() { return revision; } };
	const changingCatalog = sourceRefCatalog(refs, changingAccess);
	revision = "rev-8";
	error("stale_source_ref", () => changingCatalog.select(1));
});

test("legacy quote and memory views preserve old text while new reference-backed views materialize exact text", () => {
	const source = snapshot({ text: "Raw\r\nCafe\u0301" });
	const ref = issueSourceRef(source, { kind: "utf16", start: 0, end: source.text.length });
	const access = accessFor(source);
	const quote = sourceQuote(ref, access);
	assert.deepEqual(quote, { quote: "Raw\r\nCafe\u0301", sourceRef: ref });
	assert.notEqual(quote.sourceRef, ref);

	const oldRecord = { statement: "Historical statement", kind: "legacy" };
	assert.deepEqual(memoryStatementView(oldRecord, access), oldRecord);
	const newRecord = { statementRef: ref, kind: "new" };
	assert.deepEqual(memoryStatementView(newRecord, access), {
		statementRef: ref,
		kind: "new",
		statement: "Raw\r\nCafe\u0301",
	});
	error("source_quote_not_text", () => sourceQuote(
		issueSourceRef(snapshot({
			resource: "record:number",
			sourceType: "record",
			record: { value: 4 },
			allowedFields: [["value"]],
		}), { kind: "field", path: ["value"] }),
		accessFor(snapshot({ resource: "record:number", sourceType: "record", record: { value: 4 }, allowedFields: [["value"]] })),
	));
	error("memory_statement_missing", () => memoryStatementView({ kind: "broken" }, access));
});
