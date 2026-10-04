"""Real player inputs with their turn context, from the App home's campaigns. Read-only; nothing in the App home is touched.
Each row: campaign, title, turn, player text, scene, present names, compile features (addressee/act/item rows and answers,
when the turn's telemetry has them), receipt kinds, and the delivered prose's first 300 chars (for labelling only)."""
import json, os, sys, glob, random
root = os.path.expanduser("~/Library/Application Support/Pipi/pipicoc/pi-coc/.coc/campaigns")
out = sys.argv[1]
rows = []
for c in sorted(glob.glob(root + "/game-*")):
    t = c + "/transcript.jsonl"
    if not os.path.exists(t): continue
    try: meta = json.load(open(c + "/campaign.json"))
    except Exception: continue
    players = {}; keepers = {}
    for l in open(t):
        r = json.loads(l)
        if r.get("role") == "player": players[r["turn"]] = r.get("text", "")
        elif r.get("role") == "keeper": keepers[r["turn"]] = r.get("text", "")
    episodes = {}
    ep = c + "/memory/episodes.jsonl"
    if os.path.exists(ep):
        for l in open(ep):
            r = json.loads(l); episodes[r.get("turn")] = r
    compile_rows = {}
    tel = c + "/telemetry.jsonl"
    if os.path.exists(tel):
        for l in open(tel):
            if '"purpose": "compile"' not in l and '"purpose":"compile"' not in l: continue
            try: r = json.loads(l)
            except Exception: continue
            if r.get("lane") == "route" and r.get("purpose") == "compile" and "features" in r:
                f = r["features"]; slim = {}
                for fam, v in f.items():
                    if fam == "ask":
                        slim[fam] = {"rows": v.get("rows"), "answers": {k: a.get("choice") for k, a in (v.get("answers") or {}).items()}}
                    else:
                        slim[fam] = {"rows": v.get("rows"), "choice": v.get("choice"), "row": v.get("row"), "confidence": v.get("confidence")}
                compile_rows[r.get("turn")] = slim
    for turn, text in players.items():
        if not text or not text.strip(): continue
        rec = {}
        p = f"{c}/turns/{turn:04d}.json"
        if os.path.exists(p):
            try: rec = json.load(open(p))
            except Exception: rec = {}
        e = episodes.get(turn, {})
        rows.append({
            "campaign": os.path.basename(c), "title": meta.get("title"), "module": meta.get("module_id"), "turn": turn,
            "player": text.strip(), "scene": e.get("scene"), "present": e.get("present", []),
            "compile": compile_rows.get(turn), "receipt_kinds": sorted({(x.get("kind") or "?") for x in rec.get("receipts", []) if isinstance(x, dict)}),
            "keeper_head": (keepers.get(turn) or "")[:300],
        })
random.Random(20261004).shuffle(rows)
json.dump(rows, open(out, "w"), ensure_ascii=False, indent=1)
print("rows", len(rows), "with compile", sum(1 for r in rows if r["compile"]), "with present", sum(1 for r in rows if r["present"]))
