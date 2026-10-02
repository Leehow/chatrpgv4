/**
 * Contract §32.4.1 and §32.4.2 (SL-105): a proposal's admission reuse key is what the reviewers read of it, less the
 * Keeper's rationale. On `apply`, every field an effect's kind declares except `why` and `how`; before it the key read a
 * fixed list that had missed the fields added later (`time`'s `band`, `until`, `stated`, `beyond_travel`; `cash`'s
 * `stated`; `move`'s `via`; `object`'s `document` and `part`; the intent-result `intent_ref` and `intent_outcome`), so
 * within a turn a verdict on one time cost was reused for another. On `resolve`, one list is both the line and (less
 * `stakes`) the key, and it now carries what the investigator chooses (`skills`, `support`, `rule`, `obligation`, the
 * intention, how a fight ends) and none of the rules parameters of the result.
 *
 * Through the real extension and its admission seam (scripted review model, fake kernel): an `apply` batch that differs
 * only in `band`, and a `resolve` that differs only in `support`, are reviewed again; one that differs only in rationale
 * (`why`; `stakes` and the dice) reuses the verdict. And guards over the tool schemas themselves, so a field added later
 * cannot slip past the key unnoticed.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { RESOLVE_RATIONALE_FIELDS, RESOLVE_REVIEWED_FIELDS, TRIGGER_KINDS, admissionRequest, effectSignature } from "../../extensions/kernel/admission.ts";
import { COC_TOOLS, SENTENCE_FIELDS } from "../../extensions/kernel/tools.ts";
import { admissionProposes, openTable } from "./harness.mjs";

const verdict = (row) => fauxAssistantMessage(JSON.stringify(row));
const applyCall = (effects) => fauxAssistantMessage([fauxToolCall("apply", { effects })], { stopReason: "toolUse" });
const resolveCall = (action) => fauxAssistantMessage([fauxToolCall("resolve", { action })], { stopReason: "toolUse" });
const kernelCalls = (table, method) => table.kernelRequests().filter((entry) => entry.method === method);
const admissionRows = (table) => table.telemetry().filter((row) => row.lane === "admission");

test("a saved quote's exact terms and current ledger reach admission and invalidate a stale verdict", () => {
    const payload={effects:[{kind:'cash',quote:'Water and cigarettes'}]};
    const scope={party:['Alice'],cash:{investigator:{living:{spending_level:10,daily_spending:{day:0,total:8,debited:0}}},quotes:[{quote:'Water and cigarettes',purchase_amount:2.75}]}};
    const proposal=admissionRequest('apply',payload,scope);
    assert.match(proposal.lines[0],/registered_cash_context=/);
    assert.match(proposal.lines[0],/"purchase_amount":2.75/);
    assert.notEqual(proposal.key,admissionRequest('apply',payload,{...scope,cash:{...scope.cash,quotes:[{quote:'Water and cigarettes',purchase_amount:3.75}]}}).key);
    assert.equal(admissionRequest('apply',{effects:[{kind:'cash',mode:'quote',quote:'Water and cigarettes',items:[{name:'Water',quantity:2,unit_price:0.5}]}]},{party:['Alice']}),null,'an offer alone cannot pay money');
});

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

test("a roll that differs only in the evidence put on the table is reviewed again, and its line shows the clue", async (t) => {
	const ask = { intent: "social", goal: "get the doorman to let him look at the visitors' book", method: "Persuade", skill: "Persuade", target: "看门人" };
	const table = await openTable({
		responses: [
			resolveCall(ask),
			// The same roll with a discovered clue laid on the table: a disclosure the player has to have chosen (§32.4.2).
			resolveCall({ ...ask, support: "globe-unpublished-story" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "看门人犹豫了一下。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("after"),
		],
		laneResponses: {
			admission: [
				verdict({ verdict: "authorized", grounds: "the player asked to talk the doorman round" }),
				verdict({ verdict: "not_authorized", grounds: "the player never offered to show the clipping", missing: "whether to show the unpublished story" }),
			],
		},
	});
	t.after(() => table.dispose());
	await table.session.prompt("我跟看门人说说好话，让他给我看访客登记簿");

	const requests = table.lanes.admission.requests();
	assert.equal(requests.length, 2, "the roll with the evidence was reviewed, not answered from the plain roll's verdict");
	assert.doesNotMatch(admissionProposes(requests[0]), /support=/);
	assert.match(admissionProposes(requests[1]), /support="globe-unpublished-story"/);
	assert.equal(kernelCalls(table, "table.resolve").length, 1, "only the plain roll was rolled");
	const rows = admissionRows(table);
	assert.deepEqual(rows.map((row) => [row.verdict, row.admitted, row.reused]), [
		["authorized", true, false],
		["not_authorized", false, false],
	]);
});

test("a roll that differs only in its stakes and its dice reuses the verdict: rationale and rules parameters are outside the key", async (t) => {
	const ask = { intent: "investigate", goal: "force the cellar door", method: "shoulder it", skill: "STR", stakes: "the noise carries upstairs" };
	const table = await openTable({
		responses: [
			resolveCall(ask),
			resolveCall({ ...ask, stakes: "the hinge gives and he falls through", modifiers: { penalty_dice: 1, reason: "the door is swollen shut" } }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "门还关着。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("after"),
		],
		laneResponses: {
			admission: [
				verdict({ verdict: "not_authorized", grounds: "the player only looked at the door", missing: "whether to force the door" }),
				verdict({ verdict: "authorized", grounds: "a second review that must not happen" }),
			],
		},
	});
	t.after(() => table.dispose());
	await table.session.prompt("地窖门是锁着的吗？");

	assert.equal(table.lanes.admission.requests().length, 1, "one review; the resend with new stakes and dice reused it");
	assert.equal(kernelCalls(table, "table.resolve").length, 0);
	assert.deepEqual(admissionRows(table).map((row) => [row.verdict, row.reused]), [
		["not_authorized", false],
		["not_authorized", true],
	]);
});

/**
 * §32.4.2's third list: the rules parameters of the result (and `choice`), which the reviewer does not read and the key does
 * not carry. Kept here, beside the guard that makes every action field be one or the other. (`decision` is read and keyed
 * since §159.5.)
 */
