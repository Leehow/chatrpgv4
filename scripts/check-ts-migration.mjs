/** Consistency gate only: execution and assertion review are separate evidence. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
const read=path=>readFileSync(resolve(root,path),'utf8');
const sha=text=>createHash('sha256').update(text).digest('hex');
const manifest=JSON.parse(read('tests/ts-migration-manifest.json'));
let total=0,validated=0,assertions=0;
const failures=[];
for(const file of manifest.files){
  try{assert.equal(sha(read(file.source)),file.sha256,`source changed: ${file.source}`);}catch(error){failures.push(error.message);}
  for(const entry of file.cases){
    total++;if(entry.status!=='validated')continue;
    validated++;assertions+=entry.assertions.length;
    try{
      assert.ok(entry.counterpart?.file&&entry.counterpart?.name,`missing counterpart: ${file.source}:${entry.name}`);
      const text=read(entry.counterpart.file);
      assert.equal(sha(text),entry.counterpart.sha256,`counterpart changed: ${entry.counterpart.file}`);
      assert.ok(text.includes(entry.counterpart.name),`counterpart name absent: ${entry.name}`);
      assert.ok(entry.review==='statement-by-statement',`missing assertion review: ${entry.name}`);
      assert.ok(entry.validation?.command,`missing execution evidence: ${entry.name}`);
    }catch(error){failures.push(error.message);}
  }
}
if(process.argv.includes('--require-complete')&&(validated!==total||!manifest.complete))failures.push(`Migration incomplete: ${validated}/${total} original cases validated`);
console.log(JSON.stringify({total,validated,originalAssertionsInValidatedCases:assertions,pending:total-validated,complete:manifest.complete}));
if(failures.length){console.error([...new Set(failures)].join('\n'));process.exitCode=1;}
