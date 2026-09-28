/** A native Pi source run has completed only after its checked tool minted this receipt. */
import {createHash} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import {basename,join} from 'node:path';
import type {ReaderOutcome} from './reader.ts';

const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');

export async function requireCheckedSourceReceipt(input:{cwd:string;run:Pick<ReaderOutcome,'command'>;
 sourceSha:string;purpose:string;startedAt:number;reviewing?:boolean}):Promise<void>{
 if(!input.run.command?.some(part=>basename(part)==='pi-source-reader.mjs'))return;
 const path=join(input.cwd,'source-driver-complete.json');
 let receipt:any,modified:number;
 try{receipt=JSON.parse(await readFile(path,'utf8'));modified=(await stat(path)).mtimeMs;}
 catch{throw new Error('Native source reader ended without a successful checked submission');}
 if(modified<input.startedAt-1000||receipt?.version!==1||receipt?.status!=='checked_candidate'||
   receipt?.published!==false||typeof receipt?.run_id!=='string'||!receipt.run_id||
   receipt?.source_sha256!==input.sourceSha||receipt?.purpose!==input.purpose)
   throw new Error('Native source reader completion does not match this source task');
 const names=['task','draft',...(input.purpose==='guidance'?['guidance']:[]),...(input.reviewing?['review']:[])];
 for(const name of names){
   const expected=receipt[`${name}_sha256`];
   if(typeof expected!=='string'||expected!==digest(await readFile(join(input.cwd,`${name}.json`))))
     throw new Error(`Native source reader completion does not match ${name}.json`);
 }
 if(input.purpose==='guidance'){
   const bytes=await readFile(join(input.cwd,'public-fields.json')).catch(error=>{if(error.code==='ENOENT')return undefined;throw error;});
   if(bytes?receipt.public_fields_sha256!==digest(bytes):receipt.public_fields_sha256!==undefined)
     throw new Error('Native source reader completion does not match public-fields.json');
 }
}
