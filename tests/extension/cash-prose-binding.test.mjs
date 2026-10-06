import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';

async function api(path){
    const built=await build({entryPoints:[path],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'});
    return import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
}
const {bindPriceText,priceRows}=await api('shared/cash-prose.js');
const {LiveDeliveryProse,displayedProse}=await api('Electron/packages/pi-backend/src/live-prose.ts');
const items=[{name:'Gasoline',quantity:10,unit_price:0.55}];
const expense={kind:'cash',bill:'Fill-up',items};
const template='The attendant starts pumping. "Per gallon {{price:Fill-up:unit}}, {{price:Fill-up:quantity}} gallons, total {{price:Fill-up:total}}."';
const expected='The attendant starts pumping. "Per gallon 0.55, 10 gallons, total 5.5."';

test('one bill binds identical unit, quantity and total in live speech and settled prose despite zero cash delta',()=>{
    const receipt={...expense,id:'cash:t2-c1',delta:0,purchase_amount:5.5};
    assert.equal(bindPriceText(template,priceRows([receipt])).text,expected);
    assert.equal(displayedProse(template,priceRows([expense])),expected);
    assert.deepEqual(items,[{name:'Gasoline',quantity:10,unit_price:0.55}]);
});
test('exact decimal line sums, explicit multi-line selectors and ambiguous aliases',()=>{
    const row={quote:'Counter',items:[{name:'Water',quantity:2,unit_price:0.5},{name:'Cigarettes',quantity:1,unit_price:1.75}]};
    assert.equal(bindPriceText('{{price:Counter:1:unit}} / {{price:Counter:2:amount}} / {{price:Counter:total}}',[row]).text,'0.5 / 1.75 / 2.75');
    assert.equal(bindPriceText('{{price:Counter:unit}}',[row]).text,'\u2026');
    assert.equal(bindPriceText('{{price:Counter:total}}',[row,row]).text,'\u2026');
    const tenths={bill:'Change',items:[{name:'One',quantity:1,unit_price:0.1},{name:'Two',quantity:1,unit_price:0.2}]};
    assert.equal(bindPriceText('{{price:Change:total}}',[tenths]).text,'0.3');
});
test('an invalid zero, missing or incomplete price never becomes a guessed zero in speech',()=>{
    const bad={...expense,items:[{name:'Gasoline',quantity:10,unit_price:0}]};
    for(const rows of [[],[bad],[{...expense,items:[{quantity:10}]}]])assert.equal(displayedProse('Cost {{price:Fill-up:total}}.',rows),'Cost \u2026.');
});
test('exact decimal strings bind through the same field and reject non-decimal spellings',()=>{
    const precise={...expense,items:[{name:'Gasoline',quantity:10,unit_price:'0.55'}]};
    assert.equal(bindPriceText(template,priceRows([precise])).text,expected);
    for(const unit_price of ['0.00','0.55 USD','0.5 + 0.05','free'])assert.equal(
        bindPriceText('{{price:Fill-up:total}}',[{...precise,items:[{quantity:10,unit_price}]}]).text,'\u2026');
});
test('legacy total-only bills bind their nominal price, never the zero coverage delta',()=>{
    assert.equal(bindPriceText('{{price:Fill-up:total}}',[{kind:'cash',bill:'Fill-up',category:'living',delta:-9}]).text,'9');
    assert.equal(bindPriceText('{{price:Fill-up:total}}',[{kind:'cash',bill:'Fill-up',category:'living',delta:0,purchase_amount:9}]).text,'9');
    assert.equal(bindPriceText('{{price:Fill-up:unit}}',[{kind:'cash',bill:'Fill-up',delta:0,purchase_amount:9}]).text,'\u2026');
});
test('a fully received bill binds while closing prose streams; partial decimals are held',()=>{
    const live=new LiveDeliveryProse('prices');live.start(0,'apply');
    assert.equal(live.update(0,'{"effects":[{"kind":"cash","bill":"Fill-up","items":[{"quantity":10,"unit_price":0'),undefined);
    const prefix=JSON.stringify({effects:[expense]}).slice(0,-1)+',"narrate":"';
    const draw=live.update(0,prefix+template.replaceAll('"','\\"'));
    assert.equal(draw.text,expected);
    assert.equal(live.end(0,{effects:[expense],narrate:template}),undefined,'final arguments do not redraw identical bound prose');
    const encoded=new LiveDeliveryProse('encoded');encoded.start(0,'apply');
    assert.equal(encoded.end(0,JSON.stringify({effects:[expense],narrate:template})).text,expected);
});
test('prose-first offers show words before late price fields; completed fields fill the same draft without a quote RPC',()=>{
    const live=new LiveDeliveryProse('offers');live.start(0,'narrate');
    const text='The clerk greets you. Total {{price:Counter:total}}.';
    const first=live.update(0,'{"text":'+JSON.stringify(text).slice(0,-1));
    assert.equal(first.text,'The clerk greets you. Total \u2026.');
    const quote={quote:'Counter',items};
    const last=live.end(0,{text,quotes:[quote]});
    assert.equal(last.id,first.id);assert.equal(last.first,false);assert.equal(last.text,'The clerk greets you. Total 5.5.');
});
