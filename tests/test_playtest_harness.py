import importlib.util
import re
from pathlib import Path


def load_module(name: str, relative_path: str):
    path = Path(relative_path)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_playtest_harness = load_module("coc_playtest_harness", "plugins/coc-keeper/scripts/coc_playtest_harness.py")
coc_playtest_audit = load_module("coc_playtest_audit", "plugins/coc-keeper/scripts/coc_playtest_audit.py")
coc_completion_audit = load_module("coc_completion_audit", "plugins/coc-keeper/scripts/coc_completion_audit.py")
coc_rules = load_module("coc_rules", "plugins/coc-keeper/scripts/coc_rules.py")


def has_cjk(text: str) -> bool:
    return any("\u4e00" <= char <= "\u9fff" for char in text)


def assert_no_cjk_ascii_sentence_periods(text: str) -> None:
    offending_lines = [
        line.strip()
        for line in text.splitlines()
        if has_cjk(line) and line.strip().endswith(".")
    ]
    assert offending_lines == []


def visible_play_texts(run_dir: Path) -> list[str]:
    import json

    return [
        event.get("text", "")
        for line in (run_dir / "transcript.jsonl").read_text().splitlines()
        for event in [json.loads(line)]
        if event.get("role") in {"keeper_under_test", "player_simulator"}
    ]


def transcript_events(run_dir: Path) -> list[dict]:
    import json

    return [
        json.loads(line)
        for line in (run_dir / "transcript.jsonl").read_text().splitlines()
        if line.strip()
    ]


def transcript_turn_sequence_gaps(run_dir: Path) -> list[str]:
    seen: set[int] = set()
    bases: list[int] = []
    for event in transcript_events(run_dir):
        value = event.get("turn")
        if isinstance(value, int):
            base = value
        elif isinstance(value, str) and (match := re.match(r"^(\d+)[a-z]*$", value)):
            base = int(match.group(1))
        else:
            continue
        if base not in seen:
            seen.add(base)
            bases.append(base)
    gaps: list[str] = []
    for previous, current in zip(bases, bases[1:]):
        if current < previous:
            gaps.append(f"out_of_order:{previous}->{current}")
        elif current - previous > 1:
            gaps.append(f"missing:{previous + 1}-{current - 1}")
    return gaps


def run_jsonl(run_dir: Path, filename: str) -> list[dict]:
    import json

    return [
        json.loads(line)
        for line in (run_dir / filename).read_text().splitlines()
        if line.strip()
    ]


def player_view_text(run_dir: Path) -> str:
    return "\n".join(
        str(event.get("text", ""))
        for event in run_jsonl(run_dir, "player-view.jsonl")
        if isinstance(event.get("text"), str)
    )


def playtest_metadata(run_dir: Path) -> dict:
    import json

    return json.loads((run_dir / "playtest.json").read_text())


def campaign_state_events(run_dir: Path) -> list[dict]:
    import json

    campaign_logs = run_dir / "sandbox" / ".coc" / "campaigns"
    events: list[dict] = []
    for path in sorted(campaign_logs.glob("*/logs/events.jsonl")):
        events.extend(json.loads(line) for line in path.read_text().splitlines() if line.strip())
    return events


def campaign_roll_events(run_dir: Path) -> list[dict]:
    import json

    campaign_logs = run_dir / "sandbox" / ".coc" / "campaigns"
    events: list[dict] = []
    for path in sorted(campaign_logs.glob("*/logs/rolls.jsonl")):
        events.extend(json.loads(line) for line in path.read_text().splitlines() if line.strip())
    return events


def campaign_dir_for_run(run_dir: Path) -> Path:
    metadata = playtest_metadata(run_dir)
    return run_dir / "sandbox" / ".coc" / "campaigns" / metadata["campaign_id"]


def read_json(path: Path) -> dict:
    import json

    return json.loads(path.read_text())


def payload_rule_refs(event: dict) -> list[str]:
    payload = event.get("payload", {})
    if not isinstance(payload, dict):
        return []
    refs = payload.get("rule_refs", [])
    return refs if isinstance(refs, list) else []


def campaign_audit_events(run_dir: Path) -> list[dict]:
    import json

    campaign_logs = run_dir / "sandbox" / ".coc" / "campaigns"
    events: list[dict] = []
    for path in sorted(campaign_logs.glob("*/logs/audit.jsonl")):
        events.extend(json.loads(line) for line in path.read_text().splitlines() if line.strip())
    return events


def campaign_events_by_type(run_dir: Path, event_type: str) -> list[dict]:
    return [
        event
        for event in campaign_state_events(run_dir)
        if event.get("type") == event_type
    ]


def investigator_jsonl(run_dir: Path, investigator_id: str, filename: str) -> list[dict]:
    import json

    path = run_dir / "sandbox" / ".coc" / "investigators" / investigator_id / filename
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def investigator_json(run_dir: Path, investigator_id: str, filename: str) -> dict:
    import json

    path = run_dir / "sandbox" / ".coc" / "investigators" / investigator_id / filename
    return json.loads(path.read_text())


def assert_creation_allocation_matches_character(run_dir: Path, investigator_id: str) -> None:
    character = investigator_json(run_dir, investigator_id, "character.json")
    creation = investigator_json(run_dir, investigator_id, "creation.json")
    allocation = creation["skill_allocation"]["skills"]
    allocation_finals = {skill: entry["final"] for skill, entry in allocation.items()}
    assert allocation_finals == character["skills"]


def assert_chase_round_turns_follow_dex_order(chase_state: dict) -> None:
    dex_order = chase_state["dex_order"]
    for chase_round in chase_state["rounds"]:
        turn_actor_ids = [turn["actor_id"] for turn in chase_round["turns"]]
        expected_order = [actor_id for actor_id in dex_order if actor_id in turn_actor_ids]
        assert turn_actor_ids == expected_order


def assert_view_streams_separated(run_dir: Path, secret_ids: list[str]) -> None:
    player_view = run_jsonl(run_dir, "player-view.jsonl")
    keeper_view = run_jsonl(run_dir, "keeper-view.jsonl")
    assert player_view
    assert keeper_view
    assert {event["view"] for event in player_view} == {"player"}
    assert {event["view"] for event in keeper_view} == {"keeper"}
    assert any(event.get("type") == "public_character_state" for event in player_view)
    assert any(event.get("type") == "keeper_context" for event in keeper_view)
    player_text = "\n".join(str(event) for event in player_view)
    keeper_text = "\n".join(str(event) for event in keeper_view)
    for secret_id in secret_ids:
        assert secret_id not in player_text
        assert secret_id in keeper_text


def assert_player_view_roll_outcomes_localized(run_dir: Path) -> None:
    metadata = playtest_metadata(run_dir)
    labels = metadata["language_profile"]["outcome_labels"]
    visible_text = player_view_text(run_dir)
    for canonical in labels:
        assert canonical not in visible_text
    assert any(display in visible_text for display in labels.values())
    allowed_rule_abbreviations = {"CON", "DEX", "POW", "INT", "HP", "SAN", "MOV"}
    english_tokens = {
        token
        for event in run_jsonl(run_dir, "player-view.jsonl")
        if event.get("role") == "system" and event.get("mode") == "roll"
        for token in re.findall(r"[A-Za-z]{3,}", str(event.get("text", "")))
        if token not in allowed_rule_abbreviations
    }
    assert english_tokens == set()


def nested_string_values(value) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        strings: list[str] = []
        for item in value:
            strings.extend(nested_string_values(item))
        return strings
    if isinstance(value, dict):
        strings: list[str] = []
        for item in value.values():
            strings.extend(nested_string_values(item))
        return strings
    return []


def public_state_visible_strings(public_state: dict) -> list[str]:
    strings: list[str] = []
    strings.extend(nested_string_values(public_state.get("scenario", {})))
    for investigator in public_state.get("investigators", []):
        strings.extend(str(investigator.get(field, "")) for field in ("name", "occupation", "era"))
        skills = investigator.get("skills", {})
        if isinstance(skills, dict):
            strings.extend(str(skill) for skill in skills)
        derived = investigator.get("derived", {})
        if isinstance(derived, dict):
            strings.extend(str(key) for key in derived)
        strings.extend(nested_string_values(derived))
        strings.extend(nested_string_values(investigator.get("backstory", {})))
    return [text for text in strings if text]


def assert_player_view_public_state_localized(run_dir: Path) -> None:
    metadata = playtest_metadata(run_dir)
    glossary = metadata["localized_terms"][metadata["play_language"]]
    public_state = next(
        event
        for event in run_jsonl(run_dir, "player-view.jsonl")
        if event.get("type") == "public_character_state"
    )
    visible_strings = public_state_visible_strings(public_state)

    for canonical, display in glossary.items():
        if canonical in {"DEX", "POW", "INT", "SAN"}:
            continue
        if any(canonical in text for text in visible_strings):
            assert display == canonical

    scenario = public_state["scenario"]
    assert scenario["title"] == glossary.get(metadata["scenario"], metadata["scenario"])
    for investigator in public_state["investigators"]:
        assert investigator["name"] not in glossary
        assert investigator["occupation"] not in glossary
        for skill in investigator["skills"]:
            assert skill not in glossary
    if metadata["play_language"] == "zh-Hans":
        allowed_tokens = {"STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU", "LUCK", "HP", "MP", "SAN", "MOV", "DB"}
        english_tokens = {
            token
            for text in visible_strings
            for token in re.findall(r"[A-Za-z_]{3,}", text)
            if token not in allowed_tokens
        }
        assert english_tokens == set()


def assert_player_view_transcript_speakers_localized(run_dir: Path) -> None:
    metadata = playtest_metadata(run_dir)
    glossary = metadata["localized_terms"][metadata["play_language"]]
    allowed_tokens = {"KP", "HP", "SAN", "DEX", "CON", "POW", "INT", "MOV"}
    speakers = [
        str(event.get("speaker", ""))
        for event in run_jsonl(run_dir, "player-view.jsonl")
        if event.get("type") == "transcript_turn"
        and isinstance(event.get("speaker"), str)
        and event["speaker"].strip()
    ]

    leaked_terms = {
        canonical
        for canonical, display in glossary.items()
        if canonical
        and display != canonical
        and any(canonical in speaker for speaker in speakers)
    }
    assert leaked_terms == set()

    if metadata["play_language"] == "zh-Hans":
        english_tokens = {
            token
            for speaker in speakers
            for token in re.findall(r"[A-Za-z]{3,}", speaker)
            if token not in allowed_tokens
        }
        assert english_tokens == set()


def assert_player_view_transcript_details_localized(run_dir: Path) -> None:
    metadata = playtest_metadata(run_dir)
    play_language = metadata["play_language"]
    assert play_language == "zh-Hans"
    glossary = metadata["localized_terms"][play_language]

    for event in run_jsonl(run_dir, "player-view.jsonl"):
        if event.get("type") != "transcript_turn":
            continue
        localized_text = event.get("localized_text", {})
        language_text = localized_text.get(play_language, {}) if isinstance(localized_text, dict) else {}
        for key in ("intent", "ruling"):
            canonical = event.get(key)
            if not isinstance(canonical, str) or not canonical:
                continue
            display_key = f"{key}_display"
            expected = coc_playtest_harness._localize_text(language_text.get(key), glossary)
            assert event.get(display_key) == expected
            assert event[display_key] != canonical
            assert has_cjk(event[display_key])


def assert_source_transcript_display_fields_localized(run_dir: Path) -> None:
    by_turn = {event.get("turn"): event for event in transcript_events(run_dir)}

    assert by_turn[1]["speaker"] == "Mr. Knott"
    assert by_turn[1]["speaker_display"] == "KP[诺特先生]"
    assert by_turn[2]["speaker"] == "Ada King"
    assert by_turn[2]["speaker_display"] == "玩家"

    first_roll = by_turn[6]
    assert first_roll["text"] == "Persuade 72 vs 55 -> failure."
    assert first_roll["speaker_display"] == "系统"
    assert first_roll["text_display"] == "说服：艾达·金掷出 72 / 55，结果失败。"
    assert has_cjk(first_roll["text_display"])


def assert_source_transcript_display_text_strips_protocol_wrappers(run_dir: Path) -> None:
    wrapped_rows = [
        event
        for event in transcript_events(run_dir)
        if isinstance(event.get("text"), str)
        and (
            event["text"].startswith("[meta]")
            or event["text"].startswith("[spoiler_warning]")
        )
    ]
    assert wrapped_rows
    for event in wrapped_rows:
        assert "[meta]" in event["text"] or "[spoiler_warning]" in event["text"]
        assert "[meta]" not in event["text_display"]
        assert "[/meta]" not in event["text_display"]
        assert "[spoiler_warning]" not in event["text_display"]
        assert "[/spoiler_warning]" not in event["text_display"]
        assert has_cjk(event["text_display"])


def assert_player_view_text_strips_protocol_wrappers(run_dir: Path) -> None:
    source_wrapped_rows = [
        event
        for event in transcript_events(run_dir)
        if isinstance(event.get("text"), str)
        and (
            event["text"].startswith("[meta]")
            or event["text"].startswith("[spoiler_warning]")
        )
    ]
    player_rows = [
        event
        for event in run_jsonl(run_dir, "player-view.jsonl")
        if event.get("type") == "transcript_turn"
        and isinstance(event.get("text"), str)
    ]
    assert source_wrapped_rows
    assert player_rows
    player_text = "\n".join(event["text"] for event in player_rows)
    assert "[meta]" not in player_text
    assert "[/meta]" not in player_text
    assert "[spoiler_warning]" not in player_text
    assert "[/spoiler_warning]" not in player_text


def assert_player_view_localized_text_values_localized(run_dir: Path) -> None:
    metadata = playtest_metadata(run_dir)
    play_language = metadata["play_language"]
    glossary = metadata["localized_terms"][play_language]
    localized_strings: list[str] = []
    for event in run_jsonl(run_dir, "player-view.jsonl"):
        if event.get("type") != "transcript_turn":
            continue
        localized_text = event.get("localized_text", {})
        language_text = localized_text.get(play_language, {}) if isinstance(localized_text, dict) else {}
        localized_strings.extend(nested_string_values(language_text))

    leaked_terms = {
        canonical
        for canonical, display in glossary.items()
        if canonical
        and display != canonical
        and any(canonical in text for text in localized_strings)
    }
    assert leaked_terms == set()


