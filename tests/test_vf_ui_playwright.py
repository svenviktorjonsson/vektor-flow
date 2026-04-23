"""E2E smoke tests for web/vf-ui in Playwright (Chromium).

The native vf-overlay host is not driven here — we use the same HTML/JS in a
headless browser to verify mounted frames, minimize/restore glyphs, viewport
docking, and compact hit area when minimized.

Requires: ``pip install -e ".[dev]"`` and ``playwright install chromium``
"""

from __future__ import annotations

import contextlib
import http.server
import json
import shutil
import socketserver
import tempfile
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Generator

import pytest

pytest.importorskip("playwright")
from playwright.sync_api import Page, expect, sync_playwright

REPO = Path(__file__).resolve().parents[1]
VF_UI = REPO / "web" / "vf-ui"
INDEX_DOC = "vkf-scene.html"

VW, VH = 800, 600


def _scene_from_vkf(vkf: Path) -> str:
    """Run a .vkf that leaves global ``d`` = ``ui.display`` and return scene JSON."""
    from vektorflow.interpreter import Interpreter
    from vektorflow.parser import parse_module

    if not vkf.is_file():
        raise FileNotFoundError(vkf)
    ip = Interpreter(vkf)
    ip.run_module(parse_module(vkf.read_text(encoding="utf-8"), str(vkf)))
    d = ip.globals.get("d")
    if d is None or not hasattr(d, "dumps"):
        raise RuntimeError(f"{vkf.name} must define display as `d` (ui.display)")
    return d.dumps()


def _scene_from_examples_ui_widgets_static() -> str:
    return _scene_from_vkf(REPO / "examples" / "ui_widgets_static.vkf")


def _scene_from_examples_ui_all_classes() -> str:
    return _scene_from_vkf(REPO / "examples" / "ui_all_classes.vkf")


MINIMAL_SCENE: list[dict[str, Any]] = [
    {
        "kind": "frame_upsert",
        "id": "e2e1",
        "payload": {
            "spec": {
                "id": "e2e1",
                "title": "$$a+b$$ E2E",
                "title_align": "left",
                "rect": {"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0},
                "flags": {
                    "draggable": True,
                    "dockable": True,
                    "resizable": False,
                    "closable": True,
                    "use_browser": True,
                },
                "alpha": 0.7,
                "master": False,
                "dock_location": "bl",
            }
        },
    }
]


def _http_server_for_directory(
    root: Path,
) -> tuple[str, socketserver.TCPServer, threading.Thread]:
    root_s = str(root)

    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a: object, **k: object) -> None:
            super().__init__(*a, directory=root_s, **k)

        def do_POST(self) -> None:  # noqa: N802
            # vf-widgets.js POSTs host events; static file server has no API otherwise (501 -> console errors).
            if self.path.split("?", 1)[0] == "/api/enqueue":
                self.send_response(204)
                self.end_headers()
                return
            self.send_error(404)

    httpd: socketserver.TCPServer = socketserver.TCPServer(("127.0.0.1", 0), H)
    port = httpd.server_address[1]
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return f"http://127.0.0.1:{port}/", httpd, thread


@pytest.fixture
def vf_ui_static_widgets_http_base() -> Generator[str, None, None]:
    """Serve vf-ui with ``examples/ui_widgets_static.vkf`` scene (all widget types, relative layout)."""
    if not (VF_UI / "vkf-scene.html").is_file() or not (VF_UI / "vf-frame.js").is_file():
        pytest.skip("web/vf-ui not found")
    if not (VF_UI / "vf-widgets.js").is_file():
        pytest.skip("web/vf-ui/vf-widgets.js not found")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "vf"
        shutil.copytree(VF_UI, root, dirs_exist_ok=True)
        (root / "vkf-scene.json").write_text(
            _scene_from_examples_ui_widgets_static(),
            encoding="utf-8",
        )
        (root / "vf-ui-state.json").write_text("{}", encoding="utf-8")
        base, httpd, _thr = _http_server_for_directory(root)
        try:
            yield base.rstrip("/")
        finally:
            with contextlib.suppress(Exception):
                httpd.shutdown()
            with contextlib.suppress(Exception):
                httpd.server_close()


