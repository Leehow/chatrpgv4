"""The RuleGraph content digest, byte-for-byte as the old compiler computed it.

`coc_rule_graph.build` hashed the graph artifact with two helpers::

    def _canonical(value):
        return json.dumps(value, ensure_ascii=False, sort_keys=True,
                          separators=(",", ":"))

    def _json_digest(value):
        return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()

and wrote `_json_digest(graph)` into the build manifest as
`graph_content_digest`.  The loader re-derived it from the artifact on disk and
refused the package when the two disagreed, so the algorithm is part of the
artifact contract, not an implementation detail: any change here silently
invalidates every shipped `rule-graph-manifest.json`.

Two properties of the canonical form matter when the graph is edited by hand:

- Keys are sorted, so the on-disk key order of a node is free.
- Lists are *not* sorted, so the order of `nodes` and `relations` is load
  bearing.  The compiler emitted both sorted by their own id
  (``[nodes[key] for key in sorted(nodes)]``); an edited artifact must keep
  that order or it hashes to something the compiler would never have produced.

`sort_graph_lists` restores exactly that order, and `compute_graph_content_digest`
hashes whatever it is given, unsorted, so a wrongly ordered artifact fails the
manifest check instead of being quietly repaired.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Mapping


def canonical_json(value: Any) -> str:
    """The exact text the old compiler hashed."""
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def json_digest(value: Any) -> str:
    """sha256 over `canonical_json(value)` — the compiler's `_json_digest`."""
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def compute_graph_content_digest(graph: Mapping[str, Any]) -> str:
    """The `graph_content_digest` a build manifest must declare for `graph`."""
    return json_digest(graph)


def graph_digest_matches(graph: Mapping[str, Any], manifest: Mapping[str, Any]) -> bool:
    """True when the manifest declares this graph's digest, as the loader checks."""
    declared = manifest.get("graph_content_digest")
    if not isinstance(declared, str) or len(declared) != 64:
        return False
    return compute_graph_content_digest(graph) == declared


def sort_graph_lists(graph: dict[str, Any]) -> dict[str, Any]:
    """Return `graph` with `nodes` and `relations` in the compiler's id order."""
    ordered = dict(graph)
    if isinstance(ordered.get("nodes"), list):
        ordered["nodes"] = sorted(ordered["nodes"], key=lambda node: node["node_id"])
    if isinstance(ordered.get("relations"), list):
        ordered["relations"] = sorted(
            ordered["relations"], key=lambda relation: relation["relation_id"]
        )
    return ordered
