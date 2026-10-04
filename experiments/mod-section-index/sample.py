"""A stratified sample of real player inputs for labelling: the strata are what the turn's own records say happened
(compile features and receipt kinds), never what the input says. Reads inputs.json, writes sample.json."""
import json, random, sys
rows = json.load(open(sys.argv[1]))
want = int(sys.argv[3]) if len(sys.argv) > 3 else 120
rng = random.Random(4)
def stratum(r):
    f = r.get("compile") or {}
    k = set(r["receipt_kinds"])
    if (f.get("addressee") or {}).get("row") or "npc" in k and (f.get("act") or {}).get("row") == "social": return "social"
    if "cash" in k or "item" in k or "handout" in k or (f.get("item") or {}).get("row"): return "things"
    if "roll" in k or "clue" in k or (f.get("act") or {}).get("row") == "investigate": return "investigate"
    if "move" in k or (f.get("act") or {}).get("row") == "move": return "move"
    if not r["present"]: return "alone"
    return "other"
by = {}
for r in rows: by.setdefault(stratum(r), []).append(r)
quota = {"social": 0.35, "things": 0.15, "investigate": 0.2, "move": 0.12, "alone": 0.1, "other": 0.08}
out = []
for s, share in quota.items():
    pool = by.get(s, []); rng.shuffle(pool)
    out.extend(pool[:max(1, round(want * share))])
rng.shuffle(out)
for i, r in enumerate(out): r["sid"] = f"s{i+1:03d}"
json.dump(out, open(sys.argv[2], "w"), ensure_ascii=False, indent=1)
print({s: len(v) for s, v in by.items()}, "->", len(out))
