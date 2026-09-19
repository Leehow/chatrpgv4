import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,symlink,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {renderMapView} from '../../extensions/kernel/map-view.ts';

async function source(root) {
  const path=join(root,'module','source.png');
  await mkdir(join(root,'module'),{recursive:true});
  const canvas=createCanvas(100,50),ctx=canvas.getContext('2d');
  ctx.fillStyle='#ff0000';ctx.fillRect(0,0,50,50);
  ctx.fillStyle='#0000ff';ctx.fillRect(50,0,50,50);
  await writeFile(path,canvas.toBuffer('image/png'));
  return path;
}

test('the conversation derivative contains authorized pixels and no unrevealed source half',async()=>{
  const root=await mkdtemp(join(tmpdir(),'coc-map-')),path=await source(root),campaignDir=join(root,'.coc/campaigns/c1');
  const result=await renderMapView({map:'house',name:'House',source_revision:'g1',regions:[{id:'entry',label:'Entry'}],render:{layers:[
    {path,source_box:[0,0,.5,1],placement:[0,0,.5,1],redactions:[]},
  ]}},{modulesRoot:join(root,'module'),campaignDir,receipt:'map:house-t1'});
  assert.equal(result.document,'ready');
  assert.match(result.image,/^data:image\/png;base64,/);
  const image=await loadImage(Buffer.from(result.image.split(',')[1],'base64'));
  const canvas=createCanvas(image.width,image.height),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
  const pixels=ctx.getImageData(0,0,image.width,image.height).data;
  let red=0,blue=0;for(let i=0;i<pixels.length;i+=4){if(pixels[i]>200&&pixels[i+2]<40)red++;if(pixels[i+2]>200&&pixels[i]<40)blue++;}
  assert.ok(red>0);assert.equal(blue,0);
});

test('a reviewed source digest fails closed when same region id bytes change',async()=>{
  const root=await mkdtemp(join(tmpdir(),'coc-map-revision-')),path=await source(root),campaignDir=join(root,'.coc/campaigns/c1');
  const reviewed=createHash('sha256').update(await readFile(path)).digest('hex');
  const view={map:'house',name:'House',source_revision:'g1',regions:[{id:'entry',label:'Entry'}],render:{layers:[
    {path,source_box:[0,0,1,1],placement:[0,0,1,1],source_digest:reviewed,redactions:[]},
  ]}};
  const historical=await renderMapView(view,{modulesRoot:join(root,'module'),campaignDir,receipt:'map:house-t1'});
  assert.equal(historical.document,'ready');
  const oldBytes=historical.image;
  await writeFile(path,Buffer.from('changed source bytes'));
  const current=await renderMapView(view,{modulesRoot:join(root,'module'),campaignDir,receipt:'map:house-t2'});
  assert.equal(current.document,'none');
  assert.equal(current.image,undefined);
  assert.equal(historical.image,oldBytes);
});

test('a compatible metadata correction keeps the reviewed digest and delivery available',async()=>{
  const root=await mkdtemp(join(tmpdir(),'coc-map-compatible-')),path=await source(root),campaignDir=join(root,'.coc/campaigns/c1');
  const digest=createHash('sha256').update(await readFile(path)).digest('hex');
  const view=(label)=>({map:'house',name:'House',source_revision:'g1',regions:[{id:'entry',label}],render:{layers:[
    {path,source_box:[0,0,1,1],placement:[0,0,1,1],source_digest:digest,redactions:[]},
  ]}});
  const first=await renderMapView(view('Entry'),{modulesRoot:join(root,'module'),campaignDir,receipt:'map:house-t1'});
  const correction=await renderMapView(view('Main entrance'),{modulesRoot:join(root,'module'),campaignDir,receipt:'map:house-t2'});
  assert.equal(first.document,'ready');assert.equal(correction.document,'ready');
  assert.equal(correction.source_revision,'g1');assert.equal(correction.image.startsWith('data:image/png;base64,'),true);
});

