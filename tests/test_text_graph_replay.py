"""TextGraph slice T2 gate 3 — replay obligations against preserved evidence.

Spec: docs/specs/pi-coc-text-graph-runtime.md §8 T2

This is the gate that matters for T2. Bit-identity tables prove that a
frozenset still contains the same strings; this proves that the *derivation*
still produces the same obligations from the same settled receipts, and that
`validate_coverage` still accepts every coverage row the product actually
wrote, bound verbatim to the draft it was written against.

The inputs are real: 370 roll receipts read from the preserved `rolls.jsonl`
logs, fed to the real `_build_obligations`, compared against the
`obligation_ids` recorded in `turn-finalizations.jsonl` at the time. Nothing
here is reconstructed from the thing it is checking, with one labelled
exception documented on the first-impression assertion below.

It was written and made to pass BEFORE the T2 cutover, so it gates the work
rather than describing it. If a row stops reproducing, that is the finding:
fix the derivation, never the replay.
"""
from __future__ import annotations

import collections
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"

# Counts measured on the preserved corpus and recorded in
# docs/status/text-layer-obligation-inventory.md §2.1.
EXPECTED_RECORDS = 506
EXPECTED_ROLL_OBLIGATIONS = 370
EXPECTED_FIRST_IMPRESSION_OBLIGATIONS = 48
EXPECTED_COVERAGE_ROWS = 418
EXPECTED_SEGMENT_TYPES = {
    "fiction": 1746,
    "public_check": 346,
    "asset_delta": 60,
    "state_delta": 47,
    "exceptional_effect": 20,
}


def _load(name: str, relative: str):
    path = REPO / relative
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    if str(SCRIPTS) not in sys.path:
        sys.path.insert(0, str(SCRIPTS))
    spec.loader.exec_module(module)
    return module


def _evidence_root() -> Path | None:
    """Locate the preserved playtest evidence.

    `.coc/` is gitignored, so it exists in the main checkout and not in a
    worktree. Worktrees share the main checkout's git common dir, which is how
    this finds it without hardcoding a path.
    """
    override = os.environ.get("COC_REPLAY_EVIDENCE_ROOT")
    candidates = []
    if override:
        candidates.append(Path(override))
    candidates.append(REPO / ".coc")
    try:
        common = subprocess.run(
            ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
            cwd=REPO, capture_output=True, text=True, check=True,
        ).stdout.strip()
        if common:
            candidates.append(Path(common).parent / ".coc")
    except (subprocess.CalledProcessError, OSError):
        pass
    for candidate in candidates:
        if candidate.is_dir():
            return candidate
    return None


def _campaigns(root: Path):
    """Yield (rolls_by_id, finalization_records) per campaign log directory."""
    for dirpath, _dirnames, filenames in os.walk(root):
        if "turn-finalizations.jsonl" not in filenames:
            continue
        rolls: dict[str, dict] = {}
        roll_log = Path(dirpath) / "rolls.jsonl"
        if roll_log.is_file():
            for line in roll_log.read_text("utf-8", errors="ignore").splitlines():
                if not line.strip():
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if row.get("roll_id"):
                    rolls[str(row["roll_id"])] = row
        records = []
        log = Path(dirpath) / "turn-finalizations.jsonl"
        for line in log.read_text("utf-8", errors="ignore").splitlines():
            if not line.strip():
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue
        yield dirpath, rolls, records


