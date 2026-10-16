import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readdirSync,readFileSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import ts from 'typescript';

const ROOT=resolve(import.meta.dirname,'../..');
function unsafeCopies(text,name){
  const tree=ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true),recursive=new Set(),namespaces=new Set(),found=[];
  for(const statement of tree.statements){if(!ts.isImportDeclaration(statement)||!['node:fs','node:fs/promises','fs'].includes(statement.moduleSpecifier.text))continue;const clause=statement.importClause;if(clause?.name)namespaces.add(clause.name.text);const bindings=clause?.namedBindings;if(bindings&&ts.isNamespaceImport(bindings))namespaces.add(bindings.name.text);if(bindings&&ts.isNamedImports(bindings))for(const item of bindings.elements)if(['cp','cpSync'].includes(item.propertyName?.text??item.name.text))recursive.add(item.name.text);}
  function visit(node){if(ts.isCallExpression(node)){const call=node.expression,args=node.arguments;let unsafe=ts.isIdentifier(call)&&recursive.has(call.text)||ts.isPropertyAccessExpression(call)&&ts.isIdentifier(call.expression)&&namespaces.has(call.expression.text)&&['cp','cpSync'].includes(call.name.text);if(args[0]&&ts.isStringLiteral(args[0])){if(args[0].text==='cp')unsafe=true;if(args[0].text==='tar'&&args[1]&&ts.isArrayLiteralExpression(args[1])&&args[1].elements.some(value=>ts.isStringLiteral(value)&&(value.text==='--create'||/^-[^-]*c/.test(value.text))))unsafe=true;}if(unsafe)found.push(tree.getLineAndCharacterOfPosition(node.getStart()).line+1);}ts.forEachChild(node,visit);}visit(tree);return found;
}
test('persistent experiment producers cannot recursively copy or create per-run tar payloads',()=>{
  const failures=[];function walk(directory){for(const entry of readdirSync(directory,{withFileTypes:true})){if(['node_modules','fixtures','.git','.tmp'].includes(entry.name))continue;const path=join(directory,entry.name);if(entry.isDirectory())walk(path);else if(/\.(?:mjs|js|ts)$/.test(entry.name)&&!entry.name.includes('.test.'))for(const line of unsafeCopies(readFileSync(path,'utf8'),path))failures.push(relative(ROOT,path)+':'+line);else if(entry.name.endsWith('.sh')){const lines=readFileSync(path,'utf8').split('\n');for(let i=0;i<lines.length;i++)if(/^\s*cp\s/.test(lines[i]))failures.push(relative(ROOT,path)+':'+(i+1));}}}walk(join(ROOT,'experiments'));assert.deepEqual(failures,[],'Use the bounded shared test-data entry point');
});
test('the producer guard catches imported aliases, namespace copies and tar creation',()=>{
  assert.equal(unsafeCopies("import {cpSync as duplicate} from 'node:fs'; duplicate(a,b,{recursive:true});",'alias.mjs').length,1);
  assert.equal(unsafeCopies("import fs from 'node:fs'; fs.cpSync(a,b,{recursive:true});",'namespace.mjs').length,1);
  assert.equal(unsafeCopies("spawnSync('tar',['-czf',archive]);",'archive.mjs').length,1);
  assert.equal(unsafeCopies("spawnSync('tar',['-xzf',archive]); shareTestTree(a,b);",'read.mjs').length,0);
});
