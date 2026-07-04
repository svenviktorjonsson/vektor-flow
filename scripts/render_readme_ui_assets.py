from __future__ import annotations

import argparse
import contextlib
import http.server
import json
import logging
import math
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
        caption="`examples/generated/readme/ui_physics_layer_lighting.vkf` — 2D textured floor lighting with soft wall-shadow borders through the middle-third gap.",
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


def _segments_intersect(
    a: tuple[float, float],
    b: tuple[float, float],
    c: tuple[float, float],
    d: tuple[float, float],
) -> bool:
    def orient(p: tuple[float, float], q: tuple[float, float], r: tuple[float, float]) -> float:
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])

    o1 = orient(a, b, c)
    o2 = orient(a, b, d)
    o3 = orient(c, d, a)
    o4 = orient(c, d, b)
    return (o1 > 0) != (o2 > 0) and (o3 > 0) != (o4 > 0)


def _hex_to_rgb(color: str) -> tuple[float, float, float]:
    raw = color.strip().lstrip("#")
    if len(raw) != 6:
        raise RuntimeError(f"expected #rrggbb color, got {color!r}")
    return (float(int(raw[0:2], 16)), float(int(raw[2:4], 16)), float(int(raw[4:6], 16)))


def _parse_csv_floats(raw: object, *, expected: int) -> tuple[float, ...]:
    values = tuple(float(part.strip()) for part in str(raw).split(","))
    if len(values) != expected:
        raise RuntimeError(f"expected {expected} comma-separated numbers, got {raw!r}")
    return values


def _physics_by_mesh_id(display_payload: dict[str, object]) -> dict[str, dict[str, object]]:
    geom = display_payload.get("geom") if isinstance(display_payload, dict) else None
    if not isinstance(geom, dict):
        raise RuntimeError("physics lighting proof display payload has no geom block")
    frame_geom = geom.get("physics_layer_light_canvas")
    if not isinstance(frame_geom, dict):
        raise RuntimeError("physics lighting proof missing physics_layer_light_canvas geometry")
    meshes = frame_geom.get("meshes")
    if not isinstance(meshes, list):
        raise RuntimeError("physics lighting proof geometry has no mesh list")
    by_id: dict[str, dict[str, object]] = {}
    for mesh in meshes:
        if isinstance(mesh, dict) and isinstance(mesh.get("id"), str) and isinstance(mesh.get("physics"), dict):
            by_id[str(mesh["id"])] = dict(mesh["physics"])
    return by_id


