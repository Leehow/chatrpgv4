/**
 * One speaker, one colour, in both renderers (contract §40.4).
 *
 * The delivery card and the sheet panel have to allocate the same hue for the same person, and
 * they cannot import each other: a pack renderer is handed to the window as a `data:` module
 * (`controlled-component-loader.ts`), where a relative specifier resolves to nothing. So the
 * hash, the probe and the palette are authored once and copied byte for byte into both files.
 *
 * A copy that drifts is exactly the failure this guards: the legend paints one hue, the transcript
 * paints another, and nothing throws. The rendering itself is pinned in
 * `Electron/packages/ui/src/coc-speech.test.tsx`, which draws both components; here only the two
 * copies are compared, because that is a fact about the files and not about React.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = new URL("../..", import.meta.url).pathname;
const OPEN = ">>> speaker colour: shared verbatim between pipicoc/mechanics.js and pipicoc/board.js <<<";
const CLOSE = ">>> end speaker colour <<<";

/** The shared region of one renderer, markers included, or a failure naming the file. */
function region(path) {
	const source = readFileSync(join(REPO, path), "utf8");
	const start = source.indexOf(OPEN);
	const end = source.indexOf(CLOSE, start);
	assert.ok(start >= 0, `${path} has no shared speaker-colour region`);
	assert.ok(end > start, `${path} never closes its shared speaker-colour region`);
	return source.slice(start, end + CLOSE.length);
}

test("the two renderers carry the same speaker-colour block, byte for byte", () => {
	const card = region("pipicoc/mechanics.js");
	const panel = region("pipicoc/board.js");
	assert.equal(card, panel, "pipicoc/mechanics.js and pipicoc/board.js have drifted apart");
	// A region that shrank to nothing would compare equal and prove nothing.
	assert.ok(card.length > 2000, "the shared region is too small to be the block");
});

test("the block is the whole colour rule: sixteen hues light and dark, one fixed investigator ink", () => {
	const block = region("pipicoc/mechanics.js");
	for (let slot = 0; slot < 16; slot += 1) {
		const uses = block.match(new RegExp(`--coc-say-${slot}:`, "g")) || [];
		assert.equal(uses.length, 2, `--coc-say-${slot} needs a light value and a dark value`);
	}
	assert.equal((block.match(/--coc-say-16:/g) || []).length, 0, "the palette is sixteen hues");
	assert.equal((block.match(/--coc-say-pc:/g) || []).length, 2,
		"the investigator's ink is fixed and lives outside the hash palette, light and dark");
	assert.match(block, /\[data-scheme="dark"\]/,
		"the dark half follows the shell's own theme attribute, not the operating system");
	assert.match(block, /const SPEAKER_SLOTS = 16;/);
	// §40.4: nothing about a colour is stored. The block may name a store in its own prose -- it
	// says where a colour does not go -- but it may not reach for one, so the reach is what is
	// matched here: a property access or a call, never the bare word.
	assert.equal(
		/(localStorage|sessionStorage|indexedDB)\s*[.[]|\.setItem\(|fetch\(|appendEntry\(|invoke\(/.test(block),
		false, "a speaker colour is derived on every render and written nowhere");
});

/**
 * The palette is colour, not vocabulary. §40.4 adds no caption, and §23 forbids an authored word
 * in a play language from entering these two files; the words test reads them whole, and this
 * keeps the block itself honest about the one thing it is allowed to add.
 */
test("the block adds no player-facing word", () => {
	const block = region("pipicoc/board.js");
	const CJK = /[　-〿぀-ヿ㐀-䶿一-鿿가-힯＀-￯]/u;
	assert.equal(CJK.test(block), false, "the shared block carries no authored non-English text");
});
