#!/usr/bin/env node
/**
 * The fake OCR command: it stands where `bin/coc-ocr` stands and keeps that command's contract
 * (contract §20.1), put there by `PI_COC_OCR_CMD`.
 *
 *   <cmd> <pdf> --pages 0,1,11 --out <dir>
 *
 * writes `<dir>/NNNN.md` named by the original 0-based page index and prints one JSON summary.
 *
 * It logs its whole argument list and whether it could see a token — never the token itself, which is
 * exactly what the test asserts about the real path: the credential travels in the environment only.
 *
 * Environment:
 *   FAKE_OCR_LOG    one JSON line per invocation: {argv, pages, has_token}
 *   FAKE_OCR_FAIL   "1": write nothing and exit non-zero (the `ocr_failed` path)
 *   FAKE_OCR_SKIP   comma-separated pages it silently does not produce (a partial run)
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const pdf = argv[0] ?? "";
const flags = {};
for (let index = 1; index < argv.length; index += 1) {
	if (argv[index].startsWith("--")) {
		flags[argv[index].slice(2)] = argv[index + 1];
		index += 1;
	}
}
const pages = String(flags.pages ?? "")
	.split(",")
	.map((entry) => Number.parseInt(entry, 10))
	.filter((entry) => Number.isInteger(entry));

if (process.env.FAKE_OCR_LOG) {
	appendFileSync(
		process.env.FAKE_OCR_LOG,
		`${JSON.stringify({ argv, pdf, pages, has_token: Boolean(process.env.BAIDUOCR_TOKEN) })}\n`,
	);
}

if (process.env.FAKE_OCR_FAIL === "1") {
	process.stderr.write("fake-ocr: the job was rejected\n");
	process.exit(3);
}

const skip = String(process.env.FAKE_OCR_SKIP ?? "")
	.split(",")
	.map((entry) => Number.parseInt(entry, 10))
	.filter((entry) => Number.isInteger(entry));

mkdirSync(flags.out, { recursive: true });
const written = [];
for (const page of pages) {
	if (skip.includes(page)) continue;
	writeFileSync(join(flags.out, `${String(page).padStart(4, "0")}.md`), `# page ${page}\n\nocr text for page ${page}\n`, "utf8");
	written.push(page);
}
process.stdout.write(`${JSON.stringify({ pages: written, written: written.length, backend: "fake" })}\n`);
