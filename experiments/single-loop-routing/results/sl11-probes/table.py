import json,glob,os,sys,statistics as st
sys.path.insert(0,os.path.dirname(__file__))
from analyze import live_actions
def load(d):
    return [json.load(open(f)) for f in sorted(glob.glob(d+'/run*.summary.json'))]
def row(label,d,turn=0):
    runs=load(d)
    if not runs: return None
    per=[]
    for s in runs:
        mc=[c for c in s['model_calls'] if c.get('turn',0)==turn]
        per.append(mc)
    calls=[len(p) for p in per]
    allc=[c for p in per for c in p]
    out=st.mean(c['output'] for c in allc); rea=st.mean((c['reasoning'] or 0) for c in allc)
    secs=[(c['ms'] or 0)/1000 for c in allc]
    model=[sum((c['ms'] or 0) for c in p)/1000 for p in per]
    walls=[s['wall_ms']/1000 for s in runs]
    first=[p[0]['cache_read'] if p else None for p in per]
    firstin=[(p[0]['cache_read']+p[0]['input']) if p else None for p in per]
    acts=[('%d/%d'%live_actions(s)) for s in runs]
    return f"| {label} | {len(runs)} | {'/'.join(map(str,calls))} | {out:.0f} | {rea:.0f} | {st.median(secs):.1f} ({min(secs):.1f}–{max(secs):.1f}) | {'/'.join('%.0f'%m for m in model)} | {'/'.join('%.0f'%w for w in walls)} | {' '.join(f'{a}/{b}' for a,b in zip(first,firstin))} | {' '.join(acts)} |"
H="| arm | runs | calls/turn | output tok/call | reasoning tok/call | s/call median (range) | model s/turn | wall s | first-call cacheRead/prompt | actions |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"
# Run from anywhere: reads the sibling results/sl11-* directories.
M=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..')
print('turn 3'); print(H)
for label,d in [('before, low','sl11-before-turn3-low'),('after, low','sl11-after-turn3-low'),('after, medium','sl11-after-turn3-medium'),('after, high','sl11-after-turn3-high'),('after, xhigh','sl11-after-turn3-xhigh')]:
    r=row(label,M+'/'+d); print(r) if r else None
print(); print('fight round'); print(H)
for label,d in [('before, low','sl11-before-fight-low'),('after, low','sl11-after-fight-low'),('after, medium','sl11-after-fight-medium'),('after, high','sl11-after-fight-high'),('after, xhigh','sl11-after-fight-xhigh')]:
    r=row(label,M+'/'+d); print(r) if r else None
print(); print('gate turn (turn 1 of game-b5367f88) then its next input'); print(H)
for label,d,t in [('before, low, gate turn','sl11-before-gate2-low',0),('after, low, gate turn','sl11-after-gate2-low',0),('before, low, next turn','sl11-before-gate2-low',1),('after, low, next turn','sl11-after-gate2-low',1)]:
    r=row(label,M+'/'+d,t); print(r) if r else None