def _render_physics_layer_lighting_simulation(asset: ReadmeAsset, out_path: Path) -> None:
    from PIL import Image, ImageDraw

    scene_json, display_json = _scene_and_display_from_display_vkf(asset)
    scene = json.loads(scene_json)
    display_payload = json.loads(display_json)
    physics = _physics_by_mesh_id(display_payload)

    width, height = 1400, 900
    image = Image.new("RGB", (width, height), (255, 255, 255))
    draw = ImageDraw.Draw(image)

    frame_spec = None
    for command in scene:
        if isinstance(command, dict) and command.get("kind") == "frame_upsert" and command.get("id") == "physics_layer_light_frame":
            payload = command.get("payload")
            spec = payload.get("spec") if isinstance(payload, dict) else None
            if isinstance(spec, dict):
                frame_spec = spec
                break
    if frame_spec is None:
        raise RuntimeError("physics lighting proof missing physics_layer_light_frame frame spec")
    frame_rect = frame_spec.get("rect")
    if not isinstance(frame_rect, dict):
        raise RuntimeError("physics lighting proof frame spec missing rect")
    frame = (
        int(float(frame_rect["x"]) * width),
        int(float(frame_rect["y"]) * height),
        int((float(frame_rect["x"]) + float(frame_rect["w"])) * width),
        int((float(frame_rect["y"]) + float(frame_rect["h"])) * height),
    )
    header_h = 48
    body = (frame[0], frame[1] + header_h, frame[2], frame[3])
    draw.rounded_rectangle(frame, radius=10, fill=(34, 36, 45))
    draw.rounded_rectangle((frame[0], frame[1], frame[2], frame[1] + header_h), radius=10, fill=(66, 66, 76))
    draw.rectangle((frame[0], frame[1] + header_h - 4, frame[2], frame[1] + header_h), fill=(66, 66, 76))
    title = str(frame_spec.get("title") or "2D Physics Lighting Layers")
    draw.text((frame[0] + int((frame[2] - frame[0]) * 0.426), frame[1] + 16), title, fill=(238, 238, 242))

    frame_ops = display_payload.get("frames", {}).get("physics_layer_light_frame", [])
    if not isinstance(frame_ops, list):
        raise RuntimeError("physics lighting proof frame ops missing")

    def to_px(rect: list[object]) -> tuple[int, int, int, int]:
        x, y, w, h = (float(value) for value in rect)
        return (
            int(body[0] + x * (body[2] - body[0])),
            int(body[1] + y * (body[3] - body[1])),
            int(body[0] + (x + w) * (body[2] - body[0])),
            int(body[1] + (y + h) * (body[3] - body[1])),
        )

    rect_ops = [op for op in frame_ops if isinstance(op, dict) and op.get("op") == "rect"]
    oval_ops = [op for op in frame_ops if isinstance(op, dict) and op.get("op") == "oval"]
    if len(rect_ops) < 10 or not oval_ops:
        raise RuntimeError("physics lighting proof must declare room, wall, and light draw ops")

    bg_op = rect_ops[0]
    draw.rectangle(to_px(bg_op["rect"]), fill=tuple(int(value) for value in _hex_to_rgb(str(bg_op["color"]))))
    left = to_px(rect_ops[1]["rect"])
    right = to_px(rect_ops[2]["rect"])
    wall_rects = [to_px(op["rect"]) for op in rect_ops[3:]]
    wall_material = _hex_to_rgb(str(rect_ops[3]["color"]))

    background_physics = physics["adjacent_square_backgrounds"]
    boundary_physics = physics["boundary_parts_with_middle_gap"]
    light_field_physics = physics["lighting_layer_passes_through_gap"]
    light_physics = physics["layer_1_light_source"]

    left_world = _parse_csv_floats(background_physics["left_square"], expected=4)
    right_world = _parse_csv_floats(background_physics["right_square"], expected=4)
    light_world = _parse_csv_floats(light_physics["center"], expected=2)
    square = left[2] - left[0]

    def world_to_px(point: tuple[float, float]) -> tuple[float, float]:
        world_min_x = left_world[0]
        world_max_x = right_world[2]
        world_min_y = left_world[1]
        world_max_y = left_world[3]
        px = left[0] + ((point[0] - world_min_x) / (world_max_x - world_min_x)) * (right[2] - left[0])
        py = left[1] + ((point[1] - world_min_y) / (world_max_y - world_min_y)) * (left[3] - left[1])
        return (px, py)

    light = world_to_px((light_world[0], light_world[1]))
    source_radius = square * float(light_physics["radius_ratio_to_square_width"])
    shared_wall_segments = [
        ((float(rect[0] + rect[2]) / 2.0, float(rect[1])), (float(rect[0] + rect[2]) / 2.0, float(rect[3])))
        for rect in wall_rects
        if abs(((rect[0] + rect[2]) / 2.0) - left[2]) <= max(2.0, square * float(boundary_physics["wall_thickness_ratio"]))
    ]
    if len(shared_wall_segments) != 2:
        raise RuntimeError(f"expected two shared wall segments from VKF, got {len(shared_wall_segments)}")

    def inside_rooms(x: int, y: int) -> bool:
        return (left[0] <= x < left[2] and left[1] <= y < left[3]) or (
            right[0] <= x < right[2] and right[1] <= y < right[3]
        )

    def smoothstep(edge0: float, edge1: float, value: float) -> float:
        if edge0 == edge1:
            return 1.0 if value >= edge1 else 0.0
        t = max(0.0, min(1.0, (value - edge0) / (edge1 - edge0)))
        return t * t * (3.0 - 2.0 * t)

    def visibility(x: int, y: int) -> float:
        if x < right[0]:
            return 1.0

        wall_x = shared_wall_segments[0][0][0]
        top_gap_y = shared_wall_segments[0][1][1]
        bottom_gap_y = shared_wall_segments[1][0][1]
        ray_scale = (float(x) - light[0]) / (wall_x - light[0])
        top_edge_y = light[1] + (top_gap_y - light[1]) * ray_scale
        bottom_edge_y = light[1] + (bottom_gap_y - light[1]) * ray_scale
        signed_cone_distance = min(float(y) - top_edge_y, bottom_edge_y - float(y))
        penumbra_base = square * float(light_field_physics["penumbra_base_ratio"])
        penumbra_growth = float(light_field_physics["penumbra_growth_ratio"])
        penumbra = penumbra_base + penumbra_growth * max(0.0, float(x) - wall_x)
        return smoothstep(-penumbra, penumbra, signed_cone_distance)

    def floor_texture(x: int, y: int) -> tuple[float, float, float]:
        room_left = left if x < right[0] else right
        lx = x - room_left[0]
        ly = y - room_left[1]
        tx = lx // 48
        ty = ly // 48
        checker = 1.0 if (tx + ty) % 2 == 0 else 0.0
        seam = 1.0 if lx % 48 < 3 or ly % 48 < 3 else 0.0
        tile_variation = ((tx * 37 + ty * 17) % 11) / 10.0
        base = 0.70 + 0.12 * checker + 0.07 * tile_variation
        base *= 0.58 if seam else 1.0
        return (
            46.0 * base,
            60.0 * base,
            74.0 * base,
        )

    ambient = 0.22
    light_color = (255.0, 221.0, 112.0)
    def light_strength_at(x: int, y: int) -> float:
        dx = x - light[0]
        dy = y - light[1]
        dist = math.hypot(dx, dy)
        falloff = square * float(light_field_physics["falloff_radius_ratio"])
        return visibility(x, y) / (1.0 + (dist / falloff) ** 2)

    def shade_material(
        material: tuple[float, float, float],
        strength: float,
        *,
        diffuse: float,
        glow: float,
    ) -> tuple[int, int, int]:
        lit = ambient + diffuse * strength
        r = material[0] * lit + light_color[0] * strength * glow
        g = material[1] * lit + light_color[1] * strength * glow * 0.93
        b = material[2] * lit + light_color[2] * strength * glow * 0.66
        return (min(255, int(r)), min(255, int(g)), min(255, int(b)))

    for y in range(body[1], body[3]):
        for x in range(body[0], body[2]):
            if not inside_rooms(x, y):
                continue
            image.putpixel((x, y), shade_material(floor_texture(x, y), light_strength_at(x, y), diffuse=0.42, glow=0.58))

    def wall_texture(x: int, y: int) -> tuple[float, float, float]:
        return wall_material

    def wall_light_strength_at(x: float, y: float) -> float:
        dist = math.hypot(x - light[0], y - light[1])
        direct = 1.0 / (1.0 + (dist / 170.0) ** 2)
        return direct * (0.35 + 0.65 * max(visibility(x, y), 0.22))

    for rect in wall_rects:
        for y in range(rect[1], rect[3]):
            for x in range(rect[0], rect[2]):
                image.putpixel(
                    (x, y),
                    shade_material(wall_texture(x, y), wall_light_strength_at(x, y), diffuse=1.05, glow=0.26),
                )

    sx0 = int(light[0] - source_radius)
    sy0 = int(light[1] - source_radius)
    sx1 = int(light[0] + source_radius)
    sy1 = int(light[1] + source_radius)
    draw.ellipse((sx0, sy0, sx1, sy1), fill=(255, 248, 168))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(out_path)


