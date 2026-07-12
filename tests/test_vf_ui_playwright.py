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
import math
import shutil
import socketserver
import tempfile
import threading
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Generator

import pytest

pytest.importorskip("playwright")
from playwright.sync_api import Page, expect, sync_playwright
from vektorflow.ui_display_ir import build_browser_host_event_dispatch

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


def _scene_and_display_from_vkf(vkf: Path) -> tuple[str, str]:
    """Run a .vkf that leaves global ``d`` = ``ui.display`` and return scene/display JSON."""
    from vektorflow.interpreter import Interpreter
    from vektorflow.parser import parse_module

    if not vkf.is_file():
        raise FileNotFoundError(vkf)
    ip = Interpreter(vkf)
    ip.run_module(parse_module(vkf.read_text(encoding="utf-8"), str(vkf)))
    d = ip.globals.get("d")
    if d is None or not hasattr(d, "dumps") or not hasattr(d, "display_json"):
        raise RuntimeError(f"{vkf.name} must define display as `d` (ui.display)")
    return d.dumps(), d.display_json()


def _scene_and_display_from_public_ui(build_scene: Any) -> tuple[str, str]:
    """Build a display through the public ``ui`` surface and return scene/display JSON."""
    from vektorflow.stdlib.ui import build_ui_namespace

    d = build_ui_namespace()["ui"].display
    build_scene(d)
    return d.dumps(), d.display_json()


def _scene_display_and_meta_from_public_ui(
    build_scene: Callable[[Any], dict[str, Any] | None],
) -> tuple[str, str, dict[str, Any]]:
    """Build public ``ui`` scene payloads and keep caller-defined metadata alongside them."""
    from vektorflow.stdlib.ui import build_ui_namespace

    d = build_ui_namespace()["ui"].display
    meta = build_scene(d) or {}
    return d.dumps(), d.display_json(), dict(meta)


@dataclass
class _PublicUiBrowserHarness:
    base: str
    posted: list[dict[str, Any]]
    root: Path
    meta: dict[str, Any]

    @property
    def url(self) -> str:
        return f"{self.base}/{INDEX_DOC}"

    def write_state_patch(self, patch: dict[str, Any]) -> None:
        (self.root / "vf-ui-state.json").write_text(
            json.dumps(patch, indent=2) + "\n",
            encoding="utf-8",
        )

    def posted_count(self) -> int:
        return len(self.posted)

    def latest_dispatch(self, *, event_kind_count: dict[int, int] | None = None):
        return build_browser_host_event_dispatch(
            self.posted[-1],
            event_kind_count={} if event_kind_count is None else event_kind_count,
        )


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
) -> tuple[str, socketserver.TCPServer, threading.Thread, list[dict[str, Any]]]:
    root_s = str(root)
    posted: list[dict[str, Any]] = []

    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a: object, **k: object) -> None:
            super().__init__(*a, directory=root_s, **k)

        def do_POST(self) -> None:  # noqa: N802
            # vf-widgets.js POSTs host events; keep the payload for assertions.
            if self.path.split("?", 1)[0] == "/api/enqueue":
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                except ValueError:
                    length = 0
                body = self.rfile.read(length).decode("utf-8") if length > 0 else ""
                payload: dict[str, Any] = {"raw": body}
                if body:
                    try:
                        payload = json.loads(body)
                    except json.JSONDecodeError:
                        payload = {"raw": body}
                posted.append(payload)
                self.send_response(204)
                self.end_headers()
                return
            self.send_error(404)

    httpd: socketserver.TCPServer = socketserver.TCPServer(("127.0.0.1", 0), H)
    port = httpd.server_address[1]
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return f"http://127.0.0.1:{port}/", httpd, thread, posted


@contextmanager
def _serve_vf_ui_payloads(
    *,
    scene_json: str,
    display_json: str = '{"screen":[],"frames":{},"geom":{}}',
    ui_state_json: str = "{}",
) -> Generator[tuple[str, list[dict[str, Any]]], None, None]:
    if not (VF_UI / "vkf-scene.html").is_file() or not (VF_UI / "vf-frame.js").is_file():
        pytest.skip("web/vf-ui not found")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "vf"
        shutil.copytree(VF_UI, root, dirs_exist_ok=True)
        (root / "vkf-scene.json").write_text(scene_json, encoding="utf-8")
        (root / "vf-display.json").write_text(display_json, encoding="utf-8")
        (root / "vf-ui-state.json").write_text(ui_state_json, encoding="utf-8")
        base, httpd, _thr, posted = _http_server_for_directory(root)
        try:
            yield base.rstrip("/"), posted
        finally:
            with contextlib.suppress(Exception):
                httpd.shutdown()
            with contextlib.suppress(Exception):
                httpd.server_close()


@contextmanager
def _serve_vf_ui_payloads_with_root(
    *,
    scene_json: str,
    display_json: str = '{"screen":[],"frames":{},"geom":{}}',
    ui_state_json: str = "{}",
) -> Generator[tuple[str, list[dict[str, Any]], Path], None, None]:
    if not (VF_UI / "vkf-scene.html").is_file() or not (VF_UI / "vf-frame.js").is_file():
        pytest.skip("web/vf-ui not found")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "vf"
        shutil.copytree(VF_UI, root, dirs_exist_ok=True)
        (root / "vkf-scene.json").write_text(scene_json, encoding="utf-8")
        (root / "vf-display.json").write_text(display_json, encoding="utf-8")
        (root / "vf-ui-state.json").write_text(ui_state_json, encoding="utf-8")
        base, httpd, _thr, posted = _http_server_for_directory(root)
        try:
            yield base.rstrip("/"), posted, root
        finally:
            with contextlib.suppress(Exception):
                httpd.shutdown()
            with contextlib.suppress(Exception):
                httpd.server_close()


@contextmanager
def _serve_public_ui_browser(
    build_scene: Callable[[Any], dict[str, Any] | None],
    *,
    ui_state_json: str = "{}",
) -> Generator[_PublicUiBrowserHarness, None, None]:
    scene_json, display_json, meta = _scene_display_and_meta_from_public_ui(build_scene)
    with _serve_vf_ui_payloads_with_root(
        scene_json=scene_json,
        display_json=display_json,
        ui_state_json=ui_state_json,
    ) as (base, posted, root):
        yield _PublicUiBrowserHarness(base=base, posted=posted, root=root, meta=meta)


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
        base, httpd, _thr, _posted = _http_server_for_directory(root)
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
        base, httpd, _thr, _posted = _http_server_for_directory(root)
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
        base, httpd, _thr, _posted = _http_server_for_directory(root)
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


@pytest.mark.network
def test_scene_runtime_update_hook_updates_frame_title_without_reload() -> None:
    updated_scene = json.loads(json.dumps(MINIMAL_SCENE))
    updated_scene[0]["payload"]["spec"]["title"] = "Updated E2E"
    with _serve_vf_ui_payloads(
        scene_json=json.dumps(MINIMAL_SCENE, indent=2),
    ) as (base, _posted):
        url = f"{base}/{INDEX_DOC}"
        with _chromium_page() as page:
            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_selector(".vf-frame", state="visible", timeout=30_000)
            expect(page.locator(".vf-frame__title").first).to_contain_text("E2E")

            page.evaluate(
                """(commands) => {
                  if (!window.__vfSceneHooks || typeof window.__vfSceneHooks.update !== "function") {
                    throw new Error("scene runtime update hook unavailable");
                  }
                  window.__vfSceneHooks.update(commands);
                }""",
                updated_scene,
            )
            expect(page.locator(".vf-frame__title").first).to_contain_text("Updated E2E")


@pytest.mark.network
def test_display_runtime_update_hook_draws_frame_canvas_without_reload() -> None:
    with _serve_vf_ui_payloads(
        scene_json=json.dumps(MINIMAL_SCENE, indent=2),
        display_json='{"screen":[],"frames":{},"geom":{}}',
    ) as (base, _posted):
        url = f"{base}/{INDEX_DOC}"
        with _chromium_page() as page:
            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_selector(".vf-frame", state="visible", timeout=30_000)
            page.wait_for_selector(".vf-frame__draw-canvas", state="visible", timeout=30_000)

            before = page.locator(".vf-frame__draw-canvas").first.evaluate(
                """(canvas) => {
                  const ctx = canvas.getContext('2d');
                  if (!ctx) return -1;
                  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                  let nonTransparent = 0;
                  for (let i = 3; i < data.length; i += 4) {
                    if (data[i] !== 0) nonTransparent += 1;
                  }
                  return nonTransparent;
                }"""
            )
            assert isinstance(before, int)

            payload = {
                "screen": [],
                "frames": {
                    "e2e1": [
                        {
                            "op": "rect",
                            "rect": [0.1, 0.1, 0.5, 0.35],
                            "color": "#ff5500",
                        }
                    ]
                },
                "geom": {},
            }
            page.evaluate(
                """(nextPayload) => {
                  if (!window.__vfBrowserHooks || typeof window.__vfBrowserHooks.updateDisplay !== "function") {
                    throw new Error("display runtime update hook unavailable");
                  }
                  window.__vfBrowserHooks.updateDisplay(nextPayload);
                }""",
                payload,
            )

            after = page.locator(".vf-frame__draw-canvas").first.evaluate(
                """(canvas) => {
                  const ctx = canvas.getContext('2d');
                  if (!ctx) return -1;
                  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                  let nonTransparent = 0;
                  for (let i = 3; i < data.length; i += 4) {
                    if (data[i] !== 0) nonTransparent += 1;
                  }
                  return nonTransparent;
                }"""
            )
            assert isinstance(after, int)
            assert after > before, f"expected direct display update hook to add painted pixels, before={before} after={after}"


