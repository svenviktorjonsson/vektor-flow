from __future__ import annotations

import json
from pathlib import Path

import pytest

from vektorflow.html_output import HTML_OUTPUT_MANIFEST, NoHtmlOutputError, export_html_output


def test_exports_ui_display_as_vf_ui_html_bundle(tmp_path: Path) -> None:
    source = tmp_path / "display.vkf"
    source.write_text(
        """
ui:.ui
d: ui.display
frame: d.frame(id: "chat_frame", title: "Chat output")
d.add_frame(frame, (0.1, 0.1, 0.8, 0.8))
""",
        encoding="utf-8",
    )

    bundle = export_html_output(source, tmp_path / "preview")

    assert bundle.mode == "display"
    assert bundle.entrypoint == "vkf-scene.html"
    assert (bundle.output_dir / "vf-frame.js").is_file()
    assert "chat_frame" in (bundle.output_dir / "vkf-scene.json").read_text(encoding="utf-8")
    manifest = json.loads((bundle.output_dir / HTML_OUTPUT_MANIFEST).read_text(encoding="utf-8"))
    assert manifest == {
        "schema_version": 1,
        "kind": "vektorflow-html-output",
        "language": "vektorflow",
        "source": "display.vkf",
        "mode": "display",
        "entrypoint": "vkf-scene.html",
        "runtime": "vf-ui",
    }


def test_exports_native_scene_as_vf_ui_html_bundle(tmp_path: Path) -> None:
    source = tmp_path / "native.vkf"
    source.write_text(
        """
native_scene: (
    kind: "scene_3d",
    frame_id: "native_chat_scene",
    title: "Native Chat Scene",
    rect: [0.05, 0.05, 0.9, 0.9],
    cube: (center: [0.0, 0.0, 1.0], size: 1.0, face_color: [0.2, 0.7, 1.0, 1.0]),
    plane: (center: [0.0, 0.0], size: 4.0, z: 0.0, color: [0.2, 0.2, 0.2, 1.0]),
    camera: (pos: [3.0, -4.0, 3.0], target: [0.0, 0.0, 1.0], fov: 40.0, up: [0.0, 0.0, 1.0]),
    lights: [(kind: "point", pos: [2.0, -2.0, 4.0], power: 1000.0, range: 12.0, casts_shadow: false)],
    shadow: (enabled: false, color: [0.0, 0.0, 0.0, 1.0], lift: 0.001)
)
""",
        encoding="utf-8",
    )

    bundle = export_html_output(source, tmp_path / "preview")

    assert bundle.mode == "native_scene"
    assert "native_chat_scene" in (bundle.output_dir / "vkf-scene.html").read_text(encoding="utf-8")
    assert (bundle.output_dir / "vf-runtime-packets.json").is_file()


def test_non_visual_program_has_no_html_output(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    source = tmp_path / "console.vkf"
    source.write_text(':: "hello"\n', encoding="utf-8")

    with pytest.raises(NoHtmlOutputError, match="does not declare"):
        export_html_output(source, tmp_path / "preview")
    assert capsys.readouterr().out == ""


def test_refuses_to_replace_an_unowned_directory(tmp_path: Path) -> None:
    source = tmp_path / "display.vkf"
    source.write_text("ui:.ui\nd: ui.display\n", encoding="utf-8")
    output = tmp_path / "preview"
    output.mkdir()
    (output / "keep.txt").write_text("user data", encoding="utf-8")

    with pytest.raises(RuntimeError, match="refusing to replace"):
        export_html_output(source, output)
    assert (output / "keep.txt").read_text(encoding="utf-8") == "user data"
