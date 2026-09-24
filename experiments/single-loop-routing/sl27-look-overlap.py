"""SL-27: was a replayed look's answer already in what the Keeper had been shown at that step?

Reads run<N>.requests.jsonl (product-entry.ts with SINGLE_LOOP_DUMP_REQUESTS=1). For each look/lookup/recall result, the
request whose replayed answer carried the call is found; the answer's JSON leaf strings of 16 UTF-8 bytes or more are
searched verbatim in three haystacks: the prescreen packet (pre), every coc-clerk carried section in the request (car),
and every message of the request (all). coverage = found bytes / leaf bytes; present >= 0.8, partial >= 0.2, absent
below; an error answer is not scored. Pre-registration and results: docs/specs/pi-native-single-loop-tickets/27-*.md.

    python3 experiments/single-loop-routing/sl27-look-overlap.py results/<dir>/run1.requests.jsonl ...
"""
import json,sys,glob,os
MIN=16
def parse(s):
    try: return json.loads(s)
    except Exception: return None
def leaves(v,out):
    if isinstance(v,str):
        p=parse(v) if v[:1] in '{[' else None
        if isinstance(p,(dict,list)): leaves(p,out)
        else: out.append(v)
    elif isinstance(v,dict):
        for x in v.values(): leaves(x,out)
    elif isinstance(v,list):
        for x in v: leaves(x,out)
def text_leaves(t):
    out=[]
    # a message text may hold prose then JSON; take every JSON object start
    p=parse(t)
    if p is not None: leaves(p,out); return out
    out.append(t)
    i=t.find('{')
    while i>=0:
        j=t.rfind('}')
        p=parse(t[i:j+1]) if j>i else None
        if p is not None: leaves(p,out); break
        i=t.find('{',i+1)
    return out
def coverage(answer,hay):
    a=parse(answer)
    if not isinstance(a,(dict,list)): return None,0
    ls=[]; leaves(a,ls)
    ls=sorted({x for x in ls if len(x.encode())>=MIN})
    tot=sum(len(x.encode()) for x in ls)
    if not tot: return None,0
    hit=sum(len(x.encode()) for x in ls if x in hay)
    return hit/tot,tot
def cls(c):
    return 'n/a' if c is None else 'present' if c>=0.8 else 'partial' if c>=0.2 else 'absent'
def haystacks(req):
    pre=[];car=[];allh=[]
    clerk=None
    for m in req['messages']:
        t=m.get('text') or ''
        L=text_leaves(t); allh+=L
        if '"materials"' in t and ('"request"' in t or '"issued"' in t): pre+=L
        if '{"kind":"single_loop_step"' in t:
            c=parse(t[t.index('{"kind":"single_loop_step"'):t.rindex('}')+1])
            if isinstance(c,dict) and c.get('carried'): leaves(c['carried'],car)
    j=lambda L:'\n'.join(L)
    return j(pre),j(car),j(allh)
def analyse(path):
    rows=[json.loads(l) for l in open(path) if l.strip()]
    reqs=[r for r in rows if r['kind']=='request']; res=[r for r in rows if r['kind']=='read_result']
    used=set(); out=[]
    for r in res:
        # the request whose answer carried this call (same tool and arguments), first unused
        k=next((q for q in reqs if q['request'] not in used and any(a['name']==r['tool'] and a['arguments']==r['input'] for a in q['answer'])),None)
        if k is None: out.append({'tool':r['tool'],'args':r['input'],'note':'no request'}); continue
        pre,car,allh=haystacks(k)
        cp,tot=coverage(r['text'],pre); cc,_=coverage(r['text'],car); ca,_=coverage(r['text'],allh)
        out.append({'request':k['request'],'tool':r['tool'],'args':{x:y for x,y in r['input'].items() if x not in ('question','request')},'ok':r['ok'],'answer_bytes':len(r['text'].encode()),'leaf_bytes':tot,
            'pre':None if cp is None else round(cp,2),'car':None if cc is None else round(cc,2),'all':None if ca is None else round(ca,2),
            'class_pre':cls(cp),'class_car':cls(cc),'class_all':cls(ca),'pre_bytes':len(pre.encode()),'car_bytes':len(car.encode()),'error':None if cp is not None else r['text'][:120]})
    return out
if __name__=='__main__':
    for path in sys.argv[1:]:
        print('==',path)
        for o in analyse(path): print(json.dumps(o,ensure_ascii=False))
