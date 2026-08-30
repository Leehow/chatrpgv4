#!/usr/bin/env python3
"""R7 stage-1: PREPARED per-family candidates for independent re-review.

§6.3 revision discipline (post review):

- No self-acceptance: this generator NEVER calls accept()/build() and never
  assigns a reviewer identity or acceptance status.  It runs prepare() (packet
  construction only), authors candidates, machine-validates them with the
  compiler's candidate validator (no acceptance state, no persistence), and
  writes a build-manifest-SHAPED draft whose ``review_status`` is
  ``revision-required`` and whose ``reviewer_identity`` is null.  Independent
  reviewers run accept()/build() after approving.
- No circular regeneration: inputs are the immutable committed pre-stage1
  baseline fixtures, the committed R4-R6 fixture graphs, and the committed
  rules-json files.  The generated output and the packaged production
  artifacts are never read.
- Healing byte preservation: production stays the committed pre-stage1
  artifacts (tests assert byte + canonical equality against
  ``tests/fixtures/coc7-rule-graph-pre-stage1*.json``).  Candidates never
  redeclare healing-owned nodes; new families reference resources under
  distinct family-scoped semantic ids (``resource:coc7:<family>:<pool>``).
- Semantic fidelity: unsupported compiled claims (social higher-of
  composition, PC-coercion penalty, psychology truth mapping, generic
  HP/MP/Luck delta channel) are REMOVED from the candidates and recorded as
  uncompiled exception markers plus source_ambiguity findings.
- Source bindings: one synthetic bundle per rules-json file, each declaring a
  per-file semantic ``source_id`` (``rules-json:coc7:<stem>``), so compiler
  source-binding rows identify the exact file; provenance records file path,
  file sha256, bundle-manifest sha256, and page-text sha256 separately.

Deterministic: same committed inputs -> identical output bytes.  Run
``python tests/fixtures/_gen_r7_stage1_candidates.py`` to (re)write the
committed candidate tree under
``plugins/coc-keeper/rulesets/coc7/rule-graph-candidates/stage1/``.
"""
from __future__ import annotations

import copy
import hashlib
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_module_graph as _mg  # noqa: E402
import coc_rule_graph as _rg  # noqa: E402

RULES_JSON = ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7" / "rules-json"
RULES_JSON_REL = "plugins/coc-keeper/rulesets/coc7/rules-json"
CANDIDATES_DIR = (
    ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7"
    / "rule-graph-candidates" / "stage1"
)
FIXTURES = Path(__file__).resolve().parent
THREE_FAMILY = FIXTURES / "coc7-rule-graph-three-family.json"
CHECK_LUCK = FIXTURES / "coc7-rule-graph-check-luck.json"
LOOKUPS = FIXTURES / "coc7-rule-graph-lookups.json"
# Immutable pre-stage1 baseline (committed).  Declared generation base; also
# the byte-equality target for the packaged production artifacts.
BASELINE_GRAPH = FIXTURES / "coc7-rule-graph-pre-stage1.json"
BASELINE_MANIFEST = FIXTURES / "coc7-rule-graph-manifest-pre-stage1.json"

ALL_FAMILIES = (
    "chase", "combat", "core-check", "development", "healing",
    "magic", "psychology", "push-luck", "sanity", "social",
)
STAGE1_PARTIAL = (
    "combat", "core-check", "development", "psychology", "push-luck",
    "sanity", "social",
)


def source_id_for(name: str) -> str:
    """Semantic per-file source identity: rules-json:coc7:<stem>."""
    return "rules-json:coc7:" + name.removesuffix(".json")


# Fixture evidence span name -> rules-json file whose blocks back the claim.
REMAP_FILE = {
    "span-percentile-check-json": "percentile-check.json",
    "span-difficulty-levels-json": "difficulty-levels.json",
    "span-success-levels-json": "success-levels.json",
    "span-roll-modifiers-json": "roll-modifiers.json",
    "span-pushed-roll-json": "pushed-roll.json",
    "span-luck-json": "luck.json",
    "span-derived-attributes-json": "derived-attributes.json",
    "span-damage-json": "damage.json",
    "span-spells-json": "spells.json",
    "span-skill-descriptions-json": "skill-descriptions.json",
    "span-skills-json": "skills.json",
    "span-equipment-json": "equipment.json",
    "span-build-scale-json": "build-scale.json",
    "span-cash-assets-json": "cash-assets.json",
    "span-sanity-json": "sanity.json",
}

# Fixture spans that cited rulebook PDF pages (social/psychology) re-bind to
# the rules-json blocks that actually support the interpersonal claims.
INTERPERSONAL_NEEDLES = (
    # selection_policy (players describe; Keeper chooses the skill; push note)
    "Players describe what their investigator is doing and saying",
    "threatening violence or acting aggressively",
    "attempting to befriend or seduce",
    "using rational arguments and debate",
    "acting quickly to deceive",
    "Switching from one interpersonal skill",
    # the four interpersonal skill entries + Psychology entry
    '"Charm": {',
    '"Fast Talk": {',
    '"Intimidate": {',
    '"Persuade": {',
    '"Psychology": {',
    '"opposed_by"',
    # load-bearing claim fragments
    "oppose all forms of social interaction rolls",
    "see through someone",
    "goal expressed by the player",
    "concealed Psychology skill rolls",
    "true or false, that the user gained",
    "between 50% and 89%",
    "below 50%",
)