def assert_player_profile_displays_localized(run_dir: Path) -> None:
    metadata = playtest_metadata(run_dir)
    play_language = metadata["play_language"]
    labels = metadata.get("player_profile_labels", {}).get(play_language, {})
    if not labels:
        return

    display_rows = [
        row
        for row in run_jsonl(run_dir, "player-view.jsonl")
        if row.get("type") == "transcript_turn"
        and isinstance(row.get("player_profile"), str)
        and row["player_profile"] in labels
    ]
    feedback_rows = [
        row
        for row in run_jsonl(run_dir, "player-feedback.jsonl")
        if isinstance(row.get("player_profile"), str)
        and row["player_profile"] in labels
    ]
    assert display_rows or feedback_rows
    for row in [*display_rows, *feedback_rows]:
        expected = labels[row["player_profile"]]
        assert row.get("player_profile_display") == expected
        assert row["player_profile_display"] != row["player_profile"]
        assert has_cjk(row["player_profile_display"])


PUSHED_ROLL_PROTOCOL_STAGES = [
    "player_reframes_action",
    "keeper_foreshadows_failure",
    "player_confirms_risk",
    "roll_resolved",
]


SPOILER_REVEAL_PROTOCOL_STAGES = [
    "warning_issued",
    "player_confirmed",
    "limited_reveal",
]


def assert_pushed_roll_protocol(run_dir: Path, expected_roll_ids: list[str]) -> None:
    transcript_protocols: dict[str, list[dict]] = {}
    for event in transcript_events(run_dir):
        protocol = event.get("pushed_roll_protocol")
        if not isinstance(protocol, dict):
            continue
        roll_id = protocol.get("roll_id")
        if isinstance(roll_id, str):
            transcript_protocols.setdefault(roll_id, []).append(event)

    assert set(transcript_protocols) == set(expected_roll_ids)
    for roll_id in expected_roll_ids:
        events = transcript_protocols[roll_id]
        stages = [event["pushed_roll_protocol"]["stage"] for event in events]
        roles = [event["role"] for event in events]
        assert stages == PUSHED_ROLL_PROTOCOL_STAGES
        assert roles == ["player_simulator", "keeper_under_test", "player_simulator", "system"]
        keeper_protocol = events[1]["pushed_roll_protocol"]
        confirmation_protocol = events[2]["pushed_roll_protocol"]
        assert keeper_protocol["failure_consequence_source"] == "keeper"
        assert confirmation_protocol["risk_confirmed"] is True

    pushed_roll_payloads = [
        event["payload"]
        for event in campaign_roll_events(run_dir)
        if event.get("payload", {}).get("pushed") is True
    ]
    assert {
        payload.get("pushed_roll_protocol", {}).get("roll_id")
        for payload in pushed_roll_payloads
    } == set(expected_roll_ids)
    for payload in pushed_roll_payloads:
        protocol = payload["pushed_roll_protocol"]
        assert protocol["failure_consequence_source"] == "keeper"
        assert protocol["player_confirmation_recorded"] is True
        assert protocol["keeper_foreshadowed_failure"] is True


def assert_spoiler_reveal_protocol(run_dir: Path, expected_spoiler_ids: list[str]) -> None:
    transcript_protocols: dict[str, list[dict]] = {}
    for event in transcript_events(run_dir):
        protocol = event.get("spoiler_protocol")
        if not isinstance(protocol, dict):
            continue
        spoiler_id = protocol.get("spoiler_id")
        if isinstance(spoiler_id, str):
            transcript_protocols.setdefault(spoiler_id, []).append(event)

    assert set(transcript_protocols) == set(expected_spoiler_ids)
    for spoiler_id in expected_spoiler_ids:
        events = transcript_protocols[spoiler_id]
        stages = [event["spoiler_protocol"]["stage"] for event in events]
        roles = [event["role"] for event in events]
        assert stages == SPOILER_REVEAL_PROTOCOL_STAGES
        assert roles == ["keeper_under_test", "player_simulator", "keeper_under_test"]
        warning_protocol = events[0]["spoiler_protocol"]
        confirmation_protocol = events[1]["spoiler_protocol"]
        reveal_protocol = events[2]["spoiler_protocol"]
        assert warning_protocol["requires_confirmation"] is True
        assert confirmation_protocol["confirmed"] is True
        assert reveal_protocol["confirmed"] is True
        assert reveal_protocol["scope"] == warning_protocol["scope"]
        assert reveal_protocol["keeper_secret_id"] == warning_protocol["keeper_secret_id"]

    audit_reveals = [
        event
        for event in campaign_audit_events(run_dir)
        if event.get("type") == "spoiler_reveal"
    ]
    assert {event.get("spoiler_id") for event in audit_reveals} == set(expected_spoiler_ids)
    for event in audit_reveals:
        assert event["confirmed"] is True
        assert event["scope"]
        assert event["keeper_secret_id"]


def significant_scene_replay_count(run_dir: Path) -> int:
    significant_types = {
        "scene",
        "clue",
        "damage",
        "sanity",
        "bout_of_madness",
        "combat",
        "chase",
        "status",
        "session_ending",
    }
    return sum(1 for event in campaign_state_events(run_dir) if event.get("type") in significant_types)


def section_text(markdown: str, heading: str) -> str:
    canonical_heading = heading.lstrip("#").strip()
    anchor = f"<!-- report-anchor: {canonical_heading} -->"
    if anchor in markdown:
        start = markdown.index(anchor)
        line_end = markdown.find("\n", start)
        rest = markdown[line_end + 1:]
    else:
        start = markdown.index(heading)
        rest = markdown[start + len(heading):]
    next_heading = rest.find("\n## ")
    return rest if next_heading == -1 else rest[:next_heading]


def visible_markdown_text(markdown: str) -> str:
    import re

    return re.sub(r"<!--.*?-->", "", markdown, flags=re.DOTALL)


def bullet_count(text: str) -> int:
    return sum(1 for line in text.splitlines() if line.startswith("- "))


def detail_count(text: str, label: str) -> int:
    return sum(1 for line in text.splitlines() if line.startswith(f"  - {label}："))


def assert_zh_hans_locale(metadata: dict, required_terms: dict[str, str]) -> None:
    assert metadata["play_language"] == "zh-Hans"
    assert metadata["language_profile"]["language"] == "zh-Hans"
    assert "localized_terms.zh-Hans" in metadata["language_profile"]["term_policy"]
    assert "player-visible skill display names" in metadata["language_profile"]["term_policy"]
    glossary = metadata["localized_terms"]["zh-Hans"]
    cjk_keys = [canonical for canonical in glossary if has_cjk(canonical)]
    assert cjk_keys == []
    for canonical, localized in required_terms.items():
        assert glossary[canonical] == localized


def assert_visible_terms_localized(text: str, required_terms: dict[str, str]) -> None:
    for canonical, localized in required_terms.items():
        assert localized in text
        assert canonical not in text


ZH_SKILL_TERMS = {
    "Appraise": "估价",
    "Art/Craft (Antiques)": "艺术/手艺（古董修复）",
    "History": "历史",
    "Other Language (Latin)": "其他语言（拉丁语）",
    "Persuade": "说服",
    "Library Use": "图书馆使用",
    "Spot Hidden": "侦查",
    "Dodge": "闪避",
    "Fighting (Brawl)": "格斗（斗殴）",
    "Firearms (Handgun)": "射击（手枪）",
    "First Aid": "急救",
    "Listen": "聆听",
    "Locksmith": "锁匠",
    "Occult": "神秘学",
    "Stealth": "潜行",
    "Charm": "魅惑",
    "Climb": "攀爬",
    "Psychology": "心理学",
}


def assert_terms_absent(text: str, canonical_terms: list[str]) -> None:
    for canonical in canonical_terms:
        assert canonical not in text


def assert_localized_report_shell(text: str) -> None:
    assert "# 跑团战报 <!-- report-anchor: Battle Report -->" in text
    assert "## 运行设置 <!-- report-anchor: Run Setup -->" in text
    assert "## 实际跑团回放 <!-- report-anchor: Actual Play Replay -->" in text
    assert "## 会话记录 <!-- report-anchor: Session Transcript -->" in text
    assert "## 玩家对 KP 的反馈 <!-- report-anchor: Player Feedback On KP -->" in text
    assert "# Battle Report / 跑团战报" not in text
    assert "## Run Setup / 运行设置" not in text
    run_setup = section_text(text, "## Run Setup")
    assert "战役:" in run_setup
    assert "Campaign:" not in run_setup
    assert "游玩语言: 简体中文" in run_setup
    assert "游玩语言: zh-Hans" not in run_setup
    assert "Play Language:" not in run_setup
    module_section = section_text(text, "## Module")
    assert "开场场景:" in module_section
    assert "Opening Scene:" not in module_section


def assert_localized_character_dossier_labels(text: str) -> None:
    assert "  - 职业: " in text
    assert "  - 年代: " in text
    assert "  - 属性: " in text
    assert "  - 衍生值: " in text
    assert "DB: 0" in text
    assert "体格: 0" in text
    assert "  - 技能: " in text
    assert "  - 背景:" in text
    assert "    - 描述: " in text
    assert "    - 信念/理念: " in text
    assert "    - 重要之人: " in text
    assert "    - 重要地点: " in text
    assert "    - 珍贵物品: " in text
    assert "    - 特质: " in text
    assert "  - Occupation:" not in text
    assert "  - Backstory:" not in text
    assert "    - Description:" not in text
    assert "damage_bonus:" not in text
    assert "build:" not in text
    assert "职业: 古物学者" in text
    assert "Antiquarian" not in text


def assert_player_readable_state_ids_absent(text: str, ids: list[str]) -> None:
    for state_id in ids:
        assert f"- {state_id}:" not in text
        assert f"- clue:{state_id}:" not in text
        assert f"- {state_id} -" not in text


def assert_player_readable_event_prefixes_absent(text: str, event_labels: list[str]) -> None:
    for event_label in event_labels:
        assert f"- {event_label}:" not in text


def assert_player_readable_actor_dash_prefixes_absent(text: str, actor_names: list[str]) -> None:
    for actor_name in actor_names:
        assert f"- {actor_name} - " not in text


def assert_player_readable_actor_colon_prefixes_absent(text: str, actor_names: list[str]) -> None:
    for actor_name in actor_names:
        assert f"- {actor_name}: " not in text


def assert_localized_transcript_chrome(text: str) -> None:
    assert "第 1 轮" in text
    assert "\n  - 意图:" in text or "\n  - 裁定:" in text or "\n  - 模式:" in text
    assert "- Turn " not in text
    assert " system:" not in text
    assert "\n  - Intent:" not in text
    assert "\n  - Ruling:" not in text
    assert "\n  - Mode:" not in text
    assert "\n  - 模式: roll" not in text
    assert "\n  - 模式: play" not in text
    assert "\n  - 模式: meta" not in text
    if "\n  - 模式:" in text:
        assert any(
            f"\n  - 模式: {localized_mode}" in text
            for localized_mode in ["游玩", "掷骰", "超游"]
        )


def assert_transcript_detail_values_localized(text: str, expected: list[str], forbidden: list[str]) -> None:
    for value in expected:
        assert value in text
    for value in forbidden:
        assert value not in text


def assert_localized_chronicle_labels(text: str) -> None:
    expected = [
        "经历:",
        "成长:",
        "成长阶段摘要",
        "状态: 等待玩家成长检定",
        "获得成长标记:",
        "继承备注:",
    ]
    forbidden = [
        "History:",
        "Development:",
        "Development Phase Summary",
        "Status: pending_player_rolls",
        "Skill Checks Earned:",
        "Carryover Notes:",
    ]
    for value in expected:
        assert value in text
    for value in forbidden:
        assert value not in text


def assert_feedback_labels_localized(text: str, expected: list[str], forbidden: list[str]) -> None:
    for value in expected:
        assert value in text
    for value in forbidden:
        assert value not in text


def assert_run_setup_values_localized(text: str, expected_profile: str) -> None:
    expected = [
        "骰子模式: Codex 掷骰",
        "剧透策略: 剧透前警告",
        "语言配置: 简体中文",
        "本地化术语: ",
        "条（记录于 playtest.json）",
        f"玩家画像: {expected_profile}",
    ]
    forbidden = [
        "Dice Mode: codex",
        "Dice Mode:",
        "Spoiler Policy: warn_before_reveal",
        "Spoiler Policy:",
        "Language Profile: Simplified Chinese",
        "Language Profile:",
        "见本地化附录",
        "entries (see Localization Appendix)",
        "careful_investigator",
        "reckless_investigator",
        "multi_profile_matrix",
    ]
    for value in expected:
        assert value in text
    for value in forbidden:
        assert value not in text


def assert_module_metadata_values_localized(
    run_setup: str,
    module_section: str,
    *,
    campaign: str,
    scenario: str,
    source: str,
    forbidden: list[str],
) -> None:
    combined = f"{run_setup}\n{module_section}"
    expected = [
        f"战役: {campaign}",
        f"模组: {scenario}",
        f"来源: {source}",
    ]
    for value in expected:
        assert value in combined
    for value in forbidden:
        assert value not in combined


def test_rulebook_smoke_harness_generates_auditable_run(tmp_path):
    run_dir = coc_playtest_harness.create_rulebook_smoke_run(tmp_path, run_id="rulebook-smoke")

    audit = coc_playtest_audit.audit_run(run_dir)
    battle_text = (run_dir / "artifacts" / "battle-report.md").read_text()
    evaluation_text = (run_dir / "artifacts" / "evaluation-report.md").read_text()
    audit_text = (run_dir / "artifacts" / "rulebook-audit.md").read_text()

    assert audit["result"] == "pass"
    assert "Evidence:" in evaluation_text
    assert "PASS" in audit_text
    assert "Mr. Knott" in battle_text
    assert "Chapel of Contemplation" in battle_text
    assert "Library Use: ada-king-rulebook rolled 42 vs 60 -> regular_success" in battle_text
    assert "Pushed Roll: yes" in battle_text
    assert "Ada chose to push the failed Spot Hidden roll" in battle_text
    assert "Push Justification:" in battle_text
    assert "Foreshadowed Failure:" in battle_text
    assert "Goal: find an early public clue about Walter Corbitt and the house" in battle_text
    assert "Difficulty Rationale: The clipping files are public but poorly indexed." in battle_text
    assert "Skill Check Earned: yes" in battle_text
    assert "Session ended with Ada planning to visit the Corbitt House next." in battle_text
    assert 'kp_clarity 5/5: Player feedback: "KP explained when rolls were needed and what changed in the fiction."' in battle_text
    assert "{'" not in battle_text
    assert "'}" not in battle_text
    assert (run_dir / "sandbox" / ".coc" / "campaigns" / "rulebook-smoke" / "scenario" / "clues.json").exists()
    assert (run_dir / "player-feedback.jsonl").exists()