@pytest.fixture
def vf_ui_all_classes_http_base() -> Generator[str, None, None]:
    """Serve vf-ui with ``examples/ui_all_classes.vkf`` (one frame, every widget type)."""
    if not (VF_UI / "vkf-scene.html").is_file() or not (VF_UI / "vf-frame.js").is_file():
        pytest.skip("web/vf-ui not found")
    if not (VF_UI / "vf-widgets.js").is_file():
        pytest.skip("web/vf-ui/vf-widgets.js not found")
    p = REPO / "examples" / "ui_all_classes.vkf"
    if not p.is_file():
        pytest.skip("examples/ui_all_classes.vkf not found")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "vf"
        shutil.copytree(VF_UI, root, dirs_exist_ok=True)
        (root / "vkf-scene.json").write_text(
            _scene_from_examples_ui_all_classes(),
            encoding="utf-8",
        )
        (root / "vf-ui-state.json").write_text("{}", encoding="utf-8")
        base, httpd, _thr = _http_server_for_directory(root)
        try:
            yield base.rstrip("/")
        finally:
            with contextlib.suppress(Exception):
                httpd.shutdown()
            with contextlib.suppress(Exception):
                httpd.server_close()


@pytest.fixture
def vf_ui_http_base() -> Generator[str, None, None]:
    if not (VF_UI / "vkf-scene.html").is_file() or not (VF_UI / "vf-frame.js").is_file():
        pytest.skip("web/vf-ui not found")

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "vf"
        shutil.copytree(VF_UI, root, dirs_exist_ok=True)
        (root / "vkf-scene.json").write_text(
            json.dumps(MINIMAL_SCENE, indent=2),
            encoding="utf-8",
        )
        base, httpd, _thr = _http_server_for_directory(root)
        try:
            yield base.rstrip("/")
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
        except Exception as e:  # noqa: BLE001
            pytest.skip(f"Chromium not available (run: playwright install chromium): {e}")
        context = None
        try:
            context = browser.new_context(viewport={"width": VW, "height": VH})
            page = context.new_page()
            page.set_default_timeout(60_000)
            yield page
        finally:
            with contextlib.suppress(Exception):
                if context is not None:
                    context.close()
            with contextlib.suppress(Exception):
                browser.close()


def _assert_backdrop_not_magenta(page: Page) -> None:
    """Never ship pink/magenta #ff00ff full-page key; regression guard."""
    for sel in ("html", "body", "#layer"):
        c = page.eval_on_selector(sel, "el => getComputedStyle(el).backgroundColor")
        assert c and isinstance(c, str), sel
        assert "255, 0, 255" not in c and "rgb(255, 0, 255)" not in c, f"{sel} bg={c!r}"


@pytest.mark.network
def test_page_backdrop_not_magenta_sees_transparent_layer(vf_ui_http_base: str) -> None:
    url = f"{vf_ui_http_base}/{INDEX_DOC}"
    with _chromium_page() as page:
        page.goto(url, wait_until="domcontentloaded")
        _assert_backdrop_not_magenta(page)
        t = page.eval_on_selector("body", "el => getComputedStyle(el).backgroundColor")
        assert t == "rgba(0, 0, 0, 0)", f"expected fully transparent body (overlay), got {t!r}"
        pe = page.eval_on_selector("body", "el => getComputedStyle(el).pointerEvents")
        assert pe == "none", f"expected void body to pass hits through, got pointer-events {pe!r}"


