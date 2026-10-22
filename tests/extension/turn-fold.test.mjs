import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {mkdtemp,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(import.meta.dirname,'../..'),temp=await mkdtemp(join(tmpdir(),'turn-fold-'));
await symlink(join(root,'node_modules'),join(temp,'node_modules'),'dir');
await build({stdin:{contents:"export {foldConsumedReads} from './extensions/table/turn-fold.ts';",resolveDir:root},
    outfile:join(temp,'api.mjs'),bundle:true,packages:'external',format:'esm',platform:'node',target:'node24',logLevel:'silent'});
const {foldConsumedReads}=await import(pathToFileURL(join(temp,'api.mjs')).href);
test.after(()=>rm(temp,{recursive:true,force:true}));
const size=list=>Buffer.byteLength(JSON.stringify(list));
const call=(id,name,args={})=>({role:'assistant',content:[{type:'toolCall',id,name,arguments:args}]});
const result=(id,name,text)=>({role:'toolResult',toolCallId:id,toolName:name,content:[{type:'text',text}],isError:false});
const big=label=>label+' '+'x'.repeat(5000);
const messages=[
    result('old','lookup',big('PRIOR_INPUT')),
    {role:'user',content:[{type:'text',text:'I go to the archive.'}]},
    call('a','lookup'),result('a','lookup',big('FIRST_READ')),
    call('b','apply'),result('b','apply',big('WRITE_RESULT')),
    call('c','place',{action:'move',to:'archive'}),result('c','place',big('PLACE_MOVE')),
    call('d','place',{action:'inspect',name:'archive'}),result('d','place',big('PLACE_INSPECT')),
    call('e','look'),result('e','look',big('LATEST_READ')),
];
const texts=list=>list.map(message=>message.role==='toolResult'?message.content[0].text:'');

test('folds only this input\'s earlier reads, oldest first, keeping pairing and the latest batch',()=>{
    const {messages:out,folded}=foldConsumedReads(messages,1,size);
    assert.deepEqual(folded.map(row=>row.id),['a'],'one read frees the need');
    assert.equal(out.length,messages.length);
    assert.deepEqual(out.map(message=>message.toolCallId),messages.map(message=>message.toolCallId));
    const stub=JSON.parse(out[3].content[0].text);
    assert.equal(stub.folded_read,true);assert.match(stub.head,/^FIRST_READ/);
    const all=foldConsumedReads(messages,1e9,size);
    assert.deepEqual(all.folded.map(row=>row.id),['a','d'],'writes, place moves, the prior input and the latest batch stay');
    for(const marker of ['PRIOR_INPUT','WRITE_RESULT','PLACE_MOVE','LATEST_READ'])
        assert.ok(texts(all.messages).some(text=>text.startsWith(marker)),marker);
});

test('a result folded on an earlier request stays folded with no need',()=>{
    const {folded}=foldConsumedReads(messages,0,size,new Set(['d']));
    assert.deepEqual(folded.map(row=>row.id),['d']);
    assert.deepEqual(foldConsumedReads(messages,0,size).folded,[]);
});

test('disclosed detail and a read repeated after its fold stay whole',()=>{
    const list=[
        {role:'user',content:[{type:'text',text:'I pay the clerk.'}]},
        call('cap','lookup',{kind:'capability',name:'cash'}),result('cap','lookup',big('CAPABILITY_DETAIL')),
        call('sec','mod',{name:'pacing: Time'}),result('sec','mod',big('SECTION_TEXT')),
        call('src','lookup',{kind:'source',query:'clerk'}),result('src','lookup',big('SOURCE_FIRST')),
        call('again','lookup',{kind:'source',query:'clerk'}),result('again','lookup',big('SOURCE_AGAIN')),
        call('last','look'),result('last','look',big('LATEST_READ')),
    ];
    const first=foldConsumedReads(list,1e9,size);
    assert.deepEqual(first.folded.map(row=>row.id),['src','again']);
    const signatures=new Set(first.folded.filter(row=>row.id==='src').map(row=>row.signature));
    const later=foldConsumedReads(list,1e9,size,new Set(['src']),signatures);
    assert.deepEqual(later.folded.map(row=>row.id),['src'],'the repeated read is kept whole');
});
