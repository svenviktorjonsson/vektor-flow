from __future__ import annotations

import argparse
import contextlib
import http.server
import json
import logging
import os
import socket
import subprocess
import shutil
import socketserver
import tempfile
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parents[1]
README = REPO / "README.md"
VF_UI = REPO / "web" / "vf-ui"
OUT_DIR = REPO / "docs" / "public" / "images" / "readme-ui"
INDEX_DOC = "vkf-scene.html"
CAPTURE_HELPER = REPO / "tests" / "helpers" / "capture_mirror_scene.js"
EDGE_PATH = Path(
    os.environ.get(
        "VF_EDGE_PATH",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    )
)


logging.basicConfig(level=logging.INFO, format="[readme-ui] %(message)s")


@dataclass(frozen=True)
class ReadmeAsset:
    marker: str
    example: Path
    output_name: str
    caption: str
    viewport: tuple[int, int] = (1600, 1000)
    wait_ms: int = 1400
    source_trim_from: str | None = None

    @property
    def output_path(self) -> Path:
        return OUT_DIR / self.output_name

    @property
    def readme_image_path(self) -> str:
        return (Path("docs") / "public" / "images" / "readme-ui" / self.output_name).as_posix()


README_ASSETS: tuple[ReadmeAsset, ...] = (
    ReadmeAsset(
        marker="ui-physics-layer-lighting",
        example=REPO / "examples" / "generated" / "readme" / "ui_physics_layer_lighting.vkf",
        output_name="ui-physics-layer-lighting.png",
        caption="`examples/generated/readme/ui_physics_layer_lighting.vkf` — 2D physics lighting layers: same-layer blockers, lit lower surfaces, and ambient-only upper surfaces.",
        viewport=(1400, 900),
        wait_ms=1200,
    ),
    ReadmeAsset(
        marker="ui-mirror-gallery",
        example=REPO / "examples" / "110_mirror_showcase.vkf",
        output_name="ui-mirror-gallery.png",
        caption="`examples/110_mirror_showcase.vkf` — hull, volume element, ellipsoid, impostor sphere, fixed-light, and DNA helix showcase.",
        wait_ms=1800,
    ),
)


def _http_server_for_directory(root: Path) -> tuple[str, socketserver.TCPServer]:
    root_s = str(root)

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args: object, **kwargs: object) -> None:
            super().__init__(*args, directory=root_s, **kwargs)

        def log_message(self, format: str, *args: object) -> None:
            logging.getLogger("readme-ui-http").debug(format, *args)

        def do_POST(self) -> None:  # noqa: N802
            if self.path.split("?", 1)[0] in {"/api/enqueue", "/api/runtime-packets"}:
                self.send_response(204)
                self.end_headers()
                return
            self.send_error(404)

    httpd: socketserver.TCPServer = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return f"http://127.0.0.1:{httpd.server_address[1]}/", httpd


def _read_asset_source(asset: ReadmeAsset) -> str:
    source = asset.example.read_text(encoding="utf-8")
    if asset.source_trim_from and asset.source_trim_from in source:
        source = source.split(asset.source_trim_from, 1)[0].rstrip() + "\n"
    return source


def _scene_and_display_from_display_vkf(asset: ReadmeAsset) -> tuple[str, str]:
    from vektorflow.interpreter import Interpreter
    from vektorflow.parser import parse_module
    from vektorflow.ui.display_runtime import build_display_payload

    source = _read_asset_source(asset)
    ip = Interpreter(asset.example)
    ip.run_module(parse_module(source, str(asset.example)))
    d = ip.globals.get("d")
    if d is None or not hasattr(d, "dumps"):
        raise RuntimeError(f"{asset.example.name} must define display as `d` (ui.display)")
    scene_json = d.dumps()
    if hasattr(d, "display_json"):
        return scene_json, d.display_json()
    payload = build_display_payload(
        screen_ops=list(getattr(d, "_screen_ops", [])),
        screen_repr_ops=dict(getattr(d, "_screen_repr_ops", {})),
        frame_ops=dict(getattr(d, "_frame_ops", {})),
        frame_repr_ops=dict(getattr(d, "_frame_repr_ops", {})),
        geom=dict(getattr(d, "_geom", {})),
    )
    return scene_json, json.dumps(payload, indent=2) + "\n"