# Nodes removed from the production social section because rules-json does
# not back them (each recorded as an absence finding; the PC-coercion and
# no-chance claims keep only their uncompiled exception markers).
SOCIAL_DROP = {
    "exception:coc7:social:no-chance",
    "rule:coc7:social:motive-and-leverage",
    "rule:coc7:social:pc-coercion-penalty",
    "input-slot:coc7:social:motive-direction",
    "input-slot:coc7:social:motive-intensity",
    "input-slot:coc7:social:motive-evidence",
    "input-slot:coc7:social:leverage-one-level",
    "input-slot:coc7:social:supporting-action",
}
# social decision payload narrowed to the slots rules-json backs.
SOCIAL_PAYLOAD_KEEP = ("described_action", "approach", "goal", "npc_defense")

# The generic HP/MP/Luck delta channel is source-ambiguous (no extracted
# generic clamp/delta table) and is NOT compiled; only source-backed
# per-resource claims remain (push-luck Luck pool, combat HP pool).
GENERIC_RESOURCE_DROP = {
    "rule:coc7:core-check:resource-arithmetic",
    "decision:coc7:core-check:resource-delta",
    "capability:coc7:resource-delta",
    "effect:coc7:core-check:resource-mutate",
    "input-slot:coc7:core-check:resource",
    "input-slot:coc7:core-check:direction",
    "input-slot:coc7:core-check:amount",
    "visibility-policy:coc7:core-check:host-internal-resource",
    "resource:coc7:hp",
    "resource:coc7:mp",
}

FUMBLE_OLD = "exception:coc7:push-luck:fumble-cannot-push"
FUMBLE_NEW = "exception:coc7:push-luck:fumble-push-uncompiled"

# Node renames: visible claims must match the narrowed, source-backed payload.
RENAMES = {
    "decision:coc7:social:adjudicate-difficulty": (
        "Adjudicate one social attempt (approach, goal, npc defense) as one "
        "settlement"
    ),
    "input-slot:coc7:social:npc-defense": (
        "Host-selected opposing skill level"
    ),
    "rule:coc7:social:opposing-difficulty": (
        "Opposed social difficulty follows the Regular/Hard/Extreme ladder "
        "against the defender's opposed_by skill"
    ),
}

# Absence rewordings (these exception nodes MARK absence; names say so).
REWORD = {
    "exception:coc7:social:pc-coercion-penalty-uncompiled": (
        "PC-coercion penalty die stays uncompiled: the four interpersonal "
        "skills oppose via opposed_by only, and a successful social use never "
        "compels the player"
    ),
    "exception:coc7:psychology:disguise-uncompiled": (
        "Psychology can see through Disguise (opposing_notes); "
        "psychology_check_contract compiles only the four interpersonal skills"
    ),
}

# Uncompiled absence markers authored for this revision (node + applies-to
# relation), with claim-level needle bindings.
ABSENCE_MARKERS = {
    "social": {
        "node": {
            "node_id": "exception:coc7:social:higher-of-composition-uncompiled",
            "node_kind": "exception",
            "name": (
                "Taking the higher of the matching social skill or Psychology "
                "is resolver composition, not an extracted rule; stays "
                "uncompiled"
            ),
            "authority": "deterministic",
            "audience": "host-internal",
            "visibility": "keeper-only",
            "hard_gate": False,
            "properties": {"family_id": "social"},
            "evidence_span_ids": ["span-skill-descriptions-json"],
        },
        "relation": {
            "relation_id": "relation:coc7:social:higher-of-uncompiled-applies",
            "relation_kind": "applies-to",
            "from_node_id": "exception:coc7:social:higher-of-composition-uncompiled",
            "to_node_id": "rule:coc7:social:opposing-difficulty",
            "evidence_span_ids": ["span-skill-descriptions-json"],
        },
        "needles": (
            "skill-descriptions.json",
            ("opposed_by", "oppose all forms of social interaction rolls"),
        ),
    },
    "psychology": {
        "node": {
            "node_id": "exception:coc7:psychology:truth-mapping-uncompiled",
            "node_kind": "exception",
            "name": (
                "Which information a concealed Psychology roll yields is not "
                "encoded in skill-descriptions (rolls may reveal information "
                "'true or false, that the user gained...'); the fixture's "
                "success-reveals-truth mapping stays uncompiled"
            ),
            "authority": "deterministic",
            "audience": "host-internal",
            "visibility": "keeper-only",
            "hard_gate": False,
            "properties": {"family_id": "psychology"},
            "evidence_span_ids": ["span-skill-descriptions-json"],
        },
        "relation": {
            "relation_id": "relation:coc7:psychology:truth-mapping-uncompiled-applies",
            "relation_kind": "applies-to",
            "from_node_id": "exception:coc7:psychology:truth-mapping-uncompiled",
            "to_node_id": "rule:coc7:psychology:concealed-observation",
            "evidence_span_ids": ["span-skill-descriptions-json"],
        },
        "needles": (
            "skill-descriptions.json",
            ("true or false, that the user gained",),
        ),
    },
}

PSYCHOLOGY_DROP = {"rule:coc7:psychology:success-reveals-truth"}

