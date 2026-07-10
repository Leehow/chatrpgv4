"""One-shot acceptance environment: real starter campaign + investigator."""
import importlib.util
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import coc_state  # noqa: E402
import coc_starter  # noqa: E402

ws = Path(__file__).parent / "ws"
root = ws / ".coc"
coc_state.ensure_workspace(root)
coc_state.create_campaign(root, "acceptance", "N5 Acceptance", era="ww1", play_language="zh-Hans")
coc_starter.install_starter(root, "acceptance", "the-white-war")

camp = root / "campaigns" / "acceptance"
inv_id = "guido"
character = {
    "schema_version": 1,
    "investigator_id": inv_id,
    "name": "Guido Ricci",
    "occupation": "Alpini scout",
    "era": "ww1",
    "characteristics": {
        "STR": 65, "CON": 60, "DEX": 70, "APP": 50, "SIZ": 55,
        "INT": 65, "POW": 55, "EDU": 50, "LUCK": 50,
    },
    "derived": {"hp_max": 11, "san_max": 55, "mp_max": 11, "mov": 8, "build": 0, "db": "0"},
    "skills": {
        "Spot Hidden": 60, "Listen": 50, "Climb": 60, "Track": 45,
        "Firearms (Rifle)": 55, "First Aid": 40, "Stealth": 50,
        "Natural World": 40, "Survival (Alpine)": 55, "Italian": 50,
    },
    "backstory": {
        "personal_description": "Wiry mountain scout with frost-scarred hands",
        "ideology_beliefs": "The mountain judges all men equally",
        "significant_people": "Younger brother Matteo, also conscripted",
        "meaningful_locations": "The family rifugio above Cortina",
        "treasured_possessions": "Father's brass compass",
        "traits": "Counts his steps when nervous",
    },
}
inv_dir = camp / "investigators"
inv_dir.mkdir(parents=True, exist_ok=True)
(inv_dir / f"{inv_id}.json").write_text(
    json.dumps(character, ensure_ascii=False, indent=2), encoding="utf-8"
)
inv_state_dir = camp / "save" / "investigator-state"
inv_state_dir.mkdir(parents=True, exist_ok=True)
inv_state = {
    "schema_version": 1,
    "campaign_id": "acceptance",
    "investigator_id": inv_id,
    "current_hp": 11,
    "current_san": 55,
    "current_mp": 11,
    "current_luck": 50,
    "conditions": [],
}
(inv_state_dir / f"{inv_id}.json").write_text(
    json.dumps(inv_state, ensure_ascii=False, indent=2), encoding="utf-8"
)

# runtime brain config expected by public_state
(root / "runtime.json").write_text(
    json.dumps({"schema_version": 1, "brain": "debug"}), encoding="utf-8"
)
print("campaign ready:", camp)
print("scenes:", [s.get("scene_id") for s in json.loads((camp / "scenario" / "story-graph.json").read_text())["scenes"]][:6])