def _native_overlay_program_from_vkf(asset: ReadmeAsset):
    from vektorflow.native_overlay_scene_frontend import try_build_native_overlay_scene_program

    source = _read_asset_source(asset)
    asset_source = asset.example.read_text(encoding="utf-8")
    if source == asset_source:
        program = try_build_native_overlay_scene_program(asset.example)
    else:
        with tempfile.TemporaryDirectory(prefix="vf-readme-native-") as tmp:
            temp_source = Path(tmp) / asset.example.name
            temp_source.write_text(source, encoding="utf-8")
            program = try_build_native_overlay_scene_program(temp_source)
    if program is None:
        raise RuntimeError(f"{asset.example.name} did not produce a native_scene program")
    return program


def _seed_native_scene_runtime(root: Path, program) -> None:
    (root / "vkf-scene.html").write_text(program.html_text, encoding="utf-8")
    (root / "vf-runtime-packets.json").write_text(program.runtime_packets_text, encoding="utf-8")
    (root / "vf-display.json").write_text('{\n  "screen": [],\n  "frames": {},\n  "geom": {}\n}\n', encoding="utf-8")
    (root / "vkf-scene.json").write_text("[]\n", encoding="utf-8")
    (root / "vf-ui-state.json").write_text("{}\n", encoding="utf-8")
    if program.geom_transport_text:
        (root / "vf-geom-ledger-transport.json").write_text(program.geom_transport_text, encoding="utf-8")
    if program.geom_state_text:
        (root / "vf-geom-ledger-state.json").write_text(program.geom_state_text, encoding="utf-8")
    if program.event_program_text:
        (root / "vf-event-program.json").write_text(program.event_program_text, encoding="utf-8")


def _seed_display_runtime(root: Path, scene_json: str, display_json: str) -> None:
    (root / "vkf-scene.json").write_text(scene_json, encoding="utf-8")
    (root / "vf-display.json").write_text(display_json, encoding="utf-8")
    (root / "vf-ui-state.json").write_text("{}\n", encoding="utf-8")


def _reserve_tcp_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        sock.listen(1)
        return int(sock.getsockname()[1])


def _frame_id_from_display_json(display_json: str) -> str:
    payload = json.loads(display_json)
    geom = payload.get("geom") or {}
    if geom:
        return str(next(iter(geom)))
    frames = payload.get("frames") or {}
    if frames:
        return str(next(iter(frames)))
    raise RuntimeError("could not infer frame id from vf-display payload")


def _frame_id_from_runtime_packets_text(runtime_packets_text: str) -> str:
    packets = json.loads(runtime_packets_text)
    for packet in packets:
        commands = (packet.get("payload") or {}).get("commands") or []
        for command in commands:
            if command.get("kind") == "frame_upsert" and command.get("id"):
                return str(command["id"])
    raise RuntimeError("could not infer frame id from vf-runtime-packets payload")


def _capture_png_via_edge(scene_html: Path, frame_id: str, out_path: Path) -> None:
    if not CAPTURE_HELPER.is_file():
        raise RuntimeError(f"capture helper missing: {CAPTURE_HELPER}")
    if not EDGE_PATH.is_file():
        raise RuntimeError(f"Edge missing: {EDGE_PATH}")
    port = _reserve_tcp_port()
    result = subprocess.run(
        [
            "node",
            str(CAPTURE_HELPER),
            str(scene_html),
            str(out_path),
            "0",
            str(port),
            frame_id,
        ],
        cwd=REPO,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "Edge capture failed")
    raw = (result.stdout or "").strip()
    if not raw:
        raise RuntimeError("Edge capture returned no diagnostics")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Edge capture returned invalid JSON: {exc}") from exc
    capture_debug = payload.get("captureDebug") or {}
    dynamic_state = payload.get("dynamicState") or {}
    renderer_state = dynamic_state.get("renderer") or {}
    provider_error = str(dynamic_state.get("providerError") or "").strip()
    runtime_error = str(renderer_state.get("runtimeError") or "").strip()
    last_wgpu_error = ""
    status = payload.get("status") or {}
    if isinstance(status, dict):
        failures = status.get("runtimeFailures") or []
        if failures:
            last_wgpu_error = str(failures[-1] or "").strip()
    capture_state = payload.get("captureState") or {}
    if isinstance(capture_state, list):
        capture_state = capture_state[0] if capture_state else {}
    logging.info(
        "capture ok marker=%s mode=%s frameTexture=%s parts=%s providerError=%s runtimeError=%s",
        frame_id,
        payload.get("captureMode") or "unknown",
        bool(capture_state.get("hasFrameTextureRef")),
        renderer_state.get("partCount"),
        provider_error or "-",
        runtime_error or last_wgpu_error or "-",
    )
    if capture_debug.get("ok") is not True:
        raise RuntimeError(f"Frame capture failed: {capture_debug!r}")
    if provider_error:
        raise RuntimeError(f"Dynamic geom provider failed: {provider_error}")
    if runtime_error:
        raise RuntimeError(f"Geom renderer runtime failed: {runtime_error}")
    if last_wgpu_error:
        raise RuntimeError(f"Geom renderer reported runtime failure: {last_wgpu_error}")


