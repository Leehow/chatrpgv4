"""Language-neutral mechanics projections and the play-language script guard.

System facts stay in JSON. Story text is never required to repeat receipt numbers.
"""

from __future__ import annotations

import re
from typing import Any

from .errors import RpcError, invalid_params
from .text import kebab

PLAY_LANGUAGE_MISMATCH = "play_language_mismatch"

# Same ranges as tests/kernel/test_system_language.py: bytes, not semantics.
CJK = re.compile(
    "["
    "\u2e80-\u2fdf"
    "\u3000-\u303f"
    "\u3040-\u30ff"
    "\u3100-\u31ff"
    "\u3200-\u33ff"
    "\u3400-\u4dbf"
    "\u4e00-\u9fff"
    "\uac00-\ud7af"
    "\uf900-\ufaff"
    "\ufe30-\ufe4f"
    "\uff00-\uffef"
    "\U00020000-\U0003134f"
    "]"
)
# Closed: which play_language tags oblige a CJK character in player-facing delivery.
# `en` is the system language; a script check cannot tell player English from keeper English.
CJK_PLAY_LANGUAGES = frozenset({"zh-Hans"})


def _number(value: Any) -> str:
    """The digits the keeper is expected to copy: an integral float prints as an int."""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _with_label(out: dict[str, Any], key: str, value: Any) -> None:
    if isinstance(value, str) and value.strip():
        out[key] = value


def _with_investigator(out: dict[str, Any], receipt: dict[str, Any], key: str) -> None:
    """Only an explicitly identified investigator has a public mechanics name."""
    flag = f"{key}_is_investigator"
    out[flag] = receipt.get(flag) is True
    if out[flag]:
        out[key] = receipt.get(key)
        _with_label(out, f"{key}_label", receipt.get(f"{key}_label"))


def mechanics_of(receipt: dict[str, Any]) -> dict[str, Any] | None:
    """One §16.2 object for one receipt; None for a receipt kind that has no projection.
    Names (skills, resources, families, outcomes) are the rulebook's English as the
    receipt carries them; labels are the names the keeper or the sheet gave, data not
    language."""
    kind = receipt.get("kind")
    receipt_id = receipt.get("id")
    if kind == "roll":
        if receipt.get("form") == "dice":
            out: dict[str, Any] = {"kind": "dice", "receipt": receipt_id,
                                   "label": receipt.get("skill"), "expression": receipt.get("expression"),
                                   "faces": list(receipt.get("faces") or []), "total": receipt.get("total"),
                                   "visibility": receipt.get("visibility") or "public"}
            _with_investigator(out, receipt, "actor")
            return out
        out = {"kind": "roll", "receipt": receipt_id, "skill": receipt.get("skill"),
               "roll": receipt.get("roll"), "target": receipt.get("target"), "threshold": receipt.get("threshold"),
               "difficulty": receipt.get("difficulty"), "level": receipt.get("level"),
               "passed": bool(receipt.get("passed")), "pushed": bool(receipt.get("pushed")),
               "visibility": receipt.get("visibility") or "public"}
        _with_investigator(out, receipt, "actor")
        return out
    if kind == "delta":
        out = {"kind": "change", "receipt": receipt_id, "resource": receipt.get("resource"),
               "before": receipt.get("before"), "after": receipt.get("after")}
        _with_investigator(out, receipt, "subject")
        return out
    if kind == "move":
        if receipt.get("renamed"):
            # A move to where the party already stands is a naming, not a movement: it has
            # no row, or the card would say they walked from a place to itself.
            return None
        out = {"kind": "scene", "receipt": receipt_id, "from": receipt.get("from"), "to": receipt.get("to"),
               "minutes": int(receipt.get("minutes") or 0)}
        _with_label(out, "from_label", receipt.get("from_label"))
        _with_label(out, "to_label", receipt.get("to_label"))
        return out
    if kind == "clue":
        out = {"kind": "clue", "receipt": receipt_id, "clue": receipt.get("clue")}
        _with_label(out, "label", receipt.get("label"))
        return out
    if kind == "time":
        return {"kind": "time", "receipt": receipt_id, "minutes": int(receipt.get("minutes") or 0)}
    if kind == "item":
        out = {"kind": "item", "receipt": receipt_id, "name": receipt.get("name"),
               "quantity": int(receipt.get("quantity") or 1), "to": receipt.get("subject")}
        _with_label(out, "label", receipt.get("label"))
        _with_label(out, "to_label", receipt.get("subject_label"))
        _with_label(out, "from", receipt.get("from"))
        _with_label(out, "weapon", receipt.get("weapon"))
        return out
    if kind == "cash":
        out = {"kind": "cash", "receipt": receipt_id, "subject": receipt.get("subject"),
               "before": receipt.get("before"), "after": receipt.get("after")}
        _with_label(out, "subject_label", receipt.get("subject_label"))
        _with_label(out, "currency", receipt.get("currency"))
        _with_label(out, "with", receipt.get("with"))
        _with_label(out, "with_label", receipt.get("with_label"))
        return out
    if kind == "session":
        out = {"kind": "session", "receipt": receipt_id, "family": receipt.get("family"),
               "transition": receipt.get("transition")}
        for key in ("round", "rounds"):
            if isinstance(receipt.get(key), int):
                out[key] = receipt[key]
        _with_label(out, "outcome", receipt.get("outcome"))
        return out
    if kind == "choice":
        return {"kind": "choice", "receipt": receipt_id, "option": receipt.get("option")}
    if kind == "worldline":
        # §15.3 said this receipt renders a change line; §16 replaced every such line with
        # a projected row, and this is the row: which line the table moved to, whether it
        # was forked or resumed, and which circuit of the loop it is.
        out = {"kind": "worldline", "receipt": receipt_id, "operation": receipt.get("operation"),
               "line": receipt.get("line"), "mode": receipt.get("mode"), "loop": int(receipt.get("loop") or 0),
               "from_line": (receipt.get("from") or {}).get("line"),
               "from_turn": (receipt.get("from") or {}).get("turn")}
        _with_label(out, "label", receipt.get("label"))
        return out
    if kind == "handout":
        attachment = receipt.get("attachment") if isinstance(receipt.get("attachment"), dict) else {}
        out = {"kind": "handout", "receipt": receipt_id, "name": receipt.get("name") or receipt.get("handout"),
               "available": bool(attachment.get("available"))}
        _with_label(out, "label", receipt.get("label"))
        _with_label(out, "path", attachment.get("path"))
        return out
    return None


