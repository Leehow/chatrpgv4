/** Render only authorized map-region pixels into an immutable conversation image. */
import { createHash } from 'node:crypto';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import {MAP_RENDERER_VERSION,prepareMapRender,writeMapRenderCache} from '../../shared/map-render-cache.js';

type Row = Record<string, any>;
/** What the table does not see: the frame outside every picture, and a player-safe region not held yet. */
const UNSEEN='#171613';
export type MapAttachment = {kind:'map'; receipt?:string; map:string; name:string; label?:string;
    /** Which leg wrote the words on this card (contract §39.2): `play_language` when the Keeper did, `source` while they are still the module's own. */
    words?:string;
    source_revision?:string; view_id:string; regions:Row[]; levels:string[];
    /**
     * Whether this card opens (contract §59), mirroring `kernel-ts/read/mechanics.ts`'s vocabulary
     * across the subprocess boundary the way §39.2's words do. The host is the only leg that can
     * answer it for a map, so it is always `ready` or `none` here and never `unresolved`: the
     * kernel's own projection carries that third value until this attachment replaces it.
     */
    document:MapDocumentState; image?:string; media_type?:string; level_images?:Array<{level:string;image:string;image_path?:string}>;
    /** §39.4: the stored PNG behind `image`, for a leg that hands pixels over by path rather than inline (the board). Host-only. */
    image_path?:string;
    /** §39.4: `update` is a row naming a map the table already holds, with no picture of its own. */
    presentation?:'card'|'update'};
export type MapDocumentState = 'ready' | 'none';
export const MAP_DOCUMENT_READY:MapDocumentState='ready', MAP_DOCUMENT_NONE:MapDocumentState='none';

function record(value: unknown): Row { return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}; }
function rows(value: unknown): Row[] { return Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : []; }

export async function renderMapView(viewValue: unknown, options: {modulesRoot:string; sourceRoots?:string[]; campaignDir:string; receipt?:string; splitLevels?:boolean}): Promise<MapAttachment | null> {
    const view = record(viewValue), map = typeof view.map === 'string' ? view.map : '', name = typeof view.name === 'string' ? view.name : map,
        label=typeof view.label==='string'&&view.label?view.label:undefined;
    if (!map) return null;
    const regions = rows(view.regions).map(region => ({id:String(region.id ?? ''),label:String(region.label ?? region.id ?? ''),...(typeof region.level === 'string'&&region.level?{level:region.level}:{})}));
    let layers = rows(record(view.render).layers);
    // §39.4: the whole of each player-safe source the picture draws from, and that source's regions
    // the table does not hold yet, which are painted over. Both are optional; without them a card is
    // the region-by-region picture it always was.
    let bases = rows(record(view.render).base), masks = rows(record(view.render).masks);
    const revision = typeof view.source_revision === 'string' ? view.source_revision : '';
    let viewId = createHash('sha256').update(JSON.stringify([MAP_RENDERER_VERSION,map, revision, regions.map(region => region.id)])).digest('hex').slice(0, 20);
    const words=typeof view.words==='string'&&view.words?view.words:undefined;
    const base:MapAttachment = {kind:'map',...(options.receipt?{receipt:options.receipt}:{}),map,name,...(label?{label}:{}),...(words?{words}:{}),source_revision:revision,view_id:viewId,regions,
        levels:[...new Set(regions.flatMap(region=>region.level?[region.level]:[]))],document:MAP_DOCUMENT_NONE};
    if (!regions.length || layers.length !== regions.length) return base;
    const plan=await prepareMapRender(view,options);
    if(!plan)return base;
    const {pictures,sourceBytes}=plan;
    layers=plan.layers;bases=plan.bases;masks=plan.masks;
    viewId=plan.viewId;
    const frame=pictures.map(layer=>layer.placement as number[]);
    const x0=Math.min(...frame.map(box=>box[0])),y0=Math.min(...frame.map(box=>box[1])),
        x1=Math.max(...frame.map(box=>box[2])),y1=Math.max(...frame.map(box=>box[3]));
    const aspect=(x1-x0)/(y1-y0),width=aspect>=1?1600:Math.max(480,Math.round(1600*aspect)),height=aspect>=1?Math.max(480,Math.round(1600/aspect)):1600;
    const canvas=createCanvas(width,height),ctx=canvas.getContext('2d');
    const at=(place:number[])=>({dx:(place[0]-x0)/(x1-x0)*width,dy:(place[1]-y0)/(y1-y0)*height,dw:(place[2]-place[0])/(x1-x0)*width,dh:(place[3]-place[1])/(y1-y0)*height});
    const draw=async(layer:Row,bytes:Buffer)=>{
        // Decode the same bounded bytes the shared authority gate hashed, without reopening its source path.
        const image=await loadImage(bytes),source=layer.source_box,{dx,dy,dw,dh}=at(layer.placement);
        ctx.drawImage(image,source[0]*image.width,source[1]*image.height,(source[2]-source[0])*image.width,(source[3]-source[1])*image.height,dx,dy,dw,dh);
    };
    ctx.fillStyle=UNSEEN;ctx.fillRect(0,0,width,height);
    for(const [index,layer] of bases.entries())await draw(layer,sourceBytes[index]);
    for(const mask of masks){const {dx,dy,dw,dh}=at(mask.placement);ctx.fillStyle=UNSEEN;ctx.fillRect(dx,dy,dw,dh);}
    for(const [index,layer] of layers.entries()) {
        await draw(layer,sourceBytes[bases.length+index]);
        const {dx,dy,dw,dh}=at(layer.placement);
        for(const mask of layer.redactions) {
            ctx.fillStyle='#f2efe7';ctx.fillRect(dx+mask[0]*dw,dy+mask[1]*dh,(mask[2]-mask[0])*dw,(mask[3]-mask[1])*dh);
        }
    }
    const bytes=canvas.toBuffer('image/png');
    if(bytes.length>8*1024*1024)return base;
    const cached=await writeMapRenderCache(plan,bytes);
    if(!cached||cached.sha256!==createHash('sha256').update(bytes).digest('hex'))return base;
    const result:MapAttachment={...base,view_id:viewId,document:MAP_DOCUMENT_READY,media_type:'image/png',image:`data:image/png;base64,${bytes.toString('base64')}`,image_path:cached.path};
    if(options.splitLevels!==false&&result.levels.length>1){
        const levelImages=[];
        // A base or mask with no level belongs to every level's picture; one with levels, to those.
        const onLevel=(level:string)=>(item:Row)=>!Array.isArray(item.levels)||!item.levels.length||item.levels.includes(level);
        for(const level of result.levels){
            const ids=new Set(regions.filter(region=>region.level===level).map(region=>region.id)),subset=layers.filter(layer=>ids.has(String(layer.region)));
            const rendered=await renderMapView({...view,label,regions:regions.filter(region=>ids.has(region.id)),render:{layers:subset,
                ...(bases.length?{base:bases.filter(onLevel(level)),masks:masks.filter(onLevel(level))}:{})}}, {...options,splitLevels:false});
            if(rendered?.image)levelImages.push({level,image:rendered.image,...(rendered.image_path?{image_path:rendered.image_path}:{})});
        }
        if(levelImages.length)result.level_images=levelImages;
    }
    return result;
}
