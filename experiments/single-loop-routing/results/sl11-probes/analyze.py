import json,sys,glob,os,statistics as st
def live_actions(s):
    rows=[m for m in s['match'] if m['matched'] is not None]
    if s['fixture'].endswith('turn3'):
        acts=[m for m in rows if not m['baseline'].startswith(('time','narrate'))]
        clues=[m for m in acts if m['baseline'].startswith('clue ')]
        other=[m for m in acts if not m['baseline'].startswith('clue ')]
        n=len(other)+(1 if clues else 0); ok=sum(1 for m in other if m['matched'])+(1 if clues and all(m['matched'] for m in clues) else 0)
        return ok,n
    acts=[m for m in rows if m['baseline'] not in ('ask','narrate')]
    return sum(1 for m in acts if m['matched']),len(acts)
def summarize(d):
    out=[]
    for f in sorted(glob.glob(d+'/run*.summary.json')):
        s=json.load(open(f)); mc=s['model_calls']
        ok,n=live_actions(s)
        out.append(dict(run=s['run'],wall=s['wall_ms']/1000,calls=len(mc),model_s=sum((c['ms'] or 0) for c in mc)/1000,
          out=[c['output'] for c in mc],reason=[c['reasoning'] for c in mc],ms=[c['ms'] for c in mc],first_cache=mc[0]['cache_read'] if mc else None,
          first_in=(mc[0]['input']+mc[0]['cache_read']) if mc else None, cache=[c['cache_read'] for c in mc], inp=[c['input'] for c in mc],
          tools=[c['tools'] for c in mc], actions=f'{ok}/{n}', effort=sorted(set(c['effort'] for c in mc if c.get('effort'))),
          executed=[f"{'H' if c['origin']=='policy' else 'M'}:{c['tool']}{'' if c['ok'] else '!'+str(c['error'])}" for c in s['calls']]))
    return out
for d in sys.argv[1:]:
    rows=summarize(d)
    if not rows: continue
    print('##',os.path.basename(d))
    for r in rows:
        print(f"  run{r['run']}: wall {r['wall']:.1f}s, model {r['model_s']:.1f}s, calls {r['calls']}, actions {r['actions']}, first-call cache {r['first_cache']}/{r['first_in']}, effort {r['effort']}")
        print(f"     out {r['out']} reasoning {r['reason']} s {[round(x/1000,1) if x else None for x in r['ms']]}")
        print(f"     cacheRead {r['cache']} input {r['inp']}")
        print(f"     tools {r['tools']}")
        print(f"     executed {r['executed']}")
    allc=[c for r in rows for c in zip(r['out'],r['reason'],r['ms'])]
    print(f"  MEAN calls {st.mean(r['calls'] for r in rows):.1f}; wall {st.mean(r['wall'] for r in rows):.1f}s; model {st.mean(r['model_s'] for r in rows):.1f}s; out/call {st.mean(o for o,_,_ in allc):.0f}; reasoning/call {st.mean(x or 0 for _,x,_ in allc):.0f}; s/call {st.mean((m or 0) for *_,m in allc)/1000:.1f}; first-call cache {[r['first_cache'] for r in rows]}; actions {[r['actions'] for r in rows]}")
