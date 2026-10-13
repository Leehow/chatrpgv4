/** Native test-only pool. The production retarget RPC owns cache and runtime teardown. */
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {RpcClient,ROOT,CONTENT_DIR,fixedEnvironment,type Row} from './support.ts';

export type Link={client:RpcClient;key:string;parking:string;content:string;generation:number;parkedAt:number;terminate:()=>Promise<void>};
export class KernelPool{
 readonly IDLE_PER_KEY=2;readonly IDLE_TOTAL=6;
 idle=new Map<string,Link[]>();stats:Record<string,number>={};
 private root:string|null=null;private ordinal=0;
 private count(reason:string){this.stats[reason]=(this.stats[reason]??0)+1;}
 async acquire(workspace:string,content=CONTENT_DIR,env:NodeJS.ProcessEnv={}):Promise<Link>{
   const merged=fixedEnvironment({...process.env,...env});
   const key=createHash('sha256').update(JSON.stringify(Object.entries(merged).sort(([a],[b])=>a.localeCompare(b)))).digest('hex');
   const idle=this.idle.get(key)??[];
   while(idle.length){const link=idle.pop()!;if(!link.client.healthy){await this.discard(link,'died_while_parked');continue;}
     try{link.generation=(await link.client.ok('kernel.retarget',{workspace,content})).generation;link.content=content;this.count('reused');return link;}
     catch{await this.discard(link,'retarget_failed');}
   }
   if(!this.root)this.root=mkdtempSync(join(ROOT,'.tmp/native-pool-'));
   const parking=join(this.root,`p${++this.ordinal}`);mkdirSync(parking);
   const client=new RpcClient(workspace,{content,env:merged,retargetable:true});
   this.count('spawned');return {client,key,parking,content,generation:0,parkedAt:0,terminate:()=>client.close()};
 }
 private async discard(link:Link,reason:string){this.count(reason);await link.terminate();}
 async release(link:Link){
   if(!link.client.healthy){await this.discard(link,'discarded_unhealthy');return;}
   try{link.generation=(await link.client.ok('kernel.retarget',{workspace:link.parking,content:link.content})).generation;}
   catch{await this.discard(link,'park_failed');return;}
   link.parkedAt=performance.now();const idle=this.idle.get(link.key)??[];idle.push(link);this.idle.set(link.key,idle);this.count('parked');await this.evict();
 }
 async evict(){
   while(true){for(const [key,links] of this.idle)if(!links.length)this.idle.delete(key);
     const crowded=[...this.idle.values()].find(links=>links.length>this.IDLE_PER_KEY),total=[...this.idle.values()].reduce((n,a)=>n+a.length,0);
     if(!crowded&&total<=this.IDLE_TOTAL)return;
     const candidates=crowded??[...this.idle.values()].sort((a,b)=>Math.min(...a.map(l=>l.parkedAt))-Math.min(...b.map(l=>l.parkedAt)))[0];
     await this.discard(candidates.shift()!,'evicted');
   }
 }
 async close(){for(const links of this.idle.values())for(const link of links)await link.terminate();this.idle.clear();if(this.root)rmSync(this.root,{recursive:true,force:true});this.root=null;}
}

export class PooledClient{
 readonly exchanges:Row[]=[];private ordinal=0;private closed=false;
 readonly pool:KernelPool;readonly link:Link;readonly workspace:string;
 constructor(pool:KernelPool,link:Link,workspace:string){this.pool=pool;this.link=link;this.workspace=workspace;}
 get proc(){return this.link.client.proc;}
 readonly pooled=true;
 async call(method:string,params:Row={}){const request={id:`req-${++this.ordinal}`,method,params},response=await this.link.client.raw(JSON.stringify(request));this.exchanges.push({request,response});return response;}
 async ok(method:string,params:Row={}){const response=await this.call(method,params);if(!response.ok)throw Error(JSON.stringify(response.error));return response.result;}
 async err(method:string,params:Row={}){const response=await this.call(method,params);if(response.ok)throw Error('Expected RPC error');return response.error;}
 table(method:string,params:Row={}){return this.ok(`table.${method}`,{campaign:'c1',...params});}
 tableErr(method:string,params:Row={}){return this.err(`table.${method}`,{campaign:'c1',...params});}
 async close(){if(!this.closed){this.closed=true;await this.pool.release(this.link);}}
}
export async function pooledClient(pool:KernelPool,workspace:string,options:{content?:string;env?:NodeJS.ProcessEnv}={}){
 return new PooledClient(pool,await pool.acquire(workspace,options.content,options.env),workspace);
}
