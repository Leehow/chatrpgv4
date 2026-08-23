#!/usr/bin/env node
// Regression: opening source review skips the locator/router page window
// and sends the isolated text extractor every preseeded Markdown page.
//
// This is a source-and-prompt contract check, not a mocked transport loop:
// the Python adapter owns the live path, and these strings are the host-
// visible description plus the adapter functions that must stay seed-free.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.cwd());

function section(source, start, stop) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing ${start}`);
  const body = source.slice(from + start.length);
  const to = body.indexOf(stop);
  assert.notEqual(to, -1, `missing ${stop} after ${start}`);
  return body.slice(0, to);
}

const adapter = await readFile(path.join(
  root, "plugins/coc-keeper/pi/bin/coc-pdf-skill-adapter.py",
), "utf8");
const materialize = section(
  adapter,
  "def _materialize_opening_bundle",
  "\ndef _run_opening_text_extractor",
);
assert.match(materialize, /every bound Markdown page/);
assert.doesNotMatch(materialize, /_try_external_pdf_router/);
assert.doesNotMatch(materialize, /_earliest_contiguous_page_run/);
assert.match(materialize, /"selected_opening_pdf_indices": \[\]/);

const promptFn = section(
  adapter,
  "def _opening_text_prompt",
  "\n_OPENING_FACT_QUESTIONS",
);
assert.match(promptFn, /no locator seed/);
assert.doesNotMatch(promptFn, /opening_seed/);
assert.doesNotMatch(promptFn, /locator hint/);

const openingRun = section(
  adapter,
  "def _run_opening_review",
  "\ndef _validate_full_parse_task",
);
assert.match(openingRun, /_materialize_opening_bundle/);
assert.match(openingRun, /_run_opening_text_extractor/);
assert.doesNotMatch(openingRun, /_locator_prompt/);
assert.doesNotMatch(openingRun, /_locator_receipt/);

const host = await readFile(path.join(
  root, "plugins/coc-keeper/pi/prompts/host-system.md",
), "utf8");
const setup = await readFile(path.join(
  root, "plugins/coc-keeper/pi/prompts/host-system-setup.md",
), "utf8");
for (const [label, text] of [["host-system", host], ["host-system-setup", setup]]) {
  assert.match(
    text,
    /isolated text extractor/,
    `${label} must describe extractor semantic selection`,
  );
  assert.match(
    text,
    /There is no locator page-window producer for this review/,
    `${label} must not leave the old opening locator path live`,
  );
}

console.log("opening-review-direct-extractor: ok");
