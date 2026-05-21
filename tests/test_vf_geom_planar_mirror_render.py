from __future__ import annotations

import json
import os
import socket
import subprocess
import tempfile
from pathlib import Path

import pytest

Image = pytest.importorskip("PIL.Image")


REPO = Path(__file__).resolve().parents[1]
CAPTURE_HELPER = REPO / "tests" / "helpers" / "capture_mirror_scene.js"
SCENE_HTML = REPO / "native" / "VfOverlay" / "build" / "Release" / "web" / "sessions" / "ui-random-hull-color-orbit" / "vkf-scene.html"
CALIBRATION_SCENE_HTML = REPO / "native" / "VfOverlay" / "build" / "Release" / "web" / "sessions" / "planar-mirror-calibration" / "vkf-scene.html"
EDGE_PATH = Path(os.environ.get("VF_EDGE_PATH", r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"))
MIRROR_ROI = (340, 110, 860, 300)
BRIGHT_THRESHOLD = 90
MAX_SIDE_MARGIN_PX = 80


def _reserve_tcp_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        sock.listen(1)
        return int(sock.getsockname()[1])


def _capture_scene(*, scene_html: Path, frame_id: str, zoom_steps: int) -> tuple[Path, dict]:
    if not CAPTURE_HELPER.exists():
        pytest.skip(f"capture helper missing: {CAPTURE_HELPER}")
    if not scene_html.exists():
        pytest.skip(f"scene html missing: {scene_html}")
    if not EDGE_PATH.exists():
        pytest.skip(f"Edge missing at {EDGE_PATH}")
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        screenshot = Path(tmp.name)
    port = _reserve_tcp_port()
    result = subprocess.run(
        [
            "node",
            str(CAPTURE_HELPER),
            str(scene_html),
            str(screenshot),
            str(zoom_steps),
            str(port),
            frame_id,
        ],
        check=True,
        capture_output=True,
        text=True,
        cwd=REPO,
    )
    return screenshot, json.loads(result.stdout)


def _bright_bbox(img) -> tuple[int, int, int, int] | None:
    min_x = img.width
    min_y = img.height
    max_x = -1
    max_y = -1
    for y in range(img.height):
        for x in range(img.width):
            r, g, b = img.getpixel((x, y))
            if max(r, g, b) <= BRIGHT_THRESHOLD:
                continue
            if x < min_x:
                min_x = x
            if x > max_x:
                max_x = x
            if y < min_y:
                min_y = y
            if y > max_y:
                max_y = y
    if max_x < min_x or max_y < min_y:
        return None
    return min_x, min_y, max_x, max_y


def test_zoomed_mirror_does_not_leave_large_black_side_margins() -> None:
    screenshot, payload = _capture_scene(
        scene_html=SCENE_HTML,
        frame_id="random_hull_color_orbit_frame",
        zoom_steps=8,
    )
    img = Image.open(screenshot).convert("RGB")
    crop = img.crop(MIRROR_ROI)
    bbox = _bright_bbox(crop)
    assert bbox is not None, f"mirror ROI had no bright reflected content; logs={payload.get('logs')}"
    left, top, right, bottom = bbox
    left_margin = left
    right_margin = (crop.width - 1) - right
    assert left_margin <= MAX_SIDE_MARGIN_PX, (
        f"zoomed mirror content is marooned away from left edge: "
        f"left_margin={left_margin}px bbox={bbox} roi={MIRROR_ROI} "
        f"status={payload.get('status')} logs={payload.get('logs')}"
    )
    assert right_margin <= MAX_SIDE_MARGIN_PX, (
        f"zoomed mirror content is marooned away from right edge: "
        f"right_margin={right_margin}px bbox={bbox} roi={MIRROR_ROI} "
        f"status={payload.get('status')} logs={payload.get('logs')}"
    )


def test_calibration_mirror_texture_contains_floor_across_full_bottom_edge() -> None:
    _screenshot, payload = _capture_scene(
        scene_html=CALIBRATION_SCENE_HTML,
        frame_id="planar_mirror_calibration_frame",
        zoom_steps=0,
    )
    surface_debug = payload.get("surfaceDebug") or {}
    samples = surface_debug.get("threshold32") or []
    mirror = next((entry for entry in samples if entry.get("surfaceKind") == "mirror"), None)
    assert mirror is not None, f"missing mirror surface debug in payload={payload}"
    bbox = mirror.get("bbox")
    assert bbox is not None, f"expected floor to appear in mirror texture; payload={payload}"
    min_x, min_y, max_x, max_y = bbox
    width = int(mirror["width"])
    height = int(mirror["height"])
    assert min_x <= 2, f"expected reflected floor to reach left mirror edge; bbox={bbox} payload={payload}"
    assert max_x >= (width - 3), f"expected reflected floor to reach right mirror edge; bbox={bbox} payload={payload}"
    assert max_y >= (height - 3), f"expected reflected floor to reach mirror seam edge; bbox={bbox} payload={payload}"


def test_calibration_reflected_frame_is_declared_square() -> None:
    packets_path = (
        REPO
        / "native"
        / "VfOverlay"
        / "build"
        / "Release"
        / "web"
        / "sessions"
        / "planar-mirror-calibration"
        / "vf-runtime-packets.json"
    )
    payload = json.loads(packets_path.read_text(encoding="utf-8"))
    commands = payload[0]["payload"]["commands"]
    frame = next(cmd for cmd in commands if cmd["id"] == "planar_mirror_reflected_frame")
    spec = frame["payload"]["spec"]
    assert spec.get("aspect") == "equal", f"expected reflected frame to declare square aspect, got spec={spec}"
