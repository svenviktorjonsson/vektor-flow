"""Browser tracer bullet for the shared-memory UI runtime hot path."""

from __future__ import annotations

import contextlib
import http.server
import shutil
import socketserver
import tempfile
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Generator

import pytest

pytest.importorskip("playwright")
from playwright.sync_api import Page, sync_playwright

REPO = Path(__file__).resolve().parents[1]
VF_UI = REPO / "web" / "vf-ui"


def _serve_isolated_vf_ui(root: Path) -> tuple[str, socketserver.TCPServer, threading.Thread]:
    root_s = str(root)

    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args: object, **kwargs: object) -> None:
            super().__init__(*args, directory=root_s, **kwargs)

        def end_headers(self) -> None:
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
            super().end_headers()

    httpd: socketserver.TCPServer = socketserver.TCPServer(("127.0.0.1", 0), H)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return f"http://127.0.0.1:{httpd.server_address[1]}", httpd, thread


@contextmanager
def _shared_runtime_page() -> Generator[str, None, None]:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "vf"
        shutil.copytree(VF_UI, root, dirs_exist_ok=True)
        base, httpd, _thread = _serve_isolated_vf_ui(root)
        try:
            yield f"{base}/vf-shared-rect-demo.html"
        finally:
            with contextlib.suppress(Exception):
                httpd.shutdown()
            with contextlib.suppress(Exception):
                httpd.server_close()


@contextmanager
def _chromium_page() -> Generator[Page, None, None]:
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(headless=True)
        except Exception as exc:  # noqa: BLE001
            pytest.skip(f"Chromium not available (run: playwright install chromium): {exc}")
        context = None
        try:
            context = browser.new_context(viewport={"width": 960, "height": 540})
            page = context.new_page()
            page.set_default_timeout(60_000)
            yield page
        finally:
            with contextlib.suppress(Exception):
                if context is not None:
                    context.close()
            with contextlib.suppress(Exception):
                browser.close()


@pytest.mark.network
def test_shared_runtime_rect_drag_updates_arena_without_json_hot_path() -> None:
    with _shared_runtime_page() as url, _chromium_page() as page:
        requests: list[str] = []
        page.add_init_script(
            """
            window.__vfOverlayMessages = [];
            window.chrome = { webview: { postMessage: (msg) => window.__vfOverlayMessages.push(msg) } };
            """
        )
        page.on("request", lambda request: requests.append(request.url))
        page.goto(url, wait_until="domcontentloaded")
        page.wait_for_function("() => window.__vfSharedRectDemo")

        assert page.evaluate("() => crossOriginIsolated") is True
        initial = page.evaluate("() => window.__vfSharedRectDemo.getRect()")
        assert initial == {"x": 120, "y": 96, "w": 180, "h": 118}
        canvas_box = page.locator(".vf-shared-demo-canvas").bounding_box()
        assert canvas_box is not None
        start_x = canvas_box["x"] + 160
        start_y = canvas_box["y"] + 140
        end_x = canvas_box["x"] + 250
        end_y = canvas_box["y"] + 210

        page.mouse.move(start_x, start_y)
        page.mouse.down()
        page.mouse.move(end_x, end_y, steps=5)
        page.mouse.up()

        moved = page.evaluate("() => window.__vfSharedRectDemo.getRect()")
        writes = page.evaluate("() => window.__vfSharedRectDemo.getWrites()")
        latest_input = page.evaluate("() => window.__vfSharedRectDemo.getLatestInput()")
        layout_messages = page.evaluate("() => window.__vfOverlayMessages.filter(m => m.type === 'layout')")

        assert moved["x"] == 210
        assert moved["y"] == 166
        assert latest_input["cursorPx"] == [250, 210]
        assert latest_input["pointerDown"] is False
        assert latest_input["sequence"] >= 2
        assert layout_messages
        assert layout_messages[0]["stageAlpha"] == 0
        assert layout_messages[0]["hitRegions"]
        assert layout_messages[0]["hitRegions"][0]["right"] > layout_messages[0]["hitRegions"][0]["left"]
        assert len(writes) >= 2
        assert all("/api/enqueue" not in request for request in requests)
        assert all("vf-display.json" not in request for request in requests)
