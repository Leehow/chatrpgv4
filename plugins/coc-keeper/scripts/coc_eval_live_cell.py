#!/usr/bin/env python3
"""Materialize and execute one evidence-grade evaluation matrix cell."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
from collections.abc import Mapping
from contextlib import contextmanager
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[2]


def _load_live_match():
    import importlib.util

    path = SCRIPT_DIR / "coc_live_match.py"
    spec = importlib.util.spec_from_file_location("coc_eval_cell_live_match", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


live_match = _load_live_match()

_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_SCENARIO_KEYS = frozenset(
    {
        "schema_version",
        "scene_id",
        "scenario_id",
        "title",
        "dramatic_question",
        "era",
        "play_language",
        "story_graph",
        "clue_graph",
        "npc_agendas",
        "threat_fronts",
        "pacing_map",
        "improvisation_boundaries",
        "module_meta",
    }
)
_INITIAL_KEYS = frozenset(
    {
        "schema_version",
        "campaign_id",
        "investigator_id",
        "character",
        "public_state",
        "pacing_state",
        "flags",
        "investigator_state",
        "active_scene",
    }
)
_RUNNER_OWNED_DIRECTORIES = ("workspace", "playtest")
_RUNNER_OWNED_ARTIFACTS = (
    "run-manifest.json",
    "transcript.jsonl",
    "player-view.jsonl",
    "keeper-view.jsonl",
    "runner-invocations.jsonl",
    "battle-report.md",
    "evidence.json",
)


def _object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def _safe_id(value: Any, label: str) -> str:
    text = str(value or "")
    if not _SAFE_ID.fullmatch(text):
        raise ValueError(f"{label} must be a safe identifier")
    return text


def _write_text_atomic(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary = Path(handle.name)
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return path


def _write_json_atomic(path: Path, payload: Any) -> Path:
    return _write_text_atomic(
        path,
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
    )


def _write_jsonl_atomic(path: Path, rows: list[dict[str, Any]]) -> Path:
    return _write_text_atomic(
        path,
        "".join(
            json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in rows
        ),
    )


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    rows: list[dict[str, Any]] = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"malformed structured artifact {path.name}:{number}") from exc
        if not isinstance(row, dict):
            raise ValueError(f"malformed structured artifact {path.name}:{number}")
        rows.append(row)
    return rows


def _preflight_runner_owned_outputs(destination: Path) -> None:
    """Reject reused-cell links or wrong node types before any runner write."""
    for name in _RUNNER_OWNED_DIRECTORIES:
        root = destination / name
        if root.is_symlink() or (root.exists() and not root.is_dir()):
            raise ValueError(f"unsafe runner-owned directory: {name}")
        if not root.exists():
            continue
        for current, directory_names, file_names in os.walk(root, followlinks=False):
            current_path = Path(current)
            for child_name in (*directory_names, *file_names):
                child = current_path / child_name
                if child.is_symlink():
                    relative = child.relative_to(destination)
                    raise ValueError(f"unsafe runner-owned path: {relative}")

    for name in _RUNNER_OWNED_ARTIFACTS:
        target = destination / name
        if target.is_symlink() or (target.exists() and not target.is_file()):
            raise ValueError(f"unsafe runner-owned artifact: {name}")


def write_canonical_character(destination: Path, character: dict[str, Any]) -> None:
    _write_json_atomic(destination / "character.json", character)


def write_canonical_campaign(
    destination: Path,
    scenario: dict[str, Any],
    initial: dict[str, Any],
) -> None:
    campaign_id = _safe_id(initial["campaign_id"], "campaign_id")
    investigator_id = _safe_id(initial["investigator_id"], "investigator_id")
    scene_id = _safe_id(
        scenario.get("scene_id")
        or _object(initial.get("public_state") or {}, "public_state").get(
            "active_scene_id"
        ),
        "scene_id",
    )
    scenario_id = _safe_id(scenario.get("scenario_id") or campaign_id, "scenario_id")
    title = str(scenario.get("title") or "Neutral Evaluation Scenario")
    era = str(scenario.get("era") or "modern")
    play_language = str(scenario.get("play_language") or "zh-Hans")
    dramatic_question = str(
        scenario.get("dramatic_question") or "What observable detail changed?"
    )

    campaign = {
        "schema_version": 1,
        "campaign_id": campaign_id,
        "title": title,
        "scenario_id": scenario_id,
        "active_scenario_id": scenario_id,
        "era": era,
        "dice_mode": "codex",
        "spoiler_policy": "warn_before_reveal",
        "play_language": play_language,
    }
    story_graph = scenario.get("story_graph") or {
        "scenes": [
            {
                "scene_id": scene_id,
                "available_clues": [],
                "dramatic_question": dramatic_question,
                "entry_conditions": [],
                "exit_conditions": [],
                "tone": ["observational"],
                "allowed_improvisation": [],
            }
        ]
    }
    clue_graph = scenario.get("clue_graph") or {"conclusions": []}
    module_meta = scenario.get("module_meta") or {
        "schema_version": 1,
        "scenario_id": scenario_id,
        "structure_type": "linear_acts",
        "era": era,
        "content_flags": [],
        "win_condition": "Record an evidence-grounded change in the scene.",
    }
    scenario_artifacts = {
        "story-graph.json": _object(story_graph, "scenario.story_graph"),
        "clue-graph.json": _object(clue_graph, "scenario.clue_graph"),
        "npc-agendas.json": _object(
            scenario.get("npc_agendas") or {"npcs": []}, "scenario.npc_agendas"
        ),
        "threat-fronts.json": _object(
            scenario.get("threat_fronts") or {"fronts": []},
            "scenario.threat_fronts",
        ),
        "pacing-map.json": _object(
            scenario.get("pacing_map")
            or {
                "pacing_curve": [
                    {
                        "scene_id": scene_id,
                        "tension_target": "low",
                        "horror_stage": "ordinary",
                    }
                ]
            },
            "scenario.pacing_map",
        ),
        "improvisation-boundaries.json": _object(
            scenario.get("improvisation_boundaries")
            or {"invent_allowed": [], "never_invent": [], "keeper_secrets": []},
            "scenario.improvisation_boundaries",
        ),
        "module-meta.json": _object(module_meta, "scenario.module_meta"),
    }

    public_state = dict(_object(initial.get("public_state") or {}, "public_state"))
    public_state.setdefault("schema_version", 1)
    public_state.setdefault("campaign_id", campaign_id)
    public_state.setdefault("active_scene_id", scene_id)
    public_state.setdefault("discovered_clue_ids", [])
    public_state.setdefault("major_decisions", [])
    pacing_state = dict(
        _object(initial.get("pacing_state") or {}, "initial.pacing_state")
    )
    pacing_state.setdefault("schema_version", 1)
    pacing_state.setdefault("tension_level", "low")
    pacing_state.setdefault("lethal_chances_used", 0)
    pacing_state.setdefault("recent_intent_classes", [])
    pacing_state.setdefault("turn_number", 0)
    pacing_state.setdefault("luck_spent_last", 0)
    flags = dict(_object(initial.get("flags") or {}, "initial.flags"))
    flags.setdefault("schema_version", 1)
    flags.setdefault("clues_found", {})
    flags.setdefault("decisions", [])
    investigator_state = dict(
        _object(initial.get("investigator_state") or {}, "initial.investigator_state")
    )
    investigator_state.setdefault("schema_version", 1)
    investigator_state.setdefault("campaign_id", campaign_id)
    investigator_state.setdefault("investigator_id", investigator_id)
    investigator_state.setdefault("current_hp", 10)
    investigator_state.setdefault("current_san", 50)
    investigator_state.setdefault("current_mp", 10)
    investigator_state.setdefault("conditions", [])
    investigator_state.setdefault("skill_checks_earned", [])

    _write_json_atomic(destination / "campaign.json", campaign)
    for filename, payload in scenario_artifacts.items():
        _write_json_atomic(destination / "scenario" / filename, payload)
    _write_json_atomic(destination / "save" / "world-state.json", public_state)
    _write_json_atomic(destination / "save" / "pacing-state.json", pacing_state)
    _write_json_atomic(destination / "save" / "flags.json", flags)
    _write_json_atomic(
        destination / "save" / "investigator-state" / f"{investigator_id}.json",
        investigator_state,
    )
    active_scene = initial.get("active_scene")
    if active_scene is not None:
        _write_json_atomic(
            destination / "save" / "active-scene.json",
            _object(active_scene, "initial.active_scene"),
        )
    (destination / "logs").mkdir(parents=True, exist_ok=True)


def materialize_workspace(
    scenario: dict[str, Any], initial: dict[str, Any], destination: Path
) -> tuple[Path, str, str]:
    scenario = dict(_object(scenario, "scenario"))
    initial = dict(_object(initial, "initial_state"))
    unknown_scenario = sorted(set(scenario) - _SCENARIO_KEYS)
    unknown_initial = sorted(set(initial) - _INITIAL_KEYS)
    if unknown_scenario:
        raise ValueError(f"unsupported scenario fields: {', '.join(unknown_scenario)}")
    if unknown_initial:
        raise ValueError(f"unsupported initial_state fields: {', '.join(unknown_initial)}")
    campaign_id = _safe_id(initial.get("campaign_id"), "campaign_id")
    investigator_id = _safe_id(initial.get("investigator_id"), "investigator_id")
    character = dict(_object(initial.get("character"), "initial_state.character"))
    character_id = _safe_id(
        character.get("id") or character.get("investigator_id"), "character.id"
    )
    if character_id != investigator_id:
        raise ValueError("character.id must match investigator_id")
    character.setdefault("schema_version", 1)
    character["id"] = investigator_id

    workspace = Path(destination)
    campaign = workspace / ".coc" / "campaigns" / campaign_id
    investigator = workspace / ".coc" / "investigators" / investigator_id
    _write_json_atomic(
        workspace / ".coc" / "runtime.json", {"schema_version": 1, "brain": "debug"}
    )
    write_canonical_campaign(campaign, scenario, initial)
    write_canonical_character(investigator, character)
    return workspace, campaign_id, investigator_id


@contextmanager
def _scoped_environment(values: Mapping[str, str]):
    updates = {str(key): str(value) for key, value in values.items()}
    previous = {key: os.environ.get(key) for key in updates}
    os.environ.update(updates)
    try:
        yield
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def _identity(value: Any, label: str) -> dict[str, str]:
    identity = _object(value, label)
    provider = str(identity.get("provider") or "")
    model_id = str(identity.get("id") or "")
    if not provider or not model_id:
        raise ValueError(f"{label} requires provider and id")
    return {"provider": provider, "id": model_id}


def _validated_prompt_sources(
    cell: dict[str, Any],
) -> tuple[dict[str, Path], dict[str, str]]:
    sources = _object(cell.get("prompt_sources"), "prompt_sources")
    expected_hashes = _object(cell.get("prompt_hashes"), "prompt_hashes")
    if set(sources) != {"player", "kp"} or set(expected_hashes) != {"player", "kp"}:
        raise ValueError("prompt_sources and prompt_hashes require exactly player and kp")
    root = REPO_ROOT.resolve()
    resolved_sources: dict[str, Path] = {}
    observed_hashes: dict[str, str] = {}
    for role in ("player", "kp"):
        raw = sources[role]
        if not isinstance(raw, str) or not raw.strip():
            raise ValueError(f"missing prompt source: {role}")
        candidate = Path(raw)
        if not candidate.is_absolute():
            candidate = root / candidate
        resolved = candidate.resolve()
        try:
            resolved.relative_to(root)
        except ValueError as exc:
            raise ValueError(f"prompt source escaped repository: {role}") from exc
        if not resolved.is_file():
            raise ValueError(f"missing prompt source: {role}")
        observed = _sha256_file(resolved)
        if expected_hashes.get(role) != observed:
            raise ValueError(f"prompt hash mismatch: {role}")
        resolved_sources[role] = resolved
        observed_hashes[role] = observed
    return resolved_sources, observed_hashes


def _normalized_transcript(
    result: dict[str, Any], source: Path
) -> list[dict[str, Any]]:
    rows = _read_jsonl(source)
    if rows:
        return rows
    normalized: list[dict[str, Any]] = []
    players = result.get("player_turns") or []
    turns = result.get("turns") or []
    count = max(len(players), len(turns))
    for index in range(count):
        number = index + 1
        if index < len(players) and isinstance(players[index], dict):
            normalized.append(
                {
                    "turn": number,
                    "role": "player_simulator",
                    "text": str(players[index].get("player_text") or ""),
                }
            )
        if index < len(turns) and isinstance(turns[index], dict):
            turn = turns[index]
            normalized.append(
                {
                    "turn": int(turn.get("turn_number") or number),
                    "role": "keeper_under_test",
                    "text": str(
                        turn.get("narration")
                        or turn.get("narrated_text")
                        or turn.get("dramatic_question")
                        or ""
                    ),
                }
            )
    return normalized


def _view_rows(result: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    players = result.get("player_turns") or []
    turns = result.get("turns") or []
    player_rows: list[dict[str, Any]] = []
    keeper_rows: list[dict[str, Any]] = []
    for index in range(max(len(players), len(turns))):
        player = players[index] if index < len(players) and isinstance(players[index], dict) else {}
        turn = turns[index] if index < len(turns) and isinstance(turns[index], dict) else {}
        number = int(turn.get("turn_number") or index + 1)
        player_rows.append(
            {
                "schema_version": 1,
                "view": "player",
                "turn_number": number,
                "player_text": str(player.get("player_text") or ""),
                "narration": str(
                    turn.get("narration")
                    or turn.get("narrated_text")
                    or turn.get("dramatic_question")
                    or ""
                ),
            }
        )
        keeper_rows.append(
            {
                "schema_version": 1,
                "view": "keeper",
                "turn_number": number,
                "player_turn": player,
                "keeper_turn": turn,
            }
        )
    return player_rows, keeper_rows


def _attestation_findings(
    evidence: dict[str, Any],
    player_model: dict[str, str],
    kp_model: dict[str, str],
    invocation_rows: list[dict[str, Any]],
    invocation_path: Path,
    player_runner: Path,
    narrator_runner: Path,
) -> list[str]:
    findings: list[str] = []
    if evidence.get("eligible_as_gameplay_evidence") is not True:
        findings.append("canonical_evidence_eligibility_missing")

    ledger_artifact = (evidence.get("artifacts") or {}).get("invocation_ledger")
    if not invocation_path.is_file():
        findings.append("invocation_ledger_missing")
    elif not isinstance(ledger_artifact, dict):
        findings.append("invocation_ledger_attestation_missing")
    elif (
        ledger_artifact.get("path") != "runner-invocations.jsonl"
        or ledger_artifact.get("sha256") != _sha256_file(invocation_path)
    ):
        findings.append("invocation_ledger_attestation_mismatch")

    runners = evidence.get("runners")
    if not isinstance(runners, dict):
        runners = {}
    for role, declared, runner_path in (
        ("player", player_model, player_runner),
        ("narrator", kp_model, narrator_runner),
    ):
        expected_hash = _sha256_file(runner_path)
        descriptor = runners.get(role)
        if not isinstance(descriptor, dict):
            findings.append(f"missing_runner_attestation:{role}")
            continue
        if (
            descriptor.get("kind") != "external_model_bridge"
            or not isinstance(descriptor.get("identity"), str)
            or not descriptor["identity"].strip()
            or descriptor.get("sha256") != expected_hash
        ):
            findings.append(f"runner_attestation_mismatch:{role}")
        if descriptor.get("model_identities") != [declared]:
            findings.append(f"model_identity_mismatch:{role}")

        role_rows = [row for row in invocation_rows if row.get("role") == role]
        if not role_rows:
            findings.append(f"invocation_ledger_role_missing:{role}")
            continue
        for row in role_rows:
            if (
                row.get("runner_kind") != "external_model_bridge"
                or row.get("runner_identity") != descriptor.get("identity")
                or row.get("runner_sha256") != expected_hash
                or Path(str(row.get("runner_path") or "")).resolve()
                != runner_path.resolve()
            ):
                findings.append(f"invocation_runner_mismatch:{role}")
            if row.get("outcome") != "external_success":
                findings.append(f"invocation_outcome_mismatch:{role}")
            if row.get("model_identity") != declared:
                findings.append(f"invocation_model_identity_mismatch:{role}")
            if role != "narrator":
                continue
            receipt = row.get("secret_audit")
            validation = live_match.secret_audit.validate_audit_receipt(receipt)
            if not validation.get("valid") or not validation.get("passed"):
                findings.append("narrator_secret_audit_missing")
    return sorted(set(findings))


def run_live_cell(
    cell_input: dict[str, Any],
    cell_dir: Path,
    *,
    env: Mapping[str, str],
) -> dict[str, Any]:
    cell = dict(_object(cell_input, "cell_input"))
    cell_id = _safe_id(cell.get("cell_id"), "cell_id")
    player_model = _identity(cell.get("player_model"), "player_model")
    kp_model = _identity(cell.get("kp_model"), "kp_model")
    prompt_sources, prompt_hashes = _validated_prompt_sources(cell)
    player_request = _object(cell.get("player_request"), "player_request")
    persona_id = _safe_id(player_request.get("persona_id"), "persona_id")
    persona_prompt_directives = player_request.get("persona_prompt_directives")
    if (
        not isinstance(persona_prompt_directives, list)
        or not persona_prompt_directives
        or any(
            not isinstance(item, str) or not item.strip()
            for item in persona_prompt_directives
        )
    ):
        raise ValueError("persona_prompt_directives must be a non-empty string list")
    persona_prompt_directives = list(persona_prompt_directives)
    seed = cell.get("seed")
    max_turns = cell.get("max_turns")
    if isinstance(seed, bool) or not isinstance(seed, int):
        raise ValueError("seed must be an integer")
    if isinstance(max_turns, bool) or not isinstance(max_turns, int) or max_turns < 1:
        raise ValueError("max_turns must be a positive integer")

    destination = Path(cell_dir).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    _preflight_runner_owned_outputs(destination)
    workspace, campaign_id, investigator_id = materialize_workspace(
        _object(cell.get("scenario"), "scenario"),
        _object(cell.get("initial_state"), "initial_state"),
        destination / "workspace",
    )
    playtest_dir = destination / "playtest"
    player_runner = prompt_sources["player"]
    narrator_runner = prompt_sources["kp"]
    role_env = dict(env)
    role_env.update(
        {
            "COC_PLAYER_MODEL_PROVIDER": player_model["provider"],
            "COC_PLAYER_MODEL_ID": player_model["id"],
            "COC_NARRATOR_MODEL_PROVIDER": kp_model["provider"],
            "COC_NARRATOR_MODEL_ID": kp_model["id"],
        }
    )
    with _scoped_environment(role_env):
        result = live_match.run_live_match(
            workspace,
            campaign_id,
            investigator_id,
            player_runner=player_runner,
            narrator_runner=narrator_runner,
            max_turns=max_turns,
            rng_seed=seed,
            live=True,
            run_dir=playtest_dir,
            evidence_provenance={"eval_spec": "eval-spec-v1", "cell_id": cell_id},
            persona_id=persona_id,
            persona_prompt_directives=persona_prompt_directives,
        )
    result = _object(result, "live_match result")

    transcript_rows = _normalized_transcript(result, playtest_dir / "transcript.jsonl")
    invocation_rows = _read_jsonl(playtest_dir / "runner-invocations.jsonl")
    player_view, keeper_view = _view_rows(result)
    _write_jsonl_atomic(destination / "transcript.jsonl", transcript_rows)
    _write_jsonl_atomic(destination / "runner-invocations.jsonl", invocation_rows)
    _write_jsonl_atomic(destination / "player-view.jsonl", player_view)
    _write_jsonl_atomic(destination / "keeper-view.jsonl", keeper_view)

    raw_battle_path = result.get("battle_report_path")
    if raw_battle_path:
        battle_source = Path(str(raw_battle_path))
        if not battle_source.is_absolute():
            battle_source = playtest_dir / battle_source
        battle_source = battle_source.resolve()
        try:
            battle_source.relative_to(playtest_dir.resolve())
        except ValueError as exc:
            raise ValueError("canonical battle report escaped the playtest directory") from exc
    else:
        root_report = playtest_dir / "battle-report.md"
        nested_report = playtest_dir / "artifacts" / "battle-report.md"
        battle_source = root_report if root_report.is_file() else nested_report
    if not battle_source.is_file():
        raise ValueError("canonical live match did not produce battle-report.md")
    _write_text_atomic(
        destination / "battle-report.md", battle_source.read_text(encoding="utf-8")
    )
    evidence = _object(result.get("evidence") or {}, "live_match evidence")
    _write_json_atomic(destination / "evidence.json", evidence)
    evidence_eligible = evidence.get("eligible_as_gameplay_evidence") is True
    findings = _attestation_findings(
        evidence,
        player_model,
        kp_model,
        invocation_rows,
        playtest_dir / "runner-invocations.jsonl",
        player_runner,
        narrator_runner,
    )
    if findings:
        evidence_eligible = False
    status = "PASS" if evidence_eligible else "INELIGIBLE"
    artifact_names = [
        "battle-report.md",
        "evidence.json",
        "transcript.jsonl",
        "player-view.jsonl",
        "keeper-view.jsonl",
        "runner-invocations.jsonl",
    ]
    manifest = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "cell_id": cell_id,
        "status": status,
        "evidence_eligible": evidence_eligible,
        "evidence_findings": findings,
        "evidence_reasons": list(evidence.get("evidence_reasons") or []),
        "player_model": player_model,
        "kp_model": kp_model,
        "persona_id": persona_id,
        "prompt_hashes": prompt_hashes,
        "seed": seed,
        "max_turns": max_turns,
        "canonical_run_dir": "playtest",
        "artifacts": artifact_names,
        "artifact_hashes": {
            name: _sha256_file(destination / name) for name in artifact_names
        },
    }
    _write_json_atomic(destination / "run-manifest.json", manifest)
    return manifest


def _main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cell_input")
    parser.add_argument("cell_dir")
    args = parser.parse_args(argv)
    destination = Path(args.cell_dir).resolve()
    try:
        payload = json.loads(Path(args.cell_input).read_text(encoding="utf-8"))
        result = run_live_cell(payload, destination, env=os.environ)
    except Exception as exc:  # noqa: BLE001 - subprocess boundary is fail-closed
        result = {"status": "FAIL", "error": str(exc)}
        try:
            _write_json_atomic(destination / "run-manifest.json", result)
        except Exception:
            pass
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0 if result.get("status") in {"PASS", "INELIGIBLE"} else 1


if __name__ == "__main__":
    sys.exit(_main())