def test_haunting_module_harness_uses_summary_bout_for_solo_corbitt_insanity(tmp_path):
    run_dir = coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="haunting-module")

    bout_event = next(event for event in campaign_state_events(run_dir) if event.get("type") == "bout_of_madness")
    bout_payload = bout_event["payload"]
    battle_text = (run_dir / "artifacts" / "battle-report.md").read_text()

    assert bout_payload["mode"] == "summary"
    assert bout_payload["summary_table"] == "table_viii_summary"
    assert bout_payload["summary_roll"] == 4
    assert bout_payload["duration_die"] == "1D10"
    assert bout_payload["duration_roll"] == 1
    assert bout_payload["duration_hours"] == 1
    assert "duration_rounds" not in bout_payload
    assert "rounds" not in bout_payload
    assert "Table VIII" in bout_payload["rulebook_ref"]
    assert "独处" in battle_text


def test_serious_playtest_logs_reference_structured_rules_json(tmp_path):
    run_dirs = [
        coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="v2-haunting-module"),
        coc_playtest_harness.create_chase_drill_run(tmp_path, run_id="v3-chase-drill"),
        coc_playtest_harness.create_multi_profile_pressure_run(tmp_path, run_id="v4-multi-profile-pressure"),
    ]
    known_rule_ids = coc_rules.rule_ids()

    for run_dir in run_dirs:
        roll_rows = campaign_roll_events(run_dir)
        assert roll_rows
        for row in roll_rows:
            refs = payload_rule_refs(row)
            assert refs, row
            assert set(refs).issubset(known_rule_ids)

        text_rule_rows = [
            row
            for row in campaign_state_events(run_dir)
            if isinstance(row.get("payload"), dict)
            and "rulebook_ref" in row["payload"]
        ]
        for row in text_rule_rows:
            refs = payload_rule_refs(row)
            assert refs, row
            assert set(refs).issubset(known_rule_ids)


