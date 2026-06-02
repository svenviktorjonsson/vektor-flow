from __future__ import annotations

from pathlib import Path
import shutil

import pytest

from vektorflow.ui.display_runtime import _sync_display_runtime_assets, publish_display_runtime_payload
from vektorflow.ui.payloads import reset_ui_payload_snapshot
from vektorflow.ui.runtime_packet_transport import (
    UIRuntimePacketTransport,
    reset_ui_runtime_packet_transport,
    set_ui_runtime_packet_transport,
)


def test_sync_display_runtime_assets_copies_tree_and_skips_sessions(tmp_path: Path) -> None:
    root = tmp_path
    src_root = root / "web" / "vf-ui"
    built_root = root / "native" / "VfOverlay" / "build" / "Release" / "web"

    (src_root / "geom").mkdir(parents=True, exist_ok=True)
    (src_root / "katex").mkdir(parents=True, exist_ok=True)
    (src_root / "sessions" / "stale").mkdir(parents=True, exist_ok=True)
    built_root.mkdir(parents=True, exist_ok=True)

    (src_root / "vkf-scene.html").write_text(
        '<script src="vf-runtime-shell.js?v=1"></script>', encoding="utf-8"
    )
    (src_root / "vf-runtime-shell.js").write_text("console.log('shell');", encoding="utf-8")
    (src_root / "geom" / "vf-geom-core.js").write_text("console.log('geom');", encoding="utf-8")
    (src_root / "katex" / "katex.min.js").write_text("console.log('katex');", encoding="utf-8")
    (src_root / "sessions" / "stale" / "old.txt").write_text("do-not-copy", encoding="utf-8")

    # Marker that makes the built directory discoverable as an overlay web root.
    (built_root / "vkf-scene.html").write_text("old", encoding="utf-8")

    _sync_display_runtime_assets(root, strict=True)

    assert (built_root / "vf-runtime-shell.js").read_text(encoding="utf-8") == "console.log('shell');"
    assert (built_root / "geom" / "vf-geom-core.js").read_text(encoding="utf-8") == "console.log('geom');"
    assert (built_root / "katex" / "katex.min.js").read_text(encoding="utf-8") == "console.log('katex');"
    assert not (built_root / "sessions" / "stale" / "old.txt").exists()
    assert '?v=' in (built_root / "vkf-scene.html").read_text(encoding="utf-8")


def test_sync_display_runtime_assets_skips_unchanged_non_html_files(
    tmp_path: Path,
    monkeypatch,
) -> None:
    root = tmp_path
    src_root = root / "web" / "vf-ui"
    built_root = root / "native" / "VfOverlay" / "build" / "Release" / "web"

    (src_root / "geom").mkdir(parents=True, exist_ok=True)
    built_root.mkdir(parents=True, exist_ok=True)

    (src_root / "vkf-scene.html").write_text(
        '<script src="vf-runtime-shell.js?v=1"></script>', encoding="utf-8"
    )
    (src_root / "vf-runtime-shell.js").write_text("console.log('shell');", encoding="utf-8")
    (src_root / "geom" / "vf-geom-core.js").write_text("console.log('geom');", encoding="utf-8")
    (built_root / "vkf-scene.html").write_text("old", encoding="utf-8")

    _sync_display_runtime_assets(root, strict=True)

    copied: list[tuple[str, str]] = []
    real_copy2 = shutil.copy2

    def record_copy2(src: str, dst: str, *args, **kwargs):
        copied.append((src, dst))
        return real_copy2(src, dst, *args, **kwargs)

    monkeypatch.setattr("vektorflow.ui.display_runtime.shutil.copy2", record_copy2)

    _sync_display_runtime_assets(root, strict=True)

    assert copied == []


def test_publish_display_runtime_payload_hard_errors_on_failed_strict_direct_publish(
    monkeypatch,
) -> None:
    reset_ui_payload_snapshot()
    reset_ui_runtime_packet_transport()
    monkeypatch.setenv("VF_UI_PACKET_ONLY_STRICT", "1")
    set_ui_runtime_packet_transport(
        UIRuntimePacketTransport(direct_publisher=lambda _packets: (False, "direct://fail", "offline"))
    )

    try:
        with pytest.raises(RuntimeError, match="strict packet-only display publish failed"):
            publish_display_runtime_payload({"screen": [], "frames": {}, "geom": {}})
    finally:
        reset_ui_runtime_packet_transport()
        reset_ui_payload_snapshot()
