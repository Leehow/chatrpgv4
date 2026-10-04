"""Scores each Jev configuration's rows against the judge labels. Precision/recall/F1 per threshold over all
(input, card) pairs, per-card recall at the chosen threshold, top-k recall, latency and token medians, and the
agreement of the two judges on packet 1. Usage: analyse.py <judge dir> <rows-*.jsonl ...>"""
import json, sys, glob, statistics as st
jd = sys.argv[1]
labels = {}
for p in sorted(glob.glob(jd + "/labels-[0-9].json")):
    for r in json.load(open(p)): labels[r["sid"]] = r["labels"]
b = jd + "/labels-1b.json"
try:
    second = {r["sid"]: r["labels"] for r in json.load(open(b))}
    agree = tot = 0
    for sid, l in second.items():
        for c, v in l.items():
            if sid in labels and c in labels[sid]: tot += 1; agree += labels[sid][c] == v
    yes1 = sum(1 for sid in second for c in second[sid] if labels.get(sid, {}).get(c) == "yes")
    yes2 = sum(1 for sid in second for c in second[sid] if second[sid][c] == "yes")
    print(f"judge agreement on packet 1: {agree}/{tot} = {agree/tot:.3f} (yes counts {yes1} vs {yes2})")
except FileNotFoundError:
    pass
cards = sorted({c for l in labels.values() for c in l})
pos = sum(1 for l in labels.values() for v in l.values() if v == "yes")
print(f"labelled inputs {len(labels)}, cards {len(cards)}, positive pairs {pos} / {len(labels)*len(cards)}")

def score(rows, thr):
    tp = fp = fn = tn = 0
    for r in rows:
        l = labels.get(r["sid"]);
        if not l or "cards" not in r: continue
        for c in cards:
            v = r["cards"].get(c)
            if v is None: continue
            y = l[c] == "yes"; p = v >= thr
            tp += y and p; fp += (not y) and p; fn += y and (not p); tn += (not y) and (not p)
    P = tp / (tp + fp) if tp + fp else 0; R = tp / (tp + fn) if tp + fn else 0
    F = 2 * P * R / (P + R) if P + R else 0
    return tp, fp, fn, P, R, F

for path in sys.argv[2:]:
    rows = [json.loads(l) for l in open(path) if l.strip()]
    ok = [r for r in rows if "cards" in r]
    if not ok: print(path, "no rows"); continue
    cfg = ok[0]["config"]
    # Round 2 moves cards to state/host triggers: a run is scored only over the cards it judged.
    judged = {c for c in ok[0]["cards"] if not c.startswith("x/")}
    ms = [r["ms"] for r in ok]; tok = [r["usage"]["input_tokens"] for r in ok if r.get("usage")]
    print(f"\n== {path.split('/')[-1]} {cfg}  judged cards={len(judged)} n={len(ok)} errors={len(rows)-len(ok)}  ms p50={st.median(ms):.0f} p95={sorted(ms)[int(len(ms)*0.95)-1]:.0f}  input_tokens p50={st.median(tok) if tok else 0:.0f}  state_bytes p50={st.median(r['state_bytes'] for r in ok):.0f}")
    if cfg.get("shape") == "choice":
        hit = n = 0
        for r in ok:
            l = labels.get(r["sid"]);
            if not l: continue
            yes = {c for c, v in l.items() if v == "yes" and c in judged}
            n += 1; hit += (r["best"] in yes) if yes else (r["best"] in (None, "none"))
        print(f"  choice: best-in-gold (or none when no gold) {hit}/{n}")
    for thr in (0.35, 0.5, 0.6, 0.7):
        tp, fp, fn, P, R, F = score(ok, thr)
        print(f"  thr {thr:.2f}: P {P:.2f} R {R:.2f} F1 {F:.2f}  (tp {tp} fp {fp} fn {fn})")
    # top-k recall: is every gold card within the k highest-scored cards?
    for k in (2, 3, 4):
        full = n = 0
        for r in ok:
            l = labels.get(r["sid"]);
            if not l: continue
            yes = {c for c, v in l.items() if v == "yes" and c in judged}
            if not yes: continue
            n += 1; top = {c for c, _ in sorted(r["cards"].items(), key=lambda x: -(x[1] or 0))[:k]}
            full += yes <= top
        if n: print(f"  all gold cards within top-{k}: {full}/{n} = {full/n:.2f}")
    # per-card at 0.5
    print("  per card (gold yes: recall@0.5 / fp@0.5):")
    for c in cards:
        tp = fp = fn = 0
        for r in ok:
            l = labels.get(r["sid"]);
            if not l: continue
            v = r["cards"].get(c); y = l[c] == "yes"; p = v is not None and v >= 0.5
            tp += y and p; fp += (not y) and p; fn += y and (not p)
        if tp + fn or fp: print(f"    {c:14s} yes={tp+fn:3d} recall={tp/(tp+fn) if tp+fn else float('nan'):.2f} fp={fp}")
    if cfg.get("decoys"):
        fired = {}
        for r in ok:
            for c, v in r["cards"].items():
                if c.startswith("x/") and v is not None and v >= 0.5: fired[c] = fired.get(c, 0) + 1
        print(f"  decoys firing >=0.5: {sum(fired.values())} pairs over {len(ok)} inputs; top {sorted(fired.items(), key=lambda x:-x[1])[:6]}")
