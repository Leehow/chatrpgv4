#!/usr/bin/env python3
"""Engineering probe: drive ONE real Pi-as-KP keeper turn for Cold Harvest.

Label: engineering-probe / smoke. This drives the genuine headless Pi keeper
(runtime/adapters/keeper/run_keeper_turn.mjs via the SDK ``send`` path) against
a fresh isolated Cold Harvest campaign. Campaign state is durable on disk, so
each turn runs in its own process: create a session bound to the same campaign,
send one player input, print the finalized narration + public state, exit.

Usage:
  uv run --frozen python tests/pi/play_cold_harvest_turn.py \
      --workspace <ws> --campaign <id> --investigator nkvd-ivanov \
      --input "<player line>"
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def _load_sdk():
    path = REPO / "runtime" / "sdk" / "api.py"
    spec = importlib.util.spec_from_file_location("coc_sdk_api", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def ensure_runtime_json(ws: Path) -> None:
    """Bind the Pi narrator brain (match the real product runtime.json)."""
    coc = ws / ".coc"
    coc.mkdir(parents=True, exist_ok=True)
    rt = coc / "runtime.json"
    if not rt.exists():
        rt.write_text(json.dumps({
            "schema_version": 2,
            "planner": {"kind": "deterministic"},
            "rules": {"kind": "deterministic"},
            "narrator": {"kind": "pi"},
            "player": {"kind": "human"},
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        print("[setup] wrote .coc/runtime.json (narrator=pi)")


def extract_narration(events: list[dict]) -> str:
    for ev in events:
        if ev.get("type") == "narration":
            payload = ev.get("payload") or {}
            text = payload.get("text")
            if isinstance(text, str):
                return text
    return ""


def summarize_tools(events: list[dict]) -> list[str]:
    out: list[str] = []
    for ev in events:
        if ev.get("type") == "tool_call":
            payload = ev.get("payload") or {}
            tool = payload.get("tool")
            ok = payload.get("ok")
            out.append(f"{tool}({'ok' if ok else 'FAIL'})")
    return out


def final_state(events: list[dict]) -> dict:
    for ev in events:
        if ev.get("type") == "state_patch":
            payload = ev.get("payload") or {}
            return payload.get("final_state") or {}
    return {}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workspace", required=True)
    ap.add_argument("--campaign", required=True)
    ap.add_argument("--investigator", required=True)
    ap.add_argument("--input", required=True)
    ap.add_argument("--character", default=None)
    args = ap.parse_args()

    ws = Path(args.workspace).resolve()
    ensure_runtime_json(ws)

    os.environ.setdefault("UV_CACHE_DIR", "/tmp/uv-cache-probe")
    os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

    api = _load_sdk()
    character_path = args.character or str(
        ws / f".coc/investigators/{args.investigator}/character.json"
    )
    sid = api.create_session(
        ws,
        campaign_id=args.campaign,
        investigator_id=args.investigator,
        character_path=character_path,
    )
    print(f"[session] {sid}")
    print(f"[player ] {args.input}")
    print("[keeper ] ... (Pi coding agent driving toolbox) ...")

    try:
        events = api.send(sid, args.input)
    except Exception as exc:
        print(f"\n[ERROR] keeper turn failed: {type(exc).__name__}: {exc}")
        try:
            api.close_session(sid)
        except Exception:
            pass
        return 1

    narration = extract_narration(events)
    tools = summarize_tools(events)
    state = final_state(events)

    print("\n" + "=" * 70)
    print("KP 叙述（玩家可见）:")
    print("=" * 70)
    print(narration or "(无叙述)")
    print("=" * 70)
    print(f"工具调用 ({len(tools)}): {', '.join(tools) if tools else '无'}")
    print(f"最终状态: {json.dumps(state, ensure_ascii=False)}")

    try:
        attestation = api.get_last_turn_attestation(sid)
        print(f"回执摘要: {json.dumps(attestation, ensure_ascii=False)[:400]}")
    except Exception as exc:
        print(f"attestation unavailable: {exc}")

    api.close_session(sid)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
