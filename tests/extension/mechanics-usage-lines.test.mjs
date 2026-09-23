/**
 * How a held object can be used, drawn under its row on the delivery card (the `coc-card-patch` usage patch).
 *
 * The usage lane patches an `item` row with `usages: {<name>: {name, parameters}}` (written by the usage
 * prefetch; the `publicUsage` view). The card draws one line per use: the use's name, then the fields the
 * possessions box draws for a weapon, in its order, under its `item.<key>` captions -- so the card
 * never shows what the sheet would not. The field table is shared verbatim with `pipicoc/panel.js`,
 * and this file pins that too. Structure and shipped words only; no copy is written here.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createComponent } from "../../pipicoc/mechanics.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const MECHANICS = JSON.parse(readFileSync(join(REPO, "content/ui/en/mechanics.json"), "utf8"));
const SHEET = JSON.parse(readFileSync(join(REPO, "content/ui/en/sheet.json"), "utf8"));
const OPEN = ">>> weapon fields: shared verbatim between pipicoc/panel.js and pipicoc/mechanics.js <<<";
const CLOSE = ">>> end weapon fields <<<";

function region(path) {
	const source = readFileSync(join(REPO, path), "utf8");
	const start = source.indexOf(OPEN), end = source.indexOf(CLOSE, start);
	assert.ok(start >= 0 && end > start, `${path} has no closed weapon-fields region`);
	return source.slice(start, end + CLOSE.length);
}

/** A stand-in React with state, function components run eagerly (as in mechanics-fold.test.mjs). */
function createReact() {
	const states = [];
	let cursor = 0, tree, details;
	const React = {
		useState(init) {
			const i = cursor++;
			if (states.length <= i) states.push(init);
			return [states[i], value => { states[i] = typeof value === "function" ? value(states[i]) : value; refresh(); }];
		},
		createElement(type, props, ...rest) {
			const extra = rest.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false);
			const merged = { ...(props || {}) };
			if (extra.length) merged.children = merged.children === undefined ? extra : [merged.children, ...extra].flat(Infinity);
			return typeof type === "function" ? type(merged) : { type, props: merged };
		},
	};
	const Card = createComponent(React);
	function refresh() { cursor = 0; tree = Card({ details }); }
	return { render(next) { details = next; refresh(); return tree; }, get tree() { return tree; } };
}
const kids = node => { const v = node?.props?.children; return v === undefined || v === null || v === false ? [] : Array.isArray(v) ? v.flat(Infinity) : [v]; };
function collect(node, pred, found = []) {
	if (!node || typeof node !== "object") return found;
	if (pred(node)) found.push(node);
	for (const child of kids(node)) collect(child, pred, found);
	return found;
}
const texts = node => node === null || node === undefined || node === false ? "" : typeof node !== "object" ? String(node)
	: Array.isArray(node) ? node.map(texts).join("") : texts(node.props?.children);
const byClass = (tree, name) => collect(tree, node => String(node.props?.className || "").split(" ").includes(name));
const toggles = tree => collect(tree, node => node.type === "button" && "aria-controls" in node.props);

const details = (mechanics) => ({ ui: { tag: "en", words: { mechanics: MECHANICS, sheet: SHEET } }, play_language: "en",
	rendered_text: "You pick up the chair.", mechanics });
const CHAIR = { kind: "item", receipt: "item:t6-c1", name: "Chair", label: "Chair", quantity: 1, to: "investigator", to_label: "Shen", call: "t6-c1" };
/** Two uses, each with a field the sheet never draws (`mode`, `basis`) beside the ones it does. */
const USES = {
	swing: { name: "Swing", parameters: { skill: "Fighting (Brawl)", damage: "1D6", mode: "melee", basis: "a heavy chair" } },
	throw: { name: "Throw", parameters: { base_range_yards: 5, damage: "1D4", skill: "Throw", adds_damage_bonus: true } },
};

test("the card and the possessions box carry the same weapon-field table, byte for byte", () => {
	const card = region("pipicoc/mechanics.js"), sheet = region("pipicoc/panel.js");
	assert.equal(card, sheet, "pipicoc/mechanics.js and pipicoc/panel.js draw a weapon's fields differently");
	assert.match(card, /function weaponDetails\(item\)/);
});

test("a row with two uses draws two lines, each the use's name and the sheet's fields under the sheet's captions", () => {
	const view = createReact();
	toggles(view.render(details([{ ...CHAIR, usages: USES }])))[0].props.onClick();
	const lines = byClass(view.tree, "coc-mech-usage");
	assert.equal(lines.length, 2);
	const read = line => ({
		name: texts(byClass(line, "coc-mech-usage-name")),
		fields: collect(line, node => node.props?.["data-field"] !== undefined).map(field => [
			field.props["data-field"], texts(byClass(field, "coc-mech-usage-cap")), texts(field).replace(/^ · /, "").replace(texts(byClass(field, "coc-mech-usage-cap")), "").trim()]),
	});
	assert.deepEqual(read(lines[0]), { name: "Swing", fields: [
		["damage", SHEET["item.damage"], "1D6"], ["skill", SHEET["item.skill"], "Fighting (Brawl)"]] },
		"the sheet's order (damage before skill), its captions, and nothing it does not draw (mode, basis)");
	assert.deepEqual(read(lines[1]), { name: "Throw", fields: [
		["damage", SHEET["item.damage"], "1D4"], ["base_range_yards", SHEET["item.base_range_yards"], "5"],
		["skill", SHEET["item.skill"], "Throw"], ["adds_damage_bonus", SHEET["item.adds_damage_bonus"], SHEET.itemYes]] },
		"a yes/no field reads as the sheet reads it");
});

test("a row without uses draws no usage line, and the row itself is unchanged", () => {
	const view = createReact();
	const plain = view.render(details([CHAIR]));
	toggles(plain)[0].props.onClick();
	assert.equal(byClass(view.tree, "coc-mech-usages").length, 0);
	assert.equal(collect(view.tree, node => node.props?.["data-kind"] === "item").length, 1);
});

test("uses patched in while the fold is shut join the row without opening the fold", () => {
	const view = createReact();
	view.render(details([CHAIR]));
	assert.equal(toggles(view.tree)[0].props["aria-expanded"], false);
	// The host's card-patch redraw: the same card, the row now carrying its uses.
	view.render(details([{ ...CHAIR, usages: USES }]));
	const shut = toggles(view.tree)[0];
	assert.equal(shut.props["aria-expanded"], false, "a patch does not open the fold");
	assert.equal(byClass(view.tree, "coc-mech-usage").length, 0, "a shut fold draws nothing inside it");
	assert.match(texts(byClass(shut, "coc-mech-list-count")), /\b1\b/, "the uses are lines of the row, not rows of the fold");
	shut.props.onClick();
	assert.equal(byClass(view.tree, "coc-mech-usage").length, 2);
});
