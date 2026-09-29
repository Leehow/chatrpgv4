/**
 * Contract §32.4.1 (SL-105): an `apply` effect is identified, for the admission reuse key, by every field its kind
 * declares except the rationale sentences `why` and `how`. Before it the key read a fixed list that had missed the fields
 * added later (`time`'s `band`, `until`, `stated`, `beyond_travel`; `cash`'s `stated`; `move`'s `via`; `object`'s
 * `document` and `part`; the intent-result `intent_ref` and `intent_outcome`), so within a turn a verdict on one time
 * cost was reused for another.
 *
 * Two halves. Through the real extension and its `apply` admission seam (scripted review model, fake kernel): a second
 * batch that differs only in `band` is reviewed again, and one that differs only in `why` reuses the verdict. And a guard
 * over the tool schema itself: every declared field of each kind §32.1 reviews either changes the key or is a rationale
 * sentence, so a field added to the schema later cannot slip past the key unnoticed.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { TRIGGER_KINDS, admissionRequest, effectSignature } from "../../extensions/kernel/admission.ts";
import { COC_TOOLS, SENTENCE_FIELDS } from "../../extensions/kernel/tools.ts";
import { admissionProposes, openTable } from "./harness.mjs";

const verdict = (row) => fauxAssistantMessage(JSON.stringify(row));
const applyCall = (effects) => fauxAssistantMessage([fauxToolCall("apply", { effects })], { stopReason: "toolUse" });
const kernelCalls = (table, method) => table.kernelRequests().filter((entry) => entry.method === method);
const admissionRows = (table) => table.telemetry().filter((row) => row.lane === "admission");

test("two batches in one turn that differ only in band are both reviewed: the verdict on a word is not reused for a night", async (t) => {
	const table = await openTable({
		responses: [
			applyCall([{ kind: "time", band: "speak_briefly", why: "a word with the clerk" }]),
			// The same line with another band: a different time cost, so a different proposal.
			applyCall([{ kind: "time", band: "sleep_night", why: "a word with the clerk" }]),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "职员点点头，把登记簿推了过来。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("after"),
		],
		laneResponses: {
			admission: [
				verdict({ verdict: "entailed", grounds: "asking the clerk takes a moment" }),
				verdict({ verdict: "not_authorized", grounds: "the player asked one question, not to stay the night", missing: "whether to stay the night" }),
			],
		},
	});
	t.after(() => table.dispose());
	await table.session.prompt("我问前台职员昨晚有没有人来找过我");

	const requests = table.lanes.admission.requests();
	assert.equal(requests.length, 2, "the second band was reviewed, not answered from the first band's verdict");
	assert.match(admissionProposes(requests[0]), /apply time: band="speak_briefly"/);
	assert.match(admissionProposes(requests[1]), /apply time: band="sleep_night"/);

	const applied = kernelCalls(table, "table.apply");
	assert.equal(applied.length, 1, "only the admitted band reached the kernel");
	assert.deepEqual(applied[0].params.effects, [{ kind: "time", band: "speak_briefly", why: "a word with the clerk" }]);

	const rows = admissionRows(table);
	assert.deepEqual(rows.map((row) => [row.verdict, row.admitted, row.reused]), [
		["entailed", true, false],
		["not_authorized", false, false],
	]);
	assert.notEqual(rows[0].key, rows[1].key, "the two bands have two keys");
});

test("a batch that differs only in why reuses the verdict: the rationale is outside the key", async (t) => {
	const table = await openTable({
		responses: [
			applyCall([{ kind: "time", band: "library_research", why: "the stacks" }]),
			// The same time cost with its rationale rewritten: the same proposal, answered from the kept verdict.
			applyCall([{ kind: "time", band: "library_research", why: "an afternoon among the bound newspapers" }]),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "你还没决定要不要在这里耗上一下午。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("after"),
		],
		laneResponses: {
			admission: [
				verdict({ verdict: "not_authorized", grounds: "the player only asked where the archive is", missing: "whether to spend the afternoon researching" }),
				// Never asked for: a second review would admit, and the test would see the time land.
				verdict({ verdict: "authorized", grounds: "a second review that must not happen" }),
			],
		},
	});
	t.after(() => table.dispose());
	await table.session.prompt("档案室在哪儿？");

	assert.equal(table.lanes.admission.requests().length, 1, "one review; the why-only resend reused its verdict");
	assert.equal(kernelCalls(table, "table.apply").length, 0, "the kept refusal refused the resend too");
	const rows = admissionRows(table);
	assert.deepEqual(rows.map((row) => [row.verdict, row.reused]), [
		["not_authorized", false],
		["not_authorized", true],
	]);
	assert.equal(rows[0].key, rows[1].key);
});

/** Each effect schema of the `apply` tool, by its kind. */
function effectSchemas() {
	const schemas = COC_TOOLS.find((tool) => tool.name === "apply").parameters.properties.effects.items.anyOf;
	return new Map(schemas.map((schema) => [schema.properties.kind.const ?? schema.properties.kind.enum?.[0], schema]));
}

