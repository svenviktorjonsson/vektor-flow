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
        caption="`examples/generated/readme/ui_physics_layer_lighting.vkf` — 2D textured floor lighting with a single VKF-defined mirror reflection.",
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
    if len(rect_ops) < 12 or len(oval_ops) < 1:
        raise RuntimeError("physics lighting proof must declare room, wall, and light draw ops")

    bg_op = rect_ops[0]
    draw.rectangle(to_px(bg_op["rect"]), fill=tuple(int(value) for value in _hex_to_rgb(str(bg_op["color"]))))
    room_rects = [to_px(op["rect"]) for op in rect_ops if str(op.get("color")).lower() == "#263342"]
    wall_rects = [to_px(op["rect"]) for op in rect_ops if str(op.get("color")).lower() == "#d8dce4"]
    if len(room_rects) < 3 or len(wall_rects) < 8:
        raise RuntimeError("physics lighting proof must declare three rooms and their wall segments")
    room_rects.sort(key=lambda rect: rect[0])
    wall_material = _hex_to_rgb("#d8dce4")

    background_physics = physics["adjacent_square_backgrounds"]
    boundary_physics = physics["boundary_parts_with_middle_gap"]
    light_field_physics = physics["lighting_layer_passes_through_gap"]

    def parse_room_list(raw: object) -> list[tuple[float, float, float, float]]:
        rooms = [_parse_csv_floats(room, expected=4) for room in str(raw).split(";") if room.strip()]
        if len(rooms) < 3:
            raise RuntimeError(f"expected at least three rooms in physics metadata, got {raw!r}")
        return rooms

    world_rooms = parse_room_list(background_physics["rooms"])
    world_min_x = min(room[0] for room in world_rooms)
    world_max_x = max(room[2] for room in world_rooms)
    world_min_y = min(room[1] for room in world_rooms)
    world_max_y = max(room[3] for room in world_rooms)
    rooms_px_min_x = min(rect[0] for rect in room_rects)
    rooms_px_max_x = max(rect[2] for rect in room_rects)
    rooms_px_min_y = min(rect[1] for rect in room_rects)
    rooms_px_max_y = max(rect[3] for rect in room_rects)
    square = room_rects[0][2] - room_rects[0][0]

    def world_to_px(point: tuple[float, float]) -> tuple[float, float]:
        px = rooms_px_min_x + ((point[0] - world_min_x) / (world_max_x - world_min_x)) * (
            rooms_px_max_x - rooms_px_min_x
        )
        py = rooms_px_min_y + ((point[1] - world_min_y) / (world_max_y - world_min_y)) * (
            rooms_px_max_y - rooms_px_min_y
        )
        return (px, py)

    light_sources: list[dict[str, object]] = []
    for mesh_id, mesh_physics in physics.items():
        if mesh_physics.get("kind") != "light2d":
            continue
        center_world = _parse_csv_floats(mesh_physics["center"], expected=2)
        light_sources.append(
            {
                "id": mesh_id,
                "center": world_to_px((center_world[0], center_world[1])),
                "radius": square * float(mesh_physics["radius_ratio_to_square_width"]),
                "falloff": square * float(mesh_physics.get("falloff_radius_ratio", light_field_physics["falloff_radius_ratio"])),
                "color": _hex_to_rgb(str(mesh_physics.get("color", "#fff8a8"))),
            }
        )
    if len(light_sources) < 1:
        raise RuntimeError("physics lighting proof must declare a light2d source")
    light_sources.sort(key=lambda item: str(item["id"]))

    optical_boundaries: list[dict[str, object]] = []
    for mesh_id, mesh_physics in physics.items():
        if mesh_physics.get("kind") != "optical_boundary2d":
            continue
        x0, y0, x1, y1 = _parse_csv_floats(mesh_physics["segment"], expected=4)
        optical_boundaries.append(
            {
                "id": mesh_id,
                "kind": str(mesh_physics["optical_kind"]),
                "segment": (world_to_px((x0, y0)), world_to_px((x1, y1))),
                "color": _hex_to_rgb(str(mesh_physics.get("color", "#ffffff"))),
                "reflectivity": float(mesh_physics.get("reflectivity", 0.0)),
                "transmittance": float(mesh_physics.get("transmittance", 0.0)),
                "roughness": float(mesh_physics.get("roughness", 0.08)),
                "spread_ratio": float(mesh_physics.get("spread_ratio", 0.10)),
                "reflect_of_light_id": str(mesh_physics.get("reflect_of_light_id", "")),
                "virtual_light_kind": str(mesh_physics.get("virtual_light_kind", "")),
                "aperture_face_id": str(mesh_physics.get("aperture_face_id", mesh_id)),
                "starts_after_aperture": bool(mesh_physics.get("starts_after_aperture", False)),
                "tint_strength": float(mesh_physics.get("tint_strength", 1.0)),
            }
        )
    if len(optical_boundaries) < 1:
        raise RuntimeError("physics lighting proof must declare an optical boundary")

    shared_xs = [
        room_rects[index][2]
        for index in range(len(room_rects) - 1)
        if abs(room_rects[index][2] - room_rects[index + 1][0]) <= max(5.0, square * 0.05)
    ]
    shared_wall_segments = [
        ((float(rect[0] + rect[2]) / 2.0, float(rect[1])), (float(rect[0] + rect[2]) / 2.0, float(rect[3])))
        for rect in wall_rects
        if any(
            abs(((rect[0] + rect[2]) / 2.0) - shared_x)
            <= max(2.0, square * float(boundary_physics["wall_thickness_ratio"]))
            for shared_x in shared_xs
        )
    ]
    if len(shared_wall_segments) != 4:
        raise RuntimeError(f"expected four shared wall segments from VKF, got {len(shared_wall_segments)}")

    def inside_rooms(x: int, y: int) -> bool:
        return any(room[0] <= x < room[2] and room[1] <= y < room[3] for room in room_rects)

    def smoothstep(edge0: float, edge1: float, value: float) -> float:
        if edge0 == edge1:
            return 1.0 if value >= edge1 else 0.0
        t = max(0.0, min(1.0, (value - edge0) / (edge1 - edge0)))
        return t * t * (3.0 - 2.0 * t)

    def ray_intersection_with_vertical_segment(
        origin: tuple[float, float],
        target: tuple[float, float],
        segment: tuple[tuple[float, float], tuple[float, float]],
    ) -> tuple[float, float] | None:
        wall_x = segment[0][0]
        dx = target[0] - origin[0]
        if abs(dx) < 0.00001:
            return None
        t = (wall_x - origin[0]) / dx
        if t <= 0.0 or t >= 1.0:
            return None
        hit_y = origin[1] + (target[1] - origin[1]) * t
        seg_min_y = min(segment[0][1], segment[1][1])
        seg_max_y = max(segment[0][1], segment[1][1])
        if seg_min_y <= hit_y <= seg_max_y:
            return (wall_x, hit_y)
        return None

    def wall_visibility_from(origin: tuple[float, float], target: tuple[float, float]) -> float:
        penumbra_base = square * float(light_field_physics["penumbra_base_ratio"])
        penumbra_growth = float(light_field_physics["penumbra_growth_ratio"])
        visible = 1.0
        for segment in shared_wall_segments:
            hit = ray_intersection_with_vertical_segment(origin, target, segment)
            if hit is None:
                continue
            distance_from_wall = math.hypot(target[0] - hit[0], target[1] - hit[1])
            penumbra = penumbra_base + penumbra_growth * distance_from_wall
            edge_dist = min(math.hypot(hit[0] - end[0], hit[1] - end[1]) for end in segment)
            visible = min(visible, 1.0 - smoothstep(0.0, penumbra, edge_dist))
        return visible

    def visibility_for_light(light: dict[str, object], x: float, y: float) -> float:
        origin = light["center"]
        assert isinstance(origin, tuple)
        return wall_visibility_from(origin, (float(x), float(y)))

    def segment_midpoint(segment: tuple[tuple[float, float], tuple[float, float]]) -> tuple[float, float]:
        return ((segment[0][0] + segment[1][0]) / 2.0, (segment[0][1] + segment[1][1]) / 2.0)

    def point_to_segment_distance(
        point: tuple[float, float], segment: tuple[tuple[float, float], tuple[float, float]]
    ) -> float:
        ax, ay = segment[0]
        bx, by = segment[1]
        px, py = point
        dx = bx - ax
        dy = by - ay
        length2 = dx * dx + dy * dy
        if length2 <= 0.00001:
            return math.hypot(px - ax, py - ay)
        t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length2))
        closest = (ax + t * dx, ay + t * dy)
        return math.hypot(px - closest[0], py - closest[1])

    def signed_side(point: tuple[float, float], segment: tuple[tuple[float, float], tuple[float, float]]) -> float:
        ax, ay = segment[0]
        bx, by = segment[1]
        return (bx - ax) * (point[1] - ay) - (by - ay) * (point[0] - ax)

    def reflect_point_across_segment_line(
        point: tuple[float, float], segment: tuple[tuple[float, float], tuple[float, float]]
    ) -> tuple[float, float]:
        ax, ay = segment[0]
        bx, by = segment[1]
        px, py = point
        dx = bx - ax
        dy = by - ay
        length2 = dx * dx + dy * dy
        if length2 <= 0.00001:
            return point
        t = ((px - ax) * dx + (py - ay) * dy) / length2
        foot = (ax + t * dx, ay + t * dy)
        return (2.0 * foot[0] - px, 2.0 * foot[1] - py)

    def line_distance(point: tuple[float, float], a: tuple[float, float], b: tuple[float, float]) -> float:
        dx = b[0] - a[0]
        dy = b[1] - a[1]
        denom = math.hypot(dx, dy)
        if denom <= 0.00001:
            return math.hypot(point[0] - a[0], point[1] - a[1])
        return abs(dy * point[0] - dx * point[1] + b[0] * a[1] - b[1] * a[0]) / denom

    def aperture_hit_from_virtual_source(
        virtual_source: tuple[float, float],
        target: tuple[float, float],
        segment: tuple[tuple[float, float], tuple[float, float]],
    ) -> tuple[float, float, float] | None:
        sx, sy = segment[0]
        ex, ey = segment[1]
        vx = ex - sx
        vy = ey - sy
        tx = target[0] - virtual_source[0]
        ty = target[1] - virtual_source[1]
        denom = tx * vy - ty * vx
        if abs(denom) < 0.00001:
            return None
        wx = sx - virtual_source[0]
        wy = sy - virtual_source[1]
        ray_t = (wx * vy - wy * vx) / denom
        aperture_u = (wx * ty - wy * tx) / denom
        if ray_t <= 0.0 or ray_t >= 1.0:
            return None
        hit = (sx + aperture_u * vx, sy + aperture_u * vy)
        return (hit[0], hit[1], aperture_u)

    def floor_texture(x: int, y: int) -> tuple[float, float, float]:
        room_left = next(room for room in room_rects if room[0] <= x < room[2] and room[1] <= y < room[3])
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

    def light_strength_for_source(light: dict[str, object], x: float, y: float, *, wall: bool = False) -> float:
        center = light["center"]
        assert isinstance(center, tuple)
        falloff = float(light["falloff"])
        dist = math.hypot(x - center[0], y - center[1])
        visible = visibility_for_light(light, x, y)
        if wall:
            visible = max(visible, 0.22)
        return visible / (1.0 + (dist / falloff) ** 2)

    def tinted_color(
        light: dict[str, object], tint: tuple[float, float, float], tint_strength: float
    ) -> tuple[float, float, float]:
        source = light["color"]
        assert isinstance(source, tuple)
        mix = max(0.0, min(1.0, tint_strength))
        return (
            source[0] * (1.0 - mix) + source[0] * (tint[0] / 255.0) * mix,
            source[1] * (1.0 - mix) + source[1] * (tint[1] / 255.0) * mix,
            source[2] * (1.0 - mix) + source[2] * (tint[2] / 255.0) * mix,
        )

    def optical_strengths_at(x: float, y: float) -> list[tuple[dict[str, object], float]]:
        target = (x, y)
        strengths: list[tuple[dict[str, object], float]] = []
        for boundary in optical_boundaries:
            segment = boundary["segment"]
            color = boundary["color"]
            assert isinstance(segment, tuple)
            assert isinstance(color, tuple)
            midpoint = segment_midpoint(segment)
            distance_to_boundary = point_to_segment_distance(target, segment)
            for light in light_sources:
                if boundary["reflect_of_light_id"] and str(light["id"]) != boundary["reflect_of_light_id"]:
                    continue
                center = light["center"]
                assert isinstance(center, tuple)
                incoming = light_strength_for_source(light, midpoint[0], midpoint[1], wall=True)
                side_product = signed_side(target, segment) * signed_side(center, segment)
                opposite_side = side_product < 0.0
                if float(boundary["reflectivity"]) > 0.0:
                    virtual_source = reflect_point_across_segment_line(center, segment)
                    target_after_aperture = signed_side(target, segment) * signed_side(virtual_source, segment) < 0.0
                    if target_after_aperture:
                        aperture_hit = aperture_hit_from_virtual_source(virtual_source, target, segment)
                    else:
                        aperture_hit = None
                    if aperture_hit is not None:
                        aperture_point = (aperture_hit[0], aperture_hit[1])
                        aperture_u = aperture_hit[2]
                        outside_u = max(0.0, -aperture_u, aperture_u - 1.0)
                        spread_width = max(0.0001, float(boundary["spread_ratio"]))
                        aperture_gate = 1.0 - smoothstep(0.0, spread_width, outside_u)
                        wall_gate = wall_visibility_from(aperture_point, target)
                        reflected_distance = math.hypot(x - virtual_source[0], y - virtual_source[1])
                        reflected_falloff = float(light["falloff"])
                        reflected_strength = 1.0 / (1.0 + (reflected_distance / reflected_falloff) ** 2)
                        strengths.append(
                            (
                                {"color": tinted_color(light, color, 0.25)},
                                incoming
                                * float(boundary["reflectivity"])
                                * aperture_gate
                                * wall_gate
                                * reflected_strength
                                * 1.35,
                            )
                        )
                if float(boundary["transmittance"]) > 0.0:
                    side_factor = 1.0 if opposite_side else 0.32
                    band = math.exp(-((distance_to_boundary / (square * 0.16)) ** 2))
                    reach = 1.0 / (1.0 + (math.hypot(x - midpoint[0], y - midpoint[1]) / (square * 0.50)) ** 2)
                    strengths.append(
                        (
                            {"color": tinted_color(light, color, float(boundary["tint_strength"]))},
                            incoming * float(boundary["transmittance"]) * side_factor * band * reach,
                        )
                    )
        return strengths

    def shade_material(
        material: tuple[float, float, float],
        strengths: list[tuple[dict[str, object], float]],
        *,
        diffuse: float,
        glow: float,
    ) -> tuple[int, int, int]:
        total_strength = min(1.35, sum(strength for _, strength in strengths))
        lit = ambient + diffuse * total_strength
        r = material[0] * lit
        g = material[1] * lit
        b = material[2] * lit
        for light, strength in strengths:
            color = light["color"]
            assert isinstance(color, tuple)
            r += color[0] * strength * glow
            g += color[1] * strength * glow * 0.93
            b += color[2] * strength * glow * 0.66
        return (min(255, int(r)), min(255, int(g)), min(255, int(b)))

    for y in range(body[1], body[3]):
        for x in range(body[0], body[2]):
            if not inside_rooms(x, y):
                continue
            strengths = [(light, light_strength_for_source(light, x, y)) for light in light_sources]
            strengths.extend(optical_strengths_at(x, y))
            image.putpixel((x, y), shade_material(floor_texture(x, y), strengths, diffuse=0.42, glow=0.58))

    def wall_texture(x: int, y: int) -> tuple[float, float, float]:
        return wall_material

    for rect in wall_rects:
        for y in range(rect[1], rect[3]):
            for x in range(rect[0], rect[2]):
                strengths = [(light, light_strength_for_source(light, x, y, wall=True)) for light in light_sources]
                strengths.extend(optical_strengths_at(x, y))
                image.putpixel(
                    (x, y),
                    shade_material(wall_texture(x, y), strengths, diffuse=1.05, glow=0.26),
                )

    for boundary in optical_boundaries:
        segment = boundary["segment"]
        color = boundary["color"]
        assert isinstance(segment, tuple)
        assert isinstance(color, tuple)
        draw.line(
            (int(segment[0][0]), int(segment[0][1]), int(segment[1][0]), int(segment[1][1])),
            fill=tuple(int(channel) for channel in color),
            width=max(3, int(square * 0.018)),
        )

    for light in light_sources:
        center = light["center"]
        color = light["color"]
        assert isinstance(center, tuple)
        assert isinstance(color, tuple)
        source_radius = float(light["radius"])
        sx0 = int(center[0] - source_radius)
        sy0 = int(center[1] - source_radius)
        sx1 = int(center[0] + source_radius)
        sy1 = int(center[1] + source_radius)
        draw.ellipse((sx0, sy0, sx1, sy1), fill=tuple(int(channel) for channel in color))

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
        "left room textured floor lit by computed light": ((400, 380), (112, 107, 67), 10),
        "circular light source": ((520, 430), (255, 248, 168), 10),
        "silver mirror optical boundary": ((610, 365), (244, 248, 255), 10),
        "projected virtual mirror light after aperture": ((650, 405), (170, 164, 104), 10),
        "opposite side of mirror remains darker": ((650, 345), (96, 93, 59), 10),
        "projected mirror aperture starts lit beam": ((550, 380), (221, 213, 133), 10),
        "shader-lit left shared wall": ((486, 330), (255, 255, 255), 10),
        "left shared middle-third lit gap": ((486, 430), (156, 147, 84), 10),
        "right shared middle-third lit gap": ((713, 430), (112, 106, 62), 10),
        "right room projected cone through gap": ((770, 430), (90, 87, 56), 10),
        "right room shadow above cone": ((760, 345), (4, 5, 6), 10),
        "right room lower wall blocks reflected light": ((760, 525), (4, 5, 7), 10),
        "reflected light does not pass through wall": ((735, 500), (7, 9, 12), 10),
        "shader-lit right outer square wall": ((937, 430), (90, 91, 89), 10),
        "floor texture seam": ((355, 430), (88, 84, 50), 10),
        "floor texture tile body": ((390, 430), (115, 112, 73), 10),
        "yellow cone soft edge": ((450, 382), (130, 122, 69), 10),
        "reflected cone soft edge": ((700, 450), (126, 122, 79), 10),
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
