/** Current native transport/evidence versions of the six RPC support and three retained-workspace cases. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {dirname,join} from 'node:path';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {ROOT,RpcClient} from './support.ts';
import {readCommand,differences,retainComparison,retainedDirectory,internalTests} from './rpc-evidence.ts';
function temporary(t:any){const root=mkdtempSync(join(ROOT,'.tmp/rpc-support-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;}
test('test_argv_is_explicit_and_missing_commands_do_not_select_a_fallback',()=>{
 assert.equal(readCommand(null),null);assert.deepEqual(readCommand('["/runtime with spaces/node", "kernel.js"]'),['/runtime with spaces/node','kernel.js']);
 // Python ValueError becomes native argument validation TypeError; JSON syntax failures stay SyntaxError.
 for(const value of ['"node kernel.js"','[]','[1]','[""]'])assert.throws(()=>readCommand(value),TypeError);
 assert.throws(()=>readCommand('['),SyntaxError);
});
test('test_receipts_hashes_dice_and_type_changes_are_reported',()=>{
 const reference={receipt:'r1',sha256:'original',roll:51,value:true,at:'2000-01-01'};
 for(const [key,changed] of [['receipt','r2'],['sha256','changed'],['roll',50],['value',1],['at','2001-01-01']])assert.ok(differences(reference,{...reference,[String(key)]:changed}).some(row=>row.includes(`$.${key}`)));
 assert.deepEqual(differences({a:1,b:[null]},{b:[null],a:1}),[]);
});
test('test_comparison_keeps_both_inputs_and_never_overwrites_a_previous_run',t=>{
 const root=temporary(t),before={roll:17},after={roll:18};const [first,findings]=retainComparison('check',before,after,root),[second]=retainComparison('check',before,after,root);
 assert.notEqual(first,second);assert.ok(findings.length);assert.deepEqual(JSON.parse(readFileSync(join(first,'reference.json'),'utf8')),before);assert.deepEqual(JSON.parse(readFileSync(join(first,'candidate.json'),'utf8')),after);
});
test('test_matching_runtime_failures_are_not_a_successful_comparison',t=>{const failed={failure:{type:'AssertionError',message:'unsupported'}},[target]=retainComparison('both-failed',failed,failed,temporary(t));assert.equal(JSON.parse(readFileSync(join(target,'comparison.json'),'utf8')).equal,false);});
test('test_internal_import_inventory_is_advisory_and_does_not_skip_tests',t=>{
 const root=temporary(t);writeFileSync(join(root,'internal.test.ts'),'import {Store} from "../../kernel-ts/store/index.js";');writeFileSync(join(root,'rpc.test.ts'),'import {RpcClient} from "./support.ts";');assert.deepEqual(internalTests(root),['internal.test.ts']);
});
test('test_complete_json_without_the_required_line_terminator_is_rejected',async t=>{
 const root=temporary(t),program='process.stdin.once("data",()=>{process.stdout.write(JSON.stringify({ok:true}));process.exit(0)});';
 const client=new RpcClient(join(root,'workspace'),{command:[process.execPath,'-e',program]});t.after(()=>client.close());await assert.rejects(client.call('kernel.hello'),{name:'AssertionError',message:/complete JSON line/});
});
test('test_default_retained_workspace_is_inside_pytest_temp',t=>{const root=temporary(t),first=retainedDirectory(root,'rpc-case',''),second=retainedDirectory(root,'rpc-case','');assert.equal(dirname(first),root);assert.equal(dirname(second),root);assert.notEqual(first,second);});
test('test_explicit_evidence_directory_preserves_existing_material',t=>{
 const root=temporary(t),evidence=join(root,'requested-evidence');mkdirSync(evidence);const sentinel=join(evidence,'existing.txt');writeFileSync(sentinel,'original evidence');const directory=retainedDirectory(root,'rpc-case',evidence);assert.equal(dirname(directory),evidence);assert.equal(readFileSync(sentinel,'utf8'),'original evidence');
});
test('test_retained_case_cannot_escape_its_temp_root',t=>{const root=temporary(t);for(const name of ['','.','..','../outside','nested/case','nested\\case'])assert.throws(()=>retainedDirectory(root,name,''),{name:'TypeError',message:/invalid retained/});});
