from __future__ import annotations

import hashlib
import importlib.util
import json
import subprocess
import sys
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
MODULE_PATH = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_eval_calibration.py"
CLI_PATH = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_eval.py"
SCHEMA_PATH = REPO / "evaluation" / "spec" / "v1" / "calibration-schema.json"
HOLDOUT_MANIFEST_PATH = REPO / "evaluation" / "spec" / "v1" / "holdout-manifest.json"
MANIFEST_PATH = REPO / "evaluation" / "spec" / "v1" / "benchmark-manifest.json"

DECISIONS = ("A", "B", "tie", "uncertain")


def _load():
    assert MODULE_PATH.is_file(), f"missing implementation module: {MODULE_PATH}"
    spec = importlib.util.spec_from_file_location(
        "coc_eval_calibration_test", MODULE_PATH
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules["coc_eval_calibration_test"] = module
    spec.loader.exec_module(module)
    return module


def _load_cli():
    assert CLI_PATH.is_file(), f"missing CLI module: {CLI_PATH}"
    spec = importlib.util.spec_from_file_location(
        "coc_eval_cli_calibration_test", CLI_PATH
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules["coc_eval_cli_calibration_test"] = module
    spec.loader.exec_module(module)
    return module


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _sha256_text(text: str) -> str:
    return _sha256_bytes(text.encode("utf-8"))


def _write_json(path: Path, payload: object) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return path


def _hash_hex(seed: str) -> str:
    return _sha256_text(seed)


def _valid_review(
    *,
    item_id: str = "item-001",
    reviewer_id: str = "rev-a",
    decision: str = "A",
    extra: dict | None = None,
) -> dict:
    payload = {
        "item_id": item_id,
        "reviewer_id": reviewer_id,
        "rubric_id": "agency-and-fun",
        "rubric_version": "1",
        "decision": decision,
        "evidence_spans": [
            {"turn_id": "t-3", "span_id": "span-1", "note_code": "ACTION_ACK"}
        ],
        "reviewed_at": "2026-07-13T00:00:00Z",
        "request_sha256": _hash_hex(f"request-{item_id}"),
        "artifact_sha256": _hash_hex(f"artifact-{item_id}"),
    }
    if extra:
        payload.update(extra)
    return payload


def _valid_reviews_doc(reviews: list[dict]) -> dict:
    return {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "rubric_id": "agency-and-fun",
        "rubric_version": "1",
        "request_sha256": _hash_hex("batch-request"),
        "artifact_sha256": _hash_hex("batch-artifact"),
        "reviews": reviews,
    }


def test_calibration_schema_file_exists_and_forbids_label_keys():
    assert SCHEMA_PATH.is_file()
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    assert schema["properties"]["schema_version"]["const"] == 1
    assert schema["properties"]["eval_spec"]["const"] == "eval-spec-v1"
    review_def = schema["$defs"]["review_item"]
    required = set(review_def["required"])
    assert {
        "item_id",
        "reviewer_id",
        "rubric_id",
        "rubric_version",
        "decision",
        "evidence_spans",
        "reviewed_at",
        "request_sha256",
        "artifact_sha256",
    } <= required
    assert "baseline" not in review_def["properties"]
    assert "candidate" not in review_def["properties"]
    assert "not" in review_def


def test_holdout_manifest_contains_ids_and_hashes_only():
    assert HOLDOUT_MANIFEST_PATH.is_file()
    payload = json.loads(HOLDOUT_MANIFEST_PATH.read_text(encoding="utf-8"))
    assert payload["schema_version"] == 1
    assert payload["eval_spec"] == "eval-spec-v1"
    assert payload["holdouts"]
    raw = HOLDOUT_MANIFEST_PATH.read_text(encoding="utf-8").lower()
    for fragment in (
        "what should the player",
        "correct solution",
        "answer key",
    ):
        assert fragment not in raw
    for item in payload["holdouts"]:
        assert item["holdout_id"]
        assert item["suite"] in {"nightly", "release"}
        assert item["artifact_kind"]
        assert isinstance(item["sha256"], str) and len(item["sha256"]) == 64
        # No content payloads in-repo.
        assert "question" not in item
        assert "answer" not in item
        assert "expected" not in item


def test_validate_calibration_rejects_baseline_candidate_labels():
    mod = _load()
    poisoned = _valid_reviews_doc(
        [
            _valid_review(extra={"baseline": "left", "candidate": "right"}),
        ]
    )
    result = mod.validate_calibration_reviews(poisoned)
    assert result["status"] == "FAIL"
    assert any(item["code"] == "label_leakage" for item in result["findings"])


def test_validate_calibration_accepts_blinded_reviews():
    mod = _load()
    doc = _valid_reviews_doc(
        [
            _valid_review(item_id="item-001", reviewer_id="rev-a", decision="A"),
            _valid_review(item_id="item-001", reviewer_id="rev-b", decision="A"),
        ]
    )
    result = mod.validate_calibration_reviews(doc)
    assert result["status"] == "PASS"
    assert result["findings"] == []


def test_compute_agreement_known_kappa_fixture():
    """Classic 2x2 confusion matrix with kappa == 0.4.

    Yes/No counts:
           Yes  No
    Yes     20   5
    No      10  15
    """
    mod = _load()
    reviews = []
    # 20 Yes/Yes
    for i in range(20):
        reviews.append(_valid_review(item_id=f"y-y-{i}", reviewer_id="r1", decision="A"))
        reviews.append(_valid_review(item_id=f"y-y-{i}", reviewer_id="r2", decision="A"))
    # 5 Yes/No
    for i in range(5):
        reviews.append(_valid_review(item_id=f"y-n-{i}", reviewer_id="r1", decision="A"))
        reviews.append(_valid_review(item_id=f"y-n-{i}", reviewer_id="r2", decision="B"))
    # 10 No/Yes
    for i in range(10):
        reviews.append(_valid_review(item_id=f"n-y-{i}", reviewer_id="r1", decision="B"))
        reviews.append(_valid_review(item_id=f"n-y-{i}", reviewer_id="r2", decision="A"))
    # 15 No/No
    for i in range(15):
        reviews.append(_valid_review(item_id=f"n-n-{i}", reviewer_id="r1", decision="B"))
        reviews.append(_valid_review(item_id=f"n-n-{i}", reviewer_id="r2", decision="B"))

    result = mod.compute_agreement(reviews)
    assert result["status"] == "PASS"
    assert result["reviewer_count"] == 2
    assert abs(result["exact_agreement"] - 0.7) < 1e-9
    assert abs(result["cohen_kappa"] - 0.4) < 1e-9


def test_compute_agreement_empty_or_single_reviewer_is_not_run():
    mod = _load()
    empty = mod.compute_agreement([])
    assert empty["status"] == "NOT_RUN"
    assert "cohen_kappa" not in empty or empty.get("cohen_kappa") is None
    assert empty.get("exact_agreement") is None

    single = mod.compute_agreement(
        [_valid_review(item_id="only-1", reviewer_id="solo", decision="A")]
    )
    assert single["status"] == "NOT_RUN"
    assert single.get("exact_agreement") is None
    assert single.get("cohen_kappa") is None


def test_compute_agreement_perfect_and_zero_variance_edge_cases():
    mod = _load()
    perfect = []
    for i in range(8):
        perfect.append(_valid_review(item_id=f"p-{i}", reviewer_id="r1", decision="A"))
        perfect.append(_valid_review(item_id=f"p-{i}", reviewer_id="r2", decision="A"))
    result = mod.compute_agreement(perfect)
    assert result["status"] == "PASS"
    assert result["exact_agreement"] == 1.0
    assert result["cohen_kappa"] == 1.0

    # All pairs identical category → pe == 1; must not divide by zero.
    degenerate = []
    for i in range(5):
        degenerate.append(
            _valid_review(item_id=f"d-{i}", reviewer_id="r1", decision="tie")
        )
        degenerate.append(
            _valid_review(item_id=f"d-{i}", reviewer_id="r2", decision="tie")
        )
    deg = mod.compute_agreement(degenerate)
    assert deg["status"] == "PASS"
    assert deg["cohen_kappa"] == 1.0


def test_compute_agreement_multi_reviewer_pairwise_and_aggregate():
    mod = _load()
    reviews = []
    for item_id, decisions in (
        ("m-1", {"r1": "A", "r2": "A", "r3": "A"}),
        ("m-2", {"r1": "A", "r2": "B", "r3": "A"}),
        ("m-3", {"r1": "B", "r2": "B", "r3": "B"}),
    ):
        for reviewer_id, decision in decisions.items():
            reviews.append(
                _valid_review(
                    item_id=item_id, reviewer_id=reviewer_id, decision=decision
                )
            )
    result = mod.compute_agreement(reviews)
    assert result["status"] == "PASS"
    assert result["reviewer_count"] == 3
    assert "pairwise" in result
    assert len(result["pairwise"]) == 3
    assert isinstance(result["exact_agreement"], float)
    assert 0.0 <= result["exact_agreement"] <= 1.0


def test_validate_holdout_bundle_missing_is_not_run(tmp_path: Path):
    mod = _load()
    result = mod.validate_holdout_bundle(
        HOLDOUT_MANIFEST_PATH, tmp_path / "missing-bundle"
    )
    assert result["status"] == "NOT_RUN"
    assert any(item["code"] == "holdout_bundle_missing" for item in result["findings"])


def test_validate_holdout_bundle_hash_mismatch_fails(tmp_path: Path):
    mod = _load()
    manifest = json.loads(HOLDOUT_MANIFEST_PATH.read_text(encoding="utf-8"))
    bundle = tmp_path / "bundle"
    for item in manifest["holdouts"]:
        path = bundle / item["relative_path"]
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('{"tampered": true}\n', encoding="utf-8")
    result = mod.validate_holdout_bundle(HOLDOUT_MANIFEST_PATH, bundle)
    assert result["status"] == "FAIL"
    assert any(item["code"] == "holdout_hash_mismatch" for item in result["findings"])


def test_validate_holdout_bundle_matching_hashes_pass(tmp_path: Path):
    mod = _load()
    manifest = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "manifest_version": "test",
        "holdouts": [
            {
                "holdout_id": "holdout-test-01",
                "suite": "release",
                "artifact_kind": "blind_pair_bundle",
                "relative_path": "holdout-test-01/bundle.json",
                "sha256": "",
            }
        ],
    }
    bundle = tmp_path / "ok-bundle"
    rel = Path(manifest["holdouts"][0]["relative_path"])
    path = bundle / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    body = '{"holdout_id":"holdout-test-01","payload":"structured-only"}\n'
    path.write_text(body, encoding="utf-8")
    manifest["holdouts"][0]["sha256"] = _sha256_text(body)
    manifest_path = tmp_path / "holdout-manifest.json"
    _write_json(manifest_path, manifest)
    result = mod.validate_holdout_bundle(manifest_path, bundle)
    assert result["status"] == "PASS"
    assert result["findings"] == []


def test_validate_holdout_tampered_manifest_is_fail(tmp_path: Path):
    mod = _load()
    # Self-inconsistent: duplicate holdout_id with conflicting hashes.
    bad = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "manifest_version": "tampered",
        "holdouts": [
            {
                "holdout_id": "dup",
                "suite": "release",
                "artifact_kind": "blind_pair_bundle",
                "relative_path": "a/bundle.json",
                "sha256": "a" * 64,
            },
            {
                "holdout_id": "dup",
                "suite": "release",
                "artifact_kind": "blind_pair_bundle",
                "relative_path": "b/bundle.json",
                "sha256": "b" * 64,
            },
        ],
    }
    manifest_path = tmp_path / "bad-manifest.json"
    _write_json(manifest_path, bad)
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    result = mod.validate_holdout_bundle(manifest_path, bundle)
    assert result["status"] == "FAIL"
    assert any(item["code"] == "holdout_manifest_inconsistent" for item in result["findings"])


