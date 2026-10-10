import {sourceMetadata} from '../../runtime/source-metadata.ts';
/** Bind an original PDF, then prepare only its reviewed character-creation brief. */
import {join} from 'node:path';
import {guidanceFingerprint} from '../module/character-guidance.ts';
import {KernelError} from '../kernel/client.ts';

type Row=Record<string,any>;
type Reader={prepare(params:Row,signal?:AbortSignal):Promise<Row>};

export async function preparePdfCreationGuidance(input:{home:string;contentRoot?:string;params:Row;reading:Reader;
 playLanguage:()=>Promise<string>;occupations:()=>Promise<Row[]>;signal?:AbortSignal}):Promise<Row>{
 const {home,params,reading,signal}=input;
 const bound=await reading.prepare({...params,purpose:'bind'},signal);
 if(Array.isArray(bound.starters))return bound;
 const moduleId=String(bound.module_id??params.module_id??'');
 if(!/^[a-z0-9-]{1,64}$/.test(moduleId))throw new Error('Source binding returned no valid module id');
 let meta:Row;
 try{meta=await sourceMetadata(join(home,'.coc/modules',moduleId));}
 catch{meta={};}
 if(!meta.file_sha256)return reading.prepare({...params,pdf:undefined,module_id:moduleId},signal);
 const playLanguage=await input.playLanguage(),occupations=await input.occupations();
 if(!Array.isArray(occupations))throw new Error('The occupation catalog is unavailable for source guidance');
 const guidanceKey=await guidanceFingerprint({home,contentRoot:input.contentRoot,module_id:moduleId,
   opening:typeof params.start_scene==='string'?params.start_scene:undefined,play_language:playLanguage,occupations});
 const prepared=await reading.prepare({module_id:moduleId,purpose:'guidance',guidance_key:guidanceKey,
   play_language:playLanguage,occupations,...(params.start_scene?{start_scene:params.start_scene}:{}),
   ...(params.retry?{retry:params.retry}:{})},signal);
 if(prepared.guidance_key&&prepared.guidance_key!==guidanceKey)throw new Error('Source guidance identity changed during preparation');
 if(prepared.setup_ready!==true)throw new KernelError({code:'guidance_not_ready',message:'Reviewed source guidance is not ready',fix:'Retry prepare-module after its source reading settles'});
 return {...prepared,module_id:moduleId,guidance_key:guidanceKey,source_bound:true};
}
