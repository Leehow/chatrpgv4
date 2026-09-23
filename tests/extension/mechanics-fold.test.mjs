/**
 * The delivery card's trailing mechanics rows fold, one fold per kind of thing (owner at the live
 * table, 2026-09-22: not "this turn's mechanics" but what the rows are, e.g. items gained).
 *
 * Only the rows the Keeper did not place fold: a row placed at its sentence (`coc-mech-here`) stays
 * where the sentence is. Each fold's caption is a real button with `aria-expanded`/`aria-controls`,
 * names what its rows are (the settlement family's word, or the kind's fold word) and how many, and
 * carries the §129 waiting mark while one of its rows is still preparing its details. Captions are
 * compared with the shipped source word for the key, never with copy written here.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createComponent } from "../../pipicoc/mechanics.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const WORDS = JSON.parse(readFileSync(join(REPO, "content/ui/en/mechanics.json"), "utf8"));

/** A React stand-in with state: function components run eagerly, `useState` keeps slots by call order. */
function createReact() {
	const states = [];
	let cursor = 0;
	let tree;
	let details;
	const React = {
		useState(init) {
			const i = cursor++;
			if (states.length <= i) states.push(init);
			return [states[i], value => {
				states[i] = typeof value === "function" ? value(states[i]) : value;
				refresh();
			}];
		},
		createElement(type, props, ...rest) {
			const extra = rest.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false);
			const merged = { ...(props || {}) };
			if (extra.length) {
				const existing = merged.children;
				merged.children = existing === undefined ? extra : [existing, ...extra].flat(Infinity);
			}
			if (typeof type === "function") return type(merged);
			return { type, props: merged };
		},
	};
	const Card = createComponent(React);
	function refresh() {
		cursor = 0;
		tree = Card({ details });
	}
	return {
		render(next) { details = next; refresh(); return tree; },
		get tree() { return tree; },
	};
}

function childrenOf(node) {
	if (!node || typeof node !== "object") return [];
	const value = node.props?.children;
	if (value === undefined || value === null || value === false) return [];
	return Array.isArray(value) ? value.flat(Infinity) : [value];
}
function collect(node, pred, found = []) {
	if (!node || typeof node !== "object") return found;
	if (pred(node)) found.push(node);
	for (const child of childrenOf(node)) collect(child, pred, found);
	return found;
}
function texts(node) {
	if (node === null || node === undefined || node === false) return "";
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(texts).join("");
	return texts(node.props?.children);
}
const byClass = (tree, name) => collect(tree, node => String(node.props?.className || "").split(" ").includes(name));
/** Every fold toggle on the card: a button that controls a body, in drawing order. */
const togglesOf = tree => collect(tree, node => node.type === "button" && "aria-expanded" in node.props && "aria-controls" in node.props);
const toggleOf = tree => {
	const found = togglesOf(tree);
	assert.equal(found.length, 1, "exactly one fold toggle");
	return found[0];
};
const bodyOf = (tree, toggle) => {
	const found = collect(tree, node => node.props?.id === toggle.props["aria-controls"]);
	assert.equal(found.length, 1, "aria-controls names the fold's body");
	return found[0];
};
const rowsIn = node => collect(node, item => node !== item && item.props?.["data-kind"] !== undefined && String(item.props?.className || "").includes("coc-mech-row"));
const waitingMarks = node => collect(node, item => item.props?.role === "status");
/** What a fold's header says it holds, and how many: the caption word and the drawn count. */
const headerOf = toggle => ({
	caption: texts(byClass(toggle, "coc-mech-list-name")),
	count: Number(texts(byClass(toggle, "coc-mech-list-count")).replace(/\D+/g, "")),
});

const ROLL = { kind: "roll", receipt: "roll:spot-t4-c1", marker: "check:spot-hidden", skill: "Spot Hidden", roll: 16, target: 60,
	threshold: 60, difficulty: "regular", level: "hard", passed: true, pushed: false, visibility: "public",
	actor_is_investigator: true, actor: "investigator", actor_label: "Shen", call: "t4-c1", family: "skill" };
/** Adoptions carry no marker (§129), so they are the rows that land in the trailing slip. */
const PENDING = { kind: "item", receipt: "definition:queued-adopt-t4-c2", name: "Old camera", adopted: "Old camera",
	definition: "pending", definition_name: "Old camera", call: "t4-c2" };
const NOTEBOOK = { kind: "item", receipt: "definition:adopt-t4-c3", name: "Notebook", adopted: "Notebook", call: "t4-c3" };

const marked = (mechanics) => ({ ui: { tag: "en", words: { mechanics: WORDS } }, play_language: "en",
	rendered_text: "You look at the door. It opens.", marked_text: "You look at the door. {{check:spot-hidden}} It opens.", mechanics });
const plain = (mechanics) => ({ ui: { tag: "en", words: { mechanics: WORDS } }, play_language: "en",
	rendered_text: "The fight goes on.", mechanics });

const LOST = { kind: "item", receipt: "item:t4-c4", name: "Pen", quantity: -1, to: "investigator", to_label: "Shen", call: "t4-c4" };
const CLUE = { kind: "clue", receipt: "clue:shelf-t4", clue: "shelf-scratches", label: "Scratches", call: "t4-c5" };

