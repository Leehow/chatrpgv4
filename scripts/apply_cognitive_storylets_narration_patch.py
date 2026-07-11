#!/usr/bin/env python3
"""Apply the cognitive storylet and narration-envelope integration patch.

Temporary, idempotent implementation helper used because the touched runtime
files are large.  It performs exact-marker replacements and fails loudly when
an expected source shape is absent.
"""
from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if new in text:
        return
    if old not in text:
        raise RuntimeError(f"marker not found in {path}: {old[:120]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def patch_storylets() -> None:
    path = ROOT / "plugins/coc-keeper/scripts/coc_storylets.py"

    replace_once(
        path,
        '''_DEFAULT_SERVE_KEYS = {
    "mainline", "can_reveal_clue", "can_tick_front", "can_deepen_npc",
    "can_surface_choice", "can_offer_recovery", "theme",
}

_NEED_DECKS: dict[str, list[str]] = {''',
        '''_DEFAULT_SERVE_KEYS = {
    "mainline", "can_reveal_clue", "can_tick_front", "can_deepen_npc",
    "can_surface_choice", "can_offer_recovery", "theme",
}
_VALID_EPISTEMIC_FUNCTIONS = frozenset({
    "confirm", "expand", "complicate", "reframe", "payoff",
})
_VALID_QUESTION_LAYERS = frozenset({
    "fact", "identity", "method", "motive", "causal", "structure",
    "world", "personal",
})
_EPISTEMIC_FUNCTION_TO_NEED = {
    "confirm": "belief_confirmation",
    "expand": "belief_expansion",
    "complicate": "belief_complication",
    "reframe": "belief_reframe",
    "payoff": "question_payoff",
}

_NEED_DECKS: dict[str, list[str]] = {''',
    )

    replace_once(
        path,
        '''    "transition_bridge": ["transition_bridge", "return_hook"],
    "theme_echo": ["theme_echo", "ambience"],
}''',
        '''    "transition_bridge": ["transition_bridge", "return_hook"],
    "theme_echo": ["theme_echo", "ambience"],
    "belief_confirmation": ["belief_confirmation", "confirm", "clue_reinforcement"],
    "belief_expansion": ["belief_expansion", "expand", "investigation"],
    "belief_complication": ["belief_complication", "complicate", "pressure"],
    "belief_reframe": ["belief_reframe", "reframe", "revelation"],
    "question_payoff": ["question_payoff", "payoff", "resolution"],
}''',
    )

    replace_once(
        path,
        '''def load_storylet_library(path: Path | None = None) -> dict[str, Any]:
    """Load a storylet library JSON, falling back to the packaged default."""''',
        '''def _check_library_epistemic_tags(library: dict[str, Any]) -> None:
    """Validate optional cognitive storylet enums and reframe safety gates."""
    for storylet in library.get("storylets", []) or []:
        if not isinstance(storylet, dict):
            continue
        sid = storylet.get("storylet_id")

        functions_raw = storylet.get("epistemic_functions")
        functions: list[str] = []
        if functions_raw is not None:
            _check_tag_list(sid, "epistemic_functions", functions_raw)
            functions = [str(value).strip().lower() for value in functions_raw]
            unknown = sorted(set(functions) - _VALID_EPISTEMIC_FUNCTIONS)
            if unknown:
                raise ValueError(
                    f"storylet '{sid}' epistemic_functions contains unknown values: {unknown}"
                )

        layers_raw = storylet.get("question_layers")
        if layers_raw is not None:
            _check_tag_list(sid, "question_layers", layers_raw)
            layers = [str(value).strip().lower() for value in layers_raw]
            unknown = sorted(set(layers) - _VALID_QUESTION_LAYERS)
            if unknown:
                raise ValueError(
                    f"storylet '{sid}' question_layers contains unknown values: {unknown}"
                )

        gate = storylet.get("requires_reveal_contract")
        if gate is not None and not isinstance(gate, bool):
            raise ValueError(
                f"storylet '{sid}' requires_reveal_contract must be a boolean"
            )
        if "reframe" in functions and gate is not True:
            raise ValueError(
                f"storylet '{sid}' reframe epistemic_functions requires "
                "requires_reveal_contract=true"
            )


def load_storylet_library(path: Path | None = None) -> dict[str, Any]:
    """Load a storylet library JSON, falling back to the packaged default."""''',
    )

    replace_once(
        path,
        '''    _check_library_setting_tags(library)
    _check_library_context_requirements(library)
    return library''',
        '''    _check_library_setting_tags(library)
    _check_library_context_requirements(library)
    _check_library_epistemic_tags(library)
    return library''',
    )

    replace_once(
        path,
        '''def infer_story_need(plan: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    """Infer the story function that should be served before rolling a card.''',
        '''def _ready_epistemic_effects(plan: dict[str, Any]) -> list[dict[str, Any]]:
    """Return resolved cognitive effects that may drive presentation this turn."""
    contract = plan.get("epistemic_contract")
    if not isinstance(contract, dict):
        return []
    raw = contract.get("resolved_effects")
    if not isinstance(raw, list):
        raw = contract.get("effects")
    if not isinstance(raw, list) or not raw:
        raw = [contract]
    ready: list[dict[str, Any]] = []
    for effect in raw:
        if not isinstance(effect, dict):
            continue
        mode = str(effect.get("mode") or "NONE").strip().lower()
        if mode in _EPISTEMIC_FUNCTION_TO_NEED:
            ready.append(effect)
    return ready


def _epistemic_story_need(plan: dict[str, Any]) -> dict[str, Any] | None:
    contract = plan.get("epistemic_contract")
    if not isinstance(contract, dict):
        return None
    primary_mode = str(contract.get("mode") or "NONE").strip().lower()
    if primary_mode not in _EPISTEMIC_FUNCTION_TO_NEED:
        return None
    effects = _ready_epistemic_effects(plan)
    if not effects:
        return None

    modes: list[str] = []
    layers: list[str] = []
    effect_ids: list[str] = []
    for effect in effects:
        mode = str(effect.get("mode") or "NONE").strip().lower()
        if mode not in modes:
            modes.append(mode)
        layer = _non_empty_str(effect.get("target_layer"))
        if layer and layer not in layers:
            layers.append(layer)
        effect_id = _non_empty_str(effect.get("effect_id"))
        if effect_id and effect_id not in effect_ids:
            effect_ids.append(effect_id)

    need_id = _EPISTEMIC_FUNCTION_TO_NEED[primary_mode]
    return {
        "schema_version": _SCHEMA_VERSION,
        "need_id": need_id,
        "story_functions": [need_id],
        "candidate_decks": list(_NEED_DECKS[need_id]),
        "reason": "resolved_epistemic_contract",
        "source": "story_need_scheduler",
        "epistemic_modes": modes,
        "question_layers": layers,
        "effect_ids": effect_ids,
    }


def infer_story_need(plan: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    """Infer the story function that should be served before rolling a card.''',
    )

    replace_once(
        path,
        '''    else:
        action = plan.get("scene_action")
        signals = (ctx.get("rule_signals") or {}) | (plan.get("rule_signals") or {})''',
        '''    else:
        cognitive_need = _epistemic_story_need(plan)
        if cognitive_need is not None:
            return cognitive_need
        action = plan.get("scene_action")
        signals = (ctx.get("rule_signals") or {}) | (plan.get("rule_signals") or {})''',
    )

    replace_once(
        path,
        '''    for key in ("story_functions", "story_function", "storylet_functions", "plot_functions"):
        for value in _as_list(storylet.get(key)):
            text = _non_empty_str(value)
            if text:
                explicit.add(text)
    if explicit:''',
        '''    for key in ("story_functions", "story_function", "storylet_functions", "plot_functions"):
        for value in _as_list(storylet.get(key)):
            text = _non_empty_str(value)
            if text:
                explicit.add(text)
    for value in _as_list(storylet.get("epistemic_functions")):
        function = str(value).strip().lower()
        need_id = _EPISTEMIC_FUNCTION_TO_NEED.get(function)
        if need_id:
            explicit.add(need_id)
    if explicit:''',
    )

    replace_once(
        path,
        '''def _matches_context(storylet: dict[str, Any], plan: dict[str, Any], ctx: dict[str, Any], target_level: str) -> bool:
    policy = ctx.get("storylet_policy") or {}
    scene = ctx.get("active_scene") or {}
    story_need = ctx.get("story_need") or infer_story_need(plan, ctx)''',
        '''def _matches_epistemic_context(
    storylet: dict[str, Any],
    plan: dict[str, Any],
    story_need: dict[str, Any],
) -> bool:
    functions = {
        str(value).strip().lower()
        for value in _as_list(storylet.get("epistemic_functions"))
        if str(value).strip()
    }
    layers = {
        str(value).strip().lower()
        for value in _as_list(storylet.get("question_layers"))
        if str(value).strip()
    }
    requires_contract = storylet.get("requires_reveal_contract") is True
    if not functions and not layers and not requires_contract:
        return True

    need_modes = {
        str(value).strip().lower()
        for value in _as_list(story_need.get("epistemic_modes"))
        if str(value).strip()
    }
    need_layers = {
        str(value).strip().lower()
        for value in _as_list(story_need.get("question_layers"))
        if str(value).strip()
    }
    if functions and not (functions & need_modes):
        return False
    if layers and not (layers & need_layers):
        return False
    if not requires_contract:
        return True

    for effect in _ready_epistemic_effects(plan):
        mode = str(effect.get("mode") or "NONE").strip().lower()
        layer = str(effect.get("target_layer") or "").strip().lower()
        if functions and mode not in functions:
            continue
        if layers and layer not in layers:
            continue
        if _non_empty_str(effect.get("reveal_contract_id")):
            return True
    return False


def _matches_context(storylet: dict[str, Any], plan: dict[str, Any], ctx: dict[str, Any], target_level: str) -> bool:
    policy = ctx.get("storylet_policy") or {}
    scene = ctx.get("active_scene") or {}
    story_need = ctx.get("story_need") or infer_story_need(plan, ctx)
    if not _matches_epistemic_context(storylet, plan, story_need):
        return False''',
    )


def patch_narration_contract() -> None:
    path = ROOT / "plugins/coc-keeper/scripts/coc_narration_contract.py"

    replace_once(
        path,
        '''from coc_narration_style import (
    guard_player_visible_text,
    player_facing_style_contract as _player_facing_style_contract,
)
''',
        '''from coc_narration_style import (
    guard_player_visible_text,
    player_facing_style_contract as _player_facing_style_contract,
)
import coc_epistemic_narration
''',
    )

    replace_once(
        path,
        '''    clue_graph: dict[str, Any] | None = None,
    active_scene: dict[str, Any] | None = None,
    investigator_display_name: str | None = None,
) -> dict[str, Any]:''',
        '''    clue_graph: dict[str, Any] | None = None,
    epistemic_graph: dict[str, Any] | None = None,
    active_scene: dict[str, Any] | None = None,
    investigator_display_name: str | None = None,
) -> dict[str, Any]:''',
    )

    replace_once(
        path,
        '''    redirection = _sanitize_redirection(plan.get("redirection"))
    if redirection is not None:
        envelope["redirection"] = redirection
    return envelope''',
        '''    belief_update = coc_epistemic_narration.build_belief_update_projection(
        plan.get("epistemic_contract"), epistemic_graph
    )
    if belief_update is not None:
        envelope["belief_update"] = belief_update
    redirection = _sanitize_redirection(plan.get("redirection"))
    if redirection is not None:
        envelope["redirection"] = redirection
    return envelope''',
    )


def patch_library() -> None:
    path = ROOT / "plugins/coc-keeper/references/rules-json/storylet-library.json"
    replace_once(
        path,
        '''      "base_weight": 1.0,
      "dramatic_function": [''',
        '''      "base_weight": 1.0,
      "epistemic_functions": [
        "confirm",
        "expand",
        "complicate"
      ],
      "question_layers": [
        "fact",
        "method",
        "causal",
        "structure"
      ],
      "requires_reveal_contract": false,
      "dramatic_function": [''',
    )
    replace_once(
        path,
        '''      "base_weight": 1.02,
      "dramatic_function": [''',
        '''      "base_weight": 1.02,
      "epistemic_functions": [
        "confirm",
        "expand",
        "complicate"
      ],
      "question_layers": [
        "identity",
        "motive",
        "personal"
      ],
      "requires_reveal_contract": false,
      "dramatic_function": [''',
    )


def write_schema() -> None:
    path = (
        ROOT
        / "plugins/coc-keeper/skills/coc-scenario-import/references/storylet-schema.md"
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    content = '''# Storylet Schema Addendum: Cognitive Functions

Storylets remain presentation devices. They may change delivery, emphasis,
pressure, cost, or framing, but must never invent a culprit, faction, god,
motive, or final truth.

## Optional cognitive fields

```json
{
  "epistemic_functions": ["confirm", "complicate"],
  "question_layers": ["fact", "motive"],
  "requires_reveal_contract": false
}
```

`epistemic_functions` accepts only `confirm`, `expand`, `complicate`,
`reframe`, and `payoff`.

`question_layers` accepts only `fact`, `identity`, `method`, `motive`,
`causal`, `structure`, `world`, and `personal`.

A storylet tagged with `reframe` must set
`requires_reveal_contract: true`. At runtime it is eligible only when a
matching resolved effect carries a non-empty `reveal_contract_id`. `HOLD` and
`NONE` contracts never summon cognitive storylets. Legacy storylets without
these fields retain their existing behavior.
'''
    if not path.exists() or path.read_text(encoding="utf-8") != content:
        path.write_text(content, encoding="utf-8")


def main() -> None:
    patch_storylets()
    patch_narration_contract()
    patch_library()
    write_schema()


if __name__ == "__main__":
    main()
