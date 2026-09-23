# SL-10 (contract 32.11): thresholds over the stored typed answers of sl10-typed-distribution.mjs. No calls.
# python3 experiments/admission-jev-bank/sl10-analyze.py experiments/admission-jev-bank/results/sl10-bookkeeping/typed-distribution.jsonl
import json,sys,collections
rows=[json.loads(l) for l in open(sys.argv[1]) if l.strip()]
rows=[r for r in rows if 'error' not in r and r.get('lines')]
ADMIT={'authorized','entailed','not_player_action'}
def mass(line):
    p=line.get('probabilities') or {}
    return sum(v for k,v in p.items() if k in ADMIT)
n=len(rows)
print('cases',n, 'by source', collections.Counter(r['source'] for r in rows))
print('lane labels', collections.Counter(r['lane'] for r in rows))
allAdmit=[r for r in rows if all(l['verdict'] in ADMIT for l in r['lines'])]
print('typed: every line admits', len(allAdmit), f"{len(allAdmit)/n:.1%}")
conf=[r['confidence'] for r in allAdmit]
def q(v,p): v=sorted(v); return v[min(len(v)-1,int(p*len(v)))] if v else None
print('typed-admit min-line confidence quantiles', [q(conf,p) for p in (0.1,0.25,0.5,0.75,0.9)])
print('by #lines', collections.Counter(len(r['lines']) for r in rows))
print()
print('rule A: every line admits and min line confidence >= T')
for T in [0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9]:
    fast=[r for r in allAdmit if r['confidence']>=T]
    fa=[r for r in fast if r['lane'] not in ADMIT]
    print(f"T={T:.1f} typed-admitted {len(fast):4d} lane-called {1-len(fast)/n:6.1%} false-admits(lane refused) {len(fa)}")
print('rule B: every line admits and min admit-mass >= T')
for T in [0.5,0.6,0.7,0.8,0.85,0.9,0.95]:
    fast=[r for r in allAdmit if min(mass(l) for l in r['lines'])>=T]
    fa=[r for r in fast if r['lane'] not in ADMIT]
    print(f"T={T:.2f} typed-admitted {len(fast):4d} lane-called {1-len(fast)/n:6.1%} false-admits {len(fa)}")
# lane refused cases: what typed said
ref=[r for r in rows if r['lane'] not in ADMIT]
print('lane-refused', len(ref), 'typed all-admit among them', sum(1 for r in ref if all(l['verdict'] in ADMIT for l in r['lines'])))
single=[r for r in rows if len(r['lines'])==1]
print('single-line cases', len(single), 'all-admit', sum(1 for r in single if r['lines'][0]['verdict'] in ADMIT))
