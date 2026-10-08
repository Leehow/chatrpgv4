import {test}from'node:test';
import assert from'node:assert/strict';
import {build}from'esbuild';
const root=new URL('../..',import.meta.url).pathname;
const bundle=await build({entryPoints:[root+'/extensions/kernel/document-read-coverage.ts'],bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const {DocumentReadCoverage}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const page=(n,revision=1)=>({document_read:{name:'Notebook',mode:'page',revision,page:n,page_count:3,coverage:{}}});

test('actual page coverage distinguishes unseen pages, duplicate reads and a changed revision',()=>{
  const coverage=new DocumentReadCoverage(),last=page(3);coverage.add(last);
  assert.equal(last.document_read.coverage.all_pages_supplied,false);
  coverage.add(page(3));coverage.add(page(1));const middle=page(2);coverage.add(middle);
  assert.equal(middle.document_read.coverage.all_pages_supplied,true);
  assert.deepEqual(middle.document_read.coverage.pages_supplied,[1,2,3]);
  const changed=page(2,2);coverage.add(changed);assert.equal(changed.document_read.coverage.all_pages_supplied,false);
  assert.deepEqual(changed.document_read.coverage.pages_supplied,[2]);
});

test('literal fragments cannot masquerade as semantic page coverage, and a new turn starts fresh',()=>{
  const coverage=new DocumentReadCoverage();
  for(const n of [1,2,3])coverage.add({document_read:{name:'Notebook',mode:'literal',revision:1,page:n,page_count:3,coverage:{}}});
  const first=page(1);coverage.add(first);assert.deepEqual(first.document_read.coverage.pages_supplied,[1]);
  const fresh=new DocumentReadCoverage(),last=page(3);fresh.add(last);assert.equal(last.document_read.coverage.all_pages_supplied,false);
});

test('only issued one-use continuations can pass the repeated-look allowance',()=>{
  const coverage=new DocumentReadCoverage(),next={focus:'object',name:'Notebook',document_page:2,document_revision:1};
  coverage.add({...page(1),document_read:{...page(1).document_read,next}});
  assert.equal(coverage.permits(next),true);
  assert.equal(coverage.permits({...next,document_page:3}),false);
  assert.equal(coverage.permits({...next,name:'Another book'}),false);
  assert.equal(coverage.permits({...next,document_revision:2}),false);
  assert.equal(coverage.consume(next),true);assert.equal(coverage.consume(next),false);
  assert.equal(coverage.permits(next),false);
  const fresh=new DocumentReadCoverage();assert.equal(fresh.permits(next),false);
});
