from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent


def _compiler_command(source: Path, output: Path) -> list[str] | None:
    for compiler in ("clang++", "g++", "c++"):
        path = shutil.which(compiler)
        if path is not None:
            return [
                path,
                "-std=c++17",
                "-I",
                str(ROOT),
                str(source),
                "-o",
                str(output),
            ]

    cl = shutil.which("cl")
    if cl is not None:
        return [
            cl,
            "/nologo",
            "/EHsc",
            "/std:c++17",
            f"/I{ROOT}",
            str(source),
            f"/Fe:{output}",
        ]

    return None


@pytest.mark.skipif(shutil.which("clang++") is None and shutil.which("g++") is None and shutil.which("c++") is None and shutil.which("cl") is None, reason="no C++ compiler found")
def test_native_symbolic_core_carries_domains_nodes_latex_and_diophantine_solve(tmp_path: Path) -> None:
    source = ROOT / "compiler" / "native" / "vkf_symbolic_smoke.cpp"
    output = tmp_path / "check_symbolic.exe"

    command = _compiler_command(source, output)
    if command is None:
        pytest.skip("no C++ compiler found")

    subprocess.run(command, cwd=ROOT, check=True, capture_output=True, text=True)
    proc = subprocess.run([str(output)], cwd=ROOT, check=True, capture_output=True, text=True)
    assert proc.stdout.splitlines() == [
        "x + 1",
        "x+1",
        "-7 + 3*k",
        "7 - 2*k",
        "1",
        "x ^ 2 / 2",
        "grad(x + 1, x)",
        "\\phi+\\theta",
        "\\frac{\\partial}{\\partial \\phi} \\phi\\,\\theta",
        "\\int \\phi\\,d\\phi",
        "\\sum_{\\phi=1}^{\\infty} \\phi",
    ]
