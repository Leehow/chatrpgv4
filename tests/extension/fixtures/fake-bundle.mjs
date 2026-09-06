#!/usr/bin/env node
/**
 * The fake packer: it stands where `bin/coc-bundle` stands (contract §14.2, §20.3), put there by
 * `PI_COC_BUNDLE_CMD`, and it takes the real packer's command line:
 *
 *   <cmd> PAGES_DIR --out BUNDLE_DIR --producer NAME --title T --slug S --language L \
 *         --file-sha256 H --filename F [--assets DIR] [--asset-meta META.json]
 *
 * It writes the manifest the same way the real one does — a pure function of the page bytes — and
 * stamps `minted_by: "fake-bundle"` on it. That stamp is the point: the ingest job must never write a
 * manifest itself, so a test can prove the file came from the packer and not from the job.
 *
 * Environment:
 *   FAKE_BUNDLE_LOG   one JSON line per invocation: {argv, flags}
 *   FAKE_BUNDLE_FAIL  "1": exit non-zero without writing (the `pack_failed` path)
 */

import { appendFileSync, copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const argv = process.argv.slice(2);
const positional = [];
const flags = {};
for (let index = 0; index < argv.length; index += 1) {
	if (argv[index].startsWith("--")) {
		flags[argv[index].slice(2)] = argv[index + 1];
		index += 1;
	} else {
		positional.push(argv[index]);
	}
}

if (process.env.FAKE_BUNDLE_LOG) {
	appendFileSync(process.env.FAKE_BUNDLE_LOG, `${JSON.stringify({ argv, positional, flags })}\n`);
}
if (process.env.FAKE_BUNDLE_FAIL === "1") {
	process.stderr.write("fake-bundle: refusing to pack\n");
	process.exit(2);
}

const pagesDir = positional[0];
const out = flags.out;
const missing = ["producer", "title", "slug", "language", "file-sha256", "filename"].filter((name) => !flags[name]);
if (!pagesDir || !out || missing.length > 0) {
	process.stderr.write(`fake-bundle: missing required argument(s): ${missing.join(", ") || "pages_dir/--out"}\n`);
	process.exit(2);
}

const indices = readdirSync(pagesDir)
	.map((entry) => /^(\d{4})\.md$/.exec(entry))
	.filter(Boolean)
	.map((match) => Number.parseInt(match[1], 10))
	.sort((left, right) => left - right);
if (indices.length === 0 || indices[0] !== 0 || indices.at(-1) !== indices.length - 1) {
	process.stderr.write(`fake-bundle: pages must be contiguous from 0000; found ${indices.length}\n`);
	process.exit(2);
}

mkdirSync(join(out, "pages"), { recursive: true });
const pages = [];
for (const index of indices) {
	const name = `${String(index).padStart(4, "0")}.md`;
	const data = readFileSync(join(pagesDir, name));
	copyFileSync(join(pagesDir, name), join(out, "pages", name));
	pages.push({
		pdf_index: index,
		path: `pages/${name}`,
		sha256: createHash("sha256").update(data).digest("hex"),
		chars: data.toString("utf8").length,
	});
}

writeFileSync(
	join(out, "manifest.json"),
	`${JSON.stringify(
		{
			contract: "coc.pdf-bundle.v1",
			minted_by: "fake-bundle",
			producer: flags.producer,
			module_identity: { title: flags.title, slug: flags.slug, language: flags.language },
			source: { file_sha256: flags["file-sha256"], page_count: pages.length, filename: flags.filename },
			pages,
		},
		null,
		2,
	)}\n`,
	"utf8",
);
process.stdout.write(`${join(out, "manifest.json")}\n`);
