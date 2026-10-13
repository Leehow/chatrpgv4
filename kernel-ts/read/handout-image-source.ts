/** Resolve a revealed image through its reviewed asset reference, without guessing MIME or paths. */
import type {ModuleGraph} from './module-graph.js';
import {row,type Row} from './values.js';
export const RASTER_MEDIA_TYPES=['image/png','image/jpeg','image/webp','image/gif'] as const;
const publicImage=(node:Row)=>['player-safe','revealable'].includes(node.visibility);
type AssetReader=(module:string,name:string)=>Promise<Row|null>;
export async function handoutImageSource(graph:ModuleGraph,node:Row,asset:AssetReader):Promise<{ref:string;media_type:string;visibility:string;source_node:string}|null>{
 if(!publicImage(node))return null;
 const load=async(value:Row)=>row(graph.assetOverride?await graph.assetOverride(value.node_id):await asset(graph.moduleId,value.node_id));
 const registered=await load(node),props=row(node.properties);
 const reference=props.image_asset_id,linked=typeof reference==='string'?graph.nodes.get(reference):null;
 if(typeof reference==='string'&&(!linked||linked.node_kind!=='asset'||!publicImage(linked)))return null;
 const ref=registered.path||props.asset_ref||props.image_ref,media=registered.media_type||props.media_type;
 if(typeof ref==='string'&&RASTER_MEDIA_TYPES.includes(media))return {ref,media_type:media,visibility:node.visibility,source_node:graph.survivorOf(linked??node).node_id};
 if(!linked)return null;
 const source=await load(linked),fields=row(linked.properties),path=source.path||fields.asset_ref,kind=source.media_type||fields.media_type;
 return typeof path==='string'&&RASTER_MEDIA_TYPES.includes(kind)?{ref:path,media_type:kind,visibility:node.visibility,source_node:graph.survivorOf(linked).node_id}:null;
}
