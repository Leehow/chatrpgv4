// Mechanical validation for the Jev wide-preflight evaluation cases.
//
// Scope: schema shape, identifier uniqueness, page references against the
// corpus, verbatim evidence quotes, and source/corpus byte bindings. This file
// performs NO semantic quality assessment of any model or retrieval run; gold
// pages and quotes were fixed from the source text before any model run.
//
// Corpus input: process.env.JEV_PREFLIGHT_CORPUS, defaulting to
// `<project root>/.pi/prototypes/jev-pdf-routing-20260919/corpus.json`
// (resolved against the current working directory).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const corpusPath =
  process.env.JEV_PREFLIGHT_CORPUS ??
  path.resolve(process.cwd(), '.pi/prototypes/jev-pdf-routing-20260919/corpus.json');

const rawCorpus = readFileSync(corpusPath);
const corpus = JSON.parse(rawCorpus);
const data = JSON.parse(readFileSync(path.join(here, 'cases.json'), 'utf8'));

const pageTexts = new Map(corpus.pages.map((page) => [page.page, page.text]));
const ALLOWED_ORIGINS = new Set(['existing-diagnostic', 'fresh-authored-diagnostic']);
const ALLOWED_STATUSES = new Set(['supported', 'native_gap', 'unsupported']);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isIntArray(value, { allowEmpty = false } = {}) {
  if (!Array.isArray(value)) return false;
  if (!allowEmpty && value.length === 0) return false;
  return value.every((entry) => Number.isInteger(entry));
}

function isStringArray(value, { allowEmpty = false } = {}) {
  if (!Array.isArray(value)) return false;
  if (!allowEmpty && value.length === 0) return false;
  return value.every((entry) => typeof entry === 'string');
}

function pageExists(page) {
  return Number.isInteger(page) && pageTexts.has(page);
}

test('cases file binds to the exact corpus bytes and the original source', () => {
  assert.equal(data.version, 1, 'top-level version must be 1');
  assert.equal(
    data.corpus_sha256,
    createHash('sha256').update(rawCorpus).digest('hex'),
    'corpus_sha256 must equal the sha256 of the raw corpus.json file bytes',
  );
  assert.equal(
    data.source_sha256,
    corpus.sha256,
    'source_sha256 must equal the sha256 recorded inside corpus.json (original PDF bytes)',
  );
  assert.ok(Array.isArray(data.cases) && data.cases.length > 0, 'cases must be a non-empty array');
});

test('case ids are unique and every case is well-formed', () => {
  const ids = new Set();
  for (const testCase of data.cases) {
    assert.ok(isNonEmptyString(testCase.id), 'case id must be a non-empty string');
    assert.ok(!ids.has(testCase.id), `duplicate case id: ${testCase.id}`);
    ids.add(testCase.id);

    assert.ok(isNonEmptyString(testCase.query), `case ${testCase.id}: query must be a non-empty string`);
    assert.ok(isNonEmptyString(testCase.context), `case ${testCase.id}: context must be a non-empty string`);
    assert.ok(
      ALLOWED_ORIGINS.has(testCase.origin),
      `case ${testCase.id}: origin must be one of existing-diagnostic | fresh-authored-diagnostic (got ${testCase.origin}); no case may claim production or player-holdout provenance`,
    );
    assert.ok(
      ALLOWED_STATUSES.has(testCase.expectedStatus),
      `case ${testCase.id}: expectedStatus must be supported | native_gap | unsupported`,
    );
    assert.ok(
      isIntArray(testCase.visualGapPages, { allowEmpty: true }),
      `case ${testCase.id}: visualGapPages must be an array of integers (possibly empty)`,
    );
    assert.ok(
      isStringArray(testCase.answerNotes, { allowEmpty: true }),
      `case ${testCase.id}: answerNotes must be an array of strings`,
    );
    if (testCase.unresolvedRequirements !== undefined) {
      assert.ok(
        isStringArray(testCase.unresolvedRequirements, { allowEmpty: true }),
        `case ${testCase.id}: unresolvedRequirements must be an array of strings`,
      );
    }
    assert.ok(Array.isArray(testCase.requirements), `case ${testCase.id}: requirements must be an array`);
  }
});

