"""Static-file browser smoke test for the Python-free shared-runtime demo."""

from __future__ import annotations

import contextlib
from pathlib import Path
from contextlib import contextmanager
from typing import Generator

import pytest

pytest.importorskip("playwright")
from playwright.sync_api import Page, sync_playwright

REPO = Path(__file__).resolve().parents[1]
DEMO = REPO / "web" / "vf-ui" / "vf-shared-rect-demo.html"


@contextmanager
def _static_chromium_page() -> Generator[Page, None, None]:
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(
                headless=True,
                args=[
                    "--enable-features=SharedArrayBuffer",
                    "--allow-file-access-from-files",
                ],
            )
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
def test_shared_runtime_demo_runs_from_file_url_without_python_server() -> None:
    with _static_chromium_page() as page:
        requests: list[str] = []
        page.on("request", lambda request: requests.append(request.url))
        page.goto(DEMO.resolve().as_uri(), wait_until="domcontentloaded")
        page.wait_for_function("() => window.__vfSharedRectDemo")

        assert page.evaluate("() => typeof SharedArrayBuffer") == "function"
        assert page.evaluate("() => window.__vfSharedRectDemo.getRect()") == {
            "x": 120,
            "y": 96,
            "w": 180,
            "h": 118,
        }
        assert all(request.startswith("file://") for request in requests)
