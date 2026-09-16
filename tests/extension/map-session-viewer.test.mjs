/**
 * Session map viewer (#90): the mechanics card is the current-session entry.
 * Viewer operations stay local — no model call and no campaign write.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createComponent } from "../../pipicoc/mechanics.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const WORDS = { available: "available" };
const PNG = "data:image/png;base64,aaa";
const PNG_B = "data:image/png;base64,bbb";
const PNG_C = "data:image/png;base64,ccc";

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
		render(next) {
			details = next;
			refresh();
			return tree;
		},
		get tree() { return tree; },
	};
}

function childrenOf(node) {
	if (!node || typeof node !== "object") return [];
	const value = node.props?.children;
	if (value === undefined || value === null || value === false) return [];
	return Array.isArray(value) ? value.flat(Infinity) : [value];
}

function walk(node, visit) {
	if (!node || typeof node !== "object") return;
	visit(node);
	for (const child of childrenOf(node)) walk(child, visit);
}

function collect(node, pred) {
	const found = [];
	walk(node, item => { if (pred(item)) found.push(item); });
	return found;
}

function texts(node) {
	const out = [];
	function visit(value) {
		if (value === null || value === undefined || value === false) return;
		if (typeof value === "string" || typeof value === "number") { out.push(String(value)); return; }
		if (Array.isArray(value)) { value.forEach(visit); return; }
		if (typeof value === "object") visit(value.props?.children);
	}
	visit(node);
	return out.join(" ");
}

function delivery(mechanics, words = WORDS) {
	return { details: { mechanics, ui: { words: { mechanics: words } } } };
}

/** Every stamp drawn anywhere in the tree: the claim a card makes about opening (§59). */
function stamps(tree) {
	return collect(tree, node => node.props?.className === "coc-mech-stamp");
}

function mapCards(tree) {
	return collect(tree, node => node.type === "details" && node.props?.["data-kind"] === "map");
}

test("two maps with the same public label keep separate identities in one delivery", () => {
	const { render } = createReact();
	const tree = render(delivery([
		{ kind: "map", map: "house", view_id: "view-house", receipt: "map:house-t1", label: "House", document: "ready", image: PNG, regions: [] },
		{ kind: "map", map: "grounds", view_id: "view-grounds", receipt: "map:grounds-t1", label: "House", document: "ready", image: PNG_B, regions: [] },
	]).details);
	const cards = mapCards(tree);
	assert.equal(cards.length, 2);
	assert.equal(cards[0].props["data-map"], "house");
	assert.equal(cards[1].props["data-map"], "grounds");
	assert.equal(cards[0].props["data-view"], "view-house");
	assert.equal(cards[1].props["data-view"], "view-grounds");
	assert.equal(cards[0].props["data-receipt"], "map:house-t1");
	assert.equal(cards[1].props["data-receipt"], "map:grounds-t1");
	assert.equal(cards[0].props.title, "House");
	assert.equal(cards[1].props.title, "House");
	const images = collect(tree, node => node.type === "img" && node.props?.className === "coc-map-image");
	assert.equal(images[0].props.src, PNG);
	assert.equal(images[1].props.src, PNG_B);
});

test("floor controls list only known levels and never dump the leftover levels array", () => {
	const { render } = createReact();
	const tree = render(delivery([{
		kind: "map", map: "house", view_id: "v1", receipt: "map:house-t1", label: "House",
		document: "ready", image: PNG, levels: ["Ground", "Secret attic", "Roof"],
		regions: [{ id: "entry", label: "Entry", level: "Ground" }],
		level_images: [
			{ level: "Ground", image: PNG },
			{ level: "Secret attic", image: "/tmp/private-attic.png" },
			{ level: "Roof", image: PNG_C },
		],
	}]).details);
	const body = texts(tree);
	assert.equal(body.includes("Secret attic"), false);
	assert.equal(body.includes("/tmp/private-attic.png"), false);
	const buttons = collect(tree, node => node.type === "button");
	assert.deepEqual(buttons.map(node => node.props.title), ["Ground", "Roof"]);
	assert.equal(buttons.some(node => String(node.props.title).includes("Secret")), false);
});

