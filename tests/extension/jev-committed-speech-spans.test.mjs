import { strict as assert } from "node:assert";
import { test } from "node:test";
import { deriveCommittedSpeechSpans } from "../../runtime/jev/committed-speech-spans.ts";

const npc = (npc, name = npc) => ({ npc, name });
const investigator = (id, name) => ({ investigator: id, name });

test("binds mixed narration and adjacent speech to canonical speakers", () => {
	const markedText = "他把门推开。{{say:Knott}}钥匙和钱都还在我这儿。{{/say}}雨声压住了尾音。";
	const renderedText = "他把门推开。钥匙和钱都还在我这儿。雨声压住了尾音。";
	const spoken = "钥匙和钱都还在我这儿。";
	const result = deriveCommittedSpeechSpans({ markedText, renderedText, speech: [{ who: npc("steven-knott", "Steven Knott"), text: spoken }] });
	assert.deepEqual(result, { status: "verified", spans: [{
		start: "他把门推开。".length,
		end: "他把门推开。".length + spoken.length,
		who: npc("steven-knott", "Steven Knott"),
	}] });
	assert.equal(renderedText.slice(result.spans[0].start, result.spans[0].end), spoken);
});

test("mirrors marker removal, horizontal whitespace collapse, JS trim, CRLF, and UTF16 emoji offsets", () => {
	const markedText = "  前言\t\t{{check:spot}}\r\n{{say:阿诺}}😀  你好\r\n第二句{{/say}}\t\t尾声  ";
	const renderedText = "前言 \r\n😀 你好\r\n第二句 尾声";
	const originalSpeech = "😀  你好\r\n第二句";
	const renderedSpeech = "😀 你好\r\n第二句";
	const result = deriveCommittedSpeechSpans({ markedText, renderedText,
		speech: [{ who: investigator("inv-1", "阿诺"), text: originalSpeech }] });
	assert.equal(result.status, "verified");
	const [span] = result.spans;
	assert.equal(span.start, "前言 \r\n".length);
	assert.equal(span.end, span.start + renderedSpeech.length);
	assert.equal(renderedText.slice(span.start, span.end), renderedSpeech);
	assert.equal(renderedText.charCodeAt(span.start) >= 0xd800 && renderedText.charCodeAt(span.start) <= 0xdbff, true);
	assert.equal(renderedText.charCodeAt(span.end - 1) >= 0xdc00 && renderedText.charCodeAt(span.end - 1) <= 0xdfff, false);
});

test("equal spoken lines bind by repaired token occurrence and canonical row order", () => {
	const markedText = "{{say:A}}Same.{{/say}} / {{say:B}}Same.{{/say}}";
	const result = deriveCommittedSpeechSpans({ markedText, renderedText: "Same. / Same.", speech: [
		{ who: { label: "first" }, text: "Same." },
		{ who: { label: "second" }, text: "Same." },
	] });
	assert.deepEqual(result, { status: "verified", spans: [
		{ start: 0, end: 5, who: { label: "first" } },
		{ start: 8, end: 13, who: { label: "second" } },
	] });
});

test("leading and trailing speech whitespace belongs to neither adjacent narration nor the speech span", () => {
	const result = deriveCommittedSpeechSpans({
		markedText: "N{{say:A}}  Same.  {{/say}}X",
		renderedText: "N Same. X",
		speech: [{ who: { label: "A" }, text: "Same." }],
	});
	assert.deepEqual(result, { status: "verified", spans: [{ start: 2, end: 7, who: { label: "A" } }] });
});

test("an empty canonical speech list verifies marker-free narration", () => {
	assert.deepEqual(deriveCommittedSpeechSpans({
		markedText: "  Narration. {{time}}  ", renderedText: "Narration.", speech: [],
	}), { status: "verified", spans: [] });
});

test("malformed, unmatched, reordered, or noncanonical speech fails closed without searching text", () => {
	const cases = [
		{ markedText: "{{say:A}}Same.", renderedText: "Same.", speech: [{ who: { label: "A" }, text: "Same." }], reason: "malformed_say_tokens" },
		{ markedText: "{{/say}}Same.", renderedText: "Same.", speech: [], reason: "speech_count_mismatch" },
		{ markedText: "{{say:A}}{{say:B}}Same.{{/say}}", renderedText: "Same.", speech: [{ who: { label: "B" }, text: "Same." }], reason: "malformed_say_tokens" },
		{ markedText: "{{say:A}}Same.{{/say}}", renderedText: "Same.", speech: [], reason: "speech_count_mismatch" },
		{ markedText: "{{say:A}}Same.{{/say}}", renderedText: "Same.", speech: [{ who: { label: "A" }, text: "Different." }], reason: "speech_text_mismatch" },
		{ markedText: "{{say:A}}Same.{{/say}}", renderedText: "Different.", speech: [{ who: { label: "A" }, text: "Same." }], reason: "rendered_text_mismatch" },
		{ markedText: "{{say: A }}Same.{{/say}}", renderedText: "Same.", speech: [{ who: { label: "A" }, text: "Same." }], reason: "malformed_say_tokens" },
		{ markedText: `{{say:${"A".repeat(61)}}}Same.{{/say}}`, renderedText: "Same.", speech: [{ who: { label: "A" }, text: "Same." }], reason: "malformed_say_tokens" },
	];
	for (const { reason, ...value } of cases)
		assert.deepEqual(deriveCommittedSpeechSpans(value), { status: "unavailable", spans: [], reason });
});

test("rejects malformed input and noncanonical speaker rows", () => {
	const valid = { markedText: "{{say:A}}Same.{{/say}}", renderedText: "Same.", speech: [{ who: { label: "A" }, text: "Same." }] };
	for (const value of [
		{ ...valid, extra: true },
		{ ...valid, markedText: null },
		{ ...valid, speech: { 0: valid.speech[0] } },
		{ ...valid, speech: [{ who: { label: "" }, text: "Same." }] },
		{ ...valid, speech: [{ who: { npc: "n", name: "N", extra: true }, text: "Same." }] },
		{ ...valid, speech: [{ who: npc("n", "N"), text: " Same. " }] },
	]) assert.deepEqual(deriveCommittedSpeechSpans(value), { status: "unavailable", spans: [], reason: "invalid_input" });
});
