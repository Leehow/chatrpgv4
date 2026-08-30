#!/usr/bin/env python3
"""R7 stage-1 independent acceptance/build (post dual APPROVE reviews).

This script is the independent acceptance authority for the prepared
stage-1 candidates.  It is NOT the producer: ``_gen_r7_stage1_candidates.py``
still writes a revision-required draft and never calls accept()/build().

Inputs (immutable, reviewed):
- committed prepared candidates under
  ``plugins/coc-keeper/rulesets/coc7/rule-graph-candidates/stage1/``
- reconstructed extraction packets from the same committed rules-json /
  fixture inputs the generator uses (packets are machine-owned and were
  never model-authored)
- independent review evidence:
  ``.pi/findings/r7-review-semantics.md`` (semantic APPROVE)
  ``.pi/findings/r7-review-package.md`` (package/process APPROVE)

Process:
1. Reconstruct packets via the generator's prepare() path.
2. Pair each packet with the committed (reviewed) candidate.
3. ``coc_rule_graph.accept(packet, candidate)`` per shard.
4. ``coc_rule_graph.build(shards)``.
5. Overlay independent-review metadata, preserve per-file source
   identities, preserve ownership (healing graph/hidden; every other
   family legacy/visible), recompute graph_content_digest.

Never writes production ``rule-graph.json`` / ``rule-graph-manifest.json``.
Never flips ownership, never deletes legacy/shadow/golden surfaces.
"""
from __future__ import annotations

import copy
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
FIXTURES = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))
if str(FIXTURES) not in sys.path:
    sys.path.insert(0, str(FIXTURES))

import _gen_r7_stage1_candidates as gen  # noqa: E402
import coc_rule_graph as _rg  # noqa: E402

ACCEPTED_DIR = gen.CANDIDATES_DIR / "accepted"
REVIEWER_IDENTITY = "r7-review-semantics-package"
REVIEW_STATUS = "accepted"

# Independent review evidence. Paths are repo-relative; reasons are the
# published verdicts. Bound as contract findings (code/path/message) so the
# build manifest — not an extra sidecar — carries the acceptance authority.
REVIEW_EVIDENCE_FINDINGS = [
    {
        "code": "independent_review",
        "path": "/reviewer_identity/r7-review-semantics",
        "message": (
            "Independent semantic review APPROVE (reviewer r7-review-semantics). "
            "Evidence: .pi/findings/r7-review-semantics.md. Overall verdict: "
            "APPROVE AS PREPARED CANDIDATES. Families social, psychology, "
            "resource, core-check, push-luck, development/lookups, and healing "
            "preservation closed prior semantic blockers without broadening "
            "unsupported compiled claims."
        ),
    },
    {
        "code": "independent_review",
        "path": "/reviewer_identity/r7-review-package",
        "message": (
            "Independent package/process review APPROVE (reviewer "
            "r7-review-package). Evidence: .pi/findings/r7-review-package.md. "
            "Package/process verdict: APPROVE. No self-acceptance; immutable "
            "baseline generation; exhaustive healing byte equality; per-file "
            "source identities; ownership unchanged. Acceptance metadata "
            "requirements 1-7 applied at this independent accept/build step."
        ),
    },
]


