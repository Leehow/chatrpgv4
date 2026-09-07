"""Read-only draft checks used by the visual Pi reader; no kernel process or writes."""
import argparse
import json
from pathlib import Path

from ..errors import RpcError
from ..fileio import read_json
from .visual import check_draft


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--packet", required=True, type=Path)
    parser.add_argument("--draft", required=True, type=Path)
    args = parser.parse_args()
    try:
        filled = check_draft(read_json(args.draft), read_json(args.packet))
        print(json.dumps({"ok": True, "required_review": filled["required_review"]}))
        return 0
    except (RpcError, ValueError, OSError) as exc:
        print(json.dumps({"ok": False, "error": exc.to_json() if isinstance(exc, RpcError) else str(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
