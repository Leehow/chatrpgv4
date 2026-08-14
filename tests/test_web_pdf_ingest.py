"""Hermetic component tests for the web bridges' PDF ingest endpoint.

POST /api/uploads/pdf/ingest shells out to the external firecrawl
pdf-inspector router (never inside the repository) and validates the
produced bundle through plugins/coc-keeper/scripts/coc_pdf_bundle.py.

These tests exercise the Python bridge (web/server/app.py) as a real local
HTTP server subprocess against a tmp workspace. The external router is
replaced by a fake stand-in script selected through
COC_PI_PDF_INSPECTOR_COMMAND, mirroring the hermetic pattern of
tests/test_pi_pdf_inspector_router.py: no network, no real PDF parsing,
no writes outside the per-test tmp workspace.
"""
from __future__ import annotations

import hashlib
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "web" / "server" / "app.py"
RESULT_CONTRACT = "coc.pi-pdf-inspector-result.v1"
REQUEST_CONTRACT = "coc.pi-pdf-inspector-request.v1"

# Small enough that the default first window (0..31) never triggers the
# detached background second window during tests.
FAKE_PAGE_COUNT = 32


# ---------------------------------------------------------------------------
# Fake external router (coc.pi-pdf-inspector-request.v1 stand-in)
# ---------------------------------------------------------------------------

_FAKE_ROUTER_SOURCE = '''
import hashlib
import json
import os
import sys
from pathlib import Path

request = json.loads(sys.stdin.read())
state_path = Path(os.environ["FAKE_ROUTER_STATE"])
log_path = Path(os.environ["FAKE_ROUTER_LOG"])
mode = os.environ.get("FAKE_ROUTER_MODE", "ok")

calls = 0
if state_path.exists():
    calls = int(state_path.read_text(encoding="utf-8").strip() or "0")
state_path.write_text(str(calls + 1), encoding="utf-8")
with log_path.open("a", encoding="utf-8") as handle:
    handle.write(json.dumps(request, ensure_ascii=False) + "\\n")


def emit(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False))
    sys.exit(0)


if mode == "bad_output":
    print("this is not a result envelope")
    sys.exit(0)

indices = list(request.get("missing_pdf_indices") or [])
bundle = Path(request["source_bundle_path"])
source = request["source"]

if mode == "ocr_fallback" and calls == 0:
    ocr_pages = [
        int(item)
        for item in os.environ.get("FAKE_ROUTER_OCR_PAGES", "").split(",")
        if item.strip()
    ]
    emit({
        "schema_version": 1,
        "contract_id": os.environ["FAKE_RESULT_CONTRACT"],
        "status": "fallback",
        "reason": "needs_ocr",
        "pages_needing_ocr_0indexed": ocr_pages,
    })

# Write a minimal schema-v1 bundle that coc_pdf_bundle.py accepts.
pages_dir = bundle / "pages"
pages_dir.mkdir(parents=True, exist_ok=True)
rows = []
for index in indices:
    content = f"# Page {index + 1}\\n\\nExtracted text {index}.\\n"
    raw = content.encode("utf-8")
    (pages_dir / f"{index:04d}.md").write_bytes(raw)
    rows.append({
        "pdf_index": index,
        "printed_page": index + 1,
        "markdown_path": f"pages/{index:04d}.md",
        "text_sha256": hashlib.sha256(raw).hexdigest(),
        "review_state": "auto_accepted",
        "parse_confidence": 0.9,
        "grep_anchors": [f"# Page {index + 1}"],
    })
manifest = {
    "schema_version": 1,
    "producer": request.get("manifest_producer_literal", "codex-pdf-skill"),
    "source": {
        "source_id": source["source_id"],
        "title": source["title"],
        "path": source["path"],
        "file_sha256": source["file_sha256"],
        "page_count": int(os.environ.get("FAKE_PAGE_COUNT", "32")),
    },
    "pages": rows,
    "assets": [],
}
(bundle / "manifest.json").write_text(
    json.dumps(manifest, ensure_ascii=False), encoding="utf-8"
)
emit({
    "schema_version": 1,
    "contract_id": os.environ["FAKE_RESULT_CONTRACT"],
    "status": "ok",
    "source_bundle_path": str(bundle),
    "rendered_pdf_indices": sorted(indices),
})
'''


def _write_fake_router(tmp_path: Path) -> Path:
    script = tmp_path / "fake_router.py"
    script.write_text(f"#!{sys.executable}\n{_FAKE_ROUTER_SOURCE}", encoding="utf-8")
    script.chmod(0o755)
    return script


