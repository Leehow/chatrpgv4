import {test,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {handoutImage} from '../src/coc-handout-images.js';
import {mechanicsEntry} from '../src/coc-view.js';

test('only delivered, current-scope raster bytes reach live/history mechanics presentation',()=>{
 const home=mkdtempSync(join(tmpdir(),'coc-handout-image-'));
 try{
  const campaign=join(home,'.coc/campaigns/test'),assets=join(home,'.coc/module-campaigns/test/modules/book-1/assets');
  mkdirSync(campaign,{recursive:true});mkdirSync(assets,{recursive:true});writeFileSync(join(campaign,'campaign.json'),JSON.stringify({module_id:'book-1'}));
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1cAAAAASUVORK5CYII=','base64'),path=join(assets,'clipping.png');writeFileSync(path,bytes);
  const binding={home,campaign:'test',play_language:'en'},row={kind:'handout',name:'Clipping',document:'ready',media_type:'image/png',path};
  expect(handoutImage(row,binding)).toBe('data:image/png;base64,'+bytes.toString('base64'));
  expect(handoutImage({...row,path:join(campaign,'text.md'),media_type:'text/markdown',image_path:path,image_media_type:'image/png'},binding)).toBe(handoutImage(row,binding));
  expect(handoutImage({...row,visibility:'keeper-only'},binding)).toBeUndefined();
  expect(handoutImage({...row,document:'none'},binding)).toBeUndefined();
  expect(handoutImage({...row,media_type:'image/jpeg'},binding)).toBeUndefined();
  const outside=join(home,'outside.png');writeFileSync(outside,bytes);symlinkSync(outside,join(assets,'escape.png'));
  expect(handoutImage({...row,path:outside},binding)).toBeUndefined();
  expect(handoutImage({...row,path:join(assets,'escape.png')},binding)).toBeUndefined();
  const other=join(home,'.coc/modules/book-2');mkdirSync(other,{recursive:true});writeFileSync(join(other,'foreign.png'),bytes);
  expect(handoutImage({...row,path:join(other,'foreign.png')},binding)).toBeUndefined();
  const raw={type:'custom',id:'delivery',customType:'coc-mechanics',data:{turn:1,mechanics:[row]}};
  const entry=mechanicsEntry(raw,'en',undefined,{},undefined,undefined,binding);
  expect((entry?.presentation?.details as any).mechanics[0].image).toBe(handoutImage(row,binding));
  expect(raw.data.mechanics[0],'presentation bytes must not be persisted into model context').not.toHaveProperty('image');
  const injected=mechanicsEntry({...raw,data:{...raw.data,mechanics:[{...row,path:outside,image:'data:image/png;base64,AAAA'}]}},'en',undefined,{},undefined,undefined,binding);
  expect((injected?.presentation?.details as any).mechanics[0].image).toBeUndefined();
 }finally{rmSync(home,{recursive:true,force:true});}
});
