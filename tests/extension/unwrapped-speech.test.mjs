/**
 * Contract §128.2: which quoted passages a draft leaves outside every say token. The marks are the
 * ones the table's own wrapped lines are written in -- learned, never listed -- and nothing here
 * decides who is speaking or whether a passage is speech.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { learnSpeechMarks, marksOf, surroundingSentences, unwrappedPassages, unwrappedQuotes, wrapPassages, wrappedOrdinals } from "../../extensions/kernel/unwrapped-speech.ts";

test("the real turn: the investigator's line was wrapped, Knott's two replies were not", () => {
	// game-21ac44b7-5f91-41a5-8ea7-9faf5b801a29 turn 1, abridged; the quoted word 「接」 is reported
	// too, which is why the steer leaves the call to the Keeper.
	const draft = "你先把话接住。{{say:沈默}}「接。不过先说清楚——这房子到底出过什么事？」{{/say}}\n\n" +
		"史蒂文·诺特听完「接」字，点了下头。{{clue:knott-commission}}\n\n" +
		"他的手指停住。「马卡里奥一家。连夜搬走。」{{clue:knott-macario-summary}}他摸出钥匙。「钥匙、地址、今天的预付。」";
	assert.deepEqual(unwrappedQuotes(draft), ["「接」", "「马卡里奥一家。连夜搬走。」", "「钥匙、地址、今天的预付。」"]);
});

test("a draft whose lines carry no marks teaches nothing and reports nothing", () => {
	assert.deepEqual(unwrappedQuotes("诺特点了两下。{{say:诺特}}先去报社。{{/say}}他摘下帽子「旧帽子」。"), []);
	assert.deepEqual(unwrappedQuotes("没有记号。「这句话」"), []);
});

test("pairs learned from earlier deliveries are read against a draft that teaches none", () => {
	const marks = new Set();
	learnSpeechMarks(marks, [{ who: { label: "x" }, text: "「钥匙在这儿。」" }, { who: { label: "y" }, text: "没有引号" }]);
	assert.equal(marks.size, 1);
	assert.deepEqual(unwrappedQuotes("{{say:诺特}}先去报社。{{/say}}「别急着进门。」", marks), ["「别急着进门。」"]);
});

test("the marks are whatever the table writes speech with: straight, curly, guillemets", () => {
	assert.deepEqual(unwrappedQuotes('{{say:Ann}}"Hi."{{/say}} Then "Go away," said Bob. Don\'t.'), ['"Go away,"']);
	assert.deepEqual(unwrappedQuotes("{{say:Ann}}“Hi.”{{/say}} Bob: “No.”"), ["“No.”"]);
	assert.deepEqual(unwrappedQuotes("{{say:Ann}}«Oui.»{{/say}} Il dit «Non, jamais.»"), ["«Non, jamais.»"]);
	// Punctuation that is not a quotation mark never becomes a pair, however a span starts and ends.
	assert.equal(marksOf("¡Hola!"), undefined);
	assert.equal(marksOf("— Bonjour."), undefined);
});

test("nested marks are one passage, an unclosed mark is none, markers are not text", () => {
	assert.deepEqual(unwrappedQuotes("{{say:甲}}「甲『乙』丙」{{/say}}他说「好『啊』吧」。"), ["「好『啊』吧」"]);
	assert.deepEqual(unwrappedQuotes("{{say:甲}}「是。」{{/say}}\n\n他说「没说完\n\n下一段。"), []);
	assert.deepEqual(unwrappedQuotes("{{say:甲}}「是。」{{/say}}他说「好{{check:x}}的」。"), ["「好的」"]);
	assert.deepEqual(unwrappedQuotes("{{say:甲}}「是。」{{/say}}他说「」。"), [], "empty marks hold no words");
});

test("a long passage is quoted back as an excerpt", () => {
	const long = "「" + "很".repeat(80) + "」";
	const [excerpt] = unwrappedQuotes(`{{say:甲}}「是。」{{/say}}${long}`);
	assert.equal([...excerpt].length, 40);
	assert.ok(excerpt.endsWith("…"));
});

test("§128.3: passages carry their place in the repaired draft, and wrapping them changes no word", () => {
	const draft = "{{say:甲}}「是。」{{/say}}\n\n他看了看表。「坐吧。」{{check:x}}他说「好{{check:y}}的」。";
	const { text, passages } = unwrappedPassages(draft);
	assert.equal(text, draft, "an already well-formed draft is its own repair");
	assert.deepEqual(passages.map(({ start, end }) => text.slice(start, end)), ["「坐吧。」", "「好{{check:y}}的」"]);
	assert.deepEqual(passages.map((row) => row.text), ["「坐吧。」", "「好{{check:y}}的」"], "the passage as written, marker and all");
	const wrapped = wrapPassages(text, passages.map((row) => ({ ...row, name: "乙" })));
	assert.equal(wrapped, "{{say:甲}}「是。」{{/say}}\n\n他看了看表。{{say:乙}}「坐吧。」{{/say}}{{check:x}}他说{{say:乙}}「好{{check:y}}的」{{/say}}。");
	assert.deepEqual(unwrappedPassages(wrapped).passages, [], "nothing is left outside once wrapped");
	// A name the token cannot carry is skipped, never written.
	assert.equal(wrapPassages(text, [{ ...passages[0], name: "a}}b" }]), text);
	// A span left open is closed where the kernel closes it, and offsets are into that repair.
	const open = unwrappedPassages("{{say:甲}}「是。」\n\n他说「不」。");
	assert.equal(open.text, "{{say:甲}}「是。」{{/say}}\n\n他说「不」。");
	assert.deepEqual(open.passages.map(({ start, end }) => open.text.slice(start, end)), ["「不」"]);
});

test("§128.3: the sentences around a passage, tokens stripped, the last two before and the first two after", () => {
	const text = "第一句。第二句。{{handout:h}}第三句。「你好。」{{say:甲}}「嗯。」{{/say}}他走了。又一句。";
	const start = text.indexOf("「你好。」");
	const around = surroundingSentences(text, { start, end: start + "「你好。」".length });
	assert.equal(around.before, "第二句。第三句。");
	assert.equal(around.after, "「嗯。」他走了。");
});

test("§128.3: a wrap's ordinal is its row in the kernel's speech[], counting the Keeper's spans before it", () => {
	const draft = "「甲」他说。{{say:甲}}「是。」{{/say}}\n\n「乙」{{say:乙}}「嗯。」{{/say}}「丙」";
	const { text, passages } = unwrappedPassages(draft);
	assert.deepEqual(passages.map((row) => row.text), ["「甲」", "「乙」", "「丙」"]);
	const wraps = passages.map((row) => ({ ...row, name: "丁" }));
	// Rows in text order: 甲-wrap 0, Keeper 1, 乙-wrap 2, Keeper 3, 丙-wrap 4.
	assert.deepEqual(wrappedOrdinals(text, wraps), [0, 2, 4]);
	assert.deepEqual(wrappedOrdinals(text, [{ ...wraps[1], name: "a}}b" }]), [], "a wrap that is never written has no row");
});
