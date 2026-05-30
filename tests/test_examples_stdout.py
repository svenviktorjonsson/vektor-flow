from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys

import pytest


ROOT = Path(__file__).resolve().parent.parent
EXAMPLES_DIR = ROOT / "examples"
STDOUT_EXPECTATIONS_PATH = EXAMPLES_DIR / "stdout_expectations.json"
UI_EXAMPLES = {
    "100_axis_4_panel.vkf",
    "110_mirror_showcase.vkf",
    "111_mirror_smoke.vkf",
    "112_scene3d_smoke.vkf",
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
    proc = subprocess.run(
        [sys.executable, "-m", "vektorflow.cli", str(example_path)],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, (
        f"{example_name} failed with stderr:\n{proc.stderr}"
    )
    assert proc.stdout.rstrip("\r\n") == expected_stdout