# data-table node -> the one shard that declares it (owner map).  Tables cited
# by other shards appear only as evidence spans there, never as duplicate nodes.
TABLE_OWNER = {
    "percentile-check.json": "core-check",
    "difficulty-levels.json": "core-check",
    "success-levels.json": "core-check",
    "roll-modifiers.json": "core-check",
    "pushed-roll.json": "core-check",
    "luck.json": "core-check",
    "derived-attributes.json": "core-check",
    "spells.json": "core-check",
    "skill-descriptions.json": "development",
    "skills.json": "development",
    "equipment.json": "development",
    "build-scale.json": "development",
    "cash-assets.json": "development",
    "damage.json": "combat",
    "sanity.json": "sanity",
}

SHARDS = [
    {
        "shard_id": "shard:coc7:social:section-interpersonal-skills",
        "section_id": "section-interpersonal-skills",
        "primary_family": "social",
        "families": ["social"],
        "files": ["skill-descriptions.json", "skills.json"],
        "fixtures": [THREE_FAMILY],
        "include_ids": ["rule:coc7:psychology:opposes-social"],
        "known_nodes": [],
        "pdf_span_pool": ("skill-descriptions.json", INTERPERSONAL_NEEDLES),
        "rule_needles": {
            "rule:coc7:social:approach-selection": (
                "skill-descriptions.json",
                ("Players describe what their investigator is doing and saying",
                 "threatening violence or acting aggressively",
                 "attempting to befriend or seduce",
                 "using rational arguments and debate",
                 "acting quickly to deceive",
                 "Switching from one interpersonal skill"),
            ),
            "rule:coc7:social:player-goal": (
                "skill-descriptions.json", ("goal expressed by the player",),
            ),
            "rule:coc7:social:opposing-difficulty": (
                "skill-descriptions.json",
                ("opposed_by", "oppose all forms of social interaction rolls"),
            ),
        },
        "drops": SOCIAL_DROP,
        "payload_keep": {
            "decision:coc7:social:adjudicate-difficulty": SOCIAL_PAYLOAD_KEEP,
        },
        "absence_marker": "social",
        "node_needles": {
            "exception:coc7:social:higher-of-composition-uncompiled": "social",
        },
    },
    {
        "shard_id": "shard:coc7:psychology:section-psychology-observation",
        "section_id": "section-psychology-observation",
        "primary_family": "psychology",
        "families": ["psychology"],
        "files": [
            "skill-descriptions.json", "skills.json", "difficulty-levels.json",
        ],
        "fixtures": [THREE_FAMILY],
        "include_ids": [],
        "known_nodes": [],
        "pdf_span_pool": ("skill-descriptions.json", INTERPERSONAL_NEEDLES),
        "rule_needles": {
            "rule:coc7:psychology:base-chance-ten": (
                "skills.json", ('"Psychology": {"base_chance": 10',),
            ),
            "rule:coc7:psychology:concealed-observation": (
                "skill-descriptions.json",
                ("concealed Psychology skill rolls",
                 "true or false, that the user gained"),
            ),
            "rule:coc7:psychology:opposes-social": (
                "skill-descriptions.json",
                ("oppose all forms of social interaction rolls",),
            ),
            "rule:coc7:psychology:observe-difficulty": (
                "difficulty-levels.json", ("threshold_regular",),
            ),
            "rule:coc7:psychology:sees-through-disguise": (
                "skill-descriptions.json", ("see through someone",),
            ),
        },
        "drops": PSYCHOLOGY_DROP,
        "payload_keep": {},
        "absence_marker": "psychology",
        "node_needles": {
            "exception:coc7:psychology:truth-mapping-uncompiled": "psychology",
        },
    },
    {
        "shard_id": "shard:coc7:core-check:section-checks-push-luck",
        "section_id": "section-checks-push-luck",
        "primary_family": "core-check",
        "families": ["core-check", "push-luck"],
        "files": [
            "percentile-check.json", "difficulty-levels.json",
            "success-levels.json", "roll-modifiers.json", "pushed-roll.json",
            "luck.json", "derived-attributes.json", "damage.json", "spells.json",
        ],
        "fixtures": [CHECK_LUCK],
        # luck.json backs the push-luck Luck pool; hp/mp belong to other
        # families (healing committed node; combat family-scoped node) and are
        # NOT redeclared here.
        "include_ids": ["resource:coc7:luck"],
        "resource_ids": {"resource:coc7:luck": "resource:coc7:push-luck:luck"},
        "known_nodes": [],
        "pdf_span_pool": None,
        "rule_needles": {},
        "drops": {FUMBLE_OLD, *GENERIC_RESOURCE_DROP},
        "payload_keep": {},
        "extra_nodes": [{
            "node_id": FUMBLE_NEW,
            "node_kind": "exception",
            "name": (
                "Whether a fumble can be pushed is not stated in "
                "pushed-roll.json; luck.json only bars buying off "
                "criticals/fumbles/malfunctions with Luck"
            ),
            "authority": "deterministic",
            "audience": "host-internal",
            "visibility": "keeper-only",
            "hard_gate": False,
            "properties": {"family_id": "push-luck"},
            "evidence_span_ids": ["span-pushed-roll-json", "span-luck-json"],
        }],
        "extra_relations": [{
            "relation_id": "relation:coc7:push-luck:fumble-push-uncompiled-applies",
            "relation_kind": "applies-to",
            "from_node_id": FUMBLE_NEW,
            "to_node_id": "decision:coc7:push-luck:pushed-roll",
            "evidence_span_ids": ["span-pushed-roll-json", "span-luck-json"],
        }],
    },
    {
        "shard_id": "shard:coc7:development:section-reference-lookups",
        "section_id": "section-reference-lookups",
        "primary_family": "development",
        "families": ["development"],
        "files": [
            "skill-descriptions.json", "skills.json", "equipment.json",
            "build-scale.json", "cash-assets.json",
        ],
        "fixtures": [LOOKUPS],
        "include_ids": [],
        "known_nodes": [],
        "pdf_span_pool": None,
        "rule_needles": {},
        "drops": set(),
        "payload_keep": {},
    },
    {
        "shard_id": "shard:coc7:combat:section-non-session-damage",
        "section_id": "section-non-session-damage",
        "primary_family": "combat",
        "families": ["combat"],
        "files": ["damage.json", "derived-attributes.json"],
        "fixtures": [LOOKUPS],
        # distinct family-scoped id: healing owns resource:coc7:hp verbatim
        "include_ids": ["resource:coc7:hp"],
        "resource_ids": {"resource:coc7:hp": "resource:coc7:combat:hp"},
        "known_nodes": [],
        "pdf_span_pool": None,
        "rule_needles": {},
        "drops": set(),
        "payload_keep": {},
    },
    {
        "shard_id": "shard:coc7:sanity:section-sourced-thresholds",
        "section_id": "section-sourced-thresholds",
        "primary_family": "sanity",
        "families": ["sanity"],
        "files": ["sanity.json", "derived-attributes.json"],
        "fixtures": [LOOKUPS],
        # no SAN pool node: no extracted table pins pool identity here
        "include_ids": [],
        "known_nodes": [],
        "pdf_span_pool": None,
        "rule_needles": {},
        "drops": {"resource:coc7:san"},
        "payload_keep": {},
    },
]


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _allowed_props() -> dict[str, set[str]]:
    return {kind: set(keys) for kind, keys in _rg.NODE_PROPERTY_KEYS.items()}


