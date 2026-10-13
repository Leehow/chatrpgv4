/** Shared identity and custody gate for authorized map renders; no pixel decoder or renderer. */
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,realpath,rename,writeFile,unlink} from 'node:fs/promises';
import {isAbsolute,join,relative,resolve,sep} from 'node:path';

export const MAP_RENDERER_VERSION=2;
const SOURCE_LIMIT=20*1024*1024,MAP_LIMIT=8*1024*1024;
const PNG=Buffer.from([137,80,78,71,13,10,26,10]);
const record=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const rows=value=>Array.isArray(value)?value.filter(item=>item&&typeof item==='object'&&!Array.isArray(item)):[];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const confined=(root,path)=>{const part=relative(root,path);return !!part&&part!=='..'&&!part.startsWith('..'+sep)&&!isAbsolute(part);};
const validBox=value=>Array.isArray(value)&&value.length===4&&value.every(item=>typeof item==='number'&&Number.isFinite(item)&&item>=0&&item<=1)&&value[2]>value[0]&&value[3]>value[1];
const slug=value=>value.normalize('NFKD').replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'').toLowerCase().slice(0,80)||'map';

/** Read the bounded regular file itself, rather than trusting an earlier path existence check. */
async function regularBytes(path,limit){
    const file=await open(path,'r');
    try{
        const stat=await file.stat();
        if(!stat.isFile()||stat.size>limit)return null;
        const bytes=await file.readFile();
        return bytes.length<=limit?bytes:null;
    }finally{await file.close();}
}

/** The map view must come from the current kernel authorization, never a model-supplied render plan. */
export async function prepareMapRender(viewValue,options){
    const view=structuredClone(record(viewValue)),map=typeof view.map==='string'?view.map:'';
    if(!map||typeof options?.campaignDir!=='string'||!isAbsolute(options.campaignDir))return null;
    const regions=rows(view.regions).map(region=>({id:String(region.id??''),label:String(region.label??region.id??''),...(typeof region.level==='string'&&region.level?{level:region.level}:{})}));
    const layers=rows(record(view.render).layers),bases=rows(record(view.render).base),masks=rows(record(view.render).masks);
    if(!regions.length||layers.length!==regions.length||!masks.every(mask=>validBox(mask.placement)))return null;
    const roots=[];
    for(const root of [options.modulesRoot,...(options.sourceRoots??[])]){
        if(typeof root!=='string')continue;
        try{const actual=await realpath(root);if(!roots.includes(actual))roots.push(actual);}catch{/* An absent optional root owns no bytes. */}
    }
    if(!roots.length)return null;
    const pictures=[...bases,...layers],sourcePaths=[],sourceBytes=[],sourceDigests=[],read=new Map();
    for(const picture of pictures){
        if(typeof picture.path!=='string'||!validBox(picture.placement)||!validBox(picture.source_box))return null;
        if(layers.includes(picture)&&(!Array.isArray(picture.redactions)||!picture.redactions.every(validBox)))return null;
        try{
            const path=await realpath(picture.path);
            if(!roots.some(root=>confined(root,path)))return null;
            let bytes=read.get(path);
            if(!bytes){bytes=await regularBytes(path,SOURCE_LIMIT);if(!bytes)return null;read.set(path,bytes);}
            const sha256=digest(bytes);
            if(typeof picture.source_digest==='string'&&picture.source_digest.trim()&&picture.source_digest.trim()!==sha256)return null;
            sourcePaths.push(path);sourceBytes.push(bytes);sourceDigests.push(sha256);
        }catch{return null;}
    }
    const revision=typeof view.source_revision==='string'?view.source_revision:'';
    const viewId=digest(JSON.stringify([MAP_RENDERER_VERSION,map,revision,regions.map(region=>region.id),pictures.map((picture,index)=>({
        source:sourceDigests[index],source_box:picture.source_box,placement:picture.placement,redactions:picture.redactions??null,
    })),masks.map(mask=>mask.placement)])).slice(0,20);
    const cacheFolder=join(resolve(options.campaignDir),'map-views'),cachePath=join(cacheFolder,`${slug(map)}-${viewId}.png`);
    return {map,name:typeof view.name==='string'?view.name:map,regions,layers,bases,masks,pictures,sourcePaths,sourceBytes,sourceDigests,
        source_revision:revision,viewId,cacheFolder,cachePath};
}

function cacheIdentity(plan){
    return plan&&typeof plan.map==='string'&&typeof plan.viewId==='string'&&/^[a-f0-9]{20}$/.test(plan.viewId)
        &&typeof plan.cacheFolder==='string'&&isAbsolute(plan.cacheFolder)
        &&plan.cachePath===join(plan.cacheFolder,`${slug(plan.map)}-${plan.viewId}.png`);
}

/** A current authorized plan may consume only the exact PNG committed by its host renderer. */
export async function readMapRenderCache(plan){
    if(!cacheIdentity(plan))return null;
    try{
        const folder=await realpath(plan.cacheFolder),path=await realpath(plan.cachePath),sidecar=await realpath(plan.cachePath+'.json');
        if(!confined(folder,path)||!confined(folder,sidecar))return null;
        const metaBytes=await regularBytes(sidecar,4096),bytes=await regularBytes(path,MAP_LIMIT);
        if(!metaBytes||!bytes||!bytes.subarray(0,8).equals(PNG))return null;
        const meta=JSON.parse(metaBytes.toString('utf8')),sha256=digest(bytes);
        if(meta.renderer_version!==MAP_RENDERER_VERSION||meta.view_id!==plan.viewId||meta.map!==plan.map||meta.image_sha256!==sha256)return null;
        return {path,media_type:'image/png',sha256};
    }catch{return null;}
}

/** Only renderMapView calls this producer: its bytes have already been cropped, masked and redacted. */
export async function writeMapRenderCache(plan,bytes){
    if(!cacheIdentity(plan)||!Buffer.isBuffer(bytes)||bytes.length>MAP_LIMIT||!bytes.subarray(0,8).equals(PNG))throw new Error('Invalid rendered map cache');
    await mkdir(plan.cacheFolder,{recursive:true});
    const folder=await realpath(plan.cacheFolder),path=join(folder,`${slug(plan.map)}-${plan.viewId}.png`);
    const token=`.${process.pid}-${randomUUID()}.tmp`,temporary=path+token,metadataTemporary=path+'.json'+token;
    try{
        // Always commit these newly rendered bytes. A same-name old PNG must not acquire a new authority stamp.
        await writeFile(temporary,bytes,{flag:'wx'});await rename(temporary,path);
        await writeFile(metadataTemporary,JSON.stringify({renderer_version:MAP_RENDERER_VERSION,view_id:plan.viewId,map:plan.map,image_sha256:digest(bytes)})+'\n',{flag:'wx'});
        await rename(metadataTemporary,path+'.json');
    }finally{
        await Promise.all([temporary,metadataTemporary].map(file=>unlink(file).catch(error=>{if(error.code!=='ENOENT')throw error;})));
    }
    return await readMapRenderCache(plan);
}