def test_human_calibration_not_claimed_in_implemented_capabilities():
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    implemented = set(manifest["implemented_capabilities"])
    assert "human_calibration" not in implemented
    assert "long_memory" not in implemented
    assert "chapter_transition" not in implemented
    assert "human_calibration" in manifest["suites"]["release"]["required_capabilities"]
    assert "long_memory" in manifest["suites"]["nightly"]["required_capabilities"]


def test_calibrate_and_holdouts_cli_wiring(tmp_path: Path):
    cli = _load_cli()
    mod = _load()

    reviews = _valid_reviews_doc(
        [
            _valid_review(item_id="cli-1", reviewer_id="r1", decision="A"),
            _valid_review(item_id="cli-1", reviewer_id="r2", decision="A"),
        ]
    )
    reviews_path = tmp_path / "reviews.json"
    _write_json(reviews_path, reviews)

    code = cli.main(["calibrate", "--reviews", str(reviews_path), "--root", str(REPO)])
    assert code == cli.EXIT_BY_STATUS["PASS"]

    # Matching holdout bundle for a temp manifest.
    body = '{"ok":true}\n'
    digest = _sha256_text(body)
    holdout_manifest = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "manifest_version": "cli-test",
        "holdouts": [
            {
                "holdout_id": "holdout-cli-01",
                "suite": "release",
                "artifact_kind": "blind_pair_bundle",
                "relative_path": "holdout-cli-01/bundle.json",
                "sha256": digest,
            }
        ],
    }
    manifest_path = tmp_path / "holdout-manifest.json"
    _write_json(manifest_path, holdout_manifest)
    bundle = tmp_path / "holdouts"
    path = bundle / "holdout-cli-01" / "bundle.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")

    code2 = cli.main(
        [
            "holdouts",
            "--manifest",
            str(manifest_path),
            "--bundle",
            str(bundle),
            "--root",
            str(REPO),
        ]
    )
    assert code2 == cli.EXIT_BY_STATUS["PASS"]

    # Sanity: module helpers still agree with CLI PASS path.
    assert mod.validate_calibration_reviews(reviews)["status"] == "PASS"
    assert mod.validate_holdout_bundle(manifest_path, bundle)["status"] == "PASS"


def test_calibrate_cli_not_run_on_single_reviewer(tmp_path: Path, capsys):
    cli = _load_cli()
    reviews = _valid_reviews_doc(
        [_valid_review(item_id="solo", reviewer_id="only", decision="B")]
    )
    reviews_path = tmp_path / "solo.json"
    _write_json(reviews_path, reviews)
    code = cli.main(["calibrate", "--reviews", str(reviews_path), "--root", str(REPO)])
    assert code == cli.EXIT_BY_STATUS["NOT_RUN"]
    captured = capsys.readouterr().out
    payload = json.loads(captured.strip().splitlines()[-1])
    assert payload["status"] == "NOT_RUN"