_ALLOWED = _allowed_props()


def _clean_node(node: dict) -> dict:
    """Strip fixture-only properties down to the closed v1 contract."""
    n = copy.deepcopy(node)
    kind = n["node_kind"]
    props = dict(n.get("properties") or {})
    if kind == "data-table":
        name = props.get("table_name") or Path(props.get("path") or n["name"]).name
        props = {"table_name": name}
    elif kind == "resource":
        props = {"resource_key": props.get("resource_key") or props.get("pool")}
    elif kind == "visibility-policy":
        props = {"policy": props.get("policy") or n.get("visibility", "public")}
    else:
        props = {k: v for k, v in props.items() if k in _ALLOWED.get(kind, set())}
    if kind == "resource":
        key = props.get("resource_key") or props.get("pool")
        names = {"hp": "Hit points", "mp": "Magic points", "luck": "Luck"}
        if names.get(key):
            n["name"] = names[key]
        n["authority"] = "deterministic"
        n["audience"] = "keeper"
        n["visibility"] = "public"
        n["hard_gate"] = False
    n["properties"] = props
    if not n.get("evidence_span_ids"):
        n.pop("evidence_span_ids", None)
    return n


def _node_family(node: dict, families: tuple[str, ...]) -> str | None:
    fam = (node.get("properties") or {}).get("family_id")
    if fam in families:
        return fam
    seg = node["node_id"].split(":")[2] if node["node_id"].count(":") >= 2 else ""
    for family in families:
        if seg == family or seg.startswith(family + "-"):
            return family
    return None


def _make_bundle(tmp: Path, name: str) -> tuple[Path, str, str]:
    """One synthetic source bundle for ONE rules-json file.

    The bundle manifest declares a per-file semantic source_id, so compiler
    source-binding rows identify the exact file.  Bytes are deterministic:
    relative paths, verbatim page text, machine-attached hashes only.
    Returns (bundle_dir, file_sha256, bundle_manifest_sha256).
    """
    text = (RULES_JSON / name).read_text(encoding="utf-8")
    file_sha = hashlib.sha256(text.encode("utf-8")).hexdigest()
    bundle = tmp / f"bundle-{name.removesuffix('.json')}"
    (bundle / "pages").mkdir(parents=True, exist_ok=True)
    (bundle / "pages" / "0000.md").write_text(text, encoding="utf-8")
    manifest = {
        "schema_version": 1,
        "producer": "codex-pdf-skill",
        "source": {
            "source_id": source_id_for(name),
            "title": f"coc7 rules-json {name} (verbatim file text)",
            "path": RULES_JSON_REL,
            "page_count": 1,
        },
        "pages": [{
            "pdf_index": 0,
            "markdown_path": "pages/0000.md",
            "text_sha256": file_sha,
            "review_state": "auto_accepted",
            "parse_confidence": 1.0,
            "grep_anchors": [text[:60]],
        }],
        "assets": [],
    }
    manifest_bytes = json.dumps(manifest, ensure_ascii=False, indent=2).encode(
        "utf-8"
    )
    (bundle / "manifest.json").write_bytes(manifest_bytes)
    return bundle, file_sha, hashlib.sha256(manifest_bytes).hexdigest()


def _block_spans(
    bundle_dirs: list[Path], section_id: str, files: list[str]
) -> dict[str, list[dict]]:
    """Replicate prepare()'s evidence scope: file -> [{span_id, text}]."""
    catalog = _mg.load_page_catalog([str(d) for d in bundle_dirs])
    page_keys = [(source_id_for(name), 0) for name in files]
    packet = _mg.build_evidence_packet(
        catalog, section_id=section_id, page_keys=page_keys
    )
    mapping: dict[str, list[dict]] = {name: [] for name in files}
    for span in packet["spans"]:
        sid = span["source_ref"]["source_id"]
        name = next(f for f in files if source_id_for(f) == sid)
        mapping[name].append({"span_id": span["span_id"], "text": span["text"]})
    return mapping