test("tooltips, alt text and thumbnails carry only the public map and known-level names", () => {
	const { render } = createReact();
	const tree = render(delivery([{
		kind: "map", map: "house", view_id: "deadbeefview", receipt: "map:house-t1",
		label: "House", name: "House", document: "ready", image: PNG,
		source_revision: "rev-private", path: "/keeper/source.png",
		regions: [{ id: "entry", label: "Entry" }],
		level_images: [
			{ level: "Ground", image: PNG },
			{ level: "Cellar", image: PNG_B },
		],
	}]).details);
	const card = mapCards(tree)[0];
	assert.equal(card.props.title, "House");
	assert.equal(String(card.props.title).includes("deadbeefview"), false);
	assert.equal(texts(tree).includes("rev-private"), false);
	assert.equal(texts(tree).includes("/keeper/source.png"), false);
	assert.equal(texts(tree).includes("deadbeefview"), false);
	const main = collect(tree, node => node.props?.className === "coc-map-image")[0];
	assert.equal(main.props.alt, "House");
	const thumbs = collect(tree, node => node.props?.className === "coc-map-thumb");
	assert.equal(thumbs.length, 2);
	assert.ok(thumbs.every(node => node.props.alt === "" && node.props["aria-hidden"] === "true"));
	assert.ok(thumbs.every(node => playerSafe(node.props.src)));
});