@pytest.mark.network
def test_browser_session_update_hook_updates_scene_and_display_without_reload() -> None:
    updated_scene = json.loads(json.dumps(MINIMAL_SCENE))
    updated_scene[0]["payload"]["spec"]["title"] = "Session Updated"
    payload = {
        "screen": [],
        "frames": {
            "e2e1": [
                {
                    "op": "rect",
                    "rect": [0.2, 0.15, 0.45, 0.3],
                    "color": "#0088ff",
                }
            ]
        },
        "geom": {},
    }
    with _serve_vf_ui_payloads(
        scene_json=json.dumps(MINIMAL_SCENE, indent=2),
        display_json='{"screen":[],"frames":{},"geom":{}}',
    ) as (base, _posted):
        url = f"{base}/{INDEX_DOC}"
        with _chromium_page() as page:
            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_selector(".vf-frame", state="visible", timeout=30_000)
            page.wait_for_selector(".vf-frame__draw-canvas", state="visible", timeout=30_000)
            expect(page.locator(".vf-frame__title").first).to_contain_text("E2E")

            before = page.locator(".vf-frame__draw-canvas").first.evaluate(
                """(canvas) => {
                  const ctx = canvas.getContext('2d');
                  if (!ctx) return -1;
                  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                  let nonTransparent = 0;
                  for (let i = 3; i < data.length; i += 4) {
                    if (data[i] !== 0) nonTransparent += 1;
                  }
                  return nonTransparent;
                }"""
            )

            page.evaluate(
                """(session) => {
                  if (!window.__vfBrowserSession || !window.__vfBrowserSession.hooks || typeof window.__vfBrowserSession.hooks.updateSession !== "function") {
                    throw new Error("browser session runtime hook unavailable");
                  }
                  window.__vfBrowserSession.hooks.updateSession(session);
                }""",
                {"scene": updated_scene, "display": payload},
            )

            expect(page.locator(".vf-frame__title").first).to_contain_text("Session Updated")
            after = page.locator(".vf-frame__draw-canvas").first.evaluate(
                """(canvas) => {
                  const ctx = canvas.getContext('2d');
                  if (!ctx) return -1;
                  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                  let nonTransparent = 0;
                  for (let i = 3; i < data.length; i += 4) {
                    if (data[i] !== 0) nonTransparent += 1;
                  }
                  return nonTransparent;
                }"""
            )
            assert isinstance(before, int) and isinstance(after, int)
            assert after > before, f"expected combined session update hook to add painted pixels, before={before} after={after}"


@pytest.mark.network
def test_ui_draggable_rect_example_renders_pixels_in_browser() -> None:
    scene_json, display_json = _scene_and_display_from_vkf(REPO / "examples" / "ui_draggable_rect.vkf")
    with _serve_vf_ui_payloads(scene_json=scene_json, display_json=display_json) as (base, _posted):
        url = f"{base}/{INDEX_DOC}"
        with _chromium_page() as page:
            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_selector(".vf-frame", state="visible", timeout=30_000)
            page.wait_for_selector(".vf-frame__draw-canvas", state="visible", timeout=30_000)
            alpha_pixels = page.locator(".vf-frame__draw-canvas").first.evaluate(
                """(canvas) => {
                  const ctx = canvas.getContext('2d');
                  if (!ctx) return 0;
                  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                  let nonTransparent = 0;
                  for (let i = 3; i < data.length; i += 4) {
                    if (data[i] !== 0) nonTransparent += 1;
                  }
                  return nonTransparent;
                }"""
            )
            assert isinstance(alpha_pixels, int)
            assert alpha_pixels > 0, "expected draggable rect example to draw visible pixels"


def _public_ui_geom_meshes(build_scene: Any) -> list[dict[str, Any]]:
    _scene_json, display_json = _scene_and_display_from_public_ui(build_scene)
    payload = json.loads(display_json)
    frame_id = next(iter(payload["geom"]))
    return list(payload["geom"][frame_id]["meshes"])


def test_public_ui_add_0d_defaults_to_point_only_vertices() -> None:
    def _build_scene(d: Any) -> None:
        d.add_frame((0.1, 0.1, 0.4, 0.4))
        d.add(x=0.0, y=0.0, z=0.0, color="red")

    mesh = _public_ui_geom_meshes(_build_scene)[0]
    assert mesh["manifold_dim_count"] == 0
    assert mesh["topology"] == "point-list"
    assert mesh["indices"] == [0]
    assert mesh["vertex_size"] == 4
    assert mesh["edge_width"] == 0


def test_public_ui_add_1d_defaults_to_line_only_edges() -> None:
    def _build_scene(d: Any) -> None:
        d.add_frame((0.1, 0.1, 0.4, 0.4))
        d.add(x_u=[0.0, 1.0], y_u=[0.0, 0.0], z_u=[0.0, 0.0], color="green")

    mesh = _public_ui_geom_meshes(_build_scene)[0]
    assert mesh["manifold_dim_count"] == 1
    assert mesh["topology"] == "line-list"
    assert mesh["indices"] == [0, 1]
    assert mesh["vertex_size"] == 0
    assert mesh["edge_width"] == 4


def test_public_ui_add_2d_defaults_to_face_only_mesh() -> None:
    def _build_scene(d: Any) -> None:
        d.add_frame((0.1, 0.1, 0.4, 0.4))
        d.add(
            x_uv=[[0.0, 1.0], [0.0, 1.0]],
            y_uv=[[0.0, 0.0], [1.0, 1.0]],
            z_uv=[[0.0, 0.0], [0.0, 0.0]],
            color="blue",
        )

    mesh = _public_ui_geom_meshes(_build_scene)[0]
    assert mesh["manifold_dim_count"] == 2
    assert mesh["topology"] == "triangle-list"
    assert mesh["indices"] == [0, 1, 2, 3, 4, 5]
    assert mesh["vertex_size"] == 0
    assert mesh["edge_width"] == 0


def test_public_ui_add_explicit_overlay_size_overrides_defaults() -> None:
    def _build_scene(d: Any) -> None:
        d.add_frame((0.1, 0.1, 0.4, 0.4))
        d.add(
            x_uv=[[0.0, 1.0], [0.0, 1.0]],
            y_uv=[[0.0, 0.0], [1.0, 1.0]],
            z_uv=[[0.0, 0.0], [0.0, 0.0]],
            vertex_size=6,
            edge_width=3,
            color="yellow",
        )

    mesh = _public_ui_geom_meshes(_build_scene)[0]
    assert mesh["manifold_dim_count"] == 2
    assert mesh["topology"] == "triangle-list"
    assert mesh["vertex_size"] == 6
    assert mesh["edge_width"] == 3


def test_public_ui_add_overlay_sizes_are_per_mesh_isolated() -> None:
    def _build_scene(d: Any) -> None:
        d.add_frame((0.1, 0.1, 0.4, 0.4))
        d.add(x=0.0, y=0.0, z=0.0, vertex_size=9, color="red")
        d.add(x_u=[0.0, 1.0], y_u=[0.0, 0.0], z_u=[0.0, 0.0], edge_width=2, color="green")
        d.add(x=1.0, y=0.0, z=0.0, color="blue")

    first, second, third = _public_ui_geom_meshes(_build_scene)
    assert (first["vertex_size"], first["edge_width"]) == (9, 0)
    assert (second["vertex_size"], second["edge_width"]) == (0, 2)
    assert (third["vertex_size"], third["edge_width"]) == (4, 0)


@pytest.mark.network
def test_browser_field_overlays_expand_to_rounded_scale_independent_triangle_impostors(vf_ui_http_base: str) -> None:
    url = f"{vf_ui_http_base}/{INDEX_DOC}"
    with _chromium_page() as page:
        page.goto(url, wait_until="domcontentloaded")
        page.wait_for_function("() => !!(window.VfDisplay && window.VfDisplay.__test && window.VfGeomCore)")
        result = page.evaluate(
            """() => {
              const camera = { pos: [0, 0, 5], target: [0, 0, 0], fov: 45, up: [0, 1, 0] };
              const pointSpec = (scale) => ({
                type: "field_mesh",
                id: "p" + scale,
                vertices: [0, 0, 0, 0, 0, 1, 1, 0, 0, 1],
                indices: [0],
                topology: "point-list",
                manifold_dim_count: 0,
                vertex_size: 8,
                edge_width: 0,
                center: [0, 0, 0],
                rotation: [0, 0, 0],
                scale: [scale, scale, scale],
                color: [1, 0, 0, 1],
              });
              const lineSpec = {
                type: "field_mesh",
                id: "line",
                vertices: [
                  -0.5, 0, 0, 0, 0, 1, 0, 1, 0, 1,
                   0.5, 0, 0, 0, 0, 1, 0, 1, 0, 1,
                ],
                indices: [0, 1],
                topology: "line-list",
                manifold_dim_count: 1,
                vertex_size: 0,
                edge_width: 6,
                center: [0, 0, 0],
                rotation: [0, 0, 0],
                scale: [20, 20, 20],
                color: [0, 1, 0, 1],
              };
              const bounds = (mesh) => {
                let minX = Infinity;
                let maxX = -Infinity;
                for (let i = 0; i < mesh.vertices.length; i += 10) {
                  minX = Math.min(minX, mesh.vertices[i]);
                  maxX = Math.max(maxX, mesh.vertices[i]);
                }
                return { width: maxX - minX };
              };
              const p1 = window.VfDisplay.__test.buildCombinedTriangleMesh([pointSpec(1)], camera, []);
              const p2 = window.VfDisplay.__test.buildCombinedTriangleMesh([pointSpec(100)], camera, []);
              const line = window.VfDisplay.__test.buildCombinedTriangleMesh([lineSpec], camera, []);
              return {
                pointTopology: p1.topology,
                pointTriangles: p1.indices.length / 3,
                pointSpheres: p1.overlay_counts.spheres,
                pointWidth1: bounds(p1).width,
                pointWidth2: bounds(p2).width,
                lineTopology: line.topology,
                lineCylinders: line.overlay_counts.cylinders,
                lineSpheres: line.overlay_counts.spheres,
              };
            }"""
        )
        assert result["pointTopology"] == "triangle-list"
        assert result["pointTriangles"] > 12, "0D overlays should be rounded, not cube impostors"
        assert result["pointSpheres"] == 1
        assert result["pointWidth1"] == pytest.approx(result["pointWidth2"], rel=0.01)
        assert result["lineTopology"] == "triangle-list"
        assert result["lineCylinders"] == 1
        assert result["lineSpheres"] == 2


@pytest.mark.network
def test_browser_hover_context_exposes_typed_ids_and_mask(vf_ui_http_base: str) -> None:
    url = f"{vf_ui_http_base}/{INDEX_DOC}"
    with _chromium_page() as page:
        page.goto(url, wait_until="domcontentloaded")
        page.wait_for_function("() => !!(window.VfDisplay && window.VfDisplay.__test)")
        result = page.evaluate(
            """() => {
              const mask = window.VfDisplay.__test.HOVER_MASK;
              const hover = window.VfDisplay.__test.hoverContext({
                frame_id: "f1",
                object_id: "poly3",
                vertex_id: 7,
                edge_id: 2,
                face_id: 0,
              });
              return { hover, mask };
            }"""
        )
        hover = result["hover"]
        mask = result["mask"]
        assert hover["kind"] == "vertex"
        assert hover["frame_id"] == "f1"
        assert hover["object_id"] == "poly3"
        assert hover["vertex_id"] == 7
        assert hover["edge_id"] == 2
        assert hover["face_id"] == 0
        assert hover["mask"] & mask["FRAME"]
        assert hover["mask"] & mask["OBJECT"]
        assert hover["mask"] & mask["VERTEX"]
        assert hover["mask"] & mask["EDGE"]
        assert hover["mask"] & mask["FACE"]