def _spans_for_file(blocks: dict[str, list[dict]], name: str) -> list[str]:
    return [row["span_id"] for row in blocks[name]]


def _needle_spans(blocks: dict[str, list[dict]], name: str, needles) -> list[str]:
    texts = [row["text"] for row in blocks[name]]
    ids = [row["span_id"] for row in blocks[name]]
    hits: set[int] = set()
    for i, text in enumerate(texts):
        joined = text + (texts[i + 1] if i + 1 < len(texts) else "")
        if any(needle in text or needle in joined for needle in needles):
            hits.add(i)
            if i + 1 < len(texts):
                hits.add(i + 1)
    if not hits:
        raise SystemExit(
            f"citation integrity: no block of {name} matched needles {needles}"
        )
    return [ids[i] for i in sorted(hits)]


def _collect_shard_nodes(shard: dict) -> tuple[list[dict], list[dict]]:
    """Pull this shard's nodes/relations out of its fixture graphs."""
    families = tuple(shard["families"])
    nodes: list[dict] = []
    relations: list[dict] = []
    include_ids = set(shard.get("include_ids") or [])
    resource_ids = shard.get("resource_ids") or {}
    for fixture in shard["fixtures"]:
        graph = _load(fixture)
        for node in graph["nodes"]:
            if node["node_id"] in include_ids and not any(
                n["node_id"] == node["node_id"] for n in nodes
            ):
                cleaned = _clean_node(node)
                cleaned["node_id"] = resource_ids.get(
                    node["node_id"], node["node_id"]
                )
                nodes.append(cleaned)
        for node in graph["nodes"]:
            if node["node_kind"] == "data-table":
                if TABLE_OWNER.get(
                    (node.get("properties") or {}).get("table_name")
                    or Path((node.get("properties") or {}).get("path") or "").name
                ) in families:
                    nodes.append(_clean_node(node))
                continue
            fam = _node_family(node, families)
            if fam is None:
                continue  # healing-scoped or other fixture's family
            nid = node["node_id"]
            if nid in shard["drops"] or nid in include_ids:
                continue
            node = _clean_node(node)
            if nid in REWORD:
                node["name"] = REWORD[nid]
            if nid in RENAMES:
                node["name"] = RENAMES[nid]
            keep = shard["payload_keep"].get(nid)
            if keep:
                impl = node["properties"]["implementation"]
                impl["payload_slots"] = [
                    slot for slot in impl["payload_slots"] if slot["name"] in keep
                ]
            if nid in shard.get("rule_needles", {}):
                # exact citation re-bound later, after blocks are known
                node["evidence_span_ids"] = []
            nodes.append(node)
        marker = shard.get("absence_marker")
        if marker:
            nodes.append(copy.deepcopy(ABSENCE_MARKERS[marker]["node"]))
        for extra in shard.get("extra_nodes", []):
            if _node_family(extra, families):
                nodes.append(copy.deepcopy(extra))
        own = set(n["node_id"] for n in nodes)
        known = {k["node_id"] for k in shard.get("known_nodes", [])}
        for rel in graph["relations"]:
            def _owned(node_id: str) -> bool:
                seg = node_id.split(":")[2] if node_id.count(":") >= 2 else ""
                return any(seg == f or seg.startswith(f + "-") for f in families)
            rel = copy.deepcopy(rel)
            # family-scoped resource ids are applied first so ownership and
            # closure tests see the candidate's own node ids
            rel["from_node_id"] = resource_ids.get(
                rel["from_node_id"], rel["from_node_id"]
            )
            rel["to_node_id"] = resource_ids.get(
                rel["to_node_id"], rel["to_node_id"]
            )
            # a relation compiles in the shard owning its TO-node; cross-family
            # edges land on their target's shard (their FROM node is duplicated
            # there via include_ids)
            if not _owned(rel["to_node_id"]):
                continue
            if rel["from_node_id"] in shard["drops"] or rel["to_node_id"] in shard["drops"]:
                continue
            if (rel["from_node_id"] not in own | known
                    and rel["to_node_id"] not in own | known):
                continue
            relations.append(rel)
        if marker:
            relations.append(copy.deepcopy(ABSENCE_MARKERS[marker]["relation"]))
        relations.extend(copy.deepcopy(r) for r in shard.get("extra_relations", []))
    return nodes, relations


