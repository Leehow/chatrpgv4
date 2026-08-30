#!/usr/bin/env python3
"""R7 stage-1 prepared candidates plus independent accepted package.

The producer (``tests/fixtures/_gen_r7_stage1_candidates.py``) still writes
only a revision-required draft from immutable committed inputs.  Independent
accept/build (``tests/fixtures/_accept_r7_stage1.py``) consumes those reviewed
candidates via the canonical ``accept()``/``build()`` APIs, binds both
independent reviews, and writes ``accepted/rule-graph.json`` plus
``accepted/rule-graph-manifest.json``.  Production artifacts stay the
committed pre-stage1 bytes.

Floors asserted here:

- Prepared draft remains ``review_status="revision-required"`` /
  ``reviewer_identity=None`` with unset digests (producer never accepts).
- Accepted package: ``review_status="accepted"``, reviewer identity derived
  from the independent reviews, real graph/shard digests, both review
  evidence paths bound as contract findings.
- Healing byte preservation: production graph and manifest stay byte-identical
  to the pre-stage1 baselines; candidates and the accepted graph never
  redeclare healing-owned ``resource:coc7:hp``.
- Unsupported claims absent from candidates (and therefore from the accepted
  graph): higher-of social composition, PC-coercion penalty, psychology truth
  mapping, generic HP/MP/Luck delta.
- Per-file source identities preserved through accept/build.
- Ownership unchanged: healing graph/hidden, every other family legacy/visible.
  Nothing integrated into production; nothing deleted.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests" / "fixtures"))
sys.path.insert(0, str(ROOT / "plugins" / "coc-keeper" / "scripts"))

import _accept_r7_stage1 as acc  # noqa: E402
import _gen_r7_stage1_candidates as gen  # noqa: E402
import coc_rule_graph  # noqa: E402

GRAPH = ROOT / "plugins/coc-keeper/rulesets/coc7/rule-graph.json"
MANIFEST = ROOT / "plugins/coc-keeper/rulesets/coc7/rule-graph-manifest.json"
PACKAGE = ROOT / "plugins/coc-keeper/rulesets/coc7/manifest.json"
RULES_JSON = ROOT / "plugins/coc-keeper/rulesets/coc7/rules-json"
CANDIDATES = ROOT / "plugins/coc-keeper/rulesets/coc7/rule-graph-candidates/stage1"
ACCEPTED = CANDIDATES / "accepted"
BASELINE_GRAPH = ROOT / "tests/fixtures/coc7-rule-graph-pre-stage1.json"
BASELINE_MANIFEST = ROOT / "tests/fixtures/coc7-rule-graph-manifest-pre-stage1.json"
CONTRACT = json.loads(
    (ROOT / "plugins/coc-keeper/references/rule-graph-contract-v1.json").read_text()
)

STAGE1_PARTIAL = sorted(gen.STAGE1_PARTIAL)
# healing-owned production ids that no candidate may redeclare
HEALING_OWNED_IDS = (
    "resource:coc7:hp",
    "rule-family:coc7:healing",
    "capability:coc7:first-aid",
    "condition:coc7:healing:medicine-ordinary-eligible",
)


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _candidate_tree() -> dict[str, dict]:
    """Prepared producer tree only; independent accepted/ artifacts excluded."""
    tree: dict[str, dict] = {}
    for path in sorted(CANDIDATES.rglob("*.json")):
        rel = path.relative_to(CANDIDATES).as_posix()
        if rel.startswith("accepted/"):
            continue
        tree[rel] = _load(path)
    return tree


@pytest.fixture(scope="module")
def draft_manifest() -> dict:
    return _load(CANDIDATES / "manifest-draft.json")


# ---------------------------------------------------------------------------
# Healing byte preservation / production untouched
# ---------------------------------------------------------------------------


def test_production_graph_is_byte_identical_to_pre_stage1_baseline():
    assert _sha256(GRAPH) == _sha256(BASELINE_GRAPH)
    assert GRAPH.read_bytes() == BASELINE_GRAPH.read_bytes()
    assert _load(GRAPH) == _load(BASELINE_GRAPH)


def test_production_manifest_is_byte_identical_to_pre_stage1_baseline():
    assert _sha256(MANIFEST) == _sha256(BASELINE_MANIFEST)
    assert MANIFEST.read_bytes() == BASELINE_MANIFEST.read_bytes()
    assert _load(MANIFEST) == _load(BASELINE_MANIFEST)


def test_healing_owned_nodes_are_byte_identical_in_production():
    prod = _load(GRAPH)
    base = _load(BASELINE_GRAPH)
    prod_by_id = {node["node_id"]: node for node in prod["nodes"]}
    base_by_id = {node["node_id"]: node for node in base["nodes"]}
    for node_id in HEALING_OWNED_IDS:
        assert prod_by_id[node_id] == base_by_id[node_id], node_id
    assert prod["relations"] == base["relations"]
    prod_manifest = _load(MANIFEST)
    base_manifest = _load(BASELINE_MANIFEST)
    assert prod_manifest["findings"] == base_manifest["findings"]
    assert (
        prod_manifest["family_promotion_eligibility"]["healing"]
        == base_manifest["family_promotion_eligibility"]["healing"]
    )
    assert any(
        row["shard_id"] == "shard:coc7:healing:section-wounds-and-healing"
        for row in prod_manifest["shards"]
    )


def test_candidates_never_redeclare_healing_owned_content(draft_manifest):
    for rel, obj in _candidate_tree().items():
        if rel == "manifest-draft.json":
            continue
        ids = {node["node_id"] for node in obj.get("nodes", [])}
        endpoints = {
            node_id
            for rel_row in obj.get("relations", [])
            for node_id in (rel_row["from_node_id"], rel_row["to_node_id"])
        }
        for healing_id in HEALING_OWNED_IDS:
            assert healing_id not in ids, (rel, healing_id)
            assert healing_id not in endpoints, (rel, healing_id)
    # new families reference pools only under distinct family-scoped ids
    all_ids = {
        node["node_id"]
        for rel, obj in _candidate_tree().items()
        if rel.startswith("candidates/")
        for node in obj["nodes"]
    }
    assert "resource:coc7:combat:hp" in all_ids
    assert "resource:coc7:push-luck:luck" in all_ids
    assert draft_manifest["family_coverage"]["healing"] == "accepted"
    assert draft_manifest["family_promotion_eligibility"]["healing"] == _load(
        BASELINE_MANIFEST
    )["family_promotion_eligibility"]["healing"]


def test_baseline_findings_survive_verbatim_in_draft(draft_manifest):
    baseline = _load(BASELINE_MANIFEST)
    draft_codes = {
        (row["code"], row["path"]) for row in draft_manifest["findings"]
    }
    for finding in baseline["findings"]:
        assert (finding["code"], finding["path"]) in draft_codes, finding


# ---------------------------------------------------------------------------
# Deterministic regeneration from the immutable baseline
# ---------------------------------------------------------------------------


def test_candidate_tree_equals_generator_output_from_immutable_inputs(tmp_path):
    written = gen.build_candidates(tmp_path)
    committed = _candidate_tree()
    assert sorted(written) == sorted(committed), "candidate tree file set drifted"
    for rel in sorted(committed):
        produced = (tmp_path / rel).read_bytes()
        on_disk = (CANDIDATES / rel).read_bytes()
        assert produced == on_disk, f"non-deterministic or stale output: {rel}"
    # the generator never reads the production artifacts or its own output:
    # its declared inputs are the committed baselines, fixtures, rules-json
    assert gen.BASELINE_GRAPH == BASELINE_GRAPH
    assert gen.BASELINE_MANIFEST == BASELINE_MANIFEST


def test_regeneration_is_idempotent(tmp_path):
    first = gen.build_candidates(tmp_path / "a")
    second = gen.build_candidates(tmp_path / "b")
    for rel in sorted(first):
        assert (tmp_path / "a" / rel).read_bytes() == (
            tmp_path / "b" / rel
        ).read_bytes(), rel


def test_candidates_are_contract_clean():
    allowed = {
        kind: set(keys) for kind, keys in CONTRACT["node_property_keys"].items()
    }
    for rel, obj in _candidate_tree().items():
        if not rel.startswith("candidates/"):
            continue
        for node in obj["nodes"]:
            extra = set(node.get("properties") or {}) - allowed.get(
                node["node_kind"], set()
            )
            assert not extra, (rel, node["node_id"], extra)


# ---------------------------------------------------------------------------
# Prepared, not accepted
# ---------------------------------------------------------------------------


def test_manifest_draft_is_revision_required_without_reviewer(draft_manifest):
    assert draft_manifest["contract_id"] == coc_rule_graph.BUILD_MANIFEST_CONTRACT_ID
    assert draft_manifest["review_status"] == "revision-required"
    assert draft_manifest["reviewer_identity"] is None
    assert draft_manifest["compiler_identity"] == "coc.rule-graph-compiler.v1"


def test_manifest_draft_build_state_is_unset_pending_review(draft_manifest):
    # accept()/build() belong to the independent reviewers; the draft must not
    # pretend a build happened
    assert draft_manifest["graph_content_digest"] is None
    assert draft_manifest["shards"], "no shard rows"
    for row in draft_manifest["shards"]:
        assert row["shard_digest"] is None, row


def test_generator_module_never_accepts_or_builds():
    source = gen.__file__
    assert source is not None
    text = Path(source).read_text(encoding="utf-8")
    assert "_rg.accept(" not in text
    assert "_rg.build(" not in text
    assert 'review_status": "accepted"' not in text


# ---------------------------------------------------------------------------
# Unsupported claims absent
# ---------------------------------------------------------------------------


def _all_candidate_node_ids_and_names() -> dict[str, str]:
    out: dict[str, str] = {}
    for rel, obj in _candidate_tree().items():
        if rel.startswith("candidates/"):
            for node in obj["nodes"]:
                out[node["node_id"]] = node["name"]
    return out


def test_dropped_unsupported_claims_are_absent_everywhere():
    dropped = (
        *gen.SOCIAL_DROP,
        *gen.PSYCHOLOGY_DROP,
        *gen.GENERIC_RESOURCE_DROP,
        gen.FUMBLE_OLD,
        "resource:coc7:san",
    )
    seen = _all_candidate_node_ids_and_names()
    for node_id in dropped:
        assert node_id not in seen, node_id


def test_absence_markers_present_and_named_as_uncompiled():
    seen = _all_candidate_node_ids_and_names()
    absence_words = (
        "uncompiled", "not stated", "not encoded", "not in",
        "not extracted", "compiles only",
    )
    for node_id in (
        "exception:coc7:social:higher-of-composition-uncompiled",
        "exception:coc7:psychology:truth-mapping-uncompiled",
        "exception:coc7:push-luck:fumble-push-uncompiled",
        "exception:coc7:social:pc-coercion-penalty-uncompiled",
        "exception:coc7:psychology:disguise-uncompiled",
        "exception:coc7:sanity:check-then-loss-uncompiled",
    ):
        assert node_id in seen, node_id
        assert node_id.endswith("-uncompiled"), node_id
        name = seen[node_id].lower()
        assert any(word in name for word in absence_words), node_id


def test_social_higher_of_composition_is_not_compiled():
    seen = _all_candidate_node_ids_and_names()
    rule = "rule:coc7:social:opposing-difficulty"
    assert rule in seen
    # compiled claim keeps only the source-backed opposed_by ladder
    assert "psychology" not in seen[rule].lower(), seen[rule]
    assert "higher" not in seen[rule].lower(), seen[rule]


def test_psychology_truth_mapping_is_not_compiled():
    seen = _all_candidate_node_ids_and_names()
    assert "rule:coc7:psychology:success-reveals-truth" not in seen
    # the concealed-observation rule keeps only its source-backed claim
    concealed = "rule:coc7:psychology:concealed-observation"
    assert concealed in seen
    assert "true or false" in seen[concealed].lower(), seen[concealed]
    assert "success" not in seen[concealed].lower(), seen[concealed]


def test_ambiguity_findings_never_coexist_with_compiled_target_claims(
    draft_manifest,
):
    seen = _all_candidate_node_ids_and_names()
    codes = {
        (row["code"], row["path"]) for row in draft_manifest["findings"]
    }
    compiled_absent = {
        ("source_ambiguity", "/rule:coc7:core-check:resource-arithmetic"):
            "rule:coc7:core-check:resource-arithmetic",
        ("source_ambiguity", "/exception:coc7:social:no-chance"):
            "exception:coc7:social:no-chance",
        ("source_ambiguity", "/exception:coc7:push-luck:fumble-push-uncompiled"):
            gen.FUMBLE_OLD,
    }
    for key, node_id in compiled_absent.items():
        assert key in codes, key
        assert node_id not in seen, node_id
    # higher-of and truth-mapping keep exception markers, not compiled rules
    assert ("source_ambiguity", "/rule:coc7:social:opposing-difficulty/higher-of-composition") in codes
    assert ("source_ambiguity", "/exception:coc7:psychology:truth-mapping-uncompiled") in codes
    assert "exception:coc7:social:higher-of-composition-uncompiled" in seen
    assert "exception:coc7:psychology:truth-mapping-uncompiled" in seen


def test_social_decision_payload_matches_narrowed_claim():
    found = False
    for rel, obj in _candidate_tree().items():
        if not rel.startswith("candidates/"):
            continue
        for node in obj["nodes"]:
            if node["node_id"] == "decision:coc7:social:adjudicate-difficulty":
                found = True
                impl = node["properties"]["implementation"]
                names = {slot["name"] for slot in impl["payload_slots"]}
                assert names == set(gen.SOCIAL_PAYLOAD_KEEP)
                blob = json.dumps(impl, ensure_ascii=False).lower()
                for word in ("motive", "leverage"):
                    assert word not in node["name"].lower(), node["name"]
                    assert word not in blob, (node["node_id"], word)
    assert found, "social adjudicate decision missing from candidates"


def test_generic_resource_channel_is_not_compiled():
    seen = _all_candidate_node_ids_and_names()
    for node_id in (
        "rule:coc7:core-check:resource-arithmetic",
        "decision:coc7:core-check:resource-delta",
        "capability:coc7:resource-delta",
        "effect:coc7:core-check:resource-mutate",
        "visibility-policy:coc7:core-check:host-internal-resource",
        "resource:coc7:mp",
    ):
        assert node_id not in seen, node_id
    assert ("source_ambiguity", "/rule:coc7:core-check:resource-arithmetic") in {
        (row["code"], row["path"]) for row in _load(
            CANDIDATES / "manifest-draft.json"
        )["findings"]
    }


# ---------------------------------------------------------------------------
# Per-file source identities
# ---------------------------------------------------------------------------


def test_source_bundles_are_per_file_semantic_identities(draft_manifest):
    rows = draft_manifest["source_bundles"]
    ids = [row["source_id"] for row in rows]
    assert len(ids) == len(set(ids)), "source ids collapsed"
    # exactly one identity per rules-json file actually cited by the shards
    cited = sorted(
        {gen.source_id_for(name) for shard in gen.SHARDS for name in shard["files"]}
    )
    assert sorted(ids) == cited, "not one source identity per cited file"
    for row in rows:
        stem = row["source_id"].removeprefix("rules-json:coc7:")
        path = RULES_JSON / f"{stem}.json"
        assert path.is_file(), row
        assert row["file_sha256"] == _sha256(path), row
        assert len(row["bundle_sha256"]) == 64
        # bundle digest is the bundle-manifest digest, distinct from the file
        assert row["bundle_sha256"] != row["file_sha256"], row


def test_provenance_records_file_paths_and_separate_digests():
    provenance_files = sorted((CANDIDATES / "provenance").glob("*.json"))
    assert len(provenance_files) == len(gen.SHARDS)
    bound: set[str] = set()
    for path in provenance_files:
        row = _load(path)
        assert row["section_id"] == path.name.removesuffix(".provenance.json")
        assert row["sources"], path
        for source in row["sources"]:
            assert source["file"] == f"{gen.RULES_JSON_REL}/{Path(source['file']).name}"
            real = ROOT / source["file"]
            assert real.is_file(), source
            assert source["file_sha256"] == _sha256(real), source
            assert source["bundle_manifest_sha256"] != source["file_sha256"]
            assert source["source_id"] == gen.source_id_for(real.name)
            bound.add(source["source_id"])
    draft_ids = {
        row["source_id"]
        for row in _load(CANDIDATES / "manifest-draft.json")["source_bundles"]
    }
    assert bound == draft_ids


def test_candidate_sources_cite_only_declared_files():
    for shard in gen.SHARDS:
        provenance = _load(
            CANDIDATES / "provenance" / f"{shard['section_id']}.provenance.json"
        )
        declared = {gen.source_id_for(name) for name in shard["files"]}
        cited = {source["source_id"] for source in provenance["sources"]}
        assert cited == declared, shard["shard_id"]
        assert provenance["span_count"] > 0, shard["shard_id"]


# ---------------------------------------------------------------------------
# Ownership unchanged, nothing deleted, nothing integrated
# ---------------------------------------------------------------------------


def test_ownership_unchanged_and_promotion_ineligible(draft_manifest):
    ruleset = _load(PACKAGE)
    assert [row["family_id"] for row in ruleset["rule_families"]] == ["healing"]
    for family in gen.ALL_FAMILIES:
        promo = draft_manifest["family_promotion_eligibility"][family]
        if family == "healing":
            assert promo["runtime_ownership"] == "graph"
            assert promo["promotion_eligible"] is False
            continue
        assert promo == {
            "promotion_eligible": False,
            "runtime_ownership": "legacy",
        }, family
    baseline = _load(BASELINE_GRAPH)
    assert baseline["family_runtime_ownership"]["healing"] == "graph"
    assert baseline["legacy_surface_lifecycle"]["healing"] == "hidden"
    for family in gen.ALL_FAMILIES:
        if family == "healing":
            continue
        assert baseline["family_runtime_ownership"][family] == "legacy"
        assert baseline["legacy_surface_lifecycle"][family] == "visible"


def test_family_coverage_matches_partial_stage1(draft_manifest):
    assert draft_manifest["family_coverage"]["healing"] == "accepted"
    for family in STAGE1_PARTIAL:
        assert draft_manifest["family_coverage"][family] == "partial"
    assert draft_manifest["family_coverage"]["chase"] == "unresolved"
    assert draft_manifest["family_coverage"]["magic"] == "unresolved"


def test_immutable_inputs_still_exist():
    for path in (
        gen.BASELINE_GRAPH,
        gen.BASELINE_MANIFEST,
        gen.THREE_FAMILY,
        gen.CHECK_LUCK,
        gen.LOOKUPS,
    ):
        assert path.is_file(), path
    for shard in gen.SHARDS:
        for name in shard["files"]:
            assert (RULES_JSON / name).is_file(), name


def test_candidate_tree_shape_matches_generator_shards(draft_manifest):
    tree = _candidate_tree()
    sections = {
        shard["section_id"] for shard in gen.SHARDS
    }
    for section in sorted(sections):
        assert f"candidates/{section}.candidate.json" in tree, section
        assert f"provenance/{section}.provenance.json" in tree, section
    assert "manifest-draft.json" in tree
    assert len(
        [rel for rel in tree if rel.startswith("candidates/")]
    ) == len(gen.SHARDS)
    assert {
        row["shard_id"] for row in draft_manifest["shards"]
    } == {shard["shard_id"] for shard in gen.SHARDS}


# ---------------------------------------------------------------------------
# Independent accept/build package (not production)
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def accepted_package() -> tuple[dict, dict]:
    return (
        _load(ACCEPTED / "rule-graph.json"),
        _load(ACCEPTED / "rule-graph-manifest.json"),
    )


def test_accepted_package_equals_independent_accept_build(tmp_path):
    graph, manifest = acc.accept_and_build(tmp_path / "evidence")
    acc.write_accepted(tmp_path / "out", graph, manifest)
    for name in ("rule-graph.json", "rule-graph-manifest.json"):
        assert (tmp_path / "out" / name).read_bytes() == (
            ACCEPTED / name
        ).read_bytes(), name


def test_accepted_reviewer_is_independent_not_producer(accepted_package):
    _graph, manifest = accepted_package
    assert manifest["review_status"] == "accepted"
    assert manifest["reviewer_identity"] == acc.REVIEWER_IDENTITY
    assert manifest["reviewer_identity"] != "deterministic"
    assert "stage1-candidates" not in manifest["reviewer_identity"]
    codes = {(row["code"], row["path"]) for row in manifest["findings"]}
    assert (
        "independent_review",
        "/reviewer_identity/r7-review-semantics",
    ) in codes
    assert (
        "independent_review",
        "/reviewer_identity/r7-review-package",
    ) in codes
    reasons = {
        row["path"]: row["message"] for row in manifest["findings"]
        if row["code"] == "independent_review"
    }
    assert ".pi/findings/r7-review-semantics.md" in reasons[
        "/reviewer_identity/r7-review-semantics"
    ]
    assert "APPROVE" in reasons["/reviewer_identity/r7-review-semantics"]
    assert ".pi/findings/r7-review-package.md" in reasons[
        "/reviewer_identity/r7-review-package"
    ]
    assert "APPROVE" in reasons["/reviewer_identity/r7-review-package"]


def test_accepted_digests_are_machine_computed(accepted_package):
    graph, manifest = accepted_package
    assert manifest["graph_content_digest"] == coc_rule_graph._json_digest(graph)
    assert len(manifest["graph_content_digest"]) == 64
    assert len(manifest["shards"]) == len(gen.SHARDS)
    for row in manifest["shards"]:
        digest = row["shard_digest"]
        assert isinstance(digest, str) and len(digest) == 64
        assert digest != "0" * 64
        assert row["shard_id"].startswith("shard:coc7:")
    assert manifest["compiler_identity"] == "coc.rule-graph-compiler.v1"


def test_accepted_preserves_per_file_source_identities(
    accepted_package, draft_manifest
):
    _graph, manifest = accepted_package
    assert manifest["source_bundles"] == draft_manifest["source_bundles"]
    ids = [row["source_id"] for row in manifest["source_bundles"]]
    assert len(ids) == len(set(ids))
    for row in manifest["source_bundles"]:
        assert row["bundle_sha256"] != row["file_sha256"]
        stem = row["source_id"].removeprefix("rules-json:coc7:")
        path = RULES_JSON / f"{stem}.json"
        assert path.is_file(), row
        assert row["file_sha256"] == _sha256(path)


def test_accepted_ownership_unchanged(accepted_package):
    graph, manifest = accepted_package
    assert graph["family_runtime_ownership"]["healing"] == "graph"
    assert graph["legacy_surface_lifecycle"]["healing"] == "hidden"
    for family in gen.ALL_FAMILIES:
        if family == "healing":
            continue
        assert graph["family_runtime_ownership"][family] == "legacy"
        assert graph["legacy_surface_lifecycle"][family] == "visible"
        promo = manifest["family_promotion_eligibility"][family]
        assert promo == {
            "promotion_eligible": False,
            "runtime_ownership": "legacy",
        }, family
    healing = manifest["family_promotion_eligibility"]["healing"]
    assert healing == _load(BASELINE_MANIFEST)["family_promotion_eligibility"][
        "healing"
    ]
    ruleset = _load(PACKAGE)
    assert [row["family_id"] for row in ruleset["rule_families"]] == ["healing"]


def test_accepted_graph_does_not_redeclare_healing_hp(accepted_package):
    graph, _manifest = accepted_package
    ids = {node["node_id"] for node in graph["nodes"]}
    for healing_id in HEALING_OWNED_IDS:
        assert healing_id not in ids, healing_id
    assert "resource:coc7:combat:hp" in ids
    assert "resource:coc7:push-luck:luck" in ids
    assert "resource:coc7:hp" not in ids


def test_accepted_package_is_not_production_integration(accepted_package):
    graph, manifest = accepted_package
    assert GRAPH.read_bytes() == BASELINE_GRAPH.read_bytes()
    assert MANIFEST.read_bytes() == BASELINE_MANIFEST.read_bytes()
    assert (ACCEPTED / "rule-graph.json").read_bytes() != GRAPH.read_bytes()
    assert (ACCEPTED / "rule-graph-manifest.json").read_bytes() != MANIFEST.read_bytes()
    assert graph["coverage"] == manifest["family_coverage"]
