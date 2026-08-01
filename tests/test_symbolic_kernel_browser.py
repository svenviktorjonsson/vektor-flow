from __future__ import annotations

import json
import math
import shutil
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent
VKF_SOURCE = ROOT / "compiler" / "self_hosted" / "symbolic_expression.vkf"
LEXER_SOURCE = ROOT / "compiler" / "native" / "vkf_lexer_cursor_smoke.cpp"
PARSER_SOURCE = ROOT / "compiler" / "native" / "vkf_parser_token_stream_smoke.cpp"
IR_SOURCE = ROOT / "compiler" / "native" / "vkf_ast_to_ir_smoke.cpp"
ARTIFACT_SOURCE = (
    ROOT / "compiler" / "native" / "vkf_symbolic_kernel_artifact.cpp"
)
JSON_SOURCE = ROOT / "native" / "VfOverlay" / "vf" / "json.cpp"
ADAPTER = ROOT / "web" / "vf-ui" / "vf-symbolic-kernel-runtime.mjs"


def compiler() -> str | None:
    return next(
        (
            executable
            for name in ("clang++", "g++", "c++")
            if (executable := shutil.which(name))
        ),
        None,
    )


def compile_tool(
    executable: str,
    output: Path,
    *sources: Path,
) -> Path:
    subprocess.run(
        [
            executable,
            "-std=c++17",
            "-Wall",
            "-Wextra",
            "-pedantic",
            "-I",
            str(ROOT),
            "-I",
            str(ROOT / "native" / "VfOverlay"),
            *map(str, sources),
            "-o",
            str(output),
        ],
        cwd=ROOT,
        check=True,
    )
    return output


