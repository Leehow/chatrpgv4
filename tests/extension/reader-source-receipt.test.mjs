import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {requireCheckedSourceReceipt} from '../../extensions/module/reader-source-receipt.ts';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('native source work requires its checked tool receipt, including the guidance and review bytes',async t=>{
 const cwd=await mkdtemp(join(tmpdir(),'source-receipt-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
 for(const name of ['task','draft','guidance','review'])await writeFile(join(cwd,`${name}.json`),JSON.stringify({name}));
 const run={command:['node','/bundle/runtime/pi-source-reader.mjs']},sourceSha='a'.repeat(64),startedAt=Date.now();
 const input={cwd,run,sourceSha,purpose:'guidance',startedAt,reviewing:true};
 await assert.rejects(requireCheckedSourceReceipt(input),/without a successful checked submission/);
 const receipt={version:1,status:'checked_candidate',published:false,run_id:'run-1',source_sha256:sourceSha,purpose:'guidance'};
 for(const name of ['task','draft','guidance','review'])receipt[`${name}_sha256`]=sha(await readFile(join(cwd,`${name}.json`)));
 await writeFile(join(cwd,'source-driver-complete.json'),JSON.stringify(receipt));
 await requireCheckedSourceReceipt(input);
 await writeFile(join(cwd,'guidance.json'),JSON.stringify({name:'changed after submission'}));
 await assert.rejects(requireCheckedSourceReceipt(input),/does not match guidance.json/);
 await requireCheckedSourceReceipt({...input,run:{command:['node','/bundle/runtime/pi.mjs']}});
});
