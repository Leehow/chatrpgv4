/** The Keeper's opening carries a "?" fold on the delivery card (docs/specs/opening-guidance.md §4): drawn as told, open or not, and absent when the delivery carries none. */
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { createComponent } from "../../pipicoc/mechanics.js";

const root = resolve(import.meta.dirname, "../..");
const MECHANICS_WORDS = JSON.parse(await readFile(join(root, "content/ui/zh-Hans/mechanics.json"), "utf8"));
const ui = { tag: "zh-Hans", words: { mechanics: MECHANICS_WORDS } };
const React = { createElement: (type, props, ...children) => typeof type === "function" ? type({ ...(props || {}), children }) : { type, props: props || {}, children } };
const Card = createComponent(React);
function drawn(node) {
	if (node === null || node === undefined || node === false) return "";
	if (Array.isArray(node)) return node.map(drawn).join("");
	if (typeof node === "object") return [...(node.children ?? []), ...(node.props?.children ? [node.props.children] : [])].map(drawn).join("");
	return String(node);
}
const find = (node, pred) => {
	if (!node || typeof node !== "object") return undefined;
	if (Array.isArray(node)) return node.map(child => find(child, pred)).find(Boolean);
	if (pred(node)) return node;
	return [...(node.children || [])].map(child => find(child, pred)).find(Boolean);
};
const HELP = { moment: "play-opening", title: "从这里开始怎么玩", lines: ["用你自己的话说调查员做什么。", "骰子会以卡片出现。"] };

test("an opening told to open draws the fold under the prose, and one told not to draws only the button", () => {
	const open = Card({ details: { ui, rendered_text: "诺特把钥匙推过来。", help: { ...HELP, open: true } } });
	assert.ok(find(open, node => node.props?.["data-testid"] === "opening-help"), "no fold drawn");
	assert.ok(drawn(open).includes(HELP.lines[0]), "the fold's lines are not drawn when told open");
	const closed = Card({ details: { ui, rendered_text: "诺特把钥匙推过来。", help: HELP } });
	assert.ok(find(closed, node => node.props?.["aria-label"] === HELP.title), "no button drawn");
	assert.ok(!drawn(closed).includes(HELP.lines[0]), "a fold not told to open must stay closed");
});

test("a marked delivery carries the fold too, and a delivery without help draws none", () => {
	const marked = Card({ details: { ui, rendered_text: "他说了一句。", marked_text: "{{say:诺特}}「接不接？」{{/say}}", speech: [{ who: { npc: "steven-knott", name: "诺特" }, text: "「接不接？」" }], help: { ...HELP, open: true } } });
	assert.ok(drawn(marked).includes(HELP.lines[1]));
	const none = Card({ details: { ui, rendered_text: "他说了一句。" } });
	assert.equal(find(none, node => node.props?.["data-testid"] === "opening-help"), undefined);
});
