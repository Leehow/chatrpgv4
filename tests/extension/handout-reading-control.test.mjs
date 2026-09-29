/**
 * A pictured handout's translate control, in both renderers (contract §155, VT-04).
 *
 * The delivery card (`pipicoc/mechanics.js`) and the case board (`pipicoc/board.js`) draw the same
 * control under an image handout's picture. The host side (`handout.reading`) is stubbed here: this
 * file pins what the renderers do with its answers -- which rows get a control, what they send,
 * the pending / ready / refused / already-in-your-language states, the original/reading toggle,
 * and that polling waits, stops when the row closes and dies with the control. That the host UI
 * really hands the card its call is pinned in `Electron/packages/ui/src/coc-handout-reading.test.tsx`,
 * which renders the transcript and the App.
 *
 * The renderers take React by injection. The stand-in below is a small reconciler rather than an
 * element factory: it keeps hook state per component instance (by position and key), runs effects
 * after a render and their cleanups on change or unmount, and resolves context -- the three things
 * a polling control's correctness depends on.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createComponent as createCard } from "../../pipicoc/mechanics.js";
import { createComponent as createBoard } from "../../pipicoc/board.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (path) => readFileSync(join(REPO, path), "utf8");
const surface = (tag, name) => JSON.parse(read(`content/ui/${tag}/${name}.json`));

/** The shipped words, as the host attaches them to every answer (§23). */
const UI = { tag: "en", words: {
	handout: surface("en", "handout"), errors: surface("en", "errors"),
	mechanics: surface("en", "mechanics"), board: surface("en", "board"), sheet: surface("en", "sheet"),
} };
const say = (name, key) => UI.words[name][key];

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const POLL = 2000;

// ---------------------------------------------------------------------------------------------
// A small reconciler: enough React for hooks-by-instance, effects, context and unmount.
// ---------------------------------------------------------------------------------------------

const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, k) => Object.is(v, b[k]));

function reconciler() {
	const instances = new Map();
	const contexts = new Map();
	let current = null, cursor = 0, effects = [], dirty = false;
	const cell = () => {
		const index = cursor++;
		return { hooks: current.hooks, index };
	};
	const React = {
		createElement(type, props, ...children) {
			const { key, ...rest } = props || {};
			const flat = children.flat(Infinity);
			if (flat.length) rest.children = flat.length === 1 ? flat[0] : flat;
			return { $el: true, type, key: key ?? null, props: rest };
		},
		createContext(fallback) {
			const context = { fallback };
			context.Provider = { $provider: context };
			return context;
		},
		useContext(context) {
			const stack = contexts.get(context);
			return stack && stack.length ? stack[stack.length - 1] : context.fallback;
		},
		useState(initial) {
			const { hooks, index } = cell();
			if (!(index in hooks)) hooks[index] = { value: typeof initial === "function" ? initial() : initial };
			const slot = hooks[index];
			return [slot.value, (next) => {
				const value = typeof next === "function" ? next(slot.value) : next;
				if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; }
			}];
		},
		useRef(initial) {
			const { hooks, index } = cell();
			return (hooks[index] ??= { current: initial });
		},
		useCallback(fn, deps) {
			const { hooks, index } = cell();
			if (hooks[index] && same(hooks[index].deps, deps)) return hooks[index].fn;
			hooks[index] = { fn, deps };
			return fn;
		},
		useMemo(fn, deps) {
			const { hooks, index } = cell();
			if (hooks[index] && same(hooks[index].deps, deps)) return hooks[index].value;
			hooks[index] = { value: fn(), deps };
			return hooks[index].value;
		},
		useId() {
			const { hooks, index } = cell();
			return (hooks[index] ??= { id: `id-${Math.random().toString(36).slice(2)}` }).id;
		},
		useEffect(fn, deps) {
			const { hooks, index } = cell();
			const prior = hooks[index];
			if (prior && deps && same(prior.deps, deps)) return;
			const slot = hooks[index] = { deps, cleanup: prior?.cleanup, effect: true };
			effects.push(() => {
				slot.cleanup?.();
				const cleanup = fn();
				slot.cleanup = typeof cleanup === "function" ? cleanup : undefined;
			});
		},
		useLayoutEffect(fn, deps) { return React.useEffect(fn, deps); },
	};

	let seen = new Set();
	function expand(node, path) {
		if (node === null || node === undefined || node === false || node === true) return null;
		if (Array.isArray(node)) return node.map((child, index) => expand(child, `${path}[${child?.key ?? index}]`));
		if (!node || typeof node !== "object" || !node.$el) return node;
		if (node.type && node.type.$provider) {
			const context = node.type.$provider;
			const stack = contexts.get(context) ?? contexts.set(context, []).get(context);
			stack.push(node.props.value);
			try { return expand(node.props.children, `${path}>provider`); } finally { stack.pop(); }
		}
		if (typeof node.type === "function") {
			const id = `${path}>${node.type.name || "anon"}#${node.key ?? ""}`;
			let instance = instances.get(id);
			if (!instance || instance.type !== node.type) { instance = { type: node.type, hooks: [] }; instances.set(id, instance); }
			seen.add(id);
			const prior = [current, cursor];
			current = instance; cursor = 0;
			let out;
			try { out = node.type(node.props); } finally { [current, cursor] = prior; }
			return expand(out, id);
		}
		const { children, ...props } = node.props;
		return { type: node.type, props, children: [expand(children, `${path}>${node.type}`)].flat(Infinity).filter((c) => c !== null && c !== undefined) };
	}

	let root = null, tree = null;
	function render() {
		dirty = false; effects = []; seen = new Set();
		tree = root ? expand(root, "") : null;
		for (const [id, instance] of instances) {
			if (seen.has(id)) continue;
			for (const slot of instance.hooks) if (slot?.effect) slot.cleanup?.();
			instances.delete(id);
		}
		for (const effect of effects) effect();
	}
	return {
		React,
		mount(element) { root = element; render(); },
		unmount() { root = null; render(); },
		get tree() { return tree; },
		get live() { return instances.size; },
		/** Let promises resolve and state changes render, the way React would. */
		async settle() {
			for (let pass = 0; pass < 30; pass += 1) {
				await new Promise((done) => setImmediate(done));
				if (dirty) render();
			}
		},
	};
}