def test_compiles_and_executes_symbolic_vkf_in_browser_wasm(
    tmp_path: Path,
) -> None:
    cxx = compiler()
    node = shutil.which("node")
    if cxx is None or node is None:
        pytest.skip("C++17 and Node are required")

    lexer = compile_tool(cxx, tmp_path / "lexer", LEXER_SOURCE)
    parser = compile_tool(
        cxx,
        tmp_path / "parser",
        PARSER_SOURCE,
        JSON_SOURCE,
    )
    lower = compile_tool(
        cxx,
        tmp_path / "lower",
        IR_SOURCE,
        JSON_SOURCE,
    )
    artifact = compile_tool(
        cxx,
        tmp_path / "artifact",
        ARTIFACT_SOURCE,
        JSON_SOURCE,
    )

    tokens = subprocess.run(
        [str(lexer), "--file", str(VKF_SOURCE), VKF_SOURCE.as_posix()],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    ast = subprocess.run(
        [str(parser)],
        cwd=ROOT,
        check=True,
        input=tokens,
        capture_output=True,
        text=True,
    ).stdout
    typed = subprocess.run(
        [str(lower)],
        cwd=ROOT,
        check=True,
        input=ast,
        capture_output=True,
        text=True,
    ).stdout
    typed_path = tmp_path / "symbolic.typed.json"
    typed_path.write_text(typed, encoding="utf-8")
    wasm_path = tmp_path / "symbolic.wasm"
    manifest_path = tmp_path / "symbolic.json"
    subprocess.run(
        [
            str(artifact),
            "--typed-ir",
            str(typed_path),
            "--wasm",
            str(wasm_path),
            "--manifest",
            str(manifest_path),
            "--entry",
            "symbolic_compile",
        ],
        cwd=ROOT,
        check=True,
    )

    script = tmp_path / "browser.mjs"
    script.write_text(
        """
import { readFile } from "node:fs/promises";
const { createSymbolicKernel } = await import(process.argv[2]);

const wasm = await readFile(process.argv[3]);
const manifest = JSON.parse(await readFile(process.argv[4], "utf8"));
const { instance } = await WebAssembly.instantiate(wasm);
const kernel = createSymbolicKernel({ instance, manifest });
const compiled = kernel.compile("x^2 + pi");
const evaluated = kernel.evaluate(compiled.handle, 3, 0);
const squareRootPower = kernel.compile("4^0.5");
const negativePower = kernel.compile("2^-3");
const polarAngle = kernel.compile("phi");
const workspace = kernel.createWorkspace();
const plot = kernel.plot(
  compiled.handle,
  workspace.handle,
  {
    xMin: -2, xMax: 2, yMin: -2, yMax: 5,
    tMin: 0, tMax: 1, t: 0,
    xSteps: 17, ySteps: 17, tSteps: 17,
    fieldXSteps: 17, fieldYSteps: 17, vectorScale: 0.1,
  },
  {
    edgeR: 1, edgeG: 1, edgeB: 1, edgeA: 1,
    faceR: 0.2, faceG: 0.4, faceB: 0.8, faceA: 0.8,
    valueMin: -4, valueMax: 4,
  },
  11,
);
const vertices = Array.from(
  new Float32Array(kernel.memory.buffer, plot.pointer, plot.count * 6),
);
function plotSource(source, revision, stylePatch = {}, viewPatch = {}) {
  const program = kernel.compile(source);
  const localWorkspace = kernel.createWorkspace();
  const result = kernel.plot(
    program.handle,
    localWorkspace.handle,
    {
      xMin: -2, xMax: 2, yMin: -2, yMax: 2,
      tMin: 0, tMax: 1, t: 0,
      xSteps: 9, ySteps: 9, tSteps: 9,
      fieldXSteps: 9, fieldYSteps: 9, vectorScale: 0.1,
      ...viewPatch,
    },
    {
      edgeR: 1, edgeG: 1, edgeB: 1, edgeA: 1,
      faceR: 0.2, faceG: 0.4, faceB: 0.8, faceA: 0.8,
      valueMin: -4, valueMax: 4,
      ...stylePatch,
    },
    revision,
  );
  return {
    classification: program.value.classification,
    result,
    vertices: Array.from(
      new Float32Array(kernel.memory.buffer, result.pointer, result.count * 6),
    ),
  };
}
const relations = {
  lt: plotSource("x^2 + y^2 < 1", 12),
  gt: plotSource("x^2 + y^2 > 1", 13),
  le: plotSource("x^2 + y^2 <= 1", 14),
  ge: plotSource("x^2 + y^2 >= 1", 15),
};
const tuple = plotSource("(complex(1, 2), complex(3, 4))", 16);
const scalar = plotSource("x + y", 17, {
  colormapPoints: [
    { pos: 0, color: [255, 0, 0], alpha: 1 },
    { pos: 1, color: [0, 0, 255], alpha: 0.5 },
  ],
});
const sine = plotSource("sin(x)", 18, {}, {
  xMin: -3.3, xMax: -3.0, xSteps: 65,
});
process.stdout.write(JSON.stringify({
  program: compiled.value,
  evaluated,
  squareRootPower: kernel.evaluate(squareRootPower.handle, 0, 0),
  negativePower: kernel.evaluate(negativePower.handle, 0, 0),
  polarAngles: [
    kernel.evaluate(polarAngle.handle, 1, 0),
    kernel.evaluate(polarAngle.handle, 0, 1),
    kernel.evaluate(polarAngle.handle, -1, 0),
    kernel.evaluate(polarAngle.handle, 0, -1),
  ],
  plot,
  vertices,
  relations,
  tuple,
  scalar,
  sine,
}));
""",
        encoding="utf-8",
    )
    result = subprocess.run(
        [
            node,
            str(script),
            ADAPTER.as_uri(),
            str(wasm_path),
            str(manifest_path),
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(result.stdout)
    assert payload["program"]["diagnostics"] == []
    assert payload["program"]["latex"] == "{x}^{2} + \\pi"
    assert payload["program"]["classification"] == "y-of-x"
    assert "x" in payload["program"]["variables"]
    assert payload["evaluated"] == pytest.approx(12.141592653589793)
    assert payload["squareRootPower"] == pytest.approx(2)
    assert payload["negativePower"] == pytest.approx(0.125)
    assert payload["polarAngles"] == pytest.approx(
        [0, 1.5707963267948966, 3.141592653589793, -1.5707963267948966]
    )
    assert payload["plot"]["count"] == 17
    assert payload["plot"]["stride"] == 24
    assert payload["plot"]["revision"] == 11
    assert payload["plot"]["ranges"] == [
        {"mode": "time-curve", "first": 0, "count": 17}
    ]
    assert payload["vertices"][:6] == pytest.approx(
        [-2, 4 + 3.141592653589793, 1, 1, 1, 1]
    )
    sine_vertices = payload["sine"]["vertices"]
    sine_x = sine_vertices[0::6]
    sine_y = sine_vertices[1::6]
    assert payload["sine"]["result"]["ranges"] == [
        {"mode": "time-curve", "first": 0, "count": len(sine_x)}
    ]
    assert all(left < right for left, right in zip(sine_x, sine_x[1:]))
    assert sine_y == pytest.approx([math.sin(x) for x in sine_x], abs=1e-6)
    assert all(left > right for left, right in zip(sine_y, sine_y[1:]))
    assert max(
        math.hypot(sine_x[index] - sine_x[index - 1],
                   sine_y[index] - sine_y[index - 1])
        for index in range(1, len(sine_x))
    ) < 0.01
    assert max(
        abs(sine_y[index - 1] - 2 * sine_y[index] + sine_y[index + 1])
        for index in range(1, len(sine_y) - 1)
    ) < 1e-4
    for key in ("lt", "gt"):
        relation = payload["relations"][key]
        assert relation["classification"] == "open-region"
        assert relation["result"]["ranges"] == [
            {
                "mode": "triangles",
                "part": "face",
                "first": 0,
                "count": relation["result"]["count"],
            }
        ]
        assert relation["vertices"][2:6] == pytest.approx([0.2, 0.4, 0.8, 0.8])
    for key in ("le", "ge"):
        relation = payload["relations"][key]
        ranges = relation["result"]["ranges"]
        assert relation["classification"] == "closed-region"
        assert ranges[0]["mode"] == "triangles"
        assert ranges[0]["part"] == "face"
        assert ranges[1]["mode"] == "linked-line-segments"
        assert ranges[1]["part"] == "edge"
        assert ranges[1]["count"] > 0
        assert relation["vertices"][2:6] == pytest.approx([0.2, 0.4, 0.8, 0.8])
        edge_offset = ranges[1]["first"] * 6 + 2
        assert relation["vertices"][edge_offset : edge_offset + 4] == pytest.approx([1, 1, 1, 1])
    assert payload["tuple"]["classification"] == "linked-tuple"
    assert payload["tuple"]["result"]["count"] == 2
    assert payload["tuple"]["vertices"][:12] == pytest.approx(
        [1, 2, 1, 1, 1, 1, 3, 4, 1, 1, 1, 1]
    )
    assert payload["scalar"]["classification"] == "scalar-field"
    assert payload["scalar"]["vertices"][2:6] == pytest.approx([1, 0, 0, 1])