def test_serious_playtests_persist_recoverable_campaign_save_and_indexes(tmp_path):
    run_dirs = [
        coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="v2-haunting-module"),
        coc_playtest_harness.create_chase_drill_run(tmp_path, run_id="v3-chase-drill"),
        coc_playtest_harness.create_multi_profile_pressure_run(tmp_path, run_id="v4-multi-profile-pressure"),
    ]
    known_rule_ids = coc_rules.rule_ids()

    for run_dir in run_dirs:
        metadata = playtest_metadata(run_dir)
        campaign_dir = campaign_dir_for_run(run_dir)
        campaign_id = metadata["campaign_id"]
        investigator_ids = read_json(campaign_dir / "party.json")["investigator_ids"]

        for relative_path in [
            "save/world-state.json",
            "save/active-scene.json",
            "save/flags.json",
            "index/source-map.json",
            "index/scene-index.json",
            "index/npc-index.json",
            "index/clue-index.json",
            "index/rule-ref-index.json",
        ]:
            path = campaign_dir / relative_path
            assert path.exists(), relative_path
            assert read_json(path)["campaign_id"] == campaign_id

        world_state = read_json(campaign_dir / "save" / "world-state.json")
        assert world_state["scenario_id"] == metadata["scenario_id"]
        assert world_state["memory_refs"] == ["memory/session-summaries.jsonl"]
        assert isinstance(world_state["discovered_clue_ids"], list)
        assert isinstance(world_state["major_decisions"], list)
        assert world_state["log_refs"] == ["logs/events.jsonl", "logs/rolls.jsonl"]

        active_scene = read_json(campaign_dir / "save" / "active-scene.json")
        assert active_scene["scene_id"] == world_state["active_scene_id"]
        assert active_scene["source_event_type"] in {"scene", "session_ending"}
        assert active_scene["summary"]

        flags = read_json(campaign_dir / "save" / "flags.json")
        assert isinstance(flags["clues_found"], dict)
        assert isinstance(flags["decisions"], list)
        assert isinstance(flags["spoiler_reveals"], list)

        source_map = read_json(campaign_dir / "index" / "source-map.json")
        assert source_map["scenario_files"]
        assert "scenario/scenario.json" in source_map["scenario_files"]
        assert source_map["source_refs"]

        scene_index = read_json(campaign_dir / "index" / "scene-index.json")
        assert scene_index["scenes"]
        assert scene_index["active_scene_id"] == world_state["active_scene_id"]
        scene_ids = {
            scene["id"]
            for scene in scene_index["scenes"]
            if isinstance(scene, dict)
            and isinstance(scene.get("id"), str)
        }
        assert scene_index["active_scene_id"] in scene_ids

        npc_index = read_json(campaign_dir / "index" / "npc-index.json")
        clue_index = read_json(campaign_dir / "index" / "clue-index.json")
        assert isinstance(npc_index["npcs"], list)
        assert isinstance(clue_index["clues"], list)
        indexed_clue_ids = {
            clue["id"]
            for clue in [*clue_index["clues"], *clue_index["handouts"]]
            if isinstance(clue, dict)
            and isinstance(clue.get("id"), str)
        }
        assert set(clue_index["discovered_clue_ids"]).issubset(indexed_clue_ids)

        rule_ref_index = read_json(campaign_dir / "index" / "rule-ref-index.json")
        assert set(rule_ref_index["rule_refs"]).issubset(known_rule_ids)
        assert rule_ref_index["by_ref"]

        for investigator_id in investigator_ids:
            state = read_json(campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json")
            development_skill_checks = {
                skill
                for row in investigator_jsonl(run_dir, investigator_id, "development.jsonl")
                for skill in row.get("skill_checks_earned", [])
                if isinstance(skill, str)
            }
            assert state["campaign_id"] == campaign_id
            assert state["investigator_id"] == investigator_id
            assert state["character_ref"] == f"sandbox/.coc/investigators/{investigator_id}/character.json"
            assert isinstance(state["current_hp"], int)
            assert isinstance(state["current_san"], int)
            assert isinstance(state["skill_checks_earned"], list)
            assert set(state["skill_checks_earned"]) == development_skill_checks

        subsystems = set(metadata["subsystems_covered"])
        if "combat" in subsystems:
            combat = read_json(campaign_dir / "save" / "combat.json")
            assert combat["campaign_id"] == campaign_id
            assert combat["status"] == "resolved"
            assert combat["combatants"]
            assert combat["dex_order"]
            assert combat["rounds"]
        if "chase" in subsystems:
            assert (campaign_dir / "save" / "chase.json").exists()


def test_haunting_module_audit_rejects_transcript_turn_sequence_gaps(tmp_path):
    import json

    run_dir = coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="haunting-module")
    transcript_path = run_dir / "transcript.jsonl"
    events = [
        json.loads(line)
        for line in transcript_path.read_text().splitlines()
        if line.strip()
    ]
    numeric_turns = [
        event["turn"]
        for event in events
        if isinstance(event.get("turn"), int)
    ]
    last_turn = max(numeric_turns)
    for event in events:
        if event.get("turn") == last_turn:
            event["turn"] = last_turn + 1
            break
    transcript_path.write_text(
        "\n".join(json.dumps(event, ensure_ascii=False) for event in events) + "\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    finding_codes = {finding["code"] for finding in audit["findings"]}
    assert "transcript_turn_sequence_gap" in finding_codes


def test_haunting_module_harness_generates_full_module_battle_report(tmp_path):
    run_dir = coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="haunting-module")

    audit = coc_playtest_audit.audit_run(run_dir)
    battle_text = (run_dir / "artifacts" / "battle-report.md").read_text()
    evaluation_text = (run_dir / "artifacts" / "evaluation-report.md").read_text()
    audit_text = (run_dir / "artifacts" / "rulebook-audit.md").read_text()
    metadata = playtest_metadata(run_dir)
    zh_terms = {
        "Ada King": "艾达·金",
        "Mr. Knott": "诺特先生",
        "Arty Wilmot": "阿蒂·威尔莫特",
        "Walter Corbitt": "沃尔特·科比特",
        "The Old Corbitt Place": "科比特老宅",
        "Corbitt's Hiding Place": "科比特的藏身处",
        "Corbitt Attacks": "科比特袭击",
    }
    visible_scene_terms = {
        "Ruth Blake": "露丝·布莱克",
        "morgue": "剪报档案室",
        "Handout": "线索资料",
        "basement door": "地下室门",
        "basement": "地下室",
        "spare bedroom": "备用卧室",
        "three-Y symbol": "三叉眼符号",
        "Mythos material": "神话材料",
        "dagger": "匕首",
    }
    report_scene_terms = {
        "basement stairs": "地下室楼梯",
        "pushed basement search": "推骰地下室搜索",
        "own-weapon clue": "以其人之物反制的线索",
        "three-Y eye symbol": "三叉眼符号",
    }

    assert audit["result"] == "pass"
    assert "Evidence:" in evaluation_text
    assert "## Future Enhancements" in evaluation_text
    assert "## Recommended Fixes\n- No fixes recorded." in evaluation_text
    assert "LLM-vs-KP interactive transcript" in evaluation_text
    assert "PASS" in audit_text
    assert "## Positive Rulebook Evidence" in audit_text
    assert transcript_turn_sequence_gaps(run_dir) == []
    assert "Module coverage: 10/10" in audit_text
    assert "Bout of Madness events: 1" in audit_text
    assert "temporary_insanity_triggered markers: 1" in audit_text
    assert "Corbitt Magic point events: 3" in audit_text
    assert "Flesh Ward armor: 7" in audit_text
    bout_event = next(event for event in campaign_state_events(run_dir) if event.get("type") == "bout_of_madness")
    bout_payload = bout_event["payload"]
    assert bout_payload["mode"] == "summary"
    assert bout_payload["summary_table"] == "table_viii_summary"
    assert bout_payload["summary_roll"] == 4
    assert bout_payload["duration_die"] == "1D10"
    assert bout_payload["duration_roll"] == 1
    assert bout_payload["duration_hours"] == 1
    assert "duration_rounds" not in bout_payload
    assert "rounds" not in bout_payload
    assert bout_payload["control_returned"] is True
    status_payload = next(
        event["payload"]
        for event in campaign_state_events(run_dir)
        if event.get("type") == "status" and event.get("payload", {}).get("final_hp") == 3
    )
    assert status_payload["unresolved_conditions"] == [
        {
            "condition": "temporary_insanity_underlying",
            "label": "临时疯狂底层状态",
            "duration_hours": 1,
            "remaining_hours": 1,
            "player_visible_summary": "临时疯狂底层状态仍持续，若在 1 小时内再次损失 SAN，会再次触发疯狂发作。",
            "summary": "艾达·金在摘要疯狂后恢复玩家控制，但仍处于临时疯狂的底层状态；若在 1 小时内再次损失 SAN，会再次触发疯狂发作。",
        }
    ]
    assert_zh_hans_locale(metadata, zh_terms | visible_scene_terms | report_scene_terms | ZH_SKILL_TERMS)
    assert metadata["localized_terms"]["zh-Hans"]["Antiquarian"] == "古物学者"
    assert_source_transcript_display_fields_localized(run_dir)
    assert_source_transcript_display_text_strips_protocol_wrappers(run_dir)
    assert_localized_report_shell(battle_text)
    assert_no_cjk_ascii_sentence_periods(battle_text)
    state_changes = section_text(battle_text, "### State Changes")
    source_summaries = [
        event["payload"]["summary"].strip()
        for event in campaign_state_events(run_dir)
        if isinstance(event.get("payload"), dict)
        and isinstance(event["payload"].get("summary"), str)
        and event["payload"]["summary"].strip()
    ]
    assert source_summaries
    assert_no_cjk_ascii_sentence_periods("\n".join(source_summaries))
    for summary in source_summaries:
        assert summary in state_changes
    run_setup = section_text(battle_text, "## Run Setup")
    assert "- 游玩语言: 简体中文" in run_setup
    assert "- 游玩语言: zh-Hans" not in run_setup
    assert "本地化术语: " in run_setup
    assert_run_setup_values_localized(run_setup, "谨慎调查员")
    assert "Ada King -> 艾达·金" not in run_setup
    assert "Mr. Knott -> 诺特先生" not in run_setup
    assert "The Old Corbitt Place -> 科比特老宅" not in run_setup
    assert len(run_setup.splitlines()) <= 10
    assert "## 本地化附录 <!-- report-anchor: Localization Appendix -->" not in battle_text
    assert "<!-- report-anchor: Localization Appendix -->" not in battle_text
    assert "Ada King -> 艾达·金" not in battle_text
    assert "Mr. Knott -> 诺特先生" not in battle_text
    assert "The Old Corbitt Place -> 科比特老宅" not in battle_text
    module_section = section_text(battle_text, "## Module")
    visible_module_section = visible_markdown_text(module_section)
    assert "scenario-id: the-haunting" in battle_text
    assert "模组 ID:" not in visible_module_section
    assert "the-haunting" not in visible_module_section
    assert_module_metadata_values_localized(
        run_setup,
        module_section,
        campaign="《鬼屋》模组实录",
        scenario="《鬼屋》",
        source="《克苏鲁的呼唤守秘人规则书》40周年纪念版 PDF",
        forbidden=[
            "The Haunting Module Playthrough",
            "Scenario: The Haunting",
            "pdf/Call Of Cthulhu Keeper Rulebook",
        ],
    )
    assert "- 开场场景: 诺特先生" in battle_text
    assert "诺特先生在 1920 年的波士顿与艾达·金会面" in module_section
    assert "meets" not in module_section
    assert "- 艾达·金" in battle_text
    assert "investigator-id: ada-king-haunting" in battle_text
    character_dossier = section_text(battle_text, "## Character Dossier")
    visible_character_dossier = visible_markdown_text(character_dossier)
    assert_localized_character_dossier_labels(character_dossier)
    assert "(ada-king-haunting)" not in visible_character_dossier
    assert "描述: 艾达·金" in character_dossier
    assert "信念/理念: 老房子会留下居住者的记忆" in character_dossier
    assert "重要之人: 莱兰·哈特教授" in character_dossier
    assert "重要地点: 斯科利广场附近的旧书店" in character_dossier
    assert "珍贵物品: 裂柄铜放大镜" in character_dossier
    assert "特质: 谨慎记笔记" in character_dossier
    assert "Ada King" not in character_dossier
    assert "说服: 55" in character_dossier
    assert "图书馆使用: 60" in character_dossier
    assert "侦查: 55" in character_dossier
    assert "闪避: 25" in character_dossier
    assert "格斗（斗殴）: 40" in character_dossier
    assert "Persuade: 55" not in character_dossier
    assert "Library Use: 60" not in character_dossier
    assert "Spot Hidden: 55" not in character_dossier
    assert "Dodge: 25" not in character_dossier
    assert "Fighting (Brawl): 40" not in character_dossier
    creation = investigator_json(run_dir, "ada-king-haunting", "creation.json")
    assert creation["method"] == "standard_rulebook_chapter_3"
    assert creation["rulebook_steps"] == [
        "generate_characteristics",
        "choose_age",
        "apply_age_adjustments",
        "determine_occupation",
        "allocate_skill_points",
        "create_backstory",
        "equip_investigator",
    ]
    assert creation["characteristics"]["STR"]["final"] == 60
    assert creation["age"] == {
        "years": 32,
        "range": "20-39",
        "edu_improvement_checks_required": 1,
        "edu_improvement_checks": [
            {
                "roll": 42,
                "target": 75,
                "improved": False,
                "improvement_die": "1D10",
                "improvement_roll": None,
                "edu_before": 75,
                "edu_after": 75,
            },
        ],
        "characteristic_reductions": [],
        "app_reduction": 0,
        "mov_penalty": 0,
    }
    assert creation["occupation"]["name"] == "Antiquarian"
    assert creation["occupation"]["skill_point_formula"] == "EDU × 4"
    assert creation["occupation"]["skill_points_available"] == 300
    assert creation["occupation"]["credit_rating_range"] == "30-70"
    assert creation["personal_interest"]["skill_point_formula"] == "INT × 2"
    assert creation["personal_interest"]["skill_points_available"] == 140
    assert creation["finances"]["credit_rating"] == 40
    assert "裂柄铜放大镜" in creation["equipment"]
    allocation = creation["skill_allocation"]
    assert allocation["occupation_points_spent"] == 300
    assert allocation["personal_interest_points_spent"] == 140
    assert allocation["unallocated_occupation_points"] == 0
    assert allocation["unallocated_personal_interest_points"] == 0
    assert allocation["skills"]["Credit Rating"] == {
        "base": 0,
        "occupation_points": 40,
        "personal_interest_points": 0,
        "final": 40,
    }
    assert allocation["skills"]["Library Use"] == {
        "base": 20,
        "occupation_points": 40,
        "personal_interest_points": 0,
        "final": 60,
    }
    assert allocation["skills"]["Fighting (Brawl)"] == {
        "base": 25,
        "occupation_points": 0,
        "personal_interest_points": 15,
        "final": 40,
    }
    assert_creation_allocation_matches_character(run_dir, "ada-king-haunting")
    assert_view_streams_separated(run_dir, ["secret-corbitt-body", "secret-floating-knife"])
    assert_player_view_roll_outcomes_localized(run_dir)
    assert_player_view_public_state_localized(run_dir)
    assert_player_view_transcript_speakers_localized(run_dir)
    assert_player_view_transcript_details_localized(run_dir)
    assert_player_view_text_strips_protocol_wrappers(run_dir)
    assert_player_view_localized_text_values_localized(run_dir)
    assert_player_profile_displays_localized(run_dir)
    assert_pushed_roll_protocol(run_dir, [
        "haunting-arty-persuade-push",
        "haunting-basement-descent-push",
        "haunting-basement-search-push",
    ])
    creation_section = section_text(battle_text, "## Investigator Creation")
    assert "## 角色创建记录 <!-- report-anchor: Investigator Creation -->" in battle_text
    assert battle_text.index("report-anchor: Investigator Creation") < battle_text.index("report-anchor: Actual Play Replay")
    assert "生成属性: STR 60, CON 55, SIZ 65, DEX 50, APP 45, INT 70, POW 55, EDU 75, LUCK 55" in creation_section
    assert "年龄: 32（20-39 岁）" in creation_section
    assert "年龄调整: EDU 成长检定 1 次；本次 42 / 75，未提升；属性无降低。" in creation_section
    assert "职业: 古物学者" in creation_section
    assert "职业技能点: EDU × 4 = 300" in creation_section
    assert "个人兴趣技能点: INT × 2 = 140" in creation_section
    assert "信用评级: 40（规则书职业范围 30-70）" in creation_section
    assert "技能分配: 职业 300/300，个人兴趣 140/140，未分配 0/0" in creation_section
    assert "信用评级: 基础 0 + 职业 40 + 个人兴趣 0 = 40" in creation_section
    assert "图书馆使用: 基础 20 + 职业 40 + 个人兴趣 0 = 60" in creation_section
    assert "格斗（斗殴）: 基础 25 + 职业 0 + 个人兴趣 15 = 40" in creation_section
    assert "base " not in creation_section
    assert "装备: 裂柄铜放大镜; 笔记本; 钢笔; 左轮" in creation_section
    assert "Call of Cthulhu Keeper Rulebook Chapter 3" not in creation_section
    assert investigator_jsonl(run_dir, "ada-king-haunting", "history.jsonl")
    assert investigator_jsonl(run_dir, "ada-king-haunting", "development.jsonl")
    inventory_history = investigator_jsonl(run_dir, "ada-king-haunting", "inventory-history.jsonl")
    assert inventory_history
    assert "线索资料 1、2、7" in inventory_history[0]["items"]
    assert "50 美元" in inventory_history[0]["cash"]
    chronicle = section_text(battle_text, "## Investigator Chronicle")
    assert_localized_chronicle_labels(chronicle)
    assert "艾达·金在《鬼屋》中幸存" in chronicle
    assert "最终 HP: 3" in chronicle
    assert "最终 SAN: 49" in chronicle
    assert "获得成长标记: 说服; 图书馆使用; 侦查; 闪避; 格斗（斗殴）" in chronicle
    assert "继承备注: 下次导入前先结算成长检定" in chronicle
    assert "物品经历" in chronicle
    assert "《鬼屋》结束时的可继承物品与证物" in chronicle
    assert "物品: 诺特先生的钥匙状态：任务结束后应归还诺特先生" in chronicle
    assert "线索资料 1、2、7" in chronicle
    assert "科比特匕首：作为危险证物封存" in chronicle
    assert "左轮：临时疯狂中丢失，战后找回" in chronicle
    assert "虫蛀书：可选择保留，需下次开团前确认" in chronicle
    assert "现金: 50 美元" in chronicle
    assert "<!-- report-anchor: Scene-by-Scene Replay -->" in battle_text
    scene_replay = section_text(battle_text, "## Scene-by-Scene Replay")
    assert has_cjk(scene_replay)
    assert bullet_count(scene_replay) >= significant_scene_replay_count(run_dir)
    assert_player_readable_state_ids_absent(
        scene_replay,
        ["basement", "corbitt-dagger", "own-weapon-clue", "corbitt-defeated"],
    )
    assert_player_readable_event_prefixes_absent(
        scene_replay,
        ["damage", "sanity", "combat", "bout of madness", "chase", "session ending"],
    )
    assert_player_readable_actor_dash_prefixes_absent(scene_replay, ["艾达·金"])
    assert "自家地下室" in scene_replay
    assert "地下室楼梯" in scene_replay
    assert "推骰地下室搜索" in scene_replay
    assert "以其人之物反制的线索" in scene_replay
    assert "疯狂发作（摘要）" in scene_replay
    assert "没有其他调查员在场" in scene_replay
    assert "摘要表" in scene_replay
    assert "结果解释为暴力" in scene_replay
    assert "控制权回到玩家" in scene_replay
    damage_event_summaries = [
        event["payload"]["summary"]
        for event in campaign_events_by_type(run_dir, "damage")
    ]
    assert "Bed Attack 造成 Damage: 5 HP；HP 12 -> 7。" not in damage_event_summaries
    assert "pushed basement search 失败造成 Damage: 4 HP；HP 7 -> 3。" not in damage_event_summaries
    assert "床铺袭击造成艾达·金 5 HP 伤害；HP 12 -> 7。" in damage_event_summaries
    assert "推骰地下室搜索失败造成艾达·金 4 HP 伤害；HP 7 -> 3。" in damage_event_summaries
    assert "床铺袭击造成艾达·金 5 HP 伤害；HP 12 -> 7。" in scene_replay
    assert "推骰地下室搜索失败造成艾达·金 4 HP 伤害；HP 7 -> 3。" in scene_replay
    hp_damage_rolls = [
        event
        for event in campaign_roll_events(run_dir)
        if event.get("type") == "damage"
        and event.get("payload", {}).get("damage_kind") == "hit_points"
    ]
    assert [event["payload"]["roll_id"] for event in hp_damage_rolls] == [
        "haunting-bed-attack-damage",
        "haunting-basement-search-damage",
    ]
    assert hp_damage_rolls[0]["payload"] == {
        "roll_id": "haunting-bed-attack-damage",
        "damage_kind": "hit_points",
        "source": "bed_attack",
        "skill": "HP Damage",
        "goal": "apply Bed Attack damage after failed Dodge",
        "target": 8,
        "effective_target": 8,
        "difficulty": "damage",
        "difficulty_rationale": "The Bed Attack damage is 1D6+2 after Ada fails to Dodge being thrown through the spare bedroom window.",
        "roll": 5,
        "die": "1D6+2",
        "die_rolls": [3],
        "flat_modifier": 2,
        "outcome": "damage_applied",
        "failure_consequence": "Damage rolls are not skill checks; the failed Dodge has already established the consequence.",
        "hp_before": 12,
        "hp_delta": -5,
        "hp_after": 7,
        "localized_text": {
            "zh-Hans": {
                "goal": "床铺袭击闪避失败后结算伤害",
                "difficulty_rationale": "艾达·金闪避床铺袭击失败后，床把她撞穿备用卧室窗户，伤害为 1D6+2。",
                "failure_consequence": "伤害骰不是技能检定；闪避失败已经确定了后果。",
            }
        },
        "rule_refs": [
            "core.damage.roll",
            "module.haunting.bed_attack_damage",
        ],
    }
    assert hp_damage_rolls[1]["payload"] == {
        "roll_id": "haunting-basement-search-damage",
        "damage_kind": "hit_points",
        "source": "basement_pushed_search_failure",
        "skill": "HP Damage",
        "goal": "apply pushed basement search failure damage",
        "target": 6,
        "effective_target": 6,
        "difficulty": "damage",
        "difficulty_rationale": "The pushed basement search failure exposes Ada to the possessed dagger and applies 1D4+2 damage.",
        "roll": 4,
        "die": "1D4+2",
        "die_rolls": [2],
        "flat_modifier": 2,
        "outcome": "damage_applied",
        "failure_consequence": "The pushed Spot Hidden roll has already failed; this damage roll applies its foreshadowed consequence.",
        "hp_before": 7,
        "hp_delta": -4,
        "hp_after": 3,
        "localized_text": {
            "zh-Hans": {
                "goal": "结算地下室推骰搜索失败伤害",
                "difficulty_rationale": "地下室推骰搜索失败让艾达·金直接碰到附魔匕首，伤害为 1D4+2。",
                "failure_consequence": "推骰侦查已经失败；这颗伤害骰用于执行预告后果。",
            }
        },
        "rule_refs": [
            "core.damage.roll",
            "module.haunting.basement_search_damage",
        ],
    }
    resource_events = campaign_events_by_type(run_dir, "resource_change")
    corbitt_magic_points = [
        event for event in resource_events
        if event.get("actor") == "walter-corbitt" and event.get("payload", {}).get("resource") == "magic_points"
    ]
    assert len(corbitt_magic_points) == 3
    by_reason = {event["payload"]["reason"]: event["payload"] for event in corbitt_magic_points}
    assert by_reason["flesh_ward"]["before"] == 18
    assert by_reason["flesh_ward"]["cost"] == 2
    assert by_reason["flesh_ward"]["delta"] == -2
    assert by_reason["flesh_ward"]["after"] == 16
    assert by_reason["flesh_ward"]["source_turn"] == 21
    assert by_reason["flesh_ward"]["armor_rolls"] == [4, 3]
    assert by_reason["flesh_ward"]["armor_points"] == 7
    assert by_reason["floating_knife_attack"]["before"] == 16
    assert by_reason["floating_knife_attack"]["cost"] == 1
    assert by_reason["floating_knife_attack"]["delta"] == -1
    assert by_reason["floating_knife_attack"]["after"] == 15
    assert by_reason["floating_knife_attack"]["source_turn"] == 40
    assert by_reason["animate_body"]["before"] == 15
    assert by_reason["animate_body"]["cost"] == 2
    assert by_reason["animate_body"]["delta"] == -2
    assert by_reason["animate_body"]["after"] == 13
    assert by_reason["animate_body"]["source_turn"] == 46
    reward_rolls = [
        event
        for event in campaign_roll_events(run_dir)
        if event.get("type") == "reward"
        and event.get("payload", {}).get("reward_kind") == "sanity"
    ]
    assert len(reward_rolls) == 1
    assert reward_rolls[0]["payload"] == {
        "roll_id": "haunting-conclusion-sanity-reward",
        "reward_kind": "sanity",
        "source": "conclusion_rewards",
        "skill": "SAN Reward",
        "goal": "conclusion reward restores SAN",
        "target": 6,
        "effective_target": 6,
        "difficulty": "reward",
        "difficulty_rationale": "The Haunting rewards each participating investigator with 1D6 SAN when Corbitt is conquered and destroyed.",
        "roll": 4,
        "die": "1D6",
        "outcome": "sanity_reward",
        "failure_consequence": "No failure consequence; this is a reward die, not a skill check.",
        "san_before": 45,
        "san_delta": 4,
        "san_after": 49,
        "localized_text": {
            "zh-Hans": {
                "goal": "结局奖励恢复 SAN",
                "difficulty_rationale": "《鬼屋》结局奖励：科比特被征服并摧毁后，每位参与调查员恢复 1D6 SAN。",
                "failure_consequence": "没有失败后果；这是奖励骰，不是技能检定。",
            }
        },
        "rule_refs": [
            "core.reward.sanity_gain",
            "module.haunting.conclusion_sanity_reward",
        ],
    }
    assert "沃尔特·科比特在艾达·金进入老宅后花费 2 点魔法值施放血肉护盾；2D6 护甲掷出 4 和 3，共 7 点护甲；魔法值 18 -> 16。" in scene_replay
    assert "沃尔特·科比特花费 1 点魔法值驱使浮空匕首本轮攻击；魔法值 16 -> 15。" in scene_replay
    assert "沃尔特·科比特花费 2 点魔法值让身体活动五个战斗轮；魔法值 15 -> 13。" in scene_replay
    final_corbitt_combat = [
        event for event in campaign_events_by_type(run_dir, "combat")
        if event.get("payload", {}).get("rulebook_exception") == "own_dagger_ignores_spells"
    ]
    assert final_corbitt_combat
    assert final_corbitt_combat[0]["payload"]["flesh_ward_bypassed"] is True
    assert final_corbitt_combat[0]["payload"]["armor_before"] == 7
    assert "科比特自己的匕首命中特例" in scene_replay
    assert "血肉护盾不再保护他" in scene_replay
    assert "resource_change" not in scene_replay
    assert "最终 HP: 3；最终 SAN: 49；奖励: +4 SAN、30 美元奖金，并可选择保留虫蛀书；临时疯狂底层状态仍持续，若在 1 小时内再次损失 SAN，会再次触发疯狂发作。" in scene_replay
    assert "DEX 检定" in scene_replay
    assert "ada-king-haunting -" not in scene_replay
    assert "艾达·金 - 艾达·金" not in scene_replay
    assert "- 艾达·金用借助外套战技" in scene_replay
    assert_terms_absent(scene_replay, ["own-weapon clue", "three-Y eye symbol", "spare bedroom", "basement stairs", "pushed 地下室 search"])
    assert_terms_absent(scene_replay, ["Damage:", "DEX roll"])
    assert "<!-- report-anchor: Actual Play Replay -->" in battle_text
    actual_play = section_text(battle_text, "## Actual Play Replay")
    assert_visible_terms_localized(actual_play, zh_terms)
    assert_localized_transcript_chrome(actual_play)
    assert_transcript_detail_values_localized(
        actual_play,
        ["询问委托条件和近期线索", "无需检定", "询问推骰裁定", "推骰说明"],
        ["ask terms and immediate leads", "no_roll_needed", "ask 推骰-roll ruling", "pushed_roll_explanation"],
    )
    assert "诺特先生把一枚旧钥匙" in actual_play
    assert "KP[诺特先生]" in actual_play
    assert "KP[阿蒂·威尔莫特]" in actual_play
    assert "KP[加布里埃拉·马卡里奥]" in actual_play
    assert "KP[维托里奥·马卡里奥]" in actual_play
    assert "金小姐，我需要的是事实，不是传闻" in actual_play
    assert "剪报档案室不是给陌生人随便翻的" in actual_play
    assert "那栋屋子里有东西" in actual_play
    assert "恶魔会败在自己的武器下" in actual_play
    assert "KP[Mr. Knott]" not in actual_play
    assert "KP[Arty Wilmot]" not in actual_play
    assert "KP[Gabriela Macario]" not in actual_play
    assert "KP[Vittorio Macario]" not in actual_play
    assert "第 6 轮 系统: 说服：艾达·金掷出 72 / 55，结果失败。" in actual_play
    assert "第 42 轮 系统: POW：沃尔特·科比特掷出 34 / 90，结果困难成功；闪避：艾达·金掷出 18 / 25，结果困难成功。浮空匕首刺空。" in actual_play
    assert "第 48 轮 KP: \"疯狂发作（摘要）" in actual_play
    assert "第 48a 轮 系统: 格斗（斗殴）：艾达·金掷出 21 / 40，结果普通成功。摘要疯狂中的暴力结果" in actual_play
    assert actual_play.index("第 48a 轮 系统") < actual_play.index("第 49 轮 玩家")
    assert "控制权回到玩家" in actual_play
    assert "临时疯狂底层状态仍持续" in actual_play
    assert "若在 1 小时内再次损失 SAN，会再次触发疯狂发作" in actual_play
    assert "Persuade 72 vs 55" not in actual_play
    assert "Persuade：" not in actual_play
    assert "Dodge：" not in actual_play
    assert "regular_success" not in actual_play
    assert "Corbitt POW 34 vs 90" not in actual_play
    session_transcript = section_text(battle_text, "## Session Transcript")
    assert_localized_transcript_chrome(session_transcript)
    assert_transcript_detail_values_localized(
        session_transcript,
        ["询问委托条件和近期线索", "无需检定", "询问推骰裁定", "推骰说明"],
        ["ask terms and immediate leads", "no_roll_needed", "ask 推骰-roll ruling", "pushed_roll_explanation"],
    )
    assert "第 6 轮 系统: 说服：艾达·金掷出 72 / 55，结果失败。" in session_transcript
    assert "KP[诺特先生]" in session_transcript
    assert "KP[阿蒂·威尔莫特]" in session_transcript
    assert "KP[加布里埃拉·马卡里奥]" in session_transcript
    assert "第 42 轮 系统: POW：沃尔特·科比特掷出 34 / 90，结果困难成功；闪避：艾达·金掷出 18 / 25，结果困难成功。浮空匕首刺空。" in session_transcript
    assert "临时疯狂底层状态仍持续" in session_transcript
    assert "若在 1 小时内再次损失 SAN，会再次触发疯狂发作" in session_transcript
    assert "Persuade 72 vs 55" not in session_transcript
    assert "regular_success" not in session_transcript
    assert "Corbitt POW 34 vs 90" not in session_transcript
    visible_dialogue = "\n".join(visible_play_texts(run_dir))
    assert_visible_terms_localized(visible_dialogue, visible_scene_terms)
    assert "临时疯狂底层状态仍持续" in visible_dialogue
    assert "若在 1 小时内再次损失 SAN，会再次触发疯狂发作" in visible_dialogue
    assert_terms_absent(visible_dialogue, ["Regular difficulty", "pushed roll", "pushed rolls", "HP damage"])
    assert_terms_absent(visible_dialogue, ["combined roll", "Obscure clue", " chapel "])
    assert_terms_absent(visible_dialogue, ["combat round", "Rewards", "Final HP", "Final SAN"])
    assert "难度为普通" not in visible_dialogue
    assert "普通难度" in visible_dialogue
    assert "推骰" in visible_dialogue
    assert "HP 伤害" in visible_dialogue
    assert "联合检定" in visible_dialogue
    assert "隐晦线索" in visible_dialogue
    assert "教堂或科比特" in visible_dialogue
    assert "战斗轮" in visible_dialogue
    assert "奖励" in visible_dialogue
    assert "最终 HP" in visible_dialogue
    assert "最终 SAN" in visible_dialogue
    meta_events = [
        event
        for event in transcript_events(run_dir)
        if event.get("mode") == "meta" and event.get("role") in {"keeper_under_test", "player_simulator"}
    ]
    assert {event["role"] for event in meta_events} == {"keeper_under_test", "player_simulator"}
    assert any(
        event.get("role") == "system" and event.get("mode") == "roll"
        for event in transcript_events(run_dir)
    )
    raw_transcript_text = "\n".join(str(event.get("text", "")) for event in transcript_events(run_dir))
    assert "[meta]" in raw_transcript_text
    assert "[meta]" not in actual_play
    assert "[/meta]" not in actual_play
    assert "[meta]" not in session_transcript
    assert "[/meta]" not in session_transcript
    assert "为什么这里可以推骰" in actual_play
    assert "失败后果" in actual_play
    assert (
        '第 7a 轮 玩家: "我想确认一下：为什么这里可以推骰？失败后果是不是要先说清楚？"\n'
        "  - 意图: 询问推骰裁定\n"
        "  - 模式: 超游"
    ) in actual_play
    assert (
        '第 7b 轮 KP: "可以，因为你不是重掷同一个动作，而是改变策略：亮出钥匙、强调可能阻止悲剧。'
        '失败后果会先摆明：阿蒂会叫维护工，你今天失去查档机会。确认后我们回到场景。"\n'
        "  - 裁定: 推骰说明\n"
        "  - 模式: 超游"
    ) in actual_play
    assert all("Ada King" not in text for text in visible_play_texts(run_dir))
    assert all("Mr. Knott" not in text for text in visible_play_texts(run_dir))
    assert all("Walter Corbitt" not in text for text in visible_play_texts(run_dir))
    assert all(has_cjk(text) for text in visible_play_texts(run_dir))
    major_decisions = section_text(battle_text, "## Major Player Decisions")
    assert has_cjk(major_decisions)
    assert " chose " not in major_decisions
    assert " before " not in major_decisions
    assert "ada-king-haunting:" not in major_decisions
    assert "艾达·金:" not in major_decisions
    assert "艾达·金: 艾达·金" not in major_decisions
    assert " basement" not in major_decisions
    assert " dagger" not in major_decisions
    assert "艾达·金选择先去《波士顿环球报》查剪报" in major_decisions
    assert "艾达·金在摘要疯狂结束后恢复控制" in major_decisions
    rules_recap = section_text(battle_text, "## Rules & Rolls Recap")
    assert has_cjk(rules_recap)
    assert "说服：艾达·金掷出 72 / 55，结果失败。" in rules_recap
    assert "图书馆使用：艾达·金掷出 22 / 60，结果困难成功。" in rules_recap
    assert "侦查：艾达·金掷出 28 / 55，结果普通成功。" in rules_recap
    assert any(
        event.get("payload", {}).get("skill") == "DEX"
        and event.get("payload", {}).get("pushed") is True
        and event.get("payload", {}).get("skill_check_earned") is False
        for event in campaign_roll_events(run_dir)
    )
    dex_recap_start = rules_recap.index("DEX：艾达·金掷出 44 / 50，结果普通成功。")
    dex_recap_end = rules_recap.find("\n- ", dex_recap_start + 1)
    dex_recap = rules_recap[dex_recap_start:] if dex_recap_end == -1 else rules_recap[dex_recap_start:dex_recap_end]
    assert "成长标记：否" in dex_recap
    assert "目的：获得《波士顿环球报》剪报档案的查阅许可" in rules_recap
    assert "难度说明：阿蒂·威尔莫特只是普通编辑" in rules_recap
    assert "失败后果：艾达·金会被阿蒂拒绝" in rules_recap
    assert "推骰：是" in rules_recap
    assert "成长标记：是" in rules_recap
    assert "成长标记：否" in rules_recap
    assert "HP 伤害：艾达·金掷出 1D6+2 = 5（骰面 3 + 2），结果造成伤害。" in rules_recap
    assert "目的：床铺袭击闪避失败后结算伤害" in rules_recap
    assert "HP 伤害：艾达·金掷出 1D4+2 = 4（骰面 2 + 2），结果造成伤害。" in rules_recap
    assert "目的：结算地下室推骰搜索失败伤害" in rules_recap
    assert "SAN 损失：6" in rules_recap
    assert "SAN 奖励：艾达·金掷出 1D6 = 4（骰面 4），结果奖励。" in rules_recap
    assert "目的：结局奖励恢复 SAN" in rules_recap
    assert "HP 伤害：艾达·金掷出 5 / 8" not in rules_recap
    assert "HP 伤害：艾达·金掷出 4 / 6" not in rules_recap
    assert "SAN 奖励：艾达·金掷出 4 / 6" not in rules_recap
    assert "POW：沃尔特·科比特掷出 34 / 90" in rules_recap
    assert "规则引用：core.percentile_check, core.success_level, core.difficulty.regular" in rules_recap
    assert "module.haunting.corbitt_own_dagger" in rules_recap
    assert "Persuade：" not in rules_recap
    assert "Library Use：" not in rules_recap
    assert "Spot Hidden：" not in rules_recap
    assert "Dodge：" not in rules_recap
    assert "gain access to" not in rules_recap
    assert "clipping files" not in rules_recap
    assert "obstructive but ordinary editor" not in rules_recap
    assert " would " not in rules_recap
    assert "Goal:" not in rules_recap
    assert "Failure Consequence:" not in rules_recap
    assert "Pushed Roll:" not in rules_recap
    assert "推骰：yes" not in rules_recap
    assert "成长标记：yes" not in rules_recap
    assert "成长标记：no" not in rules_recap
    assert "ada-king-haunting rolled" not in rules_recap
    mechanical_log = section_text(battle_text, "## Mechanical Log")
    assert "规则引用：core.percentile_check, core.success_level, core.difficulty.regular" in mechanical_log
    assert "module.haunting.corbitt_own_dagger" in mechanical_log
    assert "Goal:" not in mechanical_log
    assert "Difficulty Rationale:" not in mechanical_log
    assert "Failure Consequence:" not in mechanical_log
    assert "Skill Check Earned:" not in mechanical_log
    assert "Rule Refs:" not in mechanical_log
    roll_event_count = len(campaign_roll_events(run_dir))
    assert bullet_count(rules_recap) == roll_event_count
    assert detail_count(rules_recap, "目的") == roll_event_count
    assert detail_count(rules_recap, "难度说明") == roll_event_count
    assert detail_count(rules_recap, "失败后果") == roll_event_count
    story_recap = section_text(battle_text, "## Story Recap")
    assert has_cjk(story_recap)
    assert "session-1:" not in story_recap
    feedback = section_text(battle_text, "## Player Feedback On KP")
    assert has_cjk(feedback)
    assert_feedback_labels_localized(
        feedback,
        ["KP 清晰度 5/5", "沉浸感 4/5", "模组忠实度 4/5", "战斗可读性 4/5"],
        [
            "kp_clarity:",
            "immersion:",
            "module_fidelity:",
            "combat_readability:",
            "KP 清晰度: 5 -",
        ],
    )
    assert "玩家反馈：“KP 在重要检定前说明了目标、风险和后果。”" in feedback
    assert "清单" in feedback
    assert "checklist" not in feedback
    assert "playtest" not in feedback
    glossary = metadata["localized_terms"]["zh-Hans"]
    for canonical in ["Mr. Knott", "Arty Wilmot", "Chapel of Contemplation", "Bed Attack", "The Floating Knife"]:
        assert canonical in glossary
        assert glossary[canonical] in battle_text
        assert canonical not in battle_text
    assert "线索资料 2" in battle_text
    assert zh_terms["The Old Corbitt Place"] in battle_text
    assert zh_terms["Corbitt's Hiding Place"] in battle_text
    assert zh_terms["Corbitt Attacks"] in battle_text
    combat_summary = section_text(battle_text, "## Combat Summary")
    assert "奖励" in battle_text
    assert "临时疯狂" in battle_text
    bout_visible_sections = "\n".join(
        section_text(battle_text, heading)
        for heading in ["## Scene-by-Scene Replay", "## Actual Play Replay", "## Session Transcript", "## Sanity Summary"]
    )
    assert "疯狂发作" in bout_visible_sections
    assert "Bout of Madness" not in bout_visible_sections
    assert "Summary 疯狂" not in bout_visible_sections
    assert "改用 Summary" not in bout_visible_sections
    assert "1D10 掷出 4" in battle_text
    assert "1D10 小时掷出 1" in battle_text
    assert "临时疯狂底层状态" in battle_text
    assert "若在 1 小时内再次损失 SAN，会再次触发疯狂发作" in battle_text
    assert "摘要表" in battle_text
    assert "疯狂发作第 1 回合" not in battle_text
    assert "艾达·金独处在地下室" in battle_text
    assert "Bout summary episodes: 1" in audit_text
    assert "Bout duration rolls: 1" in audit_text
    assert "战斗轮" in battle_text
    assert "combat round" not in combat_summary
    assert "- KP:" not in combat_summary
    assert "ada-king-haunting:" not in combat_summary
    assert "- 艾达·金:" not in combat_summary
    assert "艾达·金: 艾达·金" not in combat_summary
    assert "- 艾达·金用借助外套战技抓住浮空匕首" in combat_summary
    assert "in a 战斗轮" not in combat_summary
    assert "DEX order" not in combat_summary
    assert "opposed POW" not in combat_summary
    assert "DEX 顺序" in combat_summary
    assert "POW 对抗" in combat_summary
    sanity_summary = section_text(battle_text, "## Sanity Summary")
    assert "- KP:" not in sanity_summary
    assert "ada-king-haunting:" not in sanity_summary
    assert_player_readable_actor_colon_prefixes_absent(sanity_summary, ["艾达·金"])
    assert "艾达·金: 艾达·金" not in sanity_summary
    assert "- 艾达·金因床铺袭击失败 SAN 1/1D4" in sanity_summary
    assert "- 科比特起身时艾达·金失败 SAN 1/1D8" in sanity_summary
    assert "- 疯狂发作（摘要）：艾达·金独处在地下室" in sanity_summary
    assert "摘要表" in sanity_summary
    assert "结果解释为暴力" in sanity_summary
    assert "控制权回到玩家" in sanity_summary
    assert "KP 暂时不接受玩家的主动攻击宣告" not in bout_visible_sections
    assert "KP 暂时不接受玩家的主动攻击宣告" not in visible_dialogue
    assert "醒来时左轮落在角落" in bout_visible_sections
    state_changes = section_text(battle_text, "### State Changes")
    story_recap = section_text(battle_text, "## Story Recap")
    assert_player_readable_state_ids_absent(
        state_changes,
        ["knott-hiring", "arty-clipping", "corbitt-will", "bed-attack", "corbitt-defeated"],
    )
    assert_player_readable_event_prefixes_absent(
        state_changes,
        ["scene", "clue", "damage", "sanity", "combat", "bout of madness", "status", "session ending"],
    )
    assert "worm-eaten book" not in state_changes
    assert "worm-eaten book" not in story_recap
    assert "虫蛀书" in state_changes
    assert "造成伤害: 5 HP" not in battle_text
    assert "造成艾达·金 5 HP 伤害" in battle_text
    assert "Damage: 5 HP" not in battle_text
    assert "最终 HP: 3" in battle_text
    assert "最终 SAN: 49" in battle_text
    assert "Player Feedback On KP" in battle_text
    assert "模组忠实度 4/5" in battle_text
    assert "No combat summary recorded." not in battle_text
    chase_summary = section_text(battle_text, "## Chase Summary")
    assert "- KP:" not in chase_summary
    assert "本模组不包含必需追逐场景" in chase_summary
    assert "追逐子系统覆盖留到独立场景" in chase_summary
    assert "本模组不包含必需追逐场景（本模组不包含必需追逐场景）" not in chase_summary
    assert "The Haunting does not include a required chase sequence" not in chase_summary
    assert "chase subsystem coverage deferred to separate scenario" not in chase_summary
    assert "No chase summary recorded." not in battle_text
    assert "Session ending not recorded." not in battle_text
    handouts = section_text(battle_text, "## Handouts")
    assert "线索资料 1：诺特先生的委托" in handouts
    assert "钥匙、地址、20 美元预付款，以及先查公共记录的委托前提" in handouts
    assert "线索资料 2：未刊登的《波士顿环球报》报道" in handouts
    assert "事故、疾病、自杀和马卡里奥一家逃离的剪报记录" in handouts
    assert "线索资料 7：教堂遗嘱执行人记录" in handouts
    assert "遗嘱执行人指向迈克尔·托马斯牧师和沉思教堂" in handouts
    assert "handout-1" not in handouts
    clues_found = section_text(battle_text, "## Clues Found")
    assert_player_readable_state_ids_absent(
        clues_found,
        ["globe-clipping", "chapel-journal", "corbitt-dagger", "own-weapon-clue"],
    )
    assert bullet_count(major_decisions) >= 5
    assert "{'" not in battle_text
    assert "'}" not in battle_text


