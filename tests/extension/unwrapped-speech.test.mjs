/**
 * Contract §128.2: which quoted passages a draft leaves outside every say token. The marks are the
 * ones the table's own wrapped lines are written in -- learned, never listed -- and nothing here
 * decides who is speaking or whether a passage is speech.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { learnSpeechMarks, marksOf, unwrappedQuotes } from "../../extensions/kernel/unwrapped-speech.ts";

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