@pytest.mark.network
def test_interactive_2d_refresh_uses_backend_transform_updates() -> None:
    def build_scene(d: Any) -> None:
        panel = d.frame(
            title="Single VKF draggable rect",
            draggable=True,
            closable=True,
            resizable=True,
            dockable=True,
            dock_loc="bl",
            alpha=0.96,
            master=True,
        )
        d.add_frame(panel, [0.16, 0.16, 0.58, 0.58])
        box = panel.add_rect([0.24, 0.24, 0.28, 0.22], color=[0.10, 0.72, 0.95, 0.92])
        box.set_interaction(cursor="open_hand", pressed_cursor="closed_hand", border=0.03)

    with _serve_public_ui_browser(build_scene) as harness:
        url = f"{harness.base}/{INDEX_DOC}"
        with _chromium_page() as page:
            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_selector(".vf-frame__draw-canvas", state="visible", timeout=30_000)
            before = page.evaluate(
                """() => {
                  const st = window.VfDisplay.getInteractiveState("f1");
                  const op = st.ops.find(o => o.interaction && o.interaction.shape_id);
                  return op.transform.slice();
                }"""
            )
            payload = json.loads((harness.root / "vf-display.json").read_text(encoding="utf-8"))
            op = payload["frames"]["f1"][0]
            op["transform"][4] = 0.36
            op["transform"][5] = 0.32
            (harness.root / "vf-display.json").write_text(json.dumps(payload), encoding="utf-8")

            page.evaluate("() => window.__vfDisplayHooks.refresh()")
            page.wait_for_timeout(80)
            after = page.evaluate(
                """() => {
                  const st = window.VfDisplay.getInteractiveState("f1");
                  const op = st.ops.find(o => o.interaction && o.interaction.shape_id);
                  return op.transform.slice();
                }"""
            )

            assert before[4] != pytest.approx(0.36)
            assert after[4] == pytest.approx(0.36)
            assert after[5] == pytest.approx(0.32)


@pytest.mark.network
def test_ui_polygon_hierarchy_example_supports_browser_transform_pan_zoom_and_shape_ids() -> None:
    def build_scene(d: Any) -> None:
        panel = d.frame(
            title="Polygon edit: red parent -> green child -> blue leaf",
            draggable=True,
            closable=True,
            resizable=True,
            dockable=True,
            dock_loc="bl",
            alpha=0.96,
            master=True,
        )
        d.add_frame(panel, [0.08, 0.08, 0.72, 0.72])
        root = panel.add_polygon(
            [[0.08, 0.14], [0.32, 0.08], [0.78, 0.10], [0.94, 0.46], [0.64, 0.84], [0.18, 0.72]],
            color=[1.0, 0.48, 0.35, 0.72],
        )
        child = root.add_polygon(
            [[0.22, 0.30], [0.42, 0.20], [0.66, 0.34], [0.62, 0.58], [0.40, 0.70], [0.24, 0.56]],
            color=[0.25, 0.86, 0.55, 0.78],
        )
        child.add_polygon(
            [[0.36, 0.38], [0.50, 0.32], [0.62, 0.44], [0.56, 0.62], [0.40, 0.60]],
            color=[0.37, 0.78, 1.0, 0.88],
        )

    scene_json, display_json = _scene_and_display_from_public_ui(build_scene)
    with _serve_vf_ui_payloads(scene_json=scene_json, display_json=display_json) as (base, posted):
        url = f"{base}/{INDEX_DOC}"
        with _chromium_page() as page:
            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_selector(".vf-frame", state="visible", timeout=30_000)
            canvas = page.locator(".vf-frame__draw-canvas").first
            canvas.wait_for(state="visible", timeout=30_000)
            page.evaluate(
                """() => {
                  window.__vfCapturedEvents = [];
                  window.VfDisplay.setEventSink({ postEvent: (evt) => window.__vfCapturedEvents.push(evt) });
                }"""
            )
            assert canvas.evaluate("c => getComputedStyle(c).cursor") == "grab"

            before = page.evaluate(
                """() => {
                  const st = window.VfDisplay.getInteractiveState("f1");
                  const op = st.ops.find(o => o.interaction && o.interaction.shape_id === "poly3");
                  const pts = op.points.map((p) => [
                    op.transform[0] * p[0] + op.transform[2] * p[1] + op.transform[4],
                    op.transform[1] * p[0] + op.transform[3] * p[1] + op.transform[5],
                  ]);
                  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
                  const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
                  const r = document.querySelector(".vf-frame__draw-canvas").getBoundingClientRect();
                  return { transform: op.transform.slice(), x: r.left + cx * r.width, y: r.top + cy * r.height };
                }"""
            )
            page.mouse.move(before["x"], before["y"])
            page.mouse.down()
            page.mouse.move(before["x"] + 54, before["y"] + 18)
            page.mouse.up()

            after_translate = page.evaluate(
                """() => {
                  const st = window.VfDisplay.getInteractiveState("f1");
                  const op = st.ops.find(o => o.interaction && o.interaction.shape_id === "poly3");
                  return { transform: op.transform.slice(), cursor: getComputedStyle(document.querySelector(".vf-frame__draw-canvas")).cursor };
                }"""
            )
            assert after_translate["transform"] == pytest.approx(before["transform"]), "host should report picks, not mutate geometry"
            assert after_translate["cursor"] == "grab"
            captured = page.evaluate("() => window.__vfCapturedEvents")
            assert captured, "expected browser interaction to post events"
            assert any(evt.get("shape_id") == "poly3" for evt in captured), "events should carry the hovered/dragged polygon id"
            poly_events = [evt for evt in captured if evt.get("shape_id") == "poly3"]
            assert any(evt["hover"]["kind"] == "face" for evt in poly_events)
            assert all(evt["hover"]["frame_id"] == "f1" for evt in poly_events)
            assert all(evt["hover"]["object_id"] == "poly3" for evt in poly_events)
            assert any(evt["hover"].get("face_id") == 0 for evt in poly_events)
            assert all(evt.get("hover_mask", 0) & 1 for evt in poly_events), "hover mask should include frame"
            assert all(evt.get("hover_mask", 0) & 2 for evt in poly_events), "hover mask should include object"
            page.evaluate("() => window.__vfDisplayHooks.refresh()")
            page.wait_for_timeout(80)
            after_refresh = page.evaluate(
                """() => {
                  const st = window.VfDisplay.getInteractiveState("f1");
                  const op = st.ops.find(o => o.interaction && o.interaction.shape_id === "poly3");
                  return op.transform.slice();
                }"""
            )
            assert after_refresh == after_translate["transform"], "display refresh should preserve host-side pick state"

            edge = page.evaluate(
                """() => {
                  const st = window.VfDisplay.getInteractiveState("f1");
                  const op = st.ops.find(o => o.interaction && o.interaction.shape_id === "poly3");
                  const pts = op.points.map((p) => [
                    op.transform[0] * p[0] + op.transform[2] * p[1] + op.transform[4],
                    op.transform[1] * p[0] + op.transform[3] * p[1] + op.transform[5],
                  ]);
                  const x = (pts[0][0] + pts[1][0]) * 0.5;
                  const y = (pts[0][1] + pts[1][1]) * 0.5;
                  const r = document.querySelector(".vf-frame__draw-canvas").getBoundingClientRect();
                  return { transform: op.transform.slice(), points: op.points.map(p => p.slice()), x: r.left + x * r.width, y: r.top + y * r.height };
                }"""
            )
            page.mouse.move(edge["x"], edge["y"])
            page.mouse.down()
            page.mouse.move(edge["x"] + 70, edge["y"] - 45)
            page.mouse.up()
            after_edge = page.evaluate(
                """() => {
                  const st = window.VfDisplay.getInteractiveState("f1");
                  const op = st.ops.find(o => o.interaction && o.interaction.shape_id === "poly3");
                  return { transform: op.transform.slice(), points: op.points.map(p => p.slice()) };
                }"""
            )
            assert after_edge["points"] == edge["points"], "host should not reshape polygon points; VKF code moves the edge ref"
            assert after_edge["transform"] == pytest.approx(edge["transform"]), "host should not transform geometry for edge drags"
            captured = page.evaluate("() => window.__vfCapturedEvents")
            assert any(evt.get("action") == "pick" and evt["hover"]["kind"] == "edge" for evt in captured)

            ctrl_vertex = page.evaluate(
                """() => {
                  const st = window.VfDisplay.getInteractiveState("f1");
                  const op = st.ops.find(o => o.interaction && o.interaction.shape_id === "poly3");
                  const p = op.points[0];
                  const x = op.transform[0] * p[0] + op.transform[2] * p[1] + op.transform[4];
                  const y = op.transform[1] * p[0] + op.transform[3] * p[1] + op.transform[5];
                  const r = document.querySelector(".vf-frame__draw-canvas").getBoundingClientRect();
                  return { transform: op.transform.slice(), x: r.left + x * r.width, y: r.top + y * r.height };
                }"""
            )
            page.keyboard.down("Control")
            page.mouse.move(ctrl_vertex["x"], ctrl_vertex["y"])
            page.mouse.down()
            page.mouse.move(ctrl_vertex["x"] + 60, ctrl_vertex["y"] - 35)
            page.mouse.up()
            page.keyboard.up("Control")
            after_ctrl_vertex = page.evaluate(
                """() => {
                  const st = window.VfDisplay.getInteractiveState("f1");
                  const op = st.ops.find(o => o.interaction && o.interaction.shape_id === "poly3");
                  return op.transform.slice();
                }"""
            )
            assert after_ctrl_vertex == pytest.approx(ctrl_vertex["transform"]), "Ctrl is user code policy; host should not rotate/scale"
            captured = page.evaluate("() => window.__vfCapturedEvents")
            assert any(evt.get("action") == "pick" and evt["hover"]["kind"] == "vertex" and evt.get("ctrl") for evt in captured)

            state_before = page.evaluate(
                """() => {
                  const st = window.VfDisplay.getInteractiveState("f1");
                  return { zoom: st.zoom, panX: st.panX, panY: st.panY };
                }"""
            )
            box = canvas.bounding_box()
            assert box is not None
            page.mouse.move(box["x"] + box["width"] - 12, box["y"] + box["height"] - 12)
            page.mouse.down()
            page.mouse.move(box["x"] + box["width"] - 80, box["y"] + box["height"] - 50)
            page.mouse.up()
            canvas.evaluate(
                """(canvas) => {
                  canvas.dispatchEvent(new WheelEvent("wheel", {
                    deltaY: -240,
                    clientX: canvas.getBoundingClientRect().left + canvas.width * 0.5,
                    clientY: canvas.getBoundingClientRect().top + canvas.height * 0.5,
                    bubbles: true,
                    cancelable: true,
                  }));
                }"""
            )
            state_after = page.evaluate(
                """() => {
                  const st = window.VfDisplay.getInteractiveState("f1");
                  return { zoom: st.zoom, panX: st.panX, panY: st.panY };
                }"""
            )
            assert state_after["zoom"] != state_before["zoom"]
            assert state_after["panX"] != state_before["panX"] or state_after["panY"] != state_before["panY"]