def _remap_spans(
    nodes: list[dict],
    relations: list[dict],
    shard: dict,
    blocks: dict[str, list[dict]],
) -> None:
    pool = None
    if shard.get("pdf_span_pool"):
        file_name, needles = shard["pdf_span_pool"]
        pool = _needle_spans(blocks, file_name, needles)

    def _map_one(old_spans, owner_id) -> list[str]:
        new: list[str] = []
        for span in old_spans or []:
            if span in REMAP_FILE:
                file_name = REMAP_FILE[span]
                if file_name in blocks:
                    new.extend(_spans_for_file(blocks, file_name))
                else:
                    raise SystemExit(
                        f"citation integrity: {owner_id} cites {file_name} "
                        f"which is not in shard {shard['shard_id']} files"
                    )
            elif pool is not None:
                new.extend(pool)
            else:
                raise SystemExit(
                    f"citation integrity: unmapped fixture span {span} on "
                    f"{owner_id}"
                )
        return sorted(set(new))

    for node in nodes:
        old = node.get("evidence_span_ids")
        if old is None:
            continue
        needle_rule = shard.get("rule_needles", {}).get(node["node_id"])
        if needle_rule is not None and old == []:
            file_name, needles = needle_rule
            node["evidence_span_ids"] = sorted(
                set(_needle_spans(blocks, file_name, needles))
            )
            continue
        new = _map_one(old, node["node_id"])
        if new:
            node["evidence_span_ids"] = new
        else:
            node.pop("evidence_span_ids", None)

    # claim-level needle binding for absence markers and any rewritten node
    for nid, binding in (shard.get("node_needles") or {}).items():
        marker = ABSENCE_MARKERS.get(binding)
        if marker is None:
            continue
        file_name, needles = marker["needles"]
        for node in nodes:
            if node["node_id"] == nid:
                node["evidence_span_ids"] = sorted(
                    set(_needle_spans(blocks, file_name, needles))
                )
                break

    for rel in relations:
        new = _map_one(rel.get("evidence_span_ids"), rel["relation_id"])
        if new:
            rel["evidence_span_ids"] = new
        else:
            rel.pop("evidence_span_ids", None)


def build_stage1_work(
    tmp: Path,
) -> tuple[list[dict], list[dict], list[dict], list[dict]]:
    """prepare() + author + machine-validate every shard (no accept/build).

    Returns (packets, candidates, per-shard source bindings, span stats).
    """
    _rg.clear_accepted_session()
    packets: list[dict] = []
    candidates: list[dict] = []
    bindings: list[dict] = []
    stats: list[dict] = []
    for shard in SHARDS:
        files = sorted(shard["files"])
        bundle_dirs: list[Path] = []
        file_hashes: dict[str, str] = {}
        bundle_hashes: dict[str, str] = {}
        for name in files:
            bundle, file_sha, bundle_sha = _make_bundle(tmp, name)
            bundle_dirs.append(bundle)
            file_hashes[name] = file_sha
            bundle_hashes[name] = bundle_sha
        blocks = _block_spans(bundle_dirs, shard["section_id"], files)
        nodes, relations = _collect_shard_nodes(shard)
        _remap_spans(nodes, relations, shard, blocks)

        selection = {
            "ruleset_id": "coc7",
            "ruleset_version": "1.0.0",
            "source_language": "en",
            "family_id": shard["primary_family"],
            "section_id": shard["section_id"],
            "bundle_dirs": [str(d) for d in bundle_dirs],
            "page_keys": [(source_id_for(name), 0) for name in files],
            "output_budget": {"max_nodes": 120, "max_relations": 240},
            "families": list(shard["families"]),
            "known_nodes": shard["known_nodes"],
        }
        prepared = _rg.prepare(selection)
        assert prepared["ok"] is True, prepared
        packet = prepared["shard"]
        # attach machine-computed per-file digests to each span's source_ref
        # (code-owned bytes; never model-authored)
        for span in packet["evidence_binding"]["spans"]:
            sid = span["source_ref"]["source_id"]
            name = next(f for f in files if source_id_for(f) == sid)
            span["source_ref"]["file_sha256"] = file_hashes[name]
        packet_findings = _rg._validate_packet(packet)
        assert not packet_findings, packet_findings

        candidate = {
            "contract_id": _rg.CANDIDATE_CONTRACT_ID,
            "schema_version": 1,
            "ruleset_id": "coc7",
            "family_id": shard["primary_family"],
            "section_id": shard["section_id"],
            "source_language": "en",
            "coverage": {fam: "partial" for fam in shard["families"]},
            "nodes": nodes,
            "relations": relations,
        }
        # pre-review machine validation only: no acceptance, no persistence
        candidate_findings = _rg._validate_candidate(candidate, packet)
        assert not candidate_findings, (
            shard["shard_id"], candidate_findings
        )
        packets.append(packet)
        candidates.append(candidate)
        bindings.append({
            "shard_id": shard["shard_id"],
            "section_id": shard["section_id"],
            "families": list(shard["families"]),
            "coverage": {fam: "partial" for fam in shard["families"]},
            "sources": [
                {
                    "source_id": source_id_for(name),
                    "file": f"{RULES_JSON_REL}/{name}",
                    "file_sha256": file_hashes[name],
                    "bundle_manifest_sha256": bundle_hashes[name],
                    "pages": 1,
                }
                for name in files
            ],
            "span_count": len(packet["evidence_binding"]["spans"]),
            "node_count": len(nodes),
            "relation_count": len(relations),
        })
        stats.append({"shard_id": shard["shard_id"], "files": files})
    return packets, candidates, bindings, stats


