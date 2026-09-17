#!/usr/bin/env node
/**
 * The vendored PipiUI suite, pinned to a recorded set of known failures.
 *
 * `Electron/` was copied in whole (contract §23) and its upstream suite is red in this checkout for
 * reasons that are not defects: packs, workflow files and embedded runtimes are deliberately
 * excluded, the product identity is PipiCOC's rather than PipiUI's, and the PipiCOC wiring changed
 * seams the upstream tests still assert the old way (model-based session titles, an invoke with no
 * live session, the runtime install tree). None of that is worth fixing test by test — but while
 * the suite is simply "red", a real regression is indistinguishable from the inherited noise, and
 * nobody runs it at all.
 *
 * So every failure is recorded once, per test, and this script fails only on a difference:
 *
 *   node Electron/scripts/suite-baseline.mjs            check this checkout against the baseline
 *   node Electron/scripts/suite-baseline.mjs --record   rewrite the baseline from this run
 *
 * A failure that is not in the baseline is a regression. A baseline entry that now passes, or that
 * no longer exists under that name, is a stale baseline and fails too — so the record shrinks as
 * the suite is repaired instead of quietly outliving what it describes.
 *
 * The vitest arguments come out of `Electron/package.json`'s own `test` script rather than being
 * copied here: a baseline measured over a different file set than `npm test` runs would be a
 * baseline for nothing.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const electronRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(electronRoot, "..");

export const BASELINE_PATH = join(electronRoot, "scripts", "vitest-suite-baseline.json");

/** The `test` script's own vitest arguments. Throws rather than guessing if that script is reshaped. */
export function vitestArguments(testScript) {
	const match = /(?:^|\s)vitest\s+run\s+(.*)$/.exec(String(testScript).trim());
	if (!match) throw new Error(`Electron package.json "test" is not a \`vitest run\` command: ${testScript}`);
	return (match[1].match(/'[^']*'|"[^"]*"|\S+/g) ?? []).map((argument) => argument.replace(/^['"]|['"]$/g, ""));
}

/** Keep the suite on the exact Node ABI that launched the checker. Executing Vitest's shebang would
 * ask PATH to choose Node again; on this host that made the build use Node 24 and cold-kernel tests
 * use Node 22, which cannot load the same fs-ext binary. */
export function vitestLaunch(args) {
	return {
		command: process.execPath,
		args: [join(electronRoot, "node_modules", "vitest", "vitest.mjs"), ...args],
	};
}

/**
 * One stable id per failure, in the shape vitest itself prints. A file that never loaded reports no
 * assertions at all, so it is recorded as the whole suite failing rather than silently as zero rows.
 */
export function failureId(file, titles) {
	return titles.length ? `${file} > ${titles.join(" > ")}` : `${file} [suite failed to run]`;
}

/** Every failure in one vitest JSON report, sorted. */
export function failuresOf(report, root = electronRoot) {
	const ids = new Set();
	for (const result of report.testResults ?? []) {
		const file = relative(root, result.name);
		const failed = (result.assertionResults ?? []).filter((assertion) => assertion.status === "failed");
		for (const assertion of failed) {
			ids.add(failureId(file, [...(assertion.ancestorTitles ?? []), assertion.title]));
		}
		if (result.status === "failed" && failed.length === 0) ids.add(failureId(file, []));
	}
	return [...ids].sort();
}

/**
 * Diff a run against the record.
 *
 * `flaky` is the escape hatch and the only one: a test that fails on its own timing (a teardown
 * race, a temp directory removed while something still writes into it) would otherwise flip the
 * check between "regression" and "stale baseline" on alternate runs and train everyone to ignore
 * it. Those ids are named in the baseline with a reason and are checked in neither direction, so
 * the cost of the exemption is visible in the file rather than hidden in this code.
 */
export function compare(baseline, current, flaky = []) {
	const skip = new Set(flaky);
	const known = new Set(baseline.filter((id) => !skip.has(id)));
	const now = new Set(current.filter((id) => !skip.has(id)));
	return {
		regressions: [...now].filter((id) => !known.has(id)).sort(),
		fixed: [...known].filter((id) => !now.has(id)).sort(),
	};
}

/**
 * Failing tests are retried before they are believed.
 *
 * This suite carries real timing flakiness -- jsdom teardown, temp directories removed while a
 * host still writes into them, workers racing over the same fixture. Left alone, three or four
 * different tests fail on any given run, which would make a strict diff churn every time and turn
 * the check into noise nobody reads. A retry costs only the failures (a couple of hundred out of
 * three thousand) and settles all but the incurable ones, which go on the baseline's `flaky` list
 * by name. It cannot hide a regression: a test that fails deterministically fails all three times.
 */
const RETRIES = 2;

