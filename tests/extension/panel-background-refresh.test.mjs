/**
 * The right rail's refresh buttons belong to the player (installed-app defect, 2026-09-22).
 *
 * The case board, the investigator sheet and the timeline re-read on pushes from the pack's
 * extension channel, and one turn pushes dozens (`sheet-changed`, `board-changed`,
 * `mods-progress` per Mod-agent step, the host's own frames...). Every re-read used to set the
 * busy flag, so the refresh button flipped between its word and the busy word for the whole
 * turn. These tests hold the two rules that fix it: a push re-reads silently, and a burst of
 * pushes while a read is in flight folds into one trailing read.
 *
 * The renderers take React by injection; the stand-in below tracks hook deps and effect cleanup
 * the way React does, so a subscription is made once per `api` rather than once per render.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createComponent as createBoard } from "../../pipicoc/board.js";
import { createComponent as createSheet } from "../../pipicoc/panel.js";
import { createComponent as createTimeline } from "../../pipicoc/timeline.js";

const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, k) => Object.is(v, b[k]));

function mount(createComponent, api) {
	const hooks = [];
	let index = 0, dirty = false, tree = null, effects = [];
	const React = {
		createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
		useState(initial) {
			const k = index++;
			if (!(k in hooks)) hooks[k] = { value: typeof initial === "function" ? initial() : initial };
			const cell = hooks[k];
			return [cell.value, (next) => {
				const value = typeof next === "function" ? next(cell.value) : next;
				if (!Object.is(value, cell.value)) { cell.value = value; dirty = true; }
			}];
		},
		useRef(initial) { const k = index++; return (hooks[k] ??= { current: initial }); },
		useCallback(fn, deps) {
			const k = index++;
			if (hooks[k] && same(hooks[k].deps, deps)) return hooks[k].fn;
			hooks[k] = { fn, deps };
			return fn;
		},
		useMemo(fn, deps) {
			const k = index++;
			if (hooks[k] && same(hooks[k].deps, deps)) return hooks[k].value;
			hooks[k] = { value: fn(), deps };
			return hooks[k].value;
		},
		useEffect(fn, deps) {
			const k = index++;
			const prior = hooks[k];
			if (prior && deps && same(prior.deps, deps)) return;
			hooks[k] = { deps, cleanup: prior?.cleanup };
			effects.push(() => {
				hooks[k].cleanup?.();
				const cleanup = fn();
				hooks[k].cleanup = typeof cleanup === "function" ? cleanup : undefined;
			});
		},
	};
	const Component = createComponent(React);
	function render() {
		index = 0; dirty = false; effects = [];
		tree = Component({ api });
		for (const effect of effects) effect();
	}
	render();
	return {
		get tree() { return tree; },
		/** Let every pending promise resolve and every state change render, React-style. */
		async settle() {
			for (let pass = 0; pass < 20; pass += 1) {
				await new Promise((done) => setImmediate(done));
				if (!dirty) return;
				render();
			}
		},
		/** Render now, the way React would after a state change a push itself caused. */
		render() { if (dirty) render(); },
	};
}

function nodes(tree, predicate) {
	if (!tree || typeof tree !== "object") return [];
	return [...(predicate(tree) ? [tree] : []), ...(tree.children ?? []).flatMap((child) => nodes(child, predicate))];
}
const text = (node) => (node && typeof node === "object" ? (node.children ?? []).map(text).join("") : node == null || node === false ? "" : String(node));

/** A pack whose every read waits until the test releases it, and a channel the test can push on. */
function pack(answer) {
	const calls = [], pending = [], listeners = new Set();
	return {
		calls,
		pending,
		api: {
			invoke(method, params) {
				calls.push({ method, params });
				return new Promise((resolve) => pending.push(() => resolve({ ok: true, data: answer })));
			},
			subscribeExt(listener) { listeners.add(listener); return () => listeners.delete(listener); },
		},
		push(event) { for (const listener of listeners) listener(event); },
		release() { for (const resolve of pending.splice(0)) resolve(); },
		get subscribers() { return listeners.size; },
	};
}

