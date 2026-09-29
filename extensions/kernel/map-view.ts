/** Render only authorized map-region pixels into an immutable conversation image. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';

type Row = Record<string, any>;
const MAP_RENDERER_VERSION=2;
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
    document:MapDocumentState; image?:string; media_type?:string; level_images?:Array<{level:string;image:string}>;
    /** §39.4: `update` is a row naming a map the table already holds, with no picture of its own. */
    presentation?:'card'|'update'};
export type MapDocumentState = 'ready' | 'none';
export const MAP_DOCUMENT_READY:MapDocumentState='ready', MAP_DOCUMENT_NONE:MapDocumentState='none';

function record(value: unknown): Row { return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}; }
function rows(value: unknown): Row[] { return Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : []; }
function confined(root: string, path: string): boolean {
    const rel = relative(resolve(root), resolve(path));
    return rel !== '' && rel !== '..' && !rel.startsWith('..' + sep);
}
function validBox(value: unknown): value is number[] {
    return Array.isArray(value) && value.length === 4 && value.every(item => typeof item === 'number' && Number.isFinite(item) && item >= 0 && item <= 1)
        && value[2] > value[0] && value[3] > value[1];
}
function slug(value: string): string { return value.normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 80) || 'map'; }

export async function renderMapView(viewValue: unknown, options: {modulesRoot:string; sourceRoots?:string[]; campaignDir:string; receipt?:string; splitLevels?:boolean}): Promise<MapAttachment | null> {
    const view = record(viewValue), map = typeof view.map === 'string' ? view.map : '', name = typeof view.name === 'string' ? view.name : map,
        label=typeof view.label==='string'&&view.label?view.label:undefined;
    if (!map) return null;
    const regions = rows(view.regions).map(region => ({id:String(region.id ?? ''),label:String(region.label ?? region.id ?? ''),...(typeof region.level === 'string'&&region.level?{level:region.level}:{})}));
    const layers = rows(record(view.render).layers);
    // §39.4: the whole of each player-safe source the picture draws from, and that source's regions
    // the table does not hold yet, which are painted over. Both are optional; without them a card is
    // the region-by-region picture it always was.
    const bases = rows(record(view.render).base), masks = rows(record(view.render).masks);
    const revision = typeof view.source_revision === 'string' ? view.source_revision : '';
    let viewId = createHash('sha256').update(JSON.stringify([MAP_RENDERER_VERSION,map, revision, regions.map(region => region.id)])).digest('hex').slice(0, 20);
    const words=typeof view.words==='string'&&view.words?view.words:undefined;
    const base:MapAttachment = {kind:'map',...(options.receipt?{receipt:options.receipt}:{}),map,name,...(label?{label}:{}),...(words?{words}:{}),source_revision:revision,view_id:viewId,regions,
        levels:[...new Set(regions.flatMap(region=>region.level?[region.level]:[]))],document:MAP_DOCUMENT_NONE};
    if (!regions.length || layers.length !== regions.length) return base;
    const roots=[options.modulesRoot,...(options.sourceRoots??[])],sourceRoots:string[]=[];
    for(const root of roots){try{const actual=await realpath(root);if(!sourceRoots.includes(actual))sourceRoots.push(actual);}catch{/* an absent optional scope owns no bytes */}}
    if(!sourceRoots.length)return base;
    // A base is held to everything a layer is: a confined, bounded file whose bytes match the reviewed digest.
    const pictures=[...bases,...layers],sourcePaths:string[]=[];
    for (const layer of pictures) {
        if (typeof layer.path !== 'string' || !validBox(layer.placement) || !validBox(layer.source_box)) return base;
        let sourcePath:string;try{sourcePath=await realpath(layer.path);}catch{return base;}
        if(!sourceRoots.some(root=>confined(root,sourcePath)))return base;
        try { if ((await stat(sourcePath)).size > 20 * 1024 * 1024) return base; } catch { return base; }
        if (layers.includes(layer) && (!Array.isArray(layer.redactions) || !layer.redactions.every(validBox))) return base;
        sourcePaths.push(sourcePath);
    }
    if (!masks.every(mask => validBox(mask.placement))) return base;
    const sourceDigests=[];
    for(const [index,path] of sourcePaths.entries()){
        const digest=createHash('sha256').update(await readFile(path)).digest('hex');
        sourceDigests.push(digest);
        // A reviewed source digest is authoritative; a changed byte set is unavailable,
        // never silently rendered against an older authorization.
        if(typeof pictures[index].source_digest==='string' && pictures[index].source_digest.trim() && pictures[index].source_digest.trim()!==digest)return base;
    }
    viewId=createHash('sha256').update(JSON.stringify([MAP_RENDERER_VERSION,map,revision,regions.map(region=>region.id),pictures.map((layer,index)=>({
        source:sourceDigests[index],source_box:layer.source_box,placement:layer.placement,redactions:layer.redactions??null})),masks.map(mask=>mask.placement)])).digest('hex').slice(0,20);
    const frame=pictures.map(layer=>layer.placement as number[]);
    const x0=Math.min(...frame.map(box=>box[0])),y0=Math.min(...frame.map(box=>box[1])),
        x1=Math.max(...frame.map(box=>box[2])),y1=Math.max(...frame.map(box=>box[3]));
    const aspect=(x1-x0)/(y1-y0),width=aspect>=1?1600:Math.max(480,Math.round(1600*aspect)),height=aspect>=1?Math.max(480,Math.round(1600/aspect)):1600;
    const canvas=createCanvas(width,height),ctx=canvas.getContext('2d');
    const at=(place:number[])=>({dx:(place[0]-x0)/(x1-x0)*width,dy:(place[1]-y0)/(y1-y0)*height,dw:(place[2]-place[0])/(x1-x0)*width,dh:(place[3]-place[1])/(y1-y0)*height});
    const draw=async(layer:Row,path:string)=>{
        const image=await loadImage(path),source=layer.source_box,{dx,dy,dw,dh}=at(layer.placement);
        ctx.drawImage(image,source[0]*image.width,source[1]*image.height,(source[2]-source[0])*image.width,(source[3]-source[1])*image.height,dx,dy,dw,dh);
    };
    ctx.fillStyle=UNSEEN;ctx.fillRect(0,0,width,height);
    for(const [index,layer] of bases.entries())await draw(layer,sourcePaths[index]);
    for(const mask of masks){const {dx,dy,dw,dh}=at(mask.placement);ctx.fillStyle=UNSEEN;ctx.fillRect(dx,dy,dw,dh);}
    for(const [index,layer] of layers.entries()) {
        await draw(layer,sourcePaths[bases.length+index]);
        const {dx,dy,dw,dh}=at(layer.placement);
        for(const mask of layer.redactions) {
            ctx.fillStyle='#f2efe7';ctx.fillRect(dx+mask[0]*dw,dy+mask[1]*dh,(mask[2]-mask[0])*dw,(mask[3]-mask[1])*dh);
        }
    }
    const bytes=canvas.toBuffer('image/png');
    if(bytes.length>8*1024*1024)return base;
    const folder=join(options.campaignDir,'map-views'),path=join(folder,`${slug(map)}-${viewId}.png`),temporary=`${path}.${process.pid}.tmp`;
    await mkdir(folder,{recursive:true});
    try{await stat(path);}catch{await writeFile(temporary,bytes);await rename(temporary,path);}
    const stored=await readFile(path);
    const result:MapAttachment={...base,view_id:viewId,document:MAP_DOCUMENT_READY,media_type:'image/png',image:`data:image/png;base64,${stored.toString('base64')}`};
    if(options.splitLevels!==false&&result.levels.length>1){
        const levelImages=[];
        // A base or mask with no level belongs to every level's picture; one with levels, to those.
        const onLevel=(level:string)=>(item:Row)=>!Array.isArray(item.levels)||!item.levels.length||item.levels.includes(level);
        for(const level of result.levels){
            const ids=new Set(regions.filter(region=>region.level===level).map(region=>region.id)),subset=layers.filter(layer=>ids.has(String(layer.region)));
            const rendered=await renderMapView({...view,label,regions:regions.filter(region=>ids.has(region.id)),render:{layers:subset,
                ...(bases.length?{base:bases.filter(onLevel(level)),masks:masks.filter(onLevel(level))}:{})}}, {...options,splitLevels:false});
            if(rendered?.image)levelImages.push({level,image:rendered.image});
        }
        if(levelImages.length)result.level_images=levelImages;
    }
    return result;
}
