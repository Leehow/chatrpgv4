#!/usr/bin/env python3
"""engineering-probe: prepare a fresh isolated workspace with one claimable
partial_opening work group for the real Pi source-coordinator lifecycle probe.

This is NOT an acceptance test and NOT product evidence. It reproduces, through
the canonical toolbox typed operations, the exact progressive pipeline that a
live Keeper would drive:

    campaign.create -> register_source_bundle -> scenario bind ->
    progressive.publish_skeleton -> progressive.request_opening_pack ->
    queue worker materialization -> one runnable partial_opening host-work row.

Usage (from the repository root):

    PYTHONDONTWRITEBYTECODE=1 uv run --frozen python \
        tests/pi/prepare_probe_workspace.py <fresh_workspace_dir>

It prints a single JSON object on stdout describing the prepared state so the
Node probe harness can build the closed coordinator task. The workspace is left
with exactly one runnable, unleased partial_opening work group; the probe's
coordinator performs the only claim.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import sys
from pathlib import Path

# Prevent a detached worker subprocess from racing the deterministic
# single-shot materialization below.
os.environ["COC_DISABLE_QUEUE_WORKER"] = "1"

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = REPO_ROOT / "plugins" / "coc-keeper" / "scripts"

CAMPAIGN_ID = "pi-probe-camp"
ASSET_ROOT_ID = "pi-probe-module"
START_LOCATION_ID = "opening"
OPENING_PDF_INDICES = [0]

# One authored opening page. It establishes a location, one obvious clue, and
# one materially present NPC so the leaf has real, bounded source material.
OPENING_PAGE_TEXT = (
    "# The Saltmarsh Inn, Blackwater Harbor\n"
    "\n"
    "Dusk settles over the fishing village of Blackwater Harbor as the "
    "investigators' car grinds to a halt before the Saltmarsh Inn. The "
    "innkeeper, Marta Kroll, watches from the doorway, wiping her hands on "
    "her apron.\n"
    "\n"
    "The harbor below is unnaturally quiet. No gulls cry. No boats rock at "
    "the moorings. Only a single rowboat lies overturned on the shingle, its "
    "hull scraped clean.\n"
    "\n"
    "Marta calls down: \"You'll be wanting rooms, then. Best come in before "
    "the fog rolls down. Folk don't linger on the shore after dark anymore.\"\n"
    "\n"
    "On the porch table a water-stained ledger lies open. The last entry, in "
    "a shaking hand, reads: \"Third night. The bell again. It comes from "
    "beneath the church.\"\n"
)


def _load(name: str, rel: Path):
    spec = importlib.util.spec_from_file_location(name, str(rel))
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )


def prepare(workspace: Path) -> dict:
    assets = _load("coc_assets_pp", SCRIPTS / "coc_module_assets.py")
    state = _load("coc_state_pp", SCRIPTS / "coc_state.py")
    worker = _load("coc_worker_pp", SCRIPTS / "coc_module_queue_worker.py")
    toolbox = _load("coc_toolbox_pp", SCRIPTS / "coc_toolbox.py")

    workspace = workspace.resolve()
    if workspace == REPO_ROOT or REPO_ROOT in workspace.parents:
        raise SystemExit(
            "refusing to prepare inside the repository tree; "
            "pass a fresh isolated workspace path"
        )
    workspace.mkdir(parents=True, exist_ok=True)

    # 1. Campaign.
    state.create_campaign(
        workspace, CAMPAIGN_ID, "Pi Probe Campaign", play_language="zh-Hans",
    )

    # 2. Source bundle with one accepted opening page.
    pdf = workspace / "pi-probe-module.pdf"
    pdf.write_bytes(b"%PDF pi lifecycle probe fixture")
    file_sha = hashlib.sha256(pdf.read_bytes()).hexdigest()
    bundle = workspace / "pi-probe-source"
    bundle.mkdir(exist_ok=True)
    page_bytes = OPENING_PAGE_TEXT.encode("utf-8")
    page_sha = hashlib.sha256(page_bytes).hexdigest()
    markdown_path = "page-0000.md"
    (bundle / markdown_path).write_bytes(page_bytes)
    _write_json(bundle / "manifest.json", {
        "schema_version": 1,
        "producer": "codex-pdf-skill",
        "source": {
            "source_id": f"pdf:{ASSET_ROOT_ID}",
            "title": "Pi Probe Module",
            "path": str(pdf),
            "file_sha256": file_sha,
            "page_count": 1,
        },
        "pages": [{
            "pdf_index": 0,
            "markdown_path": markdown_path,
            "text_sha256": page_sha,
            "review_state": "manual_accepted",
            "parse_confidence": 0.99,
            "grep_anchors": ["The Saltmarsh Inn, Blackwater Harbor"],
        }],
    })
    registration = assets.register_source_bundle(
        workspace,
        bundle,
        asset_root_id=ASSET_ROOT_ID,
        module_identity={"canonical_module_id": ASSET_ROOT_ID},
    )

    # 3. Bind the campaign scenario to the registered source root.
    identity = json.loads(
        (
            workspace / ".coc" / "module-assets" / ASSET_ROOT_ID
            / "identity.json"
        ).read_text(encoding="utf-8")
    )
    campaign_dir = workspace / ".coc" / "campaigns" / CAMPAIGN_ID
    scenario_path = campaign_dir / "scenario" / "scenario.json"
    scenario = (
        json.loads(scenario_path.read_text(encoding="utf-8"))
        if scenario_path.is_file() else {"schema_version": 1}
    )
    scenario.update({
        "source_cache_asset_root_id": ASSET_ROOT_ID,
        "source": {
            **identity["source"],
            "bundle_sha256": registration["bundle_sha256"],
        },
    })
    _write_json(scenario_path, scenario)

    # 4. Skeleton with one toc_only start location spanning the opening page.
    skeleton = {
        "schema_version": 1,
        "parse_tier": 1,
        "module_identity": {
            "canonical_module_id": ASSET_ROOT_ID,
            "canonical_title": "Pi Probe Module",
        },
        "structure_type": "branching_investigation",
        "source": identity["source"],
        "start_candidates": [START_LOCATION_ID],
        "finale_buckets": [
            {"id": "end", "title": "End", "importance": "critical"},
        ],
        "locations": [{
            "location_id": START_LOCATION_ID,
            "title": "The Saltmarsh Inn",
            "parse_state": "toc_only",
            "source_span": {"pdf_index_start": 0, "pdf_index_end": 0},
        }],
        "edges_provisional": [],
        "npc_roster": [],
        "handouts": [],
        "threats": [],
        "conclusion_buckets": [],
        "mechanics_locator_pass_status": "pending",
        "start_clock_status": "unresolved",
    }
    published = toolbox.run_tool(
        "progressive.publish_skeleton", workspace, CAMPAIGN_ID,
        {
            "asset_root_id": ASSET_ROOT_ID,
            "source_file_sha256": file_sha,
            "skeleton": skeleton,
        },
    )
    if not published.get("ok"):
        raise SystemExit(f"publish_skeleton failed: {published}")

    # 5. Enqueue the exact partial_opening slice.
    requested = toolbox.run_tool(
        "progressive.request_opening_pack", workspace, CAMPAIGN_ID,
        {
            "asset_root_id": ASSET_ROOT_ID,
            "source_file_sha256": file_sha,
            "start_location_id": START_LOCATION_ID,
            "opening_pdf_indices": OPENING_PDF_INDICES,
            "request_purpose": "foreground_opening_slice",
        },
    )
    if not requested.get("ok"):
        raise SystemExit(f"request_opening_pack failed: {requested}")
    job_id = str(requested["data"].get("job_id") or "")

    # 6. Deterministically materialize the durable host-work handoff.
    materialized = worker.run_worker_once(workspace, parallel=1)
    if materialized.get("claimed", 0) < 1:
        raise SystemExit(f"queue worker claimed nothing: {materialized}")

    # 7. Verify exactly one runnable, unleased partial_opening request.
    open_requests = assets.list_host_work_requests(
        workspace, ASSET_ROOT_ID, limit=None,
    )
    runnable = [
        row for row in open_requests
        if row.get("operational_class") == "runnable"
        and row.get("kind") == "partial_opening"
    ]
    if len(runnable) != 1:
        raise SystemExit(
            f"expected exactly one runnable partial_opening request, "
            f"got {len(runnable)}: {json.dumps(open_requests, indent=2)}"
        )
    row = runnable[0]
    if row.get("cached_scope_complete") is not True:
        raise SystemExit(f"request cache scope incomplete: {row}")
    if row.get("requested_pdf_indices") != OPENING_PDF_INDICES:
        raise SystemExit(f"unexpected page scope: {row}")

    # 8. Project the exact repository-produced Pi coordinator task. The probe
    #    feeds this unchanged to the private coordinator lifecycle, so the
    #    packet is repository-produced rather than hand-assembled.
    dispatch = toolbox._pi_source_coordinator_dispatch(
        workspace_root=str(workspace),
        campaign_id=CAMPAIGN_ID,
        asset_root_id=ASSET_ROOT_ID,
        ready_background=[row],
    )
    pi_task = dispatch.get("pi_task")
    if not isinstance(pi_task, dict):
        raise SystemExit(f"missing pi_task in dispatch: {dispatch}")

    return {
        "engineering_probe": True,
        "acceptance": False,
        "workspace": str(workspace),
        "campaign_id": CAMPAIGN_ID,
        "asset_root_id": ASSET_ROOT_ID,
        "file_sha256": file_sha,
        "bundle_sha256": registration["bundle_sha256"],
        "source_id": identity["source"]["source_id"],
        "job_id": row.get("job_id"),
        "enqueued_job_id": job_id,
        "work_group_id": row.get("work_group_id"),
        "requested_pdf_indices": row.get("requested_pdf_indices"),
        "cached_page_refs": row.get("cached_page_refs"),
        "result_contract_id": (row.get("result_contract") or {}).get(
            "contract_id"
        ),
        "pi_task": pi_task,
        "toolbox_script": str(SCRIPTS / "coc_toolbox.py"),
        "python_executable": sys.executable,
    }


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: prepare_probe_workspace.py <workspace_dir>")
    result = prepare(Path(sys.argv[1]))
    sys.stdout.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