def _canonical_bytes(obj) -> bytes:
    return json.dumps(obj, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"


NEW_FINDINGS = [
    {
        "code": "source_ambiguity",
        "path": "/decision:coc7:social:adjudicate-difficulty/motive-leverage-supporting",
        "message": (
            "Fixture-level social motive direction/intensity/evidence, "
            "supporting-action, and one-level leverage difficulty modifiers "
            "are not present in rules-json; they stay uncompiled in this "
            "production candidate. Fixture graphs and the resolver keep them "
            "at runtime; promotion requires an extracted source table."
        ),
    },
    {
        "code": "source_ambiguity",
        "path": "/exception:coc7:social:no-chance",
        "message": (
            "The Keeper may forbid a social attempt when there is no chance "
            "of success; no rules-json table states it, so the node is not "
            "compiled here. Recorded absence, not source backing."
        ),
    },
    {
        "code": "source_ambiguity",
        "path": "/rule:coc7:social:opposing-difficulty/higher-of-composition",
        "message": (
            "difficulty-levels.json from_opponent backs a Regular/Hard/"
            "Extreme ladder against the opposing skill's level, but taking "
            "the higher of the matching social skill or Psychology is "
            "resolver composition, not an extracted rule. This revision "
            "REMOVED the composition from the compiled rule (it now carries "
            "only the opposed_by ladder) and records it as uncompiled via "
            "exception:coc7:social:higher-of-composition-uncompiled."
        ),
    },
    {
        "code": "source_ambiguity",
        "path": "/exception:coc7:psychology:truth-mapping-uncompiled",
        "message": (
            "skill-descriptions.json says concealed Psychology rolls may "
            "reveal information 'true or false, that the user gained...' but "
            "does not encode success-reveals-truth / failure-may-mislead. "
            "This revision REMOVED the fixture's success-reveals-truth rule; "
            "the mapping stays uncompiled (exception marker)."
        ),
    },
    {
        "code": "source_ambiguity",
        "path": "/rule:coc7:core-check:resource-arithmetic",
        "message": (
            "The fixture's generic HP/MP/Luck delta channel (resource-"
            "arithmetic rule, resource_delta decision/capability/effect, "
            "host-internal visibility policy) is NOT compiled in this "
            "revision: no extracted generic clamp/delta table exists. "
            "Source-backed remnants keep distinct family-scoped ids: "
            "resource:coc7:push-luck:luck (luck.json spend/roll, cap 99) and "
            "resource:coc7:combat:hp (damage.json negative roll-backed HP). "
            "Healing's resource:coc7:hp is not redeclared."
        ),
    },
    {
        "code": "source_ambiguity",
        "path": "/exception:coc7:push-luck:fumble-push-uncompiled",
        "message": (
            "pushed-roll.json does not state whether a fumble can be pushed; "
            "luck.json only bars buying off criticals/fumbles/malfunctions "
            "with Luck. The fixture's fumble-cannot-push claim is therefore "
            "not compiled here; recorded as absence."
        ),
    },
    {
        "code": "executor_capability_gap",
        "path": "/exception:coc7:social:pc-coercion-penalty-uncompiled",
        "message": (
            "This revision REMOVED the fixture's compiled pc-coercion-penalty "
            "rule. The social_difficulty capability compiles opposition via "
            "the four interpersonal opposed_by lists only; the penalty die "
            "stays uncompiled (exception marker)."
        ),
    },
    {
        "code": "executor_capability_gap",
        "path": "/exception:coc7:psychology:disguise-uncompiled",
        "message": (
            "psychology_check_contract opposes the four interpersonal skills "
            "only; seeing through Disguise is not implemented and stays "
            "uncompiled (exception node)."
        ),
    },
]

# Absence records carried verbatim from the R5/R6 fixture manifests.
CARRIED_FINDINGS = [
    {
        "code": "source_ambiguity",
        "path": "/rule-family:coc7:push-luck/luck-recovery-uncompiled",
        "message": (
            "luck.json recovery.applies_when is after_each_session; "
            "rule-index.json source_note places the optional recovery in the "
            "Investigator Development Phase. This shard binds spend/roll to "
            "luck.json; recovery stays uncompiled (development family)."
        ),
    },
    {
        "code": "source_ambiguity",
        "path": "/rule-family:coc7:development",
        "message": (
            "development family here is lookup/read coverage only "
            "(skill-describe, catalog-search, build-scale, cash-assets). "
            "Investigator Development Phase skill-tick improvement stays "
            "uncompiled."
        ),
    },
    {
        "code": "source_ambiguity",
        "path": "/rule-family:coc7:combat",
        "message": (
            "combat family here is non-session roll-backed HP damage only. "
            "The combat session engine (DEX order, dodge/fight-back, "
            "maneuvers) is retained."
        ),
    },
    {
        "code": "source_ambiguity",
        "path": "/decision:coc7:combat:apply-damage/heal",
        "message": (
            "damage.json delta_sign is negative and dice_kind is damage. "
            "Healing amounts belong to the healing family, not this combat "
            "decision."
        ),
    },
    {
        "code": "source_ambiguity",
        "path": "/decision:coc7:combat:apply-damage/integer-amount",
        "message": (
            "damage.json requires_die, requires_roll_id, and "
            "requires_roll_total. Unrolled integer HP application is not a "
            "compiled claim of this node."
        ),
    },
    {
        "code": "source_ambiguity",
        "path": "/decision:coc7:combat:apply-damage/major-wound",
        "message": (
            "damage.json specifies non-percentile HP reduction evidence, not "
            "the half-max major-wound or 0 HP dying/unconscious transitions. "
            "Those condition writes remain in the legacy damage handler; no "
            "extracted major-wound table is cited."
        ),
    },
    {
        "code": "source_ambiguity",
        "path": "/rule-family:coc7:sanity",
        "message": (
            "sanity.json supports thresholds, bout duration, failed-roll "
            "involuntary kinds, and max SAN. The percentile check, "
            "success/failure loss selection, and floor-0 clamp are absent "
            "(exception:coc7:sanity:check-then-loss-uncompiled). INT reality "
            "check, SAN 0 permanent, and the SanitySession state machine stay "
            "uncompiled (exception:coc7:sanity:session-engine-uncompiled)."
        ),
    },
    {
        "code": "source_ambiguity",
        "path": "/exception:coc7:sanity:check-then-loss-uncompiled",
        "message": (
            "sanity.json does not contain a percentile check against current "
            "SAN, loss_success/loss_failure selection, or a SAN floor-0 "
            "clamp. Those claims are uncompiled; this finding marks their "
            "absence, not source backing."
        ),
    },
    {
        "code": "source_ambiguity",
        "path": "/coverage/magic",
        "message": (
            "magic family has no R6 source+execution evidence; coverage stays "
            "unresolved."
        ),
    },
]


def _draft_manifest(bindings: list[dict], candidates: list[dict]) -> dict:
    baseline = _load(BASELINE_MANIFEST)
    family_coverage = {
        family: "unresolved" for family in ALL_FAMILIES
    }
    family_coverage["healing"] = "accepted"
    for binding in bindings:
        for fam, status in binding["coverage"].items():
            family_coverage[fam] = status
    promotion = {
        family: {"promotion_eligible": False, "runtime_ownership": "legacy"}
        for family in ALL_FAMILIES
    }
    # healing promotion row copied verbatim from the committed baseline
    promotion["healing"] = copy.deepcopy(
        baseline["family_promotion_eligibility"]["healing"]
    )
    data_tables: set[str] = set()
    resolver_caps: set[str] = set()
    for candidate in candidates:
        for node in candidate["nodes"]:
            props = node.get("properties") or {}
            if node["node_kind"] == "data-table" and props.get("table_name"):
                data_tables.add(props["table_name"])
            if node["node_kind"] == "capability" and props.get(
                "resolver_capability"
            ):
                resolver_caps.add(props["resolver_capability"])
    rows: dict[str, dict] = {}
    for binding in bindings:
        for source in binding["sources"]:
            rows[source["source_id"]] = {
                "source_id": source["source_id"],
                "bundle_sha256": source["bundle_manifest_sha256"],
                "file_sha256": source["file_sha256"],
            }
    findings = [
        copy.deepcopy(f) for f in (baseline.get("findings") or [])
    ]
    seen = {(f.get("code"), f.get("path")) for f in findings}
    for finding in NEW_FINDINGS + CARRIED_FINDINGS:
        if (finding["code"], finding["path"]) not in seen:
            findings.append(finding)
    return {
        "contract_id": _rg.BUILD_MANIFEST_CONTRACT_ID,
        "schema_version": 1,
        "ruleset_id": "coc7",
        "ruleset_version": "1.0.0",
        "source_bundles": [rows[key] for key in sorted(rows)],
        # pending the independent reviewers' accept()/build()
        "graph_content_digest": None,
        "shards": [
            {"shard_id": binding["shard_id"], "shard_digest": None}
            for binding in sorted(bindings, key=lambda row: row["shard_id"])
        ],
        "family_coverage": family_coverage,
        "family_promotion_eligibility": promotion,
        "data_table_dependencies": sorted(data_tables),
        "resolver_capability_dependencies": sorted(resolver_caps),
        "compiler_identity": _rg.CONTRACT["compiler_identity"],
        # no self-acceptance: independent review is the acceptance authority
        "reviewer_identity": None,
        "review_status": "revision-required",
        "findings": findings,
    }


def build_candidates(out_dir: Path) -> dict[str, dict]:
    """Write the committed candidate tree; return {relpath: parsed object}."""
    written: dict[str, dict] = {}
    with tempfile.TemporaryDirectory(prefix="r7-stage1-") as raw:
        tmp = Path(raw)
        packets, candidates, bindings, _stats = build_stage1_work(tmp)

    def _write(rel: str, obj) -> None:
        path = out_dir / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(_canonical_bytes(obj))
        written[rel] = obj

    for candidate in candidates:
        _write(f"candidates/{candidate['section_id']}.candidate.json", candidate)
    for binding in bindings:
        _write(
            f"provenance/{binding['section_id']}.provenance.json", binding
        )
    _write("manifest-draft.json", _draft_manifest(bindings, candidates))
    return written


def main() -> None:
    written = build_candidates(CANDIDATES_DIR)
    manifest = written["manifest-draft.json"]
    nodes = sum(
        len(obj["nodes"]) for rel, obj in written.items()
        if rel.startswith("candidates/")
    )
    rels = sum(
        len(obj["relations"]) for rel, obj in written.items()
        if rel.startswith("candidates/")
    )
    print("stage-1 prepared candidates written:")
    print(f"  files: {len(written)}  shards: {len(manifest['shards'])}")
    print(f"  nodes: {nodes}  relations: {rels}")
    print(f"  source_bundles: {len(manifest['source_bundles'])} (per-file)")
    print(f"  findings: {len(manifest['findings'])}")
    print(f"  review_status: {manifest['review_status']}")
    print(f"  reviewer_identity: {manifest['reviewer_identity']}")
    print(f"  coverage: {json.dumps(manifest['family_coverage'], sort_keys=True)}")
    print(f"  ownership: healing=graph/hidden, others=legacy/visible")


if __name__ == "__main__":
    main()
