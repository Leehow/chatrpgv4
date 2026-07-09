#!/usr/bin/env python3
"""CLI helper: run debug_send_turn and print Event list as JSON.

Used by the Pi Node bridge tool ``coc_live_turn`` so the model never invents
rule math — it delegates to the same Python live-turn path as brain=debug.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path


def _load_debug_adapter():
    path = Path(__file__).resolve().parent.parent / "debug" / "adapter.py"
    spec = importlib.util.spec_from_file_location("runtime_debug_adapter", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run one debug live turn for Pi bridge")
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--campaign-id", required=True)
    parser.add_argument("--investigator-id", required=True)
    parser.add_argument("--character-path", required=True)
    parser.add_argument("--player-text", required=True)
    args = parser.parse_args(argv)

    workspace = Path(args.workspace)
    campaign_dir = workspace / ".coc" / "campaigns" / args.campaign_id
    character_path = Path(args.character_path)

    try:
        events = _load_debug_adapter().debug_send_turn(
            workspace,
            campaign_dir,
            character_path,
            args.investigator_id,
            args.player_text,
        )
    except Exception as exc:  # noqa: BLE001 — surface to Node as JSON error
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1

    print(json.dumps({"ok": True, "events": events}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
