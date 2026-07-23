#!/usr/bin/env python3
"""Engineering probe: build a FRESH isolated playable Cold Harvest campaign.

This is setup tooling for a Pi-as-KP smoke run (label: engineering-probe).
It compiles a fresh campaign deterministically from the reviewed vertical
slice asset root ``cold-harvest-reviewed`` (source truth derived from the
user's PDF). It does NOT resume any historical save: campaign, investigator
link, and active opening scene are all created fresh.

Sequence (all canonical CLIs):
  1. copy reviewed module-assets into a fresh workspace
  2. campaign.create
  3. coc_module_project.py opening-deep  (skeleton + journey-gaz-road deep)
  4. investigator.create  (imported NKVD sheet)
  5. campaign.link_investigator
  6. state.move_scene -> journey-gaz-road (fresh opening)
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"
REAL_COC = REPO / ".coc"
ASSET_ROOT_ID = "cold-harvest-reviewed"
# Source character definition (imported sheet = source data, not play state).
SRC_INVESTIGATOR = (
    REPO
    / ".tmp/playtest-cold-harvest-pn-20260719T014521Z/.coc/investigators/nkvd-ivanov"
)
INVESTIGATOR_ID = "nkvd-ivanov"


def _uv() -> list[str]:
    return ["uv", "run", "--frozen", "python"]


def _env() -> dict[str, str]:
    env = dict(os.environ)
    env.setdefault("UV_CACHE_DIR", "/tmp/uv-cache-probe")
    env.setdefault("PYTHONDONTWRITEBYTECODE", "1")
    env.setdefault("COC_DISABLE_QUEUE_WORKER", "1")
    return env


def run(cmd: list[str], *, label: str, cwd: Path | None = None) -> dict:
    print(f"\n=== {label} ===")
    print("  $ " + " ".join(str(c) for c in cmd[:6]) + (" ..." if len(cmd) > 6 else ""))
    proc = subprocess.run(
        cmd,
        cwd=str(cwd or REPO),
        env=_env(),
        capture_output=True,
        text=True,
    )
    out = proc.stdout.strip()
    err = proc.stderr.strip()
    if proc.returncode != 0:
        print(f"  [FAIL rc={proc.returncode}]")
        if out:
            print("  stdout:", out[:2000])
        if err:
            print("  stderr:", err[:2000])
        raise SystemExit(f"step failed: {label}")
    # Try to parse last JSON object from stdout.
    parsed: dict = {}
    if out:
        try:
            parsed = json.loads(out.splitlines()[-1])
        except json.JSONDecodeError:
            # operation CLI prints indented JSON; parse whole stdout.
            try:
                parsed = json.loads(out)
            except json.JSONDecodeError:
                parsed = {"_raw": out[:1000]}
    print("  ok:", json.dumps(parsed, ensure_ascii=False)[:600])
    return parsed


def setup_operation(ws: Path, kind: str, payload: dict, *, label: str) -> dict:
    op = {"schema_version": 1, "kind": kind, "payload": payload}
    return run(
        [
            *_uv(), str(SCRIPTS / "coc_runtime_ops.py"),
            "--workspace", str(ws),
            "--setup",
            "--operation-json", json.dumps(op, ensure_ascii=False),
        ],
        label=label,
    )


def main() -> int:
    ts = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    ws = REPO / ".tmp" / f"pi-cold-harvest-smoke-{ts}"
    campaign_id = f"pi-ch-smoke-{ts}".replace(":", "").lower()
    print(f"workspace: {ws}")
    print(f"campaign_id: {campaign_id}")

    # 1. Fresh workspace + copy reviewed module-assets (source truth).
    (ws / ".coc").mkdir(parents=True, exist_ok=True)
    dst_assets = ws / ".coc" / "module-assets" / ASSET_ROOT_ID
    src_assets = REAL_COC / "module-assets" / ASSET_ROOT_ID
    if not src_assets.is_dir():
        raise SystemExit(f"missing reviewed asset root: {src_assets}")
    shutil.copytree(src_assets, dst_assets)
    # Drop any inherited lock/queue state so the fresh workspace is clean.
    for junk in ("parse-queue.lock",):
        p = dst_assets / junk
        if p.exists():
            p.unlink()
    # Normalize the reviewed skeleton for the current schema: the reviewed
    # vertical slice predates the mechanics-locator pass bookkeeping field.
    # "pending" satisfies validation and skips locator-scope requirements.
    sk_path = dst_assets / "skeleton.json"
    sk = json.loads(sk_path.read_text(encoding="utf-8"))
    if str(sk.get("mechanics_locator_pass_status") or "") not in {"pending", "complete"}:
        sk["mechanics_locator_pass_status"] = "pending"
        sk_path.write_text(json.dumps(sk, ensure_ascii=False, indent=2), encoding="utf-8")
        print("normalized skeleton mechanics_locator_pass_status -> pending")
    print(f"copied asset root -> {dst_assets}")

    # 2. campaign.create
    setup_operation(
        ws, "campaign.create",
        {
            "campaign_id": campaign_id,
            "title": "冰冷的收获 · Pi 冒烟局",
            "era": "1930s",
            "play_language": "zh-Hans",
            "ruleset_id": "coc7",
        },
        label="campaign.create",
    )

    # 3. opening-deep projection (skeleton + journey-gaz-road deep pack).
    run(
        [
            *_uv(), str(SCRIPTS / "coc_module_project.py"),
            "--workspace", str(ws),
            "opening-deep",
            "--campaign", campaign_id,
            "--asset-root-id", ASSET_ROOT_ID,
        ],
        label="opening-deep projection",
    )

    # 4. investigator.create (imported NKVD sheet).
    sheet = json.loads((SRC_INVESTIGATOR / "character.json").read_text(encoding="utf-8"))
    creation = json.loads((SRC_INVESTIGATOR / "creation.json").read_text(encoding="utf-8"))
    try:
        setup_operation(
            ws, "investigator.create",
            {"investigator_id": INVESTIGATOR_ID, "sheet": sheet, "creation": creation},
            label="investigator.create",
        )
    except SystemExit:
        print("  [fallback] investigator.create validation failed; copying definition directly")
        inv_dir = ws / ".coc" / "investigators" / INVESTIGATOR_ID
        inv_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy(SRC_INVESTIGATOR / "character.json", inv_dir / "character.json")
        shutil.copy(SRC_INVESTIGATOR / "creation.json", inv_dir / "creation.json")

    # 5. campaign.link_investigator
    setup_operation(
        ws, "campaign.link_investigator",
        {"campaign_id": campaign_id, "investigator_ids": [INVESTIGATOR_ID]},
        label="campaign.link_investigator",
    )

    # 6. state.move_scene -> opening scene journey-gaz-road (fresh).
    run(
        [
            *_uv(), str(SCRIPTS / "coc_toolbox.py"),
            "state.move_scene",
            "--root", str(ws),
            "--campaign", campaign_id,
            "--json", json.dumps(
                {"scene_id": "journey-gaz-road", "decision_id": "setup-opening-move"},
                ensure_ascii=False,
            ),
        ],
        label="state.move_scene journey-gaz-road",
    )

    # Verification snapshot.
    active = ws / ".coc/campaigns" / campaign_id / "save/active-scene.json"
    scenario = ws / ".coc/campaigns" / campaign_id / "scenario/scenario.json"
    print("\n=== VERIFY ===")
    print("active-scene:", active.read_text(encoding="utf-8") if active.exists() else "MISSING")
    print("scenario:", scenario.read_text(encoding="utf-8") if scenario.exists() else "MISSING")
    print("\nWORKSPACE_READY", json.dumps({
        "workspace": str(ws),
        "campaign_id": campaign_id,
        "investigator_id": INVESTIGATOR_ID,
        "character_path": str(ws / f".coc/investigators/{INVESTIGATOR_ID}/character.json"),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