@pytest.mark.network
def test_ui_parented_3d_example_mounts_geom_canvas_in_browser() -> None:
    scene_json, display_json = _scene_and_display_from_vkf(REPO / "examples" / "ui_parented_3d_local_coords.vkf")
    with _serve_vf_ui_payloads(scene_json=scene_json, display_json=display_json) as (base, _posted):
        url = f"{base}/{INDEX_DOC}"
        with _chromium_page() as page:
            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_selector(".vf-frame", state="visible", timeout=30_000)
            page.wait_for_selector(".vf-geom-canvas", state="visible", timeout=30_000)
            box = page.locator(".vf-geom-canvas").first.bounding_box()
            assert box is not None
            assert box["width"] > 16 and box["height"] > 16


@pytest.mark.network
def test_ui_3d_volume_surface_demo_supports_game_camera_controls() -> None:
    scene_json, display_json = _scene_and_display_from_vkf(REPO / "examples" / "ui_3d_volume_surface_camera.vkf")
    payload = json.loads(display_json)
    frame_id = next(iter(payload["geom"]))
    geom = payload["geom"][frame_id]
    assert len(geom["meshes"]) == 9
    assert [m["topology"] for m in geom["meshes"][:3]] == ["point-list", "line-list", "triangle-list"]
    assert geom["meshes"][-1]["solid_volume"] is True
    assert geom["camera"]["controls"] == {
        "mode": "game",
        "cursor": "none",
        "speed": 2.4,
        "sensitivity": 0.0022,
    }

    with _serve_vf_ui_payloads(scene_json=scene_json, display_json=display_json) as (base, _posted):
        url = f"{base}/{INDEX_DOC}"
        with _chromium_page() as page:
            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_selector(".vf-frame", state="visible", timeout=30_000)
            page.wait_for_selector(".vf-geom-canvas", state="visible", timeout=30_000)
            page.wait_for_timeout(500)
            assert page.locator(".vf-geom-canvas").count() == 1
            cursor_before = page.locator(".vf-geom-canvas").first.evaluate("el => getComputedStyle(el).cursor")
            before = page.evaluate("(fid) => window.VfDisplay.getGameCameraState(fid)", frame_id)
            box = page.locator(".vf-geom-canvas").last.bounding_box()
            assert box is not None
            page.mouse.move(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.5)
            page.mouse.down()
            cursor_active = page.locator(".vf-geom-canvas").first.evaluate("el => getComputedStyle(el).cursor")
            body_cursor_active = page.evaluate("() => getComputedStyle(document.body).cursor")
            page.mouse.move(box["x"] + box["width"] * 0.5 + 80, box["y"] + box["height"] * 0.5 - 20)
            after_mouse = page.evaluate("(fid) => window.VfDisplay.getGameCameraState(fid)", frame_id)
            page.keyboard.down("w")
            page.wait_for_timeout(250)
            page.keyboard.up("w")
            after = page.evaluate("(fid) => window.VfDisplay.getGameCameraState(fid)", frame_id)
            page.keyboard.press("Escape")
            cursor_after_escape = page.locator(".vf-geom-canvas").first.evaluate("el => getComputedStyle(el).cursor")

            assert cursor_before == "default"
            assert cursor_active == "none"
            assert body_cursor_active == "none"
            assert cursor_after_escape == "default"
            assert before is not None and after_mouse is not None and after is not None
            assert before["target"] != after_mouse["target"]
            assert before["pos"] != after["pos"]
            assert after["pos"][0] != pytest.approx(before["pos"][0])


@pytest.mark.network
def test_public_ui_parented_2d_transform_contract_renders_at_expected_canvas_point() -> None:
    from vektorflow.ui_scene_graph_math import Transform2D, transform_point_2d, world_affine_2d

    def _build_scene(d: Any) -> None:
        f = d.Frame()
        d.add_frame((0.1, 0.1, 0.6, 0.6))
        parent = f.add_rect((0.1, 0.2, 0.5, 0.25), color="red")
        child = parent.add_rect((0.2, 0.1, 0.5, 0.5), color="blue")
        parent.translate(dx=0.05, dy=-0.1).set_scale(sx=2.0, sy=3.0).rotate_by(angle_deg=90)
        child.translate(dx=0.1, dy=0.2).scale_by(sx=2.0, sy=0.5)

    scene_json, display_json = _scene_and_display_from_public_ui(_build_scene)
    with _serve_vf_ui_payloads(scene_json=scene_json, display_json=display_json) as (base, _posted):
        url = f"{base}/{INDEX_DOC}"
        with _chromium_page() as page:
            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_selector(".vf-frame", state="visible", timeout=30_000)
            page.wait_for_selector(".vf-frame__draw-canvas", state="visible", timeout=30_000)

            expected_parent = world_affine_2d(
                Transform2D(
                    translation=(0.15, 0.1),
                    rotation_degrees=90.0,
                    scale=(1.0, 0.75),
                )
            )
            expected_child = world_affine_2d(
                Transform2D(
                    translation=(0.3, 0.3),
                    rotation_degrees=0.0,
                    scale=(1.0, 0.25),
                ),
                parent_world=expected_parent,
            )
            sample_u, sample_v = transform_point_2d(expected_child, (0.5, 0.5))

            sample = page.locator(".vf-frame__draw-canvas").first.evaluate(
                """(canvas, point) => {
                  const ctx = canvas.getContext('2d');
                  if (!ctx) return null;
                  const x = Math.max(0, Math.min(canvas.width - 1, Math.floor(canvas.width * point[0])));
                  const y = Math.max(0, Math.min(canvas.height - 1, Math.floor(canvas.height * point[1])));
                  const at = (u, v) => {
                    const sx = Math.max(0, Math.min(canvas.width - 1, Math.floor(canvas.width * u)));
                    const sy = Math.max(0, Math.min(canvas.height - 1, Math.floor(canvas.height * v)));
                    return Array.from(ctx.getImageData(sx, sy, 1, 1).data);
                  };
                  return {
                    childCenter: at(point[0], point[1]),
                    untransformedChildCenter: at(0.45, 0.35),
                    corner: at(0.02, 0.02),
                    x,
                    y
                  };
                }""",
                [sample_u, sample_v],
            )
            assert isinstance(sample, dict)
            child_center = sample["childCenter"]
            untransformed_child_center = sample["untransformedChildCenter"]
            corner = sample["corner"]
            assert child_center[3] > 0, f"expected transformed child rect to render at sampled point, got {child_center!r}"
            assert untransformed_child_center[3] == 0, (
                "expected child local-space center to stay empty without the flattened world transform, "
                f"got {untransformed_child_center!r}"
            )
            assert corner[3] == 0, f"expected untouched corner to remain transparent, got {corner!r}"


@pytest.mark.network
def test_public_ui_parented_3d_display_payload_exposes_world_model_matrix_authority() -> None:
    from vektorflow.ui_scene_graph_math import (
        local_model_matrix_from_scene_fields,
        world_model_matrix_from_scene_fields,
    )

    def _build_scene(d: Any) -> None:
        f = d.Frame()
        d.add_frame((0.1, 0.1, 0.6, 0.6))
        parent = d.add_box(center=[1, 2, 0], scale=[2, 1, 1], color="red")
        parent.rotate_by(35, around="z")
        child = parent.add_box(center=[0.6, 0.0, 0.0], scale=[0.5, 1.2, 0.8], color="blue")
        child.rotate_by(20, around="y")
        d.add_camera(pos=[4, 3, 6], target=[0, 0, 0], fov=45)
        d.add_light(pos=[3, 4, 5], color="white")

    scene_json, display_json = _scene_and_display_from_public_ui(_build_scene)
    with _serve_vf_ui_payloads(scene_json=scene_json, display_json=display_json) as (base, _posted):
        url = f"{base}/{INDEX_DOC}"
        with _chromium_page() as page:
            page.goto(url, wait_until="domcontentloaded")
            payload = page.evaluate(
                """async () => {
                  const response = await fetch('vf-display.json');
                  return await response.json();
                }"""
            )
            assert isinstance(payload, dict)
            frame_id = next(iter(payload["geom"]))
            meshes = payload["geom"][frame_id]["meshes"]
            assert len(meshes) == 2

            parent_mesh = meshes[0]
            child_mesh = meshes[1]

            expected_parent_world = world_model_matrix_from_scene_fields(
                center=(1.0, 2.0, 0.0),
                rotation=(0.0, 0.0, 35.0),
                scale=(2.0, 1.0, 1.0),
            )
            expected_child_world = world_model_matrix_from_scene_fields(
                center=(0.6, 0.0, 0.0),
                rotation=(0.0, 20.0, 0.0),
                scale=(0.5, 1.2, 0.8),
                parent_world=expected_parent_world,
            )
            expected_child_local = local_model_matrix_from_scene_fields(
                center=(0.6, 0.0, 0.0),
                rotation=(0.0, 20.0, 0.0),
                scale=(0.5, 1.2, 0.8),
            )

            assert parent_mesh["model_matrix"] == pytest.approx(expected_parent_world)
            assert child_mesh["model_matrix"] == pytest.approx(expected_child_world)
            assert child_mesh["model_matrix"] != pytest.approx(expected_child_local)
            assert child_mesh["center"] == pytest.approx([0.6, 0.0, 0.0])
            assert child_mesh["rotation"] == pytest.approx([0.0, 20.0, 0.0])
            assert child_mesh["scale"] == pytest.approx([0.5, 1.2, 0.8])


@pytest.mark.network
def test_public_ui_parented_3d_model_matrix_matches_browser_math_parity() -> None:
    def _build_scene(d: Any) -> None:
        f = d.Frame()
        d.add_frame((0.1, 0.1, 0.6, 0.6))
        parent = d.add_box(center=[1, 2, 0], scale=[2, 1, 1], color="red")
        parent.rotate_by(35, around="z")
        child = parent.add_box(center=[0.6, 0.0, 0.0], scale=[0.5, 1.2, 0.8], color="blue")
        child.rotate_by(20, around="y")
        d.add_camera(pos=[4, 3, 6], target=[0, 0, 0], fov=45)
        d.add_light(pos=[3, 4, 5], color="white")

    scene_json, display_json = _scene_and_display_from_public_ui(_build_scene)
    with _serve_vf_ui_payloads(scene_json=scene_json, display_json=display_json) as (base, _posted):
        url = f"{base}/{INDEX_DOC}"
        with _chromium_page() as page:
            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_selector(".vf-frame", state="visible", timeout=30_000)
            page.wait_for_function("() => !!(window.VfGeomMath && window.VfGeomMath.mat4ModelTRS && window.VfGeomMath.mat4Mul)")
            parity = page.evaluate(
                """async () => {
                  const response = await fetch('vf-display.json');
                  const payload = await response.json();
                  const frameId = Object.keys(payload.geom)[0];
                  const meshes = payload.geom[frameId].meshes;
                  const parent = meshes[0];
                  const child = meshes[1];
                  const M = window.VfGeomMath;
                  const parentLocal = Array.from(M.mat4ModelTRS(parent.center, parent.rotation, parent.scale));
                  const childLocal = Array.from(M.mat4ModelTRS(child.center, child.rotation, child.scale));
                  const childWorld = Array.from(M.mat4Mul(new Float32Array(parent.model_matrix), new Float32Array(childLocal)));
                  const maxDiff = (a, b) => {
                    let diff = 0;
                    for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
                      diff = Math.max(diff, Math.abs(Number(a[i]) - Number(b[i])));
                    }
                    return diff;
                  };
                  return {
                    parentLocalDiff: maxDiff(parent.model_matrix, parentLocal),
                    childWorldDiff: maxDiff(child.model_matrix, childWorld),
                    childLocalDiff: maxDiff(child.model_matrix, childLocal)
                  };
                }"""
            )
            assert isinstance(parity, dict)
            assert parity["parentLocalDiff"] < 1e-5, parity
            assert parity["childWorldDiff"] < 1e-5, parity
            assert parity["childLocalDiff"] > 1e-3, parity


