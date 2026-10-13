/** Saved-read observation with complete relational state snapshots, independent of WAL bytes. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,existsSync,writeFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {RpcClient,CAMPAIGN,MODULE,PREGEN,type Row} from './support.ts';
import {snapshot,differences} from './rpc-evidence.ts';
export const READS:[string,Row][]=[['table.status',{}],['table.view',{}],['table.capsule',{}],...['scene','npc','investigator','clues','time','session','object'].map(focus=>['table.look',{focus}] as [string,Row]),['table.lookup',{kind:'module',query:'Knott'}],['table.lookup',{kind:'secret',scope:'scene'}],['table.lookup',{kind:'secret',scope:'module'}]];
const stable=(value:any):string=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export function stateBytes(workspace:string){
 const root=join(String(workspace),'.coc'),result:Record<string,string>={};
 const visit=(dir:string)=>{for(const entry of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const path=join(dir,entry.name),name=relative(root,path);if(name==='repos')continue;if(entry.isDirectory())visit(path);else if(entry.isFile()&&!['source-reading.sqlite','source-reading.sqlite-wal','source-reading.sqlite-shm'].includes(name))result[name]=sha(readFileSync(path));}};visit(root);
 const database=join(root,'source-reading.sqlite');if(existsSync(database)){
   const db=new DatabaseSync(database,{readOnly:true});try{db.exec('BEGIN');
    const schema=db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all().map(row=>[row.type,row.name,row.tbl_name,row.sql]);
    const tables:Record<string,unknown[]>={};for(const [kind,name] of schema)if(kind==='table'){
      const rows=db.prepare(`SELECT * FROM "${String(name).replaceAll('"','""')}"`).all().map(row=>Object.values(row).map(value=>value instanceof Uint8Array?{blob:Buffer.from(value).toString('hex')}:value));
      tables[String(name)]=rows.sort((a,b)=>stable(a).localeCompare(stable(b)));
    }
    const version=db.prepare('PRAGMA user_version').get()!.user_version;result['source-reading.sqlite']=sha(stable({version,schema,tables}));db.exec('COMMIT');
   }finally{db.close();}
 }return result;
}
export async function prepare(workspace:string,options:{language?:string;content?:string;rich?:boolean}={}){
 const client=new RpcClient(String(workspace),{content:options.content,env:{COC_KERNEL_SEED:'7'},frozen_clock:true});try{
   if(options.rich){const helpers=await import('./world-capsule-budgets.test.ts');await helpers.build_rich_state(client);await client.table('player_input',{text:'Continue inspecting the saved scene.'});}
   else await client.ok('campaign.create',{id:CAMPAIGN,module:MODULE,pregen:PREGEN,play_language:options.language??'en',title:'Read migration fixture'});
   await client.table('look',{focus:'time'});
 }finally{await client.close();}
}
export async function observe(workspace:string,reads:[string,Row][],content?:string){
 workspace=String(workspace);const before=stateBytes(workspace),client=new RpcClient(workspace,{content:content&&String(content),env:{COC_KERNEL_SEED:'7'},frozen_clock:true});let failure:string|null=null;
 try{for(const [method,params] of reads)await client.call(method,{campaign:CAMPAIGN,...params});}catch(error){failure=String(error);}finally{await client.close();}
 return {exchanges:client.exchanges,before_bytes:before,after_bytes:stateBytes(workspace),snapshot:snapshot(workspace),exit_code:client.proc.exitCode,failure};
}
export async function read(root:string,reads=READS,content?:string,options:{expect_write?:boolean}={}){
 root=String(root);const result=await observe(join(root,'workspace'),reads,content),evidence=join(root,'reads.json');writeFileSync(evidence,JSON.stringify(result.exchanges,null,2)+'\n');
 assert.equal(differences(result.before_bytes,result.after_bytes).length>0,options.expect_write??false,`Unexpected mutation: ${evidence}`);assert.equal(result.failure,null,evidence);assert.equal(result.exit_code,0,evidence);return result;
}
