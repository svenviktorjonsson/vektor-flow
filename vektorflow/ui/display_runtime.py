"""UI runtime display payload helpers.

This module owns the packet-first display payload assembly seam for the UI
runtime. ``vektorflow.stdlib.ui.Display`` should orchestrate when a sync
happens, but the display payload shape and display-runtime bundle sync live
here.
"""

from __future__ import annotations

from pathlib import Path
import re
import shutil
import time
from typing import Any, Mapping

from vektorflow.ui.launch import _vf_warn, find_vektorflow_repo_root
from vektorflow.ui.payloads import write_display_payload


_DISPLAY_RUNTIME_ASSETS = (
    "vf-display.js",
    "vkf-scene.html",
    "vf-runtime-shell.js",
    "vf-runtime-source.js",
    "vf-runtime-scene.js",
    "vf-runtime-flow.js",
    "vf-runtime-packets.json",
    "vf-frame.js",
    "vf-frame.css",
    "vf-widgets.js",
)
_GEOM_RUNTIME_ASSETS = (
    "vf-geom-core.js",
    "vf-geom-ledger-layout.js",
    "vf-geom-ledger-transport.js",
    "vf-geom-frame-adapter.js",
    "vf-geom-ledger.js",
    "vf-geom-wgpu.js",
    "vf-geom-math.js",
    "vf-geom-mount.js",
)
_VERSION_QUERY_RE = re.compile(r"\?v=\d+")
_display_assets_synced_once = False


def filter_placed_geom(geom: Mapping[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Return only placed geometry entries, excluding pending-frame buckets."""
    return {
        fid: data
        for fid, data in geom.items()
        if not str(fid).startswith("__pending_")
    }


def build_frame_payload(
    frame_ops: Mapping[str, list[dict[str, Any]]],
    frame_repr_ops: Mapping[str, Mapping[str, list[dict[str, Any]]]],
) -> dict[str, list[dict[str, Any]]]:
    """Assemble frame draw ops from direct frame ops plus representation ops."""
    frame_ids = {
        fid
        for fid in (set(frame_ops) | set(frame_repr_ops))
        if not str(fid).startswith("__pending_")
    }
    payload: dict[str, list[dict[str, Any]]] = {}
    for fid in frame_ids:
        ops = list(frame_ops.get(fid, []))
        for rep_ops in frame_repr_ops.get(fid, {}).values():
            ops.extend(rep_ops)
        payload[fid] = ops
    return payload


def build_screen_payload(
    screen_ops: list[dict[str, Any]],
    screen_repr_ops: Mapping[str, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    """Assemble stage-level draw ops from direct screen ops and representations."""
    payload = list(screen_ops)
    for ops in screen_repr_ops.values():
        payload.extend(ops)
    return payload


def build_display_payload(
    *,
    screen_ops: list[dict[str, Any]],
    screen_repr_ops: Mapping[str, list[dict[str, Any]]],
    frame_ops: Mapping[str, list[dict[str, Any]]],
    frame_repr_ops: Mapping[str, Mapping[str, list[dict[str, Any]]]],
    geom: Mapping[str, dict[str, Any]],
) -> dict[str, Any]:
    """Build the authoritative display payload shape for the UI runtime."""
    placed_geom = filter_placed_geom(geom)
    assembled_screen = build_screen_payload(screen_ops, screen_repr_ops)
    assembled_frames = build_frame_payload(frame_ops, frame_repr_ops)
    return {
        "screen": assembled_screen,
        "frames": assembled_frames,
        "geom": placed_geom,
    }


def publish_display_runtime_payload(payload: dict[str, Any]) -> None:
    """Persist the display payload and sync runtime assets for native/browser hosts."""
    global _display_assets_synced_once
    try:
        warned_missing_root = False

        def warn_missing_root() -> None:
            nonlocal warned_missing_root
            if warned_missing_root:
                return
            warned_missing_root = True
            _vf_warn(
                "vektorflow: UI: could not find web/vf-ui (index.html + vkf-scene.html). "
                "vf-display.json not written. Run from the vektor-flow repo, set VF_UI_REPO_ROOT "
                "to that directory, or pip install -e from a clone that includes web/vf-ui."
            )

        _text, wrote_files = write_display_payload(payload, warn_missing_root=warn_missing_root)
        root = find_vektorflow_repo_root()
        if not wrote_files or root is None:
            return
        if not _display_assets_synced_once:
            _sync_display_runtime_assets(root)
            _display_assets_synced_once = True
    except (OSError, TypeError, ValueError):
        pass


def _sync_display_runtime_assets(root: Path) -> None:
    for filename in _DISPLAY_RUNTIME_ASSETS:
        _copy_root_runtime_asset_to_built_web(root, filename)
    for filename in _GEOM_RUNTIME_ASSETS:
        _copy_geom_runtime_asset_to_built_web(root, filename)


def _copy_root_runtime_asset_to_built_web(root: Path, filename: str) -> None:
    src = root / "web" / "vf-ui" / filename
    if not src.is_file():
        return
    for built_web_dir in _iter_overlay_built_web_dirs(root):
        dst = built_web_dir / filename
        try:
            dst.parent.mkdir(parents=True, exist_ok=True)
            if filename == "vkf-scene.html":
                text = src.read_text(encoding="utf-8", errors="replace")
                stamped = _VERSION_QUERY_RE.sub(f"?v={int(time.time())}", text)
                dst.write_text(stamped, encoding="utf-8")
            else:
                shutil.copy2(src, dst)
        except OSError:
            pass


def _copy_geom_runtime_asset_to_built_web(root: Path, filename: str) -> None:
    src = root / "web" / "vf-ui" / "geom" / filename
    if not src.is_file():
        return
    for built_ui_dir in (root / "native" / "VfOverlay").rglob("vf-ui"):
        dst = built_ui_dir / "geom" / filename
        try:
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_bytes(src.read_bytes())
        except OSError:
            pass


def _iter_overlay_built_web_dirs(root: Path) -> tuple[Path, ...]:
    built_dirs: list[Path] = []
    for rel in (
        Path("native") / "VfOverlay" / "build" / "Release" / "web",
        Path("native") / "VfOverlay" / "build" / "Debug" / "web",
        Path("native") / "VfOverlay" / "build" / "x64" / "Release" / "web",
        Path("native") / "VfOverlay" / "build" / "x64" / "Debug" / "web",
        Path("native") / "build" / "VfOverlay" / "Release" / "web",
        Path("native") / "build" / "VfOverlay" / "Debug" / "web",
    ):
        built_web_dir = (root / rel).resolve()
        if built_web_dir.is_dir() and (built_web_dir / "vkf-scene.html").is_file():
            built_dirs.append(built_web_dir)
    return tuple(built_dirs)


def has_visible_display_content(*, commands: list[Any], payload: Mapping[str, Any]) -> bool:
    """Return whether the runtime has enough placed content to justify host launch."""
    if commands:
        return True
    if payload.get("screen"):
        return True
    if payload.get("frames"):
        return True
    if payload.get("geom"):
        return True
    return False
