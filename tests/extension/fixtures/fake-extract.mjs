#!/usr/bin/env node
/**
 * The fake extract adapter: it stands exactly where the local `@firecrawl/pdf-inspector` stands
 * (contract §20.1), and is put there by `PI_COC_EXTRACT`, the same trick as `PI_COC_KERNEL_CMD`.
 * It never opens the file it is given: the "book" is whatever `FAKE_PDF` describes.
 *
 * Two verbs, the adapter's own contract:
 *   <cmd> classify <pdf>                          -> one JSON object on stdout
 *   <cmd> extract <pdf> --pages 0,1 --out <dir>   -> writes <dir>/NNNN.md, prints one JSON object
 *
 * Environment:
 *   FAKE_PDF            {"page_count": n, "pages_needing_ocr": [..], "pdf_type": "Mixed"}
 *   FAKE_EXTRACT_LOG    one JSON line per invocation: {verb, pdf, flags, argv}
 *   FAKE_EXTRACT_FAIL   "classify" or "extract": that verb exits non-zero (the `bad_pdf` path)
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const verb = argv[0] ?? "";
const pdf = argv[1] ?? "";
const flags = {};
for (let index = 2; index < argv.length; index += 1) {
	if (argv[index].startsWith("--")) {
		flags[argv[index].slice(2)] = argv[index + 1];
		index += 1;
	}
}

const book = process.env.FAKE_PDF ? JSON.parse(process.env.FAKE_PDF) : {};
const pageCount = typeof book.page_count === "number" ? book.page_count : 4;
const needsOcr = Array.isArray(book.pages_needing_ocr) ? book.pages_needing_ocr : [];

if (process.env.FAKE_EXTRACT_LOG) {
	appendFileSync(process.env.FAKE_EXTRACT_LOG, `${JSON.stringify({ verb, pdf, flags, argv })}\n`);
}

if (process.env.FAKE_EXTRACT_FAIL === verb) {
	process.stderr.write(`fake-extract: ${verb} was told to fail\n`);
	process.exit(4);
}

if (verb === "classify") {
	process.stdout.write(
		`${JSON.stringify({ pdf_type: book.pdf_type ?? "Mixed", page_count: pageCount, pages_needing_ocr: needsOcr, confidence: 0.76 })}\n`,
	);
	process.exit(0);
}

if (verb === "extract") {
	const pages = String(flags.pages ?? "")
		.split(",")
		.map((entry) => Number.parseInt(entry, 10))
		.filter((entry) => Number.isInteger(entry));
	mkdirSync(flags.out, { recursive: true });
	const written = [];
	for (const page of pages) {
		// A page the classifier put on the OCR list has no native text: that is the whole point of the list.
		const markdown = needsOcr.includes(page) ? "" : `# page ${page}\n\nnative text for page ${page}\n`;
		writeFileSync(join(flags.out, `${String(page).padStart(4, "0")}.md`), markdown, "utf8");
		written.push(page);
	}
	process.stdout.write(`${JSON.stringify({ written, pages_needing_ocr: needsOcr })}\n`);
	process.exit(0);
}

process.stderr.write(`fake-extract: unknown verb ${verb}\n`);
process.exit(2);
