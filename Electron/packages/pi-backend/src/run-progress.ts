import type {RunProgressFrame} from '@pipi/host-api';

/** Project closed driver phases only; private labels and arguments never leave telemetry. */
export function projectRunProgress(row:any):RunProgressFrame|undefined {
  const d=row?.customType==='coc-telemetry'?row.data:undefined;
  if(d?.lane!=='run'||typeof d.runId!=='string'||!Number.isSafeInteger(d.sequence)
    ||!Number.isSafeInteger(d.turn)||!Number.isFinite(d.at))return;
  let phase:RunProgressFrame['phase']|undefined;
  if(d.type==='run_start'||d.type==='step_start'&&d.kind==='decide')phase='checking';
  else if(d.type==='step_start'&&d.kind==='infer')phase='thinking';
  else if(d.type==='operation_prepared')phase=({read:'reading',execute:'settling',final_output:'writing'} as const)[d.operation as 'read'|'execute'|'final_output'];
  if(phase)return {run:d.runId,sequence:d.sequence,turn:d.turn,timestamp:d.at,phase};
}
