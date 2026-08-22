#!/usr/bin/env python3
"""Campaign handout catalog, secrecy projection, and delivery policy.

The toolbox remains responsible for transactions: saving world state, writing
events, and recording decision receipts.  This module owns the cohesive
handout rules inside those transactions:

* merge the canonical asset-index, campaign-IR, and deep-entity card stores;
* reject malformed or incomplete cards while loading;
* project Keeper and player views without leaking undelivered material;
* apply idempotent delivery mutations to a caller-owned world document; and
* select leak-free opening-card metadata.

Callers load one :class:`HandoutCatalog` per operation and exercise all of the
above behavior through that small interface.  No prose classification or
keyword matching occurs here; card identity and visibility are structured.
"""

from __future__ import annotations

import importlib.util
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

_HERE = Path(__file__).resolve().parent


def _load_dependency(toolbox_name: str, local_name: str, filename: str):
    """Reuse the toolbox dependency when present; otherwise load this sibling."""
    existing = sys.modules.get(toolbox_name) or sys.modules.get(local_name)
    if existing is not None:
        return existing
    spec = importlib.util.spec_from_file_location(local_name, _HERE / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[local_name] = module
    spec.loader.exec_module(module)
    return module


coc_scenario = _load_dependency(
    "coc_scenario_toolbox", "coc_scenario_handouts", "coc_scenario.py"
)
coc_module_project = _load_dependency(
    "coc_module_project_toolbox",
    "coc_module_project_handouts",
    "coc_module_project.py",
)


class HandoutError(ValueError):
    """Stable domain error for toolbox adapters to translate."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Delivery:
    """One idempotent direct-delivery outcome."""

    asset_id: str
    newly: tuple[str, ...]
    already: tuple[str, ...]
    delivered_total: int
    card: dict[str, Any]


@dataclass(frozen=True)
class LinkedDelivery:
    """Best-effort clue linkage without weakening direct-delivery policy."""

    asset_id: str | None
    newly: tuple[str, ...]
    hidden_card: bool


class HandoutCatalog:
    """Validated campaign card catalog with projection and delivery policy."""

    def __init__(self, cards: dict[str, dict[str, Any]]):
        self._cards = cards
        clue_refs: dict[str, set[str]] = {}
        for asset_id, card in cards.items():
            for raw_ref in card.get("clue_refs") or []:
                clue_id = str(raw_ref).strip()
                if clue_id:
                    clue_refs.setdefault(clue_id, set()).add(asset_id)
        # Build this only after the authority-ordered stores have finished
        # overriding one another.  Reverse linkage therefore depends on the
        # final catalog, never on projection/merge order.
        self._assets_by_clue = {
            clue_id: tuple(sorted(asset_ids))
            for clue_id, asset_ids in clue_refs.items()
        }

    @classmethod
    def load(cls, ctx: Any) -> HandoutCatalog:
        """Load valid cards in authority order: index, campaign IR, deep entity."""
        cards: dict[str, dict[str, Any]] = {}
        if ctx.campaign_dir is None:
            return cls(cards)

        cards.update(coc_scenario.load_handout_assets(ctx.campaign_dir))
        doc = ctx.scenario("handouts.json")
        if isinstance(doc, dict):
            for card in doc.get("handouts") or []:
                if not isinstance(card, dict):
                    continue
                if coc_scenario.validate_handout_card(card, prefix="scenario handout"):
                    continue
                asset_id = card.get("asset_id")
                if isinstance(asset_id, str) and asset_id.strip():
                    cards[asset_id.strip()] = card

        asset_root_id = coc_module_project.campaign_asset_root_id(ctx.campaign_dir)
        if asset_root_id:
            entities_dir = (
                coc_module_project.coc_module_assets.assets_root(ctx.root)
                / asset_root_id
                / "entities"
            )
            if entities_dir.is_dir():
                for path in sorted(entities_dir.glob("handout-*.json")):
                    entity_id = path.stem[len("handout-") :]
                    if not entity_id:
                        continue
                    try:
                        pack = coc_module_project.coc_module_assets.get_entity(
                            ctx.root, asset_root_id, "handout", entity_id
                        )
                    except Exception:  # unreadable store entry is not a card
                        continue
                    if not isinstance(pack, dict):
                        continue
                    if str(pack.get("parse_state") or "") not in {
                        "deep",
                        "body_parsed",
                    }:
                        continue
                    if pack.get("evidence_gap"):
                        continue
                    try:
                        card = coc_module_project.handout_card_from_pack(pack)
                    except coc_module_project.ModuleProjectError:
                        continue
                    cards[card["asset_id"]] = card
        return cls(cards)

    def project(self, world: dict[str, Any], audience: str) -> dict[str, Any]:
        """Return the complete Keeper view or fail-closed player view."""
        if audience not in {"keeper", "player"}:
            raise HandoutError(
                "invalid_param",
                "handouts_projection must be 'keeper' or 'player'",
            )
        delivered = _delivered_ids(world)
        if audience == "player":
            player_ids = {
                asset_id
                for asset_id, card in self._cards.items()
                if asset_id in delivered and card.get("player_visible", True) is True
            }
            return {
                "projection": audience,
                "delivered_handout_ids": sorted(player_ids),
                "cards": [
                    _player_view(self._cards[asset_id], delivered)
                    for asset_id in sorted(player_ids)
                ],
            }

        card_rows: list[dict[str, Any]] = []
        for asset_id in sorted(self._cards):
            card = self._cards[asset_id]
            card_rows.append(
                {
                    "asset_id": asset_id,
                    "kind": card.get("kind"),
                    "title": card.get("title"),
                    "summary": card.get("summary"),
                    "when_to_deliver": card.get("when_to_deliver"),
                    "text": card.get("text"),
                    "localized_text": card.get("localized_text"),
                    "image_ref": card.get("image_ref"),
                    "source_refs": list(card.get("source_refs") or []),
                    "player_visible": card.get("player_visible", True) is True,
                    "scene_refs": list(card.get("scene_refs") or []),
                    "clue_refs": list(card.get("clue_refs") or []),
                    "delivered": asset_id in delivered,
                }
            )
        return {
            "projection": audience,
            "delivered_handout_ids": sorted(delivered),
            "cards": card_rows,
        }

    def deliver(self, world: dict[str, Any], handout_id: str) -> Delivery:
        """Apply one direct player delivery or fail closed with a stable error."""
        card = self._cards.get(handout_id)
        if card is None:
            raise HandoutError(
                "unknown_handout",
                f"handout '{handout_id}' is not a registered valid card",
            )
        if card.get("player_visible", True) is not True:
            raise HandoutError(
                "handout_not_player_visible",
                f"handout '{handout_id}' is marked player_visible:false — it is "
                "keeper-facing material and cannot be delivered to players; fix "
                "the card registration if player delivery was intended",
            )
        newly, already = _apply_delivery(world, [handout_id])
        return Delivery(
            asset_id=handout_id,
            newly=tuple(newly),
            already=tuple(already),
            delivered_total=len(_delivered_ids(world)),
            card=_player_view(card, {handout_id}),
        )

    def link_delivery(self, world: dict[str, Any], handout_id: str) -> LinkedDelivery:
        """Apply a clue-linked delivery when the registered card is player-safe."""
        card = self._cards.get(handout_id)
        if card is None:
            return LinkedDelivery(asset_id=None, newly=(), hidden_card=False)
        if card.get("player_visible", True) is not True:
            return LinkedDelivery(asset_id=None, newly=(), hidden_card=True)
        newly, _already = _apply_delivery(world, [handout_id])
        return LinkedDelivery(
            asset_id=handout_id,
            newly=tuple(newly),
            hidden_card=False,
        )

    def resolve_clue_delivery(
        self,
        world: dict[str, Any],
        clue_id: str,
        explicit_handout_id: str | None = None,
    ) -> LinkedDelivery:
        """Resolve one structured clue/card link, then apply it atomically.

        An explicit ``handout_asset_id`` and the final catalog's reverse
        ``clue_refs`` index are two assertions about one relationship.  A
        unique consistent player-visible card is required; silently choosing
        among conflicting or incomplete assertions would fabricate delivery
        truth and make behavior depend on merge order.
        """
        clue_id = str(clue_id).strip()
        explicit_id = str(explicit_handout_id or "").strip()
        reverse_ids = self._assets_by_clue.get(clue_id, ())

        if explicit_id and explicit_id not in self._cards:
            raise HandoutError(
                "unknown_handout",
                f"clue '{clue_id}' references unknown handout '{explicit_id}'",
            )
        if len(reverse_ids) > 1:
            raise HandoutError(
                "handout_link_ambiguous",
                f"clue '{clue_id}' is referenced by multiple handout cards: "
                f"{', '.join(reverse_ids)}",
            )
        if explicit_id and reverse_ids and reverse_ids[0] != explicit_id:
            raise HandoutError(
                "handout_link_conflict",
                f"clue '{clue_id}' explicitly references '{explicit_id}' but "
                f"card '{reverse_ids[0]}' claims the clue through clue_refs",
            )

        asset_id = explicit_id or (reverse_ids[0] if reverse_ids else "")
        if not asset_id:
            raise HandoutError(
                "handout_link_missing",
                f"clue '{clue_id}' has delivery_kind=handout but no unique "
                "handout_asset_id or card clue_refs linkage",
            )
        card = self._cards[asset_id]
        if card.get("player_visible", True) is not True:
            raise HandoutError(
                "handout_not_player_visible",
                f"handout '{asset_id}' linked to clue '{clue_id}' is marked "
                "player_visible:false and cannot satisfy player delivery",
            )
        newly, _already = _apply_delivery(world, [asset_id])
        return LinkedDelivery(
            asset_id=asset_id,
            newly=tuple(newly),
            hidden_card=False,
        )

    def opening_candidates(self, world: dict[str, Any]) -> list[dict[str, Any]]:
        """Return leak-free metadata for undelivered authored opening cards."""
        delivered = _delivered_ids(world)
        candidates: list[dict[str, Any]] = []
        for asset_id, card in sorted(self._cards.items()):
            if card.get("opening_card") is not True:
                continue
            if card.get("player_visible", True) is not True:
                continue
            if asset_id in delivered:
                continue
            candidates.append(
                {
                    "asset_id": asset_id,
                    "kind": card.get("kind"),
                    "title": card.get("title"),
                    "when_to_deliver": card.get("when_to_deliver"),
                }
            )
        return candidates


def _delivered_ids(world: dict[str, Any]) -> set[str]:
    return {
        str(value)
        for value in (world.get("delivered_handout_ids") or [])
        if str(value).strip()
    }


def _player_view(card: dict[str, Any], delivered: set[str]) -> dict[str, Any]:
    """Project one card across the hard player-knowledge boundary."""
    asset_id = str(card.get("asset_id"))
    player_visible = card.get("player_visible", True)
    if (
        asset_id not in delivered
        or not isinstance(player_visible, bool)
        or not player_visible
    ):
        return {
            "asset_id": asset_id,
            "delivered": False,
            "secret": True,
            "content_available_after": "state.deliver_handout",
        }
    view: dict[str, Any] = {
        "asset_id": asset_id,
        "kind": card.get("kind"),
        "title": card.get("title"),
        "text": card.get("localized_text") or card.get("text"),
        "localized_text": card.get("localized_text"),
        "image_ref": card.get("image_ref"),
        "source_refs": list(card.get("source_refs") or []),
        "player_visible": True,
        "delivered": True,
        "secret": False,
    }
    if isinstance(card.get("summary"), str):
        view["summary"] = card["summary"]
    return view


def _apply_delivery(
    world: dict[str, Any], handout_ids: list[str]
) -> tuple[list[str], list[str]]:
    """Idempotently append deliveries to the caller-owned authoritative world."""
    delivered = _delivered_ids(world)
    newly: list[str] = []
    already: list[str] = []
    for raw in handout_ids:
        handout_id = str(raw).strip()
        if not handout_id:
            continue
        if handout_id in delivered:
            already.append(handout_id)
            continue
        delivered.add(handout_id)
        newly.append(handout_id)
    if newly:
        world["delivered_handout_ids"] = sorted(delivered)
    return newly, already
