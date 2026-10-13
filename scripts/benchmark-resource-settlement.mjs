/** Same-checkout, same-host native RPC/direct A/B measurement; run without another local suite. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { hostname, loadavg, platform, cpus } from 'node:os';
import { resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const destination = process.argv[2];
if (!destination) throw new Error('Usage: node scripts/benchmark-resource-settlement.mjs <new-report-directory>');
const out = resolve(destination);
mkdirSync(out, { recursive: false });
const files = ['tests/kernel/test_apply_time_healing.py', 'tests/kernel/test_apply_time_mp.py'];
const full=JSON.parse(readFileSync(join(root,'tests/ts-migration-manifest.json'),'utf8'));
assert.equal(full.complete,true,'Complete native validation is required before benchmarking the retired controller');
const originalCases=files.flatMap(source=>{
  const original=full.files.find(file=>file.source===source);assert.ok(original,source);
  return original.cases.map(entry=>{
    assert.equal(entry.status,'validated',`${source}::${entry.name}`);assert.ok(entry.counterpart?.file&&entry.counterpart?.name,entry.name);
    assert.equal(createHash('sha256').update(readFileSync(join(root,entry.counterpart.file))).digest('hex'),entry.counterpart.sha256,entry.name);
    return {source,name:entry.name,parameters:entry.parameters,...entry.counterpart};
  });
});
assert.equal(originalCases.length,12);
const nativeFiles=[...new Set(originalCases.map(entry=>entry.file))];
const escape=name=>name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const nativePattern=`^(?:${originalCases.map(entry=>escape(entry.name)).join('|')})(?:\\s*\\[.*\\])?$`;
const hashes = () => Object.fromEntries(files.map(path => [path,
  createHash('sha256').update(readFileSync(join(root, path))).digest('hex')]));
const pilotHashes = () => Object.fromEntries(['build/kernel/rpc.mjs', 'kernel-ts/testing/resource-settlement.ts',
  'tests/extension/resource-settlement-support.mjs', 'tests/extension/resource-settlement.test.mjs',
  'scripts/benchmark-resource-settlement.mjs','tests/ts-migration-manifest.json',...nativeFiles].map(path => [path,
  createHash('sha256').update(readFileSync(join(root, path))).digest('hex')]));
const command = (program, args) => spawnSync(program, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 << 20 });
const git = args => { const result = command('git', args); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
function otherSuites() {
  const processes = command('ps', [platform() === 'darwin' ? '-U' : '-u', String(process.getuid()), '-o', 'pid=,args=']);
  assert.equal(processes.status, 0, processes.stderr);
  return processes.stdout.split('\n').filter(line => /\bnode\s+(?:--test\b|scripts\/test-(?:integration|storage))/.test(line));
}
const storage = platform() === 'linux' ? 'hybrid' : 'disk';
const sourceDigest = () => createHash('sha256').update(git(['diff', '--binary', 'HEAD'])).digest('hex');
const report = { host: hostname(), platform: platform(), cpu: cpus()[0]?.model, node: process.version,
  head: git(['rev-parse', 'HEAD']), diffSha256: sourceDigest(), originalTestHashes: hashes(),
  pilotHashes: pilotHashes(),
  controller: 'node:test', baselineImplementation:'native TypeScript RPC counterparts',baselineChangedFromHistoricalPython:true,nativeSources:originalCases,
  started: new Date().toISOString(), concurrency: 1, runs: [],
  environment: { storage, kernelPool: false, kernel: 'kernel-ts/rpc.ts bundled by native integration support', directPrecompiledOverride: false },
  scope: 'The same12 resource cases; native RPC storage runner versus direct TS, including startup and TS compilation; runtime build excluded' };
const save = () => writeFileSync(join(out, 'comparison.json'), JSON.stringify(report, null, 2) + '\n');
save();
try {
  // Both cold starts are retained. Reversing subsequent pair order limits ordering bias.
  for (const [index, kinds] of [['cold', ['rpc', 'direct']], ['1', ['rpc', 'direct']], ['2', ['direct', 'rpc']], ['3', ['rpc', 'direct']]]) {
    for (const kind of kinds) {
      assert.deepEqual(otherSuites(), [], 'Another suite is active; do not benchmark a contested box');
      const args = kind === 'rpc'
        ? ['scripts/test-integration-ts.mjs','--test-reporter=tap','--test-reporter-destination=stdout',`--test-name-pattern=${nativePattern}`,...nativeFiles]
        : ['--test', '--test-concurrency=1', '--test-reporter=tap', 'tests/extension/resource-settlement.test.mjs'];
      const program = process.execPath;
      const before = loadavg(), started = performance.now();
      const result = spawnSync(program, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 << 20,
        env: { ...process.env, COC_TEST_STORAGE_MODE: storage,COC_TS_TEST_CONCURRENCY:'1',
          COC_TEST_NODE: process.execPath,  COC_RESOURCE_PILOT_API: '',
          COC_TEST_KERNEL_CMD: JSON.stringify([process.execPath, join(root, 'build/kernel/rpc.mjs')]) } });
      const seconds = (performance.now() - started) / 1000;
      const log = `${kind}-${index}.log`;
      writeFileSync(join(out, log), result.stdout + '\n' + result.stderr);
      const other = otherSuites();
      report.runs.push({ kind, sample: index, program, args, seconds, exit: result.status, signal: result.signal,
        loadBefore: before, loadAfter: loadavg(), otherSuitesAfter: other, log });
      save();
      assert.equal(result.status, 0, `Failed ${log}: ${result.stderr}`);
      assert.deepEqual(other, [], 'Another suite overlapped the sample');
      assert.match(result.stdout, /# tests 12\b/);
      assert.match(result.stdout, /# pass 12\b/);
      assert.match(result.stdout, /# fail 0\b/);
      assert.match(result.stdout, /# skipped 0\b/);
      console.log(`${kind} ${index}: ${seconds.toFixed(3)}s, exit ${result.status}`);
    }
  }
  assert.deepEqual(hashes(), report.originalTestHashes);
  assert.deepEqual(pilotHashes(), report.pilotHashes);
  assert.equal(sourceDigest(), report.diffSha256);
  const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const times = kind => report.runs.filter(row => row.kind === kind && row.sample !== 'cold').map(row => row.seconds);
  const rpc = median(times('rpc')), direct = median(times('direct'));
  report.summary = { rpcMedianSeconds: rpc, directMedianSeconds: direct, speedup: rpc / direct,
    reductionPercent: (1 - direct / rpc) * 100, originalTestsUnchanged: true };
  console.log(JSON.stringify(report.summary));
  // Mutate compiled artifacts only. Neither the checkout nor the Python oracle is edited.
  symlinkSync(join(root, 'node_modules'), join(out, 'node_modules'), 'dir');
  report.mutations = [];
  const mutations = [
    { name: 'eight-hour-day', file: 'kernel-ts/healing/session.ts',
      from: 'DAY_MINUTES = 24 * 60', to: 'DAY_MINUTES = 8 * 60',
      test: 'test_a_day_of_rest_is_one_hit_point_not_three' },
    { name: 'rounded-mp', file: 'kernel-ts/healing/mp.ts',
      from: 'wholeHours = Math.floor(total / 60)', to: 'wholeHours = Math.round(total / 60)',
      test: 'test_apply_time_ninety_minutes_grants_one_point_not_a_rounded_two' },
    { name: 'stale-sheet-conditions', file: 'kernel-ts/healing/resources.ts',
      from: 'await mirrorInvestigator(context, id, { conditions: healed });', to: 'void healed;',
      test: 'test_healing_clears_the_sheet_and_a_healed_wound_does_not_come_back' },
  ];
  for (const mutation of mutations) {
    assert.deepEqual(otherSuites(), [], 'Another suite is active before mutation validation');
    const output = join(out, `${mutation.name}.mjs`);
    let applied = 0;
    await build({ entryPoints: [join(root, 'kernel-ts/testing/resource-settlement.ts')],
      outfile: output, bundle: true, packages: 'external', format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent',
      plugins: [{ name: 'resource-pilot-mutation', setup(builder) {
        builder.onLoad({ filter: /\.ts$/ }, args => {
          if (args.path !== join(root, mutation.file)) return;
          const source = readFileSync(args.path, 'utf8');
          assert.equal(source.split(mutation.from).length, 2, `Mutation target changed: ${mutation.name}`);
          applied++;
          return { contents: source.replace(mutation.from, mutation.to), loader: 'ts' };
        });
      } }],
    });
    assert.equal(applied, 1);
    const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap',
      'tests/extension/resource-settlement.test.mjs'], { cwd: root, encoding: 'utf8',
      env: { ...process.env, COC_RESOURCE_PILOT_API: output } });
    const log = `${mutation.name}.log`;
    writeFileSync(join(out, log), result.stdout + '\n' + result.stderr);
    const killed = result.status === 1 && new RegExp(`not ok \\d+ - ${mutation.test}\\b`).test(result.stdout)
      && result.stdout.includes('ERR_ASSERTION') && /# tests 12\b/.test(result.stdout);
    report.mutations.push({ ...mutation, exit: result.status, killed, log });
    save();
    assert.ok(killed, `Mutation did not fail its designated assertion: ${mutation.name}`);
    console.log(`mutation ${mutation.name}: caught by ${mutation.test}`);
  }
  assert.deepEqual(hashes(), report.originalTestHashes);
  assert.deepEqual(pilotHashes(), report.pilotHashes);
  assert.equal(sourceDigest(), report.diffSha256);
} catch (error) {
  report.failure = String(error);
  throw error;
} finally {
  report.finished = new Date().toISOString();
  save();
}
