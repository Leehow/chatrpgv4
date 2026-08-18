#!/usr/bin/env python3
"""Print setup|play for a workspace + campaign_id. Thin CLI over coc_state."""
from __future__ import annotations

import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import coc_state  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 2:
        print(
            "usage: coc_session_role.py <workspace> <campaign_id>",
            file=sys.stderr,
        )
        return 2
    workspace, campaign_id = args
    try:
        role = coc_state.infer_pi_session_role(Path(workspace), campaign_id)
    except FileNotFoundError as exc:
        print(f"coc_session_role: {exc}", file=sys.stderr)
        return 1
    except (OSError, ValueError, coc_state.UnsupportedSaveSchema) as exc:
        print(f"coc_session_role: {exc}", file=sys.stderr)
        return 1
    print(role)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
