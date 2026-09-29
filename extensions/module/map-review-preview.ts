/** Private review aids: draw the exact normalized reveal boxes on their cropped source raster. */
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {sourceAsset,validateBox} from './source.ts';
import {assetAliases} from './map-publication.ts';
type Row=Record<string,any>;
export function reviewedMapNodes(draft:Row,paths:string[]):Row[]{
    return (draft.nodes??[]).filter((node:Row,index:number)=>Array.isArray(node.properties?.map_regions)&&node.properties.map_regions.length
        &&paths.some(path=>path==='/coverage'||path===`/nodes/${index}`||path.startsWith(`/nodes/${index}/`)));
}
export async function mapReviewPreviews(input:{draft:Row;paths:string[];cwd:string;source:{pdf:string;cache:string}}):Promise<Row[]>{
    const out:Row[]=[];
    for(const map of reviewedMapNodes(input.draft,input.paths)){
        const groups=new Map<string,Row[]>();
        for(const region of map.properties.map_regions){
            const source=(input.draft.nodes??[]).find((node:Row)=>node.node_kind==='asset'&&assetAliases(node.node_id).includes(region.source_asset));
            if(!source?.properties?.image_sources?.length)throw new Error('Map review preview needs the declared source crop');
            const regions=groups.get(source.node_id)??[];regions.push(region);groups.set(source.node_id,regions);
        }
        for(const [id,regions] of groups){
            const source=input.draft.nodes.find((node:Row)=>node.node_id===id),ordinal=out.length+1;
            const base=join(input.cwd,`map-source-${ordinal}.png`),file=`map-regions-${ordinal}.png`;
            await sourceAsset(input.source.pdf,input.source.cache,source.properties.image_sources,base);
            const raster=await loadImage(base),scale=Math.min(1,1800/raster.width);
            const width=Math.ceil(raster.width*scale),height=Math.ceil(raster.height*scale);
            if(width*(height+regions.length*30+20)>20_000_000)throw new Error('Map review preview is too large; split the authored assets');
            const canvas=createCanvas(width,height+regions.length*30+20),ctx=canvas.getContext('2d');
            ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(raster,0,0,width,height);
            ctx.font='bold 18px sans-serif';ctx.lineWidth=3;
            const labels=regions.map((region,index)=>{
                const [x0,y0,x1,y1]=validateBox(region.source_box),marker=`R${index+1}`;
                ctx.strokeStyle='#dc2626';ctx.strokeRect(x0*width,y0*height,(x1-x0)*width,(y1-y0)*height);
                ctx.fillStyle='#ffffff';ctx.fillRect(x0*width,y0*height,48,24);
                ctx.fillStyle='#b91c1c';ctx.fillText(marker,x0*width+3,y0*height+19);
                ctx.fillText(`${marker}: ${String(region.name).slice(0,120)}`,10,height+25+index*30,width-20);
                return {marker,region_id:region.region_id,name:region.name,source_box:region.source_box};
            });
            const bytes=canvas.toBuffer('image/png');
            await writeFile(join(input.cwd,file),bytes);
            out.push({map:map.name,source_asset:id,file,image_sha256:createHash('sha256').update(bytes).digest('hex'),regions:labels});
        }
    }
    return out;
}