@pytest.fixture(scope="module")
def replay():
    root = _evidence_root()
    if root is None:
        pytest.skip(
            "preserved playtest evidence (.coc/) is not reachable from this "
            "checkout; the T2 replay gate needs the real finalization logs"
        )
    finalizer = _load(
        "coc_turn_finalization_replay",
        "plugins/coc-keeper/scripts/coc_turn_finalization.py",
    )
    result = {
        "records": 0,
        "roll_ids": [],
        "first_impression_ids": [],
        "id_mismatches": [],
        "coverage_rows": 0,
        "coverage_revalidated": 0,
        "coverage_failures": [],
        "coverage_roundtrip_mismatches": [],
        "segment_types": collections.Counter(),
    }
    for dirpath, rolls, records in _campaigns(root):
        for record in records:
            result["records"] += 1
            recorded = [str(x) for x in (record.get("obligation_ids") or [])]
            rec_roll = sorted(x for x in recorded if x.startswith("roll:"))
            rec_fi = sorted(x for x in recorded if x.startswith("first-impression:"))
            result["roll_ids"].extend(rec_roll)
            result["first_impression_ids"].extend(rec_fi)

            receipts = [
                rolls[rid] for rid in
                (str(x) for x in record.get("source_roll_ids") or [])
                if rid in rolls
            ]
            # Labelled exception: first-impression context effects are not kept
            # in a separate log, so their source_receipt_id is recovered from
            # the recorded id. That makes this half a grammar round-trip, not an
            # independent derivation, and it is asserted as such below. The roll
            # namespace has no such caveat.
            context_effects = [
                {"source_receipt_id": x.split(":", 1)[1]} for x in rec_fi
            ]
            derived, _concealed = finalizer._build_obligations(
                receipts, context_effects, []
            )
            got_roll = sorted(
                o["obligation_id"] for o in derived
                if o["obligation_id"].startswith("roll:")
            )
            got_fi = sorted(
                o["obligation_id"] for o in derived
                if o["obligation_id"].startswith("first-impression:")
            )
            if got_roll != rec_roll or got_fi != rec_fi:
                result["id_mismatches"].append({
                    "campaign": dirpath,
                    "finalization_id": record.get("finalization_id"),
                    "recorded_roll": rec_roll, "derived_roll": got_roll,
                    "recorded_first_impression": rec_fi,
                    "derived_first_impression": got_fi,
                })

            for segment in record.get("segments") or []:
                result["segment_types"][segment.get("segment_type")] += 1

            coverage = record.get("coverage") or []
            if not coverage:
                continue
            result["coverage_rows"] += len(coverage)
            draft = record.get("rendered_text") or ""
            try:
                bound = finalizer.validate_coverage(derived, coverage, draft)
            except Exception as exc:  # noqa: BLE001 - the failure IS the finding
                result["coverage_failures"].append({
                    "finalization_id": record.get("finalization_id"),
                    "error": f"{type(exc).__name__}: {exc}",
                })
                continue
            result["coverage_revalidated"] += len(bound)
            by_id = {row["obligation_id"]: row for row in bound}
            for row in coverage:
                rebuilt = by_id.get(str(row["obligation_id"]))
                if rebuilt is None:
                    result["coverage_roundtrip_mismatches"].append(
                        f"{record.get('finalization_id')}: {row['obligation_id']} lost"
                    )
                    continue
                for field, value in row.items():
                    if rebuilt.get(field) != value:
                        result["coverage_roundtrip_mismatches"].append(
                            f"{record.get('finalization_id')}: "
                            f"{row['obligation_id']}.{field} changed"
                        )
    return result


def test_the_evidence_corpus_is_the_one_the_inventory_measured(replay):
    """A partial evidence tree must fail, not silently pass on three records."""
    assert replay["records"] == EXPECTED_RECORDS


def test_every_roll_obligation_re_derives_from_its_real_receipt(replay):
    """The non-circular half: real rolls.jsonl receipts in, obligation ids out."""
    assert replay["id_mismatches"] == [], replay["id_mismatches"][:5]
    assert len(replay["roll_ids"]) == EXPECTED_ROLL_OBLIGATIONS


def test_the_first_impression_grammar_round_trips(replay):
    """Weaker by construction, and labelled: the receipt id is recovered from
    the recorded obligation id, so this pins the `first-impression:<id>` grammar
    rather than deriving the id independently."""
    assert len(replay["first_impression_ids"]) == EXPECTED_FIRST_IMPRESSION_OBLIGATIONS
    assert replay["id_mismatches"] == []


def test_the_namespace_split_is_exactly_what_play_produced(replay):
    namespaces = collections.Counter(
        oid.split(":")[0]
        for oid in replay["roll_ids"] + replay["first_impression_ids"]
    )
    assert dict(namespaces) == {
        "roll": EXPECTED_ROLL_OBLIGATIONS,
        "first-impression": EXPECTED_FIRST_IMPRESSION_OBLIGATIONS,
    }
    # sanity_bout has never fired in the preserved corpus; recorded, not asserted
    # away — it stays in the vocabulary and T5 asks whether it is reachable.
    assert "sanity_bout" not in namespaces


