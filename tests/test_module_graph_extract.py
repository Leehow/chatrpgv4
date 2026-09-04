"""The extractor loop: prepare, review, and the three gates that do not downgrade.

The pipeline had every deterministic half of extraction and no extractor; the
reading step was done by hand and its result committed as a fixture. These
tests pin the loop that replaces that, and in particular the property that
makes it safe to run unattended: a reply is accepted only when both gates are
silent, and neither gate can be satisfied by structure alone.
"""
from __future__ import annotations

import copy
import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
FIXTURES = ROOT / "tests" / "fixtures" / "module-graph"
BUNDLE = ROOT / ".coc" / "module-library" / "cursed-be-the-city"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


extract = _load("coc_module_graph_extract_tests", SCRIPTS / "coc_module_graph_extract.py")

SHARD = json.loads((FIXTURES / "cursed-be-the-city.shard.json").read_text("utf-8"))
EVIDENCE = json.loads((FIXTURES / "cursed-be-the-city.evidence.json").read_text("utf-8"))


@pytest.fixture
def work_dir(tmp_path: Path) -> Path:
    (tmp_path / "evidence-packet.json").write_text(
        json.dumps(EVIDENCE, ensure_ascii=False), encoding="utf-8"
    )
    return tmp_path


def test_a_faithful_shard_is_accepted(work_dir: Path):
    result = extract.review(work_dir, copy.deepcopy(SHARD))
    assert result["status"] == "accepted", result
    assert result["nodes"] == len(SHARD["nodes"])
    assert (work_dir / "accepted.shard.json").exists()


def test_prose_is_refused_before_either_gate(work_dir: Path):
    result = extract.review(work_dir, "好的，我读完了这本模组。")
    assert result["status"] == "findings"
    assert result["gate"] == "shape"


def test_a_fabricated_actor_is_refused_by_the_grounding_gate(work_dir: Path):
    """Structure alone must not be enough to be accepted.

    This shard is contract-clean: real ids, real citations, legal predicates.
    Only the second gate can tell that the book has never heard of this NPC.
    """
    shard = copy.deepcopy(SHARD)
    real = next(n for n in shard["nodes"] if n["node_id"] == "creature-formless-spawn")
    shard["nodes"].append({
        **copy.deepcopy(real),
        "node_id": "npc-drusilla-vane", "node_kind": "npc",
        "name": "德鲁西拉·凡恩", "aliases": [],
        "summary": "神殿的女祭司。", "properties": {},
    })
    result = extract.review(work_dir, shard)
    assert result["status"] == "findings"
    assert result["gate"] == "grounding", (
        "a fabricated actor passed the structure gate and nothing else stopped it"
    )
    assert any(f.get("node_id") == "npc-drusilla-vane" for f in result["findings"])


def test_a_contract_violation_is_refused_by_the_structure_gate(work_dir: Path):
    shard = copy.deepcopy(SHARD)
    shard["claims"][0]["predicate"] = "causes-vibes"
    result = extract.review(work_dir, shard)
    assert result["status"] == "findings"
    assert result["gate"] == "structure"


def test_prepare_dispatch_names_no_binary_and_no_provider():
    """The reason this survives being packaged and shipped.

    A dispatch that shelled out to a globally installed CLI would work here and
    fail on a desktop build where no such binary is on PATH. The host runs the
    instruction on the model it is already running.
    """
    if not BUNDLE.exists():
        pytest.skip("module library bundle not present in this checkout")
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        result = extract.prepare(
            BUNDLE, Path(tmp), module_id="cursed-be-the-city"
        )
    dispatch = result["dispatch"]
    assert dispatch["model_policy"] == "inherit_parent"

    # Structural, not a keyword scan: any key that tells the host to run
    # something is the portability trap, whatever the something is called.
    def executable_keys(value, path="") -> list[str]:
        found = []
        if isinstance(value, dict):
            for key, item in value.items():
                if key in {"argv", "command", "cmd", "executable", "binary",
                           "spawn", "shell", "provider", "api_key", "model"}:
                    found.append(f"{path}/{key}")
                found.extend(executable_keys(item, f"{path}/{key}"))
        elif isinstance(value, list):
            for index, item in enumerate(value):
                found.extend(executable_keys(item, f"{path}[{index}]"))
        return found

    offenders = executable_keys(dispatch)
    assert not offenders, (
        f"the dispatch tells the host what to run ({offenders}); a packaged "
        "build has no such binary and the extraction chain would die on the "
        "customer's machine. The host uses the model it is already running."
    )


def test_the_instruction_forbids_filling_gaps_from_general_knowledge():
    text = extract.INSTRUCTION_PATH.read_text("utf-8")
    assert "不知道就不要写" in text
    assert "unresolved" in text


def test_prepare_limits_the_packet_to_the_given_page_range(tmp_path: Path):
    """Narrowing a section must narrow the evidence the model is shown.

    The build driver bisects a section whose shard cannot fit one generation;
    the bisection is real only if the sub-section's packet carries exactly its
    own pages.
    """
    extract.prepare(
        BUNDLE, tmp_path, module_id="cursed-be-the-city", section_id="p2-5",
        pdf_index_start=2, pdf_index_end=5,
    )
    request = json.loads((tmp_path / "request.json").read_text("utf-8"))
    assert [r["pdf_index"] for r in request["page_refs"]] == [2, 3, 4, 5]
    evidence = json.loads((tmp_path / "evidence-packet.json").read_text("utf-8"))
    assert {s["source_ref"]["pdf_index"] for s in evidence["spans"]} == {2, 3, 4, 5}


def test_the_instruction_carries_the_contract_vocabulary_verbatim():
    """The prompt and the contract that judges its replies cannot drift apart.

    The first unattended run spent its opening round discovering, one finding
    at a time, vocabulary the instruction never stated -- 1391 findings of
    schema the model had to guess. The contract is small enough to carry in
    the prompt, so the prompt carries it, and this test is what keeps a
    contract bump from silently stranding the prompt.
    """
    contract = json.loads(
        (ROOT / "plugins" / "coc-keeper" / "references"
         / "module-graph-contract-v3.json").read_text("utf-8")
    )
    text = extract.INSTRUCTION_PATH.read_text("utf-8")
    assert str(contract["shard_contract_id"]) in text
    missing = [
        token
        for key in (
            "shard_keys", "node_keys", "claim_keys", "relation_keys",
            "visibility", "truth_status", "coverage_domains",
            "coverage_status", "node_kinds", "relation_kinds",
        )
        for token in contract[key]
        if token not in text
    ]
    assert not missing, (
        f"the instruction fell behind the contract ({missing}); a model that "
        "never sees the vocabulary spends its first rounds guessing it"
    )
