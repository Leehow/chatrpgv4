/** Materialize approved handout pixels at the player-host boundary, never in model context. */
import {readFileSync,realpathSync,statSync} from 'node:fs';
import {isAbsolute,join,relative,sep} from 'node:path';
type Binding={home:string;campaign:string};
const segment=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value);
const inside=(base:string,file:string)=>{const part=relative(base,file);return !!part&&part!=='..'&&!part.startsWith('..'+sep)&&!isAbsolute(part)};
export function handoutImage(row:any,binding?:Binding):string|undefined{
    const requested=row?.image_path||row?.path,media=row?.image_media_type||row?.media_type;
    if(!binding||typeof binding.home!=='string'||!isAbsolute(binding.home)||!segment(binding.campaign)||row?.document!=='ready'||['keeper','keeper-only'].includes(row.visibility)||typeof requested!=='string'||!isAbsolute(requested))return;
    try{
        const campaign=join(binding.home,'.coc','campaigns',binding.campaign);
        const meta=JSON.parse(readFileSync(join(campaign,'campaign.json'),'utf8'));
        if(!segment(meta.module_id))return;
        const roots=[campaign,join(binding.home,'.coc','module-campaigns',binding.campaign,'modules',meta.module_id),join(binding.home,'.coc','modules',meta.module_id)]
            .flatMap(path=>{try{return [realpathSync(path)]}catch{return []}});
        const path=realpathSync(requested),stat=statSync(path);
        if(!roots.some(root=>inside(root,path))||!stat.isFile()||stat.size>8*1024*1024)return;
        const bytes=readFileSync(path);
        const type=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png'
            :bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg'
            :bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'?'image/webp'
            :['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString())?'image/gif':undefined;
        if(!type||media!==type)return;
        return `data:${type};base64,${bytes.toString('base64')}`;
    }catch{return;}
}
export function withHandoutImages(view:any,binding?:Binding):any{
    if(!view||!Array.isArray(view.handouts))return view;
    return {...view,handouts:view.handouts.map((row:any)=>{
        if(!row||typeof row!=='object'||Array.isArray(row))return row;
        const {image:_existing,...safe}=row,image=handoutImage(safe,binding);
        return image?{...safe,image}:safe;
    })};
}
