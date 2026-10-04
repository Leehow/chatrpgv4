"""Scores the prototype's replay rows against the judges' rule labels (which section a turn needed), over every
situational section the offline replay can decide (state gates from the real capsule, topics from Jev); host-triggered
sections are reported separately. Also the bytes a turn would carry against today's briefs.
Usage: score.py <judge dir> <rows.jsonl> <index.json>"""
import json, sys, glob, statistics as st
jd, rows_path, index_path = sys.argv[1:4]
labels = {}
for p in sorted(glob.glob(jd + "/labels-[0-9].json")):
    for r in json.load(open(p)): labels[r["sid"]] = r["labels"]
index = json.load(open(index_path))["sections"]
situational = [s for s in index if s["kind"] == "situational"]
offline = [s["id"] for s in situational if s.get("topics") or any(t.startswith("state:") for t in s.get("triggers", []))]
host_only = [s["id"] for s in situational if s["id"] not in offline]
rows = [json.loads(l) for l in open(rows_path) if l.strip()]
ok = [r for r in rows if "loaded" in r]
print(f"turns {len(rows)}, replayed {len(ok)}, failed {len(rows)-len(ok)}")
errs = {}
for r in rows:
    if "error" in r: errs[r["error"][:60]] = errs.get(r["error"][:60], 0) + 1
if errs: print("  failures:", errs)
scored = [c for c in offline if c in next(iter(labels.values()))]
print("sections scored:", scored)
print("host-only (not decidable offline):", host_only)
tp = fp = fn = 0; per = {}
for r in ok:
    l = labels.get(r["sid"]);
    if not l: continue
    picked = {x["id"] for x in r["loaded"]}
    for c in scored:
        y = l[c] == "yes"; p = c in picked
        d = per.setdefault(c, [0, 0, 0]); d[0] += y and p; d[1] += (not y) and p; d[2] += y and (not p)
        tp += y and p; fp += (not y) and p; fn += y and (not p)
P = tp / (tp + fp) if tp + fp else 0; R = tp / (tp + fn) if tp + fn else 0
print(f"\noverall vs rule labels: P {P:.2f} R {R:.2f} F1 {2*P*R/(P+R) if P+R else 0:.2f} (tp {tp} fp {fp} fn {fn})")
# the two classes apart: sections Jev's topics decide (with or without a gate) and sections a state alone decides
topic_ids = [s["id"] for s in situational if s.get("topics") and s["id"] in scored]
state_ids = [c for c in scored if c not in topic_ids]
for name, ids in (("topic-decided", topic_ids), ("state-decided", state_ids)):
    a = b_ = m = 0
    for c in ids:
        if c in per: a += per[c][0]; b_ += per[c][1]; m += per[c][2]
    Pp = a / (a + b_) if a + b_ else 0; Rr = a / (a + m) if a + m else 0
    print(f"  {name:14s} {len(ids)} sections: P {Pp:.2f} R {Rr:.2f} (tp {a} fp {b_} fn {m})")
for c, (a, b, m) in sorted(per.items()):
    if a + m or b: print(f"  {c:14s} gold={a+m:3d} recall={a/(a+m) if a+m else float('nan'):.2f} fp={b}")
# the gold the index cannot reach offline: needed sections that only a host trigger decides
miss_host = sum(1 for r in ok for c in host_only if labels.get(r["sid"], {}).get(c) == "yes")
print(f"gold pairs on host-only sections (decided at the Keeper's call in the product): {miss_host}")
b = [r["bytes"] for r in ok]; n = [len(r["loaded"]) for r in ok]; ms = [r["topics"].get("ms", 0) for r in ok]
print(f"\nloaded sections/turn mean {st.mean(n):.2f} p95 {sorted(n)[int(len(n)*.95)-1]}; bytes/turn p50 {st.median(b):.0f} p95 {sorted(b)[int(len(b)*.95)-1]} max {max(b)}")
print(f"topic lane ms p50 {st.median(ms):.0f} p95 {sorted(ms)[int(len(ms)*.95)-1]:.0f}; jev unavailable {sum(1 for r in ok if 'unavailable' in r['topics'])}")
gates = {}
for r in ok:
    for g, v in r["gates"].items(): gates[g] = gates.get(g, 0) + bool(v)
print("gate hits over turns:", gates)
why = {}
for r in ok:
    for x in r["loaded"]:
        for w in x["why"]: why[w] = why.get(w, 0) + 1
print("why loaded:", dict(sorted(why.items(), key=lambda x: -x[1])))
print("\ntoday: briefs 4999 B every turn; resident briefs of the resident packages (narration-craft 904 + keeper-pacing 913 + historical 60 + zh 586) 2463 B")