# ---------------------------------------------------------------------------
# Local Python-bridge server harness (tmp workspace only)
# ---------------------------------------------------------------------------


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class _BridgeServer:
    def __init__(self, tmp_path: Path, env_extra: dict[str, str] | None = None):
        self.workspace = tmp_path / "workspace"
        self.workspace.mkdir(parents=True, exist_ok=True)
        self.port = _free_port()
        self.log_path = tmp_path / "server.log"
        env = {
            **os.environ,
            "FAKE_ROUTER_STATE": str(tmp_path / "router-state"),
            "FAKE_ROUTER_LOG": str(tmp_path / "router-requests.jsonl"),
            "FAKE_RESULT_CONTRACT": RESULT_CONTRACT,
            "FAKE_PAGE_COUNT": str(FAKE_PAGE_COUNT),
        }
        if env_extra:
            env.update(env_extra)
        self._log = open(self.log_path, "wb")
        self._proc = subprocess.Popen(
            [
                sys.executable,
                str(APP),
                "--workspace",
                str(self.workspace),
                "--port",
                str(self.port),
            ],
            cwd=str(ROOT),
            env=env,
            stdout=self._log,
            stderr=subprocess.STDOUT,
        )
        self._wait_ready()

    def _wait_ready(self, timeout: float = 30.0) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self._proc.poll() is not None:
                self._log.flush()
                tail = self.log_path.read_text(encoding="utf-8", errors="replace")
                raise RuntimeError(f"server exited early:\n{tail[-2000:]}")
            try:
                with urllib.request.urlopen(
                    f"http://127.0.0.1:{self.port}/api/health", timeout=2
                ) as response:
                    if response.status == 200:
                        return
            except (urllib.error.URLError, TimeoutError, OSError):
                time.sleep(0.2)
        raise RuntimeError("server did not become ready in time")

    def post(self, path: str, payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.port}{path}",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.status, json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read().decode("utf-8"))

    def router_requests(self) -> list[dict[str, Any]]:
        path = self.log_path.parent / "router-requests.jsonl"
        if not path.is_file():
            return []
        return [
            json.loads(line)
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]

    def router_call_count(self) -> int:
        path = self.log_path.parent / "router-state"
        if not path.is_file():
            return 0
        return int(path.read_text(encoding="utf-8").strip() or "0")

    def close(self) -> None:
        self._proc.terminate()
        try:
            self._proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self._proc.kill()
            self._proc.wait(timeout=10)
        self._log.close()


def _register_pdf(workspace: Path, name: str, data: bytes) -> tuple[Path, str]:
    """Register a PDF exactly like POST /api/uploads/pdf does."""
    digest = hashlib.sha256(data).hexdigest()
    directory = workspace / ".coc" / "uploads" / "pdfs"
    directory.mkdir(parents=True, exist_ok=True)
    stored = directory / f"{digest[:16]}_{name}"
    stored.write_bytes(data)
    return stored, digest


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_ingest_success_path_builds_validated_bundle(tmp_path: Path):
    router = _write_fake_router(tmp_path)
    server = _BridgeServer(
        tmp_path, env_extra={"COC_PI_PDF_INSPECTOR_COMMAND": str(router)}
    )
    try:
        _register_pdf(server.workspace, "smoke_module.pdf", b"%PDF-1.4\nsmoke\n")
        stored_digest = hashlib.sha256(b"%PDF-1.4\nsmoke\n").hexdigest()

        status, body = server.post(
            "/api/uploads/pdf/ingest", {"file_sha256": stored_digest}
        )
        assert status == 200, body
        assert body["ok"] is True
        result = body["result"]
        assert result["status"] == "matched_bundle"
        assert result["validation"] == "passed"
        assert result["file_sha256"] == stored_digest
        assert result["bundle_id"] == "smoke-module"
        assert result["page_count"] == FAKE_PAGE_COUNT
        assert result["rendered_pdf_indices"] == list(range(FAKE_PAGE_COUNT))
        assert result["skipped_ocr_pdf_indices"] == []
        assert result["background_window"] is None
        assert result["message"] == "解析完成，已生成合法源包，可以开局。"

        # matched_bundle resolved from the freshly written manifest.
        matched = result["matched_bundle"]
        assert matched is not None
        assert str(matched.get("file_sha256")) == stored_digest

        # Bundle + canonical validation receipt live under the tmp workspace.
        bundle_dir = server.workspace / ".coc" / "source-bundles" / "smoke-module"
        assert (bundle_dir / "manifest.json").is_file()
        assert str(result["source_bundle_path"]) == str(bundle_dir.resolve())
        receipt = (
            server.workspace
            / ".coc"
            / "pdf-cache"
            / "bundle-validation"
            / "smoke-module.json"
        )
        assert receipt.is_file()

        # The router received the exact coc.pi-pdf-inspector-request.v1 envelope.
        requests = server.router_requests()
        assert len(requests) == 1
        envelope = requests[0]
        assert envelope["schema_version"] == 1
        assert envelope["contract_id"] == REQUEST_CONTRACT
        assert envelope["mode"] == "full_parse_batch"
        assert envelope["missing_pdf_indices"] == list(range(FAKE_PAGE_COUNT))
        assert envelope["manifest_producer_literal"] == "codex-pdf-skill"
        assert envelope["source"]["file_sha256"] == stored_digest
        assert envelope["source"]["source_id"] == "pdf:smoke-module"
        assert envelope["source_bundle_path"] == str(bundle_dir)

        # Idempotency: a second ingest reuses the validated bundle and does
        # not call the external router again.
        status2, body2 = server.post(
            "/api/uploads/pdf/ingest", {"file_sha256": stored_digest}
        )
        assert status2 == 200
        assert body2["result"]["status"] == "matched_bundle"
        assert body2["result"]["message"] == "已存在校验通过的源包，直接复用，可以开局。"
        assert server.router_call_count() == 1
    finally:
        server.close()