#: The `{{marker}}` a keeper may place in a delivery (§16.6). Literal: the prose is never read
#: for meaning, only scanned for this shape.
MARKER = re.compile(r"\{\{([a-z0-9][a-z0-9:_-]*)\}\}")
UNKNOWN_MARKER = "unknown_marker"
DUPLICATE_MARKER = "duplicate_marker"


def _marker_name(receipt: dict[str, Any]) -> str | None:
    """The semantic marker base for one receipt, or None for a receipt that projects nothing.

    Built from the canonical side of the receipt -- the skill's rulebook name, a scene or clue
    handle, a resource -- never from a keeper-authored label, so the token stays ASCII and stable
    whatever language the table plays in. A name that survives no ASCII slug drops to the bare
    kind, which is still a name and still unique after the suffix pass below."""
    kind = receipt.get("kind")
    def part(prefix: str, value: Any) -> str:
        slug = "".join(c for c in kebab(str(value or "")) if c.isascii() and (c.isalnum() or c == "-")).strip("-")
        return f"{prefix}:{slug}" if slug else prefix
    if kind == "roll":
        return part("dice" if receipt.get("form") == "dice" else "check", receipt.get("skill"))
    if kind == "delta":
        return part("change", receipt.get("resource"))
    if kind == "move":
        # A move that only names where the party already stands projects nothing, so it takes no
        # marker: a marker for a row the frontend never receives could never be mounted.
        return None if receipt.get("renamed") else part("scene", receipt.get("to"))
    if kind == "clue":
        return part("clue", receipt.get("clue"))
    if kind == "item":
        return part("item", receipt.get("name"))
    if kind == "handout":
        return part("handout", receipt.get("handout") or receipt.get("name"))
    if kind == "session":
        return part("session", receipt.get("family"))
    if kind == "worldline":
        return part("worldline", receipt.get("operation"))
    if kind in ("time", "cash", "choice"):
        return str(kind)
    return None


def markers_for(receipts: list[dict[str, Any]]) -> dict[str, str]:
    """Receipt id -> its `{{marker}}` (§16.6), for the turn's receipts in order.

    Order is the whole contract here: a marker handed to the keeper after one call must still
    name the same receipt after the next, and a turn's receipt list only ever grows at the end,
    so walking it in order and suffixing later collisions keeps every earlier marker fixed."""
    out: dict[str, str] = {}
    taken: dict[str, int] = {}
    for receipt in receipts:
        base = _marker_name(receipt)
        receipt_id = receipt.get("id")
        if base is None or not isinstance(receipt_id, str) or mechanics_of(receipt) is None:
            continue
        taken[base] = taken.get(base, 0) + 1
        out[receipt_id] = base if taken[base] == 1 else f"{base}-{taken[base]}"
    return out


