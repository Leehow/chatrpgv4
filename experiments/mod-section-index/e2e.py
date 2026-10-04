"""End to end over the held-out sample: which package sections would load, scored against the rule labels (judge-b),
over the sections that need no code gate (the `jev`-only ones in cards.v2). Three selectors: topic only (stage 1 at a
threshold), topic + verify (stage 2 at a threshold), and round 2's per-section cards for comparison.
Usage: e2e.py <judge-b dir> <rows-T.jsonl> <rows-V.jsonl|-> <rows-bJ.jsonl>"""
import json, sys, glob
jd, rt, rv, rj = sys.argv[1:5]
labels = {}
for p in sorted(glob.glob(jd + "/labels-[0-9].json")):
    for r in json.load(open(p)): labels[r["sid"]] = r["labels"]
topics = json.load(open("experiments/mod-section-index/topics.json"))
cards = json.load(open("experiments/mod-section-index/cards.v2.json"))["cards"]
jev_only = [c["id"] for c in cards if c["trigger"] == "jev" and c["id"] in topics["sections"] and "gate" not in topics["sections"][c["id"]]]
print("sections scored (jev, no gate):", jev_only)
t1 = {r["sid"]: r["cards"] for r in (json.loads(l) for l in open(rt) if l.strip()) if "cards" in r}
v2 = {r["sid"]: r for r in (json.loads(l) for l in open(rv) if l.strip())} if rv != "-" else {}
rj_rows = {r["sid"]: r["cards"] for r in (json.loads(l) for l in open(rj) if l.strip()) if "cards" in r}

def score(select, name):
    tp = fp = fn = 0; loaded = 0; n = 0
    for sid, l in labels.items():
        if sid not in t1: continue
        n += 1
        for c in jev_only:
            y = l[c] == "yes"; p = select(sid, c)
            tp += y and p; fp += (not y) and p; fn += y and (not p); loaded += p
    P = tp / (tp + fp) if tp + fp else 0; R = tp / (tp + fn) if tp + fn else 0
    print(f"  {name:38s} P {P:.2f} R {R:.2f} F1 {2*P*R/(P+R) if P+R else 0:.2f}  loaded/turn {loaded/n:.2f}  (tp {tp} fp {fp} fn {fn})")

def topic_score(sid, c):
    return max(t1[sid].get(t, 0) or 0 for t in topics["sections"][c]["topics"])
print("\nagainst rule labels, held-out 110:")
for thr in (0.35, 0.5):
    score(lambda sid, c: topic_score(sid, c) >= thr, f"topic only >= {thr}")
if v2:
    for thr in (0.35, 0.5):
        for thr2 in (0.35, 0.5, 0.6):
            score(lambda sid, c: v2.get(sid) is not None and c in v2[sid].get("verified", {}) and v2[sid]["verified"][c] is not None and v2[sid]["verified"][c] >= thr2 and topic_score(sid, c) >= thr,
                  f"topic >= {thr} then verify >= {thr2}")
for thr in (0.35, 0.5):
    score(lambda sid, c: (rj_rows.get(sid, {}).get(c) or 0) >= thr, f"round-2 section cards >= {thr}")
if v2:
    ms = sorted(r["ms"] for r in v2.values() if r.get("ms"))
    print(f"\nstage 2: calls {sum(1 for r in v2.values() if r.get('ms'))}/{len(v2)} turns, candidates/turn {sum(len(r['candidates']) for r in v2.values())/len(v2):.2f}, ms p50 {ms[len(ms)//2] if ms else 0}")