@pytest.mark.network
def test_frame_outer_corner_wedge_is_not_in_hit_region(vf_ui_http_base: str) -> None:
    """Top-left 1,1 in border box is outside 10px corner arc; should not target the frame (clip-path)."""
    url = f"{vf_ui_http_base}/{INDEX_DOC}"
    with _chromium_page() as page:
        page.goto(url, wait_until="domcontentloaded")
        page.wait_for_selector(".vf-frame", state="visible", timeout=30_000)
        inside = page.evaluate(
            """
            () => {
              const f = document.querySelector('.vf-frame');
              if (!f) return { ok: false, reason: 'no frame' };
              const r = f.getBoundingClientRect();
              const x = r.left + 1;
              const y = r.top + 1;
              const el = document.elementFromPoint(x, y);
              if (!el) return { ok: true };
              return { ok: !el.closest('.vf-frame'), tag: el.tagName };
            }
            """
        )
        assert isinstance(inside, dict) and inside.get("ok") is True, f"expected hit outside .vf-frame, got {inside!r}"


@pytest.mark.network
def test_frame_alpha_from_spec_applies_to_root_style(vf_ui_http_base: str) -> None:
    """Spec alpha = shell only (--vf-ui-alpha), not whole-root opacity (title stays crisp)."""
    url = f"{vf_ui_http_base}/{INDEX_DOC}"
    with _chromium_page() as page:
        page.goto(url, wait_until="domcontentloaded")
        page.wait_for_selector(".vf-frame", state="visible", timeout=30_000)
        f = page.locator(".vf-frame").first
        assert f.evaluate("el => getComputedStyle(el).opacity") == "1"
        va = f.evaluate("el => getComputedStyle(el).getPropertyValue('--vf-ui-alpha').trim()")
        assert va == "0.7", f"expected --vf-ui-alpha 0.7, got {va!r}"
        assert f.get_attribute("data-vf-alpha") == "0.7"


@pytest.mark.network
def test_vf_scene_docks_to_viewport_lower_left_not_full_size(vf_ui_http_base: str) -> None:
    """Minimized strip sits at the bottom of the *viewport* and is not full width."""
    url = f"{vf_ui_http_base}/{INDEX_DOC}"
    with _chromium_page() as page:
        page.goto(url, wait_until="domcontentloaded")
        page.wait_for_selector(".vf-frame", state="visible", timeout=30_000)
        expand = page.locator(".vf-frame").first
        b0 = expand.bounding_box()
        assert b0 is not None
        assert b0["width"] >= VW * 0.9, "expanded full-layer frame should span the view"

        page.locator(".vf-min-btn").first.click()
        page.wait_for_selector(".vf-frame--minimized", state="visible", timeout=5_000)
        m = page.locator(".vf-frame--minimized").first
        expect(m).to_be_visible()
        # Two animation frames: layout is deferred
        page.wait_for_timeout(80)
        b = m.bounding_box()
        assert b is not None
        # Compact strip, not a full-viewport "ghost" of the pre-min rect
        assert b["width"] < VW * 0.55, f"minimized should be a strip, got w={b['width']}"
        assert b["height"] < 80, f"minimized should be a strip, got h={b['height']}"
        # Default bottom dock: first tile is lower-left of the viewport
        assert b["x"] <= 24, f"left edge in corner, x={b['x']}"
        assert b["y"] + b["height"] >= VH - 48, f"anchored to bottom, box={b}"


@pytest.mark.network
def test_minimize_glyphs_dash_when_expanded_square_when_docked(vf_ui_http_base: str) -> None:
    url = f"{vf_ui_http_base}/{INDEX_DOC}"
    with _chromium_page() as page:
        page.goto(url, wait_until="domcontentloaded")
        page.wait_for_selector(".vf-frame", state="visible", timeout=30_000)
        min_btn = page.locator(".vf-min-btn").first
        expect(min_btn.locator(".vf-min-btn__bar")).to_be_visible()
        expect(min_btn.locator(".vf-min-btn__square")).to_have_count(0)

        min_btn.click()
        page.wait_for_selector(".vf-frame--minimized", state="visible", timeout=5_000)
        min_btn2 = page.locator(".vf-frame--minimized .vf-min-btn").first
        expect(min_btn2.locator(".vf-min-btn__square")).to_be_visible()
        expect(min_btn2.locator(".vf-min-btn__bar")).to_have_count(0)

        min_btn2.click()
        page.wait_for_function("() => !document.querySelector('.vf-frame--minimized')")
        min_btn3 = page.locator(".vf-frame .vf-min-btn").first
        expect(min_btn3.locator(".vf-min-btn__bar")).to_be_visible()
        expect(min_btn3.locator(".vf-min-btn__square")).to_have_count(0)


