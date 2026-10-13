import {expect,it} from 'vitest';
import {projectRunProgress} from '../src/run-progress.js';

it('projects actual pre-inference work without private arguments or labels',()=>{
  const row={customType:'coc-telemetry',data:{lane:'run',type:'operation_prepared',turn:3,runId:'run',sequence:5,at:123,
    operation:'read',label:'PRIVATE TARGET',params:{secret:'PRIVATE'}}};
  expect(projectRunProgress(row)).toEqual({run:'run',sequence:5,turn:3,timestamp:123,phase:'reading'});
  expect(projectRunProgress({...row,data:{...row.data,operation:'arbitrary private label'}})).toBeUndefined();
});

it('reports the final writer as a phase, not a fabricated model tool',()=>{
  expect(projectRunProgress({customType:'coc-telemetry',data:{lane:'run',type:'operation_prepared',turn:3,runId:'r',sequence:9,at:4,operation:'final_output'}})?.phase).toBe('writing');
});
