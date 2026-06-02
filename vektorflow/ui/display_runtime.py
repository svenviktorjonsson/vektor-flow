"""UI runtime display payload helpers.

This module owns the packet-first display payload assembly seam for the UI
runtime. ``vektorflow.stdlib.ui.Display`` should orchestrate when a sync
happens, while the display payload shape and the built-overlay asset bundle
sync live here.
"""

from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Any, Mapping

from vektorflow.ui.file_io import write_text_if_changed
from vektorflow.ui.launch import _vf_warn, find_vektorflow_repo_root
from vektorflow.ui.payloads import (
    get_ui_payload_snapshot,
    raise_on_failed_strict_packet_publish,
    write_display_payload,
)


_VERSION_QUERY_RE = re.compile(r"\?v=\d+")
_SYNC_SKIP_TOP_LEVEL = frozenset({"sessions", "__pycache__"})


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
    """Persist the current display payload for browser/native hosts."""
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

        write_display_payload(payload, warn_missing_root=warn_missing_root)
        raise_on_failed_strict_packet_publish("display", get_ui_payload_snapshot().last_publish_result)
    except (TypeError, ValueError) as exc:
        raise RuntimeError(f"vektorflow: UI display payload is invalid: {exc}") from exc
    except OSError as exc:
        raise RuntimeError(f"vektorflow: UI display payload could not be written: {exc}") from exc


def _sync_display_runtime_assets(root: Path, *, strict: bool = False) -> None:
    src_root = (root / "web" / "vf-ui").resolve()
    if not src_root.is_dir():
        if strict:
            raise RuntimeError(f"UI not started: runtime asset source tree missing: {src_root}")
        return
    built_web_dirs = _iter_overlay_built_web_dirs(root)
    if not built_web_dirs:
        if strict:
            raise RuntimeError("UI not started: built overlay web runtime directory is missing")
        return

    errors: list[str] = []
    for src in src_root.rglob("*"):
        if not src.is_file():
            continue
        rel = src.relative_to(src_root)
        if rel.parts and rel.parts[0] in _SYNC_SKIP_TOP_LEVEL:
            continue
        for built_web_dir in built_web_dirs:
            dst = built_web_dir / rel
            try:
                dst.parent.mkdir(parents=True, exist_ok=True)
                if rel.as_posix() == "vkf-scene.html":
                    text = src.read_text(encoding="utf-8", errors="replace")
                    stamped = _VERSION_QUERY_RE.sub(f"?v={src.stat().st_mtime_ns}", text)
                    write_text_if_changed(dst, stamped)
                else:
                    if _file_copy_is_current(src, dst):
                        continue
                    shutil.copy2(src, dst)
            except OSError as exc:
                msg = f"{src} -> {dst}: {exc}"
                if strict:
                    errors.append(msg)
                else:
                    _vf_warn(f"vektorflow: UI asset sync skipped {msg}")
    if errors:
        preview = "; ".join(errors[:3])
        if len(errors) > 3:
            preview += f"; ... ({len(errors)} files failed)"
        raise RuntimeError(
            "UI not started: overlay runtime asset sync failed after previous host shutdown. "
            f"Details: {preview}"
        )


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


def _file_copy_is_current(src: Path, dst: Path) -> bool:
    try:
        if not dst.is_file():
            return False
        src_stat = src.stat()
        dst_stat = dst.stat()
    except OSError:
        return False
    return (
        src_stat.st_size == dst_stat.st_size
        and src_stat.st_mtime_ns == dst_stat.st_mtime_ns
    )


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
