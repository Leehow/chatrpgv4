/** Public recovery instructions must keep material checks separate from publication. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {join,resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {openTable, waitForIdle} from './harness.mjs';
import {COC_TOOLS, effectShapeRefusal} from '../../extensions/kernel/tools.ts';
import {besideSteer} from '../../extensions/kernel/index.ts';
import {CLERK_NOTE_HEAD} from '../../runtime/jev/hybrid-engine.ts';
import {KernelError} from '../../extensions/kernel/client.ts';

const plan = {version:1, materials:[{name:'cold room', text:'The room is cold.',kind:'description',visibility:'player',required:true}]};

test('an opening write is judged like any turn, and a checked plan still needs one explicit publication', async t => {
  const table = await openTable({legacyDeliveryFixtures:false,env:{FAKE_KERNEL_OPENING:'1',
    PI_COC_READER_CMD:JSON.stringify([process.execPath,join(resolve(import.meta.dirname,'../..'),'tests/extension/fixtures/final-output-writer.mjs')])},responses:[
    fauxAssistantMessage([fauxToolCall('apply',{effects:[{kind:'time',minutes:5}]})],{stopReason:'toolUse'}),
    fauxAssistantMessage([fauxToolCall('narrate',{delivery:plan})],{stopReason:'toolUse'}),
    fauxAssistantMessage([fauxToolCall('output',{})],{stopReason:'toolUse'}),
  ]});
  t.after(()=>table.dispose());
  await waitForIdle(table.session);
  // §264.22: the opening no longer refuses an ordinary write, so the apply is judged like any turn's and is not a recovery.
  const applied = table.session.messages.find(m=>m.role==='toolResult'&&m.toolName==='apply');
  assert.doesNotMatch((applied?.content??[]).filter(c=>c.type==='text').map(c=>c.text).join(''),/this is the table's opening/);
  const calls=table.kernelRequests().map(r=>r.method);
  assert.ok(calls.includes('table.delivery.check'));
  assert.ok(calls.indexOf('table.delivery.check')<calls.indexOf('table.narrate'),JSON.stringify({calls,errors:table.session.messages.filter(m=>m.role==='toolResult'&&m.isError).map(m=>({tool:m.toolName,content:m.content}))}));
  assert.equal(table.kernelRequests().filter(r=>r.method==='table.narrate').length,1);
  assert.equal(table.telemetry().filter(r=>r.lane==='final-output'&&r.event==='start').length,1);
});

test('malformed apply and silent-write recovery never describe checks as publishing prose', () => {
  const apply=COC_TOOLS.find(tool=>tool.name==='apply');
  const refusal=effectShapeRefusal('apply',apply.parameters,{effects:[{kind:'narrate',text:'A draft.'}]});
  assert.match(refusal.fix,/prepare|check/);
  assert.match(refusal.fix,/handoff/);
  assert.doesNotMatch(refusal.fix,/it is delivered once/);
  for(const guidance of [besideSteer(['apply']),CLERK_NOTE_HEAD]) {
    assert.match(guidance,/handoff|output/);
    assert.doesNotMatch(guidance,/narrate last|prose goes through narrate/);
  }
});

test('public recovery text names output while the canonical recovery tag stays compatible', () => {
  const error=new KernelError({code:'needs',message:'Only settled consequences may be told.',next:'narrate'});
  assert.equal(error.next,'narrate');
  assert.match(error.toToolText(),/next: output/);
  assert.doesNotMatch(error.toToolText(),/next: narrate/);
});

test('active recovery strings never send the Keeper to narrate for final publication', () => {
  const files=[
    'extensions/kernel/index.ts','extensions/kernel/tools.ts','extensions/kernel/admission.ts',
    'extensions/kernel/adaptation.ts','extensions/kernel/opening-instruction.ts',
    'extensions/kernel/text-tool-call.ts','extensions/kernel/establish.ts',
    'runtime/jev/narrator-catalog.ts','runtime/jev/hybrid-engine.ts',
    'kernel-ts/read/assemble.ts','kernel-ts/worldline/branch.ts','kernel-ts/write/index.ts',
  ];
  const obsolete=[/\b(?:close|finish|deliver|continue|write)\b[^.!?;\n]{0,100}\b(?:with|via) narrate\b/i,
    /\b(?:use|call) narrate to (?:deliver|revise|close|write)\b/i,/\bnarrate last\b/i];
  for(const file of files){
    const source=ts.createSourceFile(file,readFileSync(join(resolve(import.meta.dirname,'../..'),file),'utf8'),ts.ScriptTarget.Latest,true);
    const visit=node=>{
      const text=ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)?node.text
        :ts.isTemplateExpression(node)?[node.head.text,...node.templateSpans.map(span=>span.literal.text)].join(' '):null;
      if(text!==null)for(const pattern of obsolete)assert.doesNotMatch(text,pattern,`${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line+1}`);
      ts.forEachChild(node,visit);
    };
    visit(source);
  }
});
