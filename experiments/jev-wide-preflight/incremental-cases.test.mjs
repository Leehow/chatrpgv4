// Mechanical fixture checks only: schema, bindings, page references, and exact
// unique spans. These tests do not judge semantic completeness, the meaning of
// a contradiction, or any model's retrieval quality. No runner or API is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const corpusPath = process.env.JEV_PREFLIGHT_CORPUS ?? new URL(
  '../../.pi/prototypes/jev-pdf-routing-20260919/corpus.json', import.meta.url,
);
const rawCorpus = readFileSync(corpusPath);
const corpus = JSON.parse(rawCorpus);
const data = JSON.parse(readFileSync(new URL('./incremental-cases.json', import.meta.url), 'utf8'));
const expectedIds = [
  'clinic_hours', 'injection_rules', 'heat_water_rules',
  'chase_hunt_settlement', 'cult_spells_eye', 'mine_radiation_rules',
];
const origins = new Set(['existing-diagnostic', 'fresh-authored-diagnostic']);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function text(value, label) {
  assert.ok(typeof value === 'string' && value.trim().length > 0, `${label}: nonempty string required`);
}

function keys(value, expected, label) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label}: object required`);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label}: unexpected schema fields`);
}

function unique(values, label) {
  assert.equal(new Set(values).size, values.length, `${label}: duplicate value`);
}

function pages(value, label) {
  assert.ok(Array.isArray(value) && value.length > 0, `${label}: nonempty page array required`);
  for (const page of value) assert.ok(Number.isInteger(page) && page > 0, `${label}: positive integer required`);
  unique(value, label);
}

function validateBindings(fixture, bytes) {
  const source = JSON.parse(bytes);
  assert.match(fixture.source_sha256, /^[a-f0-9]{64}$/, 'source hash format');
  assert.match(fixture.corpus_sha256, /^[a-f0-9]{64}$/, 'corpus hash format');
  assert.equal(fixture.source_sha256, source.sha256, 'source binding must match corpus.sha256');
  assert.equal(fixture.corpus_sha256, digest(bytes), 'corpus binding must match raw file bytes');
}

function validateSchema(fixture) {
  keys(fixture, ['version', 'source_sha256', 'corpus_sha256', 'cases'], 'fixture');
  assert.equal(fixture.version, 2);
  assert.ok(Array.isArray(fixture.cases));
  assert.equal(fixture.cases.length, 6, 'exactly six incremental cases required');
  unique(fixture.cases.map((entry) => entry.id), 'case ids');
  assert.deepEqual(fixture.cases.map((entry) => entry.id).sort(), [...expectedIds].sort());
  for (const entry of fixture.cases) {
    keys(entry, [
      'id', 'query', 'context', 'origin', 'requirements',
      'topicSummary', 'consistentNote', 'conflictingNote', 'refinementNotes',
    ], entry.id);
    for (const field of ['id', 'query', 'context', 'topicSummary', 'consistentNote', 'conflictingNote']) {
      text(entry[field], `${entry.id}.${field}`);
    }
    assert.ok(origins.has(entry.origin), `${entry.id}: diagnostic provenance required`);
    assert.ok(Array.isArray(entry.refinementNotes) && entry.refinementNotes.length > 0);
    for (const note of entry.refinementNotes) text(note, `${entry.id}.refinementNotes`);
    assert.ok(Array.isArray(entry.requirements) && entry.requirements.length >= 2,
      `${entry.id}: at least two requirements required`);
    unique(entry.requirements.map((requirement) => requirement.id), `${entry.id} requirement ids`);
    for (const requirement of entry.requirements) {
      const label = `${entry.id}/${requirement.id}`;
      keys(requirement, ['id', 'description', 'anyOfPages', 'evidence'], label);
      text(requirement.id, `${label}.id`);
      text(requirement.description, `${label}.description`);
      pages(requirement.anyOfPages, `${label}.anyOfPages`);
      assert.ok(Array.isArray(requirement.evidence) && requirement.evidence.length > 0,
        `${label}: nonempty evidence array required`);
      for (const evidence of requirement.evidence) {
        keys(evidence, ['page', 'quote'], `${label}.evidence`);
        assert.ok(Number.isInteger(evidence.page) && evidence.page > 0, `${label}: positive evidence page required`);
        text(evidence.quote, `${label}.quote`);
      }
    }
  }
}