@pytest.mark.network
def test_public_ui_three_level_3d_model_matrix_matches_browser_chain_parity() -> None:
    def _build_scene(d: Any) -> None:
        f = d.Frame()
        d.add_frame((0.1, 0.1, 0.6, 0.6))
        parent = d.add_box(center=[1, 0, 0], scale=[1.5, 1.0, 1.0], color="red")
        parent.rotate_by(25, around="z")
        child = parent.add_box(center=[0.5, 0.2, 0.0], scale=[0.8, 1.1, 0.9], color="blue")
        child.rotate_by(15, around="y")
        grandchild = child.add_box(center=[0.2, 0.1, 0.3], scale=[0.4, 0.5, 0.6], color="green")
        grandchild.rotate_by(40, around="x")
        d.add_camera(pos=[4, 3, 6], target=[0, 0, 0], fov=45)
        d.add_light(pos=[3, 4, 5], color="white")

    scene_json, display_json = _scene_and_display_from_public_ui(_build_scene)
    with _serve_vf_ui_payloads(scene_json=scene_json, display_json=display_json) as (base, _posted):
        url = f"{base}/{INDEX_DOC}"
        with _chromium_page() as page:
            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_selector(".vf-frame", state="visible", timeout=30_000)
            page.wait_for_function("() => !!(window.VfGeomMath && window.VfGeomMath.mat4ModelTRS && window.VfGeomMath.mat4Mul)")
            parity = page.evaluate(
                """async () => {
                  const response = await fetch('vf-display.json');
                  const payload = await response.json();
                  const frameId = Object.keys(payload.geom)[0];
                  const meshes = payload.geom[frameId].meshes;
                  const M = window.VfGeomMath;
                  const local = (mesh) => Array.from(M.mat4ModelTRS(mesh.center, mesh.rotation, mesh.scale));
                  const maxDiff = (a, b) => {
                    let diff = 0;
                    for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
                      diff = Math.max(diff, Math.abs(Number(a[i]) - Number(b[i])));
                    }
                    return diff;
                  };
                  const parentLocal = local(meshes[0]);
                  const childLocal = local(meshes[1]);
                  const grandchildLocal = local(meshes[2]);
                  const childWorld = Array.from(M.mat4Mul(new Float32Array(meshes[0].model_matrix), new Float32Array(childLocal)));
                  const grandchildWorld = Array.from(
                    M.mat4Mul(new Float32Array(meshes[1].model_matrix), new Float32Array(grandchildLocal))
                  );
                  return {
                    parentLocalDiff: maxDiff(meshes[0].model_matrix, parentLocal),
                    childWorldDiff: maxDiff(meshes[1].model_matrix, childWorld),
                    grandchildWorldDiff: maxDiff(meshes[2].model_matrix, grandchildWorld),
                    grandchildLocalDiff: maxDiff(meshes[2].model_matrix, grandchildLocal)
                  };
                }"""
            )
            assert isinstance(parity, dict)
            assert parity["parentLocalDiff"] < 1e-5, parity
            assert parity["childWorldDiff"] < 1e-5, parity
            assert parity["grandchildWorldDiff"] < 1e-5, parity
            assert parity["grandchildLocalDiff"] > 1e-3, parity


@pytest.mark.network
def test_ui_all_classes_button_click_posts_widget_event() -> None:
    scene_json, display_json = _scene_and_display_from_vkf(REPO / "examples" / "ui_all_classes.vkf")
    with _serve_vf_ui_payloads(scene_json=scene_json, display_json=display_json) as (base, posted):
        url = f"{base}/{INDEX_DOC}"
        with _chromium_page() as page:
            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_selector(".vf-frame__body.vf-w-stack", state="visible", timeout=30_000)
            page.locator("button.vf-w-btn").click()
            page.wait_for_function("() => true", timeout=100)
            assert posted, "expected widget interaction to POST an event to /api/enqueue"
            body = posted[-1]
            assert body.get("line")
            event = json.loads(body["line"])
            assert event["event"] == "button.pressed"
            assert event["widgetId"] == "b1"


@pytest.mark.network
def test_axis_mode_button_switches_plot_panel_geom_variant() -> None:
    scene = [
        {
            "kind": "frame_upsert",
            "id": "axis_deck",
            "payload": {
                "spec": {
                    "id": "axis_deck",
                    "title": "Axis Mode Test Deck",
                    "title_align": "center",
                    "rect": {"x": 0.05, "y": 0.06, "w": 0.9, "h": 0.84},
                    "flags": {
                        "draggable": True,
                        "dockable": True,
                        "resizable": True,
                        "closable": True,
                        "use_browser": True,
                    },
                    "alpha": 0.92,
                    "master": True,
                    "dock_location": "bl",
                    "anchor": "tl",
                    "body_layout": {
                        "type": "grid",
                        "rows": 2,
                        "cols": 12,
                        "row_heights": "max-content minmax(0, 1fr)",
                    },
                    "body": [
                        {
                            "id": "axis_mode_group",
                            "type": "button_group",
                            "active": "2d_crosshair",
                            "grid": [0, 0, 1, 4],
                            "align": "left",
                            "options": [
                                {
                                    "label": "2D crosshair",
                                    "value": "2d_crosshair",
                                    "geom_frame": "axis_deck:axis_plot",
                                },
                                {
                                    "label": "2D box",
                                    "value": "2d_box",
                                    "geom_frame": "axis_deck:axis_plot",
                                },
                                {
                                    "label": "3D crosshair",
                                    "value": "3d_crosshair",
                                    "geom_frame": "axis_deck:axis_plot",
                                },
                            ],
                        },
                        {
                            "id": "axis_plot",
                            "type": "plot_panel",
                            "grid": [1, 0, 1, 12],
                            "align": "stretch",
                        },
                    ],
                }
            },
        }
    ]
    display = {
        "screen": [],
        "geom": {
            "axis_deck:axis_plot": {
                "geom_variants": {
                    "2d_crosshair": {
                        "meshes": [],
                        "texts": [],
                        "frame": "axis_deck:axis_plot",
                    },
                    "2d_box": {
                        "meshes": [
                            {
                                "id": "test_axis_line",
                                "type": "field_mesh",
                                "vertices": [
                                    -0.8,
                                    -0.8,
                                    0,
                                    0,
                                    0,
                                    1,
                                    1,
                                    1,
                                    1,
                                    1,
                                    0.8,
                                    0.8,
                                    0,
                                    0,
                                    0,
                                    1,
                                    1,
                                    1,
                                    1,
                                    1,
                                ],
                                "indices": [0, 1],
                                "topology": "line-list",
                                "render_mode": "marker_impostor",
                                "marker_space": "pixel",
                                "edge_width": 3,
                                "color": "white",
                                "aspect": "equal",
                                "axis_full_frame": False,
                                "mode3d": False,
                            }
                        ],
                        "texts": [{"pixel": True, "x": 10, "y": 10, "text": "$y=0.65\\cos(x)e^{-x^{2}}-0.25$", "color": "white"}],
                        "frame": "axis_deck:axis_plot",
                    },
                    "3d_crosshair": {
                        "meshes": [
                            {
                                "id": "test_axis3d_crosshair",
                                "type": "field_mesh",
                                "vertices": [
                                    -1, 0, 0, 0, 0, 1, 1, 1, 1, 1,
                                    1, 0, 0, 0, 0, 1, 1, 1, 1, 1,
                                    0, -1, 0, 0, 0, 1, 1, 1, 1, 1,
                                    0, 1, 0, 0, 0, 1, 1, 1, 1, 1,
                                    0, 0, -1, 0, 0, 1, 1, 1, 1, 1,
                                    0, 0, 1, 0, 0, 1, 1, 1, 1, 1,
                                ],
                                "indices": [0, 1, 2, 3, 4, 5],
                                "topology": "line-list",
                                "render_mode": "line",
                                "marker_space": "pixel",
                                "edge_width": 1.2,
                                "color": "white",
                                "axis_bind_id": "test_axis3d__axis3d_bind",
                                "axis_plot3d": None,
                                "axis3d_helper_lines": True,
                                "axis_box": False,
                                "axis_screen_extend": False,
                                "axis_grid": True,
                                "axis_grid_alpha": 0.12,
                                "mode3d": True,
                                "manifold_dim_count": 1,
                                "depth_write": True,
                                "receives_lighting": False,
                            }
                        ],
                        "texts": [{"pixel": True, "x": 10, "y": 10, "text": "$z=u^{2}-v^{2}$", "color": "white"}],
                        "frame": "axis_deck:axis_plot",
                        "axis3d_controls": True,
                        "camera": {
                            "position": [4, 4, 5.657],
                            "target": [0, 0, 0],
                            "up": [0, 0, 1],
                            "fov": 42,
                            "projection": "orthographic",
                            "ortho_scale": 3.2,
                        },
                        "axis3d_runtime": {
                            "mode": "crosshair",
                            "x_min": -2,
                            "x_max": 2,
                            "y_min": -2,
                            "y_max": 2,
                            "z_min": -2,
                            "z_max": 2,
                            "x_label": "x",
                            "y_label": "y",
                            "z_label": "z",
                            "ticks": True,
                            "grid": True,
                            "grid_alpha": 0.12,
                            "grid_width": 1,
                            "tick_len_px": 7,
                            "tick_label_font_size": 11,
                            "label_font_size": 13,
                        },
                    },
                },
                "active_geom_variant": "2d_crosshair",
                "meshes": [],
                "texts": [],
                "frame": "axis_deck:axis_plot",
            }
        },
    }
    packets = [
        {"seq": 1, "kind": "scene.replace", "payload": {"commands": scene}},
        {"seq": 2, "kind": "display.replace", "payload": {"display": display}},
    ]

    if not (VF_UI / "vf-runtime-shell.js").is_file():
        pytest.skip("web/vf-ui not found")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "vf"
        shutil.copytree(VF_UI, root, dirs_exist_ok=True)
        (root / INDEX_DOC).write_text(
            '<!DOCTYPE html><html><body data-vf-runtime-shell="scene" '
            'data-vf-runtime-packet-only="true" '
            'data-vf-runtime-file-packets="vf-runtime-packets.json" '
            'data-vf-runtime-prefer-file-packets="true">'
            '<script src="vf-runtime-shell.js"></script></body></html>',
            encoding="utf-8",
        )
        (root / "vf-runtime-packets.json").write_text(json.dumps(packets), encoding="utf-8")
        base, httpd, _thr, _posted = _http_server_for_directory(root)
        try:
            with _chromium_page() as page:
                page.goto(f"{base.rstrip('/')}/{INDEX_DOC}", wait_until="domcontentloaded")
                page.wait_for_selector(".vf-w-button-group__btn", state="visible")
                page.get_by_role("button", name="2D box").click()
                page.wait_for_function(
                    """
                    () => {
                      const frame = document.querySelector('.vf-frame[data-vf-frame-id="axis_deck"]');
                      return frame && frame.getAttribute('data-vf-active-geom-variant') === '2d_box';
                    }
                    """
                )
                layout = page.evaluate(
                    """
                    () => {
                      const frame = document.querySelector('.vf-frame[data-vf-frame-id="axis_deck"]');
                      const plot = document.querySelector('.vf-w-plot-panel[data-vf-geom-host="1"]');
                      const canvas = plot && plot.querySelector('canvas[data-vf-geom-canvas="1"]');
                      const overlay = document.querySelector('.vf-geom-text-overlay[data-vf-geom-text-fid="axis_deck:axis_plot"]');
                      const button = document.querySelector('button.vf-w-button-group__btn');
                      function rect(el) {
                        const r = el.getBoundingClientRect();
                        return { left: r.left, top: r.top, width: r.width, height: r.height };
                      }
                      return {
                        active: frame && frame.getAttribute('data-vf-active-geom-variant'),
                        plot: plot && rect(plot),
                        canvas: canvas && rect(canvas),
                        overlay: overlay && rect(overlay),
                        plotBg: plot && getComputedStyle(plot).backgroundColor,
                        plotPointer: plot && getComputedStyle(plot).pointerEvents,
                        canvasPointer: canvas && getComputedStyle(canvas).pointerEvents,
                        buttonPointer: button && getComputedStyle(button).pointerEvents,
                      };
                    }
                    """
                )
                assert layout["active"] == "2d_box"
                assert layout["plot"] and layout["canvas"] and layout["overlay"]
                assert layout["plotBg"] in ("transparent", "rgba(0, 0, 0, 0)")
                assert layout["plotPointer"] == "auto"
                assert layout["canvasPointer"] in ("auto", "none")
                assert layout["buttonPointer"] != "none"
                for key in ("left", "top", "width", "height"):
                    assert abs(layout["plot"][key] - layout["canvas"][key]) <= 2
                    assert abs(layout["plot"][key] - layout["overlay"][key]) <= 2
                page.wait_for_function(
                    """
                    () => {
                      const canvas = document.querySelector('.vf-w-plot-panel canvas[data-vf-geom-canvas="1"]');
                      if (!canvas || !canvas.width || !canvas.height) return false;
                      const ctx = canvas.getContext('2d', { alpha: true });
                      if (!ctx) return false;
                      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                      for (let i = 3; i < data.length; i += 4) {
                        if (data[i] > 0) return true;
                      }
                      return false;
                    }
                    """,
                    timeout=5_000,
                )
                formula_html = page.locator(
                    '.vf-geom-text-overlay[data-vf-geom-text-fid="axis_deck:axis_plot"] .katex'
                ).first
                expect(formula_html).to_be_visible(timeout=5_000)
                expect(formula_html).to_contain_text("y=0.65")
                page.evaluate(
                    """
                    () => {
                      const canvas = document.querySelector('.vf-w-plot-panel canvas[data-vf-geom-canvas="1"]');
                      canvas.dataset.probe2dCanvas = '1';
                    }
                    """
                )
                page.get_by_role("button", name="3D crosshair").click()
                page.wait_for_function(
                    """
                    () => {
                      const frame = document.querySelector('.vf-frame[data-vf-frame-id="axis_deck"]');
                      return frame && frame.getAttribute('data-vf-active-geom-variant') === '3d_crosshair';
                    }
                    """
                )
                canvas_reused = page.evaluate(
                    """
                    () => !!document.querySelector('.vf-w-plot-panel canvas[data-probe2d-canvas="1"]')
                    """
                )
                assert canvas_reused is False
                page.wait_for_selector(".vf-w-plot-panel canvas.vf-geom-line-overlay", timeout=5_000)
                page.wait_for_function(
                    """
                    () => {
                      const canvas = document.querySelector('.vf-w-plot-panel canvas.vf-geom-line-overlay');
                      if (!canvas || !canvas.width || !canvas.height) return false;
                      const ctx = canvas.getContext('2d', { alpha: true });
                      if (!ctx) return false;
                      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                      for (let i = 3; i < data.length; i += 4) {
                        if (data[i] > 0) return true;
                      }
                      return false;
                    }
                    """,
                    timeout=5_000,
                )
                page.wait_for_function(
                    """
                    () => {
                      const overlay = document.querySelector('.vf-geom-text-overlay[data-vf-geom-text-fid="axis_deck:axis_plot"]');
                      return overlay && overlay.innerText.includes('z=u');
                    }
                    """,
                    timeout=5_000,
                )
        finally:
            with contextlib.suppress(Exception):
                httpd.shutdown()
            with contextlib.suppress(Exception):
                httpd.server_close()


