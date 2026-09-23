import json,sys,glob,os
for d in sys.argv[1:]:
    print('##',os.path.basename(d))
    for f in sorted(glob.glob(d+'/run*.summary.json')):
        s=json.load(open(f)); mc=s['model_calls']
        for t in sorted(set(c['turn'] for c in mc)):
            cs=[c for c in mc if c['turn']==t]
            reads=sum(1 for c in cs if any(x in ('look','lookup') for x in c['tools']))
            readonly=sum(1 for c in cs if c['tools'] and all(x in ('look','lookup','recall') for x in c['tools']))
            print(f"  run{s['run']} turn{t}: calls {len(cs)}, calls with a look/lookup {reads}, read-only calls {readonly}, model s {sum(c['ms'] or 0 for c in cs)/1000:.1f}, out {sum(c['output'] for c in cs)}, reasoning {sum(c['reasoning'] or 0 for c in cs)}; tools {[c['tools'] for c in cs]}")