@pytest.mark.network
def test_header_drag_moves_frame_in_layer(vf_ui_http_base: str) -> None:
    """In-browser drag (no WebView2); header path. Full-layer frame has no room to move—shrink first."""
    url = f"{vf_ui_http_base}/{INDEX_DOC}"
    with _chromium_page() as page:
        page.goto(url, wait_until="domcontentloaded")
        page.wait_for_selector(".vf-frame", state="visible", timeout=30_000)
        fr = page.locator(".vf-frame").first
        fr.evaluate("""(e) => {
          e.classList.remove("vf-frame--user-sized");
          e.style.left = "24px";
          e.style.top = "48px";
          e.style.width = "360px";
          e.style.height = "240px";
        }""")
        before = fr.evaluate("e => e.style.left + ',' + e.style.top")
        hdr = page.locator(".vf-frame__header")
        box = hdr.bounding_box()
        assert box is not None
        page.mouse.move(box["x"] + 40, box["y"] + 8)
        page.mouse.down()
        page.mouse.move(box["x"] + 180, box["y"] + 50)
        page.mouse.up()
        after = fr.evaluate("e => e.style.left + ',' + e.style.top")
        assert before != after, f"drag should change position, {before!r} -> {after!r}"


@pytest.mark.network
def test_close_button_removes_frame(vf_ui_http_base: str) -> None:
    url = f"{vf_ui_http_base}/{INDEX_DOC}"
    with _chromium_page() as page:
        page.goto(url, wait_until="domcontentloaded")
        page.wait_for_selector(".vf-frame", state="visible", timeout=30_000)
        page.locator(".vf-close-btn").first.click()
        expect(page.locator(".vf-frame")).to_have_count(0, timeout=5_000)


@pytest.mark.network
def test_static_ui_widgets_mounted_in_frames(vf_ui_static_widgets_http_base: str) -> None:
    """Headless: static scene shows 5 frames and all vf-widgets control kinds."""
    url = f"{vf_ui_static_widgets_http_base}/{INDEX_DOC}"
    with _chromium_page() as page:
        page.goto(url, wait_until="domcontentloaded")
        page.wait_for_selector(".vf-frame", state="visible", timeout=30_000)
        # Widget bodies mount under .vf-frame__body.vf-w-stack — without this, only chrome shows.
        page.wait_for_selector(".vf-frame__body.vf-w-stack", state="visible", timeout=30_000)
        expect(page.locator(".vf-frame")).to_have_count(5, timeout=10_000)
        expect(page.get_by_text("Anchor", exact=False).first).to_be_visible()
        # One of each control class (see web/vf-ui/vf-widgets.js / vf-frame.css)
        expect(page.locator(".vf-w-label").first).to_be_visible()
        expect(page.locator("select.vf-w-select, .vf-w-select").first).to_be_visible()
        expect(page.locator("button.vf-w-btn, .vf-w-btn").first).to_be_visible()
        expect(page.locator("input.vf-w-range, .vf-w-range").first).to_be_visible()
        expect(page.locator("input.vf-w-input, .vf-w-input").first).to_be_visible()
        expect(page.locator("textarea.vf-w-textarea, .vf-w-textarea").first).to_be_visible()
        expect(page.locator("label.vf-w-check, .vf-w-check").first).to_be_visible()
        # Frame chrome still present
        expect(page.locator(".vf-frame__header").first).to_be_visible()