function nodes(tree, predicate) {
	if (!tree || typeof tree !== "object") return [];
	if (Array.isArray(tree)) return tree.flatMap((child) => nodes(child, predicate));
	return [...(predicate(tree) ? [tree] : []), ...(tree.children ?? []).flatMap((child) => nodes(child, predicate))];
}
const textOf = (node) => (Array.isArray(node) ? node.map(textOf).join("")
	: node && typeof node === "object" ? (node.children ?? []).map(textOf).join("") : node == null ? "" : String(node));
const controls = (tree) => nodes(tree, (node) => node.props?.className === "coc-handout-reading");
const buttonsIn = (tree) => nodes(tree, (node) => node.type === "button");
const buttonNamed = (tree, name) => buttonsIn(tree).find((node) => textOf(node) === name);
const pictures = (tree) => nodes(tree, (node) => node.type === "img" && node.props.className === "coc-map-image");
const readingBody = (tree) => nodes(tree, (node) => node.props?.["data-reading"] === "reading");
const withRole = (tree, role) => nodes(tree, (node) => node.props?.role === role);

/** The delivery card's trailing folds start shut; open them the way the player does. */
function openFolds(view) {
	for (const toggle of nodes(view.tree, (node) => node.type === "button" && node.props["aria-controls"] && node.props["aria-expanded"] === false))
		toggle.props.onClick();
}

/** A host whose every `handout.reading` answer is scripted, and every call is recorded. */
function host(script) {
	const calls = [];
	const answers = [...script];
	return {
		calls,
		invoke(method, params) {
			calls.push({ method, params });
			const next = answers.length > 1 ? answers.shift() : answers[0];
			return typeof next === "function" ? next() : Promise.resolve(next);
		},
	};
}
const refusal = (code, message = "refused") => () => Promise.reject(Object.assign(new Error(message), { code }));
const PENDING = { status: "pending", handout: "clipping" };
const READY = { status: "ready", handout: "clipping", keep: false, title: "Grave robbers strike Martin's Beach again", text: "Line one.\n\nLine two.", digest: "abc" };

// ---------------------------------------------------------------------------------------------
// The two surfaces, behind one driver each.
// ---------------------------------------------------------------------------------------------

const IMAGE_HANDOUT = { kind: "handout", handout: "clipping", name: "Clipping", label: "Clipping", receipt: "handout:clipping-t4", document: "ready", image: PNG };

/** The delivery card with the given rows and the host's call (or none). */
function card(rows, invoke) {
	const view = reconciler();
	const Card = createCard(view.React);
	const details = { ui: UI, mechanics: rows };
	const props = invoke ? { details, onInvoke: invoke } : { details };
	view.mount(view.React.createElement(Card, props));
	openFolds(view);
	// A host redraw hands the card a fresh function every time, as the loader's binding does.
	view.drawAgain = () => view.mount(view.React.createElement(Card, invoke ? { details, onInvoke: (method, params) => invoke(method, params) } : { details }));
	return view;
}

