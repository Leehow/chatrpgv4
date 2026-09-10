import {expected as outcome} from "./oracle-fixture.mjs";
import {pythonOracleEnvironment} from "../python-oracle.mjs";
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
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
    const program = [
        'import json, sys',
        'from pathlib import Path',
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
    ].join('\n');
    const oracleText = outcome('setup-1', () => {
      const oracle = spawnSync('uv', ['run', '--frozen', 'python', '-c', program], {cwd: REPO, env:pythonOracleEnvironment(), encoding: 'utf8', timeout: 30000});
      assert.equal(oracle.error, undefined);
      assert.equal(oracle.status, 0, oracle.stderr);
      return oracle.stdout;
    }, program);
    const context = await api.createKernelContext({workspace: temporary, content: join(REPO, 'content'), seed: 'table-proof'});
    try {
      const tables = new api.RuleTables(context);
      for (const expected of JSON.parse(oracleText)) {
        let actual;
        try { actual = {result: api.canonicalJson(await tables[expected.method](...expected.args))}; }
        catch (error) { actual = {error: `${error.name}: ${error.message}`}; }
        const {method, args, ...result} = expected;
        assert.deepEqual(actual, result, `${method}(${args.join(', ')})`);
      }
    } finally { await context.git.close(); }
  } finally { await rm(temporary, {recursive: true, force: true}); }
});

test('stated-aptitude assignment matches the Python oracle roll for roll', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'pi-coc-setup-aptitude-'));
  const SEEDS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
  const CASES = [null, {strong: ['STR'], weak: ['INT'], origin: 'player'}, {strong: ['DEX'], weak: ['APP'], origin: 'concept'},
    {strong: ['DEX', 'POW'], weak: ['APP', 'SIZ'], origin: 'player'}, {strong: ['EDU', 'INT', 'SIZ'], origin: 'player'},
    {weak: ['STR', 'CON', 'DEX', 'APP', 'POW'], origin: 'player'}];
  try {
    await build({stdin: {contents: [
      "export {RuleTables} from './kernel-ts/rules/tables.ts';",
      "export {createKernelContext} from './kernel-ts/context.ts';",
      "export {canonicalJson} from './kernel-ts/json.ts';",
      "export {Chargen} from './kernel-ts/setup/chargen.ts';",
      "export {PythonRandom} from './kernel-ts/random.ts';",
    ].join('\n'), resolveDir: REPO, sourcefile: 'setup-aptitude-test.ts'}, outfile: join(temporary, 'aptitude.mjs'),
      bundle: true, format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent'});
    const api = await import(pathToFileURL(join(temporary, 'aptitude.mjs')).href);
    const program = [
        'import json, random, sys',
        'from pathlib import Path',
        'from coc.rules.tables import RuleTables',
        'from coc.chargen import Chargen',
        'from coc.fileio import canonical_json',
        'steps = json.loads(Path("content/setup/steps.json").read_text(encoding="utf-8"))',
        'policy = next(s for s in steps["steps"] if s["id"] == "create-investigator")',
        'chargen = Chargen(RuleTables(Path("content/rulesets/coc7/rules-json")), policy)',
        `data = json.loads(${JSON.stringify(JSON.stringify({seeds: SEEDS, cases: CASES}))})`,
        'seeds, cases = data["seeds"], data["cases"]',
        'output = [{"pools": canonical_json(chargen.dice_pools())}]',
        'for seed in seeds:',
        '    for case in cases:',
        '        generated = chargen.rolled(random.Random(seed), chargen.aptitude(case))',
        '        output.append({"seed": seed, "aptitude": case, "generated": canonical_json(generated)})',
        'print(json.dumps(output))',
    ].join('\n');
    const oracleText = outcome('setup-2', () => {
      const oracle = spawnSync('uv', ['run', '--frozen', 'python', '-c', program], {cwd: REPO, env:pythonOracleEnvironment(), encoding: 'utf8', timeout: 30000});
      assert.equal(oracle.error, undefined);
      assert.equal(oracle.status, 0, oracle.stderr);
      return oracle.stdout;
    }, program);
    const context = await api.createKernelContext({workspace: temporary, content: join(REPO, 'content'), seed: 'aptitude-proof'});
    try {
      const steps = JSON.parse(await readFile(join(REPO, 'content/setup/steps.json'), 'utf8'));
      const policy = steps.steps.find(step => step.id === 'create-investigator');
      const chargen = await api.Chargen.create(new api.RuleTables(context), policy);
      const [pools, ...rows] = JSON.parse(oracleText);
      assert.equal(api.canonicalJson(chargen.dicePools()), pools.pools, 'the dice pools are read from the same table');
      for (const {seed, aptitude, generated} of rows) {
        const actual = chargen.rolled(new api.PythonRandom(seed), chargen.aptitude(aptitude));
        assert.equal(api.canonicalJson(actual), generated, `rolled(${seed}, ${JSON.stringify(aptitude)})`);
      }
    } finally { await context.git.close(); }
  } finally { await rm(temporary, {recursive: true, force: true}); }
});

