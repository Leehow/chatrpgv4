"""Name normalization and slugs. Every model-visible identifier passes through here."""

from __future__ import annotations

import re
import unicodedata

_SEPARATORS = re.compile(r"[\s_\-]+")
_NON_WORD = re.compile(r"[^0-9a-z\u3400-\u9fff\uf900-\ufaff]+")
_LATIN = re.compile(r"[a-z0-9]")


def normalize(name: str) -> str:
    """Case, width and separator insensitive key: 'Hall-of-Records' == 'hall of records'."""
    text = unicodedata.normalize("NFKC", str(name)).lower()
    return _SEPARATORS.sub(" ", text).strip()


def normalize_text(text: str) -> str:
    """Looser form for scanning prose: all punctuation becomes a single space."""
    lowered = unicodedata.normalize("NFKC", str(text)).lower()
    return _NON_WORD.sub(" ", lowered).strip()


def kebab(name: str) -> str:
    """'Spot Hidden' -> 'spot-hidden'; 'Firearms (Rifle/Shotgun)' -> 'firearms-rifle-shotgun'."""
    return "-".join(normalize_text(name).split())


def slugify(text: str, limit: int = 24) -> str:
    slug = kebab(text)
    if len(slug) > limit:
        slug = slug[:limit].rstrip("-")
    return slug or "choice"


def is_latin(term: str) -> bool:
    return bool(_LATIN.search(term))


def strip_prefix(node_id: str, kind: str) -> str:
    prefix = f"{kind}-"
    return node_id[len(prefix):] if node_id.startswith(prefix) else node_id
