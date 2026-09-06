"""`bin/coc-review --module <id> --section <id> [--workspace <dir>]` = module.review.

Runs the three gates over `work/<section>/shard.json` in the store and prints
the findings as JSON; exit 0 only when accepted. Without `--workspace` the
store is found by walking up from the current directory (the reader's cwd is
`<workspace>/.coc/modules/<id>/work/<section>/`)."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from ..errors import RpcError
from .rpc import ModuleMethods
from .store import ModuleStore


def find_workspace(start: Path) -> Path | None:
    current = start.resolve()
    for candidate in (current, *current.parents):
        if candidate.name == ".coc":
            return candidate.parent
        if (candidate / ".coc").is_dir():
            return candidate
    return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="coc-review", description=__doc__)
    parser.add_argument("--module", required=True)
    parser.add_argument("--section", required=True)
    parser.add_argument("--workspace", type=Path)
    parser.add_argument("--max-findings", type=int, default=60)
    args = parser.parse_args(argv)
    workspace = args.workspace or find_workspace(Path.cwd())
    if workspace is None:
        print(json.dumps({"accepted": False, "error": "no .coc workspace found; pass --workspace"}))
        return 2
    api = ModuleMethods(ModuleStore(workspace))
    try:
        report = api.review({"module_id": args.module, "section_id": args.section})
    except RpcError as exc:
        print(json.dumps({"accepted": False, "error": exc.to_json()}, ensure_ascii=False, indent=2))
        return 2
    shown = dict(report)
    if len(report["findings"]) > args.max_findings:
        shown["findings"] = report["findings"][:args.max_findings]
        shown["findings_omitted"] = len(report["findings"]) - args.max_findings
    print(json.dumps(shown, ensure_ascii=False, indent=2))
    return 0 if report["accepted"] else 1


if __name__ == "__main__":
    sys.exit(main())
