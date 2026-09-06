"""JSON-lines RPC entry point: python -m coc.rpc --workspace <dir> --content <dir>.

One request per line on stdin, one response per line on stdout, logs on stderr.
Requests are handled strictly in arrival order; every exception becomes an
`internal` error response and the loop keeps running."""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import traceback
from pathlib import Path
from typing import Any, Callable

from .errors import RpcError
from .store import Store
from .table import Table

SEED_ENV = "COC_KERNEL_SEED"


def build_methods(table: Table) -> dict[str, Callable[[dict[str, Any]], dict[str, Any]]]:
    return {
        "kernel.hello": table.hello,
        "campaign.list": table.campaign_list,
        "campaign.create": table.campaign_create,
        "table.open": table.open,
        "table.status": table.status,
        "table.capsule": table.capsule,
        "table.player_input": table.player_input,
        "table.look": table.look,
        "table.lookup": table.lookup,
        "table.recall": table.recall,
        "table.resolve": table.resolve,
        "table.apply": table.apply,
        "table.ask": table.ask,
        "table.narrate": table.narrate,
        # slice 2 lanes (contract §12.3, §12.5, §12.8): no call_id, no turn-state gate
        "table.warn": table.warn,
        "memory.job": table.memory_job,
        "memory.submit": table.memory_submit,
        "memory.fail": table.memory_fail,
    }


def log(message: str) -> None:
    sys.stderr.write(f"[coc.rpc] {message}\n")
    sys.stderr.flush()


def handle_line(line: str, methods: dict[str, Callable[[dict[str, Any]], dict[str, Any]]]) -> dict[str, Any]:
    request_id: Any = None
    try:
        request = json.loads(line)
        if not isinstance(request, dict):
            raise RpcError("invalid_params", "request must be a JSON object")
        request_id = request.get("id")
        method = request.get("method")
        params = request.get("params", {})
        if not isinstance(request_id, str):
            raise RpcError("invalid_params", "request.id must be a string")
        if not isinstance(method, str):
            raise RpcError("invalid_params", "request.method must be a string")
        if params is None:
            params = {}
        if not isinstance(params, dict):
            raise RpcError("invalid_params", "request.params must be an object")
        handler = methods.get(method)
        if handler is None:
            raise RpcError("unknown_method", f"unknown method {method!r}",
                           details={"methods": sorted(methods)})
        result = handler(params)
        return {"id": request_id, "ok": True, "result": result}
    except json.JSONDecodeError as exc:
        error = RpcError("invalid_params", f"request is not valid JSON: {exc.msg}")
        return {"id": request_id, "ok": False, "error": error.to_json()}
    except RpcError as exc:
        return {"id": request_id, "ok": False, "error": exc.to_json()}
    except Exception as exc:  # noqa: BLE001 - the loop must survive anything
        log(traceback.format_exc())
        error = RpcError("internal", f"{type(exc).__name__}: {exc}")
        return {"id": request_id, "ok": False, "error": error.to_json()}


def make_rng() -> random.Random:
    seed = os.environ.get(SEED_ENV)
    if seed:
        log(f"seeded rng from {SEED_ENV}={seed}")
        return random.Random(seed)
    return random.Random()


def serve(workspace: Path, content: Path, stdin=None, stdout=None) -> int:
    stdin = stdin or sys.stdin
    stdout = stdout or sys.stdout
    table = Table(Store(workspace), content, make_rng())
    methods = build_methods(table)
    log(f"ready workspace={workspace} content={content}")
    while True:
        line = stdin.readline()
        if not line:
            break
        if not line.strip():
            continue
        response = handle_line(line, methods)
        stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
        stdout.flush()
    log("stdin closed; exiting")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m coc.rpc")
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--content", required=True, type=Path)
    args = parser.parse_args(argv)
    content = args.content.resolve()
    if not (content / "rulesets" / "coc7").is_dir():
        parser.error(f"--content {content} has no rulesets/coc7")
    for stream in (sys.stdin, sys.stdout):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    return serve(args.workspace.resolve(), content)


if __name__ == "__main__":
    sys.exit(main())
