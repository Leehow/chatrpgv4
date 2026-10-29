/** An answer handed to a run stays readable for that run's continuation after the party moves; the next run drops it. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PendingAnswers} from '../../extensions/kernel/source-answers.ts';

const long={status:'answered',supported:true,prepared:false,authority:'source-consultation',source_refs:[{source_id:'pdf:x',pdf_index:1}],limitations:'',
 excerpts:Array.from({length:10},(_,i)=>({page:i+1,text:`passage ${i} `.repeat(70)}))};

test('a move inside the run keeps the handed answer\'s next page; the next run drops it as before',()=>{
 const rows=[],list=new PendingAnswers(row=>rows.push(row));
 list.hold('c','crossroads',[{focus:'crossroads',question:'q',answer:long}],6,'run-6');
 assert.deepEqual(list.take('c',{scene:'old-mill',run:'run-6'}).held,[],'not carried again at the new place');
 assert.equal(rows.filter(r=>r.event==='held_dropped').length,0,'not dropped inside its run');
 const page=list.read('c',{scene:'old-mill',focus:'crossroads',question:'q',part:1,run:'run-6'}).source_answer;
 assert.equal(page.delivery.part,1,'the read_next it was given still reads');
 assert.equal(list.read('c',{scene:'old-mill',focus:'crossroads',question:'q',part:1,run:'run-7'}).source_answer.cause,'scene_changed','another run cannot');
 list.take('c',{scene:'old-mill',run:'run-7'});
 assert.deepEqual(rows.filter(r=>r.event==='held_dropped').map(r=>r.reason),['scene_change'],'the next run drops it');
});
