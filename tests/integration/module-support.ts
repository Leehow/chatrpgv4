/** Deterministic source transport fixtures. No PDF rendering or gameplay is claimed. */
import assert from 'node:assert/strict';
import {writeFileSync,existsSync} from 'node:fs';
import {join,dirname,relative,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {writeJson,type RpcClient,type Row} from './support.ts';

export function write(path:string,value:unknown){
  if(basename(path)==='module.json')writeSourceMetadata(path,value);else writeJson(path,value);
}
export function writeSourceMetadata(path:string,value:unknown){
  let root=dirname(path);while(basename(root)!=='.coc'&&dirname(root)!==root)root=dirname(root);
  const database=join(root,'source-reading.sqlite'),payload=JSON.stringify(value);
  if(basename(root)==='.coc'&&existsSync(database)){
    const db=new DatabaseSync(database,{timeout:25000});
    try{db.exec('BEGIN IMMEDIATE');const scope=relative(root,dirname(path));
      const saved=db.prepare('SELECT revision FROM source_modules WHERE scope=?').get(scope) as Row|undefined;
      if(saved){const revision=Number(saved.revision)+1,jobs=db.prepare('SELECT payload FROM source_jobs WHERE scope=? ORDER BY ordinal').all(scope).map(row=>JSON.parse(String(row.payload)));
        db.prepare('UPDATE source_modules SET revision=?,payload=? WHERE scope=?').run(revision,payload,scope);
        db.prepare('INSERT INTO source_revisions VALUES(?,?,?,?)').run(scope,revision,payload,JSON.stringify(jobs));
        db.prepare('UPDATE source_exports SET revision=?,error=NULL WHERE scope=?').run(revision,scope);
      }db.exec('COMMIT');
    }finally{db.close();}
  }writeFileSync(path,payload);
}
export async function bind(k:RpcClient,root=k.workspace):Promise<[string,Row]>{
  const path=join(root,'original.pdf'),bytes=Buffer.from('%PDF-1.7\nsynthetic transport fixture; not rendered or played\n');
  writeFileSync(path,bytes);const source={path,file_sha256:createHash('sha256').update(bytes).digest('hex'),page_count:2};
  return [(await k.ok('module.source.bind',{source})).module_id,source];
}
export const request=(k:RpcClient,module_id:string,purpose:string,args:Row={})=>k.ok('module.read.request',{module_id,purpose,...args});
export const claim=(k:RpcClient,module_id:string)=>k.ok('module.read.claim',{module_id,owner:'test-host'});
export const finish=(k:RpcClient,job:Row,args:Row={})=>k.ok('module.read.finish',{module_id:job.module_id,job_id:job.job_id,lease:job.lease,outcome:'completed',draft_path:join(job.work_dir,'draft.json'),review_path:join(job.work_dir,'review.json'),...args});
export const observed=(job:Row,args:Row={})=>writeJson(join(job.work_dir,'observations.json'),{file_sha256:job.source.file_sha256,read_pages:[1,2],full_pages:[1,2],review_pages:[1,2],...args});
export async function indexed(k:RpcClient,root=k.workspace):Promise<[string,Row]>{
  const [mid,source]=await bind(k,root);await request(k,mid,'index');const job=await claim(k,mid);assert.equal(job.purpose,'index');observed(job);
  writeJson(join(job.work_dir,'draft.json'),{title:'The Harbor',language:'en',sections:[{name:'The harbor and the tower',pages:[[1,2]],topics:['opening'],entities:['Dock','Tower','Lena'],references:[]}]});
  await finish(k,job);return [mid,source];
}
export async function opening(k:RpcClient,mid:string):Promise<[Row,Row,Row]>{
  await request(k,mid,'opening');const job=await claim(k,mid);assert.equal(job.purpose,'opening');observed(job);
  const refs=[{page:1}],nodes=[{node_id:'scene-dock',node_kind:'scene',name:'Dock',source_refs:refs,properties:{is_entrance:true}},
    {node_id:'scene-tower',node_kind:'scene',name:'Tower',source_refs:[{page:2}],summary:'An old tower beyond the harbor.',properties:{is_final:true}},
    {node_id:'npc-lena',node_kind:'npc',name:'Lena',source_refs:refs,properties:{mechanics:{profile:{characteristics:{STR:50}}}}}];
  const claims=[['scene-dock','route-to','scene-tower'],['npc-lena','present-in','scene-dock']].map(([subject_id,predicate,node_id])=>({subject_id,predicate,object:{node_id},truth_status:'authored-fact',source_refs:refs}));
  const draft={nodes,claims,node_refs:[],coverage:{},dependencies:[],critical:[],ready_nodes:['scene-dock','npc-lena']};
  const review={checked:['/nodes/0','/nodes/2','/nodes/2/properties/mechanics/profile/characteristics/STR','/claims/0','/claims/1','/coverage'].map(path=>({path,verdict:'supported',source_refs:refs,reason:'fixture support'})),missing:[]};
  writeJson(join(job.work_dir,'draft.json'),draft);writeJson(join(job.work_dir,'review.json'),review);return [job,draft,review];
}
export async function handleOf(k:RpcClient,campaign:string,name:string){return (await k.ok('table.lookup',{campaign,kind:'module',query:name})).entities[0].name;}
