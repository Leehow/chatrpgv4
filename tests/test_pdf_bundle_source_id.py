"""The bundle contract and the Keeper's identity grammar must agree.

A source_id rides from the bundle manifest into `source_refs` and on into the
Keeper's model-facing context. The consumer (Pi's identity projection) drops
any id it cannot read as a namespaced semantic slug, and a dropped identity
makes the whole canonical result fail closed — so an id that is legal at bind
time but unreadable at the table breaks every Keeper read of that campaign,
which is how `pdf:COC--An-Amaranthine-Desire` was found (2026-09-01, live RPC
table). These tests keep the producing side and the consuming side pinned to
one rule.
"""
from __future__ import annotations

import importlib.util
import re
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
CONSUMER = ROOT / "plugins" / "coc-keeper" / "pi" / "lib" / "tool-contract-projection.ts"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


bundle = _load("coc_pdf_bundle_source_id_tests", SCRIPTS / "coc_pdf_bundle.py")

# Ids that must reach the table, and ids that must be refused at bind time.
ACCEPTED = (
    "pdf:call-of-cthulhu-keeper-rulebook-40th-the-haunting",
    "pdf:an-amaranthine-desire",
    "pdf:coc-let-the-children-come-to-me",
    "module:masks-of-nyarlathotep-ch-peru",
    "source:keeper-rulebook-40th",
    "handout:corbitt-diary-page",
    "pdf:不息的渴望",
)
REFUSED = (
    "pdf:COC--An-Amaranthine-Desire",  # uppercase plus an empty segment
    "pdf:COC-An-Amaranthine-Desire",  # uppercase alone
    "pdf:coc--an-amaranthine-desire",  # empty segment alone
    "pdf:a",  # too short to mean anything
    "an-amaranthine-desire",  # no provenance namespace
    "roll:toolbox-9f2c1ab4d7e6",  # not a provenance namespace
    "pdf:9f2c1ab4d7e6c8a1b2c3d4e5",  # entropy material
)


@pytest.mark.parametrize("value", ACCEPTED)
def test_bundle_accepts_model_projectable_source_ids(value):
    assert bundle.semantic_source_id_problem(value) is None


@pytest.mark.parametrize("value", REFUSED)
def test_bundle_refuses_source_ids_the_keeper_cannot_read(value):
    problem = bundle.semantic_source_id_problem(value)
    assert problem is not None and problem.strip()


def _consumer_rule():
    """Read the consumer's own grammar out of its source, not a copy of it."""
    text = CONSUMER.read_text(encoding="utf-8")
    slug = re.search(
        r"function isSemanticSlugShape\(value: string\): boolean \{\s*"
        r"if \(!/(?P<pattern>.+?)/\.test\(value\)\)",
        text,
        re.S,
    )
    assert slug, "consumer slug grammar not found; update this test with it"
    pattern = slug.group("pattern").replace("\\u3400", "㐀").replace(
        "\\u9fff", "鿿"
    )
    namespaces = re.search(
        r"PROVENANCE_SOURCE_NAMESPACES = stringSet\(\[(?P<items>[^\]]*)\]\)",
        text,
    )
    assert namespaces, "consumer provenance namespaces not found"
    return (
        re.compile(pattern),
        tuple(re.findall(r'"([^"]+)"', namespaces.group("items"))),
    )


def test_producer_and_consumer_share_one_namespace_set():
    _slug_re, consumer_namespaces = _consumer_rule()
    assert set(bundle.SOURCE_ID_NAMESPACES) == set(consumer_namespaces)


@pytest.mark.parametrize("value", ACCEPTED + REFUSED)
def test_everything_the_bundle_accepts_the_keeper_can_read(value):
    """The safety direction: accepted at bind time implies readable at the table.

    The bundle may be stricter than the consumer (it also refuses hash-shaped
    ids, which read fine but mean nothing to a Keeper); it may never be looser,
    because that is precisely the gap that only shows up in play.
    """
    slug_re, consumer_namespaces = _consumer_rule()
    namespace = next(
        (row for row in consumer_namespaces if value.startswith(row)), None
    )
    if namespace is None:
        consumer_accepts = False
    else:
        remainder = value[len(namespace):]
        minimum = 2 if re.search(r"[㐀-鿿]", remainder) else 4
        consumer_accepts = (
            len(remainder) >= minimum
            and all(slug_re.fullmatch(part) for part in remainder.split(":"))
        )
    producer_accepts = bundle.semantic_source_id_problem(value) is None
    assert not (producer_accepts and not consumer_accepts), (
        f"{value!r}: the bundle contract accepts an id the Keeper's identity "
        "grammar drops; that failure only surfaces at the table"
    )


def test_the_instance_that_broke_a_live_table_is_refused_by_both():
    slug_re, consumer_namespaces = _consumer_rule()
    value = "pdf:COC--An-Amaranthine-Desire"
    assert bundle.semantic_source_id_problem(value) is not None
    remainder = value[len("pdf:"):]
    assert "pdf:" in consumer_namespaces
    assert not all(slug_re.fullmatch(p) for p in remainder.split(":"))