const PANELS = [
	{
		name: "case board",
		create: createBoard,
		answer: { status: "ready", campaign: "c1", view: { clues: {}, npcs: {} }, maps: [],
			ui: { tag: "zz", words: { board: { refresh: "REFRESH", refreshing: "BUSY" } } } },
		event: { type: "board-changed" },
		button: (tree) => nodes(tree, (node) => node.type === "button" && node.props.className === "coc-sheet-refresh")[0],
		busyWord: "BUSY",
		method: "board",
	},
	{
		name: "investigator sheet",
		create: createSheet,
		// A table with no party yet: the state where the button reads "retry" and the busy word is "loading".
		answer: { campaign: "c1", view: null, status: "empty",
			ui: { tag: "zz", words: { sheet: { retry: "RETRY", loading: "BUSY" } } } },
		event: { type: "sheet-changed" },
		button: (tree) => nodes(tree, (node) => node.type === "button")[0],
		busyWord: "BUSY",
		method: "sheet",
	},
	{
		name: "timeline",
		create: createTimeline,
		answer: { status: "unbound", ui: { tag: "zz", words: { timeline: { refresh: "REFRESH" } } } },
		event: { type: "timeline-changed" },
		button: (tree) => nodes(tree, (node) => node.type === "button" && node.props.className === "coc-tl-refresh")[0],
		busyWord: null, // the timeline's button keeps its word and only greys out
		method: "timeline.graph",
	},
];

for (const panel of PANELS) {
	test(`${panel.name}: a push re-reads without flipping the refresh button`, async () => {
		const table = pack(panel.answer);
		const view = mount(panel.create, table.api);
		table.release(); await view.settle();
		const before = table.calls.length;
		const idle = panel.button(view.tree);
		assert.ok(idle, "the panel draws its refresh button once it has an answer");
		assert.equal(idle.props.disabled, false);

		table.push(panel.event);
		await view.settle();
		assert.equal(table.calls.length, before + 1, "the push still re-reads");
		assert.equal(table.calls.at(-1).params?.retry_projection, undefined, "and never asks a failed lane to run again");
		const during = panel.button(view.tree);
		assert.equal(during.props.disabled, false, "a background read must not disable the button");
		if (panel.busyWord) assert.notEqual(text(during), panel.busyWord, "a background read must not show the busy word");
		table.release(); await view.settle();
	});

	test(`${panel.name}: the player's own click shows busy until its read answers`, async () => {
		const table = pack(panel.answer);
		const view = mount(panel.create, table.api);
		table.release(); await view.settle();
		panel.button(view.tree).props.onClick();
		await view.settle();
		const during = panel.button(view.tree);
		assert.equal(during.props.disabled, true, "the player's click disables the button while it reads");
		if (panel.busyWord) assert.equal(text(during), panel.busyWord, "and shows the busy word");
		table.release(); await view.settle();
		assert.equal(panel.button(view.tree).props.disabled, false, "and lets go once the read answers");
	});

	test(`${panel.name}: a burst of pushes during a read folds into one trailing read`, async () => {
		const table = pack(panel.answer);
		const view = mount(panel.create, table.api);
		table.release(); await view.settle();
		const before = table.calls.length;
		for (let n = 0; n < 12; n += 1) table.push(panel.event);
		await view.settle();
		table.release(); await view.settle();
		table.release(); await view.settle();
		const reads = table.calls.slice(before).filter((call) => call.method === panel.method).length;
		assert.ok(reads >= 1 && reads <= 2, `twelve pushes cost ${reads} reads; at most two (the one in flight and one after it)`);
		assert.equal(table.pending.length, 0, "and nothing is left waiting");
		assert.equal(table.subscribers, 1, "one subscription for the life of the panel");
	});

	test(`${panel.name}: a push that lands during a read is not lost`, async () => {
		const table = pack(panel.answer);
		const view = mount(panel.create, table.api);
		// The mount read is still in flight when the push arrives.
		table.push(panel.event);
		await view.settle();
		assert.equal(table.calls.length, 1, "the push waits for the read in flight");
		table.release(); await view.settle();
		assert.equal(table.calls.length, 2, "and runs once after it, so the change it announced is read");
		table.release(); await view.settle();
	});
}
