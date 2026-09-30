# usage: python3 prose_first_by_window.py <worktree>/.coc/playtests/<run>/events.jsonl ...  -- flag-on runs (name contains "-on-"): first visible prose per the §157 metric, withdrawals, re-sends; flag-off: first coc-mechanics entry
# prose-first analysis, window-aligned (every row/event attributed to the agent window it arrived in)
import json,sys,statistics as st
def walk(path):
  ev=[json.loads(l) for l in open(path)]
  out=[];T=None
  for e in ev:
    ty=e.get('type');t=e.get('_recv_mono')
    if ty=='agent_start':
      T=dict(a0=t,text=None,mech=None,first_delta=None,msg_first=[],cur=None,pf=None,delivered=False); out.append(T)
    if T is None: continue
    if ty=='message_start':
      m=e.get('message') or {}
      if m.get('role')=='user' and T['text'] is None:
        c=m.get('content'); T['text']=c if isinstance(c,str) else ''.join(x.get('text','') for x in c if isinstance(x,dict))
      if m.get('role')=='assistant': T['cur']={'first':None}; T['msg_first'].append(T['cur'])
    if ty=='message_update':
      ae=e.get('assistantMessageEvent') or {}
      if ae.get('type')=='text_delta' and (ae.get('delta') or '').strip():
        if T['first_delta'] is None: T['first_delta']=t-T['a0']
        if T['cur'] is not None and T['cur']['first'] is None: T['cur']['first']=t-T['a0']
    if ty=='entry_appended':
      en=e.get('entry') or {}; d=en.get('data') or {}
      if d.get('lane')=='prose-first': T['pf']=d
      if en.get('customType')=='coc-mechanics' and T['mech'] is None: T['mech']=t-T['a0']
  return out
def fv(T,on):
  if not on: return T['mech']
  pf=T['pf'] or {}
  if T['mech'] is None and not pf.get('committed') and pf.get('close') is None: return None
  if not pf.get('shown_then_withdrawn'): return T['first_delta']
  firsts=[m['first'] for m in T['msg_first'] if m['first'] is not None]
  return firsts[-1] if firsts else T['mech']
for path in sys.argv[1:]:
  on='-on-' in path
  ts=walk(path)
  vals=[]; allv=[]; wd=0; li=0; lid=0; rs=[]
  print('==',path.split('/')[-2])
  for i,T in enumerate(ts):
    v=fv(T,on); pf=T['pf'] or {}
    if i>0 and v is not None: vals.append(v)
    if v is not None: allv.append(v)
    if pf.get('shown_then_withdrawn'): wd+=1
    li+=pf.get('lead_ins',0) or 0; lid+=pf.get('lead_ins_delivered',0) or 0; rs+=pf.get('resent') or []
    probs=[(p.get('kind'),p.get('reason') or p.get('kernel_reason')) for p in pf.get('problems') or []]
    print(f" t{i:>2} first {None if v is None else round(v,1)} | mech {None if T['mech'] is None else round(T['mech'],1)} | {'W ' if pf.get('shown_then_withdrawn') else ''}close={pf.get('close')} shape={pf.get('shape')} lead={pf.get('lead_ins')} resent={pf.get('resent')} probs={probs[:4]} | {(T['text'] or '')[-24:]}")
  print(f"   first-prose median excl. opening {round(st.median(vals),1) if vals else None} n={len(vals)}; incl. {round(st.median(allv),1) if allv else None} | withdrawn turns {wd} | lead-ins {li} delivered {lid} | resent {rs}")