def test_ingest_router_unavailable_fails_closed_503(tmp_path: Path):
    empty_home = tmp_path / "empty-home"
    empty_home.mkdir()
    server = _BridgeServer(
        tmp_path,
        env_extra={
            # Both candidates must miss: the configured path and the default
            # ~/.pi install (HOME points at an empty directory here).
            "COC_PI_PDF_INSPECTOR_COMMAND": str(tmp_path / "missing-router"),
            "HOME": str(empty_home),
        },
    )
    try:
        _register_pdf(server.workspace, "lost_module.pdf", b"%PDF-1.4\nlost\n")
        digest = hashlib.sha256(b"%PDF-1.4\nlost\n").hexdigest()
        status, body = server.post(
            "/api/uploads/pdf/ingest", {"file_sha256": digest}
        )
        assert status == 503, body
        assert "路由器" in body["error"]
        assert "COC_PI_PDF_INSPECTOR_COMMAND" in body["error"]
        assert server.router_call_count() == 0
        assert not (server.workspace / ".coc" / "source-bundles").exists()
    finally:
        server.close()


def test_ingest_unregistered_pdf_404(tmp_path: Path):
    router = _write_fake_router(tmp_path)
    server = _BridgeServer(
        tmp_path, env_extra={"COC_PI_PDF_INSPECTOR_COMMAND": str(router)}
    )
    try:
        unknown_sha = "b" * 64
        status, body = server.post(
            "/api/uploads/pdf/ingest", {"file_sha256": unknown_sha}
        )
        assert status == 404, body
        assert "b" * 16 in body["error"]
        assert "/api/uploads/pdf" in body["error"]
        assert server.router_call_count() == 0
    finally:
        server.close()


def test_ingest_missing_identifier_400(tmp_path: Path):
    router = _write_fake_router(tmp_path)
    server = _BridgeServer(
        tmp_path, env_extra={"COC_PI_PDF_INSPECTOR_COMMAND": str(router)}
    )
    try:
        status, body = server.post("/api/uploads/pdf/ingest", {})
        assert status == 400, body
        assert body["error"] == "需要 file_sha256 或 stored_path"
    finally:
        server.close()


def test_ingest_ocr_fallback_skips_image_pages(tmp_path: Path):
    router = _write_fake_router(tmp_path)
    server = _BridgeServer(
        tmp_path,
        env_extra={
            "COC_PI_PDF_INSPECTOR_COMMAND": str(router),
            "FAKE_ROUTER_MODE": "ocr_fallback",
            "FAKE_ROUTER_OCR_PAGES": "0",
        },
    )
    try:
        _register_pdf(server.workspace, "art_module.pdf", b"%PDF-1.4\nart\n")
        digest = hashlib.sha256(b"%PDF-1.4\nart\n").hexdigest()
        status, body = server.post(
            "/api/uploads/pdf/ingest",
            {"file_sha256": digest, "pdf_indices": [0, 1, 2]},
        )
        assert status == 200, body
        result = body["result"]
        assert result["status"] == "matched_bundle"
        assert result["skipped_ocr_pdf_indices"] == [0]
        assert result["rendered_pdf_indices"] == [1, 2]
        assert result["bundle_id"] == "art-module-p0"
        assert "图片页 1 需 OCR，已跳过" in result["message"]
        # Two router round-trips: fallback first, reduced re-parse second.
        requests = server.router_requests()
        assert len(requests) == 2
        assert requests[0]["missing_pdf_indices"] == [0, 1, 2]
        assert requests[1]["missing_pdf_indices"] == [1, 2]
        bundle_dir = server.workspace / ".coc" / "source-bundles" / "art-module-p0"
        manifest = json.loads(
            (bundle_dir / "manifest.json").read_text(encoding="utf-8")
        )
        assert [page["pdf_index"] for page in manifest["pages"]] == [1, 2]
    finally:
        server.close()


def test_ingest_bad_router_output_fails_closed_502(tmp_path: Path):
    router = _write_fake_router(tmp_path)
    server = _BridgeServer(
        tmp_path,
        env_extra={
            "COC_PI_PDF_INSPECTOR_COMMAND": str(router),
            "FAKE_ROUTER_MODE": "bad_output",
        },
    )
    try:
        _register_pdf(server.workspace, "bad_module.pdf", b"%PDF-1.4\nbad\n")
        digest = hashlib.sha256(b"%PDF-1.4\nbad\n").hexdigest()
        status, body = server.post(
            "/api/uploads/pdf/ingest", {"file_sha256": digest}
        )
        assert status == 502, body
        assert "输出无效" in body["error"]
        assert not (server.workspace / ".coc" / "source-bundles").exists()
    finally:
        server.close()