/** The case board holding the given documents and maps, reading the host's envelopes. */
function board(handouts, maps, reading) {
	const view = reconciler();
	const Board = createBoard(view.React);
	const calls = [];
	const answer = { status: "ready", campaign: "c1", ui: UI, maps, view: { clues: {}, npcs: {}, labels: {}, handouts } };
	const api = {
		invoke(method, params) {
			calls.push({ method, params });
			if (method === "board") return Promise.resolve({ ok: true, data: answer });
			return reading.invoke(method, params).then(
				(data) => ({ ok: true, data }),
				(error) => ({ ok: false, error: { code: error.code, message: error.message } }));
		},
	};
	view.mount(view.React.createElement(Board, { api }));
	view.calls = calls;
	return view;
}

const readingCalls = (calls) => calls.filter((call) => call.method === "handout.reading");

// ---------------------------------------------------------------------------------------------
// Which rows get a control.
// ---------------------------------------------------------------------------------------------

test("card: only an image handout row that names its handle gets the control", async () => {
	const reading = host([READY]);
	const view = card([
		IMAGE_HANDOUT,
		{ kind: "handout", handout: "letter", label: "Letter", document: "ready", text: "Meet at dusk." },
		{ kind: "handout", name: "Photo", label: "Photo", receipt: "handout:photo-t4", document: "ready", image: PNG },
		{ kind: "map", map: "house", label: "House", document: "ready", image: PNG, regions: [] },
	], reading.invoke);
	await view.settle();
	const drawn = controls(view.tree);
	assert.equal(drawn.length, 1, "one control: the text handout, the handle-less image and the map get none");
	assert.equal(pictures(view.tree).length, 3, "every picture is still drawn");
	assert.equal(textOf(buttonsIn(drawn[0])[0]), say("handout", "translate"));
	assert.equal(reading.calls.length, 0, "drawing the row asks the host nothing; only the player's press does");
});

test("card: without a host call the image handout row draws exactly as before", async () => {
	const view = card([IMAGE_HANDOUT]);
	await view.settle();
	assert.equal(controls(view.tree).length, 0);
	assert.equal(pictures(view.tree).length, 1);
});

test("board: only a pictured document gets the control; text documents and maps get none", async () => {
	const reading = host([READY]);
	const view = board([
		{ handout: "clipping", name: "Clipping", text: "", document: "ready", image: PNG },
		{ handout: "letter", name: "Letter", text: "Meet at dusk." },
	], [{ map: "house", label: "House", document: "ready", image: PNG, regions: [] }], reading);
	await view.settle();
	const drawn = controls(view.tree);
	assert.equal(drawn.length, 1);
	assert.equal(pictures(view.tree).length, 2, "the map and the clipping are both drawn");
	assert.equal(readingCalls(view.calls).length, 0, "the board read asks for no reading on its own");
});

// ---------------------------------------------------------------------------------------------
// Press, pending, ready, toggle -- on both surfaces.
// ---------------------------------------------------------------------------------------------

const SURFACES = [
	{ name: "card", open: (reading) => card([IMAGE_HANDOUT], reading.invoke), calls: (view, reading) => reading.calls },
	{ name: "board", open: (reading) => board([{ handout: "clipping", name: "Clipping", text: "", document: "ready", image: PNG }], [], reading),
		calls: (view) => readingCalls(view.calls) },
];