test('both kernels allocate the same skill points for either interest policy', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'pi-coc-setup-interest-'));
  const OPTIONS = {
    occupation_id: 'Farmer', seed: 'interest-parity', era: '1920s', age: 34, method: 'rolled',
    occupation_skills: ['Spot Hidden', 'Listen', 'Track', 'Natural World', 'Mechanical Repair', 'Drive Auto', 'Intimidate', 'Operate Heavy Machinery'],
    interest_skills: ['Fighting (Brawl)', 'Throw', 'First Aid', 'Climb', 'Library Use', 'Navigate', 'Swim', 'Jump'],
  };
  const CASES = [null, 'spread', 'fill'];
  try {
    await build({stdin: {contents: [
      "export {RuleTables} from './kernel-ts/rules/tables.ts';",
      "export {createKernelContext} from './kernel-ts/context.ts';",
      "export {canonicalJson} from './kernel-ts/json.ts';",
      "export {Chargen} from './kernel-ts/setup/chargen.ts';",
    ].join('\n'), resolveDir: REPO, sourcefile: 'setup-interest-test.ts'}, outfile: join(temporary, 'interest.mjs'),
      bundle: true, format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent'});
    const api = await import(pathToFileURL(join(temporary, 'interest.mjs')).href);
    const program = [
        'import json, sys',
        'from pathlib import Path',
        'from coc.rules.tables import RuleTables',
        'from coc.chargen import Chargen',
        'from coc.fileio import canonical_json',
        'steps = json.loads(Path("content/setup/steps.json").read_text(encoding="utf-8"))',
        'policy = next(s for s in steps["steps"] if s["id"] == "create-investigator")',
        'chargen = Chargen(RuleTables(Path("content/rulesets/coc7/rules-json")), policy)',
        `data = json.loads(${JSON.stringify(JSON.stringify({options: OPTIONS, cases: CASES}))})`,
        'output = []',
        'for case in data["cases"]:',
        '    sheet, receipt = chargen.build(investigator_id="a", name="A", concept=None, sex=None,',
        '                                   interest_allocation=case, **data["options"])',
        '    output.append({"case": case, "skills": canonical_json(sheet["skills"]),',
        '                   "interest": canonical_json(sheet["creation"]["skills"]["interest"]),',
        '                   "receipt": canonical_json(receipt["interest_allocation"])})',
        'print(json.dumps(output))',
    ].join('\n');
    const oracleText = outcome('setup-3', () => {
      const oracle = spawnSync('uv', ['run', '--frozen', 'python', '-c', program], {cwd: REPO, env:pythonOracleEnvironment(), encoding: 'utf8', timeout: 30000});
      assert.equal(oracle.error, undefined);
      assert.equal(oracle.status, 0, oracle.stderr);
      return oracle.stdout;
    }, program);
    const context = await api.createKernelContext({workspace: temporary, content: join(REPO, 'content'), seed: 'interest-proof'});
    try {
      const steps = JSON.parse(await readFile(join(REPO, 'content/setup/steps.json'), 'utf8'));
      const chargen = await api.Chargen.create(new api.RuleTables(context), steps.steps.find(step => step.id === 'create-investigator'));
      for (const expected of JSON.parse(oracleText)) {
        const [sheet, receipt] = await chargen.build({investigatorId: 'a', name: 'A', concept: null, sex: null,
          occupationId: OPTIONS.occupation_id, seed: OPTIONS.seed, era: OPTIONS.era, age: OPTIONS.age, method: OPTIONS.method,
          occupationSkills: OPTIONS.occupation_skills, interestSkills: OPTIONS.interest_skills, interestAllocation: expected.case});
        assert.equal(api.canonicalJson(sheet.skills), expected.skills, `skills for ${expected.case}`);
        assert.equal(api.canonicalJson(sheet.creation.skills.interest), expected.interest, `interest ledger for ${expected.case}`);
        assert.equal(api.canonicalJson(receipt.interest_allocation), expected.receipt, `receipt for ${expected.case}`);
      }
    } finally { await context.git.close(); }
  } finally { await rm(temporary, {recursive: true, force: true}); }
});
