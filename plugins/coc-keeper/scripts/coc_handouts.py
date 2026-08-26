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

import hashlib
import importlib.util
import json
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
    presentation: dict[str, Any] | None


@dataclass(frozen=True)
class LinkedDelivery:
    """Best-effort clue linkage without weakening direct-delivery policy."""

    asset_id: str | None
    newly: tuple[str, ...]
    hidden_card: bool
    presentation: dict[str, Any] | None = None


@dataclass(frozen=True)
class Replay:
    """One explicit re-presentation of an already-delivered material."""

    asset_id: str
    card: dict[str, Any]
    presentation: dict[str, Any]
    request_assertion: dict[str, Any]
    already_consumed: bool = False


class HandoutCatalog:
    """Validated campaign card catalog with projection and delivery policy."""

    def __init__(
        self,
        cards: dict[str, dict[str, Any]],
        *,
        play_language: str = "zh-Hans",
    ):
        self._cards = cards
        self._play_language = play_language

    @classmethod
    def load(cls, ctx: Any) -> HandoutCatalog:
        """Load valid cards in authority order: index, campaign IR, deep entity."""
        cards: dict[str, dict[str, Any]] = {}
        if ctx.campaign_dir is None:
            return cls(cards)
        play_language = "zh-Hans"
        campaign_path = ctx.campaign_dir / "campaign.json"
        try:
            campaign = json.loads(
                campaign_path.read_text(encoding="utf-8")
            )
            if isinstance(campaign, dict) and isinstance(
                campaign.get("play_language"), str
            ) and campaign["play_language"].strip():
                play_language = campaign["play_language"].strip()
        except (OSError, ValueError):
            pass

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

        asset_root_ids = coc_module_project.campaign_handout_asset_root_ids(
            ctx.campaign_dir
        )
        for asset_root_id in asset_root_ids:
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
        return cls(cards, play_language=play_language)

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
                    _player_view(
                        self._cards[asset_id], delivered, self._play_language
                    )
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
                    "content_origin": card.get(
                        "content_origin", "source_verbatim"
                    ),
                    "title": _display_value(
                        card, "title", self._play_language
                    ),
                    "summary": _display_value(
                        card, "summary", self._play_language
                    ),
                    "when_to_deliver": card.get("when_to_deliver"),
                    "text": card.get("text") or card.get("authored_text"),
                    "authored_text": card.get("authored_text"),
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
        player_card = _player_view(card, {handout_id}, self._play_language)
        newly, already = _apply_delivery(world, [handout_id])
        presentation = (
            _create_presentation(world, handout_id, first_delivery=True)
            if newly
            else None
        )
        return Delivery(
            asset_id=handout_id,
            newly=tuple(newly),
            already=tuple(already),
            delivered_total=len(_delivered_ids(world)),
            card=player_card,
            presentation=presentation,
        )

    def link_delivery(self, world: dict[str, Any], handout_id: str) -> LinkedDelivery:
        """Apply a clue-linked delivery when the registered card is player-safe."""
        card = self._cards.get(handout_id)
        if card is None:
            return LinkedDelivery(asset_id=None, newly=(), hidden_card=False)
        if card.get("player_visible", True) is not True:
            return LinkedDelivery(asset_id=None, newly=(), hidden_card=True)
        # Linked first delivery has the same player-language boundary as a
        # direct delivery; never entitle a card whose body cannot be shown.
        _player_view(card, {handout_id}, self._play_language)
        newly, _already = _apply_delivery(world, [handout_id])
        return LinkedDelivery(
            asset_id=handout_id,
            newly=tuple(newly),
            hidden_card=False,
            presentation=(
                _create_presentation(world, handout_id, first_delivery=True)
                if newly
                else None
            ),
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
        try:
            asset_id = coc_scenario.resolve_handout_clue_link(
                self._cards, clue_id, explicit_handout_id
            )
        except coc_scenario.HandoutLinkError as exc:
            raise HandoutError(exc.code, exc.message) from exc
        card = self._cards[asset_id]
        _player_view(card, {asset_id}, self._play_language)
        newly, _already = _apply_delivery(world, [asset_id])
        return LinkedDelivery(
            asset_id=asset_id,
            newly=tuple(newly),
            hidden_card=False,
            presentation=(
                _create_presentation(world, asset_id, first_delivery=True)
                if newly
                else None
            ),
        )

    def replay(
        self,
        world: dict[str, Any],
        handout_id: str,
        *,
        request_assertion: dict[str, Any],
    ) -> Replay:
        """Consume one explicit-request authority per asset and player epoch."""
        card = self._cards.get(handout_id)
        if card is None:
            raise HandoutError(
                "unknown_handout",
                f"handout '{handout_id}' is not a registered valid card",
            )
        if card.get("player_visible", True) is not True:
            raise HandoutError(
                "handout_not_player_visible",
                f"handout '{handout_id}' is not player-visible",
            )
        if handout_id not in _delivered_ids(world):
            raise HandoutError(
                "handout_not_delivered",
                f"handout '{handout_id}' must be delivered before it can be replayed",
            )
        receipts = _replay_receipts(world)
        player_turn_epoch = int(request_assertion["player_turn_epoch"])
        player_text_sha256 = str(request_assertion["player_text_sha256"])
        epoch_key = str(player_turn_epoch)
        prior = receipts.get(handout_id, {}).get(epoch_key)
        if prior is not None:
            if prior["player_text_sha256"] != player_text_sha256:
                raise HandoutError(
                    "replay_epoch_conflict",
                    "the asset replay authority for this player epoch was already "
                    "consumed by different provenance",
                )
            return Replay(
                asset_id=handout_id,
                card=_player_view(card, {handout_id}, self._play_language),
                presentation=dict(prior["presentation"]),
                request_assertion=json.loads(json.dumps(prior["request_assertion"])),
                already_consumed=True,
            )
        presentation = _create_presentation(
            world, handout_id, first_delivery=False
        )
        asset_receipts = receipts.setdefault(handout_id, {})
        asset_receipts[epoch_key] = {
            "player_text_sha256": player_text_sha256,
            "presentation": dict(presentation),
            "request_assertion": json.loads(json.dumps(request_assertion)),
        }
        world["handout_replay_receipts"] = receipts
        return Replay(
            asset_id=handout_id,
            card=_player_view(card, {handout_id}, self._play_language),
            presentation=presentation,
            request_assertion=json.loads(json.dumps(request_assertion)),
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
                    "title": _display_value(
                        card, "title", self._play_language
                    ),
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


def _display_value(
    card: dict[str, Any], field: str, play_language: str
) -> Any:
    localized = card.get(f"localized_{field}")
    if isinstance(localized, dict):
        language_candidates = [play_language]
        base_language = play_language.split("-", 1)[0]
        if base_language not in language_candidates:
            language_candidates.append(base_language)
        if base_language == "zh":
            language_candidates.extend(["zh-Hans", "zh"])
        for language in language_candidates:
            value = localized.get(language)
            if isinstance(value, str) and value.strip():
                return value
    localized_language = str(card.get("localized_language") or "").strip()
    if isinstance(localized, str) and localized.strip() and (
        not localized_language or localized_language == play_language
    ):
        return localized
    return card.get(field)


def _localized_card_value(
    card: dict[str, Any], field: str, play_language: str
) -> str | None:
    value = card.get(field)
    if isinstance(value, dict):
        localized = value.get(play_language)
        return localized.strip() if isinstance(localized, str) and localized.strip() else None
    if isinstance(value, str) and value.strip():
        tagged_language = card.get("localized_language")
        if isinstance(tagged_language, str) and tagged_language.strip():
            return value.strip() if tagged_language.strip() == play_language else None
        if card.get("kind") != "read_aloud":
            return value.strip()
    return None


def _player_view(
    card: dict[str, Any], delivered: set[str], play_language: str
) -> dict[str, Any]:
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
    read_aloud = card.get("kind") == "read_aloud"
    localized_title = _localized_card_value(
        card, "localized_title", play_language
    )
    localized_text = _localized_card_value(card, "localized_text", play_language)
    if read_aloud and (localized_title is None or localized_text is None):
        raise HandoutError(
            "handout_locale_missing",
            f"read-aloud card '{asset_id}' lacks full title/body for active "
            f"play_language {play_language!r}",
        )
    display_text = (
        localized_text
        if read_aloud
        else _display_value(card, "text", play_language)
        or card.get("authored_text")
    )
    if not read_aloud:
        localized_text = (
            display_text
            if display_text not in {card.get("text"), card.get("authored_text")}
            else None
        )
    view: dict[str, Any] = {
        "asset_id": asset_id,
        "kind": card.get("kind"),
        "content_origin": card.get("content_origin", "source_verbatim"),
        "title": (
            localized_title
            if read_aloud
            else _display_value(card, "title", play_language)
        ),
        "text": display_text,
        "localized_text": localized_text,
        "image_ref": card.get("image_ref"),
        "source_refs": (
            list(card.get("source_refs") or [])
            if card.get("content_origin", "source_verbatim")
            == "source_verbatim"
            else []
        ),
        "player_visible": True,
        "delivered": True,
        "secret": False,
    }
    summary = _display_value(card, "summary", play_language)
    if isinstance(summary, str):
        view["summary"] = summary
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


def _presentation_revisions(world: dict[str, Any]) -> dict[str, int]:
    raw = world.get("handout_presentation_revisions")
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise HandoutError(
            "state_corrupt", "handout_presentation_revisions must be an object"
        )
    revisions: dict[str, int] = {}
    for raw_id, raw_revision in raw.items():
        asset_id = str(raw_id).strip()
        if (
            not asset_id
            or isinstance(raw_revision, bool)
            or not isinstance(raw_revision, int)
            or raw_revision < 1
        ):
            raise HandoutError(
                "state_corrupt",
                "handout_presentation_revisions contains an invalid row",
            )
        revisions[asset_id] = raw_revision
    return revisions


def _replay_receipts(
    world: dict[str, Any],
) -> dict[str, dict[str, dict[str, Any]]]:
    raw = world.get("handout_replay_receipts")
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise HandoutError(
            "state_corrupt", "handout_replay_receipts must be an object"
        )
    receipts: dict[str, dict[str, dict[str, Any]]] = {}
    for raw_asset_id, raw_epochs in raw.items():
        asset_id = str(raw_asset_id).strip()
        if not asset_id or not isinstance(raw_epochs, dict):
            raise HandoutError(
                "state_corrupt", "handout_replay_receipts contains an invalid asset row"
            )
        epochs: dict[str, dict[str, Any]] = {}
        for raw_epoch, raw_receipt in raw_epochs.items():
            epoch = str(raw_epoch)
            presentation = (
                raw_receipt.get("presentation")
                if isinstance(raw_receipt, dict)
                else None
            )
            assertion = (
                raw_receipt.get("request_assertion")
                if isinstance(raw_receipt, dict)
                else None
            )
            assertion_text = (
                assertion.get("player_text") if isinstance(assertion, dict) else None
            )
            expected_assertion_sha = (
                "sha256:" + hashlib.sha256(assertion_text.encode("utf-8")).hexdigest()
                if isinstance(assertion_text, str) and assertion_text.strip()
                else None
            )
            if (
                not epoch.isdigit()
                or int(epoch) < 1
                or not isinstance(raw_receipt, dict)
                or not isinstance(raw_receipt.get("player_text_sha256"), str)
                or not raw_receipt["player_text_sha256"].startswith("sha256:")
                or not isinstance(presentation, dict)
                or presentation.get("asset_id") != asset_id
                or not isinstance(presentation.get("presentation_id"), str)
                or isinstance(presentation.get("revision"), bool)
                or not isinstance(presentation.get("revision"), int)
                or presentation["revision"] < 2
                or presentation.get("presentation_id")
                != f"{asset_id}:presentation:{presentation['revision']}"
                or not isinstance(assertion, dict)
                or assertion.get("explicit_player_request") is not True
                or not isinstance(assertion.get("semantic_reason"), str)
                or not assertion["semantic_reason"].strip()
                or assertion.get("player_turn_epoch") != int(epoch)
                or assertion.get("player_text_sha256")
                != raw_receipt.get("player_text_sha256")
                or assertion.get("player_text_sha256") != expected_assertion_sha
            ):
                raise HandoutError(
                    "state_corrupt", "handout_replay_receipts contains an invalid receipt"
                )
            epochs[epoch] = {
                "player_text_sha256": raw_receipt["player_text_sha256"],
                "presentation": dict(presentation),
                "request_assertion": json.loads(json.dumps(assertion)),
            }
        receipts[asset_id] = epochs
    return receipts


def _create_presentation(
    world: dict[str, Any],
    asset_id: str,
    *,
    first_delivery: bool,
) -> dict[str, Any]:
    revisions = _presentation_revisions(world)
    current = revisions.get(asset_id, 0)
    revision = 1 if first_delivery else max(current, 1) + 1
    if first_delivery and current:
        raise HandoutError(
            "state_corrupt",
            f"new delivery '{asset_id}' already owns presentation revision {current}",
        )
    revisions[asset_id] = revision
    world["handout_presentation_revisions"] = dict(sorted(revisions.items()))
    return {
        "presentation_id": f"{asset_id}:presentation:{revision}",
        "asset_id": asset_id,
        "revision": revision,
    }
