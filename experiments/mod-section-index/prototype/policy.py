"""Re-applies loading policies over replay rows (topic scores + gate facts are stored per turn), so a policy can be
compared without calling Jev again. Usage: policy.py <judge dir> <rows.jsonl>"""
import json, sys, glob
jd, rows_path = sys.argv[1:3]
labels = {}
for p in sorted(glob.glob(jd + "/labels-[0-9].json")):
    for r in json.load(open(p)): labels[r["sid"]] = r["labels"]
rows = [json.loads(l) for l in open(rows_path) if l.strip()]
ok = [r for r in rows if "loaded" in r and r["sid"] in labels]
T = 0.5
def topic(r, t): return (r["topics"].get("scores") or {}).get(t, 0) or 0
def any_topic(r): return any(v is not None and v >= T for v in (r["topics"].get("scores") or {}).values())
POLICIES = {
  "as replayed": lambda r: {x["id"] for x in r["loaded"]},
  "stall/recover only when no topic fired": lambda r: {x["id"] for x in r["loaded"] if x["id"] not in ("kp/stuck", "kp/recover")}
      | ({"kp/stuck"} if r["gates"]["stall"] and not any_topic(r) else set()) | ({"kp/recover"} if r["gates"]["recover"] and not any_topic(r) else set()),
  "+ register only with carried_item >= 0.7": lambda r: ({x["id"] for x in r["loaded"] if x["id"] not in ("kp/stuck", "kp/recover", "ei/register")}
      | ({"kp/stuck"} if r["gates"]["stall"] and not any_topic(r) else set()) | ({"kp/recover"} if r["gates"]["recover"] and not any_topic(r) else set())
      | ({"ei/register"} if r["gates"]["unregistered_equipment"] and topic(r, "carried_item") >= 0.7 else set())),
  "+ impression on any present never spoken (state only)": lambda r: ({x["id"] for x in r["loaded"] if x["id"] not in ("kp/stuck", "kp/recover", "ei/register", "nn/impression")}
      | ({"kp/stuck"} if r["gates"]["stall"] and not any_topic(r) else set()) | ({"kp/recover"} if r["gates"]["recover"] and not any_topic(r) else set())
      | ({"ei/register"} if r["gates"]["unregistered_equipment"] and topic(r, "carried_item") >= 0.7 else set())
      | ({"nn/impression"} if r["gates"]["present_without_history"] else set())),
}
scored = [c for c in labels[ok[0]["sid"]] if c not in ("nn/language",)]
sizes = {s["id"]: s for s in json.load(open("experiments/mod-section-index/prototype/index.json"))["sections"]}
import subprocess
bytes_of = json.loads(subprocess.run(["node", "-e", "import('./experiments/mod-section-index/sections.mjs').then(m=>console.log(JSON.stringify(Object.fromEntries(m.loadCards(process.cwd()+'/experiments/mod-section-index/prototype/index.json').map(c=>[c.id,Buffer.byteLength(c.text)])))))"], capture_output=True, text=True).stdout)
for name, pick in POLICIES.items():
    tp = fp = fn = 0; load = 0; by = []
    for r in ok:
        got = pick(r); l = labels[r["sid"]]
        for c in scored:
            y = l[c] == "yes"; p = c in got
            tp += y and p; fp += (not y) and p; fn += y and (not p)
        load += len(got); by.append(sum(bytes_of.get(c, 0) for c in got))
    P = tp / (tp + fp) if tp + fp else 0; R = tp / (tp + fn) if tp + fn else 0
    by.sort()
    print(f"{name:52s} P {P:.2f} R {R:.2f} F1 {2*P*R/(P+R):.2f}  sections/turn {load/len(ok):.2f}  bytes p50 {by[len(by)//2]} p95 {by[int(len(by)*.95)-1]}")