for (const surface_ of SURFACES) {
	test(`${surface_.name}: press sends only {handout}, waits while pending, then shows the reading under the picture`, async (t) => {
		t.mock.timers.enable({ apis: ["setTimeout"] });
		const reading = host([PENDING, READY]);
		const view = surface_.open(reading);
		await view.settle();
		buttonNamed(view.tree, say("handout", "translate")).props.onClick();
		await view.settle();

		const sent = surface_.calls(view, reading);
		assert.equal(sent.length, 1);
		assert.equal(sent[0].method, "handout.reading");
		assert.deepEqual(sent[0].params, { handout: "clipping" }, "no path, campaign, digest or language leaves the renderer");
		const status = withRole(controls(view.tree)[0], "status");
		assert.equal(status.length, 1);
		assert.equal(textOf(status[0]), say("handout", "pending"));
		assert.equal(buttonNamed(view.tree, say("handout", "translate")), undefined, "no second press while it runs");

		t.mock.timers.tick(POLL - 1);
		await view.settle();
		assert.equal(surface_.calls(view, reading).length, 1, "a pending answer is not asked again before the poll interval");
		t.mock.timers.tick(1);
		await view.settle();
		assert.equal(surface_.calls(view, reading).length, 2, "and is asked again once it has passed");

		const body = readingBody(view.tree);
		assert.equal(body.length, 1, "the reading version is drawn");
		assert.match(textOf(body[0]), /Grave robbers strike Martin's Beach again/);
		assert.match(textOf(body[0]), /Line one\.\n\nLine two\./, "its text as it came, line breaks and all");
		assert.match(textOf(body[0]), new RegExp(say("handout", "note").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "labelled as a reading, not the original");
		assert.equal(pictures(view.tree).length, 1, "the picture is still there");
		const original = buttonNamed(view.tree, say("handout", "original"));
		const readingToggle = buttonNamed(view.tree, say("handout", "reading"));
		assert.equal(readingToggle.props["aria-pressed"], true);
		assert.equal(original.props["aria-pressed"], false);

		original.props.onClick();
		await view.settle();
		assert.equal(readingBody(view.tree).length, 0, "original shows the picture alone");
		assert.equal(pictures(view.tree).length, 1);
		assert.equal(buttonNamed(view.tree, say("handout", "original")).props["aria-pressed"], true);
		buttonNamed(view.tree, say("handout", "reading")).props.onClick();
		await view.settle();
		assert.equal(readingBody(view.tree).length, 1, "and the reading comes back without another call");
		assert.equal(surface_.calls(view, reading).length, 2);

		t.mock.timers.tick(POLL * 5);
		await view.settle();
		assert.equal(surface_.calls(view, reading).length, 2, "a ready answer ends the polling");
	});

	test(`${surface_.name}: a refusal is captioned by its code and the retry asks again`, async () => {
		const reading = host([refusal("model_without_images", "the table model reads no images"), READY]);
		const view = surface_.open(reading);
		await view.settle();
		buttonNamed(view.tree, say("handout", "translate")).props.onClick();
		await view.settle();
		const alert = withRole(controls(view.tree)[0], "alert");
		assert.equal(alert.length, 1);
		assert.equal(textOf(alert[0]), say("errors", "model_without_images"), "the code's own caption, not the host's English sentence");
		assert.match(textOf(controls(view.tree)[0]), /the table model reads no images/, "the reason stays, folded, for a bug report");
		assert.equal(readingBody(view.tree).length, 0);

		buttonNamed(view.tree, say("handout", "retry")).props.onClick();
		await view.settle();
		assert.equal(surface_.calls(view, reading).length, 2, "the retry is the same call again");
		assert.deepEqual(surface_.calls(view, reading)[1].params, { handout: "clipping" });
		assert.equal(readingBody(view.tree).length, 1);
	});

	test(`${surface_.name}: a refusal whose code has no caption falls back to the control's own failure word`, async () => {
		const reading = host([refusal("some_future_code")]);
		const view = surface_.open(reading);
		await view.settle();
		buttonNamed(view.tree, say("handout", "translate")).props.onClick();
		await view.settle();
		assert.equal(textOf(withRole(controls(view.tree)[0], "alert")[0]), say("handout", "failed"));
		assert.ok(buttonNamed(view.tree, say("handout", "retry")));
	});

	test(`${surface_.name}: keep says it is already in the player's language and offers no toggle`, async () => {
		const reading = host([{ ...READY, keep: true }]);
		const view = surface_.open(reading);
		await view.settle();
		buttonNamed(view.tree, say("handout", "translate")).props.onClick();
		await view.settle();
		const control = controls(view.tree)[0];
		assert.equal(textOf(withRole(control, "status")[0]), say("handout", "keep"));
		assert.equal(buttonsIn(control).length, 0, "no original/reading toggle, no second version");
		assert.equal(readingBody(view.tree).length, 0);
		assert.equal(pictures(view.tree).length, 1);
	});
}

// ---------------------------------------------------------------------------------------------
// Polling dies with the control and pauses with the row.
// ---------------------------------------------------------------------------------------------

test("card: unmounting while pending stops the polling", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const reading = host([PENDING]);
	const view = card([IMAGE_HANDOUT], reading.invoke);
	await view.settle();
	buttonNamed(view.tree, say("handout", "translate")).props.onClick();
	await view.settle();
	assert.equal(reading.calls.length, 1);
	view.unmount();
	await view.settle();
	assert.equal(view.live, 0, "every component is gone");
	t.mock.timers.tick(POLL * 10);
	await view.settle();
	assert.equal(reading.calls.length, 1, "no poll outlives the control");
});

test("board: unmounting while pending stops the polling", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const reading = host([PENDING]);
	const view = board([{ handout: "clipping", name: "Clipping", text: "", document: "ready", image: PNG }], [], reading);
	await view.settle();
	buttonNamed(view.tree, say("handout", "translate")).props.onClick();
	await view.settle();
	view.unmount();
	await view.settle();
	t.mock.timers.tick(POLL * 10);
	await view.settle();
	assert.equal(readingCalls(view.calls).length, 1);
});

