import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import test from 'node:test';
import {build} from 'esbuild';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('shared creation table methods preserve Python finance types and damage-table boundaries', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'pi-coc-setup-tables-'));
  try {
    await build({stdin: {contents: [
      "export {RuleTables} from './kernel-ts/rules/tables.ts';",
      "export {createKernelContext} from './kernel-ts/context.ts';",
      "export {canonicalJson} from './kernel-ts/json.ts';",
    ].join('\n'), resolveDir: REPO, sourcefile: 'setup-table-test.ts'}, outfile: join(temporary, 'api.mjs'),
      bundle: true, format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent'});
    const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);
    const oracle = spawnSync('uv', ['run', '--frozen', 'python', '-c', [
      'import json, sys',
      'from pathlib import Path',
      'sys.path.insert(0, "kernel")',
      'from coc.rules.tables import RuleTables',
      'from coc.fileio import canonical_json',
      'tables = RuleTables(Path("content/rulesets/coc7/rules-json"))',
      'cases = []',
      'totals = {0, 1000}',
      'for row in tables.load("damage-bonus-build"):',
      '    totals.update([row["min"] - 1, row["min"], row["max"], row["max"] + 1])',
      'for total in sorted(totals):',
      '    cases.append(("damageBonusBuild", [total, 0], lambda total=total: tables.damage_bonus_build(total, 0)))',
      'for period, rows in tables.load("cash-assets")["periods"].items():',
      '    ratings = {-1, 100}',
      '    for row in rows:',
      '        ratings.update([row["credit_rating_min"], row["credit_rating_max"]])',
      '    for rating in sorted(ratings):',
      '        cases.append(("cashAndAssets", [rating, period], lambda rating=rating, period=period: tables.cash_and_assets(rating, period)))',
      'cases.append(("cashAndAssets", [30, "unknown"], lambda: tables.cash_and_assets(30, "unknown")))',
      'for name in [next(iter(tables.weapons_table())), "unknown"]:',
      '    cases.append(("weaponByName", [name], lambda name=name: tables.weapon_by_name(name)))',
      'for name in ["Language (Own)", "unknown"]:',
      '    cases.append(("skillByName", [name], lambda name=name: tables.skill_by_name(name)))',
      'output = []',
      'for method, args, invoke in cases:',
      '    try:',
      '        expected = {"result": canonical_json(invoke())}',
      '    except (ValueError, KeyError) as exc:',
      '        expected = {"error": f"{type(exc).__name__}: {exc}"}',
      '    output.append({"method": method, "args": args, **expected})',
      'print(json.dumps(output))',
    ].join('\n')], {cwd: REPO, encoding: 'utf8', timeout: 30000});
    assert.equal(oracle.error, undefined);
    assert.equal(oracle.status, 0, oracle.stderr);
    const context = await api.createKernelContext({workspace: temporary, content: join(REPO, 'content'), seed: 'table-proof'});
    try {
      const tables = new api.RuleTables(context);
      for (const expected of JSON.parse(oracle.stdout)) {
        let actual;
        try { actual = {result: api.canonicalJson(await tables[expected.method](...expected.args))}; }
        catch (error) { actual = {error: `${error.name}: ${error.message}`}; }
        const {method, args, ...result} = expected;
        assert.deepEqual(actual, result, `${method}(${args.join(', ')})`);
      }
    } finally { await context.git.close(); }
  } finally { await rm(temporary, {recursive: true, force: true}); }
});
