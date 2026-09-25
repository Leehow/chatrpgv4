"""Per-turn structural triage of a driver table (same columns as the long-gate triage): python3 triage.py <campaign> <run>"""
import json, sys, os, glob, collections, statistics
W=os.environ.get('WT','/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b6'); CID, RUN = sys.argv[1], sys.argv[2]
C=os.path.join(os.environ.get('PI_COC_HOME',W),'.coc','campaigns',CID); P=f'{W}/.coc/playtests/{RUN}'
rows=[json.loads(l) for l in open(f'{C}/telemetry.jsonl') if l.strip()]
by=collections.defaultdict(list)
for r in rows: by[r.get('turn')].append(r)
def mech(t):
    p=f'{C}/turns/{t:04d}.json'
    if not os.path.exists(p): return [], None
    rec=json.load(open(p)); return rec.get('mechanics') or [], rec
print('turn | wall(driver) | provider calls (ms) | prescreen | compile sel | routes | binds (path) | admission (origin verb:verdict:path:ms) | looks | drops | budget | run_end | mechanics | closed')
walls=[]; allcalls=0; adm=[]; looks_total=0; stranded=[]; errors=[]; speech=collections.Counter(); infer_bind=0; san=[]
for dt in sorted(glob.glob(f'{P}/turn-*.json'), key=lambda p:int(p.split('-')[-1][:-5])):
    d=json.load(open(dt)); n=d['turn']; walls.append(d['wall_seconds'])
    # the driver's turn N is the kernel's turn N (turn 0 is the opening)
    R=by.get(n,[])
    pc=[r for r in R if r.get('lane')=='provider-call']; allcalls+=len(pc)
    errors+= [ (n,r.get('stop_reason'),r.get('error')) for r in pc if r.get('stop_reason')=='error']
    pre=[f"{(r.get('prescreen') or {}).get('status')}({len(r.get('candidates') or [])}c,{(r.get('prescreen') or {}).get('ms')}ms{','+str((r.get('prescreen') or {}).get('fallback')) if (r.get('prescreen') or {}).get('fallback') else ''})" for r in R if r.get('lane')=='run' and r.get('event')=='read']
    comp=[ (f"{r['reason']}->{','.join(r['selected'])}" if r.get('selected') else r.get('reason')) for r in R if r.get('lane')=='route' and r.get('purpose')=='compile']
    routes=[ (r.get('exit') or '')+('*' if r.get('selected') else '') for r in R if r.get('lane')=='route' and r.get('purpose')=='route']
    binds=[f"{str(r.get('candidate','')).split(':')[1] if ':' in str(r.get('candidate','')) else r.get('candidate')}:{r.get('status')}[{','.join(sorted(set(b.get('path','') for b in r.get('bindings',[]))))}]" for r in R if r.get('lane')=='run' and r.get('event')=='bind']
    infer_bind+=sum(1 for r in R if r.get('lane')=='run' and r.get('type')=='step_start' and r.get('kind')=='infer' and r.get('purpose')=='bind')
    ad=[r for r in R if r.get('lane')=='admission' and not r.get('skipped')]; adm+= [(n,r) for r in ad]
    adms=[f"{(r.get('origin') or '?')[0]}{r.get('verb')}:{r.get('verdict')}:{r.get('path')}:{r.get('ms')}" for r in ad]
    lk=[t for t in d.get('tools') or [] if t['name'] in ('look','lookup')]; looks_total+=len(lk)
    looks=[f"{t['name']}{json.dumps(t.get('args'),ensure_ascii=False)[:40]}" for t in lk]
    drops=[r.get('reason') for r in R if r.get('lane')=='delivery' and r.get('ok') is False]
    bud=[f"{r.get('elapsed_ms')}/{r.get('budget_ms')}" for r in R if r.get('lane')=='run' and r.get('event')=='budget' and r.get('decision')=='model_batch']
    ends=[(r.get('status'),r.get('reason')) for r in R if r.get('lane')=='run' and r.get('type')=='run_end']
    if any(s!='delivered' for s,_ in ends): stranded.append(n)
    for r in R:
        if r.get('lane')=='speech': speech['resolved']+=r.get('resolved',0); speech['unresolved']+=r.get('unresolved',0)
    m,rec=mech(n)
    ms=[(x.get('kind'), x.get('skill') or x.get('to') or x.get('resource') or x.get('name') or '', x.get('roll') or x.get('after') or '') for x in m]
    san+= [n for x in m if x.get('kind')=='roll' and str(x.get('skill')).upper() in ('SAN','SANITY')]
    rd=[r for r in R if r.get('lane')=='reading' and (r.get('phase') or r.get('event') in ('stalled','unwaited','concurrency'))]
    reads=[f"{r.get('purpose')}:{r.get('focus','')}:{r.get('phase') or r.get('event')}:{r.get('ms','')}{'' if r.get('ok',True) else ':FAIL'}" for r in rd if r.get('phase') in ('read','index') or r.get('event')=='stalled' or r.get('ok') is False]
    srcs=[t for t in d.get('tools') or [] if t['name']=='lookup' and (t.get('args') or {}).get('kind')=='source']
    timeouts=sum(1 for t in d.get('tools') or [] if 'reading_timeout' in (t.get('result_text') or ''))
    closed=f"{(rec or {}).get('closed_by')}/{(rec or {}).get('closed_how')}" if rec else 'no-record'
    print(f"{n} | {d['wall_seconds']:.1f} {d.get('settle_class')} | {len(pc)} ({sum(r.get('ms',0) for r in pc)}) | {' / '.join(pre) or '-'} | {'; '.join(comp) or '-'} | {','.join(routes) or '-'} | {'; '.join(binds) or '-'} | {','.join(adms) or '-'} | {','.join(looks) or 0} | {drops} | {' '.join(bud)} | {ends} | {ms} | {closed} | reads {reads} src_lookups {len(srcs)} reading_timeouts {timeouts}")
print('\n=== table-wide')
w=sorted(walls); print('walls', [round(x) for x in walls]); 
if w: print('median', round(statistics.median(w),1), '<=60s', sum(1 for x in w if x<=60), '/', len(w), 'max', round(max(w),1))
print('provider calls', allcalls, 'provider errors', errors)
print('infer(bind) steps', infer_bind)
print('admission paths', collections.Counter((r.get('origin'),r.get('path')) for _,r in adm))
print('admission max ms', max([r.get('ms') or 0 for _,r in adm] or [0]), 'review_timeout', [(n,r.get('verb')) for n,r in adm if r.get('verdict')=='review_timeout'])
print('verdicts', collections.Counter(r.get('verdict') for _,r in adm))
print('looks', looks_total, 'stranded/undelivered turns', stranded, 'speech', dict(speech), 'sanity rolls on turns', san)