def placed_markers(text: str) -> list[str]:
    """Every marker in a delivery, in the order it appears, repeats included."""
    return [match.group(1) for match in MARKER.finditer(text or "")]


def strip_markers(text: str) -> str:
    """The delivery a text consumer reads (§16.6): markers removed, nothing put in their place.

    Whitespace around a removed marker is collapsed so a marker on its own between two sentences
    does not leave a double space; nothing else about the prose is touched."""
    without = MARKER.sub("", text or "")
    return re.sub(r"[ \t]{2,}", " ", without).strip()


def bind_markers(text: str, receipts: list[dict[str, Any]]) -> dict[str, str]:
    """Marker -> receipt id for the markers this delivery placed (§16.6).

    Raises on a marker naming no receipt of this turn, and on the same marker placed twice: prose
    asserting a mechanic that has no receipt is the §16.3 family of error, and a receipt happened
    once. A receipt nobody placed is not an error and simply does not appear here."""
    available = {marker: receipt_id for receipt_id, marker in markers_for(receipts).items()}
    seen: dict[str, str] = {}
    duplicates: list[str] = []
    unknown: list[str] = []
    for marker in placed_markers(text):
        if marker not in available:
            if marker not in unknown:
                unknown.append(marker)
            continue
        if marker in seen:
            if marker not in duplicates:
                duplicates.append(marker)
            continue
        seen[marker] = available[marker]
    if unknown:
        raise invalid_params(f"no receipt in this turn is named by {', '.join(unknown)}",
                             fix="place only the markers resolve and apply handed back, or none",
                             details={"unknown": unknown, "markers": sorted(available)},
                             code_detail=UNKNOWN_MARKER)
    if duplicates:
        raise invalid_params(f"{', '.join(duplicates)} is placed more than once",
                             fix="a receipt happened once: place its marker at one point in the text",
                             details={"duplicate": duplicates},
                             code_detail=DUPLICATE_MARKER)
    return seen


def mechanics(receipts: list[dict[str, Any]], placed: dict[str, str] | None = None) -> list[dict[str, Any]]:
    """The turn's receipts in order, one object each (§16.2).

    `placed` is marker -> receipt id from the delivery (§16.6); a row whose receipt was placed
    carries its `marker`, and a row without one is the frontend's trailing group."""
    by_receipt = {receipt_id: marker for marker, receipt_id in (placed or {}).items()}
    rows = []
    for receipt in receipts:
        row = mechanics_of(receipt)
        if row is None:
            continue
        if (marker := by_receipt.get(receipt.get("id"))):
            row["marker"] = marker
        rows.append(row)
    return rows


def is_public(receipt: dict[str, Any]) -> bool:
    return receipt.get("visibility") != "keeper"


def expected_numbers(receipt: dict[str, Any]) -> list[str]:
    """The digits a public receipt obliges the keeper to state (§5 step 2): a roll's
    roll and target, a dice roll's total, a delta's or cash's before and after, a time
    receipt's minutes. Anything else (names, scenes, clues, items) is the keeper's to
    word. Empty for keeper-only receipts."""
    if not is_public(receipt):
        return []
    kind = receipt.get("kind")
    if kind == "roll":
        if receipt.get("form") == "dice":
            return [_number(receipt.get("total"))]
        return [_number(receipt.get("roll")), _number(receipt.get("target"))]
    if kind in ("delta", "cash"):
        return [_number(receipt.get("before")), _number(receipt.get("after"))]
    if kind == "time":
        return [_number(int(receipt.get("minutes") or 0))]
    return []


def check_play_language(language: str, fields: dict[str, str | None]) -> None:
    """Refuse player-facing strings that carry none of the campaign's play_language
    script (§16.3). Pure character-class containment; `en` is unchecked."""
    if language not in CJK_PLAY_LANGUAGES:
        return
    missing = [name for name, text in fields.items() if text and not CJK.search(text)]
    if not missing:
        return
    raise invalid_params(
        "player-facing text is not in the campaign's play_language",
        code_detail=PLAY_LANGUAGE_MISMATCH,
        fix=("rewrite " + ", ".join(missing)
             + f" in the campaign's play_language ({language}) and call again"),
        details={"fields": missing, "play_language": language},
    )


def render_choice(prompt: str, options: list[str]) -> str:
    """The question and its numbered options; the numbers are the only thing the kernel
    adds, and they are language neutral."""
    numbered = [f"{i}. {option}" for i, option in enumerate(options, start=1)]
    return "\n".join([prompt.strip(), *numbered])