function runSuite(files = [], serial = false) {
	const testScript = JSON.parse(readFileSync(join(electronRoot, "package.json"), "utf8")).scripts.test;
	const directory = mkdtempSync(join(tmpdir(), "pipicoc-suite-"));
	const outputFile = join(directory, "report.json");
	try {
		try {
			const launch = vitestLaunch([...vitestArguments(testScript), ...files, ...(serial ? ["--no-file-parallelism"] : []),
				`--retry=${RETRIES}`, "--reporter=json", `--outputFile=${outputFile}`]);
			execFileSync(launch.command, launch.args,
				{ cwd: electronRoot, stdio: ["ignore", "inherit", "inherit"] });
		} catch {
			// A red suite is the normal case here: the report on disk is the answer, not the exit code.
		}
		return failuresOf(JSON.parse(readFileSync(outputFile, "utf8")));
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

/** The file half of a failure id, which is everything before the first ` > ` or ` [`. */
export function fileOf(id) {
	return id.split(/ (?:>|\[)/)[0].trim();
}

/**
 * Re-decide a difference by running only the files it touches, one at a time.
 *
 * Measured, not assumed: three consecutive full runs of this suite each reported a different one or
 * two failures, always in files that pass on their own -- jsdom layout read as zero, a sidebar row
 * not painted yet, a temp directory removed while something still wrote into it. All of it is load,
 * and a check that cries wolf most runs is worse than no check. So a difference is confirmed by a
 * serial re-run of just those files before anyone is told about it; a test that is actually broken
 * fails there too, because nothing is competing with it.
 */
export function confirmed(current, differing, run = runSuite) {
	const files = [...new Set(differing.map(fileOf))];
	if (!files.length) return current;
	const again = run(files, true);
	const touched = new Set(files);
	return [...current.filter((id) => !touched.has(fileOf(id))), ...again].sort();
}

function headCommit() {
	return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
}

/** Whether the record describes a commit or a commit plus somebody's uncommitted work. */
function treeIsDirty() {
	return execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" }).trim().length > 0;
}

export function writeBaseline(observed, commit, flaky = [], treeDirty = false) {
	const flakyIds = new Set(flaky.map((row) => row.id));
	const failures = observed.filter((id) => !flakyIds.has(id));
	writeFileSync(BASELINE_PATH, `${JSON.stringify({
		$comment: [
			"Known failures of the vendored PipiUI suite (Electron/), recorded so that a new one stands out.",
			"These are inherited from copying the workspace in whole plus the deliberate PipiCOC changes in",
			"contract §23 -- excluded packs and workflows, PipiCOC product identity, no model-based session",
			"title, an invoke path that answers the investigator panel without a live session.",
			"Check with `npm run test:electron`; rewrite with `node Electron/scripts/suite-baseline.mjs --record`.",
			"This list is meant to shrink. Do not add an entry by hand to make a red run go green.",
			"Two gates keep load-induced flakiness out of the list: failing tests are retried twice, and a",
			"difference is re-checked by running only its files serially before anyone is told about it.",
			"`flaky` is checked in neither direction: those tests fail",
			"them would flip the check between regression and stale baseline on alternate runs. Each one",
			"carries the reason it cannot be pinned. Adding an id here silences that test -- say why.",
		],
		recordedAt: new Date().toISOString(),
		commit,
		treeDirty,
		count: failures.length,
		flaky,
		failures,
	}, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const current = runSuite();
	// A missing record is only tolerable when the run is what creates it.
	const recorded = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, "utf8")) : { failures: [], flaky: [] };
	const flaky = (recorded.flaky ?? []).map((row) => row.id);
	if (process.argv.includes("--record")) {
		const commit = headCommit();
		// The flaky list is carried over rather than re-derived: whether one of them failed on this
		// particular run says nothing, which is the whole reason it is on the list.
		writeBaseline(current, commit, recorded.flaky ?? [], treeIsDirty());
		console.log(`Recorded ${current.filter((id) => !flaky.includes(id)).length} known failures at ${commit.slice(0, 8)}.`);
		process.exit(0);
	}
	let { regressions, fixed } = compare(recorded.failures, current, flaky);
	if (regressions.length || fixed.length) {
		console.log(`Re-running ${new Set([...regressions, ...fixed].map(fileOf)).size} file(s) on their own to confirm.`);
		({ regressions, fixed } = compare(recorded.failures, confirmed(current, [...regressions, ...fixed]), flaky));
	}
	for (const id of regressions) console.error(`NEW FAILURE        ${id}`);
	for (const id of fixed) console.error(`NO LONGER FAILING  ${id}`);
	if (regressions.length === 0 && fixed.length === 0) {
		console.log(`Vendored suite matches its baseline: ${recorded.failures.length} known failures, ${flaky.length} exempt as flaky, nothing new.`);
		process.exit(0);
	}
	console.error(regressions.length
		? `\n${regressions.length} failure(s) outside the baseline: something this branch changed broke a test the vendored suite still guards.`
		: `\n${fixed.length} baseline entries no longer fail: re-record so the baseline keeps shrinking.`);
	process.exit(1);
}