@pytest.mark.network
def test_polar_plot_out_of_range_segments_do_not_fallback_to_raw_vertices() -> None:
    scene = [
        {
            "kind": "frame_upsert",
            "id": "polar_deck",
            "payload": {
                "spec": {
                    "id": "polar_deck",
                    "title": "Polar Clip",
                    "rect": {"x": 0.05, "y": 0.06, "w": 0.7, "h": 0.7},
                    "flags": {"use_browser": True, "closable": True},
                    "body_layout": {"type": "grid", "rows": 1, "cols": 1},
                    "body": [{"id": "plot", "type": "plot_panel", "grid": [0, 0, 1, 1], "align": "stretch"}],
                }
            },
        }
    ]
    controller = {
        "id": "polar_controller",
        "type": "field_mesh",
        "vertices": [-1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1],
        "indices": [0, 1],
        "topology": "line-list",
        "render_mode": "marker_impostor",
        "marker_space": "pixel",
        "edge_width": 1,
        "color": "white",
        "aspect": "equal",
        "axis_box": True,
        "axis_polar": True,
        "axis_bind_id": "polar_bind",
        "axis_ticks": {
            "enabled": True,
            "x_min": -1,
            "x_max": 1,
            "y_min": -1,
            "y_max": 1,
            "r_min": 0,
            "r_max": 1,
            "grid": False,
            "rings": 2,
            "spokes": 8,
        },
        "axis_plot2d": None,
        "mode3d": False,
    }
    outside_curve = {
        "id": "outside_curve",
        "type": "field_mesh",
        "vertices": [
            -1,
            0,
            0,
            0,
            0,
            1,
            0,
            0,
            1,
            1,
            1,
            0,
            0,
            0,
            0,
            1,
            0,
            0,
            1,
            1,
        ],
        "indices": [0, 1],
        "topology": "line-list",
        "render_mode": "marker_impostor",
        "marker_space": "pixel",
        "edge_width": 5,
        "color": [1, 0, 0, 1],
        "aspect": "equal",
        "axis_bind_id": "polar_bind",
        "axis_ticks": None,
        "axis_plot2d": {"x_values": [2, 3], "y_values": [0, 0]},
        "mode3d": False,
    }
    display = {
        "screen": [],
        "geom": {
            "polar_deck:plot": {
                "meshes": [controller, outside_curve],
                "texts": [],
                "frame": "polar_deck:plot",
            }
        },
    }
    packets = [
        {"seq": 1, "kind": "scene.replace", "payload": {"commands": scene}},
        {"seq": 2, "kind": "display.replace", "payload": {"display": display}},
    ]

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "vf"
        shutil.copytree(VF_UI, root, dirs_exist_ok=True)
        (root / INDEX_DOC).write_text(
            '<!DOCTYPE html><html><body data-vf-runtime-shell="scene" '
            'data-vf-runtime-packet-only="true" '
            'data-vf-runtime-file-packets="vf-runtime-packets.json" '
            'data-vf-runtime-prefer-file-packets="true">'
            '<script src="vf-runtime-shell.js"></script></body></html>',
            encoding="utf-8",
        )
        (root / "vf-runtime-packets.json").write_text(json.dumps(packets), encoding="utf-8")
        base, httpd, _thr, _posted = _http_server_for_directory(root)
        try:
            with _chromium_page() as page:
                page.goto(f"{base.rstrip('/')}/{INDEX_DOC}", wait_until="domcontentloaded")
                page.wait_for_selector(".vf-w-plot-panel canvas[data-vf-geom-canvas='1']", timeout=30_000)
                page.wait_for_timeout(500)
                red_pixels = page.evaluate(
                    """
                    () => {
                      const canvas = document.querySelector('.vf-w-plot-panel canvas[data-vf-geom-canvas="1"]');
                      const ctx = canvas.getContext('2d', { alpha: true });
                      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                      let count = 0;
                      for (let i = 0; i < data.length; i += 4) {
                        if (data[i] > 160 && data[i + 1] < 80 && data[i + 2] < 80 && data[i + 3] > 120) count++;
                      }
                      return count;
                    }
                    """
                )
                assert red_pixels == 0
        finally:
            with contextlib.suppress(Exception):
                httpd.shutdown()
            with contextlib.suppress(Exception):
                httpd.server_close()