/** A value of the field's declared type, so the probe is a well-formed effect field and not just any string. */
function sample(schema) {
	if (schema.anyOf) return sample(schema.anyOf[0]);
	if (schema.const !== undefined) return schema.const;
	if (schema.enum) return schema.enum[0];
	switch (schema.type) {
		case "string":
			return "probe";
		case "integer":
		case "number":
			return 7;
		case "boolean":
			return true;
		case "array":
			return [sample(schema.items)];
		case "object":
			return Object.fromEntries(Object.entries(schema.properties ?? { probe: { type: "string" } }).map(([key, value]) => [key, sample(value)]));
		default:
			throw new Error(`no sample for ${JSON.stringify(schema)}`);
	}
}

test("every field a reviewed kind declares identifies it, except the rationale sentences why and how", () => {
	const schemas = effectSchemas();
	assert.deepEqual([...TRIGGER_KINDS].sort(), ["cash", "clue", "handout", "item", "map", "move", "object", "time", "usage"]);
	const scope = { party: ["Thomas Hayes"] };
	for (const kind of TRIGGER_KINDS) {
		const schema = schemas.get(kind);
		assert.ok(schema, `the apply tool declares ${kind}`);
		// A reviewed base effect: a move to somewhere else, an object going to someone (§32.1's own cases).
		const base = { kind, ...(kind === "move" || kind === "object" ? { to: "base-target" } : {}) };
		const keyOf = (effect) => admissionRequest("apply", { effects: [effect] }, scope)?.key;
		assert.ok(keyOf(base), `a bare ${kind} is put to review`);
		for (const [field, fieldSchema] of Object.entries(schema.properties)) {
			if (field === "kind" || (field === "to" && base.to)) continue;
			// `adopt` makes an object adoption, which no reviewer reads (§32.1); its signature still carries it.
			const probe = { ...base, [field]: sample(fieldSchema) };
			if (SENTENCE_FIELDS.includes(field)) {
				assert.equal(effectSignature(probe), effectSignature(base), `${kind}.${field} is a rationale sentence and outside the key`);
				assert.equal(keyOf(probe), keyOf(base), `${kind}.${field}: a rationale-only change reuses the verdict`);
				continue;
			}
			assert.notEqual(effectSignature(probe), effectSignature(base), `${kind}.${field} is declared but not read by effectSignature (§32.4.1)`);
			if (field !== "adopt") assert.notEqual(keyOf(probe), keyOf(base), `${kind}.${field} does not change the admission key`);
		}
	}
});

test("the fields the list had missed each give a line a key of its own", () => {
	const scope = { party: ["Thomas Hayes"] };
	const keyOf = (effect) => admissionRequest("apply", { effects: [effect] }, scope).key;
	const time = [
		{ kind: "time", band: "speak_briefly" },
		{ kind: "time", band: "library_research" },
		{ kind: "time", until: { days: 1, time: "08:00" } },
		{ kind: "time", until: { days: 0, time: "20:00" } },
		{ kind: "time", stated: "long-search" },
		{ kind: "time", minutes: 30 },
		{ kind: "time", minutes: 30, beyond_travel: true },
		{ kind: "time", minutes: 30, intent_ref: "intent:porter-1" },
	];
	assert.equal(new Set(time.map(keyOf)).size, time.length, "eight time costs, eight keys");
	assert.notEqual(keyOf({ kind: "cash", stated: "reward" }), keyOf({ kind: "cash", stated: "fee" }));
	assert.notEqual(keyOf({ kind: "move", to: "attic", via: "the coal chute" }), keyOf({ kind: "move", to: "attic", via: "the front stairs" }));
	assert.notEqual(
		keyOf({ kind: "object", name: "Letter", to: "Thomas Hayes", document: { action: "write", text: "Meet me at midnight" } }),
		keyOf({ kind: "object", name: "Letter", to: "Thomas Hayes", document: { action: "write", text: "Burn this" } }),
	);
	assert.notEqual(keyOf({ kind: "object", name: "Photographs", to: "Thomas Hayes", quantity: 2, part: "Two photographs" }), keyOf({ kind: "object", name: "Photographs", to: "Thomas Hayes", quantity: 2 }));
	assert.notEqual(keyOf({ kind: "clue", clue: "ledger", intent_ref: "intent:x", intent_outcome: "done" }), keyOf({ kind: "clue", clue: "ledger", intent_ref: "intent:x", intent_outcome: "failed" }));
	// And the rationale stays outside.
	assert.equal(keyOf({ kind: "time", band: "speak_briefly", why: "one" }), keyOf({ kind: "time", band: "speak_briefly", why: "two" }));
	assert.equal(keyOf({ kind: "clue", clue: "ledger", how: "one" }), keyOf({ kind: "clue", clue: "ledger" }));
});
