#!/usr/bin/env python3
"""Structured Call of Cthulhu 7e Chase engine — Chapter 7.

Owns structured chase state, parallel to CombatSession/SanitySession.
Produces save/chase.json with participants, location chain, rounds, outcome.

Rulebook basis: Chapter 7 (Chases), 7e 40th Anniversary.
- Part 1 Establishing: CON/Drive roll adjusts MOV; quarry faster -> escape (p.144)
- Part 2 Cut to Chase: layout location chain, DEX order, movement actions (p.145)
- Part 3 Movement: base 1 action + 1 per MOV above slowest; barriers (p.146)
- Part 4 Conflict: grab/strike/collide (p.150)
"""
from __future__ import annotations
import json, random, re
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent

def _load_sibling(name, filename):
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m

coc_roll = _load_sibling("coc_roll", "coc_roll.py")
coc_rules = _load_sibling("coc_rules", "coc_rules.py")
LVL = {"fumble":0,"failure":1,"regular":2,"hard":3,"extreme":4,"critical":5}


class ChaseSession:
    """Structured chase state for one pursuit (Chapter 7)."""

    def __init__(self, chase_id, rng, glossary=None, play_language="zh-Hans"):
        self.chase_id = chase_id
        self.status = "active"
        self.outcome = None
        self._rng = rng
        self._glossary = glossary or {}
        self.participants = {}
        self.location_chain = []
        self.rounds = []
        self.pending_rolls = []
        self._roll_counter = 0
        self._turn_counter = 0
        self._current_round = 0

    def add_participant(self, actor_id, side, mov, dex, con=None, drive_auto=None,
                        is_vehicle=False, current_position=0):
        if actor_id in self.participants:
            raise ValueError(f"duplicate participant {actor_id}")
        self.participants[actor_id] = {
            "actor_id": actor_id, "side": side, "mov_base": mov,
            "mov_adjusted": mov, "dex": dex, "con": con, "drive_auto": drive_auto,
            "is_vehicle": is_vehicle, "position": current_position,
            "movement_actions": 1, "captured": False, "escaped": False,
        }

    def set_location_chain(self, locations):
        self.location_chain = locations

    def establish(self):
        """Part 1 (p.144): speed roll adjusts MOV. Quarry faster -> escape."""
        results = {}
        for aid, p in self.participants.items():
            if p["is_vehicle"] and p.get("drive_auto"):
                target, skill = p["drive_auto"], "Drive Auto"
            elif p.get("con"):
                target, skill = p["con"], "CON"
            else:
                results[aid] = {"mov_delta": 0, "mov_adjusted": p["mov_base"]}
                continue
            res = coc_roll.percentile_check(target, rng=self._rng)
            delta = 0
            if LVL[res["outcome"]] >= LVL["extreme"]: delta = +1
            elif res["outcome"] in ("failure","fumble"): delta = -1
            p["mov_adjusted"] = max(1, p["mov_base"] + delta)
            rid = self._roll_id()
            self.pending_rolls.append({"roll_id":rid,"actor_id":aid,"skill":skill,
                "target":target,"roll":res["roll"],"outcome":res["outcome"],"mov_delta":delta})
            results[aid] = {"skill":skill,"outcome":res["outcome"],"mov_delta":delta,
                            "mov_adjusted":p["mov_adjusted"]}
        quarries = [p for p in self.participants.values() if p["side"]=="quarry"]
        pursuers = [p for p in self.participants.values() if p["side"]=="pursuer"]
        if quarries and pursuers:
            if min(q["mov_adjusted"] for q in quarries) > max(pu["mov_adjusted"] for pu in pursuers):
                self.conclude("escaped")
                for q in quarries: q["escaped"] = True
        return {"speed_rolls":results, "chase_proceeds":self.status=="active"}

    def compute_movement_actions(self):
        if not self.participants: return
        slowest = min(p["mov_adjusted"] for p in self.participants.values())
        for p in self.participants.values():
            p["movement_actions"] = 1 + max(0, p["mov_adjusted"] - slowest)

    def begin_round(self):
        self._current_round += 1
        self.compute_movement_actions()
        dex_order = sorted([p for p in self.participants.values()
                           if not p["captured"] and not p["escaped"]],
                           key=lambda p:(-p["dex"], p["actor_id"]))
        self.rounds.append({"round":self._current_round,
                            "dex_order":[p["actor_id"] for p in dex_order],"turns":[]})
        return self._current_round

    def move_participant(self, actor_id, actions):
        p = self.participants[actor_id]
        turn = {"turn_id":f"t{self._current_round}-{self._next_turn()}",
                "actor_id":actor_id,"dex":p["dex"],
                "movement_actions":p["movement_actions"],"actions_taken":[]}
        for action in actions[:p["movement_actions"]]:
            result = self._resolve_movement_action(actor_id, action)
            turn["actions_taken"].append(result)
            if p["escaped"] or p["captured"]: break
        self.rounds[-1]["turns"].append(turn)
        return turn

    def _resolve_movement_action(self, actor_id, action):
        p = self.participants[actor_id]
        atype = action.get("type","advance")
        if atype == "advance":
            p["position"] = min(len(self.location_chain)-1, p["position"]+1)
            loc = self.location_chain[p["position"]] if p["position"] < len(self.location_chain) else {}
            r = {"type":"advance","new_position":p["position"],"location_label":loc.get("label","?")}
            if loc.get("label")=="escape": p["escaped"]=True; r["escaped"]=True
            if loc.get("label")=="hazard": r["hazard_id"]=action.get("hazard_id",loc.get("hazard_id"))
            return r
        elif atype == "barrier":
            loc = self.location_chain[p["position"]]
            skill = action.get("skill", loc.get("barrier_skill","Climb"))
            target = action.get("target", loc.get("barrier_target",20))
            res = coc_roll.percentile_check(target, rng=self._rng)
            rid = self._roll_id()
            self.pending_rolls.append({"roll_id":rid,"actor_id":actor_id,"skill":skill,
                "target":target,"roll":res["roll"],"outcome":res["outcome"]})
            if res["outcome"] not in ("failure","fumble"):
                p["position"]=min(len(self.location_chain)-1,p["position"]+1)
                return {"type":"barrier","passed":True,"roll_id":rid,"new_position":p["position"]}
            return {"type":"barrier","passed":False,"roll_id":rid}
        elif atype == "hide":
            stealth = action.get("stealth_target",40)
            res = coc_roll.percentile_check(stealth, rng=self._rng)
            rid = self._roll_id()
            self.pending_rolls.append({"roll_id":rid,"actor_id":actor_id,"skill":"Stealth",
                "target":stealth,"roll":res["roll"],"outcome":res["outcome"]})
            return {"type":"hide","success":res["outcome"] not in ("failure","fumble"),"roll_id":rid}
        elif atype == "conflict":
            tid = action.get("target_actor_id","")
            tp = self.participants.get(tid)
            if not tp: return {"type":"conflict","result":"no_target"}
            ft = action.get("fight_target",40)
            res = coc_roll.percentile_check(ft, rng=self._rng)
            rid = self._roll_id()
            self.pending_rolls.append({"roll_id":rid,"actor_id":actor_id,"skill":"Fighting",
                "target":ft,"roll":res["roll"],"outcome":res["outcome"]})
            if res["outcome"] not in ("failure","fumble"):
                tp["captured"]=True
                return {"type":"conflict","result":"grabbed","target":tid,"roll_id":rid}
            return {"type":"conflict","result":"missed","target":tid,"roll_id":rid}
        return {"type":atype,"result":"unknown"}

    def check_outcome(self):
        quarries = [p for p in self.participants.values() if p["side"]=="quarry"]
        if not quarries: return None
        if all(q["escaped"] for q in quarries): self.conclude("escaped")
        elif all(q["captured"] for q in quarries): self.conclude("captured")
        return self.outcome

    def conclude(self, outcome):
        self.status = "concluded"; self.outcome = outcome

    def snapshot(self):
        return {"chase_id":self.chase_id,"status":self.status,"outcome":self.outcome,
                "participants":[dict(p) for p in self.participants.values()],
                "location_chain":list(self.location_chain),
                "rounds":[dict(r) for r in self.rounds]}

    def save(self, campaign_dir):
        d = campaign_dir/"save"; d.mkdir(parents=True, exist_ok=True)
        p = d/"chase.json"
        p.write_text(json.dumps(self.snapshot(),ensure_ascii=False,indent=2))
        return p

    def drain_pending(self):
        r = self.pending_rolls; self.pending_rolls = []; return r

    def _roll_id(self):
        self._roll_counter += 1; return f"chr{self._roll_counter}"

    def _next_turn(self):
        self._turn_counter += 1; return self._turn_counter
