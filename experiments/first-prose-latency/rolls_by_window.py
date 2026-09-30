# usage: python3 rolls_by_window.py <worktree>/.coc/playtests/<run>/events.jsonl ...  -- per turn: first prose (s), policy rolls (compile|<stage skill>), the Keeper's own resolves, the jev-rolls row (§158)
# window-aligned: every row attributed to the agent window (agent_start..agent_end) it was appended in
import json,sys,statistics as st
def walk(path):
  ev=[json.loads(l) for l in open(path)]
  out=[];T=None;names={}
  for e in ev:
    ty=e.get('type');t=e.get('_recv_mono')
    if ty=='agent_start': T=dict(a0=t,text=None,mech=None,kp=[],pol=[],jr=None); out.append(T)
    if T is None: continue
    if ty=='message_start' and (e.get('message') or {}).get('role')=='user' and T['text'] is None:
      c=e['message'].get('content'); T['text']=c if isinstance(c,str) else ''.join(x.get('text','') for x in c if isinstance(x,dict))
    if ty=='message_update' and e['assistantMessageEvent']['type']=='toolcall_end':
      tc=e['assistantMessageEvent']['toolCall']; names[tc['id']]=tc
    if ty=='tool_execution_end':
      tc=names.get(e['toolCallId'],{})
      if tc.get('name')=='resolve' and not e.get('isError'):
        a=(tc.get('arguments') or {}).get('action',{}); T['kp'].append(a.get('skill') or a.get('rule') or a.get('decision'))
    if ty=='entry_appended':
      d=((e.get('entry') or {}).get('data')) or {}
      if d.get('tool')=='resolve' and d.get('origin')=='policy': T['pol'].append(((d.get('basis') or {}).get('jev_roll') or {}).get('skill') or 'compile')
      if d.get('lane')=='jev-rolls': T['jr']=d
      if (e.get('entry') or {}).get('customType')=='coc-mechanics' and T['mech'] is None: T['mech']=round(t-T['a0'],1)
  return out
if __name__=='__main__':
  for path in sys.argv[1:]:
    print('==',path.split('/')[-2])
    for i,T in enumerate(walk(path)):
      d=T['jr'] or {}; stg=(d.get('stages') or [{}])[0]; a=stg.get('answers') or {}
      rn=(a.get('route') or {}).get('roll_now'); rt=((a.get('route') or {}).get('route') or {})
      print(f" t{i:>2} {T['mech']} | pol {T['pol']} | KP {T['kp']} | jr {d.get('reason')} rn={rn} route={rt.get('choice') if isinstance(rt,dict) else rt} | {(T['text'] or '')[-34:]}")
