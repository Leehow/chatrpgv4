"""Public mechanics names require a host-confirmed investigator identity."""

from copy import deepcopy

import pytest

from coc.render import mechanics


@pytest.mark.parametrize("receipt, key, numeric", [
    ({"id": "roll:spot-hidden-hidden-name-t1-c1", "kind": "roll", "skill": "Spot Hidden",
      "roll": 31, "target": 60, "threshold": 60, "passed": True}, "actor", {"roll": 31, "target": 60}),
    ({"id": "roll:damage-t1-c1", "kind": "roll", "form": "dice", "skill": "Damage",
      "expression": "1D6", "faces": [4], "total": 4}, "actor", {"faces": [4], "total": 4}),
    ({"id": "delta:hp-t1-c1", "kind": "delta", "resource": "hp", "before": 12, "after": 8},
     "subject", {"before": 12, "after": 8}),
])
@pytest.mark.parametrize("identity", [True, False, None])
def test_public_identity_is_explicit_and_projection_preserves_canonical_receipt(receipt, key, numeric, identity):
    receipt = {**receipt, key: "hidden-name", f"{key}_label": "Hidden Name"}
    if identity is not None:
        receipt[f"{key}_is_investigator"] = identity
    original = deepcopy(receipt)
    row = mechanics([receipt], {"check:spot-hidden": receipt["id"]})[0]
    assert row["marker"] == "check:spot-hidden"
    assert row["receipt"] == receipt["id"]
    assert all(row[field] == value for field, value in numeric.items())
    assert row[f"{key}_is_investigator"] is (identity is True)
    if identity is True:
        assert row[key] == "hidden-name" and row[f"{key}_label"] == "Hidden Name"
    else:
        assert key not in row and f"{key}_label" not in row
    assert receipt == original
