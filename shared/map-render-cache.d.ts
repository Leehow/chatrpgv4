export type MapRenderRow=Record<string,any>;
export type MapRenderOptions={modulesRoot:string;sourceRoots?:string[];campaignDir:string};
export type MapRenderPlan={
    map:string;name:string;regions:MapRenderRow[];layers:MapRenderRow[];bases:MapRenderRow[];masks:MapRenderRow[];
    pictures:MapRenderRow[];sourcePaths:string[];sourceBytes:Buffer[];sourceDigests:string[];source_revision:string;
    viewId:string;cacheFolder:string;cachePath:string;
};
export type MapRenderCache={path:string;media_type:'image/png';sha256:string};
export const MAP_RENDERER_VERSION:number;
export function prepareMapRender(view:unknown,options:MapRenderOptions):Promise<MapRenderPlan|null>;
export function readMapRenderCache(plan:MapRenderPlan|null):Promise<MapRenderCache|null>;
export function writeMapRenderCache(plan:MapRenderPlan,bytes:Buffer):Promise<MapRenderCache|null>;
