/** Starter registration and the active kernel's PDF boundary. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {kernel,ROOT,CONTENT_DIR,MODULE,readJson} from './support.ts';

function imports(){
  const result:Array<{file:string,name:string}>=[],sources:string[]=[];
  function walk(root:string){for(const entry of readdirSync(root,{withFileTypes:true})){const path=join(root,entry.name);if(entry.isDirectory())walk(path);else if(path.endsWith('.ts'))sources.push(path);}}
  walk(join(ROOT,'kernel-ts'));
  for(const file of sources){const tree=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
    function visit(node:ts.Node){if(ts.isStringLiteral(node)&&(
      (ts.isImportDeclaration(node.parent)&&node.parent.moduleSpecifier===node)||
      (ts.isExportDeclaration(node.parent)&&node.parent.moduleSpecifier===node)||
      (ts.isCallExpression(node.parent)&&(node.parent.expression.kind===ts.SyntaxKind.ImportKeyword||node.parent.expression.getText(tree)==='require'))))result.push({file,name:node.text});
      ts.forEachChild(node,visit);
    }visit(tree);
  }return {result,sources};
}
for(const [name,libraries] of [
  ['test_no_pdf_library_is_imported_under_kernel',['pypdf','PyPDF2','pdfplumber','fitz','pymupdf','pdfminer']],
  ['test_no_pdf_library_is_imported_anywhere_under_kernel',['pypdf','PyPDF2','pdfplumber','fitz','pymupdf','pdfminer','pikepdf','camelot','tabula','pdf2image','pdfjs-dist','@napi-rs/canvas']]
] as const)test(name,()=>{
  const {result,sources}=imports();assert.ok(sources.length,'The active TypeScript kernel is missing');
  assert.deepEqual(result.filter(row=>libraries.some(name=>row.name===name||row.name.startsWith(name+'/'))),[]);
});
function canonicalSource(path:string):string{
  const tree=ts.parseJsonText(path,readFileSync(path,'utf8'));
  function encode(node:ts.Node):string{
    if(ts.isObjectLiteralExpression(node))return '{'+node.properties.map(property=>{
      assert.ok(ts.isPropertyAssignment(property));return [JSON.parse(property.name.getText(tree)),property.initializer] as const;
    }).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,value])=>JSON.stringify(key)+':'+encode(value)).join(',')+'}';
    if(ts.isArrayLiteralExpression(node))return '['+node.elements.map(encode).join(',')+']';
    if(ts.isStringLiteral(node))return JSON.stringify(JSON.parse(node.getText(tree)));
    const text=node.getText(tree);if(ts.isNumericLiteral(node)||ts.isPrefixUnaryExpression(node)){
      assert.ok(!/[eE]/.test(text),'Review numeric canonicalization if the source gains exponent literals');
      return String(Number(text))+(text.includes('.')&&Number.isInteger(Number(text))?'.0':'');
    }assert.ok(['true','false','null'].includes(text));return text;
  }
  return encode((tree.statements[0] as ts.ExpressionStatement).expression);
}
test('test_starter_registration_copies_the_graph_and_installs_it',async t=>{
  const k=await kernel(t),result=await k.ok('module.register',{module_id:MODULE});assert.equal(result.status,'installed');assert.equal(result.generation,1);
  const root=join(k.workspace,'.coc/modules',MODULE),source=join(CONTENT_DIR,'starters',MODULE,'module-graph.json');
  assert.deepEqual(readFileSync(join(root,'module-graph.json')),readFileSync(source));
  assert.equal(readJson(join(root,'module-graph-manifest.json')).graph_content_digest,createHash('sha256').update(canonicalSource(source)).digest('hex'));
  const meta=readJson(join(root,'module.json'));assert.equal(meta.source,'starter');assert.equal(meta.title,'The Haunting');assert.equal(meta.graph_digest,result.graph_digest);
  assert.equal(meta.playability.measures.scenes,12);assert.deepEqual(new Set(Object.keys(meta.playability.finding_counts)),new Set(['actor_in_no_scene','node_without_page']));assert.equal(meta.opening_ready,true);
  assert.equal((await k.ok('module.register',{module_id:MODULE})).generation,1);const status=await k.ok('module.status',{module_id:MODULE});
  assert.equal(status.opening_ready,true);assert.equal(status.sections.total,0);assert.equal(status.source,'starter');assert.deepEqual(status.source_window.pages,[446,462]);
  assert.deepEqual(status.reading,{state:'ready',index_complete:true,sections:12});assert.equal((await k.err('module.register',{module_id:'no-such-starter'})).code,'invalid_params');
});