def _stage_display_capture_session(asset: ReadmeAsset, scene_json: str, display_json: str) -> tuple[Path, str]:
    from vektorflow.ui.session_staging import mirror_session_file, stage_ui_session

    session = stage_ui_session(REPO, session_id=f"readme-{asset.marker}")
    mirror_session_file(session, "vkf-scene.json", scene_json)
    mirror_session_file(session, "vf-display.json", display_json)
    mirror_session_file(session, "vf-ui-state.json", "{}\n")
    session_dir = session.built_session_dirs[0] if session.built_session_dirs else session.repo_session_dir
    return session_dir / "vkf-scene.html", _frame_id_from_display_json(display_json)


def _stage_native_capture_session(asset: ReadmeAsset, program) -> tuple[Path, str]:
    session_name = f"readme-{asset.marker}"
    session_dir = REPO / "web" / "vf-ui" / "sessions" / session_name
    session_dir.mkdir(parents=True, exist_ok=True)
    session_html = program.html_text.replace("?v=", f"?v={time.time_ns()}")
    (session_dir / "vkf-scene.html").write_text(session_html, encoding="utf-8")
    (session_dir / "vf-runtime-packets.json").write_text(program.runtime_packets_text, encoding="utf-8")
    (session_dir / "vf-display.json").write_text('{\n  "screen": [],\n  "frames": {},\n  "geom": {}\n}\n', encoding="utf-8")
    (session_dir / "vkf-scene.json").write_text("[]\n", encoding="utf-8")
    (session_dir / "vf-ui-state.json").write_text("{}\n", encoding="utf-8")
    if program.geom_transport_text:
        (session_dir / "vf-geom-ledger-transport.json").write_text(program.geom_transport_text, encoding="utf-8")
    if program.geom_state_text:
        (session_dir / "vf-geom-ledger-state.json").write_text(program.geom_state_text, encoding="utf-8")
    if program.event_program_text:
        (session_dir / "vf-event-program.json").write_text(program.event_program_text, encoding="utf-8")
    return session_dir / "vkf-scene.html", _frame_id_from_runtime_packets_text(program.runtime_packets_text)


def _capture_png_from_root(root: Path, out_path: Path, *, viewport: tuple[int, int], wait_ms: int) -> None:
    try:
        display_path = root / "vf-display.json"
        runtime_packets_path = root / "vf-runtime-packets.json"
        if runtime_packets_path.is_file():
            frame_id = _frame_id_from_runtime_packets_text(runtime_packets_path.read_text(encoding="utf-8"))
            out_path.parent.mkdir(parents=True, exist_ok=True)
            _capture_png_via_edge(root / INDEX_DOC, frame_id, out_path)
            return
        if display_path.is_file():
            frame_id = _frame_id_from_display_json(display_path.read_text(encoding="utf-8"))
            out_path.parent.mkdir(parents=True, exist_ok=True)
            _capture_png_via_edge(root / INDEX_DOC, frame_id, out_path)
            return
    except Exception:
        pass
    base, httpd = _http_server_for_directory(root)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            try:
                page = browser.new_page(viewport={"width": viewport[0], "height": viewport[1]})
                page.goto(f"{base}{INDEX_DOC}", wait_until="domcontentloaded")
                try:
                    page.wait_for_selector(".vf-geom-canvas, .vf-frame__draw-canvas", state="visible", timeout=30_000)
                except PlaywrightTimeoutError:
                    page.wait_for_timeout(wait_ms)
                else:
                    page.wait_for_timeout(wait_ms)
                out_path.parent.mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(out_path), full_page=True)
            finally:
                browser.close()
    finally:
        with contextlib.suppress(Exception):
            httpd.shutdown()
        with contextlib.suppress(Exception):
            httpd.server_close()