test('every referenced page exists in the corpus', () => {
  for (const testCase of data.cases) {
    for (const page of testCase.visualGapPages) {
      assert.ok(
        pageExists(page),
        `case ${testCase.id}: visualGapPages references page ${page}, which does not exist in the corpus`,
      );
    }
    for (const requirement of testCase.requirements) {
      for (const page of requirement.anyOfPages) {
        assert.ok(
          pageExists(page),
          `case ${testCase.id}/${requirement.id}: anyOfPages references page ${page}, which does not exist in the corpus`,
        );
      }
    }
  }
});

test('requirement evidence quotes are exact spans of the referenced native pages', () => {
  for (const testCase of data.cases) {
    const requirementIds = new Set();
    for (const requirement of testCase.requirements) {
      assert.ok(isNonEmptyString(requirement.id), `case ${testCase.id}: requirement id must be a non-empty string`);
      assert.ok(
        !requirementIds.has(requirement.id),
        `case ${testCase.id}: duplicate requirement id ${requirement.id}`,
      );
      requirementIds.add(requirement.id);

      assert.ok(
        isNonEmptyString(requirement.description),
        `case ${testCase.id}/${requirement.id}: description must be a non-empty string`,
      );
      assert.ok(
        isIntArray(requirement.anyOfPages),
        `case ${testCase.id}/${requirement.id}: anyOfPages must be a non-empty array of integers`,
      );
      assert.ok(
        Array.isArray(requirement.evidence) && requirement.evidence.length > 0,
        `case ${testCase.id}/${requirement.id}: evidence must be a non-empty array`,
      );

      for (const evidence of requirement.evidence) {
        assert.ok(
          requirement.anyOfPages.includes(evidence.page),
          `case ${testCase.id}/${requirement.id}: evidence page ${evidence.page} is not listed in anyOfPages`,
        );
        assert.ok(
          pageExists(evidence.page),
          `case ${testCase.id}/${requirement.id}: evidence page ${evidence.page} does not exist in the corpus`,
        );
        const pageText = pageTexts.get(evidence.page);
        assert.ok(
          typeof evidence.quote === 'string' && evidence.quote.length > 0,
          `case ${testCase.id}/${requirement.id}: quote must be a non-empty string`,
        );
        assert.ok(
          pageText.includes(evidence.quote),
          `case ${testCase.id}/${requirement.id}: quote is not a verbatim span of native page ${evidence.page} text`,
        );
      }
    }
  }
});

test('supported cases declare multiple requirements; gap cases declare an explicit requirement set', () => {
  for (const testCase of data.cases) {
    if (testCase.expectedStatus === 'supported') {
      assert.ok(
        testCase.requirements.length >= 2,
        `case ${testCase.id}: supported cases need at least two verifiable requirements to measure real material coverage, not a topical hit`,
      );
    } else {
      assert.ok(
        Array.isArray(testCase.requirements),
        `case ${testCase.id}: ${testCase.expectedStatus} cases must still declare a requirements array (possibly empty)`,
      );
      assert.ok(
        testCase.answerNotes.length > 0,
        `case ${testCase.id}: ${testCase.expectedStatus} cases must explain the unknown in answerNotes`,
      );
    }
  }
});

test('fresh-authored cases do not outnumber or re-label the existing diagnostics', () => {
  const existing = data.cases.filter((testCase) => testCase.origin === 'existing-diagnostic');
  const fresh = data.cases.filter((testCase) => testCase.origin === 'fresh-authored-diagnostic');
  assert.ok(existing.length > 0, 'the retained existing query diagnostics must stay present');
  assert.ok(fresh.length > 0, 'fresh-authored diagnostics must be present');
  assert.equal(
    data.cases.length,
    existing.length + fresh.length,
    'every case must carry one of the two diagnostic origins',
  );
});
