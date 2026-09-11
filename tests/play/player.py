#!/usr/bin/env python3
"""tests/play/player.py -- the persona player agent of player-persona-suite-v1.

See docs/specs/player-persona-benchmark.md sections 1-3. One of these is a *second* pi
process per run, with no tools, no extensions, no skills, no prompt templates, no context
files, an empty working directory and its own Pi home. It never sees the repo, the module,
the capsule, the Keeper's tool calls or the test criteria -- only the delivery a player
sees at the table (prose plus this turn's mechanics, contract section 16.2, with
keeper-visibility rolls removed).

Each turn it returns

    {"player_message": "...", "private_eval": {...}}

and only `player_message` is ever sent to the Keeper. `private_eval` is the test sidecar:
it tells the report what the player currently believes while the Keeper is kept ignorant of
it, which is how "the player guesses, the Keeper turns the guess into truth" becomes
measurable at all.

Run with `uv run --frozen python ...`; only the standard library is used.
"""
from __future__ import annotations

import json
import os
import queue
import shutil
import tempfile
import time
from pathlib import Path
from typing import Any

from driver import DriverLog, PiProcess, REPO_ROOT, now_iso

#: The isolation flags of spec section 1, invariant 1. Asserted, not assumed.
ISOLATION_FLAGS = (
    "--no-tools", "--no-extensions", "--no-skills",
    "--no-prompt-templates", "--no-context-files", "--no-session",
)

#: Credentials the player process needs to reach its own model, and nothing else.
CREDENTIAL_FILES = ("auth.json", "models.json")

DEFAULT_PLAYER_MODEL = "deepseek/deepseek-v4-pro"
PLAYER_TURN_TIMEOUT = 180.0
PLAYER_SETTLE_GRACE = 1.5

SYSTEM_PROMPT = """\
You are simulating a real tabletop RPG player at a Call of Cthulhu table.

You are not a test engineer, not an author, and not the Keeper. Your goal is not to help the
Keeper finish the scenario. Your goal is to play, naturally, as the player described by the
PLAYER PROFILE below.

You know only:
- what the Keeper has narrated to you
- your own investigator sheet as it has been shown to you
- information that has been made public in play
- what you yourself have lived through in this session

You do not have and must never use:
- the module text
- the Keeper's private information
- the story graph
- undiscovered clues
- NPC hidden motives
- any test criteria

Rules that matter:
1. Do not cooperate just to keep the story moving.
2. If your player would hesitate, err, misunderstand or wander off, do that.
3. You may form wrong hypotheses.
4. Guessing the truth as a language model does not let your character know it.
5. Your actions must follow from what your character currently knows.
6. Choose according to the PLAYER PROFILE's preferences.
7. You do not need to reach the best ending.
8. You do not need to keep your investigator alive.
9. Do not deliberately test the system unless the PLAYER PROFILE itself asks for that behaviour.

Every turn you receive the delivery the table's interface shows a player: the Keeper's prose,
and this turn's mechanical receipts as JSON rows (rolls, changes, clues, time, items). The
rows are the dice cards the interface draws; read them as a player reads their own sheet.
Numbers never appear in the prose, so the rows are the only place they are.

Answer with one JSON object and nothing else -- no code fence, no commentary:

{"player_message": "<one natural player turn, addressed to the table>",
 "private_eval": {"current_goal": "<short>",
                  "current_hypothesis": "<what you currently believe is going on>",
                  "hypothesis_confidence": <0.0-1.0>,
                  "perceived_agency": <0-10>,
                  "confusion": <0-10>,
                  "engagement": <0-10>,
                  "frustration": <0-10>}}

`player_message` is the only thing the Keeper receives; write it in {play_language} and keep it
to what a player would actually say or do in one turn. `private_eval` is never shown to the
Keeper; write it in English, honestly, including when you are bored, lost or annoyed.
"""

PROFILE_TEMPLATE = """\
PLAYER PROFILE

id: {id}
name: {name}
summary: {summary}

motivations (0.0-1.0):
{motivations}

behaviour:
{behavior}

how this player plays:
{special}

your investigator: {investigator}

{variation}
"""


def render_profile(persona: dict[str, Any], variation: str, investigator: str) -> str:
    motivations = "\n".join(f"  {k}: {v}" for k, v in sorted(persona["motivations"].items()))
    behavior = "\n".join(f"  {k}: {v}" for k, v in sorted(persona.get("behavior", {}).items()))
    special = "\n".join(f"  - {line}" for line in persona.get("special", []))
    return PROFILE_TEMPLATE.format(
        id=persona["id"], name=persona["name"], summary=persona["summary"],
        motivations=motivations, behavior=behavior, special=special,
        investigator=investigator, variation=variation,
    )


