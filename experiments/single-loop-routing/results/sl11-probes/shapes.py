import json,sys,glob,os
# For each consecutive provider request pair: does the earlier request's input (minus its trailing transport items) stay a prefix?
for d in sys.argv[1:]:
    print('##',os.path.basename(d))
    for f in sorted(glob.glob(d+'/run*.trace.jsonl')):
        shapes=[json.loads(l) for l in open(f) if '"provider_request"' in l]
        rows=[]
        prev=None
        for r in shapes:
            inp=r['shape']['input']
            if prev is not None:
                pin=prev['shape']['input']; first=None
                for i in range(min(len(inp),len(pin))):
                    if inp[i]!=pin[i]: first=i;break
                else: first=min(len(inp),len(pin))
                shared=sum(x[1] for x in pin[:first]); total=sum(x[1] for x in pin)
                rows.append(f"t{prev['provider_request']}->t{r['provider_request']} diverge@{first}/{len(pin)} shared {shared*100//max(total,1)}%")
            prev=r
        print(' ',os.path.basename(f)[:4],'; '.join(rows))
