import { isVisibleTo, type JsonValue, type Visibility } from "../../contracts/src/index.js";
export interface GraphNode { id:string; kind:string; visibility:Visibility; properties:Record<string,JsonValue>; }
export interface GraphEdge { id:string; source:string; relation:string; target:string; visibility:Visibility; properties:Record<string,JsonValue>; }
export class InMemoryGraphRuntime {
  private nodes=new Map<string,GraphNode>(); private outgoing=new Map<string,GraphEdge[]>();
  constructor(nodes:GraphNode[],edges:GraphEdge[]){nodes.forEach((n)=>this.nodes.set(n.id,structuredClone(n)));edges.forEach((e)=>{if(!this.nodes.has(e.source)||!this.nodes.has(e.target))throw new Error(`Dangling edge ${e.id}`);const list=this.outgoing.get(e.source)??[];list.push(structuredClone(e));this.outgoing.set(e.source,list);});}
  slice(request:{seedIds:string[];actorId:string;isKeeper:boolean;maxDepth:number;maxNodes:number;allowedRelations?:string[]}):{nodes:GraphNode[];edges:GraphEdge[];truncated:boolean}{
    const allowed=request.allowedRelations?new Set(request.allowedRelations):null;const queue=request.seedIds.map((id)=>({id,depth:0}));const visited=new Set<string>();const nodes:GraphNode[]=[];const edges:GraphEdge[]=[];let truncated=false;
    while(queue.length){const item=queue.shift();if(!item||visited.has(item.id))continue;const node=this.nodes.get(item.id);if(!node||!isVisibleTo(node.visibility,request.actorId,request.isKeeper))continue;if(nodes.length>=request.maxNodes){truncated=true;break;}visited.add(item.id);nodes.push(structuredClone(node));if(item.depth>=request.maxDepth)continue;for(const edge of this.outgoing.get(item.id)??[]){if(allowed&&!allowed.has(edge.relation))continue;if(!isVisibleTo(edge.visibility,request.actorId,request.isKeeper))continue;const target=this.nodes.get(edge.target);if(!target||!isVisibleTo(target.visibility,request.actorId,request.isKeeper))continue;edges.push(structuredClone(edge));queue.push({id:edge.target,depth:item.depth+1});}}
    const included=new Set(nodes.map((n)=>n.id));return{nodes,edges:edges.filter((e)=>included.has(e.source)&&included.has(e.target)),truncated};
  }
}
