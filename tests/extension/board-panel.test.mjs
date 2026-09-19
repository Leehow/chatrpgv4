/**
 * The case board panel's pack side (contract §39.3): one read, one envelope, and the one rule that
 * matters most -- the private layer geometry a `table.maps` row carries stops at this hop. A source
 * path, a placement box and a redaction box must never reach a renderer (§39's player-projection
 * rule), so the answer is asserted for their absence rather than trusted to the composer.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import { registerBoardPanel } from "../../pipicoc/board.ts";
import { mapWordsDigest } from "../../extensions/module/map-presentation.ts";

/** The authored instruction `readMapWords` digests: the real one, so the cache name is the real name. */
const RESOURCE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function piSurface() {
	return { events: new EventEmitter(), on() {} };
}

function withRegistry(run) {
	const symbol = Symbol.for("pipiui.ext-invoke.registry");
	const prior = globalThis[symbol];
	const handlers = new Map();
	globalThis[symbol] = { version: 1, register(_id, method, handler) { handlers.set(method, handler); return () => {}; } };
	return Promise.resolve().then(() => run(handlers)).finally(() => { globalThis[symbol] = prior; });
}

/**
 * A real 100x50 map page inside the module root `renderMapView` confines sources to. Never the
 * 1x1 fixture: a one-pixel source is not a map, and a provider that receives one rejects the call.
 */
async function page(home) {
	const path = join(home, ".coc", "modules", "the-haunting", "source.png");
	await mkdir(dirname(path), { recursive: true });
	const canvas = createCanvas(100, 50), ctx = canvas.getContext("2d");
	ctx.fillStyle = "#ff0000";
	ctx.fillRect(0, 0, 100, 50);
	await writeFile(path, canvas.toBuffer("image/png"));
	return path;
}

/** One `table.maps` row as §39.3 shapes it: host-facing, so it still carries the layer geometry. */
function mapRow(path) {
	return {
		map: "player-map",
		name: "Player map",
		label: "Player map",
		words: "source",
		regions: [{ id: "entry", label: "Entry Hall", level: "Ground Floor" }],
		levels: ["Ground Floor"],
		render: { layers: [{ region: "entry", label: "Entry Hall", level: "Ground Floor", path, source_box: [0, 0, 1, 1], placement: [0, 0, 1, 1], redactions: [] }] },
	};
}

const VIEW = {
	play_language: "zz",
	clues: { discovered: [{ clue: "letter", label: "A letter" }] },
	npcs: { journal: [{ id: "npc-1", name: "The landlord" }] },
	labels: {},
};

/**
 * A content root whose `zz` tag ships the board surface: the chrome resolves from a seed, so no
 * projection lane is started and the answers below are only about the read under test.
 */
async function wordsRoot() {
	const contentRoot = await mkdtemp(join(tmpdir(), "coc-board-words-root-"));
	await writeFile(join(contentRoot, "languages.json"), JSON.stringify({ source: "zz", default: "zz", suggested: ["zz"] }));
	await mkdir(join(contentRoot, "ui/zz"), { recursive: true });
	await writeFile(join(contentRoot, "ui/zz/board.json"), JSON.stringify({ maps: "Maps", clues: "Clues", npcs: "People", errors: { unknown: "Unknown" } }));
	return contentRoot;
}

/** A session with a table bound to it: the board reads both the player view and the map rows. */
function bind(pi, { home, rows, call, contentRoot = RESOURCE_ROOT }) {
	pi.events.emit("coc:kernel-bridge", {
		campaign: "c1",
		runtime: { home, contentRoot, resourceRoot: RESOURCE_ROOT },
		call: call ?? (async (method) => (method === "table.view" ? VIEW : { maps: rows })),
	});
}

test("no bridge answers table_not_open, and a live session with no table answers unbound", async () => {
	await withRegistry(async (handlers) => {
		const pi = piSurface();
		registerBoardPanel(pi);
		const board = handlers.get("board");
		assert.ok(typeof board === "function", "the pack registers one board invoke");
		const closed = await board({});
		assert.equal(closed.status, "error");
		assert.equal(closed.code, "table_not_open");
		assert.equal(closed.campaign, null);
		assert.deepEqual(closed.maps, []);
		pi.events.emit("coc:kernel-bridge", { call: async () => ({}) });
		const unbound = await board({});
		assert.equal(unbound.status, "unbound");
		assert.deepEqual(unbound.maps, []);
	});
});