@pytest.mark.network
def test_ui_all_classes_single_frame_mounted(
    vf_ui_all_classes_http_base: str,
) -> None:
    """One frame: every built-in widget type is present, stacked, and laid out in the body."""
    url = f"{vf_ui_all_classes_http_base}/{INDEX_DOC}"
    with _chromium_page() as page:
        page.goto(url, wait_until="domcontentloaded")
        expect(page.locator(".vf-frame")).to_have_count(1, timeout=10_000)
        stack = page.locator(".vf-frame__body.vf-w-stack")
        expect(stack).to_be_visible()
        # One `canvas.vf-frame__draw-canvas` (vf-frame.js) + one node per widget type.
        expect(stack.locator("> *")).to_have_count(8)
        expect(page.locator(".vf-w-label")).to_have_count(1)
        expect(page.locator("select.vf-w-select")).to_have_count(1)
        expect(page.locator("button.vf-w-btn")).to_have_count(1)
        expect(page.locator("input.vf-w-range")).to_have_count(1)
        expect(page.locator("input.vf-w-input")).to_have_count(1)
        expect(page.locator("textarea.vf-w-textarea")).to_have_count(1)
        expect(page.locator("label.vf-w-check")).to_have_count(1)
        for sel in (
            ".vf-w-label",
            "select.vf-w-select",
            "button.vf-w-btn",
            "input.vf-w-range",
            "input.vf-w-input",
            "textarea.vf-w-textarea",
            "label.vf-w-check",
        ):
            box = page.locator(sel).first.bounding_box()
            assert box is not None
            assert box["width"] >= 4 and box["height"] >= 4, (sel, box)


@pytest.mark.network
def test_ui_all_classes_widget_interactions(
    vf_ui_all_classes_http_base: str,
) -> None:
    """Controls accept input: fill, select, check, range, no JS errors in console."""
    url = f"{vf_ui_all_classes_http_base}/{INDEX_DOC}"
    with _chromium_page() as page:
        page.goto(url, wait_until="domcontentloaded")
        page.wait_for_selector(".vf-frame__body.vf-w-stack", state="visible", timeout=30_000)
        err: list[str] = []

        def _on_console(msg: object) -> None:
            t = getattr(msg, "type", None)
            if t == "error":
                err.append(getattr(msg, "text", str(msg)))

        page.on("console", _on_console)

        page.locator("input.vf-w-input").fill("e2e")
        expect(page.locator("input.vf-w-input")).to_have_value("e2e")

        page.locator("select.vf-w-select").select_option(index=1)
        expect(page.locator("select.vf-w-select")).to_have_value("1")

        page.locator("label.vf-w-check input").check()
        expect(page.locator("label.vf-w-check input")).to_be_checked()

        page.locator("input.vf-w-range").fill("0.3")
        expect(page.locator("input.vf-w-range")).to_have_value("0.3")

        page.locator("textarea.vf-w-textarea").fill("line\n2")
        expect(page.locator("textarea.vf-w-textarea")).to_have_value("line\n2")

        page.locator("button.vf-w-btn").click()
        # fetch() to /api/enqueue may 404 in static server — that should not raise in page console
        # if vf-widgets only logs failed fetch silently.
        assert not err, f"console errors: {err!r}"


@pytest.mark.network
def test_vf_scene_title_visible_in_minibar(vf_ui_http_base: str) -> None:
    """Minimized docked strip reuses the header title (minibar element is unused)."""
    url = f"{vf_ui_http_base}/{INDEX_DOC}"
    with _chromium_page() as page:
        page.goto(url, wait_until="domcontentloaded")
        page.wait_for_selector(".vf-frame", state="visible", timeout=30_000)
        page.locator(".vf-min-btn").first.click()
        page.wait_for_selector(".vf-frame--minimized", state="visible", timeout=5_000)
        t = page.locator(".vf-frame--minimized .vf-frame__title").first.inner_text()
        assert "E2E" in t