test("zoom and pan stay on the card: no model, no kernel, no campaign write", () => {
	const source = readFileSync(join(REPO, "pipicoc/mechanics.js"), "utf8");
	const start = source.indexOf("function MapRow(");
	const end = source.indexOf("function renderRow(", start);
	const mapRow = source.slice(start, end);
	assert.equal(/invoke|fetch\(|prompt\(|appendEntry|pi\.|xmlhttp|WebSocket/i.test(mapRow), false);
	assert.match(mapRow, /onPointerDown:\s*panViewport/);
	assert.match(source, /function panViewport\(/);

	const mounted = createReact();
	let tree = mounted.render(delivery([{
		kind: "map", map: "house", view_id: "v1", receipt: "map:house-t1", label: "House",
		document: "ready", image: PNG, regions: [],
	}]).details);
	const slider = collect(tree, node => node.type === "input" && node.props?.type === "range")[0];
	slider.props.onChange({ target: { value: "180" } });
	tree = mounted.tree;
	const image = collect(tree, node => node.props?.className === "coc-map-image")[0];
	assert.equal(image.props.style.width, "180%");

	const viewport = collect(tree, node => node.props?.className === "coc-map-viewport")[0];
	const listeners = new Map();
	const scroller = {
		scrollLeft: 40, scrollTop: 10, dataset: {},
		setPointerCapture() {}, releasePointerCapture() {},
		addEventListener(type, fn) { listeners.set(type, fn); },
		removeEventListener(type) { listeners.delete(type); },
	};
	viewport.props.onPointerDown({
		button: 0, clientX: 20, clientY: 20, pointerId: 7, currentTarget: scroller, preventDefault() {},
	});
	listeners.get("pointermove")({ clientX: 5, clientY: 4 });
	assert.equal(scroller.scrollLeft, 55);
	assert.equal(scroller.scrollTop, 26);
	listeners.get("pointerup")({ pointerId: 7 });
	assert.equal(scroller.dataset.panning, "");
});

/**
 * §59: what a card that will not open says, which is nothing. The three states reaching this row
 * -- `ready` whose pixels this client could not load, a resolved `none`, and an `unresolved` card
 * nobody answered for -- all draw no stamp, because every one of them was still delivered.
 */
test("a map that will not open claims nothing, and reopening retries it", () => {
	const { render } = createReact();
	let tree = render(delivery([{
		kind: "map", map: "house", view_id: "v1", receipt: "map:house-t1", label: "House",
		document: "ready", image: "/tmp/keeper-full.png", regions: [],
	}]).details);
	assert.equal(collect(tree, node => node.props?.className === "coc-map-image").length, 0);
	assert.equal(stamps(tree).length, 0, "a card that did not open does not claim it did");
	assert.equal(texts(tree).includes("/tmp/keeper-full.png"), false);

	const mounted = createReact();
	tree = mounted.render(delivery([{
		kind: "map", map: "house", view_id: "v1", receipt: "map:house-t1", label: "House",
		document: "ready", image: PNG, regions: [],
	}]).details);
	collect(tree, node => node.props?.className === "coc-map-image")[0].props.onError();
	tree = mounted.tree;
	assert.equal(collect(tree, node => node.props?.className === "coc-map-image").length, 0);
	assert.equal(stamps(tree).length, 0);
	mapCards(tree)[0].props.onToggle({ currentTarget: { open: true } });
	assert.equal(stamps(mounted.tree).length, 1, "and the retry that works is stamped again");
	tree = mounted.tree;
	assert.equal(collect(tree, node => node.props?.className === "coc-map-image").length, 1);

	tree = render(delivery([{ kind: "map", map: "house", label: "House", document: "none", image: PNG, regions: [] }]).details);
	assert.equal(collect(tree, node => node.props?.className === "coc-map-image").length, 0);
	assert.equal(mapCards(tree).length, 1, "the current-session entry remains even when the image is missing");
	assert.equal(stamps(tree).length, 0);

	// The third state: a kernel map row the host's rendered attachment never reached -- which is
	// every row the turn record keeps. It must not read as the resolved `none` above.
	tree = render(delivery([{ kind: "map", map: "house", label: "House", document: "unresolved", regions: [] }]).details);
	assert.equal(mapCards(tree).length, 1);
	assert.equal(stamps(tree).length, 0);
});

test("a text handout still folds and an image handout stays a line", () => {
	const { render } = createReact();
	const tree = render(delivery([
		{ kind: "handout", label: "Letter", document: "ready", text: "Meet at dusk." },
		{ kind: "handout", label: "Photo", document: "ready" },
		{ kind: "map", map: "house", label: "House", document: "none", regions: [] },
	]).details);
	const folds = collect(tree, node => node.props?.className === "coc-mech-row coc-mech-fold");
	assert.equal(folds.length, 1);
	assert.match(texts(folds[0]), /Meet at dusk/);
	assert.equal(collect(tree, node => node.props?.["data-kind"] === "handout").length, 2);
	assert.equal(mapCards(tree).length, 1);
});

/**
 * §59 at the last hop. The handout the real table was denied (`game-1c0faba5` turn 62) is authored
 * `player-safe`, was won on a hard Library Use, and had its contents read out in the prose directly
 * above this card -- which then stamped "not delivered" over it. A card claims the player can open
 * something only when they can; it never contradicts the delivery it sits under.
 */
test("a handout the module registered with no document is not stamped as undelivered", () => {
	const { render } = createReact();
	const tree = render(delivery([
		{ kind: "handout", receipt: "handout:obituary-t62", name: "Handout 5: Corbitt's Obituary and Burial Lawsuit",
			label: "\u8ba3\u544a\u4e0e\u4e0b\u846c\u8bc9\u8bbc", document: "none" },
	]).details);
	const rows = collect(tree, node => node.props?.["data-kind"] === "handout");
	assert.equal(rows.length, 1, "the delivery still draws its card");
	const drawn = texts(tree);
	assert.match(drawn, /\u8ba3\u544a\u4e0e\u4e0b\u846c\u8bc9\u8bbc/, "the player still reads what they were handed");
	assert.equal(stamps(tree).length, 0, "no stamp: the card has nothing true to say about opening it");
	assert.equal(drawn.includes("available"), false);
});

function playerSafe(value) {
	return typeof value === "string" && /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(value);
}