def test_chase_drill_harness_generates_auditable_chase_report(tmp_path):
    run_dir = coc_playtest_harness.create_chase_drill_run(tmp_path, run_id="chase-drill")

    audit = coc_playtest_audit.audit_run(run_dir)
    battle_text = (run_dir / "artifacts" / "battle-report.md").read_text()
    evaluation_text = (run_dir / "artifacts" / "evaluation-report.md").read_text()
    audit_text = (run_dir / "artifacts" / "rulebook-audit.md").read_text()
    metadata = playtest_metadata(run_dir)
    zh_terms = {
        "Ada King": "艾达·金",
        "Nathaniel Crowe": "内森尼尔·克劳",
    }
    visible_scene_terms = {
        "print shop roof": "印刷店屋顶",
        "print-shop roof": "印刷店屋顶",
        "rain gutter": "雨水槽",
        "slick skylight hazard": "湿滑天窗危险点",
        "slick skylight": "湿滑天窗",
        "skylight": "天窗",
        "locked roof door barrier": "上锁屋顶门障碍",
        "roof door": "屋顶门",
        "laundry sheets": "晾衣布单",
        "laundry roof": "晾衣屋顶",
        "key ring": "钥匙串",
        "two locations": "两个位置",
    }

    assert audit["result"] == "pass"
    assert "Evidence:" in evaluation_text
    assert "## Future Enhancements" in evaluation_text
    assert "## Recommended Fixes\n- No fixes recorded." in evaluation_text
    assert "live LLM-vs-KP chase stress test" in evaluation_text
    assert "PASS" in audit_text
    assert_zh_hans_locale(metadata, zh_terms | visible_scene_terms | ZH_SKILL_TERMS)
    assert metadata["localized_terms"]["zh-Hans"]["Antiquarian"] == "古物学者"
    assert metadata["player_profiles_tested"] == [
        "reckless_investigator",
        "skeptical_rules_lawyer",
        "genre_savvy_player",
    ]
    assert metadata["player_profile_labels"]["zh-Hans"] == {
        "reckless_investigator": "鲁莽调查员",
        "skeptical_rules_lawyer": "规则质疑玩家",
        "genre_savvy_player": "类型片熟手",
    }
    assert_localized_report_shell(battle_text)
    state_changes = section_text(battle_text, "### State Changes")
    source_summaries = [
        event["payload"]["summary"].strip()
        for event in campaign_state_events(run_dir)
        if isinstance(event.get("payload"), dict)
        and isinstance(event["payload"].get("summary"), str)
        and event["payload"]["summary"].strip()
    ]
    assert source_summaries
    for summary in source_summaries:
        assert summary in state_changes
    run_setup = section_text(battle_text, "## Run Setup")
    assert "- 游玩语言: 简体中文" in run_setup
    assert "- 游玩语言: zh-Hans" not in run_setup
    assert "本地化术语: " in run_setup
    assert_run_setup_values_localized(run_setup, "鲁莽调查员")
    assert "Ada King -> 艾达·金" not in run_setup
    assert "Nathaniel Crowe -> 内森尼尔·克劳" not in run_setup
    assert "ledger -> 账本" not in run_setup
    assert len(run_setup.splitlines()) <= 10
    assert "## 本地化附录 <!-- report-anchor: Localization Appendix -->" not in battle_text
    assert "<!-- report-anchor: Localization Appendix -->" not in battle_text
    assert "Ada King -> 艾达·金" not in battle_text
    assert "Nathaniel Crowe -> 内森尼尔·克劳" not in battle_text
    assert "ledger -> 账本" not in battle_text
    module_section = section_text(battle_text, "## Module")
    visible_module_section = visible_markdown_text(module_section)
    assert "scenario-id: rooftop-chase-drill" in battle_text
    assert "模组 ID:" not in visible_module_section
    assert "rooftop-chase-drill" not in visible_module_section
    assert_module_metadata_values_localized(
        run_setup,
        module_section,
        campaign="屋顶上的账本",
        scenario="屋顶上的账本",
        source="《守秘人规则书》第 7 章追逐场景",
        forbidden=[
            "Campaign: Rooftop Chase Drill",
            "Scenario: Rooftop Chase Drill",
            "internal drill based on Keeper Rulebook Chapter 7: Chases",
        ],
    )
    story_facing_setup = run_setup + "\n" + module_section
    assert "屋顶追逐演练" not in story_facing_setup
    assert "内部演练" not in story_facing_setup
    assert "追逐场景" in story_facing_setup
    assert "- 开场场景: 艾达·金" in battle_text
    assert "艾达·金发现内森尼尔·克劳带着账本离开印刷店" in module_section
    assert "ledger" not in module_section
    assert "spots" not in module_section
    assert "leaving" not in module_section
    assert "- 艾达·金" in battle_text
    assert "investigator-id: ada-king-chase" in battle_text
    character_dossier = section_text(battle_text, "## Character Dossier")
    visible_character_dossier = visible_markdown_text(character_dossier)
    assert_localized_character_dossier_labels(character_dossier)
    assert "(ada-king-chase)" not in visible_character_dossier
    assert "描述: 艾达·金" in character_dossier
    assert "信念/理念: 线索必须在行动前被核实" in character_dossier
    assert "重要之人: 莱兰·哈特教授" in character_dossier
    assert "重要地点: 印刷店屋顶" in character_dossier
    assert "珍贵物品: 裂柄铜放大镜" in character_dossier
    assert "特质: 观察细致" in character_dossier
    assert "Ada King" not in character_dossier
    assert "侦查: 55" in character_dossier
    assert "闪避: 35" in character_dossier
    assert "锁匠: 30" in character_dossier
    assert "潜行: 45" in character_dossier
    assert "Spot Hidden: 55" not in character_dossier
    assert "Dodge: 35" not in character_dossier
    assert "Locksmith: 30" not in character_dossier
    assert "Stealth: 45" not in character_dossier
    assert_creation_allocation_matches_character(run_dir, "ada-king-chase")
    assert_view_streams_separated(run_dir, ["secret-warehouse"])
    assert_player_view_roll_outcomes_localized(run_dir)
    assert_player_view_public_state_localized(run_dir)
    assert_player_view_transcript_speakers_localized(run_dir)
    assert_player_view_transcript_details_localized(run_dir)
    assert_player_view_text_strips_protocol_wrappers(run_dir)
    assert_player_view_localized_text_values_localized(run_dir)
    assert_player_profile_displays_localized(run_dir)
    assert_pushed_roll_protocol(run_dir, ["chase-ledger-confirmation-push"])
    assert investigator_jsonl(run_dir, "ada-king-chase", "history.jsonl")
    assert investigator_jsonl(run_dir, "ada-king-chase", "development.jsonl")
    chronicle = section_text(battle_text, "## Investigator Chronicle")
    assert_localized_chronicle_labels(chronicle)
    assert "艾达·金带着邪教账本逃脱" in chronicle
    assert "最终 HP: 12" in chronicle
    assert "最终 SAN: 55" in chronicle
    assert "获得成长标记: 侦查; 闪避; 锁匠; 潜行" in chronicle
    assert "继承备注: 账本线索可带入后续模组" in chronicle
    transfer_events = campaign_events_by_type(run_dir, "item_transfer")
    assert len(transfer_events) == 1
    transfer_payload = transfer_events[0]["payload"]
    assert transfer_payload["item_id"] == "cult-ledger"
    assert transfer_payload["from_actor"] == "nathaniel-crowe"
    assert transfer_payload["to_actor"] == "ada-king-chase"
    assert transfer_payload["source_turn"] == 7
    assert transfer_payload["chase_id"] == "rooftop-chase"
    assert "<!-- report-anchor: Scene-by-Scene Replay -->" in battle_text
    scene_replay = section_text(battle_text, "## Scene-by-Scene Replay")
    assert has_cjk(scene_replay)
    assert bullet_count(scene_replay) >= significant_scene_replay_count(run_dir)
    assert transfer_payload["localized_text"]["zh-Hans"]["summary"] in scene_replay
    assert_player_readable_state_ids_absent(scene_replay, ["print-shop-roof", "ledger-clue"])
    assert_player_readable_event_prefixes_absent(scene_replay, ["chase", "session ending"])
    assert "ada-king-chase -" not in scene_replay
    assert_player_readable_actor_dash_prefixes_absent(scene_replay, ["艾达·金"])
    assert "艾达·金在印刷店屋顶发现内森尼尔·克劳" in scene_replay
    assert "艾达·金的闪避成功，穿过湿滑天窗且没有损失移动行动。" in scene_replay
    assert "内森尼尔·克劳也通过闪避穿过湿滑天窗危险点，逼近到上锁屋顶门。" in scene_replay
    assert "艾达·金用锁匠通过上锁屋顶门障碍，到达晾衣屋顶。" in scene_replay
    assert "艾达·金的潜行胜过内森尼尔·克劳失败的侦查，带着账本结束追逐。" in scene_replay
    assert "最终追逐状态：艾达·金保持 HP 12、SAN 55、MOV 8，并带走邪教账本；内森尼尔·克劳落后一处位置。" in scene_replay
    assert "艾达·金带着邪教账本脱离屋顶" in scene_replay
    assert "Final 追逐状态" not in scene_replay
    assert "save/chase.json" not in scene_replay
    assert "rooftops" not in scene_replay
    assert "location" not in scene_replay
    assert "湿滑天窗" in scene_replay
    assert_terms_absent(scene_replay, ["print shop roof", "print-shop roof", "rain gutter", "locked roof door barrier", "slick 天窗"])
    assert "<!-- report-anchor: Actual Play Replay -->" in battle_text
    actual_play = section_text(battle_text, "## Actual Play Replay")
    assert_visible_terms_localized(actual_play, zh_terms)
    assert_localized_transcript_chrome(actual_play)
    assert_transcript_detail_values_localized(
        actual_play,
        ["确认被偷走的账本", "推骰确认账本", "建立追逐", "通过障碍并躲藏"],
        ["spot the stolen ledger", "push ledger confirmation", "chase_setup", "pass barrier and hide"],
    )
    assert "第 4 轮 系统: 侦查：艾达·金掷出 82 / 55，结果失败。" in actual_play
    assert "第 9 轮 系统: CON：艾达·金掷出 42 / 55，结果成功。MOV 保持 8。" in actual_play
    assert "第 16a 轮 系统: 闪避：内森尼尔·克劳掷出 27 / 30，结果普通成功。内森尼尔·克劳穿过湿滑天窗危险点，追到上锁屋顶门。" in actual_play
    assert "第 18 轮 系统: 闪避：艾达·金掷出 19 / 35，结果普通成功；格斗（斗殴）：内森尼尔·克劳掷出 62 / 45，结果失败。内森尼尔·克劳的短棍攻击落空。" in actual_play
    assert "第 20 轮 系统: 锁匠：艾达·金掷出 21 / 30，结果普通成功；潜行：艾达·金掷出 18 / 45，结果困难成功；侦查：内森尼尔·克劳掷出 77 / 40，结果失败。艾达·金带着账本逃脱。" in actual_play
    assert "Pushed Spot Hidden 33" not in actual_play
    assert "MOV remains" not in actual_play
    assert "extreme_success" not in actual_play
    assert "玩家[鲁莽调查员]" in actual_play
    assert "玩家[规则质疑玩家]" in actual_play
    assert "玩家[类型片熟手]" in actual_play
    assert "追逐内部为什么不让推骰" in actual_play
    assert "MOV 差值怎么变成移动行动" in actual_play
    assert "我是不是能猜到他会在屋顶门后设伏" in actual_play
    assert "这接近剧透推断" in actual_play
    assert "Player[reckless_investigator]" not in actual_play
    assert "Player[skeptical_rules_lawyer]" not in actual_play
    assert "Player[genre_savvy_player]" not in actual_play
    assert "to 建立追逐" not in actual_play
    assert "after 被追者逃脱" not in actual_play
    session_transcript = section_text(battle_text, "## Session Transcript")
    assert_localized_transcript_chrome(session_transcript)
    assert_transcript_detail_values_localized(
        session_transcript,
        ["确认被偷走的账本", "推骰确认账本", "建立追逐", "通过障碍并躲藏"],
        ["spot the stolen ledger", "push ledger confirmation", "chase_setup", "pass barrier and hide"],
    )
    assert "第 4 轮 系统: 侦查：艾达·金掷出 82 / 55，结果失败。" in session_transcript
    assert "第 9 轮 系统: CON：艾达·金掷出 42 / 55，结果成功。MOV 保持 8。" in session_transcript
    assert "第 16a 轮 系统: 闪避：内森尼尔·克劳掷出 27 / 30，结果普通成功。内森尼尔·克劳穿过湿滑天窗危险点，追到上锁屋顶门。" in session_transcript
    assert "Pushed Spot Hidden 33" not in session_transcript
    assert "MOV remains" not in session_transcript
    assert "extreme_success" not in session_transcript
    assert "玩家[规则质疑玩家]" in session_transcript
    assert "玩家[类型片熟手]" in session_transcript
    assert "to 建立追逐" not in session_transcript
    assert "after 被追者逃脱" not in session_transcript
    visible_dialogue = "\n".join(visible_play_texts(run_dir))
    assert_visible_terms_localized(visible_dialogue, visible_scene_terms)
    assert_terms_absent(
        visible_dialogue,
        [
            "Regular difficulty",
            "pushed roll",
            "pushed rolls",
            "speed roll",
            "location chain",
            "movement action",
            "movement actions",
            "quarry",
            "pursuer",
            "chase",
        ],
    )
    assert "难度普通" not in visible_dialogue
    assert "普通难度" in visible_dialogue
    assert "推骰" in visible_dialogue
    assert "速度检定" in visible_dialogue
    assert "位置链" in visible_dialogue
    assert "移动行动" in visible_dialogue
    assert "被追者" in visible_dialogue
    assert "追赶者" in visible_dialogue
    assert all("Ada King" not in text for text in visible_play_texts(run_dir))
    assert all("Nathaniel Crowe" not in text for text in visible_play_texts(run_dir))
    assert all("ledger" not in text for text in visible_play_texts(run_dir))
    assert all(has_cjk(text) for text in visible_play_texts(run_dir))
    chase_decisions = section_text(battle_text, "## Major Player Decisions")
    assert has_cjk(chase_decisions)
    assert " chose " not in chase_decisions
    assert "ada-king-chase:" not in chase_decisions
    assert "艾达·金:" not in chase_decisions
    assert "艾达·金: 艾达·金" not in chase_decisions
    assert "push ledger confirmation roll" not in chase_decisions
    assert "ledger" not in chase_decisions
    assert "艾达·金冒着被发现的风险继续观察" in chase_decisions
    assert "是否带着账本" in chase_decisions
    decision_events = campaign_events_by_type(run_dir, "decision")
    required_decision_kinds = {
        "pushed_confirmation",
        "objective_take",
        "hazard_choice",
        "barrier_hide",
    }
    assert {
        event.get("payload", {}).get("decision_kind")
        for event in decision_events
    } >= required_decision_kinds
    assert bullet_count(chase_decisions) >= len(required_decision_kinds)
    for event in decision_events:
        summary = event.get("payload", {}).get("summary")
        if summary:
            assert summary in chase_decisions
    rules_recap = section_text(battle_text, "## Rules & Rolls Recap")
    assert has_cjk(rules_recap)
    assert "侦查：艾达·金掷出 82 / 55，结果失败。" in rules_recap
    assert "CON：艾达·金掷出 42 / 55，结果成功。" in rules_recap
    assert "CON：内森尼尔·克劳掷出 9 / 50，结果极难成功。" in rules_recap
    assert "速度检定" in rules_recap
    assert "移动行动" in rules_recap
    assert "被追者逃脱" in rules_recap
    assert "邪教账本" in rules_recap
    assert "确认内森尼尔·克劳行动前是否带着邪教账本" in rules_recap
    assert "步行追逐使用 CON 作为速度检定" in rules_recap
    assert "艾达·金的 MOV 会在本次追逐中降低 1" in rules_recap
    assert "推骰：是" in rules_recap
    assert "成长标记：是" in rules_recap
    assert "成长标记：否" in rules_recap
    assert "规则引用：core.percentile_check, core.success_level, core.difficulty.regular, core.chase.movement_actions" in rules_recap
    assert "Spot Hidden：" not in rules_recap
    assert "Dodge：" not in rules_recap
    assert "Locksmith：" not in rules_recap
    assert "Stealth：" not in rules_recap
    assert "confirm " not in rules_recap
    assert "before acting" not in rules_recap
    assert "On-foot chases" not in rules_recap
    assert " would " not in rules_recap
    assert "Goal:" not in rules_recap
    assert "Failure Consequence:" not in rules_recap
    assert "推骰：yes" not in rules_recap
    assert "成长标记：yes" not in rules_recap
    assert "成长标记：no" not in rules_recap
    assert "ada-king-chase rolled" not in rules_recap
    assert "nathaniel-crowe rolled" not in rules_recap
    mechanical_log = section_text(battle_text, "## Mechanical Log")
    assert "规则引用：core.percentile_check, core.success_level, core.difficulty.regular, core.chase.movement_actions" in mechanical_log
    assert "Goal:" not in mechanical_log
    assert "Difficulty Rationale:" not in mechanical_log
    assert "Failure Consequence:" not in mechanical_log
    assert "Skill Check Earned:" not in mechanical_log
    assert "Rule Refs:" not in mechanical_log
    roll_event_count = len(campaign_roll_events(run_dir))
    assert bullet_count(rules_recap) == roll_event_count
    assert detail_count(rules_recap, "目的") == roll_event_count
    assert detail_count(rules_recap, "难度说明") == roll_event_count
    assert detail_count(rules_recap, "失败后果") == roll_event_count
    state_changes = section_text(battle_text, "### State Changes")
    assert_player_readable_state_ids_absent(state_changes, ["print-shop-roof", "ledger-clue"])
    assert_player_readable_event_prefixes_absent(
        state_changes,
        ["scene", "decision", "clue", "chase", "status", "session ending"],
    )
    assert "ada-king-chase -" not in state_changes
    assert "save/chase.json" not in state_changes
    story_recap = section_text(battle_text, "## Story Recap")
    assert has_cjk(story_recap)
    assert "session-1:" not in story_recap
    assert "save/chase.json" not in story_recap
    assert "屋顶追逐" in story_recap
    assert "rooftop 追逐" not in story_recap
    feedback = section_text(battle_text, "## Player Feedback On KP")
    assert has_cjk(feedback)
    assert_feedback_labels_localized(
        feedback,
        ["KP 清晰度 5/5", "追逐可读性 5/5", "沉浸感 4/5", "超游质量 5/5", "剧透安全 5/5"],
        ["kp_clarity:", "chase_readability:", "immersion:", "KP 清晰度: 5 -"],
    )
    assert "鲁莽调查员反馈：“我能看懂每个人在位置链的位置，也知道被追者为什么逃脱。”" in feedback
    assert "规则质疑玩家反馈：“KP 把 MOV、移动行动和追逐内不能推骰的边界解释清楚。" in feedback
    assert "类型片熟手反馈：“KP 没有直接确认我的剧透猜测" in feedback
    assert "reckless_investigator:" not in feedback
    assert "skeptical_rules_lawyer:" not in feedback
    assert "genre_savvy_player:" not in feedback
    assert "规则裁定" in feedback
    assert "rule decisions" not in feedback
    assert "escapes" not in feedback
    assert "逃脱" in feedback
    assert "chase-state-file: save/chase.json" in battle_text
    assert "save/chase.json" not in visible_markdown_text(battle_text)
    assert "save/追逐.json" not in battle_text
    assert "Chase Summary" in battle_text
    chase_summary = section_text(battle_text, "## Chase Summary")
    assert "save/chase.json" not in chase_summary
    assert "- KP:" not in chase_summary
    assert "ada-king-chase:" not in chase_summary
    assert_player_readable_actor_colon_prefixes_absent(chase_summary, ["艾达·金"])
    assert "- 艾达·金的闪避成功，穿过湿滑天窗且没有损失移动行动。" in chase_summary
    assert "- 内森尼尔·克劳也通过闪避穿过湿滑天窗危险点，逼近到上锁屋顶门。" in chase_summary
    assert "- 艾达·金用锁匠通过上锁屋顶门障碍，到达晾衣屋顶。" in chase_summary
    assert "- 艾达·金的潜行胜过内森尼尔·克劳失败的侦查，带着账本结束追逐。" in chase_summary
    assert "<!-- report-anchor: Chase Tracker -->" in battle_text
    chase_tracker = section_text(battle_text, "## Chase Tracker")
    import json

    chase_state = json.loads((run_dir / "sandbox" / ".coc" / "campaigns" / "chase-drill" / "save" / "chase.json").read_text())
    assert_chase_round_turns_follow_dex_order(chase_state)
    round_one_turns = chase_state["rounds"][0]["turns"]
    assert {
        turn["actor_id"]: (turn.get("hazard_id"), turn.get("hazard_roll_id"))
        for turn in round_one_turns
        if turn.get("hazard_id") == "slick-skylight"
    } == {
        "ada-king-chase": ("slick-skylight", "chase-ada-skylight-hazard"),
        "nathaniel-crowe": ("slick-skylight", "chase-nathaniel-skylight-hazard"),
    }
    round_two_turns = chase_state["rounds"][1]["turns"]
    ada_escape_turn = next(turn for turn in round_two_turns if turn["actor_id"] == "ada-king-chase")
    assert {
        "barrier_id": ada_escape_turn.get("barrier_id"),
        "barrier_roll_id": ada_escape_turn.get("barrier_roll_id"),
        "hide_attempt_id": ada_escape_turn.get("hide_attempt_id"),
        "hide_roll_id": ada_escape_turn.get("hide_roll_id"),
        "hide_search_actor_id": ada_escape_turn.get("hide_search_actor_id"),
        "hide_search_roll_id": ada_escape_turn.get("hide_search_roll_id"),
    } == {
        "barrier_id": "locked-roof-door",
        "barrier_roll_id": "chase-ada-roof-door-barrier",
        "hide_attempt_id": "laundry-roof-hide",
        "hide_roll_id": "chase-ada-laundry-hide",
        "hide_search_actor_id": "nathaniel-crowe",
        "hide_search_roll_id": "chase-nathaniel-search-hidden-ada",
    }
    nathaniel_search_turn = next(turn for turn in round_two_turns if turn["actor_id"] == "nathaniel-crowe")
    assert {
        "hide_attempt_id": nathaniel_search_turn.get("hide_attempt_id"),
        "search_roll_id": nathaniel_search_turn.get("search_roll_id"),
    } == {
        "hide_attempt_id": "laundry-roof-hide",
        "search_roll_id": "chase-nathaniel-search-hidden-ada",
    }
    chase_position_findings = coc_completion_audit._chase_transcript_position_findings(
        "chase-drill",
        run_dir,
        run_dir / "sandbox" / ".coc" / "campaigns" / "chase-drill",
        metadata,
        battle_text,
    )
    assert chase_position_findings == []
    visible_chase_tracker = visible_markdown_text(chase_tracker)
    assert "chase-id: rooftop-chase" in chase_tracker
    assert "state-file: save/chase.json" in chase_tracker
    assert "- 追逐 ID:" not in visible_chase_tracker
    assert "- 状态文件:" not in visible_chase_tracker
    assert "- 状态: 已解决" in chase_tracker
    assert "- 当前轮数: 2" in chase_tracker
    assert "- DEX 顺序: 艾达·金 -> 内森尼尔·克劳" in chase_tracker
    assert "- 参与者:" in chase_tracker
    assert "- 艾达·金 | 被追者 | MOV 8 -> 8 | DEX 50 | 移动行动 1 | 位置 晾衣屋顶" in chase_tracker
    assert "- 内森尼尔·克劳 | 追赶者 | MOV 8 -> 9 | DEX 45 | 移动行动 2 | 位置 上锁屋顶门" in chase_tracker
    assert "- 位置链:" in chase_tracker
    assert "- 印刷店屋顶 [起点]" in chase_tracker
    assert "- 湿滑天窗 [危险点, 普通, 闪避]" in chase_tracker
    assert "- 上锁屋顶门 [障碍, 普通, 锁匠]" in chase_tracker
    for internal_token in [
        "ada-king-chase",
        "nathaniel-crowe",
        "rooftop-chase",
        "save/chase.json",
        "print-shop-roof",
        "rain-gutter",
        "slick-skylight",
        "locked-roof-door",
        "laundry-roof",
    ]:
        assert internal_token not in visible_chase_tracker
    assert "- 轮次:" in chase_tracker
    assert "- 第 1 轮:" in chase_tracker
    assert "- 第 2 轮:" in chase_tracker
    assert "艾达·金按 DEX 顺序先行动" in chase_tracker
    assert "内森尼尔·克劳随后花费 1 个移动行动穿过同一危险点，再花第 2 个移动行动发动冲突" in chase_tracker
    assert "- 结果: 被追者逃脱" in chase_tracker
    session_ending = section_text(battle_text, "## Session Ending")
    assert "save/chase.json" not in session_ending
    assert "Status: resolved" not in chase_tracker
    assert " | quarry | " not in chase_tracker
    assert " | pursuer | " not in chase_tracker
    assert "actions 1" not in chase_tracker
    assert "position laundry-roof" not in chase_tracker
    assert "Round 1: Nathaniel has" not in chase_tracker
    assert "Outcome: quarry escapes" not in chase_tracker
    assert any(
        "speed roll" in str(event.get("payload", {}).get("goal", ""))
        for event in campaign_roll_events(run_dir)
    )
    assert "速度检定" in battle_text
    assert "MOV" in battle_text
    assert "移动行动" in battle_text
    assert "位置链" in battle_text
    assert "DEX 顺序" in battle_text
    assert "危险点" in battle_text
    assert "障碍" in battle_text
    assert "冲突" in battle_text
    assert "被追者逃脱" in battle_text
    assert "No chase summary recorded." not in battle_text
    clues_found = section_text(battle_text, "## Clues Found")
    assert_player_readable_state_ids_absent(clues_found, ["ledger-clue"])
    inventory_history = investigator_jsonl(run_dir, "ada-king-chase", "inventory-history.jsonl")
    assert inventory_history
    assert "邪教账本" in inventory_history[0]["items"]
    assert "钥匙串" in inventory_history[0]["items"]
    assert (run_dir / "sandbox" / ".coc" / "campaigns" / "chase-drill" / "save" / "chase.json").exists()
    hazard_rolls = [
        event
        for event in campaign_roll_events(run_dir)
        if event.get("payload", {}).get("chase_hazard_id") == "slick-skylight"
    ]
    assert {
        (event.get("actor"), event.get("payload", {}).get("roll_id"))
        for event in hazard_rolls
    } == {
        ("ada-king-chase", "chase-ada-skylight-hazard"),
        ("nathaniel-crowe", "chase-nathaniel-skylight-hazard"),
    }
    linked_escape_rolls = [
        event
        for event in campaign_roll_events(run_dir)
        if event.get("payload", {}).get("chase_barrier_id") == "locked-roof-door"
        or event.get("payload", {}).get("chase_hide_attempt_id") == "laundry-roof-hide"
    ]
    assert {
        (event.get("actor"), event.get("payload", {}).get("roll_id"))
        for event in linked_escape_rolls
    } == {
        ("ada-king-chase", "chase-ada-roof-door-barrier"),
        ("ada-king-chase", "chase-ada-laundry-hide"),
        ("nathaniel-crowe", "chase-nathaniel-search-hidden-ada"),
    }