const RESOLVE_NOT_REVIEWED = ["modifiers", "coercion", "surprise", "motive", "mode", "step", "san_loss", "involuntary", "interrupted", "rest",
	"ending", "scenario_san_reward_expr", "choice"];

test("every field of a resolve action is either read by the reviewer (and keyed, unless rationale) or a rules parameter of the result", () => {
	const action = COC_TOOLS.find((tool) => tool.name === "resolve").parameters.properties.action;
	const scope = { party: ["Thomas Hayes"] };
	const base = { actor: "Thomas Hayes", intent: "social", goal: "be let in", method: "talk" };
	const request = (fields) => admissionRequest("resolve", { action: { ...base, ...fields } }, scope);
	const plain = request({});
	assert.ok(plain);
	for (const [field, fieldSchema] of Object.entries(action.properties)) {
		const reviewed = RESOLVE_REVIEWED_FIELDS.includes(field), notReviewed = RESOLVE_NOT_REVIEWED.includes(field);
		assert.ok(reviewed !== notReviewed, `resolve.${field} must be read by the reviewer or named a rules parameter of the result (§32.4.2), and not both`);
		// `choice` takes the call out of review altogether (§32.1); `actor` is the base's own.
		if (field === "choice" || field === "actor") continue;
		const probe = request({ [field]: sample(fieldSchema) });
		assert.ok(probe, `resolve.${field} leaves the call under review`);
		const shownInLine = probe.lines[0].includes(`; ${field}=`) || probe.lines[0].includes(`: ${field}=`);
		if (!reviewed) {
			assert.equal(probe.lines[0], plain.lines[0], `resolve.${field} is not shown to the reviewer`);
			assert.equal(probe.key, plain.key, `resolve.${field} does not change the key`);
			continue;
		}
		assert.ok(shownInLine, `resolve.${field} is shown to the reviewer: ${probe.lines[0]}`);
		if (RESOLVE_RATIONALE_FIELDS.includes(field)) assert.equal(probe.key, plain.key, `resolve.${field} is rationale, outside the key`);
		else assert.notEqual(probe.key, plain.key, `resolve.${field} is read by the reviewer but not keyed (§32.4.2)`);
	}
	// Every name on the two lists is a field the action declares: no stale entries.
	for (const field of [...RESOLVE_REVIEWED_FIELDS, ...RESOLVE_NOT_REVIEWED]) assert.ok(action.properties[field], `resolve.${field} is declared`);
});

test("a resolve without the added fields reads and keys exactly as §159.5 left it", () => {
	const scope = { party: ["Thomas Hayes"] };
	const action = { intent: "investigate", goal: "find the ledger", method: "search the desk", skill: "Spot Hidden", target: "desk", stakes: "time" };
	const proposal = admissionRequest("resolve", { action }, scope);
	assert.equal(proposal.lines[0], 'resolve (settle the specified rule operation): intent="investigate"; goal="find the ledger"; method="search the desk"; skill="Spot Hidden"; target="desk"; stakes="time"');
	assert.equal(proposal.key, '{"action":{"goal":"find the ledger","intent":"investigate","method":"search the desk","skill":"Spot Hidden","target":"desk"},"tool":"resolve"}');
	// outcome is keyed (§159.5, kept by §32.4.2): two ends of a fight are two proposals.
	const end = (outcome) => admissionRequest("resolve", { action: { intent: "combat", goal: "end the fight", method: "run", outcome } }, scope).key;
	assert.notEqual(end("investigators_win"), end("fled"));
});