test('a source outside the module jail produces no player image',async()=>{
  const root=await mkdtemp(join(tmpdir(),'coc-map-jail-')),path=await source(root);
  const result=await renderMapView({map:'house',name:'House',regions:[{id:'entry',label:'Entry'}],render:{layers:[
    {path,source_box:[0,0,1,1],placement:[0,0,1,1],redactions:[]},
  ]}},{modulesRoot:join(root,'somewhere-else'),campaignDir:join(root,'.coc/campaigns/c1')});
  assert.equal(result.document,'none');assert.equal(result.image,undefined);
});

test('the exact campaign-private module root is a legitimate map source jail',async()=>{
  const root=await mkdtemp(join(tmpdir(),'coc-map-private-')),shared=join(root,'.coc/modules'),campaign='c1',
    privateRoot=join(root,'.coc/module-campaigns',campaign,'modules'),path=await source(privateRoot);
  const result=await renderMapView({map:'house',name:'House',regions:[{id:'entry',label:'Entry'}],render:{layers:[
    {path,source_box:[0,0,1,1],placement:[0,0,1,1],redactions:[]},
  ]}},{modulesRoot:shared,sourceRoots:[privateRoot],campaignDir:join(root,'.coc/campaigns',campaign)});
  assert.equal(result.document,'ready');assert.match(result.image,/^data:image\/png;base64,/);
});

test('an alternate-source secret layer keeps reviewed redactions and does not use the investigator pixels',async()=>{
  const root=await mkdtemp(join(tmpdir(),'coc-map-secret-')),modules=join(root,'module');
  await mkdir(modules,{recursive:true});
  const investigator=join(modules,'investigator.png'),keeper=join(modules,'keeper.png');
  const player=createCanvas(100,50),playerCtx=player.getContext('2d');
  playerCtx.fillStyle='#ff0000';playerCtx.fillRect(0,0,50,50);
  playerCtx.fillStyle='#0000ff';playerCtx.fillRect(50,0,50,50);
  await writeFile(investigator,player.toBuffer('image/png'));
  const cellar=createCanvas(100,50),cellarCtx=cellar.getContext('2d');
  cellarCtx.fillStyle='#ffff00';cellarCtx.fillRect(0,0,100,50);
  cellarCtx.fillStyle='#00ff00';cellarCtx.fillRect(20,10,60,20);
  await writeFile(keeper,cellar.toBuffer('image/png'));
  const result=await renderMapView({map:'house',name:'House',source_revision:'g1',regions:[{id:'secret',label:'Secret'}],render:{layers:[
    {path:keeper,source_asset:'keeper-cellar',source_box:[0,0,1,1],placement:[.08,.73,.48,.98],redactions:[[.2,.2,.8,.6]]},
  ]}},{modulesRoot:modules,campaignDir:join(root,'.coc/campaigns/c1'),receipt:'map:house-t2'});
  assert.equal(result.document,'ready');
  const image=await loadImage(Buffer.from(result.image.split(',')[1],'base64'));
  const canvas=createCanvas(image.width,image.height),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
  const pixels=ctx.getImageData(0,0,image.width,image.height).data;
  let yellow=0,green=0,red=0,blue=0;
  for(let i=0;i<pixels.length;i+=4){
    if(pixels[i]>200&&pixels[i+1]>200&&pixels[i+2]<40)yellow++;
    if(pixels[i+1]>200&&pixels[i]<40&&pixels[i+2]<40)green++;
    if(pixels[i]>200&&pixels[i+2]<40&&pixels[i+1]<40)red++;
    if(pixels[i+2]>200&&pixels[i]<40)blue++;
  }
  assert.ok(yellow>0);
  assert.equal(green,0);
  assert.equal(red,0);
  assert.equal(blue,0);
});

test('a symlink inside the module jail cannot expose an outside image',async()=>{
  const root=await mkdtemp(join(tmpdir(),'coc-map-link-')),outside=await source(root),modules=join(root,'modules');await mkdir(modules);
  const link=join(modules,'linked.png');await symlink(outside,link);
  const result=await renderMapView({map:'house',name:'House',regions:[{id:'entry',label:'Entry'}],render:{layers:[
    {path:link,source_box:[0,0,1,1],placement:[0,0,1,1],redactions:[]},
  ]}},{modulesRoot:modules,campaignDir:join(root,'.coc/campaigns/c1')});
  assert.equal(result.document,'none');assert.equal(result.image,undefined);
});
