import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const temp=await mkdtemp(join(tmpdir(),'source-blocks-test-'));
after(()=>rm(temp,{recursive:true,force:true}));
await build({entryPoints:[resolve(import.meta.dirname,'../../extensions/module/source-blocks.ts')],outfile:join(temp,'api.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent'});
const {layoutBlocks,columnGutter,roughTokens}=await import(pathToFileURL(join(temp,'api.mjs')).href);

// A two-column page shaped like Blood Road p20: body paragraphs in one face at 25pt spacing, Keeper boxes in another
// face at 17pt spacing laid between them (and emitted after them by the text layer), the last box running over into the
// top of the right column, then a new section in the right column.
const line=(text,x,y,font='body',width=300)=>({text,x,y,width,height:14,font});
function page20(){
 const body=[line('Russ body one,',47,70),line('Russ body two.',47,95),
  line('Nate: retired trucker,',47,347),line('lives on Ridge Road.',47,372),
  line('Steve: nearly seventy,',47,649),line('says what he thinks.',47,674)];
 const boxes=[line('Keeper note',51,178,'box',70),line('Russ fears the gang,',51,195,'box'),line('but helps the PCs.',51,212,'box'),
  line('Keeper note',51,555,'box',70),line('Nate does not care.',51,571,'box'),
  line('Keeper note',51,784,'box',70),line('Steve ignores the town; convincing him',51,800,'box'),line('is hard. Unless',51,817,'box')];
 const right=[line('there is ironclad evidence, rolls need a Hard success.',385,66,'box'),line('2. Wieland Estates',375,125,'heading',120),
  line('Entry: a billboard,',375,152),line('faded and shot.',375,178)];
 return [...body,...right,...boxes];
}

test('p20 layout keeps Keeper boxes apart, in column order, and marks the right-column continuation',()=>{
 const page=layoutBlocks(20,page20(),736);
 assert.equal(page.image_only,false);
 const texts=page.blocks.map(block=>block.text.replace(/\n/g,' '));
 assert.deepEqual(texts,['Russ body one, Russ body two.','Keeper note Russ fears the gang, but helps the PCs.','Nate: retired trucker, lives on Ridge Road.',
  'Keeper note Nate does not care.','Steve: nearly seventy, says what he thinks.','Keeper note Steve ignores the town; convincing him is hard. Unless',
  'there is ironclad evidence, rolls need a Hard success.','2. Wieland Estates','Entry: a billboard, faded and shot.']);
 assert.deepEqual(page.blocks.map(block=>block.column),[0,0,0,0,0,0,1,1,1]);
 assert.equal(page.blocks[6].continues,page.blocks[5].id);
 assert.equal(page.blocks.filter(block=>block.continues).length,1);
 for(const [i,block] of page.blocks.entries()){assert.equal(block.order,i);assert.match(block.id,/^b20-\d+-[0-9a-f]{8}$/);}
});

test('block ids are stable for the same items in any emission order',()=>{
 const items=page20(),again=layoutBlocks(20,[...items].reverse(),736);
 assert.deepEqual(layoutBlocks(20,items,736).blocks.map(block=>block.id),again.blocks.map(block=>block.id));
});

test('a column ending on a sentence close is not continued',()=>{
 const items=page20().map(item=>item.text==='is hard. Unless'?{...item,text:'is hard.'}:item);
 assert.equal(layoutBlocks(20,items,736).blocks.some(block=>block.continues),false);
});

test('a page without text items is image only; a single-column page has no gutter',()=>{
 assert.deepEqual(layoutBlocks(18,[],736),{page:18,image_only:true,blocks:[]});
 assert.deepEqual(layoutBlocks(18,[{text:'  ',x:1,y:1,width:1,height:10}],736).image_only,true);
 const single=Array.from({length:12},(_,i)=>line(`wide line ${i}`,40,60+i*25,'body',640));
 assert.equal(columnGutter(single,736),null);
 assert.equal(layoutBlocks(5,single,736).blocks.length,1);
});

test('rough tokens are bytes over three',()=>{
 assert.equal(roughTokens('abc'),1);
 assert.equal(roughTokens(''),0);
});