test("a marked delivery folds only its unplaced rows, under what they are, shut until the toggle", () => {
	const view = createReact();
	let tree = view.render(marked([ROLL, NOTEBOOK, PENDING]));
	const toggle = toggleOf(tree);
	assert.equal(toggle.props.type, "button");
	assert.equal(toggle.props["aria-expanded"], false, "the fold starts shut");
	const body = bodyOf(tree, toggle);
	assert.equal(body.props.hidden, true, "a shut body is hidden");
	assert.equal(rowsIn(body).length, 0, "a shut body draws no row");
	// The placed roll is still where its sentence is.
	const here = byClass(tree, "coc-mech-here");
	assert.equal(here.length, 1);
	assert.equal(collect(here[0], node => node.props?.["data-kind"] === "roll").length, 1);
	// The header says what the rows are -- belongings that arrived -- and how many, and that one of
	// them is still preparing. It is not a generic "mechanics" slip.
	assert.deepEqual(headerOf(toggle), { caption: WORDS["fold.itemsGained"], count: 2 });
	assert.equal(WORDS.mechanics, undefined, "the generic slip caption is gone from the source");
	assert.equal(waitingMarks(toggle).length, 1, "a pending row puts the waiting mark on the shut header");
	assert.equal(byClass(toggle, "coc-mech-wait").length, 1, "the header mark is the row's own waiting mark");

	toggle.props.onClick();
	tree = view.tree;
	const opened = toggleOf(tree);
	assert.equal(opened.props["aria-expanded"], true);
	const openBody = bodyOf(tree, opened);
	assert.notEqual(openBody.props.hidden, true);
	assert.deepEqual(rowsIn(openBody).map(row => row.props["data-kind"]), ["item", "item"]);
	assert.equal(waitingMarks(opened).length, 0, "open, the pending row carries its own mark");
	assert.equal(waitingMarks(openBody).length, 1);

	opened.props.onClick();
	assert.equal(toggleOf(view.tree).props["aria-expanded"], false, "the toggle shuts it again");
});

test("rows of several kinds get one fold each, each with its own header and count, and no generic header", () => {
	const view = createReact();
	let tree = view.render(marked([ROLL, NOTEBOOK, CLUE, PENDING, LOST]));
	const toggles = togglesOf(tree);
	assert.deepEqual(toggles.map(headerOf), [
		{ caption: WORDS["fold.items"], count: 3 },
		{ caption: WORDS["fold.clue"], count: 1 },
	], "belongings (one of them lost, so not all gained) and clues, in the order their first rows came");
	assert.ok(toggles.every(toggle => toggle.props["aria-expanded"] === false), "every fold starts shut");
	assert.deepEqual(toggles.map(toggle => waitingMarks(toggle).length), [1, 0], "the waiting mark rides only on the fold that holds the pending row");
	const ids = toggles.map(toggle => toggle.props["aria-controls"]);
	assert.equal(new Set(ids).size, ids.length, "each fold controls its own body");

	// Opening one fold opens only that one.
	toggles[1].props.onClick();
	tree = view.tree;
	const [items, clues] = togglesOf(tree);
	assert.equal(items.props["aria-expanded"], false);
	assert.equal(clues.props["aria-expanded"], true);
	assert.deepEqual(rowsIn(bodyOf(tree, clues)).map(row => row.props["data-kind"]), ["clue"]);
	assert.equal(rowsIn(bodyOf(tree, items)).length, 0);
});

test("a plain delivery folds by settlement family, keeping each family's group inside its fold", () => {
	const A = { ...ROLL, marker: undefined, receipt: "roll:brawl-t5-c1", skill: "Fighting (Brawl)", call: "t5-c1", family: "combat" };
	const B = { ...A, receipt: "roll:dodge-t5-c1", skill: "Dodge", actor_is_investigator: false, actor: "cultist", actor_label: "Cultist" };
	const view = createReact();
	let tree = view.render(plain([A, B, NOTEBOOK]));
	const toggles = togglesOf(tree);
	assert.deepEqual(toggles.map(headerOf), [
		{ caption: WORDS["family.combat"], count: 2 },
		{ caption: WORDS["fold.itemsGained"], count: 1 },
	]);
	assert.ok(toggles.every(toggle => toggle.props["aria-expanded"] === false));
	assert.equal(byClass(tree, "coc-mech-settle").length, 0, "no group is drawn while shut");
	assert.ok(toggles.every(toggle => waitingMarks(toggle).length === 0), "nothing is preparing, so no header carries a mark");

	toggles[0].props.onClick();
	tree = view.tree;
	const combat = togglesOf(tree)[0];
	assert.equal(combat.props["aria-expanded"], true);
	const body = bodyOf(tree, combat);
	assert.equal(byClass(body, "coc-mech-settle").length, 1, "the settlement group is drawn inside its family's fold");
	assert.equal(rowsIn(body).length, 2);
});

test("a delivery with every row placed draws no fold at all", () => {
	const tree = createReact().render(marked([ROLL]));
	assert.equal(togglesOf(tree).length, 0);
	assert.equal(byClass(tree, "coc-mech-list").length, 0);
});