def test_chase_drill_audit_rejects_thin_major_decision_events(tmp_path):
    import json

    run_dir = coc_playtest_harness.create_chase_drill_run(tmp_path, run_id="chase-drill")
    events_path = run_dir / "sandbox" / ".coc" / "campaigns" / "chase-drill" / "logs" / "events.jsonl"
    events = [
        json.loads(line)
        for line in events_path.read_text().splitlines()
        if line.strip()
    ]
    thin_events = [event for event in events if event.get("type") != "decision"]
    thin_events.insert(
        1,
        {
            "type": "decision",
            "actor": "ada-king-chase",
            "payload": {
                "decision_id": "chase-confirm-ledger-push",
                "decision_kind": "pushed_confirmation",
                "summary": "艾达·金确认继续观察。",
            },
        },
    )
    events_path.write_text(
        "\n".join(json.dumps(event, ensure_ascii=False) for event in thin_events) + "\n"
    )

    audit = coc_playtest_audit.audit_run(run_dir)

    assert audit["result"] == "fail"
    finding_codes = {finding["code"] for finding in audit["findings"]}
    assert "chase_decisions_too_thin" in finding_codes


def test_multi_profile_pressure_run_records_distinct_virtual_players(tmp_path):
    stale_artifacts = tmp_path / ".coc" / "playtests" / "multi-profile-pressure" / "artifacts"
    stale_artifacts.mkdir(parents=True)
    (stale_artifacts / "semantic-eval-request.json").write_text("{}")
    (stale_artifacts / "semantic-eval-result.json").write_text("{}")

    run_dir = coc_playtest_harness.create_multi_profile_pressure_run(tmp_path, run_id="multi-profile-pressure")

    audit = coc_playtest_audit.audit_run(run_dir)
    battle_text = (run_dir / "artifacts" / "battle-report.md").read_text()
    evaluation_text = (run_dir / "artifacts" / "evaluation-report.md").read_text()
    metadata = playtest_metadata(run_dir)

    assert audit["result"] == "pass"
    assert "Evidence:" in evaluation_text
    assert metadata["audit_profile"] == "multi_profile_pressure"
    assert metadata["player_profile"] == "multi_profile_matrix"
    assert metadata["player_profiles_tested"] == [
        "careful_investigator",
        "reckless_investigator",
        "skeptical_rules_lawyer",
    ]
    assert metadata["player_profile_labels"]["zh-Hans"] == {
        "careful_investigator": "谨慎调查员",
        "reckless_investigator": "鲁莽调查员",
        "skeptical_rules_lawyer": "规则质疑玩家",
    }
    inventory_history = investigator_jsonl(run_dir, "ada-king-pressure", "inventory-history.jsonl")
    assert inventory_history
    assert "诺特先生的钥匙" in inventory_history[0]["items"]
    assert "沉思教堂记录线索" in inventory_history[0]["items"]
    assert_zh_hans_locale(metadata, {"Library Use": "图书馆使用", "Spot Hidden": "侦查"})
    actual_play = section_text(battle_text, "## Actual Play Replay")
    session_transcript = section_text(battle_text, "## Session Transcript")
    visible_table_text = actual_play + "\n" + session_transcript
    assert_localized_transcript_chrome(actual_play)
    assert "第 4 轮 系统: 图书馆使用：艾达·金掷出 29 / 60，结果困难成功。" in actual_play
    assert "只用于测试剧透警告流程" not in visible_table_text
    assert "本轮压测到这里结束" not in visible_table_text
    assert "确认。我接受这段剧透；只回答地下室这一点，不要展开后面的触发。" in visible_table_text
    assert "这一幕先收在这里：三个调查方向都留下了后续入口。" in visible_table_text
    assert_transcript_detail_values_localized(
        actual_play,
        ["请求谨慎调查路线", "鲁莽闯入危险", "质疑 KP 裁定", "收束本轮"],
        ["request careful research route", "rush into danger", "challenge keeper ruling", "session_wrap"],
    )
    assert "玩家[谨慎调查员]" in actual_play
    assert "玩家[鲁莽调查员]" in actual_play
    assert "玩家[规则质疑玩家]" in actual_play
    assert "Player[careful_investigator]" not in actual_play
    assert "Player[reckless_investigator]" not in actual_play
    assert "Player[skeptical_rules_lawyer]" not in actual_play
    run_setup = section_text(battle_text, "## Run Setup")
    assert_run_setup_values_localized(run_setup, "多调查风格开局")
    module_section = section_text(battle_text, "## Module")
    visible_module_section = visible_markdown_text(module_section)
    assert "scenario-id: haunting-opening-pressure" in battle_text
    assert "模组 ID:" not in visible_module_section
    assert "haunting-opening-pressure" not in visible_module_section
    assert_module_metadata_values_localized(
        run_setup,
        module_section,
        campaign="科比特宅邸的三条路",
        scenario="《鬼屋》开场分歧",
        source="《克苏鲁的呼唤守秘人规则书》40周年纪念版 PDF",
        forbidden=[
            "Keeper Multi-Profile Pressure Test",
            "The Haunting Opening Pressure Matrix",
            "pdf/Call Of Cthulhu Keeper Rulebook",
        ],
    )
    story_facing_setup = run_setup + "\n" + module_section
    assert "压力测试" not in story_facing_setup
    assert "压力矩阵" not in story_facing_setup
    assert "多玩家画像矩阵" not in story_facing_setup
    assert "科比特宅邸的三条路" in story_facing_setup
    assert "先查房契和旧报纸" in actual_play
    assert "我直接去二楼" in actual_play
    raw_transcript_text = "\n".join(str(event.get("text", "")) for event in transcript_events(run_dir))
    assert "[meta]" in raw_transcript_text
    assert "[spoiler_warning]" in raw_transcript_text
    assert "[meta]" not in visible_table_text
    assert "[/meta]" not in visible_table_text
    assert "[spoiler_warning]" not in visible_table_text
    assert "[/spoiler_warning]" not in visible_table_text
    assert "我想质疑一下" in actual_play
    assert "规则裁定" in actual_play
    character_dossier = section_text(battle_text, "## Character Dossier")
    assert_localized_character_dossier_labels(character_dossier)
    assert "描述: 艾达·金" in character_dossier
    assert "信念/理念: 公开记录比传闻可靠" in character_dossier
    assert "重要之人: 莱兰·哈特教授" in character_dossier
    assert "重要地点: 波士顿档案馆阅览室" in character_dossier
    assert "珍贵物品: 裂柄铜放大镜" in character_dossier
    assert "特质: 谨慎记笔记" in character_dossier
    assert "Ada King" not in character_dossier
    assert "图书馆使用: 60" in character_dossier
    assert "侦查: 55" in character_dossier
    assert "Library Use: 60" not in character_dossier
    assert "Spot Hidden: 55" not in character_dossier
    assert_creation_allocation_matches_character(run_dir, "ada-king-pressure")
    assert_view_streams_separated(run_dir, ["secret-corbitt-body"])
    assert_player_view_roll_outcomes_localized(run_dir)
    assert_player_view_public_state_localized(run_dir)
    assert_player_view_transcript_speakers_localized(run_dir)
    assert_player_view_transcript_details_localized(run_dir)
    assert_player_view_text_strips_protocol_wrappers(run_dir)
    assert_player_view_localized_text_values_localized(run_dir)
    assert_player_profile_displays_localized(run_dir)
    assert_source_transcript_display_text_strips_protocol_wrappers(run_dir)
    assert_pushed_roll_protocol(run_dir, ["pressure-reckless-entry-push"])
    assert_spoiler_reveal_protocol(run_dir, ["pressure-corbitt-basement-reveal"])
    assert investigator_jsonl(run_dir, "ada-king-pressure", "history.jsonl")
    assert investigator_jsonl(run_dir, "ada-king-pressure", "development.jsonl")
    chronicle = section_text(battle_text, "## Investigator Chronicle")
    assert_localized_chronicle_labels(chronicle)
    assert "艾达·金经历了三种调查风格的开局分支" in chronicle
    assert "三种玩家风格压测" not in chronicle
    assert "规则质疑获得独立规则解释" in chronicle
    assert "meta 质疑" not in chronicle
    assert "获得成长标记: 图书馆使用; 侦查" in chronicle
    assert "继承备注: 后续故事入口保留为沉思教堂记录" in chronicle
    scene_replay = section_text(battle_text, "## Scene-by-Scene Replay")
    assert_player_readable_state_ids_absent(
        scene_replay,
        ["knott-office", "deed-note", "fresh-scratches"],
    )
    assert_player_readable_event_prefixes_absent(scene_replay, ["session ending"])
    assert "三个玩家画像都保留了有效选择；KP 已说明不同路线的收益、风险和失败后果。" in scene_replay
    assert "多玩家画像压测结束" not in scene_replay
    assert "本幕收束，后续入口记录为先追查沉思教堂" in scene_replay
    state_changes = section_text(battle_text, "### State Changes")
    assert_player_readable_state_ids_absent(
        state_changes,
        ["knott-office", "deed-note", "fresh-scratches"],
    )
    assert_player_readable_event_prefixes_absent(
        state_changes,
        ["scene", "decision", "clue", "status", "session ending"],
    )
    assert "ada-king-pressure -" not in state_changes
    major_decisions = section_text(battle_text, "## Major Player Decisions")
    assert "规则质疑玩家以超游模式要求 KP 解释不同玩家风格对应的检定和风险" in major_decisions
    assert "meta 模式" not in major_decisions
    clues_found = section_text(battle_text, "## Clues Found")
    assert_player_readable_state_ids_absent(clues_found, ["deed-note", "fresh-scratches"])
    story_recap = section_text(battle_text, "## Story Recap")
    assert has_cjk(story_recap)
    assert "session-1:" not in story_recap
    assert "三个调查风格汇入同一开局" in story_recap
    assert "压测同一 KP" not in story_recap
    assert all(has_cjk(text) for text in visible_play_texts(run_dir))
    feedback = section_text(battle_text, "## Player Feedback On KP")
    assert_feedback_labels_localized(
        feedback,
        ["KP 清晰度 5/5", "自主性 4/5", "超游质量 5/5"],
        ["kp_clarity:", "agency:", "meta_quality:", "KP 清晰度: 5 -"],
    )
    assert "谨慎调查员反馈：“KP 允许我先调查" in feedback
    assert "鲁莽调查员反馈：“KP 没有阻止我冒险" in feedback
    assert "规则质疑玩家反馈：“KP 清楚解释" in feedback
    assert "careful_investigator:" not in feedback
    assert "reckless_investigator:" not in feedback
    assert "skeptical_rules_lawyer:" not in feedback
    assert "No combat summary recorded." not in battle_text
    assert "No chase summary recorded." not in battle_text
    assert "No chase tracker recorded." not in battle_text
    assert "No sanity summary recorded." not in battle_text
    assert "本轮没有触发战斗场面。" in section_text(battle_text, "## Combat Summary")
    assert "本轮没有触发追逐场面。" in section_text(battle_text, "## Chase Summary")
    assert "本轮没有追逐状态需要追踪。" in section_text(battle_text, "## Chase Tracker")
    assert "本轮没有触发理智检定或疯狂事件。" in section_text(battle_text, "## Sanity Summary")
    assert not (run_dir / "artifacts" / "semantic-eval-request.json").exists()
    assert not (run_dir / "artifacts" / "semantic-eval-result.json").exists()
