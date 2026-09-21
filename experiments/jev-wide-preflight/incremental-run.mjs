/** PROTOTYPE: real Jev decisions over controlled current-context conditions. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {MODEL, sha256, bytes} from './core.mjs';
import {CONDITIONS, REQUEST_BYTES, scenarioFor, gateRequest, packDelta, runIncremental, validateChoices} from './incremental-core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '../..');
const opts = {};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  if (!['--describe', '--case', '--condition', '--repeat', '--concurrency', '--corpus', '--cases', '--out'].includes(key)) throw new Error(`Unknown option ${key}`);
  opts[key] = key === '--describe' ? true : process.argv[++i];
  if (opts[key] === undefined) throw new Error(`Missing option ${key}`);
}
const corpusPath = path.resolve(opts['--corpus'] ?? process.env.JEV_PREFLIGHT_CORPUS ?? path.join(ROOT, '.pi/prototypes/jev-pdf-routing-20260919/corpus.json'));
const sourceBytes = await fs.readFile(corpusPath), corpus = JSON.parse(sourceBytes);
const caseBytes = await fs.readFile(path.resolve(opts['--cases'] ?? path.join(HERE, 'incremental-cases.json'))), dataset = JSON.parse(caseBytes);
if (dataset.version !== 2 || dataset.source_sha256 !== corpus.sha256 || dataset.corpus_sha256 !== sha256(sourceBytes)) throw new Error('Frozen source binding or case version mismatch');
const cases = dataset.cases.filter(query => !opts['--case'] || query.id === opts['--case']);
const conditions = opts['--condition'] ? [opts['--condition']] : CONDITIONS;
const repeats = Number(opts['--repeat'] ?? 2), concurrency = Number(opts['--concurrency'] ?? 16);
if (!cases.length || conditions.some(condition => !CONDITIONS.includes(condition))) throw new Error('Unknown case or condition');
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 3 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error('Invalid repeat or concurrency bound');
if (cases.some(query => !/^[a-z][a-z0-9_-]{0,63}$/.test(query.id) || typeof query.query !== 'string' || typeof query.context !== 'string' || !query.requirements?.length)) throw new Error('Invalid query schema');
const inventory = cases.flatMap(query => conditions.map(condition => {
  const scenario = scenarioFor(query, corpus, condition);
  return {case_id: query.id, condition, gate_bytes: bytes(gateRequest(query, scenario, corpus)), potential_delta_groups: packDelta(query, scenario, corpus).groups.length};
}));
const manifest = {
  version: 2, prototype: true, acceptance: false, model: MODEL, concurrency, repeats,
  conditions, source_sha256: corpus.sha256, corpus_sha256: sha256(sourceBytes), cases_sha256: sha256(caseBytes),
  runner_sha256: sha256(await fs.readFile(fileURLToPath(import.meta.url))), policy_sha256: sha256(await fs.readFile(path.join(HERE, 'incremental-core.mjs'))),
  request_byte_bound: REQUEST_BYTES, expectations_sent: false, fixed_top_k: null,
  policy: 'Gate current factual coverage and consistency first. Only sufficient+clear skips retrieval. Missing evidence triggers wide per-page delta Choice. Exact reference subtraction removes repeated source ranges. Recheck actual combined context before ready. No probability threshold or label tuning.',
  fixture_interventions: 'Partial multi-page cases withhold the sorted middle required page; single-page cases retain only first-requirement exact spans. Full and conflict have matched English unverified claims about the same fact, differing only in the relevant factual value or condition. Stale revision filtering and exact byte deduplication are host guarantees, not semantic accuracy.',
  measurement_limits: 'Repeated authored diagnostic questions over one corpus. No writer, game turn or production rollout. Gold ranges define controlled interventions and grading, never request instructions or expected decisions.',
  price_basis: {input_usd_per_million_tokens: 0.042, source: 'https://docs.typesafe.ai/models', checked_at: '2026-09-21'},
  inventory,
};
if (opts['--describe']) {console.log(JSON.stringify({...manifest, provider_calls: 0}, null, 2)); process.exit(0);}
if (!process.env.TYPESAFE_API_KEY) throw new Error('TYPESAFE_API_KEY must be securely mounted; no request was sent');
const outputRoot = path.resolve(opts['--out'] ?? path.join(ROOT, '.pi/prototypes/jev-incremental-preflight-20260921/runs'));
await fs.mkdir(outputRoot, {recursive: true});
const dir = await fs.mkdtemp(path.join(outputRoot, `${new Date().toISOString().replaceAll(':', '-')}-`));
const save = (name, value) => fs.writeFile(path.join(dir, name), JSON.stringify(value, null, 2) + '\n');
await save('manifest.json', {...manifest, began_at: new Date().toISOString()});
await save('evaluation-only-cases.json', dataset);
const records = [], requests = [];
let stopped = false, stopReason = null;
experiments: for (let repeat = 0; repeat < repeats; repeat++) {
  for (let index = 0; index < cases.length; index++) {
    const query = cases[index], shift = (index + repeat) % conditions.length;
    for (const condition of [...conditions.slice(shift), ...conditions.slice(0, shift)]) {
      const name = `${query.id}-${condition}-r${repeat + 1}`, scenario = scenarioFor(query, corpus, condition), calls = [];
      await save(`${name}-context-fixture.json`, scenario);
      const decide = async (request, label) => {
        if (bytes(request) > REQUEST_BYTES) throw new Error('Request exceeds frozen byte bound');
        const tag = `${name}-${label}`;
        await save(`${tag}-request.json`, request);
        const began = performance.now(); let result;
        try {
          const response = await fetch('https://api.typesafe.ai/v1/systemone', {method: 'POST',
            headers: {Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`, 'Content-Type': 'application/json'},
            body: JSON.stringify(request), signal: AbortSignal.timeout(30_000)});
          result = response.ok ? {ok: true, status: response.status, body: await response.json()}
            : {ok: false, status: response.status, retry_after: response.headers.get('retry-after'), error_body: (await response.text()).replaceAll(process.env.TYPESAFE_API_KEY, '[redacted]').slice(0, 4096)};
          if (result.ok) {const issue = validateChoices(request, result.body); if (issue) result = {...result, ok: false, protocol_error: issue};}
        } catch (error) {result = {ok: false, error: error.name, ...(error instanceof SyntaxError ? {protocol_error: 'invalid_json'} : {})};}
        result.ms = Math.round(performance.now() - began);
        result.label = tag; result.questions = Object.keys(request.questions).length;
        await save(`${tag}-response.json`, result);
        calls.push(result); requests.push(result);
        console.log(JSON.stringify({request: tag, ok: result.ok, status: result.status, ms: result.ms, questions: result.questions}));
        return result;
      };
      const result = await runIncremental(query, scenario, corpus, decide, concurrency);
      const validUsage = value => Number.isSafeInteger(value) && value >= 0;
      const usageMissing = calls.some(call => !validUsage(call.body?.usage?.input_tokens));
      const input = calls.reduce((sum, call) => sum + (validUsage(call.body?.usage?.input_tokens) ? call.body.usage.input_tokens : 0), 0);
      const record = {...result, repeat: repeat + 1, requests: calls.length, failed_requests: calls.filter(call => !call.ok).length,
        protocol_failures: calls.filter(call => call.protocol_error).length, questions: calls.reduce((sum, call) => sum + call.questions, 0),
        reported_input_tokens: input, usage_incomplete: usageMissing, estimated_cost_usd: usageMissing ? null : input * 0.042 / 1_000_000,
        returned_models: [...new Set(calls.map(call => call.body?.model).filter(Boolean))]};
      records.push(record);
      await save(`${name}-result.json`, record);
      await save('summary.json', {prototype: true, acceptance: false, records});
      console.log(JSON.stringify({case: query.id, condition, repeat: repeat + 1, outcome: result.outcome, added_pages: result.selected_pages, added_bytes: result.added_text_bytes, final_false_ready: result.final_false_ready, missing: result.final_requirements.filter(value => !value.covered).map(value => value.id), ms: result.wall_ms}));
      if (record.failed_requests) {stopped = true; stopReason = record.protocol_failures ? 'invalid_protocol' : 'provider_unavailable'; break experiments;}
    }
  }
}
await save('completion.json', {records: records.length, requests: requests.length, stopped, stop_reason: stopReason, semantic_pass_not_assumed: true, completed_at: new Date().toISOString()});
console.log(JSON.stringify({run_directory: dir, records: records.length, requests: requests.length, stopped, stop_reason: stopReason}));
if (stopped || requests.some(request => !request.ok)) process.exitCode = 1;