def player_view(delivery: dict | None, final_text: str, settle_class: str) -> str:
    """Spec section 2: prose plus this turn's mechanics, keeper-only rolls removed.

    Nothing here is rendered into words -- the rows go over as the kernel projected them
    (section 16.2 is language-neutral) because writing them into sentences would mean a
    per-language word table, which this product does not have and must not grow.
    """
    if settle_class != "settled":
        return ("[The table produced nothing this turn: the Keeper did not deliver. "
                "Say what you do next.]")
    prose = (delivery or {}).get("rendered_text") or final_text or ""
    rows = [row for row in ((delivery or {}).get("mechanics") or [])
            if not (isinstance(row, dict) and row.get("visibility") == "keeper")]
    if not rows:
        return prose
    shown = "\n".join(json.dumps(row, ensure_ascii=False, sort_keys=True) for row in rows)
    return f"{prose}\n\n[mechanics this turn]\n{shown}"


def parse_reply(text: str) -> tuple[dict | None, str | None]:
    """Take the one JSON object out of the persona's reply. Returns (parsed, error)."""
    if not text or not text.strip():
        return None, "empty reply"
    raw = text.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1]
        if raw.rstrip().endswith("```"):
            raw = raw.rstrip()[: -3]
    start, end = raw.find("{"), raw.rfind("}")
    if start < 0 or end <= start:
        return None, "no JSON object in reply"
    try:
        obj = json.loads(raw[start : end + 1])
    except ValueError as exc:
        return None, f"reply is not JSON: {exc}"
    if not isinstance(obj, dict):
        return None, "reply is not a JSON object"
    message = obj.get("player_message")
    if not isinstance(message, str) or not message.strip():
        return None, "player_message missing or empty"
    evaluation = obj.get("private_eval")
    return {"player_message": message.strip(),
            "private_eval": evaluation if isinstance(evaluation, dict) else {}}, None