def _canonical_bytes(obj) -> bytes:
    return json.dumps(obj, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _committed_candidates() -> dict[str, dict]:
    rows: dict[str, dict] = {}
    for path in sorted((gen.CANDIDATES_DIR / "candidates").glob("*.candidate.json")):
        candidate = _load(path)
        rows[candidate["section_id"]] = candidate
    return rows


def _overlay_acceptance(
    graph: dict, manifest: dict, draft: dict, baseline_manifest: dict
) -> tuple[dict, dict]:
    """Independent-review overlay on a compiler build() result.

    ``build()`` stays R1 (every family legacy, never promotion-eligible,
    reviewer_identity=deterministic). Packaging for the accepted stage-1
    candidate records the independent reviewers, preserves per-file source
    identities, and restores the production ownership ledger: healing remains
    graph/hidden; every other family remains legacy/visible.
    """
    graph = copy.deepcopy(graph)
    manifest = copy.deepcopy(manifest)
    ownership = graph.setdefault("family_runtime_ownership", {})
    lifecycle = graph.setdefault("legacy_surface_lifecycle", {})
    for family in gen.ALL_FAMILIES:
        if family == "healing":
            ownership[family] = "graph"
            lifecycle[family] = "hidden"
        else:
            ownership[family] = "legacy"
            lifecycle[family] = "visible"
    # coverage is package-level: production healing stays accepted; stage-1
    # families are the reviewed partial coverage; chase/magic stay unresolved
    coverage = copy.deepcopy(draft["family_coverage"])
    graph["coverage"] = coverage
    manifest["family_coverage"] = copy.deepcopy(coverage)
    manifest["family_promotion_eligibility"] = copy.deepcopy(
        draft["family_promotion_eligibility"]
    )
    # healing promotion row must remain byte-equal to the committed baseline
    manifest["family_promotion_eligibility"]["healing"] = copy.deepcopy(
        baseline_manifest["family_promotion_eligibility"]["healing"]
    )
    manifest["source_bundles"] = copy.deepcopy(draft["source_bundles"])
    findings = copy.deepcopy(draft["findings"])
    seen = {(row.get("code"), row.get("path")) for row in findings}
    for row in REVIEW_EVIDENCE_FINDINGS:
        key = (row["code"], row["path"])
        if key not in seen:
            findings.append(copy.deepcopy(row))
            seen.add(key)
    manifest["findings"] = findings
    manifest["reviewer_identity"] = REVIEWER_IDENTITY
    manifest["review_status"] = REVIEW_STATUS
    # shard digests and compiler identity stay the machine build() values
    manifest["graph_content_digest"] = _rg._json_digest(graph)
    return graph, manifest


def accept_and_build(evidence_root: Path) -> tuple[dict, dict]:
    """Run canonical accept()/build() against the committed reviewed candidates."""
    committed = _committed_candidates()
    draft = _load(gen.CANDIDATES_DIR / "manifest-draft.json")
    baseline_manifest = _load(gen.BASELINE_MANIFEST)
    _rg.clear_accepted_session()
    with tempfile.TemporaryDirectory(prefix="r7-stage1-packets-") as raw:
        packets, regenerated, _bindings, _stats = gen.build_stage1_work(Path(raw))
    # the packets are reconstructed; the candidates under review are the
    # committed files. regenerated candidates must match or acceptance is
    # accepting something other than the reviewed package.
    for candidate in regenerated:
        section = candidate["section_id"]
        on_disk = committed.get(section)
        if on_disk is None:
            raise SystemExit(f"missing committed candidate for {section}")
        if json.dumps(candidate, sort_keys=True) != json.dumps(on_disk, sort_keys=True):
            raise SystemExit(
                f"committed candidate {section} drifted from immutable regeneration"
            )
    accepted_shards: list[dict] = []
    for packet, candidate in zip(packets, regenerated, strict=True):
        reviewed = committed[candidate["section_id"]]
        result = _rg.accept(packet, reviewed, evidence_root=evidence_root)
        if not result.get("ok"):
            raise SystemExit(
                f"accept() failed for {candidate['section_id']}: {result.get('findings')}"
            )
        accepted_shards.append(result["shard"])
    built = _rg.build(accepted_shards, evidence_root=evidence_root)
    if not built.get("ok"):
        raise SystemExit(f"build() failed: {built.get('findings')}")
    return _overlay_acceptance(
        built["graph"], built["manifest"], draft, baseline_manifest
    )


def write_accepted(out_dir: Path, graph: dict, manifest: dict) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "rule-graph.json").write_bytes(_canonical_bytes(graph))
    (out_dir / "rule-graph-manifest.json").write_bytes(_canonical_bytes(manifest))


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="r7-stage1-evidence-") as raw:
        graph, manifest = accept_and_build(Path(raw))
    write_accepted(ACCEPTED_DIR, graph, manifest)
    print("stage-1 independent acceptance written:")
    print(f"  dir: {ACCEPTED_DIR.relative_to(ROOT)}")
    print(f"  nodes: {len(graph['nodes'])}  relations: {len(graph['relations'])}")
    print(f"  shards: {len(manifest['shards'])}")
    print(f"  source_bundles: {len(manifest['source_bundles'])} (per-file)")
    print(f"  findings: {len(manifest['findings'])}")
    print(f"  review_status: {manifest['review_status']}")
    print(f"  reviewer_identity: {manifest['reviewer_identity']}")
    print(f"  graph_content_digest: {manifest['graph_content_digest']}")
    print(
        "  ownership: healing="
        f"{graph['family_runtime_ownership']['healing']}/"
        f"{graph['legacy_surface_lifecycle']['healing']}, "
        "others=legacy/visible"
    )
    print("  production rule-graph.json/manifest: untouched")


if __name__ == "__main__":
    main()