@pytest.mark.network
def test_polar_plot_prefers_phi_values_when_axis_rotates() -> None:
    scene = [
        {
            "kind": "frame_upsert",
            "id": "polar_deck",
            "payload": {
                "spec": {
                    "id": "polar_deck",
                    "title": "Polar Phi",
                    "rect": {"x": 0.05, "y": 0.06, "w": 0.7, "h": 0.7},
                    "flags": {"use_browser": True, "closable": True},
                    "body_layout": {"type": "grid", "rows": 1, "cols": 1},
                    "body": [{"id": "plot", "type": "plot_panel", "grid": [0, 0, 1, 1], "align": "stretch"}],
                }
            },
        }
    ]
    controller = {
        "id": "polar_controller",
        "type": "field_mesh",
        "vertices": [-1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1],
        "indices": [0, 1],
        "topology": "line-list",
        "render_mode": "marker_impostor",
        "marker_space": "pixel",
        "edge_width": 1,
        "color": "white",
        "aspect": "equal",
        "axis_box": True,
        "axis_polar": True,
        "axis_bind_id": "polar_bind",
        "axis_ticks": {"enabled": True, "r_min": 0, "r_max": 1, "grid": False, "rings": 1, "spokes": 4},
        "axis_plot2d": None,
        "mode3d": False,
    }
    curve = {
        "id": "phi_curve",
        "type": "field_mesh",
        "vertices": [-1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 0, 0, 1, 1],
        "indices": [0, 1],
        "topology": "line-list",
        "render_mode": "marker_impostor",
        "marker_space": "pixel",
        "edge_width": 6,
        "color": [1, 0, 0, 1],
        "aspect": "equal",
        "axis_bind_id": "polar_bind",
        "axis_ticks": None,
        "axis_plot2d": {
            "x_values": [0.2, 0.8],
            "y_values": [0, 0],
            "r_values": [0.2, 0.8],
            "phi_values": [1.57079632679, 1.57079632679],
        },
        "mode3d": False,
    }
    display = {
        "screen": [],
        "geom": {"polar_deck:plot": {"meshes": [controller, curve], "texts": [], "frame": "polar_deck:plot"}},
    }

    packets = [
        {"seq": 1, "kind": "scene.replace", "payload": {"commands": scene}},
        {"seq": 2, "kind": "display.replace", "payload": {"display": display}},
    ]

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "vf"
        shutil.copytree(VF_UI, root, dirs_exist_ok=True)
        (root / INDEX_DOC).write_text(
            '<!DOCTYPE html><html><body data-vf-runtime-shell="scene" '
            'data-vf-runtime-packet-only="true" '
            'data-vf-runtime-file-packets="vf-runtime-packets.json" '
            'data-vf-runtime-prefer-file-packets="true">'
            '<script src="vf-runtime-shell.js"></script></body></html>',
            encoding="utf-8",
        )
        (root / "vf-runtime-packets.json").write_text(json.dumps(packets), encoding="utf-8")
        base, httpd, _thr, _posted = _http_server_for_directory(root)
        try:
            with _chromium_page() as page:
                page.goto(f"{base.rstrip('/')}/{INDEX_DOC}", wait_until="domcontentloaded")
                page.wait_for_selector(".vf-w-plot-panel canvas[data-vf-geom-canvas='1']", timeout=30_000)
                page.wait_for_timeout(500)
                counts = page.evaluate(
                    """
                    () => {
                      const canvas = document.querySelector('.vf-w-plot-panel canvas[data-vf-geom-canvas="1"]');
                      const ctx = canvas.getContext('2d', { alpha: true });
                      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                      const cx = canvas.width / 2;
                      const cy = canvas.height / 2;
                      let vertical = 0;
                      let horizontal = 0;
                      for (let y = 0; y < canvas.height; y += 1) {
                        for (let x = 0; x < canvas.width; x += 1) {
                          const i = (y * canvas.width + x) * 4;
                          const red = data[i] > 160 && data[i + 1] < 80 && data[i + 2] < 80 && data[i + 3] > 120;
                          if (!red) continue;
                          if (Math.abs(x - cx) <= 8 && y < cy - 20) vertical += 1;
                          if (Math.abs(y - cy) <= 8 && x > cx + 20) horizontal += 1;
                        }
                      }
                      return { vertical, horizontal };
                    }
                    """
                )
                assert counts["vertical"] > 20
                assert counts["vertical"] > counts["horizontal"] * 3
        finally:
            with contextlib.suppress(Exception):
                httpd.shutdown()
            with contextlib.suppress(Exception):
                httpd.server_close()


@pytest.mark.network
def test_ctrl_drag_rotates_polar_theta_tick_labels() -> None:
    scene = [
        {
            "kind": "frame_upsert",
            "id": "polar_deck",
            "payload": {
                "spec": {
                    "id": "polar_deck",
                    "title": "Polar Rotate",
                    "rect": {"x": 0.05, "y": 0.06, "w": 0.7, "h": 0.7},
                    "flags": {"use_browser": True, "closable": True},
                    "body_layout": {"type": "grid", "rows": 1, "cols": 1},
                    "body": [{"id": "plot", "type": "plot_panel", "grid": [0, 0, 1, 1], "align": "stretch"}],
                }
            },
        }
    ]
    controller = {
        "id": "polar_controller",
        "type": "field_mesh",
        "vertices": [-1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1],
        "indices": [0, 1],
        "topology": "line-list",
        "render_mode": "marker_impostor",
        "marker_space": "pixel",
        "edge_width": 1,
        "color": "white",
        "aspect": "equal",
        "axis_box": True,
        "axis_polar": True,
        "axis_bind_id": "polar_bind",
        "axis_ticks": {
            "enabled": True,
            "x_min": -1,
            "x_max": 1,
            "y_min": -1,
            "y_max": 1,
            "r_min": 0,
            "r_max": 1,
            "grid": True,
            "rings": 2,
            "spokes": 8,
            "theta_label_step_deg": 45,
        },
        "axis_plot2d": None,
        "mode3d": False,
    }
    display = {
        "screen": [],
        "geom": {"polar_deck:plot": {"meshes": [controller], "texts": [], "frame": "polar_deck:plot"}},
    }
    packets = [
        {"seq": 1, "kind": "scene.replace", "payload": {"commands": scene}},
        {"seq": 2, "kind": "display.replace", "payload": {"display": display}},
    ]

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "vf"
        shutil.copytree(VF_UI, root, dirs_exist_ok=True)
        (root / INDEX_DOC).write_text(
            '<!DOCTYPE html><html><body data-vf-runtime-shell="scene" '
            'data-vf-runtime-packet-only="true" '
            'data-vf-runtime-file-packets="vf-runtime-packets.json" '
            'data-vf-runtime-prefer-file-packets="true">'
            '<script src="vf-runtime-shell.js"></script></body></html>',
            encoding="utf-8",
        )
        (root / "vf-runtime-packets.json").write_text(json.dumps(packets), encoding="utf-8")
        base, httpd, _thr, _posted = _http_server_for_directory(root)
        try:
            with _chromium_page() as page:
                page.goto(f"{base.rstrip('/')}/{INDEX_DOC}", wait_until="domcontentloaded")
                plot = page.locator(".vf-w-plot-panel").first
                expect(plot).to_be_visible(timeout=30_000)
                page.wait_for_function(
                    """() => Array.from(document.querySelectorAll('.vf-geom-text-overlay__item'))
                      .some((el) => el.dataset.vfGeomTextValue === '$90^\\\\circ$')""",
                    timeout=10_000,
                )
                before = page.evaluate(
                    """
                    () => {
                      const items = Array.from(document.querySelectorAll('.vf-geom-text-overlay__item'))
                        .filter((item) => item.style.display !== 'none');
                      const ninety = items.find((item) => item.dataset.vfGeomTextValue === '$90^\\\\circ$');
                      const zero = items.find((item) => item.dataset.vfGeomTextValue === '$0^\\\\circ$');
                      function anchor(el) {
                        const m = /translate3d\\(\\s*([-0-9.]+)px\\s*,\\s*([-0-9.]+)px\\s*,\\s*0(?:px)?\\s*\\)/.exec(el.style.transform || '');
                        return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
                      }
                      const plot = document.querySelector('.vf-w-plot-panel');
                      const er = ninety.getBoundingClientRect();
                      const pr = plot.getBoundingClientRect();
                      const n = anchor(ninety);
                      const z = anchor(zero);
                      return { x: er.left + er.width / 2, y: er.top + er.height / 2, cx: n.x, cy: z.y, radius: Math.max(40, Math.min(z.x - n.x, z.y - n.y) * 0.72), plotCx: pr.left + pr.width / 2, plotCy: pr.top + pr.height / 2 };
                    }
                    """
                )
                page.keyboard.down("Control")
                near_quarter_turn = 86 * 3.141592653589793 / 180
                page.mouse.move(before["cx"] + before["radius"], before["cy"])
                page.mouse.down()
                page.mouse.move(
                    before["cx"] + before["radius"] * math.cos(near_quarter_turn),
                    before["cy"] - before["radius"] * math.sin(near_quarter_turn),
                    steps=12,
                )
                page.mouse.up()
                page.keyboard.up("Control")
                page.wait_for_timeout(400)
                after = page.evaluate(
                    """
                    () => {
                      const items = Array.from(document.querySelectorAll('.vf-geom-text-overlay__item'))
                        .filter((item) => item.style.display !== 'none');
                      const ninety = items.find((item) => item.dataset.vfGeomTextValue === '$90^\\\\circ$');
                      const zero = items.find((item) => item.dataset.vfGeomTextValue === '$0^\\\\circ$');
                      function anchor(el) {
                        const m = /translate3d\\(\\s*([-0-9.]+)px\\s*,\\s*([-0-9.]+)px\\s*,\\s*0(?:px)?\\s*\\)/.exec(el.style.transform || '');
                        return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
                      }
                      const nr = ninety.getBoundingClientRect();
                      const zr = zero.getBoundingClientRect();
                          return {
                            ninety: { x: nr.left + nr.width / 2, y: nr.top + nr.height / 2 },
                            zero: { x: zr.left + zr.width / 2, y: zr.top + zr.height / 2 },
                            ninetyAnchor: anchor(ninety),
                            zeroAnchor: anchor(zero)
                          };
                        }
                        """
                )
                assert before["cy"] - before["radius"] < before["y"] + 30
                assert after["ninetyAnchor"]["x"] < before["cx"] - 20
                page.add_script_tag(path=str(VF_UI / "vf-axis2d-ticks.js"))
                snapped = page.evaluate(
                    """
                    () => window.VfAxis2DTicks.polarThetaOffset({
                      __raw_theta_offset_rad: 86 * Math.PI / 180
                    }) * 180 / Math.PI
                    """
                )
                assert snapped == pytest.approx(90)
        finally:
            with contextlib.suppress(Exception):
                httpd.shutdown()
            with contextlib.suppress(Exception):
                httpd.server_close()


@pytest.mark.network
def test_public_ui_widget_button_click_posts_event() -> None:
    def _build_scene(d: Any) -> None:
        w = d.widget
        f = d.frame(title="Widget Event")
        d.add_frame(
            f,
            (0.1, 0.1, 0.35, 0.2),
            body=[w.button("btn.save", label="Save")],
        )

    scene_json, display_json = _scene_and_display_from_public_ui(_build_scene)
    with _serve_vf_ui_payloads(scene_json=scene_json, display_json=display_json) as (base, posted):
        url = f"{base}/{INDEX_DOC}"
        with _chromium_page() as page:
            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_selector(".vf-frame__body.vf-w-stack", state="visible", timeout=30_000)
            page.locator("button.vf-w-btn").click()
            page.wait_for_function("() => true", timeout=100)
            assert posted, "expected public ui widget click to POST an event"
            dispatch = build_browser_host_event_dispatch(posted[-1], event_kind_count={})
            assert dispatch.payload["type"] == "vf_event"
            assert dispatch.payload["event"] == "button.pressed"
            assert dispatch.payload["widget_id"] == "btn.save"
            assert dispatch.route == "host"
            assert dispatch.should_queue is True
            assert dispatch.payload["index"] == 1


