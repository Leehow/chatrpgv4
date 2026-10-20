import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import adaptationSubmit from '../../extensions/kernel/adaptation-submit.ts';
import {ADAPTATION_FIELDS} from '../../shared/adaptation-fields.ts';
import {Check} from 'typebox/value';

test('creator submission advertises real arrays and the same closed operation fields as the kernel',()=>{
 const before=process.env.PI_COC_ADAPTATION_SUBMIT_ROLE;process.env.PI_COC_ADAPTATION_SUBMIT_ROLE='create';
 try{
  let tool;adaptationSubmit({on(){},registerTool(value){tool=value;}});
  const result=tool.parameters.properties.result;
  assert.equal(result.type,'object');assert.equal(result.properties.changes.type,'array');
  const variants=result.properties.changes.items.anyOf;
  assert.deepEqual(variants.map(v=>v.properties.kind.const).sort(),Object.keys(ADAPTATION_FIELDS).sort());
  for(const variant of variants){
   assert.equal(variant.additionalProperties,false);
   assert.deepEqual(Object.keys(variant.properties).sort(),['kind','reason','sources',...ADAPTATION_FIELDS[variant.properties.kind.const]].sort());
   assert.equal(variant.properties.sources.type,'array');assert.equal(variant.properties.sources.items.type,'string');
   const kind=variant.properties.kind.const,change={kind,reason:'Controlled structural fixture.',sources:['Original scene'],...Object.fromEntries(ADAPTATION_FIELDS[kind].filter(field=>!(kind==='scene'&&field==='name')).map(field=>[field,'Fixture value']))};
   const valid={result:{explanation:'Controlled schema fixture, not a reviewed campaign change.',changes:[change]}};
   assert.equal(Check(tool.parameters,valid),true);
   assert.equal(Check(tool.parameters,{result:{...valid.result,changes:{item:valid.result.changes}}}),false,'the captured malformed wrapper is refused');
   assert.equal(Check(tool.parameters,{result:{...valid.result,changes:[{...change,sources:{item:change.sources}}]}}),false);
   assert.equal(Check(tool.parameters,{result:{...valid.result,changes:[{...change,unsupported:'value'}]}}),false);
  }
 }finally{if(before===undefined)delete process.env.PI_COC_ADAPTATION_SUBMIT_ROLE;else process.env.PI_COC_ADAPTATION_SUBMIT_ROLE=before;}
});

test('adaptation submission checks the phase shape, writes once and terminates', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'adaptation-submit-'));
    const previousRole = process.env.PI_COC_ADAPTATION_SUBMIT_ROLE, previousDir = process.env.PI_COC_ADAPTATION_SUBMIT_DIR;
    process.env.PI_COC_ADAPTATION_SUBMIT_ROLE = 'review'; process.env.PI_COC_ADAPTATION_SUBMIT_DIR = cwd;
    try {
        const hooks = {}, reminders = []; let tool;
        adaptationSubmit({on(name, fn) {hooks[name] = fn;}, registerTool(value) {tool = value;}, sendMessage(value) {reminders.push(value);}});
        const invalid = await tool.execute('one', {result: {verdict: 'supported'}});
        assert.equal(invalid.isError, true);
        hooks.agent_end(); assert.equal(reminders.length, 1); assert.match(reminders[0].content, /submit_adaptation/);
        const result = {verdict: 'supported', summary: 'Checked.', issues: [], checked: []};
        assert.equal(tool.parameters.properties.result.properties.issues.type,'array');
        assert.equal(tool.parameters.properties.result.properties.checked.type,'array');
        assert.equal(Check(tool.parameters,{result:{...result,checked:{item:[]}}}),false);
        const accepted = await tool.execute('two', {result});
        assert.equal(accepted.terminate, true);
        assert.deepEqual(JSON.parse(await readFile(join(cwd, 'result.json'), 'utf8')), result);
        hooks.agent_end(); assert.equal(reminders.length, 1);
    } finally {
        if (previousRole == null) delete process.env.PI_COC_ADAPTATION_SUBMIT_ROLE; else process.env.PI_COC_ADAPTATION_SUBMIT_ROLE = previousRole;
        if (previousDir == null) delete process.env.PI_COC_ADAPTATION_SUBMIT_DIR; else process.env.PI_COC_ADAPTATION_SUBMIT_DIR = previousDir;
    }
});
