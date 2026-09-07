"""Read-only draft checks used by the visual Pi reader; no kernel process or writes."""
import argparse
import json
from pathlib import Path

from ..errors import RpcError
from ..fileio import read_json
from .visual import check_draft, required_view_pages


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--packet", required=True, type=Path)
    parser.add_argument("--draft", required=True, type=Path)
    args = parser.parse_args()
    try:
        draft = read_json(args.draft)
        filled = check_draft(draft, read_json(args.packet))
        baseline_path = args.packet.parent / "baseline.json"
        baseline = read_json(baseline_path) if baseline_path.exists() else None
        print(json.dumps({"ok": True, "required_review": filled["required_review"],
                          "required_view_pages": required_view_pages(draft, baseline)}))
        return 0
    except (RpcError, ValueError, OSError) as exc:
        print(json.dumps({"ok": False, "error": exc.to_json() if isinstance(exc, RpcError) else str(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
