"""The craft face of the capsule (contract §13.6): `content/craft/text-graph.json` read
for four node kinds only (`play-register`, `style-axis`, `craft-directive`, `beat-type`),
the closed beat -> directive table `content/craft/beat-directives.json`, and the `style`
section built from them.

Same fail-closed law as the Director graph: a missing or digest-mismatched text graph,
or a beat table naming a directive the graph does not have, is an error at load; the
kernel never falls back to lines written in code."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .errors import RpcError
from .fileio import read_json
from .rules.graph_digest import compute_graph_content_digest

GRAPH_CONTRACT_ID = "coc.text-graph.v1"
MANIFEST_CONTRACT_ID = "coc.text-graph-build-manifest.v1"
TABLE_CONTRACT_ID = "coc.beat-directives.v1"
READ_KINDS = ("play-register", "style-axis", "craft-directive", "beat-type")
MAX_DIRECTIVES_PER_BEAT = 4
DEFAULT_REGISTER = "purist"


class CraftError(RpcError):
    def __init__(self, message: str, **details: Any) -> None:
        super().__init__("campaign_not_ready", f"the craft content is not usable: {message}",
                         fix="restore content/craft/text-graph.json, its manifest and beat-directives.json",
                         details={"craft": {"reason": message, **details}})


class TextGraph:
    def __init__(self, directory: Path, beats: list[str]) -> None:
        self.dir = Path(directory)
        try:
            graph = read_json(self.dir / "text-graph.json")
            manifest = read_json(self.dir / "text-graph-manifest.json")
            table = read_json(self.dir / "beat-directives.json")
        except (OSError, ValueError) as exc:
            raise CraftError(f"artifact unreadable: {exc}")
        if not isinstance(graph, dict) or graph.get("contract_id") != GRAPH_CONTRACT_ID:
            raise CraftError(f"text graph does not declare {GRAPH_CONTRACT_ID}")
        if not isinstance(manifest, dict) or manifest.get("contract_id") != MANIFEST_CONTRACT_ID:
            raise CraftError(f"text graph manifest does not declare {MANIFEST_CONTRACT_ID}")
        if not isinstance(graph.get("nodes"), list):
            raise CraftError("text graph has no node list")
        declared = manifest.get("graph_content_digest")
        actual = compute_graph_content_digest(graph)
        if declared != actual:
            raise CraftError("text graph content digest does not match the manifest", declared=declared, actual=actual)
        self.digest = actual
        self.nodes: dict[str, dict[str, Any]] = {n["node_id"]: n for n in graph["nodes"]
                                                 if isinstance(n, dict) and isinstance(n.get("node_id"), str)}
        self.registers: list[str] = [str(n["properties"]["legacy_key"]) for n in self._ordered("play-register")]
        self.axes: list[dict[str, Any]] = self._ordered("style-axis")
        self.directives: dict[str, dict[str, Any]] = {str(n["properties"]["directive_id"]): n
                                                      for n in self._ordered("craft-directive")}
        self.beat_types: list[str] = [str(n["properties"]["legacy_key"]) for n in self._ordered("beat-type")]
        if not self.registers or not self.axes or not self.directives:
            raise CraftError("text graph declares no registers, axes or directives")
        if not isinstance(table, dict) or table.get("contract_id") != TABLE_CONTRACT_ID:
            raise CraftError(f"beat-directives.json does not declare {TABLE_CONTRACT_ID}")
        self.beat_table: dict[str, list[str]] = {}
        problems: list[str] = []
        for beat in beats:
            ids = (table.get("beats") or {}).get(beat)
            if not isinstance(ids, list):
                problems.append(f"beat {beat} has no directive list")
                continue
            if len(ids) > MAX_DIRECTIVES_PER_BEAT:
                problems.append(f"beat {beat} lists {len(ids)} directives (max {MAX_DIRECTIVES_PER_BEAT})")
            unknown = [d for d in ids if d not in self.directives]
            if unknown:
                problems.append(f"beat {beat} names directives the text graph lacks: {unknown}")
            self.beat_table[beat] = [str(d) for d in ids]
        extra = sorted(set(table.get("beats") or {}) - set(beats))
        if extra:
            problems.append(f"beat table names beats the Director lacks: {extra}")
        if problems:
            raise CraftError("beat-directives.json disagrees with the text graph", problems=problems)
        # §16.1: one English line per axis and per directive; the keeper carries them into
        # the player's language itself.
        self.axis_lines: dict[str, str] = {str(k): v for k, v in (table.get("axis_lines") or {}).items() if isinstance(v, str)}
        self.directive_lines: dict[str, str] = {str(k): v for k, v in (table.get("directive_lines") or {}).items()
                                                if isinstance(v, str)}

    def _ordered(self, kind: str) -> list[dict[str, Any]]:
        rows = [(n["properties"]["ordinal"], node_id, n) for node_id, n in self.nodes.items() if n.get("node_kind") == kind]
        return [n for _, _, n in sorted(rows, key=lambda row: (row[0], row[1]))]

    # ---- the style section --------------------------------------------------------------

    @staticmethod
    def _line(table: dict[str, str], key: str, fallback: str) -> str:
        return str(table.get(key) or fallback)

    def axis_lines_for(self, language: str) -> list[str]:
        out = []
        for node in self.axes:
            props = node.get("properties") or {}
            applies = str(props.get("language_applicability") or "all")
            if applies != "all" and applies != language:
                continue
            out.append(self._line(self.axis_lines, str(node["node_id"]), str(node.get("name") or node["node_id"])))
        return out

    def directive_rows(self, ids: list[str]) -> list[dict[str, str]]:
        return [{"id": d, "line": self._line(self.directive_lines, d, str(self.directives[d].get("rationale") or d))}
                for d in ids]

    def style_section(self, *, language: str, register: str, beat: str, full: bool) -> dict[str, Any]:
        ids = list(self.directives) if full else list(self.beat_table.get(beat, []))
        return {"language": language, "register": register, "axes": self.axis_lines_for(language),
                "directives": self.directive_rows(ids)}