@pytest.mark.network
def test_public_ui_input_field_posts_changed_and_entered_events() -> None:
    def _build_scene(d: Any) -> None:
        w = d.widget
        f = d.frame(title="Input Event")
        d.add_frame(
            f,
            (0.1, 0.1, 0.38, 0.22),
            body=[w.input_field("name", text="", placeholder="Type here")],
        )

    scene_json, display_json = _scene_and_display_from_public_ui(_build_scene)
    with _serve_vf_ui_payloads(scene_json=scene_json, display_json=display_json) as (base, posted):
        url = f"{base}/{INDEX_DOC}"
        with _chromium_page() as page:
            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_selector(".vf-frame__body.vf-w-stack", state="visible", timeout=30_000)
            field = page.locator("input.vf-w-input").first
            field.fill("Ada")
            field.press("Enter")
            page.wait_for_function("() => true", timeout=100)
            assert len(posted) >= 2, "expected changed and entered events from the input field"
            changed = build_browser_host_event_dispatch(posted[-2], event_kind_count={})
            entered = build_browser_host_event_dispatch(posted[-1], event_kind_count={})
            assert changed.payload["type"] == "vf_event"
            assert entered.payload["type"] == "vf_event"
            assert changed.payload["event"] == "input_field.text_changed"
            assert entered.payload["event"] == "input_field.text_entered"
            assert changed.payload["widget_id"] == "name"
            assert entered.payload["widget_id"] == "name"
            assert changed.payload["data"] == {"text": "Ada"}
            assert entered.payload["data"] == {"text": "Ada"}
            assert changed.payload["frame_id"]
            assert entered.payload["frame_id"] == changed.payload["frame_id"]


@pytest.mark.network
def test_public_ui_slider_posts_value_changed_event() -> None:
    def _build_scene(d: Any) -> None:
        w = d.widget
        f = d.frame(title="Slider Event")
        d.add_frame(
            f,
            (0.1, 0.1, 0.38, 0.22),
            body=[w.slider("alpha", value=0.5, vmin=0, vmax=1, step=0.1)],
        )

    scene_json, display_json = _scene_and_display_from_public_ui(_build_scene)
    with _serve_vf_ui_payloads(scene_json=scene_json, display_json=display_json) as (base, posted):
        url = f"{base}/{INDEX_DOC}"
        with _chromium_page() as page:
            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_selector(".vf-frame__body.vf-w-stack", state="visible", timeout=30_000)
            slider = page.locator("input.vf-w-range").first
            slider.fill("0.3")
            page.wait_for_function("() => true", timeout=100)
            assert posted, "expected slider change to POST an event"
            dispatch = build_browser_host_event_dispatch(posted[-1], event_kind_count={})
            assert dispatch.payload["type"] == "vf_event"
            assert dispatch.payload["event"] == "slider.value_changed"
            assert dispatch.payload["widget_id"] == "alpha"
            assert dispatch.payload["data"] == {"value": 0.3}
            assert dispatch.payload["frame_id"]
            assert dispatch.route == "host"
            assert dispatch.should_queue is True
            assert dispatch.payload["index"] == 1


@pytest.mark.network
def test_public_ui_dropdown_posts_item_changed_event() -> None:
    def _build_scene(d: Any) -> None:
        w = d.widget
        f = d.frame(title="Dropdown Event")
        d.add_frame(
            f,
            (0.1, 0.1, 0.38, 0.22),
            body=[w.dropdown("mode", options=["Alpha", "Beta", "Gamma"], value=0)],
        )

    scene_json, display_json = _scene_and_display_from_public_ui(_build_scene)
    with _serve_vf_ui_payloads(scene_json=scene_json, display_json=display_json) as (base, posted):
        url = f"{base}/{INDEX_DOC}"
        with _chromium_page() as page:
            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_selector(".vf-frame__body.vf-w-stack", state="visible", timeout=30_000)
            dropdown = page.locator("select.vf-w-select").first
            dropdown.select_option(index=1)
            page.wait_for_function("() => true", timeout=100)
            assert posted, "expected dropdown change to POST an event"
            dispatch = build_browser_host_event_dispatch(posted[-1], event_kind_count={})
            assert dispatch.payload["type"] == "vf_event"
            assert dispatch.payload["event"] == "dropdown.item_changed"
            assert dispatch.payload["widget_id"] == "mode"
            assert dispatch.payload["data"] == {"index": 1, "text": "Beta"}
            assert dispatch.payload["frame_id"]
            assert dispatch.route == "host"
            assert dispatch.should_queue is True
            assert dispatch.payload["index"] == 1


@pytest.mark.network
def test_public_ui_widget_set_updates_input_field_after_mount() -> None:
    def _build_scene(d: Any) -> dict[str, Any]:
        w = d.widget
        f = d.frame(title="Input State")
        d.add_frame(
            f,
            (0.1, 0.1, 0.38, 0.22),
            body=[w.input_field("name", text="", placeholder="Type here")],
        )
        return {"frame_id": f.id}

    with _serve_public_ui_browser(_build_scene) as harness:
        with _chromium_page() as page:
            page.goto(harness.url, wait_until="domcontentloaded")
            page.wait_for_selector(".vf-frame__body.vf-w-stack", state="visible", timeout=30_000)
            field = page.locator("input.vf-w-input").first
            expect(field).to_have_value("")
            harness.write_state_patch({harness.meta["frame_id"]: {"name": {"text": "Grace"}}})
            expect(field).to_have_value("Grace", timeout=5_000)


@pytest.mark.network
def test_public_ui_slider_widget_set_updates_value_and_emits_change() -> None:
    def _build_scene(d: Any) -> dict[str, Any]:
        w = d.widget
        f = d.frame(title="Slider State")
        d.add_frame(
            f,
            (0.1, 0.1, 0.4, 0.24),
            body=[w.slider("zoom", value=0.2, vmin=0.0, vmax=1.0, step=0.05)],
        )
        return {"frame_id": f.id}

    with _serve_public_ui_browser(_build_scene) as harness:
        with _chromium_page() as page:
            page.goto(harness.url, wait_until="domcontentloaded")
            page.wait_for_selector(".vf-frame__body.vf-w-stack", state="visible", timeout=30_000)
            slider = page.locator("input.vf-w-range").first
            value_label = page.locator(".vf-w-slider-val").first
            expect(slider).to_have_value("0.2")
            expect(value_label).to_have_text("0.2")

            harness.write_state_patch({harness.meta["frame_id"]: {"zoom": {"value": 0.75}}})
            expect(slider).to_have_value("0.75", timeout=5_000)
            expect(value_label).to_have_text("0.75", timeout=5_000)

            before = harness.posted_count()
            slider.fill("0.4")
            expect(slider).to_have_value("0.4")
            expect(value_label).to_have_text("0.4")
            page.wait_for_timeout(150)
            assert harness.posted_count() > before, "expected slider interaction to POST an event"
            changed = harness.latest_dispatch()
            assert changed.payload["type"] == "vf_event"
            assert changed.payload["event"] == "slider.value_changed"
            assert changed.payload["widget_id"] == "zoom"
            assert changed.payload["frame_id"] == harness.meta["frame_id"]
            assert changed.payload["data"] == {"value": 0.4}


@pytest.mark.network
def test_public_ui_checkbox_widget_set_updates_and_emits_toggle() -> None:
    def _build_scene(d: Any) -> dict[str, Any]:
        w = d.widget
        f = d.frame(title="Checkbox State")
        d.add_frame(
            f,
            (0.1, 0.1, 0.4, 0.24),
            body=[w.checkbox("confirm", checked=False, label="Pending")],
        )
        return {"frame_id": f.id}

    with _serve_public_ui_browser(_build_scene) as harness:
        with _chromium_page() as page:
            page.goto(harness.url, wait_until="domcontentloaded")
            page.wait_for_selector(".vf-frame__body.vf-w-stack", state="visible", timeout=30_000)
            checkbox = page.locator("label.vf-w-check input").first
            caption = page.locator(".vf-w-check-cap").first
            expect(checkbox).not_to_be_checked()
            expect(caption).to_have_text("Pending")

            harness.write_state_patch(
                {harness.meta["frame_id"]: {"confirm": {"checked": True, "label": "Confirmed"}}}
            )
            expect(checkbox).to_be_checked(timeout=5_000)
            expect(caption).to_have_text("Confirmed", timeout=5_000)

            before = harness.posted_count()
            checkbox.uncheck()
            expect(checkbox).not_to_be_checked()
            page.wait_for_timeout(150)
            assert harness.posted_count() > before, "expected checkbox toggle to POST an event"
            toggled = harness.latest_dispatch()
            assert toggled.payload["type"] == "vf_event"
            assert toggled.payload["event"] == "checkbox.toggled"
            assert toggled.payload["widget_id"] == "confirm"
            assert toggled.payload["frame_id"] == harness.meta["frame_id"]
            assert toggled.payload["data"] == {"checked": False}
            assert toggled.route == "host"
            assert toggled.should_queue is True
            assert toggled.payload["index"] == 1


@pytest.mark.network
def test_public_ui_text_area_widget_set_updates_and_emits_change() -> None:
    def _build_scene(d: Any) -> dict[str, Any]:
        w = d.widget
        f = d.frame(title="Text Area State")
        d.add_frame(
            f,
            (0.1, 0.1, 0.42, 0.26),
            body=[w.text_area("notes", text="")],
        )
        return {"frame_id": f.id}

    with _serve_public_ui_browser(_build_scene) as harness:
        with _chromium_page() as page:
            page.goto(harness.url, wait_until="domcontentloaded")
            page.wait_for_selector(".vf-frame__body.vf-w-stack", state="visible", timeout=30_000)
            text_area = page.locator("textarea.vf-w-textarea").first
            expect(text_area).to_have_value("")

            harness.write_state_patch({harness.meta["frame_id"]: {"notes": {"text": "Seed text"}}})
            expect(text_area).to_have_value("Seed text", timeout=5_000)

            before = harness.posted_count()
            text_area.fill("line\n2")
            expect(text_area).to_have_value("line\n2")
            page.wait_for_timeout(150)
            assert harness.posted_count() > before, "expected text area edit to POST an event"
            changed = harness.latest_dispatch()
            assert changed.payload["type"] == "vf_event"
            assert changed.payload["event"] == "text_area.text_changed"
            assert changed.payload["widget_id"] == "notes"
            assert changed.payload["frame_id"] == harness.meta["frame_id"]
            assert changed.payload["data"] == {"text": "line\n2"}
