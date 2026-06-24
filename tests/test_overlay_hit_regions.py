from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FRAME_JS = ROOT / "web" / "vf-ui" / "vf-frame.js"
OVERLAY_MAIN = ROOT / "native" / "VfOverlay" / "main.cpp"


def test_native_overlay_hit_regions_are_not_padded_by_visual_paint() -> None:
    frame_js = FRAME_JS.read_text(encoding="utf-8")
    native_main = OVERLAY_MAIN.read_text(encoding="utf-8")

    assert "function pushHitRect(r, shapePad)" in frame_js
    assert "left: Math.floor(r.left)," in frame_js
    assert "top: Math.floor(r.top)," in frame_js
    assert "right: Math.ceil(r.right)," in frame_js
    assert "bottom: Math.ceil(r.bottom)," in frame_js
    assert "Math.floor(r.left - pad)" in frame_js
    assert "Math.floor(r.left - pad),\n          top: Math.floor(r.top - pad),\n          right: Math.ceil(r.right + pad),\n          bottom: Math.ceil(r.bottom + pad)" not in frame_js
    assert "pushHitRect({ left: l, top: t, right: r, bottom: b, width: r - l, height: b - t }, 0);" in frame_js

    assert "constexpr LONG kPad" not in native_main
    assert "rc.left -= kPad" not in native_main
    assert "rc.right += kPad" not in native_main


def test_native_overlay_suspends_visual_region_clip_during_frame_drag() -> None:
    frame_js = FRAME_JS.read_text(encoding="utf-8")
    native_main = OVERLAY_MAIN.read_text(encoding="utf-8")

    assert "dragActive: o.dragActive === true" in frame_js
    assert "nativeFrameDragActive = true" in frame_js
    assert "g_frameDragActive = cJSON_IsBool(da) && cJSON_IsTrue(da);" in native_main
    assert "if (g_frameDragActive) {" in native_main
    assert "SetWindowRgn(host, nullptr, TRUE);" in native_main
    assert "ClearPassThroughShapeSubtree(ch);" in native_main
