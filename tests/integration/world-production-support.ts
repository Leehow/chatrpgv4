/** Direct current-production adapters for the retired tests' in-process seams. */
import {dirname,basename,join} from 'node:path';
import {importSource,CONTENT_DIR,readJson} from './support.ts';
import {after} from 'node:test';
import {Path} from './world-native-support.ts';
const {createKernelContext,nativeAdvisoryLocks,ModuleStore:NativeModuleStore,Reading:NativeReading,ModuleGraph:NativeModuleGraph,capsule,CampaignWriter,developmentSource,RuleTables:NativeRuleTables,PythonRandom,RpcError:NativeRpcError,createKernelRuntime,checkDraft,loadModuleContract,recordOf}=await importSource('tests/integration/world-production-entry.ts');
const contexts=new Map<string,Promise<any>>();
const runtimes:any[]=[];
after(async()=>{for(const runtime of runtimes)await runtime.close();});
function context(workspace:string,content=CONTENT_DIR){const key=workspace+'|'+content;let pending=contexts.get(key);if(!pending){pending=createKernelContext({workspace,content,locks:nativeAdvisoryLocks()});contexts.set(key,pending!);}return pending;}
function aliases(object:any,names:Record<string,string>){for(const [alias,name]of Object.entries(names))object[alias]=object[name].bind(object);return object;}
export async function ModuleStore(workspace:any){const store=aliases(new NativeModuleStore(await context(String(workspace))),{read_queue:'queue',read_sections:'sections',read_graph:'readGraph',write_module:'writeModule',module_dir:'moduleDir'});store.graph_path=async(...args:any[])=>Path(await store.graphPath(...args));return store;}
export const Reading=(store:any)=>aliases(new NativeReading(store),{material_ready:"materialReady"});
export const RpcError=NativeRpcError,record_of=recordOf;
export const random={Random:(seed:any)=>new PythonRandom(seed)};
export const Store=(workspace:any)=>({workspace:String(workspace)});
export async function Table(store:any,content:any=CONTENT_DIR,rng:any=new PythonRandom(7),options:any={}){
  const base=await context(store.workspace,String(content)),runtime=createKernelRuntime({...base,rng,seedLocked:options.seed_locked??true});
  runtimes.push(runtime);
  return{apply:(params:any)=>runtime.handlers['table.apply'](params),resolve:(params:any)=>runtime.handlers['table.resolve'](params),close:()=>runtime.close()};
}
export async function check_draft(draft:any,packet:any,seen:any){const value=await context(CONTENT_DIR,CONTENT_DIR);return checkDraft(draft,packet,await loadModuleContract(value),seen);}
export const ModuleGraph=(id:string,path:any)=>aliases(new NativeModuleGraph(id,readJson(String(path)),'',readJson(join(CONTENT_DIR,'modules/module-graph-contract-v3.json')).actor_dossier),{scene_exits:'sceneExits',scene_endings:'sceneEndings'});
export function withoutCreatureDomain(graph:any){
 const raw=structuredClone(graph.raw),creatures=new Set(raw.nodes.filter((node:any)=>node.node_kind==='creature').map((node:any)=>node.node_id));
 raw.nodes=raw.nodes.filter((node:any)=>!creatures.has(node.node_id));
 raw.relations=raw.relations.filter((edge:any)=>!creatures.has(edge.from_node_id)&&!creatures.has(edge.to_node_id));
 raw.claims=(raw.claims??[]).filter((claim:any)=>!creatures.has(claim.subject_id)&&!creatures.has(claim.object?.node_id));
 return new NativeModuleGraph(graph.moduleId,raw,graph.digest,graph.dossier);
}
export const MODULE_BUDGET=2048,MODULE_LINE_STEPS=[120,80,40,20,0];
export const json_size=capsule.jsonSize,module_section=capsule.moduleSection;
export const fitted_module_section=(graph:any,options:any={})=>capsule.fittedModuleSection(graph,typeof options==='number'?options:options.budget??2048);
async function campaign(directory:any){const root=String(directory),workspace=dirname(dirname(dirname(root)));return new CampaignWriter(await context(workspace),basename(root));}
export async function RuleTables(directory:any){const content=dirname(dirname(dirname(String(directory))));return new NativeRuleTables(await context(join(content,'../.tmp/world-direct-context'),content),String(directory));}
export const development={
  load_ending_capsule:async(directory:any,id:string)=>developmentSource.loadEndingCapsule(await campaign(directory),id),
  list_endings:async(directory:any)=>developmentSource.listEndings(await campaign(directory)),
  pending_settlements:async(directory:any)=>developmentSource.pendingSettlements(await campaign(directory)),
  persist_ending_capsule:async(directory:any,value:any)=>developmentSource.persistEndingCapsule(await campaign(directory),value),
  build_ending_capsule:async(tables:any,directory:any,record:any,sheets:any,options:any)=>developmentSource.buildEndingCapsule(tables,await campaign(directory),record,sheets,{luckRecoveryGate:options.luck_recovery_gate,capturedAt:options.captured_at}),
};
