import {expect,it} from 'vitest';
import {playerTranscript,type ChatMessage} from './transcript-model';
it('keeps story and mechanics while omitting Keeper work and premature source text',()=>{
 const rows:ChatMessage[]=[
  {id:'u',role:'user',content:'I enter.'},
  {id:'t',role:'tool',content:'Secret identity'},
  {id:'draft',role:'assistant',content:'Provisional secret',streaming:true},
  {id:'work',role:'assistant',content:'',thinking:'Hidden motive'},
  {id:'story',role:'assistant',content:'The door opens.',thinking:'Hidden motive',tools:[{id:'tool',name:'lookup',input:'secret',result:'killer',startedAt:0}],activities:[{type:'text',id:'text',contentIndex:0,content:'The door opens.'},{type:'thinking',id:'thought',contentIndex:1,content:'Secret'}]},
  {id:'dice',role:'assistant',content:'',presentation:{renderer:'coc-mechanics',details:{mechanics:[]}}},
 ];
 const view=playerTranscript(rows);
 expect(view.map(r=>r.id)).toEqual(['u','story','dice']);
 expect(JSON.stringify(view)).not.toMatch(/Secret|secret|killer|Hidden/);
 expect(rows[4].thinking).toBe('Hidden motive');
});
