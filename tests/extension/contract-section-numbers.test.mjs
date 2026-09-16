/**
 * The contract's §-numbers are stable ids, and nothing has ever checked them.
 *
 * Two failures on 2026-09-16 alone, both found by hand, both after the fact:
 *
 *  - Two sessions working concurrently each took §54, and each took §57, for unrelated
 *    subjects. Neither learned of it until a merge; by then both numbers were cited from
 *    code, tests and fixtures on two branches.
 *  - A commit renumbered a family from §41 to §42 because "§41 already has a claimant that
 *    wrote it" -- true, but on a branch that was never merged. The mainline ended up with
 *    §41 and §42 both absent while §42 was cited from eleven live places, and the fix that
 *    branch carried (a bad Mod package making the product tell the player to say it again)
 *    never shipped.
 *
 * Both are mechanical, and both are invisible to every test we have: a §-number is prose to
 * the compiler and a string to grep. So they are checked here, against the document itself.
 *
 * What is deliberately not checked: whether a section's content is right, whether a number is
 * the *best* number, or whether a section is finished. Only that a number names exactly one
 * subject, that the file reads in order, and that a number cited from code exists.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONTRACT = join(REPO, "docs", "kernel-rpc.md");
const run = promisify(execFile);

/** `## 41. A refused player input ...` -> {number: 41, line, title} */
async function headings() {
	const text = await readFile(CONTRACT, "utf8");
	const found = [];
	text.split("\n").forEach((line, index) => {
		const match = /^## (\d+)\. (.+)$/.exec(line);
		if (match) found.push({ number: Number(match[1]), line: index + 1, title: match[2] });
	});
	return found;
}

test("a section number names exactly one subject", async () => {
	const seen = new Map();
	for (const heading of await headings()) {
		const previous = seen.get(heading.number);
		assert.equal(previous, undefined,
			`§${heading.number} is used twice: line ${previous?.line} "${previous?.title}" and `
			+ `line ${heading.line} "${heading.title}". §-numbers are stable ids -- whichever landed `
			+ `first keeps the number and the other moves, and every citation moves with it.`);
		seen.set(heading.number, heading);
	}
	assert.ok(seen.size > 40, `only ${seen.size} numbered sections found; the heading pattern may have changed`);
});

test("the sections read in ascending order", async () => {
	const numbers = (await headings()).map(heading => heading.number);
	const sorted = [...numbers].sort((left, right) => left - right);
	assert.deepEqual(numbers, sorted,
		"a section is out of numeric order. A merge that appends to the tail puts a lower number "
		+ "after a higher one, and the document is read by number, not by position.");
});

test("a section number cited from the code exists in the contract", async () => {
	const numbered = new Set((await headings()).map(heading => heading.number));
	// Citations are found by asking git for the tracked files, so a stale build artifact or an
	// untracked scratch file can never fail this, and nothing has to be excluded by name.
	// `--text`: a few test files embed package bytes for digest fixtures, so git calls them binary
	// and prints "Binary file ... matches" instead of the match. Those files cite §-numbers in their
	// prose like any other, and a citation that hides behind a byte is exactly the one nobody finds.
	const { stdout } = await run("git", ["grep", "--text", "-hoE", "§[0-9]+", "--",
		"*.ts", "*.mjs", "*.js", "*.py"], { cwd: REPO, maxBuffer: 16 * 1024 * 1024 });
	const cited = new Set(stdout.split("\n").filter(Boolean).map(token => Number(token.slice(1))));
	const missing = [...cited].filter(number => !numbered.has(number)).sort((left, right) => left - right);
	assert.deepEqual(missing, [],
		`these §-numbers are cited from code or tests but have no section in docs/kernel-rpc.md: `
		+ `${missing.map(number => `§${number}`).join(", ")}. A citation that points at nothing is `
		+ `worse than no citation: the reader concludes the rule is written down somewhere and stops looking.`);
});