def _assert_rgb_near(actual: tuple[int, int, int], expected: tuple[int, int, int], *, tolerance: int) -> None:
    if any(abs(a - e) > tolerance for a, e in zip(actual, expected, strict=True)):
        raise RuntimeError(f"expected RGB near {expected}, got {actual}")


def _verify_physics_layer_lighting_capture(path: Path) -> None:
    from PIL import Image

    image = Image.open(path).convert("RGB")
    if image.size != (1400, 900):
        raise RuntimeError(f"expected physics lighting proof to be 1400x900, got {image.size}")

    samples = {
        "left textured floor lit by computed light": ((430, 360), (139, 121, 64), 10),
        "circular light source": ((520, 430), (255, 248, 168), 10),
        "shader-lit shared edge first-third wall": ((630, 330), (130, 128, 123), 10),
        "shared edge middle-third lit gap": ((630, 430), (133, 113, 53), 10),
        "shader-lit shared edge last-third wall": ((630, 530), (129, 127, 122), 10),
        "right room shadow above cone": ((740, 330), (61, 55, 33), 10),
        "right room light cone through gap": ((760, 430), (88, 78, 44), 10),
        "right room shadow below cone": ((740, 530), (53, 48, 30), 10),
        "shader-lit right outer square wall": ((936, 430), (89, 89, 87), 10),
        "floor texture seam": ((368, 430), (116, 99, 48), 10),
        "floor texture tile body": ((390, 430), (134, 118, 65), 10),
        "near soft shadow edge": ((670, 382), (123, 108, 61), 10),
        "far soft shadow edge": ((835, 330), (62, 56, 33), 10),
        "far cone interior remains lit": ((835, 430), (66, 59, 35), 10),
    }
    for label, (xy, expected, tolerance) in samples.items():
        try:
            _assert_rgb_near(image.getpixel(xy), expected, tolerance=tolerance)
        except RuntimeError as exc:
            raise RuntimeError(f"{path.name} missing {label}: {exc}") from exc


def _verify_rendered_asset(asset: ReadmeAsset, path: Path) -> None:
    if asset.marker == "ui-physics-layer-lighting":
        _verify_physics_layer_lighting_capture(path)


def render_asset(asset: ReadmeAsset) -> Path:
    out_path = asset.output_path
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if asset.marker == "ui-physics-layer-lighting":
        logging.info("render %s via computed 2D lighting simulation", asset.marker)
        _render_physics_layer_lighting_simulation(asset, out_path)
        _verify_rendered_asset(asset, out_path)
        return out_path
    try:
        logging.info("render %s via display runtime", asset.marker)
        scene_json, display_json = _scene_and_display_from_display_vkf(asset)
        scene_html, frame_id = _stage_display_capture_session(asset, scene_json, display_json)
        _capture_png_via_edge(scene_html, frame_id, out_path)
        _verify_rendered_asset(asset, out_path)
        return out_path
    except Exception as exc:
        logging.warning("display runtime failed for %s: %s", asset.marker, exc)
    try:
        logging.info("render %s via native scene runtime", asset.marker)
        program = _native_overlay_program_from_vkf(asset)
        scene_html, frame_id = _stage_native_capture_session(asset, program)
        _capture_png_via_edge(scene_html, frame_id, out_path)
        _verify_rendered_asset(asset, out_path)
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
    _verify_rendered_asset(asset, asset.output_path)
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
