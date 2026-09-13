import assert from 'node:assert/strict';
import {mkdtemp,mkdir,symlink,writeFile} from 'node:fs/promises';
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
  assert.equal(result.available,true);
  assert.match(result.image,/^data:image\/png;base64,/);
  const image=await loadImage(Buffer.from(result.image.split(',')[1],'base64'));
  const canvas=createCanvas(image.width,image.height),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
  const pixels=ctx.getImageData(0,0,image.width,image.height).data;
  let red=0,blue=0;for(let i=0;i<pixels.length;i+=4){if(pixels[i]>200&&pixels[i+2]<40)red++;if(pixels[i+2]>200&&pixels[i]<40)blue++;}
  assert.ok(red>0);assert.equal(blue,0);
});

test('a source outside the module jail produces no player image',async()=>{
  const root=await mkdtemp(join(tmpdir(),'coc-map-jail-')),path=await source(root);
  const result=await renderMapView({map:'house',name:'House',regions:[{id:'entry',label:'Entry'}],render:{layers:[
    {path,source_box:[0,0,1,1],placement:[0,0,1,1],redactions:[]},
  ]}},{modulesRoot:join(root,'somewhere-else'),campaignDir:join(root,'.coc/campaigns/c1')});
  assert.equal(result.available,false);assert.equal(result.image,undefined);
});

test('a symlink inside the module jail cannot expose an outside image',async()=>{
  const root=await mkdtemp(join(tmpdir(),'coc-map-link-')),outside=await source(root),modules=join(root,'modules');await mkdir(modules);
  const link=join(modules,'linked.png');await symlink(outside,link);
  const result=await renderMapView({map:'house',name:'House',regions:[{id:'entry',label:'Entry'}],render:{layers:[
    {path:link,source_box:[0,0,1,1],placement:[0,0,1,1],redactions:[]},
  ]}},{modulesRoot:modules,campaignDir:join(root,'.coc/campaigns/c1')});
  assert.equal(result.available,false);assert.equal(result.image,undefined);
});
