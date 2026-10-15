import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,readdirSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const runner=readFileSync(new URL('../../scripts/test-integration-ts.mjs',import.meta.url),'utf8');
function run(t,args){
  const root=mkdtempSync(join(tmpdir(),'native-integration-arguments-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const write=(file,text)=>{mkdirSync(dirname(join(root,file)),{recursive:true});writeFileSync(join(root,file),text);};
  write('scripts/test-integration-ts.mjs',runner);
  write('scripts/build-native.mjs',readFileSync(new URL('../../scripts/build-native.mjs',import.meta.url),'utf8'));
  symlinkSync(fileURLToPath(new URL('../../node_modules',import.meta.url)),join(root,'node_modules'),'dir');
  write('scripts/test-storage.mjs',`import {spawnSync} from 'node:child_process';import {writeFileSync} from 'node:fs';
const args=process.argv.slice(process.argv.indexOf('--')+1),env={...process.env};delete env.NODE_TEST_CONTEXT;
writeFileSync('arguments.json',JSON.stringify(args));
const result=spawnSync(process.execPath,['--test',...args],{env,stdio:'inherit'});process.exitCode=result.status;`);
  for(const name of ['alpha','beta'])write(`tests/integration/${name}.test.ts`,`import {test} from 'node:test';test('${name}',()=>{});`);
  write('tests/extension/outside.test.mjs',"throw new Error('Repository-wide auto-discovery escaped native integration');");
  const env={...process.env,COC_TS_TEST_CONCURRENCY:'1'};delete env.NODE_TEST_CONTEXT;
  const result=spawnSync(process.execPath,['scripts/test-integration-ts.mjs',...args],{cwd:root,env,encoding:'utf8'});
  return{root,result,args:()=>JSON.parse(readFileSync(join(root,'arguments.json'),'utf8'))};
}
test('default invocation runs all native files without discovering extension tests',t=>{
  const f=run(t,[]);assert.equal(f.result.status,0,f.result.stdout+f.result.stderr);
  assert.ok(f.result.stdout.includes('✔ alpha'));assert.ok(f.result.stdout.includes('✔ beta'));
  assert.equal(f.args().at(-1),'tests/integration/*.test.ts');
});
test('explicit files remain the complete selection',t=>{
  const f=run(t,['tests/integration/alpha.test.ts']);assert.equal(f.result.status,0,f.result.stdout+f.result.stderr);
  assert.ok(f.result.stdout.includes('✔ alpha'));assert.ok(!f.result.stdout.includes('✔ beta'));
  assert.equal(f.args().at(-1),'tests/integration/alpha.test.ts');assert.ok(!f.args().includes('tests/integration/*.test.ts'));
});
for(const args of [['--test-name-pattern=alpha'],['--test-name-pattern','alpha'],['--test-skip-pattern','beta'],['--test-force-exit'],['--test-name-pattern','alpha','--test-timeout','10000']]){
  test(`options without file operands stay inside native integration: ${args.join(' ')}`,t=>{
    const f=run(t,args);assert.equal(f.result.status,0,f.result.stdout+f.result.stderr);
    assert.deepEqual(f.args().slice(-args.length-1),[...args,'tests/integration/*.test.ts']);
  });
}
test('separate pattern values followed by an explicit file do not add the default glob',t=>{
  const args=['--test-name-pattern','alpha','tests/integration/alpha.test.ts'],f=run(t,args);
  assert.equal(f.result.status,0,f.result.stdout+f.result.stderr);assert.deepEqual(f.args().slice(-args.length),args);
  assert.ok(!f.args().includes('tests/integration/*.test.ts'));
});
test('a missing option value fails without starting a discoverable test child',t=>{
  const f=run(t,['--test-name-pattern']);assert.equal(f.result.status,1);assert.match(f.result.stderr,/Missing value/);
  assert.ok(!readdirSync(f.root).includes('arguments.json'));
});