def test_every_preserved_coverage_row_still_validates(replay):
    """418 rows, each re-bound verbatim against the draft it was written for."""
    assert replay["coverage_failures"] == [], replay["coverage_failures"][:5]
    assert replay["coverage_rows"] == EXPECTED_COVERAGE_ROWS
    assert replay["coverage_revalidated"] == EXPECTED_COVERAGE_ROWS


def test_coverage_rows_survive_validation_byte_for_byte(replay):
    assert replay["coverage_roundtrip_mismatches"] == [], (
        replay["coverage_roundtrip_mismatches"][:5]
    )


def test_the_four_mechanic_segment_types_and_fiction_reproduce(replay):
    assert dict(replay["segment_types"]) == EXPECTED_SEGMENT_TYPES
    # fiction is not in MECHANIC_SEGMENT_TYPES yet dominates real output.
    assert replay["segment_types"]["fiction"] > sum(
        count for kind, count in replay["segment_types"].items()
        if kind != "fiction"
    )


# ===========================================================================
# T5 gate 1 — the structural half is language-blind
# ===========================================================================

def test_the_obligation_derivation_takes_no_language_argument():
    """Structural, not incidental: language cannot reach the derivation."""
    import inspect

    finalizer = _load(
        "coc_turn_finalization_language",
        "plugins/coc-keeper/scripts/coc_turn_finalization.py",
    )
    runtime = _load(
        "coc_text_runtime_language",
        "plugins/coc-keeper/scripts/coc_text_runtime.py",
    )
    for name in (
        "_build_obligations", "_build_sanity_bout_obligations",
        "validate_coverage", "_resolve_coverage_obligation_id",
    ):
        params = inspect.signature(getattr(finalizer, name)).parameters
        assert not any("lang" in p for p in params), f"{name} takes a language"
    # The obligation vocabulary is language-free; only craft() is scoped.
    assert not inspect.signature(runtime.vocabulary).parameters
    assert "language" in inspect.signature(runtime.craft).parameters


def test_no_language_helper_is_reachable_from_the_derivation():
    """An AST check, because a signature can stay clean while a body cheats."""
    import ast

    source = (
        REPO / "plugins/coc-keeper/scripts/coc_turn_finalization.py"
    ).read_text("utf-8")
    tree = ast.parse(source)
    banned = {"_campaign_play_language", "_campaign_player_terms",
              "_infer_play_language_from_rendered"}
    offenders = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.FunctionDef):
            continue
        if node.name not in (
            "_build_obligations", "_build_sanity_bout_obligations",
            "validate_coverage", "_resolve_coverage_obligation_id",
        ):
            continue
        for sub in ast.walk(node):
            if isinstance(sub, ast.Call):
                name = getattr(sub.func, "id", None) or getattr(sub.func, "attr", None)
                if name in banned:
                    offenders.append(f"{node.name} calls {name}")
    assert not offenders, offenders


def test_the_preserved_corpus_gives_no_cross_language_evidence(replay):
    """Stated so the replay is not mistaken for a language proof.

    Every one of the 248 preserved campaigns is zh-Hans. The replay therefore
    shows the derivation is stable, not that it is language-blind: the two
    tests above carry that claim structurally (no language parameter, no
    language helper reachable), and only a live non-zh session can show it
    end to end. That session is T5 gate 1, and its absence is a real gap
    rather than something the corpus already covers.
    """
    assert replay["records"] == EXPECTED_RECORDS
    assert replay["coverage_revalidated"] == EXPECTED_COVERAGE_ROWS
    languages = set()
    root = _evidence_root()
    for dirpath, _dirnames, filenames in os.walk(root):
        if "campaign.json" not in filenames:
            continue
        try:
            document = json.loads(
                (Path(dirpath) / "campaign.json").read_text("utf-8", errors="ignore")
            )
        except (json.JSONDecodeError, OSError):
            continue
        languages.add(document.get("play_language") or "unset")
    assert languages == {"zh-Hans"}, (
        f"the corpus is no longer zh-Hans only ({sorted(languages)}); the "
        "replay may now carry cross-language evidence it did not before"
    )
