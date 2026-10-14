/** Structural budget regression; full variation reads and persistence purity remain in tests/integration/npc-variation.test.ts. */
import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {mkdtemp,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root=resolve(import.meta.dirname,'../..'),temporary=await mkdtemp(join(tmpdir(),'npc-variation-budget-'));
after(()=>rm(temporary,{recursive:true,force:true}));
await symlink(join(root,'node_modules'),join(temporary,'node_modules'),'dir');
await build({stdin:{contents:"export {fitPresent,BUDGETS} from './kernel-ts/read/assemble.ts'; export {jsonSize} from './kernel-ts/read/capsule.ts';",
    resolveDir:root,sourcefile:'npc-variation-budget-api.ts'},outfile:join(temporary,'api.mjs'),bundle:true,packages:'external',
    format:'esm',platform:'node',target:'node22',logLevel:'silent'});
const {fitPresent,BUDGETS,jsonSize}=await import(pathToFileURL(join(temporary,'api.mjs')).href);

function person(index){
    const name=index<2?'Alex':`Witness ${index}`;
    const incapacitated=index%2?'dying':'unconscious';
    return {name,kind:'person',untold:{id:`witness-${index}`,say_name:`name-token-${index}`},
        state:{conditions:['major_wound',incapacitated],incapacitated:[incapacitated],
            cannot_act:`${name} is ${incapacitated} and takes no action of their own. The rescuer must target witness-${index}. `
                +'First Aid stabilizes a dying person first. Rest returns no hit point while the major wound is ticked; the weekly recovery roll is the next one the rules run themselves. '.repeat(3)},
        activity:{wakefulness:index%2?'asleep':'awake',since_turn:index+1,source:'committed'},
        variation:{stable:{temperament:`Portrayal ${index}: `+'Patient but firm about commitments. '.repeat(120),
            values:'Protect the dignity of others. '.repeat(120),speech:'Choose a concrete and careful answer. '.repeat(120)},
            initial:{emotion:'Tired after a long shift.',social:'Reserved with unfamiliar visitors.'},origin:'table_random',since_turn:index+1}};
}

function assertAuthority(rows,original){
    assert.equal(rows.length,original.length,'every actor remains in the scene');
    assert.deepEqual(rows.map(row=>row.untold.id),original.map(row=>row.untold.id),'duplicate names cannot realign actor state');
    assert.equal(new Set(rows.map(row=>row.untold.id)).size,rows.length,'no actor is duplicated');
    for(const [index,row] of rows.entries()){
        assert.equal(row.name,original[index].name);
        assert.equal(row.kind,original[index].kind);
        assert.equal(row.untold.say_name,original[index].untold.say_name);
        for(const field of ['state','activity']){
            assert.equal(Object.hasOwn(row,field),Object.hasOwn(original[index],field),`${field} belongs only to its actor`);
            assert.deepEqual(row[field],original[index][field],`${field} survives without truncating its authoritative content`);
        }
    }
}

test('nine long individuality dossiers become stubs while every physical state and activity remains aligned',()=>{
    const accepted=Array.from({length:9},(_,index)=>person(index)),before=structuredClone(accepted);
    // The caller supplies a projection copy; fitPresent intentionally fits that array in place.
    const rows=structuredClone(accepted);
    assert.ok(fitPresent(rows,BUDGETS.present));
    assert.ok(rows.every(row=>row.truncated&&!row.variation),'this fixture forces whole-dossier stubs');
    assertAuthority(rows,before);
    assert.ok(jsonSize(rows)>BUDGETS.present,'mandatory body and activity authority is restored outside the dossier allowance');
    assert.ok(jsonSize(rows.map(({state,activity,...dossier})=>dossier))<=BUDGETS.present);
    assert.deepEqual(accepted,before,'fitting a caller projection leaves its complete accepted dossiers and variation untouched');
});

test('missing physical or activity state stays absent through a mixed crowded cut',()=>{
    const original=Array.from({length:9},(_,index)=>person(index));
    delete original[0].state;
    delete original[2].activity;
    delete original[4].state;delete original[4].activity;
    original[8]={name:'Guard dog',kind:'creature',untold:{id:'guard-dog',say_name:'dog-name-token'},
        state:{conditions:['unconscious'],incapacitated:['unconscious'],cannot_act:'Guard dog is unconscious and takes no action.'},
        activity:{wakefulness:'asleep',since_turn:2,source:'committed'},description:'A large guard dog by the gate. '.repeat(300)};
    const before=structuredClone(original),rows=structuredClone(original);
    assert.ok(fitPresent(rows,1000));
    assert.ok(rows.some(row=>row.truncated),'the same pressure reaches actual stubs');
    assertAuthority(rows,before);
    assert.deepEqual(original,before,'read-side source data remains complete when its projection is fitted');
});
