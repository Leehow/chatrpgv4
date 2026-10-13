/** Storage fixture routing shared by native integration suites. */
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve,relative,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import type {TestContext} from 'node:test';

export function storageFixture(t:TestContext,{file,nodeid}:{file:string;nodeid?:string}):string{
  const run=process.env.COC_TEST_STORAGE_RUN;
  if(!run){const path=mkdtempSync(join(tmpdir(),'coc-ts-case-'));t.after(()=>rmSync(path,{recursive:true,force:true}));return path;}
  const policy=JSON.parse(readFileSync(process.env.COC_TEST_STORAGE_POLICY??resolve(import.meta.dirname,'../test-storage-policy.json'),'utf8'));
  if(policy.version!==1)throw new Error('Unsupported native test storage policy');
  file=relative(process.cwd(),resolve(file));nodeid??=`${file}::${t.name}`;
  const named=nodeid.split('[',1)[0].trimEnd(),sourceFile=named.split('::',1)[0];
  const storage=policy.disk_files.includes(sourceFile)||policy.disk_tests.includes(named)?'disk':'ordinary';
  const root=storage==='disk'?join(process.env.COC_TEST_DISK_TMP_ROOT!,String(process.pid)):process.env.COC_TEST_ORDINARY_TMP_ROOT!;
  mkdirSync(root,{recursive:true});const path=mkdtempSync(join(root,'case-'+createHash('sha256').update(nodeid).digest('hex').slice(0,16)+'-'));
  const reportFile=join(run,`storage-${process.pid}.json`);
  let report;try{report=JSON.parse(readFileSync(reportFile,'utf8'));}catch{report={collected:[],paths:[],reports:[]};}
  if(!report.collected.some((row:any)=>row.nodeid===nodeid))report.collected.push({nodeid,storage});
  report.paths.push({nodeid,storage,path});writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');
  // The parent runner removes scratch only after the owned child exits and evidence is durable.
  return path;
}

/** Resolve the frozen source identity so persistence cases retain their existing disk policy. */
let manifest:any;
export function nativeStorageFixture(t:TestContext):string{
 const stack=new Error().stack??'',candidates=[...stack.matchAll(/(?:file:\/\/)?(\/[^()\n]+\.test\.ts):\d+/g)].map(m=>m[1]);
 if(!manifest)manifest=JSON.parse(readFileSync(resolve(import.meta.dirname,'../ts-migration-manifest.json'),'utf8'));
 const name=t.name.replace(/ \[\d+\]$/,'');
 for(const file of candidates){const native=relative(resolve(import.meta.dirname,'../..'),file);
  for(const source of manifest.files){const entry=source.cases.find((c:any)=>c.counterpart?.file===native&&(c.counterpart.name===name||c.name===name));if(entry)return storageFixture(t,{file:source.source,nodeid:source.source+'::'+entry.name+(t.name===name?'':t.name.slice(name.length))});}}
 const file=candidates[0]??import.meta.filename;return storageFixture(t,{file,nodeid:relative(process.cwd(),file)+'::'+t.name});
}