def render_asset(asset: ReadmeAsset) -> Path:
    out_path = asset.output_path
    out_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        logging.info("render %s via display runtime", asset.marker)
        scene_json, display_json = _scene_and_display_from_display_vkf(asset)
        scene_html, frame_id = _stage_display_capture_session(asset, scene_json, display_json)
        _capture_png_via_edge(scene_html, frame_id, out_path)
        return out_path
    except Exception as exc:
        logging.warning("display runtime failed for %s: %s", asset.marker, exc)
    try:
        logging.info("render %s via native scene runtime", asset.marker)
        program = _native_overlay_program_from_vkf(asset)
        scene_html, frame_id = _stage_native_capture_session(asset, program)
        _capture_png_via_edge(scene_html, frame_id, out_path)
        return out_path
    except Exception as exc:
        logging.warning("native scene runtime failed for %s: %s", asset.marker, exc)
    with tempfile.TemporaryDirectory(prefix="vf-readme-ui-") as tmp:
        root = Path(tmp) / "vf"
        shutil.copytree(VF_UI, root, dirs_exist_ok=True)
        try:
            logging.info("render %s via temporary display runtime", asset.marker)
            scene_json, display_json = _scene_and_display_from_display_vkf(asset)
            _seed_display_runtime(root, scene_json, display_json)
        except Exception as exc:
            logging.warning("temporary display runtime failed for %s: %s", asset.marker, exc)
            logging.info("render %s via temporary native scene runtime", asset.marker)
            program = _native_overlay_program_from_vkf(asset)
            _seed_native_scene_runtime(root, program)
        _capture_png_from_root(root, asset.output_path, viewport=asset.viewport, wait_ms=asset.wait_ms)
    return asset.output_path


def _replacement_block(asset: ReadmeAsset) -> list[str]:
    return [
        f"<!-- readme-asset: {asset.marker} -->",
        f"![{asset.marker}]({asset.readme_image_path})",
        f"*{asset.caption}*",
    ]


def _rewrite_readme_blocks(readme_text: str, assets: Iterable[ReadmeAsset]) -> str:
    lines = readme_text.splitlines()
    assets_by_marker = {asset.marker: asset for asset in assets}
    out: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if stripped.startswith("<!-- readme-asset: ") and stripped.endswith("-->"):
            marker = stripped[len("<!-- readme-asset: ") : -len(" -->")]
            asset = assets_by_marker.get(marker)
            if asset is None:
                out.append(line)
                i += 1
                continue
            out.extend(_replacement_block(asset))
            i += 1
            while i < len(lines):
                candidate = lines[i].strip()
                if candidate == "":
                    break
                if candidate.startswith("<!-- readme-asset: "):
                    break
                if candidate.startswith(">") or candidate.startswith("![") or candidate.startswith("*"):
                    i += 1
                    continue
                break
            continue
        out.append(line)
        i += 1
    return "\n".join(out) + "\n"


def update_readme(assets: Iterable[ReadmeAsset]) -> None:
    updated = _rewrite_readme_blocks(README.read_text(encoding="utf-8"), assets)
    README.write_text(updated, encoding="utf-8")


def _select_assets(markers: list[str]) -> tuple[ReadmeAsset, ...]:
    if not markers:
        return README_ASSETS
    by_marker = {asset.marker: asset for asset in README_ASSETS}
    missing = [marker for marker in markers if marker not in by_marker]
    if missing:
        known = ", ".join(sorted(by_marker))
        raise SystemExit(f"Unknown asset marker(s): {', '.join(missing)}\nKnown markers: {known}")
    return tuple(by_marker[marker] for marker in markers)


def main() -> int:
    parser = argparse.ArgumentParser(description="Render README UI assets and replace README placeholders.")
    parser.add_argument("markers", nargs="*", help="Optional readme-asset markers to render/update.")
    args = parser.parse_args()
    assets = _select_assets(list(args.markers))
    for asset in assets:
        target = render_asset(asset)
        print(target)
    update_readme(assets)
    print(README)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
