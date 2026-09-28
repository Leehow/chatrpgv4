/** The host retains required source questions across tool calls and attempts. */
import {randomUUID} from 'node:crypto';
import {readFile,rename,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {validateSourceNeeds,type SourceNeed} from '../../kernel-ts/modules/source-needs.ts';
export async function retainSourceNeeds(cwd:string,sourceSha:string,needs:SourceNeed[],pageCount:number):Promise<void>{
 if(!/^[a-f0-9]{64}$/.test(sourceSha))throw new Error('Retained source needs require a bound PDF');
 validateSourceNeeds(needs,pageCount);
 const file=join(cwd,'pending-source-needs.json');
 let prior:any;try{prior=JSON.parse(await readFile(file,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 if(prior&&(prior.version!==1||prior.source_sha256!==sourceSha||!Array.isArray(prior.needs)))throw new Error('Retained source needs belong to another PDF');
 const retained:Array<SourceNeed&{alias:string}>=prior?.needs??[];
 for(const need of needs)if(!retained.some(row=>row.focus===need.focus&&row.question===need.question))retained.push({...need,alias:'need:'+retained.length});
 if(retained.length>32)throw new Error('The bounded source task has too many retained unresolved questions');
 const temporary=file+'.'+randomUUID()+'.tmp';
 await writeFile(temporary,JSON.stringify({version:1,source_sha256:sourceSha,needs:retained})+'\n');await rename(temporary,file);
}