test("card: a closed row stops asking, and opening it again resumes", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const reading = host([PENDING, PENDING, READY]);
	const view = card([IMAGE_HANDOUT], reading.invoke);
	await view.settle();
	const row = () => nodes(view.tree, (node) => node.type === "details" && node.props["data-kind"] === "handout")[0];
	row().props.onToggle({ currentTarget: { open: true } });
	await view.settle();
	buttonNamed(view.tree, say("handout", "translate")).props.onClick();
	await view.settle();
	row().props.onToggle({ currentTarget: { open: false } });
	await view.settle();
	t.mock.timers.tick(POLL * 10);
	await view.settle();
	assert.equal(reading.calls.length, 1, "a closed row asks the host nothing more");
	row().props.onToggle({ currentTarget: { open: true } });
	await view.settle();
	t.mock.timers.tick(POLL);
	await view.settle();
	assert.equal(reading.calls.length, 2, "opened again, the wait resumes");
	t.mock.timers.tick(POLL);
	await view.settle();
	assert.equal(reading.calls.length, 3);
	assert.equal(readingBody(view.tree).length, 1);
});

test("card: a host redraw while pending does not restart or double the wait", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const reading = host([PENDING, READY]);
	const view = card([IMAGE_HANDOUT], reading.invoke);
	await view.settle();
	buttonNamed(view.tree, say("handout", "translate")).props.onClick();
	await view.settle();
	t.mock.timers.tick(POLL / 2);
	view.drawAgain();
	await view.settle();
	t.mock.timers.tick(POLL / 2);
	await view.settle();
	assert.equal(reading.calls.length, 2, "the redraw kept the timer the pending answer started");
	t.mock.timers.tick(POLL * 3);
	await view.settle();
	assert.equal(reading.calls.length, 2, "and started no second one");
});

// ---------------------------------------------------------------------------------------------
// The two copies, and the words they ask for.
// ---------------------------------------------------------------------------------------------

const OPEN = ">>> handout reading: shared verbatim between pipicoc/mechanics.js and pipicoc/board.js <<<";
const CLOSE = ">>> end handout reading <<<";

function region(path) {
	const source = read(path);
	const start = source.indexOf(OPEN);
	const end = source.indexOf(CLOSE, start);
	assert.ok(start >= 0 && end > start, `${path} has no closed shared handout-reading region`);
	return source.slice(start, end + CLOSE.length);
}

test("the two renderers carry the same handout-reading block, byte for byte", () => {
	const cardBlock = region("pipicoc/mechanics.js");
	assert.equal(cardBlock, region("pipicoc/board.js"), "pipicoc/mechanics.js and pipicoc/board.js have drifted apart");
	assert.ok(cardBlock.length > 3000, "the shared region is too small to be the control");
});

/**
 * Every caption the control shows is asked for with its key written in the call, so this scan sees
 * all of them: the `handout` surface declares exactly the keys the two renderers ask for, no fewer
 * (a missing word renders as its key) and no more (a shipped word nobody asks for is dead weight).
 */
test("the handout surface declares exactly the keys the renderers ask for", () => {
	const asked = new Set();
	for (const path of ["pipicoc/mechanics.js", "pipicoc/board.js"])
		for (const [, key] of read(path).matchAll(/\bword\(\s*ui\s*,\s*["']handout["']\s*,\s*["']([A-Za-z0-9_.]+)["']/g)) asked.add(key);
	const shipped = Object.keys(surface("en", "handout")).sort();
	assert.deepEqual([...asked].sort(), shipped);
	const seeds = readdirSync(join(REPO, "content", "ui"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
	assert.ok(seeds.length >= 2, "a source and at least one seed, or this proves nothing");
	for (const tag of seeds) assert.deepEqual(Object.keys(surface(tag, "handout")).sort(), shipped, `the ${tag} copy carries exactly the authored keys`);
});