class PersonaPlayer:
    """One persona, one isolated pi process, for the life of one run."""

    def __init__(self, persona: dict[str, Any], run_dir: Path, *, model: str = DEFAULT_PLAYER_MODEL,
                 play_language: str = "zh-Hans", variation: str = "", investigator: str = "",
                 credentials_from: Path | None = None, launcher: Path | None = None):
        self.persona = persona
        self.model = model
        self.dir = run_dir
        self.dir.mkdir(parents=True, exist_ok=True)
        self.log = DriverLog(self.dir / "player.log")
        # The prompt is full of JSON braces, so the language tag is substituted, not formatted.
        self.system_prompt = (SYSTEM_PROMPT.replace("{play_language}", play_language) + "\n"
                              + render_profile(persona, variation, investigator))
        (self.dir / "player-system-prompt.txt").write_text(self.system_prompt, encoding="utf-8")
        self._credentials_from = credentials_from or (REPO_ROOT / ".pi" / "coc-agent")
        self._launcher = launcher or (REPO_ROOT / "node_modules" / ".bin" / "pi")
        self._sandbox = Path(tempfile.mkdtemp(prefix=f"persona-{persona['id']}-"))
        self.pi: PiProcess | None = None
        self.isolation: dict[str, Any] = {}

    # -- lifecycle ---------------------------------------------------------

    def start(self) -> None:
        home = self._sandbox / "home"
        work = self._sandbox / "work"
        home.mkdir(parents=True)
        work.mkdir(parents=True)
        for name in CREDENTIAL_FILES:
            source = self._credentials_from / name
            if source.exists():
                target = home / name
                shutil.copy2(source, target)
                os.chmod(target, 0o600)
        # A home with nothing but credentials: no packages, no COC settings, no sessions.
        (home / "settings.json").write_text(json.dumps({"quietStartup": True}) + "\n", encoding="utf-8")

        provider, _, model_id = self.model.partition("/")
        args = [*ISOLATION_FLAGS, "--mode", "rpc",
                "--provider", provider, "--model", model_id,
                "--system-prompt", self.system_prompt]
        env = {k: v for k, v in os.environ.items()
               if not k.startswith(("PI_COC_", "PIPIUI_", "PI_CODING_AGENT_DIR"))}
        env["PI_CODING_AGENT_DIR"] = str(home)
        env["HOME"] = str(home)

        self.isolation = {
            "argv_flags": list(ISOLATION_FLAGS), "cwd": str(work), "pi_home": str(home),
            "repo_visible": False, "model": self.model,
            "system_prompt_sha256": _sha256(self.system_prompt),
        }
        self.log.write(f"starting persona {self.persona['id']} on {self.model} in {work}")
        self.pi = PiProcess(self._launcher, args, self.dir / "player-stderr.log",
                            self.dir / "player-events.jsonl", self.log, cwd=work, env=env)
        ready = self.pi.call({"type": "get_state"}, timeout=30.0)
        if ready is None or not ready.get("success", False):
            raise RuntimeError(f"persona player did not answer get_state (got {ready!r}); "
                               f"see {self.dir / 'player-stderr.log'}")

    def stop(self) -> None:
        if self.pi is not None:
            self.pi.terminate()
            self.pi = None
        shutil.rmtree(self._sandbox, ignore_errors=True)

    def __enter__(self) -> "PersonaPlayer":
        self.start()
        return self

    def __exit__(self, *exc: object) -> None:
        self.stop()

    # -- one turn ----------------------------------------------------------

    def act(self, view: str, *, timeout: float = PLAYER_TURN_TIMEOUT, retries: int = 1) -> dict[str, Any]:
        """Give the persona this turn's delivery; get back its message and its private eval."""
        attempt = 0
        last_error = "not attempted"
        raw = ""
        while attempt <= retries:
            raw = self._prompt(view if attempt == 0 else
                               view + "\n\n[Your last reply could not be read. Answer with one JSON "
                                      "object exactly as your instructions describe, and nothing else.]",
                               timeout)
            parsed, error = parse_reply(raw)
            if parsed is not None:
                return {"ok": True, "at": now_iso(), "attempts": attempt + 1, "raw": raw, **parsed}
            last_error = error or "unparseable"
            self.log.write(f"persona reply rejected (attempt {attempt + 1}): {last_error}")
            attempt += 1
        return {"ok": False, "at": now_iso(), "attempts": attempt, "raw": raw,
                "error": last_error, "player_message": None, "private_eval": {}}

    def _prompt(self, message: str, timeout: float) -> str:
        assert self.pi is not None, "PersonaPlayer.start() was not called"
        tq = self.pi.begin_turn()
        deadline = time.monotonic() + timeout
        try:
            ack = self.pi.call({"type": "prompt", "message": message},
                               timeout=max(0.001, deadline - time.monotonic()))
            if ack is None or not ack.get("success", False):
                self.pi.call({"type": "abort"}, timeout=5.0)
                return ""
            parts: list[str] = []
            final: list[str] = []
            settle_deadline: float | None = None
            while True:
                wake = min(x for x in (settle_deadline, deadline) if x is not None)
                wait_for = wake - time.monotonic()
                if wait_for <= 0:
                    break
                try:
                    event = tq.get(timeout=wait_for)
                except queue.Empty:
                    continue
                etype = event.get("type")
                if etype == "message_update":
                    ev = event.get("assistantMessageEvent") or {}
                    if ev.get("type") == "text_delta":
                        parts.append(ev.get("delta") or "")
                elif etype == "message_end":
                    msg = event.get("message") or {}
                    if msg.get("role") == "assistant":
                        final = [b.get("text") or "" for b in msg.get("content") or []
                                 if isinstance(b, dict) and b.get("type") == "text"]
                elif etype == "agent_settled":
                    break
                elif etype == "agent_end" and not event.get("willRetry"):
                    settle_deadline = time.monotonic() + PLAYER_SETTLE_GRACE
                if not self.pi.alive():
                    break
            return ("".join(final) or "".join(parts)).strip()
        finally:
            self.pi.end_turn()


def _sha256(text: str) -> str:
    import hashlib
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def load_persona(path: Path) -> dict[str, Any]:
    from persona_metrics import METRICS, MOTIVATIONS
    persona = json.loads(path.read_text(encoding="utf-8"))
    for field in ("id", "name", "kind", "summary", "motivations", "behavior", "special",
                  "natural_investigator", "probes", "assertions"):
        if field not in persona:
            raise ValueError(f"{path.name}: persona is missing {field!r}")
    unknown = set(persona["motivations"]) - set(MOTIVATIONS)
    if unknown:
        raise ValueError(f"{path.name}: motivations outside the closed activity set: {sorted(unknown)}")
    for metric_id in persona["assertions"]:
        if metric_id not in METRICS:
            raise ValueError(f"{path.name}: names unregistered metric {metric_id!r} -- register it in "
                             f"tests/play/persona_metrics.py first (spec section 6)")
    return persona


def load_personas(directory: Path | None = None) -> dict[str, dict[str, Any]]:
    directory = directory or (Path(__file__).resolve().parent / "personas")
    out: dict[str, dict[str, Any]] = {}
    for path in sorted(directory.glob("*.json")):
        persona = load_persona(path)
        out[persona["id"]] = persona
    return out


if __name__ == "__main__":
    personas = load_personas()
    print(f"{len(personas)} personas load cleanly: {', '.join(sorted(personas))}")
