import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import test from 'node:test';
import {build} from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('shared definition and bounded document validation owes each draft its outcome without mutating input', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'pi-coc-mod-definition-'));
  try {
    await build({stdin:{contents:["export * from './kernel-ts/mods/definition.ts';","export {parsePythonJson,canonicalJson} from './kernel-ts/json.ts';"].join('\n'),resolveDir:ROOT,sourcefile:'mod-definition-test.ts'},
      outfile:join(temporary,'api.mjs'),bundle:true,format:'esm',platform:'node',target:'node22',logLevel:'silent'});
    const api = await import(pathToFileURL(join(temporary, 'api.mjs')).href);
    // 148 drafts and the outcome each one is owed, captured once from the implementation this
    // validation was ported from and kept as evidence. Nothing runs beside the kernel here: the
    // cases are a file, so a change in what a draft is owed has to be made deliberately, in a diff.
    const cases = JSON.parse(await readFile(join(ROOT, 'tests/extension/fixtures/mod-definition-cases.json'), 'utf8'));
    const digest = value => createHash('sha256').update(value).digest('hex');
    for (const expected of cases) {
      const value = api.parsePythonJson(expected.source), before = api.canonicalJson(value);
      let actual;
      try { actual = {result:api.canonicalJson(expected.kind==='document' ? api.validateDocumentSeed(value) : api.validateDefinition(value,expected.options))}; }
      catch (error) { actual = typeof error.toJson==='function' ? {error:error.toJson()} : {exception:{name:error.name,message:error.message}}; }
      const {label,source,kind,options,...outcome} = expected;
      if ('result' in outcome && 'result' in actual) assert.equal(digest(actual.result),digest(outcome.result),label);
      else assert.deepEqual(actual,outcome,label);
      assert.equal(api.canonicalJson(value),before,label+' input mutation');
    }
  } finally { await rm(temporary,{recursive:true,force:true}); }
});
