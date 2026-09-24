"""Summarise the import: per worker action (wall, progress stages) and per reading job (reader/review requests, tokens)."""
import json, glob, os, sys, re
from datetime import datetime
W='/Users/haoli/leehow/code/chatrpgv4-wt-pdf-a'; E=f'{W}/.coc/playtests/sl29-a-import'; M=f'{W}/.coc/modules/book-1'
def ts(s): return datetime.fromisoformat(s.replace('Z','+00:00'))
for action in ['inspect','guidance','opening','converse']:
    p=f'{E}/{action}.events.jsonl'
    if not os.path.exists(p): continue
    rows=[json.loads(l) for l in open(p)]
    runs=[]; cur=None
    for r in rows:
        if r.get('type')=='start': cur={'start':r['at'],'events':[]}; runs.append(cur)
        elif r.get('type')=='exit' and cur: cur['exit']=r['at']
        elif cur: cur['events'].append(r)
    for i,run in enumerate(runs):
        wall=(ts(run['exit'])-ts(run['start'])).total_seconds() if 'exit' in run else None
        stages=[]; last=None
        for r in run['events']:
            e=r['event']
            if e['type']=='progress':
                st=e['data'].get('stage')
                if st!=last: stages.append(f"{r['at'][11:19]} {st}{'('+str(e['data'].get('job_id'))+')' if e['data'].get('job_id') else ''}"); last=st
        res=[e['event'] for e in run['events'] if e['event']['type'] in ('result','error')]
        out=res[-1] if res else None
        print(f"{action}#{i+1} wall={wall}s stages=[{', '.join(stages)}]")
        if out: print('   ', out['type'], json.dumps({k:v for k,v in out['data'].items() if k not in ('guidance',)},ensure_ascii=False)[:600])
print()
for job in sorted(glob.glob(f'{M}/work/*')):
    for att in sorted(glob.glob(f'{job}/attempt-*')):
        reqs=glob.glob(f'{att}/*.requests.jsonl'); rev=glob.glob(f'{att}/verify-*/unit-*/*/*.requests.jsonl')
        n=lambda fs: sum(sum(1 for _ in open(f)) for f in fs)
        tok={'in':0,'out':0}
        for f in glob.glob(f'{att}/*.jsonl')+glob.glob(f'{att}/verify-*/unit-*/*/events.jsonl'):
            if f.endswith('requests.jsonl') or f.endswith('images.jsonl'): continue
            for l in open(f):
                if '"message_end"' not in l: continue
                try: ev=json.loads(l)
                except Exception: continue
                u=((ev.get('message') or {}).get('usage')) or {}
                tok['in']+=u.get('input',0)+u.get('cacheRead',0); tok['out']+=u.get('output',0)
        rounds=sorted(glob.glob(f'{att}/verify-*'))
        units=len(glob.glob(f'{att}/verify-*/unit-*'))
        task=json.load(open(f'{att}/task.json')) if os.path.exists(f'{att}/task.json') else {}
        print(f"{os.path.basename(job)}/{os.path.basename(att)} purpose={task.get('purpose')} focus={task.get('focus','')!r} reader_calls={n(reqs)} review_calls={n(rev)} review_rounds={len(rounds)} units={units} tokens_in={tok['in']} out={tok['out']}")