test("a seen map arrives as pixels and its private geometry stops at this hop", async () => {
	await withRegistry(async (handlers) => {
		const root = await mkdtemp(join(tmpdir(), "coc-board-")), home = join(root, "home"), path = await page(home);
		const pi = piSurface();
		registerBoardPanel(pi);
		bind(pi, { home, contentRoot: await wordsRoot(), rows: [mapRow(path)] });
		const answer = await handlers.get("board")({});
		assert.equal(answer.status, "ready");
		assert.equal(answer.campaign, "c1");
		assert.equal(answer.maps.length, 1);
		const [map] = answer.maps;
		assert.equal(map.document, "ready");
		assert.match(map.image, /^data:image\/png;base64,/);
		assert.equal(map.regions[0].label, "Entry Hall");
		// The words are still the module's: nothing has projected this tag, and a card that is not
		// wholly projected keeps its authored words rather than going out half in each language.
		assert.equal(map.words, "source");
		assert.deepEqual(answer.view.clues.discovered, VIEW.clues.discovered);
		const text = JSON.stringify(answer);
		for (const forbidden of ["render", "layers", "source_box", "placement", "redactions", path])
			assert.equal(text.includes(forbidden), false, `the panel answer must not carry ${forbidden}`);
	});
});

test("a row still in the module's language is projected from the tag's cached words", async () => {
	await withRegistry(async (handlers) => {
		const root = await mkdtemp(join(tmpdir(), "coc-board-words-")), home = join(root, "home"), path = await page(home);
		const digest = await mapWordsDigest(RESOURCE_ROOT);
		const cache = join(home, ".coc", "map-words", `zz-${digest}.json`);
		await mkdir(dirname(cache), { recursive: true });
		await writeFile(cache, JSON.stringify({ play_language: "zz", digest, texts: {
			"Player map": "Zz map", "Entry Hall": "Zz entry", "Ground Floor": "Zz ground",
		} }));
		const pi = piSurface();
		registerBoardPanel(pi);
		bind(pi, { home, contentRoot: await wordsRoot(), rows: [mapRow(path)] });
		const [map] = (await handlers.get("board")({})).maps;
		assert.equal(map.words, "play_language");
		assert.equal(map.label, "Zz map");
		assert.equal(map.regions[0].label, "Zz entry");
		assert.equal(map.regions[0].level, "Zz ground");
	});
});

test("a map whose page cannot be composed says none rather than drawing a false one", async () => {
	await withRegistry(async (handlers) => {
		const root = await mkdtemp(join(tmpdir(), "coc-board-none-")), home = join(root, "home");
		const pi = piSurface();
		registerBoardPanel(pi);
		bind(pi, { home, contentRoot: await wordsRoot(), rows: [mapRow(join(home, ".coc", "modules", "the-haunting", "gone.png"))] });
		const [map] = (await handlers.get("board")({})).maps;
		assert.equal(map.document, "none");
		assert.equal(map.image, undefined);
		assert.deepEqual(map.regions.map(region => region.id), ["entry"]);
	});
});

test("a kernel without the map read still answers the player view", async () => {
	await withRegistry(async (handlers) => {
		const root = await mkdtemp(join(tmpdir(), "coc-board-old-")), home = join(root, "home");
		const pi = piSurface();
		registerBoardPanel(pi);
		bind(pi, { home, contentRoot: await wordsRoot(), rows: [], call: async (method) => {
			if (method === "table.view") return VIEW;
			throw Object.assign(new Error("unknown method"), { code: "method_not_found" });
		} });
		const answer = await handlers.get("board")({});
		assert.equal(answer.status, "ready");
		assert.deepEqual(answer.maps, []);
		assert.equal(answer.view.play_language, "zz");
	});
});
