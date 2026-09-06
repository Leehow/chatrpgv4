"""The mechanics projection and the number check (contract §5 narrate/ask, §16).

The kernel writes no mechanics prose. Every receipt of a turn is projected into one
language-neutral object (`mechanics`, §16.2) that rides with the delivery for the front
end and the evidence; the keeper states the results itself, in the player's language,
and the kernel keeps the deterministic floor by checking that every public receipt's
numbers appear in that text (§16.3). Pure string containment; nothing here reads prose
for meaning."""

from __future__ import annotations

from typing import Any

from .errors import RpcError, invalid_params

MECHANICS_MISSING = "mechanics_missing"


def _number(value: Any) -> str:
    """The digits the keeper is expected to copy: an integral float prints as an int."""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _with_label(out: dict[str, Any], key: str, value: Any) -> None:
    if isinstance(value, str) and value.strip():
        out[key] = value


def mechanics_of(receipt: dict[str, Any]) -> dict[str, Any] | None:
    """One §16.2 object for one receipt; None for a receipt kind that has no projection.
    Names (skills, resources, families, outcomes) are the rulebook's English as the
    receipt carries them; labels are the names the keeper or the sheet gave, data not
    language."""
    kind = receipt.get("kind")
    receipt_id = receipt.get("id")
    if kind == "roll":
        if receipt.get("form") == "dice":
            out: dict[str, Any] = {"kind": "dice", "receipt": receipt_id, "actor": receipt.get("actor"),
                                   "label": receipt.get("skill"), "expression": receipt.get("expression"),
                                   "faces": list(receipt.get("faces") or []), "total": receipt.get("total"),
                                   "visibility": receipt.get("visibility") or "public"}
            _with_label(out, "actor_label", receipt.get("actor_label"))
            return out
        out = {"kind": "roll", "receipt": receipt_id, "actor": receipt.get("actor"), "skill": receipt.get("skill"),
               "roll": receipt.get("roll"), "target": receipt.get("target"), "threshold": receipt.get("threshold"),
               "difficulty": receipt.get("difficulty"), "level": receipt.get("level"),
               "passed": bool(receipt.get("passed")), "pushed": bool(receipt.get("pushed")),
               "visibility": receipt.get("visibility") or "public"}
        _with_label(out, "actor_label", receipt.get("actor_label"))
        return out
    if kind == "delta":
        out = {"kind": "change", "receipt": receipt_id, "resource": receipt.get("resource"),
               "subject": receipt.get("subject"), "before": receipt.get("before"), "after": receipt.get("after")}
        _with_label(out, "subject_label", receipt.get("subject_label"))
        return out
    if kind == "move":
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
    if kind == "handout":
        attachment = receipt.get("attachment") if isinstance(receipt.get("attachment"), dict) else {}
        out = {"kind": "handout", "receipt": receipt_id, "name": receipt.get("name") or receipt.get("handout"),
               "available": bool(attachment.get("available"))}
        _with_label(out, "label", receipt.get("label"))
        _with_label(out, "path", attachment.get("path"))
        return out
    return None


def mechanics(receipts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The turn's receipts in order, one object each (§16.2)."""
    return [row for receipt in receipts if (row := mechanics_of(receipt)) is not None]


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


def missing_numbers(text: str, receipts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """`[{"receipt", "expected": [...]}]` for every public receipt whose numbers the text
    does not contain as digits. Pure containment: no words, no semantics."""
    missing: list[dict[str, Any]] = []
    for receipt in receipts:
        expected = expected_numbers(receipt)
        if expected and not all(number in text for number in expected):
            missing.append({"receipt": receipt.get("id"), "expected": expected})
    return missing


def mechanics_missing(missing: list[dict[str, Any]]) -> RpcError:
    """`invalid_params` / `mechanics_missing` (§16.3): the keeper states the numbers and
    calls again with the same call_id."""
    wanted = "; ".join(f"{row['receipt']}: {', '.join(row['expected'])}" for row in missing)
    return invalid_params(
        "text does not state the numbers of every public receipt of this turn",
        code_detail=MECHANICS_MISSING,
        fix=f"state these numbers, as digits, in the player's language in text and call again: {wanted}",
        details={"missing": missing},
    )


def check_numbers(text: str, receipts: list[dict[str, Any]]) -> None:
    missing = missing_numbers(text, receipts)
    if missing:
        raise mechanics_missing(missing)


def render_choice(prompt: str, options: list[str]) -> str:
    """The question and its numbered options; the numbers are the only thing the kernel
    adds, and they are language neutral."""
    numbered = [f"{i}. {option}" for i, option in enumerate(options, start=1)]
    return "\n".join([prompt.strip(), *numbered])
