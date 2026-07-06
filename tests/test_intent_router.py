#!/usr/bin/env python3
"""Tests for coc_intent_router: keyword-based intent parsing."""
import importlib.util

import pytest


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


router = _load("coc_intent_router", "plugins/coc-keeper/scripts/coc_intent_router.py")


def test_investigate_primary():
    r = router.parse_intent("我检查一下门框有没有痕迹")
    assert r["primary_intent"] == "investigate"


def test_social_primary():
    r = router.parse_intent("我去问问邻居昨晚听到了什么")
    assert r["primary_intent"] == "social"
    assert "neighbor" in r["target_entities"]


def test_combat_primary():
    r = router.parse_intent("我攻击那个邪教徒")
    assert r["primary_intent"] == "combat"


def test_meta_detected():
    r = router.parse_intent("[meta] 这个检定用什么技能？")
    assert r["primary_intent"] == "meta"


def test_stuck_detected():
    r = router.parse_intent("我不知道该去哪里")
    assert r["primary_intent"] == "stuck"


def test_compound_intent_with_avoid_risk():
    r = router.parse_intent("我不进去，先绕到后院看看窗户，小心点")
    assert r["primary_intent"] == "investigate"
    assert "avoid_risk" in r["secondary_intents"]
    assert r["risk_posture"] == "cautious"
    assert "backyard" in r["target_entities"]
    assert "window" in r["target_entities"]


def test_compound_with_social_followup():
    r = router.parse_intent("我先检查门，然后再问邻居")
    assert "social_followup" in r["secondary_intents"]


def test_reckless_posture():
    r = router.parse_intent("我直接冲进地下室")
    assert r["risk_posture"] == "reckless"
    assert "basement" in r["target_entities"]


def test_explicit_roll_request():
    r = router.parse_intent("我骰一个 Spot Hidden")
    assert r["explicit_roll_request"] is True


def test_player_hypothesis_extracted():
    r = router.parse_intent("我觉得这房子里有什么东西在看着我们")
    assert r["player_hypothesis"] is not None
    assert "看着" in r["player_hypothesis"] or "东西" in r["player_hypothesis"]


def test_no_hypothesis_returns_none():
    r = router.parse_intent("我检查门")
    assert r["player_hypothesis"] is None


def test_empty_text_defaults_to_idle():
    r = router.parse_intent("")
    assert r["primary_intent"] == "idle"
    assert r["secondary_intents"] == []
    assert r["risk_posture"] == "neutral"


def test_target_entities_from_active_scene():
    scene = {"available_clues": ["clue-door-scratch"], "npc_ids": ["npc-archivist"]}
    r = router.parse_intent("我想看看 clue-door-scratch 和 npc-archivist", active_scene=scene)
    assert "clue-door-scratch" in r["target_entities"]
    assert "npc-archivist" in r["target_entities"]


def test_english_keywords():
    r = router.parse_intent("I want to search the library for old records")
    assert r["primary_intent"] == "investigate"
    assert "archive" in r["target_entities"]
