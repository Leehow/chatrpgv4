/** Fixture mutations follow the production SQLite seam; artifact files remain ordinary files. */
import {writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {basename,dirname,join,relative,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {playtestScratch} from './playtest-scratch.mjs';
let api;
async function storage(){
 if(!api)api=(async()=>{
  const scratch=playtestScratch('source-state-fixture'),bundle=join(scratch,'source.mjs');
  await build({stdin:{contents:"export {SourceState,sourceStateRoot} from './kernel-ts/modules/source-state.ts'; export {parsePythonJson} from './kernel-ts/json.ts';",
   resolveDir:resolve(import.meta.dirname,'../..')},outfile:bundle,bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
  return import(pathToFileURL(bundle).href);
 })();
 return api;
}
export async function writeSourceFixture(file,bytes,options){
 if(!['module.json','deepen-queue.json'].includes(basename(file)))return writeFile(file,bytes,options);
 const api=await storage(),directory=dirname(file),root=api.sourceStateRoot(directory);
 if(!root||!existsSync(join(root,'source-reading.sqlite')))return writeFile(file,bytes,options);
 const db=new DatabaseSync(join(root,'source-reading.sqlite')),scope=relative(root,directory);
 try {
  if(!db.prepare('SELECT 1 FROM source_modules WHERE scope=?').get(scope))return await writeFile(file,bytes,options);
  let value;
  try {value=api.parsePythonJson(String(bytes));}
  catch(error){
   // Deliberate corruption tests damage the authoritative payload, not an ignored inspection export.
   if(basename(file)!=='module.json')throw error;
   db.prepare('UPDATE source_modules SET payload=? WHERE scope=?').run(String(bytes),scope);
   return await writeFile(file,bytes,options);
  }
  const state=new api.SourceState(root);
  try {await state.update(directory,basename(file)==='module.json'?{metadata:value}:{jobs:value});}
  finally {state.close();}
 } finally {db.close();}
}
export async function withMissingSourceFixture(directory,action){
 const api=await storage(),root=api.sourceStateRoot(directory),db=new DatabaseSync(join(root,'source-reading.sqlite'));
 const scope=relative(root,directory),tables=['source_jobs','source_modules','source_revisions','source_imports','source_exports'];
 const saved=Object.fromEntries(tables.map(table=>[table,db.prepare('SELECT * FROM '+table+' WHERE scope=?').all(scope)]));
 try {
  // A missing-library fixture is temporarily unregistered, unlike a damaged SQL source.
  // Release the SQL lock before the callback; the fork is still allowed to publish.
  db.exec('BEGIN IMMEDIATE');
  for(const table of tables)db.prepare('DELETE FROM '+table+' WHERE scope=?').run(scope);
  db.exec('COMMIT');return await action();
 }finally{
  db.exec('BEGIN IMMEDIATE');
  try{
   for(const table of ['source_modules','source_jobs','source_revisions','source_imports','source_exports'])for(const row of saved[table])
    db.prepare('INSERT INTO '+table+' VALUES('+Object.keys(row).map(()=>'?').join(',')+')').run(...Object.values(row));
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}finally{db.close();}
 }
}
