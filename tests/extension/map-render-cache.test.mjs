/** Real map rendering remains the only producer of cache PNGs consumed by item acquisition. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,symlink,rm,realpath} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {test} from 'node:test';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {prepareMapRender,readMapRenderCache,MAP_RENDERER_VERSION} from '../../shared/map-render-cache.js';
import {renderMapView} from '../../extensions/kernel/map-view.ts';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function raster(){
    const canvas=createCanvas(100,50),context=canvas.getContext('2d');
    context.fillStyle='#ff0000';context.fillRect(0,0,50,50);
    context.fillStyle='#0000ff';context.fillRect(50,0,50,50);
    return canvas.toBuffer('image/png');
}
async function fixture(t){
    const root=await mkdtemp(join(tmpdir(),'coc-map-cache-'));
    t.after(()=>rm(root,{recursive:true,force:true}));
    const modulesRoot=join(root,'modules'),source=join(modulesRoot,'map.png'),campaignDir=join(root,'campaign');
    await mkdir(modulesRoot,{recursive:true});await writeFile(source,raster());
    const view={map:'house',name:'House',source_revision:'reviewed-generation',regions:[{id:'entry',label:'Entry'}],render:{layers:[
        {path:source,source_box:[0,0,.5,1],placement:[0,0,.5,1],redactions:[]},
    ]}};
    return {root,source,view,options:{modulesRoot,campaignDir}};
}
async function pixels(path){
    const image=await loadImage(await readFile(path)),canvas=createCanvas(image.width,image.height),context=canvas.getContext('2d');
    context.drawImage(image,0,0);
    const data=context.getImageData(0,0,image.width,image.height).data;
    let red=0,blue=0,green=0;
    for(let n=0;n<data.length;n+=4){
        if(data[n]>200&&data[n+1]<40&&data[n+2]<40)red++;
        if(data[n+2]>200&&data[n]<40&&data[n+1]<40)blue++;
        if(data[n+1]>200&&data[n]<40&&data[n+2]<40)green++;
    }
    return {red,blue,green};
}

test('the renderer and acquisition reader share the exact current cache identity',async t=>{
    const {source,view,options}=await fixture(t),plan=await prepareMapRender(view,options);
    assert.ok(plan);assert.equal(plan.sourceDigests[0],sha(await readFile(source)));
    assert.equal(await readMapRenderCache(plan),null,'a name and authorized geometry do not supply pixels');
    const rendered=await renderMapView(view,options),cache=await readMapRenderCache(plan);
    assert.equal(rendered.document,'ready');assert.equal(rendered.view_id,plan.viewId);
    assert.equal(rendered.image_path,await realpath(plan.cachePath));assert.equal(cache.path,await realpath(plan.cachePath));
    assert.equal(cache.media_type,'image/png');assert.equal(cache.sha256,sha(await readFile(cache.path)));
    const picture=await pixels(cache.path);assert.ok(picture.red>0);assert.equal(picture.blue,0);
    const changed=structuredClone(view);changed.render.layers[0].placement=[0,0,1,1];
    const current=await prepareMapRender(changed,options);
    assert.notEqual(current.viewId,plan.viewId);assert.equal(await readMapRenderCache(current),null);
});

test('source confinement follows real paths, including optional campaign-private source roots',async t=>{
    const {root,source,view,options}=await fixture(t),outside=join(root,'outside.png'),link=join(options.modulesRoot,'escaped.png');
    await writeFile(outside,raster());await symlink(outside,link);
    for(const path of [outside,link]){
        const denied=structuredClone(view);denied.render.layers[0].path=path;
        assert.equal(await prepareMapRender(denied,options),null);
        assert.equal((await renderMapView(denied,options)).document,'none');
    }
    const privateRoot=join(root,'private'),privateSource=join(privateRoot,'private.png');
    await mkdir(privateRoot);await writeFile(privateSource,await readFile(source));
    const scoped=structuredClone(view);scoped.render.layers[0].path=privateSource;
    assert.equal(await prepareMapRender(scoped,options),null);
    assert.ok(await prepareMapRender(scoped,{...options,sourceRoots:[privateRoot]}));
});

test('reviewed source changes fail closed and unpinned byte changes get a new identity',async t=>{
    const {source,view,options}=await fixture(t),reviewed=sha(await readFile(source));
    view.render.layers[0].source_digest=reviewed;
    const prior=await prepareMapRender(view,options);await renderMapView(view,options);
    const replacement=createCanvas(100,50);replacement.getContext('2d').fillRect(0,0,100,50);
    await writeFile(source,replacement.toBuffer('image/png'));
    assert.equal(await prepareMapRender(view,options),null);
    assert.equal((await renderMapView(view,options)).document,'none');
    delete view.render.layers[0].source_digest;
    const current=await prepareMapRender(view,options);
    assert.notEqual(current.viewId,prior.viewId);assert.equal(await readMapRenderCache(current),null);
});

test('tampered PNGs, missing stamps and stamps for another view are unavailable',async t=>{
    const {root,view,options}=await fixture(t),plan=await prepareMapRender(view,options);
    await renderMapView(view,options);const original=await readFile(plan.cachePath),metadata=await readFile(plan.cachePath+'.json');
    await writeFile(plan.cachePath,raster());
    assert.equal(await readMapRenderCache(plan),null,'a valid raw source PNG is not the cropped cache PNG');
    // The actual renderer repairs the cache with its freshly cropped pixels, not the poisoned file it found.
    await renderMapView(view,options);
    const repaired=await readMapRenderCache(plan);assert.ok(repaired);assert.deepEqual(await readFile(repaired.path),original);
    assert.equal((await pixels(repaired.path)).blue,0);
    for(const change of [{view_id:'0'.repeat(20)},{map:'another map'},{renderer_version:MAP_RENDERER_VERSION+1},{image_sha256:'0'.repeat(64)}]){
        await writeFile(plan.cachePath+'.json',JSON.stringify({...JSON.parse(metadata),...change}));
        assert.equal(await readMapRenderCache(plan),null);
    }
    await rm(plan.cachePath+'.json');assert.equal(await readMapRenderCache(plan),null);
    await writeFile(plan.cachePath+'.json',metadata);
    assert.equal(await readMapRenderCache({...plan,cachePath:join(root,'outside.png')}),null,'a supplied path never selects the cache');
});

test('cache and stamp symlinks cannot escape the campaign cache directory',async t=>{
    const {root,view,options}=await fixture(t),plan=await prepareMapRender(view,options);
    await renderMapView(view,options);
    const bytes=await readFile(plan.cachePath),outside=join(root,'copied.png');await writeFile(outside,bytes);
    await rm(plan.cachePath);await symlink(outside,plan.cachePath);
    assert.equal(await readMapRenderCache(plan),null);
    await rm(plan.cachePath);await writeFile(plan.cachePath,bytes);
    const metadata=await readFile(plan.cachePath+'.json'),outsideStamp=join(root,'copied.json');await writeFile(outsideStamp,metadata);
    await rm(plan.cachePath+'.json');await symlink(outsideStamp,plan.cachePath+'.json');
    assert.equal(await readMapRenderCache(plan),null);
});

test('actual rendering masks unknown source regions and redacts authorized alternate-source regions',async t=>{
    const {source,view,options}=await fixture(t);
    view.render.base=[{path:source,source_box:[0,0,1,1],placement:[0,0,1,1]}];
    view.render.masks=[{placement:[.5,0,1,1]}];
    const masked=await renderMapView(view,options),maskedPlan=await prepareMapRender(view,options);
    assert.ok(await readMapRenderCache(maskedPlan));assert.equal((await pixels(masked.image_path)).blue,0);
    const alternate=createCanvas(100,50),context=alternate.getContext('2d');
    context.fillStyle='#ff0000';context.fillRect(0,0,100,50);context.fillStyle='#00ff00';context.fillRect(20,10,60,20);
    await writeFile(source,alternate.toBuffer('image/png'));
    delete view.render.base;delete view.render.masks;
    view.render.layers[0].source_box=[0,0,1,1];view.render.layers[0].redactions=[[.2,.2,.8,.6]];
    const redacted=await renderMapView(view,options),redactedPlan=await prepareMapRender(view,options);
    assert.ok(await readMapRenderCache(redactedPlan));const visible=await pixels(redacted.image_path);
    assert.ok(visible.red>0);assert.equal(visible.green,0);
});

test('pixel decoding uses the validated byte snapshot even if the source changes immediately afterwards',async t=>{
    const {source,view,options}=await fixture(t),replacement=createCanvas(100,50),context=replacement.getContext('2d');
    context.fillStyle='#0000ff';context.fillRect(0,0,100,50);
    const changed=replacement.toBuffer('image/png');let reads=0,swapped=false;
    // Reading the destination for the plan occurs after source validation and before Canvas decoding.
    const racing={...options,get campaignDir(){if(++reads===3){writeFileSync(source,changed);swapped=true;}return options.campaignDir;}};
    const rendered=await renderMapView(view,racing);
    assert.equal(swapped,true);assert.equal(rendered.document,'ready');
    assert.deepEqual(await readFile(source),changed);
    const picture=await pixels(rendered.image_path);assert.ok(picture.red>0);assert.equal(picture.blue,0);
});
