from __future__ import annotations

import json
import subprocess
from pathlib import Path
import pytest


REPO = Path(__file__).resolve().parents[1]
MATERIAL_JS = REPO / "web" / "vf-ui" / "geom" / "vf-geom-material-arena.js"
SURFACE_JS = REPO / "web" / "vf-ui" / "geom" / "vf-geom-parametric-surface.js"


def _run_node(script: str) -> dict:
    result = subprocess.run(
        ["node", "-e", script],
        check=True,
        capture_output=True,
        text=True,
        cwd=REPO,
    )
    return json.loads(result.stdout)


def test_material_arena_resolves_scene_parts() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");

const sandbox = {{
  console,
  Float32Array,
  Uint32Array,
  Math
}};
sandbox.window = sandbox;

vm.runInNewContext(fs.readFileSync({json.dumps(str(MATERIAL_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-material-arena.js" }});

const arena = sandbox.VfGeomMaterialArena.createArena({{
  surface: {{
    base_color: [0.2, 0.4, 0.6, 0.8],
    light_model: "flat",
    depth_write: true
  }}
}});

const scene = arena.resolveScene({{
  parts: [
    {{ id: "surface", material_id: "surface" }}
  ]
}});

process.stdout.write(JSON.stringify({{
  lightModel: scene.parts[0].light_model,
  transparent: scene.parts[0].transparent,
  depthWrite: scene.parts[0].depth_write,
  alpha: scene.parts[0].alpha,
  color: scene.parts[0].color
}}));
    """
    payload = _run_node(script)
    assert payload["lightModel"] == "blinn_phong"
    assert payload["transparent"] is True
    assert payload["depthWrite"] is True
    assert payload["alpha"] == pytest.approx(0.8)
    assert payload["color"] == pytest.approx([0.2, 0.4, 0.6, 0.8])


def test_material_arena_resolves_procedural_texture_descriptor() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");

const sandbox = {{
  console,
  Float32Array,
  Uint32Array,
  Math
}};
sandbox.window = sandbox;

vm.runInNewContext(fs.readFileSync({json.dumps(str(MATERIAL_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-material-arena.js" }});

const arena = sandbox.VfGeomMaterialArena.createArena({{
  surface: {{
    base_color: [0.95, 0.95, 0.95, 1.0],
    texture: {{
      kind: "checker",
      scale: [6, 10],
      color_a: [0.15, 0.18, 0.24, 1.0],
      color_b: [0.85, 0.88, 0.96, 1.0]
    }}
  }}
}});

const scene = arena.resolveScene({{
  parts: [
    {{ id: "surface", material_id: "surface" }}
  ]
}});

process.stdout.write(JSON.stringify(scene.parts[0].texture));
    """
    payload = _run_node(script)
    assert payload["kind"] == "checker"
    assert payload["space"] == "triplanar"
    assert payload["scale"] == pytest.approx([6.0, 10.0])
    assert payload["color_a"] == pytest.approx([0.15, 0.18, 0.24, 1.0])
    assert payload["color_b"] == pytest.approx([0.85, 0.88, 0.96, 1.0])


def test_material_arena_resolves_dice_texture_descriptor() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");

const sandbox = {{
  console,
  Float32Array,
  Uint32Array,
  Math
}};
sandbox.window = sandbox;

vm.runInNewContext(fs.readFileSync({json.dumps(str(MATERIAL_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-material-arena.js" }});

const arena = sandbox.VfGeomMaterialArena.createArena({{
  die: {{
    base_color: [1.0, 1.0, 1.0, 1.0],
    texture: {{
      kind: "dice",
      color_a: [1.0, 1.0, 1.0, 1.0],
      color_b: [0.0, 0.0, 0.0, 1.0],
      graph_test: true,
      graph_width_px: 5.0
    }}
  }}
}});

const scene = arena.resolveScene({{
  parts: [
    {{ id: "die", material_id: "die" }}
  ]
}});

process.stdout.write(JSON.stringify(scene.parts[0].texture));
    """
    payload = _run_node(script)
    assert payload["kind"] == "dice"
    assert payload["space"] == "triplanar"
    assert payload["color_a"] == pytest.approx([1.0, 1.0, 1.0, 1.0])
    assert payload["color_b"] == pytest.approx([0.0, 0.0, 0.0, 1.0])
    assert payload["graph_test"] is True
    assert payload["graph_width_px"] == pytest.approx(5.0)


def test_material_arena_resolves_face_cube_texture_descriptor() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");

const sandbox = {{
  console,
  Float32Array,
  Uint32Array,
  Math
}};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.runInNewContext(fs.readFileSync({json.dumps(str(MATERIAL_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-material-arena.js" }});

const arena = sandbox.VfGeomMaterialArena.createArena({{
  projected: {{
    texture: {{
      kind: "face_cube",
      scale: [1.2, 1.2],
      color_a: [0.98, 0.98, 1.0, 1.0],
      color_b: [0.02, 0.02, 0.04, 1.0],
      rotation: [0.0, 1.5707963, 0.0]
    }}
  }}
}});
const scene = arena.resolveScene({{
  parts: [{{ material_id: "projected", color: [1,1,1,1] }}]
}});
process.stdout.write(JSON.stringify(scene.parts[0].texture));
    """
    payload = _run_node(script)
    assert payload["kind"] == "face_cube"
    assert payload["scale"] == pytest.approx([1.2, 1.2])
    assert payload["rotation"] == pytest.approx([0.0, 1.5707963, 0.0])


def test_parametric_surface_arena_owns_grid_topology_and_dynamic_revision() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");

const sandbox = {{
  console,
  Float32Array,
  Uint32Array,
  Math
}};
sandbox.window = sandbox;

vm.runInNewContext(fs.readFileSync({json.dumps(str(MATERIAL_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-material-arena.js" }});
vm.runInNewContext(fs.readFileSync({json.dumps(str(SURFACE_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-parametric-surface.js" }});

const materials = sandbox.VfGeomMaterialArena.createArena({{
  surface: {{ base_color: [0.1, 0.2, 0.3, 1] }},
  edge: {{ base_color: [0.4, 0.5, 0.6, 1] }},
  vertex: {{ base_color: [0.7, 0.8, 0.9, 1] }}
}});

const arena = sandbox.VfGeomParametricSurface.createGridSurfaceArena({{
  uValues: new Float32Array([0, 1]),
  vValues: new Float32Array([0, 1]),
  faceSubdivisions: 1,
  showEdges: true,
  showVertices: true,
  edgeWidth: 0.25,
  vertexSize: 0.5,
  faceMaterialId: "surface",
  edgeMaterialId: "edge",
  vertexMaterialId: "vertex",
  materials
}});

const parts = arena.parts();
arena.rebuild({{
  uValues: new Float32Array([0, 1]),
  vValues: new Float32Array([0, 1]),
  heights: new Float32Array([0, 1, 2, 3])
}});

process.stdout.write(JSON.stringify({{
  partIds: parts.map((part) => part.material_id),
  surfaceRevision: parts[0].__revision,
  edgeRevision: parts[1].__revision,
  vertexRevision: parts[2].__revision,
  surfaceVertexCount: parts[0].vertices.length,
  edgeInstanceCount: parts[1].instance_count,
  vertexInstanceCount: parts[2].instance_count,
  firstSurfaceColor: Array.from(parts[0].vertices.slice(6, 10)),
  firstEdgeColor: Array.from(parts[1].instances.slice(8, 12)),
  firstVertexColor: Array.from(parts[2].instances.slice(4, 8))
}}));
"""
    payload = _run_node(script)
    assert payload["partIds"] == ["surface", "edge", "vertex"]
    assert payload["surfaceRevision"] == 1
    assert payload["edgeRevision"] == 1
    assert payload["vertexRevision"] == 1
    assert payload["surfaceVertexCount"] == 60
    assert payload["edgeInstanceCount"] == 4
    assert payload["vertexInstanceCount"] == 4
    assert payload["firstSurfaceColor"] == pytest.approx([0.1, 0.2, 0.3, 1])
    assert payload["firstEdgeColor"] == pytest.approx([0.4, 0.5, 0.6, 1])
    assert payload["firstVertexColor"] == pytest.approx([0.7, 0.8, 0.9, 1])
