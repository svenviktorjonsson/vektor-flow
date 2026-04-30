from __future__ import annotations

import contextlib
import http.server
import shutil
import socketserver
import tempfile
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright


REPO = Path(__file__).resolve().parents[1]
VF_UI = REPO / "web" / "vf-ui"
OUT = REPO / "docs" / "public" / "images"
INDEX_DOC = "vkf-scene.html"


def _scene_from_vkf(vkf: Path) -> str:
    from vektorflow.interpreter import Interpreter
    from vektorflow.parser import parse_module

    ip = Interpreter(vkf)
    ip.run_module(parse_module(vkf.read_text(encoding="utf-8"), str(vkf)))
    d = ip.globals.get("d")
    if d is None or not hasattr(d, "dumps"):
        raise RuntimeError(f"{vkf.name} must define display as `d` (ui.display)")
    return d.dumps()


def _http_server_for_directory(root: Path) -> tuple[str, socketserver.TCPServer]:
    root_s = str(root)

    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a: object, **k: object) -> None:
            super().__init__(*a, directory=root_s, **k)

        def do_POST(self) -> None:  # noqa: N802
            if self.path.split("?", 1)[0] == "/api/enqueue":
                self.send_response(204)
                self.end_headers()
                return
            self.send_error(404)

    httpd: socketserver.TCPServer = socketserver.TCPServer(("127.0.0.1", 0), H)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return f"http://127.0.0.1:{httpd.server_address[1]}/", httpd


def capture(example: Path, output_name: str, *, viewport: tuple[int, int] = (1400, 900)) -> Path:
    with tempfile.TemporaryDirectory(prefix="vf-docs-ui-") as tmp:
        root = Path(tmp) / "vf"
        shutil.copytree(VF_UI, root, dirs_exist_ok=True)
        (root / "vkf-scene.json").write_text(_scene_from_vkf(example), encoding="utf-8")
        (root / "vf-ui-state.json").write_text("{}", encoding="utf-8")
        base, httpd = _http_server_for_directory(root)
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                try:
                    page = browser.new_page(viewport={"width": viewport[0], "height": viewport[1]})
                    page.goto(f"{base}{INDEX_DOC}", wait_until="domcontentloaded")
                    page.wait_for_timeout(1200)
                    OUT.mkdir(parents=True, exist_ok=True)
                    target = OUT / output_name
                    page.screenshot(path=str(target), full_page=True)
                    return target
                finally:
                    browser.close()
        finally:
            with contextlib.suppress(Exception):
                httpd.shutdown()
            with contextlib.suppress(Exception):
                httpd.server_close()


def main() -> int:
    captures = [
        (REPO / "examples" / "ui_widgets_static.vkf", "ui-widgets-static.png", (1500, 1000)),
        (REPO / "examples" / "ui_frame_transparency_box.vkf", "ui-frame-transparency-box.png", (1500, 1000)),
    ]
    for example, output_name, viewport in captures:
        target = capture(example, output_name, viewport=viewport)
        print(target)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
