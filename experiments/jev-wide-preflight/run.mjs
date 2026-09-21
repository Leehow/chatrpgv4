/** PROTOTYPE: live per-query Jev fan-out over a frozen original-text corpus. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {MODEL, sha256, bytes, requestFor, packQuery, mapConcurrent, validateResponse, rankResults, materialPacket, evaluatePacket, percentile} from './core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const args = process.argv.slice(2);
const allowed = new Set(['--describe', '--case', '--concurrency', '--repeat', '--corpus', '--cases', '--out', '--help']);
const options = {};
for (let i = 0; i < args.length; i++) {
  const flag = args[i];
  if (!allowed.has(flag)) throw new Error(`Unknown option: ${flag}`);
  options[flag] = ['--describe', '--help'].includes(flag) ? true : args[++i];
  if (options[flag] === undefined) throw new Error(`Missing value: ${flag}`);
}
if (options['--help']) {
  console.log('node experiments/jev-wide-preflight/run.mjs [--describe] [--case id] [--concurrency 1,4,16] [--repeat 1] [--corpus path] [--cases path] [--out directory]\nLive mode requires TYPESAFE_API_KEY in the process environment. No key is written. No decision cache or retry is used.');
  process.exit(0);
}
const corpusPath = path.resolve(options['--corpus'] ?? process.env.JEV_PREFLIGHT_CORPUS ?? path.join(ROOT, '.pi/prototypes/jev-pdf-routing-20260919/corpus.json'));
const casesPath = path.resolve(options['--cases'] ?? path.join(HERE, 'cases.json'));
const corpusBytes = await fs.readFile(corpusPath);
const corpus = JSON.parse(corpusBytes);
const caseBytes = await fs.readFile(casesPath);
const dataset = JSON.parse(caseBytes);
if (dataset.source_sha256 !== corpus.sha256 || dataset.corpus_sha256 !== sha256(corpusBytes)) throw new Error('The corpus does not match the frozen evaluation source');
if (!Array.isArray(corpus.pages) || corpus.pages.some(page => !Number.isSafeInteger(page.page) || page.page < 1 || typeof page.text !== 'string')
  || new Set(corpus.pages.map(page => page.page)).size !== corpus.pages.length) throw new Error('Invalid source page catalog');
if (!Array.isArray(dataset.cases) || dataset.cases.some(item => !/^[a-z][a-z0-9_-]{0,63}$/.test(item.id)
  || typeof item.query !== 'string' || typeof item.context !== 'string' || !Array.isArray(item.requirements))
  || new Set(dataset.cases.map(item => item.id)).size !== dataset.cases.length) throw new Error('Invalid case catalog');
const cases = dataset.cases.filter(item => !options['--case'] || item.id === options['--case']);
if (!cases.length) throw new Error('No matching case');
const concurrency = String(options['--concurrency'] ?? '1,4,16').split(',').map(Number);
if (!concurrency.length || concurrency.some(value => !Number.isInteger(value) || value < 1 || value > 16) || new Set(concurrency).size !== concurrency.length) throw new Error('Provide distinct concurrency values from 1 to 16');
const repeats = Number(options['--repeat'] ?? 1);
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 5) throw new Error('Repeat must be between 1 and 5');
const plans = cases.map(item => ({item, ...packQuery(item, corpus)}));
const manifest = {
  version: 1, prototype: true, acceptance: false, model: MODEL,
  source_sha256: corpus.sha256, corpus_sha256: sha256(corpusBytes), cases_sha256: sha256(caseBytes),
  runner_sha256: sha256(await fs.readFile(fileURLToPath(import.meta.url))),
  policy_sha256: sha256(await fs.readFile(path.join(HERE, 'core.mjs'))),
  concurrency, repeats, request_byte_bound: 30_000, packet_byte_bound: 65_536,
  question_policy: 'Two independent per-page Nouls: direct partial-answer support and useful context. Rank by direct probability, then context; no semantic prefilter and no universal confidence cutoff.',
  conditions: 'Each case independently scans the corpus. Cases and arms run serially; requests inside an arm use the named concurrency. Arm order rotates by case and repeat. No local decision cache; provider-internal cache state is unknown. No retry hides failed requests.',
  expectations_sent: false,
  price_basis: {input_usd_per_million_tokens: 0.042, output_usd_per_million_tokens: 0, source: 'https://docs.typesafe.ai/models', checked_at: '2026-09-21'},
  timeout_policy: '30 seconds per request; identical arm allowance of (group count + 1) * 30 seconds, enough for serial attempts without systematically censoring low concurrency.',
  reader_probe: {
    cases: ['clinic_zh', 'heat_water_rules', 'unsupported_mri'],
    repeat: 1, concurrency: 16, top_k: 10,
    arms: ['catalog-only', 'preflight-packet-plus-catalog'],
    selection: 'Fixed before live responses; unavailable cases/arms are skipped explicitly, never replaced by a better outcome.',
    model: 'grok-build/grok-4.6',
    limits: 'Matched cold tool-enabled source-answering agents, not production Keeper turns. Actual tool transcripts and answer quality must be checked.',
  },
  cases: plans.map(({item, groups, sparsePages}) => ({id: item.id, origin: item.origin, groups: groups.map(group => group.map(page => page.page)), sparse_pages: sparsePages, questions: groups.flat().length * 2})),
  total_requests: plans.reduce((sum, plan) => sum + plan.groups.length, 0) * concurrency.length * repeats,
};
if (options['--describe']) {
  console.log(JSON.stringify({...manifest, mode: 'offline-description', provider_calls: 0}, null, 2));
  process.exit(0);
}
if (!process.env.TYPESAFE_API_KEY) throw new Error('Live measurement requires TYPESAFE_API_KEY mounted into this process; no requests were sent.');
const outputRoot = path.resolve(options['--out'] ?? path.join(ROOT, '.pi/prototypes/jev-wide-preflight-20260921/runs'));
await fs.mkdir(outputRoot, {recursive: true});
const runDir = await fs.mkdtemp(path.join(outputRoot, `${new Date().toISOString().replaceAll(':', '-')}-`));
const save = (name, value) => fs.writeFile(path.join(runDir, name), JSON.stringify(value, null, 2) + '\n');
await save('manifest.json', {...manifest, began_at: new Date().toISOString()});
await save('evaluation-only-cases.json', dataset);
await fs.mkdir(path.join(runDir, 'source-pages'));
for (const page of corpus.pages) await fs.writeFile(path.join(runDir, 'source-pages', `page-${String(page.page).padStart(4, '0')}.txt`), page.text);
await save('material-index.json', {source_sha256: corpus.sha256, pages: corpus.pages.map(page => ({physical_page: page.page, file: `source-pages/page-${String(page.page).padStart(4, '0')}.txt`, preview: page.text.slice(0, 240), native_text_characters: page.text.length}))});

async function ask(request, name, signal) {
  await save(`${name}-request.json`, request);
  const started = performance.now();
  let result;
  try {
    const response = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST', headers: {Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`, 'Content-Type': 'application/json'},
      body: JSON.stringify(request), signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    });
    result = response.ok ? {ok: true, status: response.status, body: await response.json()} : {ok: false, status: response.status};
    if (result.ok) {
      const failure = validateResponse(request, result.body);
      if (failure) result = {...result, ok: false, protocol_error: failure};
    }
  } catch (error) {
    result = {ok: false, error: error.name, ...(error instanceof SyntaxError ? {protocol_error: 'invalid_response_json'} : {})};
  }
  result.ms = Math.round(performance.now() - started);
  result.request_bytes = bytes(request);
  result.questions = Object.keys(request.questions).length;
  await save(`${name}-response.json`, result);
  console.log(JSON.stringify({request: name, ok: result.ok, status: result.status, ms: result.ms, questions: result.questions}));
  return result;
}

const arms = [];
let stoppedForProtocol = false;
experiments: for (let repeat = 0; repeat < repeats; repeat++) {
  for (let caseIndex = 0; caseIndex < plans.length; caseIndex++) {
    const {item, groups, sparsePages} = plans[caseIndex];
    const shift = (caseIndex + repeat) % concurrency.length;
    const order = [...concurrency.slice(shift), ...concurrency.slice(0, shift)];
    for (const width of order) {
      const name = `${item.id}-r${repeat + 1}-c${width}`;
      const started = performance.now();
      const armDeadlineMs = (groups.length + 1) * 30_000;
      const signal = AbortSignal.timeout(armDeadlineMs);
      const results = await mapConcurrent(groups, width, (pages, index) => ask(requestFor(item, pages), `${name}-g${index + 1}`, signal));
      const selectionMs = Math.round(performance.now() - started);
      const ranking = rankResults(groups, results);
      const primaryPacket = materialPacket(item, corpus, ranking, sparsePages, 10);
      const materialReadyMs = Math.round(performance.now() - started);
      const evaluations = [];
      for (const topK of [5, 10, 15]) {
        const packet = topK === 10 ? primaryPacket : materialPacket(item, corpus, ranking, sparsePages, topK);
        await save(`${name}-top${topK}-packet.json`, packet);
        evaluations.push(evaluatePacket(item, packet));
      }
      const validUsage = value => Number.isSafeInteger(value) && value >= 0;
      const inputTokens = results.reduce((sum, result) => sum + (validUsage(result.body?.usage?.input_tokens) ? result.body.usage.input_tokens : 0), 0);
      const outputTokens = results.reduce((sum, result) => sum + (validUsage(result.body?.usage?.output_tokens) ? result.body.usage.output_tokens : 0), 0);
      const usageIncomplete = results.some(result => !validUsage(result.body?.usage?.input_tokens) || !validUsage(result.body?.usage?.output_tokens));
      const protocolFailures = results.filter(result => result.protocol_error).length;
      const arm = {
        case_id: item.id, origin: item.origin, repeat: repeat + 1, concurrency: width,
        selection_wall_ms: selectionMs, material_ready_wall_ms: materialReadyMs,
        timing_scope: 'Through in-memory top10 packet readiness, including request/response evidence recording but excluding packet/evaluation output writes.',
        arm_deadline_ms: armDeadlineMs,
        measurement_status: protocolFailures ? 'invalid_protocol' : ranking.unknownPages.length ? 'partial_transport_or_answers' : 'complete_native_sweep',
        requests: results.length, failed_requests: results.filter(result => !result.ok).length, protocol_failures: protocolFailures,
        attempt_p50_ms: percentile(results.map(result => result.ms), 0.5), attempt_p95_ms: percentile(results.map(result => result.ms), 0.95),
        successful_request_p50_ms: percentile(results.filter(result => result.ok).map(result => result.ms), 0.5),
        successful_request_p95_ms: percentile(results.filter(result => result.ok).map(result => result.ms), 0.95),
        questions: results.reduce((sum, result) => sum + result.questions, 0),
        reported_input_tokens: inputTokens, reported_output_tokens: outputTokens,
        estimated_jev_cost_usd: usageIncomplete ? null : inputTokens * 0.042 / 1_000_000,
        known_usage_cost_estimate_usd: inputTokens * 0.042 / 1_000_000, usage_incomplete: usageIncomplete,
        returned_models: [...new Set(results.map(result => result.body?.model).filter(Boolean))],
        ranking, sparse_pages: sparsePages, evaluations,
        writer_evaluated: false, actual_supplement_reads: null, complete_turn_latency_ms: null,
      };
      arms.push(arm);
      await save(`${name}-metrics.json`, arm);
      await save('summary.json', {prototype: true, acceptance: false, arms, limits: ['Static component retrieval experiment, not gameplay.', 'Gold page coverage is not an actual writer sufficiency result.', 'No LLM-only claim or whole-turn speedup is established by this runner.', 'Sparse/image pages remain unreviewed.', 'Cost is estimated, not a billed receipt.']});
      console.log(JSON.stringify({arm: name, status: arm.measurement_status, ms: arm.material_ready_wall_ms, failed_requests: arm.failed_requests, coverage: evaluations.map(value => ({top_k: value.top_k, covered: value.supplied_required_items, total: value.required_items}))}));
      if (protocolFailures) {
        stoppedForProtocol = true;
        await save('stopped.json', {reason: 'invalid_provider_response_schema', arm: name, remaining_arms_not_run: true, semantic_verdict: null});
        break experiments;
      }
    }
  }
}
await fs.writeFile(path.join(runDir, 'reader-probe-instructions.md'), `# Isolated material sufficiency probe\n\nThis is a static source-answering experiment, not a Keeper, campaign, or gameplay turn. Use a tool-enabled Pi agent. Do not read evaluation-only-cases.json, metrics, summary, or the other arms. The dispatcher selects one case and a top10 packet before reading outcomes; do not cherry-pick a passing arm.\n\nRead only that packet first. Answer its query from exact supplied sources, preserving unsupported claims and native-text limits. You may ignore incorrect suggestions. If genuinely needed, inspect material-index.json and read additional source-pages/page-NNNN.txt files. Never claim to have inspected an image. Write a short answer and an evidence report: used pages, missing facts, and which additional pages you actually read. The dispatcher must verify supplemental reads against the real tool transcript, not rely on self-reported counts. Do not use web search, outside model knowledge, or future gameplay receipts to fill gaps.\n\nCompare with a separate cold agent given the same query/context plus material-index.json but no preselected packet. Keep model, tools and limits identical. Report this as an authored static query, not a genuine player turn.\n`);
console.log(JSON.stringify({run_directory: runDir, arms: arms.length, writer_evaluated: false, stopped_for_protocol: stoppedForProtocol}));
if (stoppedForProtocol || arms.some(arm => arm.measurement_status !== 'complete_native_sweep')) process.exitCode = 1;
