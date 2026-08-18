from __future__ import annotations

import json
import contextlib
from io import StringIO
from pathlib import Path

import pytest

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module


ROOT = Path(__file__).resolve().parent.parent
EXAMPLES_DIR = ROOT / "examples"
STDOUT_EXPECTATIONS_PATH = EXAMPLES_DIR / "stdout_expectations.json"
UI_EXAMPLES = {
    "100_axis_4_panel.vkf",
    "110_mirror_showcase.vkf",
    "111_mirror_smoke.vkf",
    "112_scene3d_smoke.vkf",
    "114_grass_texture_cube.vkf",
    "physics_rigid_polygons_2d.vkf",
}
EXPECTED_STDOUT = json.loads(STDOUT_EXPECTATIONS_PATH.read_text(encoding="utf-8"))


def _curated_non_ui_examples() -> list[Path]:
    return sorted(
        path
        for path in EXAMPLES_DIR.glob("*.vkf")
        if path.name not in UI_EXAMPLES
    )


def test_stdout_manifest_covers_every_curated_non_ui_example() -> None:
    expected_names = {path.name for path in _curated_non_ui_examples()}
    manifest_names = set(EXPECTED_STDOUT)
    assert manifest_names == expected_names


@pytest.mark.parametrize(
    "example_name, expected_stdout",
    sorted(EXPECTED_STDOUT.items()),
)
def test_curated_example_stdout_matches_manifest(
    example_name: str,
    expected_stdout: str,
) -> None:
    example_path = EXAMPLES_DIR / example_name
    source = example_path.read_text(encoding="utf-8")
    module = parse_module(source, filename=str(example_path))
    output = StringIO()
    with contextlib.redirect_stdout(output):
        Interpreter(example_path).run_module(module)
    assert output.getvalue().rstrip("\r\n") == expected_stdout
