"""Offline deterministic draft gate used by the tool-enabled creator."""
import json
import sys
from pathlib import Path

from .objects import validate_definition


def main() -> int:
    try:
        value = validate_definition(json.loads(Path(sys.argv[1]).read_text()))
        print(json.dumps({"ok": True, "name": value["name"]}))
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