function validateEvidence(fixture, source) {
  const pageTexts = new Map(source.pages.map((page) => [page.page, page.text]));
  assert.equal(pageTexts.size, source.pages.length, 'corpus page ids must be unique');
  for (const entry of fixture.cases) {
    for (const requirement of entry.requirements) {
      const label = `${entry.id}/${requirement.id}`;
      for (const page of requirement.anyOfPages) {
        assert.ok(pageTexts.has(page), `${label}: page ${page} missing from corpus`);
        assert.ok(requirement.evidence.some((item) => item.page === page),
          `${label}: each alternative page needs source evidence`);
      }
      const seen = new Set();
      for (const evidence of requirement.evidence) {
        assert.ok(requirement.anyOfPages.includes(evidence.page), `${label}: evidence page not in anyOfPages`);
        const sourceText = pageTexts.get(evidence.page);
        assert.equal(typeof sourceText, 'string', `${label}: page text missing`);
        const start = sourceText.indexOf(evidence.quote);
        assert.ok(start >= 0, `${label}: quote is not an exact source span on page ${evidence.page}`);
        assert.equal(sourceText.indexOf(evidence.quote, start + 1), -1,
          `${label}: quote is not unique on page ${evidence.page}`);
        const end = start + evidence.quote.length;
        assert.equal(sourceText.slice(start, end), evidence.quote, `${label}: span round trip failed`);
        const spanKey = `${evidence.page}:${start}:${end}`;
        assert.ok(!seen.has(spanKey), `${label}: duplicate evidence span`);
        seen.add(spanKey);
      }
    }
  }
}

function validateAuthoredNotes(fixture, source) {
  // Whitespace folding is literal comparison only, not a semantic classifier.
  const fold = (value) => value.replace(/\s+/gu, ' ').trim();
  const nativeTexts = source.pages.map((page) => fold(page.text));
  for (const entry of fixture.cases) {
    assert.notEqual(entry.topicSummary, entry.conflictingNote, `${entry.id}: summary and assertion must differ`);
    assert.notEqual(entry.consistentNote, entry.conflictingNote, `${entry.id}: paired claims must differ`);
    for (const field of ['topicSummary', 'consistentNote', 'conflictingNote']) {
      text(entry[field], `${entry.id}.${field}`);
      assert.ok(!nativeTexts.some((native) => native.includes(fold(entry[field]))),
        `${entry.id}.${field}: authored fixture text must not be copied source text`);
    }
  }
}

test('mechanical schema: six named diagnostics with multiple requirements', () => validateSchema(data));
test('mechanical binding: original source hash and exact corpus file bytes', () => validateBindings(data, rawCorpus));
test('mechanical evidence: existing pages and unique exact start/end spans', () => validateEvidence(data, corpus));
test('mechanical provenance: summaries and conflicting notes are not source quotations', () => validateAuthoredNotes(data, corpus));

test('binding guard rejects changed raw bytes and mismatched source identity', () => {
  // Adding whitespace preserves the parsed corpus but changes its byte identity.
  assert.throws(() => validateBindings(data, Buffer.concat([rawCorpus, Buffer.from('\n')])), /corpus binding/);
  const changed = structuredClone(data);
  changed.source_sha256 = '0'.repeat(64);
  assert.throws(() => validateBindings(changed, rawCorpus), /source binding/);
});

test('schema guard rejects duplicate ids and omitted required fields', () => {
  const duplicateCase = structuredClone(data);
  duplicateCase.cases[1].id = duplicateCase.cases[0].id;
  assert.throws(() => validateSchema(duplicateCase), /case ids: duplicate/);
  const duplicateRequirement = structuredClone(data);
  duplicateRequirement.cases[0].requirements[1].id = duplicateRequirement.cases[0].requirements[0].id;
  assert.throws(() => validateSchema(duplicateRequirement), /requirement ids: duplicate/);
  const missing = structuredClone(data);
  delete missing.cases[0].topicSummary;
  assert.throws(() => validateSchema(missing), /unexpected schema fields/);
});

test('evidence guard rejects missing pages, disallowed pages, altered quotes, and ambiguous spans', () => {
  const missingPage = structuredClone(data);
  missingPage.cases[0].requirements[0].anyOfPages = [9999];
  assert.throws(() => validateEvidence(missingPage, corpus), /missing from corpus/);
  const disallowedPage = structuredClone(data);
  disallowedPage.cases[0].requirements[0].evidence[0].page = 84;
  assert.throws(() => validateEvidence(disallowedPage, corpus), /not in anyOfPages/);
  const alteredQuote = structuredClone(data);
  alteredQuote.cases[0].requirements[0].evidence[0].quote = 'A quotation absent from the native page.';
  assert.throws(() => validateEvidence(alteredQuote, corpus), /not an exact source span/);
  const ambiguousCorpus = structuredClone(corpus);
  const evidence = data.cases[0].requirements[0].evidence[0];
  ambiguousCorpus.pages.find((page) => page.page === evidence.page).text += `\n${evidence.quote}`;
  assert.throws(() => validateEvidence(data, ambiguousCorpus), /not unique on page/);
});

test('authored-text guard rejects a native quotation used as summary or conflicting note', () => {
  for (const field of ['topicSummary', 'consistentNote', 'conflictingNote']) {
    const copied = structuredClone(data);
    copied.cases[0][field] = copied.cases[0].requirements[0].evidence[0].quote;
    assert.throws(() => validateAuthoredNotes(copied, corpus), /copied source text/);
  }
});
