from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest


REPO = Path(__file__).resolve().parents[1]
MATH_JS = REPO / "web" / "vf-ui" / "geom" / "vf-geom-math.js"
CORE_JS = REPO / "web" / "vf-ui" / "geom" / "vf-geom-core.js"
WGPU_JS = REPO / "web" / "vf-ui" / "geom" / "vf-geom-wgpu.js"
DISPLAY_JS = REPO / "web" / "vf-ui" / "vf-display.js"
NATIVE_SCENE_JS = REPO / "web" / "vf-ui" / "vf-native-scene.js"


def _run_node(script: str) -> dict:
    result = subprocess.run(
        ["node", "-e", script],
        check=True,
        capture_output=True,
        text=True,
        cwd=REPO,
    )
    return json.loads(result.stdout)


def _run_node_raw(script: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["node", "-e", script],
        check=False,
        capture_output=True,
        text=True,
        cwd=REPO,
    )


def test_planar_surface_local_frame_supports_non_xy_plane() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");

const sandbox = {{
  console: {{ log() {{}}, warn() {{}}, error() {{}} }},
  Float32Array,
  Uint32Array,
  Math,
  setTimeout,
  clearTimeout,
}};
sandbox.window = sandbox;

vm.runInNewContext(fs.readFileSync({json.dumps(str(MATH_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-math.js" }});
vm.runInNewContext(fs.readFileSync({json.dumps(str(WGPU_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-wgpu.js" }});

const frame = sandbox.VfGeomWgpuUtil.derivePlanarSurfaceLocalFrame({{
  vertices: new Float32Array([
    -1, 0, -1,  0,1,0,  1,1,1,1,
     1, 0, -1,  0,1,0,  1,1,1,1,
    -1, 0,  1,  0,1,0,  1,1,1,1,
     1, 0,  1,  0,1,0,  1,1,1,1
  ])
}});

process.stdout.write(JSON.stringify({{
  minU: frame.minU,
  minV: frame.minV,
  spanU: frame.spanU,
  spanV: frame.spanV,
  uAxis: frame.uAxis,
  vAxis: frame.vAxis,
  normal: frame.normal
}}));
"""
    payload = _run_node(script)
    assert payload["spanU"] == pytest.approx(2.0)
    assert payload["spanV"] == pytest.approx(2.0)
    assert abs(payload["normal"][1]) == pytest.approx(1.0)


def test_screen_surface_face_gate_uses_geometric_front_face() -> None:
    shader = WGPU_JS.read_text(encoding="utf-8")
    assert "fn screenSurfaceFrontMask(inputNormal: vec3<f32>) -> f32" in shader
    assert "let surfaceCenter = (sc.model * vec4f(0.0, 0.0, 0.0, 1.0)).xyz;" in shader
    assert "let cameraSide = dot(surfaceNormal, sc.cam_pos - surfaceCenter);" in shader
    assert "let viewerDirWorld = normalize(sc.cam_pos - i.world_pos);" not in shader


def test_screen_surface_backface_gets_ambient_only() -> None:
    shader = WGPU_JS.read_text(encoding="utf-8")
    assert "fn shadeAmbientBase(base: vec3<f32>, alpha: f32) -> vec4f" in shader
    assert "if (frontMask < 0.5 && sc.surface_cam_up_pad.w > 0.5)" in shader
    assert "return shadeAmbientBase(i.color.rgb, i.color.a);" in shader
    assert "let suppressBackfaceLighting = backfaceSpecularOff && facing < 0.0;" in shader
    assert "if (!suppressBackfaceLighting && sc.light_count > 0u)" in shader
    assert "if (!suppressBackfaceLighting && sc.light_count > 1u)" in shader


def test_screen_surface_reflection_keeps_received_shadow_lighting() -> None:
    shader = WGPU_JS.read_text(encoding="utf-8")
    screen_branch = shader[shader.index("if (sc.texture_params.x > 3.5)"):shader.index("let base = proceduralTexture")]
    assert "fn receivedShadowVisibility(worldPos: vec3<f32>, inputNormal: vec3<f32>) -> f32" in shader
    assert "let surfaceLit = shadeLitBase(i.color.rgb, i.color.a, i.world_pos, i.normal, false);" in screen_branch
    assert "let composed = surfaceWorldSceneColor(i.color.rgb" in screen_branch
    assert "let shadowVisibility = receivedShadowVisibility(i.world_pos, i.normal);" in screen_branch
    assert "let shadowedComposed = composed * mix(0.38, 1.0, shadowVisibility);" in screen_branch
    assert "lightingFactor" not in screen_branch
    assert "surfaceWorldSceneColor(surfaceLit.rgb" not in screen_branch


def test_mirror_plane_debug_logs_all_plane_consumers() -> None:
    shader = WGPU_JS.read_text(encoding="utf-8")
    assert "[DEBUG-MIRROR-PLANE]" in shader
    for label in (
        "light-reflect",
        "light-aperture",
        "shadow-frame",
        "analytic-shadow",
        "shadow-gate",
        "surface-render-camera",
        "surface-aperture-camera",
    ):
        assert label in shader
    assert "apertureStart" not in shader
    assert "aperturePlanePoint" in shader


def test_planar_mirror_geometry_is_single_runtime_seam() -> None:
    shader = WGPU_JS.read_text(encoding="utf-8")
    assert "function resolvePlanarMirrorGeometry(meshLike, t, context)" in shader
    assert "function createPlanarMirrorRuntime(meshLike, t, context)" in shader
    assert "createPlanarMirrorRuntime: createPlanarMirrorRuntime" in shader
    assert "resolvePlanarMirrorGeometry: resolvePlanarMirrorGeometry" in shader
    assert shader.count("mirrorFrameForLightMesh(") == 2
    for context in (
        "mirror surface_system host",
        "reflected light",
        "projected light aperture",
        "planar shadow frame",
        "planar contact occluder",
        "planar shadow light gate",
        "surface render camera",
        "surface aperture camera",
        "mirror eye-locked camera",
    ):
        assert f'resolvePlanarMirrorGeometry(' in shader
        assert context in shader


def test_planar_mirror_callers_use_runtime_for_aperture_packets() -> None:
    shader = WGPU_JS.read_text(encoding="utf-8")
    linked_fn = shader[shader.index("function resolveLinkedMirrorLight"):shader.index("function resolveProjectedLightFromMeshId")]
    projected_fn = shader[shader.index("function resolveProjectedLightFromMeshId"):shader.index("function planarShadowPointsForMesh")]
    contact_fn = shader[shader.index("function buildPlanarContactOccluder"):shader.index("function resolvePlanarContactOccluderForLight")]

    assert "createPlanarMirrorRuntime(mirrorMesh, t, \"reflected light\")" in linked_fn
    assert "resolved.projected_aperture = runtime.aperturePacket(" in linked_fn
    assert "points: [" not in linked_fn

    assert "createPlanarMirrorRuntime(apertureMesh, t, \"projected light aperture\")" in projected_fn
    assert "projected_aperture: runtime.aperturePacket(" in projected_fn
    assert "points: [" not in projected_fn

    assert "createPlanarMirrorRuntime(meshLike, t, \"planar contact occluder\")" in contact_fn
    assert "runtime.aperturePacket(" in contact_fn
    assert "points: [" not in contact_fn


def test_planar_mirror_geometry_uses_visible_vertices_before_authored_quad_spec() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");

const sandbox = {{
  console: {{ log() {{}}, warn() {{}}, error() {{}} }},
  Float32Array,
  Uint32Array,
  Math,
  setTimeout,
  clearTimeout,
}};
sandbox.window = sandbox;

vm.runInNewContext(fs.readFileSync({json.dumps(str(MATH_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-math.js" }});
vm.runInNewContext(fs.readFileSync({json.dumps(str(WGPU_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-wgpu.js" }});

const mesh = {{
  id: "visible_vertices_win",
  kind: "quad",
  center: [0.0, 0.0, 0.0],
  size: [20.0, 20.0],
  rotation: [0.0, 0.0, 0.0],
  vertices: new Float32Array([
    -1.0, -2.0, 0.5,  0,0,1,  1,1,1,1,
     1.0, -2.0, 0.5,  0,0,1,  1,1,1,1,
     1.0,  2.0, 0.5,  0,0,1,  1,1,1,1,
    -1.0,  2.0, 0.5,  0,0,1,  1,1,1,1
  ])
}};

const geometry = sandbox.VfGeomWgpuUtil.resolvePlanarMirrorGeometry(mesh, 0, "test visible seam");

process.stdout.write(JSON.stringify({{
  center: geometry.center,
  extent: geometry.extent,
  spanU: geometry.frame.spanU,
  spanV: geometry.frame.spanV
}}));
"""
    payload = _run_node(script)
    assert payload["center"] == pytest.approx([0.0, 0.0, 0.5])
    assert payload["extent"] == pytest.approx(4.0)
    assert sorted([payload["spanU"], payload["spanV"]]) == pytest.approx([2.0, 4.0])


def test_planar_mirror_geometry_prefers_uploaded_model_matrix() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");

const sandbox = {{
  console: {{ log() {{}}, warn() {{}}, error() {{}} }},
  Float32Array,
  Uint32Array,
  Math,
  setTimeout,
  clearTimeout,
}};
sandbox.window = sandbox;

vm.runInNewContext(fs.readFileSync({json.dumps(str(MATH_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-math.js" }});
vm.runInNewContext(fs.readFileSync({json.dumps(str(WGPU_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-wgpu.js" }});

const uploadedMatrix = sandbox.VfGeomMath.mat4ModelTRS(
  [0.73, 2.17, 1.10],
  [90.0, 0.0, 0.0],
  [1.0, 1.0, 1.0]
);
const mesh = {{
  id: "uploaded_transform_mirror",
  kind: "quad",
  center: [0.0, 0.0, 0.0],
  size: [2.60, 2.20],
  rotation: [0.0, 0.0, 0.0],
  _modelMatrix: Array.prototype.slice.call(uploadedMatrix),
  vertices: new Float32Array([
    -1.30, -1.10, 0.0,  0,0,1,  1,1,1,1,
     1.30, -1.10, 0.0,  0,0,1,  1,1,1,1,
     1.30,  1.10, 0.0,  0,0,1,  1,1,1,1,
    -1.30,  1.10, 0.0,  0,0,1,  1,1,1,1
  ])
}};

const runtime = sandbox.VfGeomWgpuUtil.createPlanarMirrorRuntime(mesh, 0, "uploaded matrix test");
process.stdout.write(JSON.stringify({{
  center: runtime.center,
  bottomLeft: runtime.corners.bottomLeft,
  topRight: runtime.corners.topRight
}}));
"""
    payload = _run_node(script)
    assert payload["center"] == pytest.approx([0.73, 2.17, 1.10], abs=1e-5)
    assert payload["bottomLeft"][2] == pytest.approx(0.0, abs=1e-5)
    assert payload["topRight"][2] == pytest.approx(2.20, abs=1e-5)


def test_planar_mirror_geometry_ignores_identity_placeholder_model_matrix() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");

const sandbox = {{
  console: {{ log() {{}}, warn() {{}}, error() {{}} }},
  Float32Array,
  Uint32Array,
  Math,
  setTimeout,
  clearTimeout,
}};
sandbox.window = sandbox;

vm.runInNewContext(fs.readFileSync({json.dumps(str(MATH_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-math.js" }});
vm.runInNewContext(fs.readFileSync({json.dumps(str(WGPU_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-wgpu.js" }});

const mesh = {{
  id: "identity_placeholder_mirror",
  kind: "quad",
  center: [0.73, 2.17, 1.10],
  size: [2.60, 2.20],
  rotation: [90.0, 0.0, 0.0],
  _modelMatrix: Array.prototype.slice.call(sandbox.VfGeomMath.mat4Identity()),
  vertices: new Float32Array([
    -1.30, -1.10, 0.0,  0,0,1,  1,1,1,1,
     1.30, -1.10, 0.0,  0,0,1,  1,1,1,1,
     1.30,  1.10, 0.0,  0,0,1,  1,1,1,1,
    -1.30,  1.10, 0.0,  0,0,1,  1,1,1,1
  ])
}};

const runtime = sandbox.VfGeomWgpuUtil.createPlanarMirrorRuntime(mesh, 0, "identity placeholder test");
process.stdout.write(JSON.stringify({{
  center: runtime.center,
  bottomLeft: runtime.corners.bottomLeft,
  topRight: runtime.corners.topRight
}}));
"""
    payload = _run_node(script)
    assert payload["center"] == pytest.approx([0.73, 2.17, 1.10], abs=1e-5)
    assert payload["bottomLeft"][2] == pytest.approx(0.0, abs=1e-5)
    assert payload["topRight"][2] == pytest.approx(2.20, abs=1e-5)


def test_projected_light_uniform_preserves_zero_normal_components() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");

let wgpuSrc = fs.readFileSync({json.dumps(str(WGPU_JS))}, "utf8");
wgpuSrc = wgpuSrc.replace(
  "  global.VfGeomWgpuUtil = {{",
  "  global.__mirrorUniformTest = {{ resolveSceneLights: resolveSceneLights, buildUniform: buildUniform }};\\n  global.VfGeomWgpuUtil = {{"
);

const sandbox = {{
  console: {{ log() {{}}, warn() {{}}, error() {{}} }},
  Float32Array,
  Uint32Array,
  Math,
  setTimeout,
  clearTimeout,
}};
sandbox.window = sandbox;

vm.runInNewContext(fs.readFileSync({json.dumps(str(MATH_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-math.js" }});
vm.runInNewContext(wgpuSrc, sandbox, {{ filename: "vf-geom-wgpu.js" }});

const mirror = {{
  id: "back_mirror",
  kind: "quad",
  center: [0.73, 2.17, 1.10],
  size: [2.60, 2.20],
  rotation: [90.0, 0.0, 0.0],
  vertices: new Float32Array([
    -1.30, -1.10, 0.0,  0,0,1,  1,1,1,1,
     1.30, -1.10, 0.0,  0,0,1,  1,1,1,1,
     1.30,  1.10, 0.0,  0,0,1,  1,1,1,1,
    -1.30,  1.10, 0.0,  0,0,1,  1,1,1,1
  ]),
  surface_system: {{ kind: "screen", reverse_facing: true }}
}};
const ground = {{
  id: "ground_plane",
  kind: "quad",
  center: [0, 0, 0],
  size: [6, 6],
  rotation: [0, 0, 0],
  receives_shadow: true
}};
const lights = sandbox.__mirrorUniformTest.resolveSceneLights([
  {{ id: "real", kind: "point", pos: [2.4, -3.2, 4.2], target: [0, 0.4, 0.9], intensity: 1 }},
  {{
    id: "virtual",
    kind: "projected",
    reflect_of_light_id: "real",
    reflect_mirror_mesh_id: "back_mirror",
    aperture_mesh_id: "back_mirror",
    intensity: 1
  }}
], {{ parts: [mirror, ground] }}, 0);
const identity = sandbox.VfGeomMath.mat4Identity();
const ub = sandbox.__mirrorUniformTest.buildUniform(identity, identity, [0, -4, 2], lights, 2, 1, ground);
const f32 = new Float32Array(ub.buffer);
const light1Base = 356 + (192 * 4 * 4) + 16 + 20;

process.stdout.write(JSON.stringify({{
  planePoint: Array.from(f32.slice(light1Base, light1Base + 3)),
  planeNormal: Array.from(f32.slice(light1Base + 4, light1Base + 7))
}}));
"""
    payload = _run_node(script)
    assert payload["planePoint"] == pytest.approx([0.73, 2.17, 1.10], abs=1e-5)
    assert payload["planeNormal"] == pytest.approx([0.0, -1.0, 0.0], abs=1e-5)


def test_point_lights_do_not_use_target_as_planar_shadow_gate() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");

let wgpuSrc = fs.readFileSync({json.dumps(str(WGPU_JS))}, "utf8");
wgpuSrc = wgpuSrc.replace(
  "  global.VfGeomWgpuUtil = {{",
  "  global.__mirrorShadowGateTest = {{ shadowCasterPartsForLight: shadowCasterPartsForLight }};\\n  global.VfGeomWgpuUtil = {{"
);

const sandbox = {{
  console: {{ log() {{}}, warn() {{}}, error() {{}} }},
  Float32Array,
  Uint32Array,
  Math,
  setTimeout,
  clearTimeout,
}};
sandbox.window = sandbox;

vm.runInNewContext(fs.readFileSync({json.dumps(str(MATH_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-math.js" }});
vm.runInNewContext(wgpuSrc, sandbox, {{ filename: "vf-geom-wgpu.js" }});

const mirror = {{
  id: "back_mirror",
  kind: "quad",
  center: [0.73, 2.17, 1.10],
  size: [2.60, 2.20],
  rotation: [90.0, 0.0, 0.0],
  vertices: new Float32Array([
    -1.30, -1.10, 0.0,  0,0,1,  1,1,1,1,
     1.30, -1.10, 0.0,  0,0,1,  1,1,1,1,
     1.30,  1.10, 0.0,  0,0,1,  1,1,1,1,
    -1.30,  1.10, 0.0,  0,0,1,  1,1,1,1
  ]),
  casts_shadow: true,
  surface_system: {{ kind: "screen", reverse_facing: true }}
}};
const light = {{
  kind: "point",
  pos: [2.4, -3.2, 4.2],
  target: [0.0, 0.4, 0.9]
}};
const casters = sandbox.__mirrorShadowGateTest.shadowCasterPartsForLight([{{ mesh: mirror }}], light, 0);
process.stdout.write(JSON.stringify({{ count: casters.length, id: casters[0] && casters[0].mesh.id }}));
"""
    payload = _run_node(script)
    assert payload == {"count": 1, "id": "back_mirror"}


def test_reflected_projected_light_starts_on_visible_side_of_mirror() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");

let wgpuSrc = fs.readFileSync({json.dumps(str(WGPU_JS))}, "utf8");
wgpuSrc = wgpuSrc.replace(
  "  global.VfGeomWgpuUtil = {{",
  "  global.__mirrorLightTest = {{ resolveSceneLights: resolveSceneLights }};\\n  global.VfGeomWgpuUtil = {{"
);

const sandbox = {{
  console: {{ log() {{}}, warn() {{}}, error() {{}} }},
  Float32Array,
  Uint32Array,
  Math,
  setTimeout,
  clearTimeout,
}};
sandbox.window = sandbox;

vm.runInNewContext(fs.readFileSync({json.dumps(str(MATH_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-math.js" }});
vm.runInNewContext(wgpuSrc, sandbox, {{ filename: "vf-geom-wgpu.js" }});

const lights = [
  {{ id: "real", kind: "point", pos: [0, 0, 1], target: [0, 0, 0], intensity: 1 }},
  {{
    id: "virtual",
    kind: "projected",
    reflect_of_light_id: "real",
    reflect_mirror_mesh_id: "mirror",
    aperture_mesh_id: "mirror",
    clip_epsilon_ratio: 0.001,
    intensity: 1
  }}
];
const mesh = {{
  parts: [
    {{ id: "mirror", kind: "quad", center: [0, 0, 0], size: [2, 2], rotation: [0, 0, 0] }}
  ]
}};

const resolved = sandbox.__mirrorLightTest.resolveSceneLights(lights, mesh, 0)[1];
process.stdout.write(JSON.stringify({{
  pos: resolved.pos,
  planePoint: resolved.projected_aperture.plane_point,
  planeNormal: resolved.projected_aperture.plane_normal
}}));
"""
    payload = _run_node(script)
    assert payload["pos"] == pytest.approx([0.0, 0.0, -1.0])
    assert payload["planeNormal"] == pytest.approx([0.0, 0.0, 1.0])
    assert payload["planePoint"] == pytest.approx([0.0, 0.0, 0.0])


def test_wgpu_light_orbit_accepts_native_scene_radius_alias() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");

let wgpuSrc = fs.readFileSync({json.dumps(str(WGPU_JS))}, "utf8");
wgpuSrc = wgpuSrc.replace(
  "  global.VfGeomWgpuUtil = {{",
  "  global.__mirrorLightTest = {{ resolveSceneLights: resolveSceneLights }};\\n  global.VfGeomWgpuUtil = {{"
);

const sandbox = {{
  console: {{ log() {{}}, warn() {{}}, error() {{}} }},
  Float32Array,
  Uint32Array,
  Math,
  setTimeout,
  clearTimeout,
}};
sandbox.window = sandbox;

vm.runInNewContext(fs.readFileSync({json.dumps(str(MATH_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-math.js" }});
vm.runInNewContext(wgpuSrc, sandbox, {{ filename: "vf-geom-wgpu.js" }});

const resolved = sandbox.__mirrorLightTest.resolveSceneLights([
  {{
    id: "real_light",
    kind: "point",
    motion: "orbit",
    radius: 4.35,
    height: 3.30,
    theta: -0.98,
    angular_velocity: 0.55,
    target: [0.0, 0.4, 0.9],
    intensity: 22.0
  }}
], {{ parts: [] }}, 0)[0];

process.stdout.write(JSON.stringify({{ pos: resolved.pos }}));
"""
    payload = _run_node(script)
    assert payload["pos"] == pytest.approx([2.423048078433045, -3.2126635616400714, 4.2])


def test_wgpu_light_resolver_preserves_native_scene_per_frame_position() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");

let wgpuSrc = fs.readFileSync({json.dumps(str(WGPU_JS))}, "utf8");
wgpuSrc = wgpuSrc.replace(
  "  global.VfGeomWgpuUtil = {{",
  "  global.__mirrorLightTest = {{ resolveSceneLights: resolveSceneLights }};\\n  global.VfGeomWgpuUtil = {{"
);

const sandbox = {{
  console: {{ log() {{}}, warn() {{}}, error() {{}} }},
  Float32Array,
  Uint32Array,
  Math,
  setTimeout,
  clearTimeout,
}};
sandbox.window = sandbox;

vm.runInNewContext(fs.readFileSync({json.dumps(str(MATH_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-math.js" }});
vm.runInNewContext(wgpuSrc, sandbox, {{ filename: "vf-geom-wgpu.js" }});

const resolved = sandbox.__mirrorLightTest.resolveSceneLights([
  {{
    id: "real_light",
    kind: "point",
    motion: "orbit",
    pos: [9.0, 8.0, 7.0],
    radius: 4.35,
    height: 3.30,
    theta: -0.98,
    angular_velocity: 0.55,
    target: [0.0, 0.4, 0.9],
    intensity: 22.0
  }}
], {{ parts: [] }}, 5000)[0];

process.stdout.write(JSON.stringify({{ pos: resolved.pos }}));
"""
    payload = _run_node(script)
    assert payload["pos"] == pytest.approx([9.0, 8.0, 7.0])


def test_reflected_projected_light_does_not_reflect_from_backside() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");

let wgpuSrc = fs.readFileSync({json.dumps(str(WGPU_JS))}, "utf8");
wgpuSrc = wgpuSrc.replace(
  "  global.VfGeomWgpuUtil = {{",
  "  global.__mirrorLightTest = {{ resolveSceneLights: resolveSceneLights }};\\n  global.VfGeomWgpuUtil = {{"
);

const sandbox = {{
  console: {{ log() {{}}, warn() {{}}, error() {{}} }},
  Float32Array,
  Uint32Array,
  Math,
  setTimeout,
  clearTimeout,
}};
sandbox.window = sandbox;

vm.runInNewContext(fs.readFileSync({json.dumps(str(MATH_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-math.js" }});
vm.runInNewContext(wgpuSrc, sandbox, {{ filename: "vf-geom-wgpu.js" }});

const lights = [
  {{ id: "real", kind: "point", pos: [0, 0, -1], target: [0, 0, 0], intensity: 1 }},
  {{
    id: "virtual",
    kind: "projected",
    reflect_of_light_id: "real",
    reflect_mirror_mesh_id: "mirror",
    aperture_mesh_id: "mirror",
    clip_epsilon_ratio: 0.001,
    intensity: 1,
    power: 2
  }}
];
const mesh = {{
  parts: [
    {{ id: "mirror", kind: "quad", center: [0, 0, 0], size: [2, 2], rotation: [0, 0, 0] }}
  ]
}};

const resolved = sandbox.__mirrorLightTest.resolveSceneLights(lights, mesh, 0)[1];
process.stdout.write(JSON.stringify({{
  intensity: resolved.intensity,
  power: resolved.power,
  casts_shadow: resolved.casts_shadow,
  planePoint: resolved.projected_aperture.plane_point,
  planeNormal: resolved.projected_aperture.plane_normal
}}));
"""
    payload = _run_node(script)
    assert payload["intensity"] == pytest.approx(0.0)
    assert payload["power"] == pytest.approx(0.0)
    assert payload["casts_shadow"] is False
    assert payload["planeNormal"] == pytest.approx([0.0, 0.0, 1.0])
    assert payload["planePoint"] == pytest.approx([0.0, 0.0, 0.0])


def test_reflected_light_uses_rendered_part_plane_over_source_spec() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");

let wgpuSrc = fs.readFileSync({json.dumps(str(WGPU_JS))}, "utf8");
wgpuSrc = wgpuSrc.replace(
  "  global.VfGeomWgpuUtil = {{",
  "  global.__mirrorLightTest = {{ resolveSceneLights: resolveSceneLights }};\\n  global.VfGeomWgpuUtil = {{"
);

const sandbox = {{
  console: {{ log() {{}}, warn() {{}}, error() {{}} }},
  Float32Array,
  Uint32Array,
  Math,
  setTimeout,
  clearTimeout,
}};
sandbox.window = sandbox;

vm.runInNewContext(fs.readFileSync({json.dumps(str(MATH_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-math.js" }});
vm.runInNewContext(wgpuSrc, sandbox, {{ filename: "vf-geom-wgpu.js" }});

const lights = [
  {{ id: "real", kind: "point", pos: [0, 0, 1], target: [0, 1, 0], intensity: 1 }},
  {{
    id: "virtual",
    kind: "projected",
    reflect_of_light_id: "real",
    reflect_mirror_mesh_id: "mirror",
    aperture_mesh_id: "mirror",
    clip_epsilon_ratio: 0.001,
    intensity: 1
  }}
];
const mesh = {{
  source_specs: [
    {{ id: "mirror", kind: "quad", center: [0, 0, 0], size: [2, 2], rotation: [90, 0, 0] }}
  ],
  parts: [
    {{ id: "mirror", kind: "quad", center: [0, 2, 0], size: [2, 2], rotation: [90, 0, 0], surface_system: {{ kind: "screen", reverse_facing: true }} }}
  ]
}};

const resolved = sandbox.__mirrorLightTest.resolveSceneLights(lights, mesh, 0)[1];
process.stdout.write(JSON.stringify({{
  intensity: resolved.intensity,
  planePoint: resolved.projected_aperture.plane_point,
  planeNormal: resolved.projected_aperture.plane_normal
}}));
"""
    payload = _run_node(script)
    assert payload["intensity"] == pytest.approx(1.0)
    assert payload["planeNormal"] == pytest.approx([0.0, -1.0, 0.0])
    assert payload["planePoint"][1] == pytest.approx(2.0)


def test_reflected_light_rejects_source_spec_only_mirror_plane() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");

let wgpuSrc = fs.readFileSync({json.dumps(str(WGPU_JS))}, "utf8");
wgpuSrc = wgpuSrc.replace(
  "  global.VfGeomWgpuUtil = {{",
  "  global.__mirrorLightTest = {{ resolveSceneLights: resolveSceneLights }};\\n  global.VfGeomWgpuUtil = {{"
);

const sandbox = {{
  console: {{ log() {{}}, warn() {{}}, error() {{}} }},
  Float32Array,
  Uint32Array,
  Math,
  setTimeout,
  clearTimeout,
}};
sandbox.window = sandbox;

vm.runInNewContext(fs.readFileSync({json.dumps(str(MATH_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-math.js" }});
vm.runInNewContext(wgpuSrc, sandbox, {{ filename: "vf-geom-wgpu.js" }});

const lights = [
  {{ id: "real", kind: "point", pos: [0, -4, 1], target: [0, -1, 0], intensity: 1 }},
  {{
    id: "virtual",
    kind: "projected",
    reflect_of_light_id: "real",
    reflect_mirror_mesh_id: "mirror",
    aperture_mesh_id: "mirror",
    clip_epsilon_ratio: 0.001,
    intensity: 1
  }}
];
const mesh = {{
  source_specs: [
    {{ id: "mirror", kind: "quad", center: [0, 0, 0], size: [2, 2], rotation: [90, 0, 0] }}
  ],
  parts: []
}};

try {{
  sandbox.__mirrorLightTest.resolveSceneLights(lights, mesh, 0);
  process.stdout.write(JSON.stringify({{ ok: false }}));
}} catch (err) {{
  process.stdout.write(JSON.stringify({{ ok: true, message: String(err && err.message || err) }}));
}}
"""
    payload = _run_node(script)
    assert payload["ok"] is True
    assert "rendered scene parts" in payload["message"]


def test_projected_light_does_not_illuminate_its_aperture_mesh() -> None:
    shader = WGPU_JS.read_text(encoding="utf-8")
    assert "function lightsForMesh(rawLights, offscreenFrame, meshLike)" in shader
    assert 'kind === "projected" && (apertureMeshId === meshId || mirrorMeshId === meshId)' in shader
    assert "lightsForMesh((partMesh.lights || sceneMesh.lights || []), this._offscreenFrame === true, partMesh)" in shader


def test_screen_surface_uses_depth_shadow_not_infinite_contact_shadow() -> None:
    shader = WGPU_JS.read_text(encoding="utf-8")
    contact_fn_start = shader.index("function planarContactParts(parts)")
    contact_fn_end = shader.index("function modelMatrixSignature(model)")
    contact_fn = shader[contact_fn_start:contact_fn_end]
    assert "if (isPlanarScreenShadowSurface(mesh)) { continue; }" in contact_fn
    occluder_fn = shader[shader.index("function buildPlanarContactOccluder"):shader.index("function resolvePlanarContactOccluderForLight")]
    assert "if (isPlanarScreenShadowSurface(meshLike)) { return null; }" in occluder_fn
    assert "1.0e6" not in occluder_fn


def test_screen_surface_shadow_casting_is_gated_by_light_side() -> None:
    shader = WGPU_JS.read_text(encoding="utf-8")
    assert "function isPlanarScreenShadowSurface(meshLike)" in shader
    assert "function meshReverseFacing(meshLike)" in shader
    assert "meshLike && meshLike.reverse_facing === true" in shader
    assert "function canPlanarSurfaceCastShadowForLight(meshLike, light, t)" in shader
    assert "meshLike.no_backface_specular === true && meshLike.receives_shadow === false" in shader
    assert "return lightSide * targetSide < 0.0;" in shader
    caster_fn = shader[shader.index("function shadowCasterParts"):shader.index("function planarContactParts")]
    assert "if (isPlanarScreenShadowSurface(mesh))" not in caster_fn
    assert "function shadowCasterPartsForLight(casterParts, light, t)" in shader
    assert "canPlanarSurfaceCastShadowForLight(casterMesh, light, t)" in shader
    assert "drawShadowPass(this, 0, shadowState0.shadow, shadowState0.casterParts || [])" in shader


def test_planar_shadow_frame_does_not_double_flip_reverse_facing() -> None:
    shader = WGPU_JS.read_text(encoding="utf-8")
    fn = shader[shader.index("function planarFrameForShadowMesh"):shader.index("function buildPlanarContactOccluder")]
    assert 'createPlanarMirrorRuntime(meshLike, t, "planar shadow frame")' in fn
    assert "meshReverseFacing(meshLike)" not in fn


def test_planar_mirror_geometry_uses_rendered_surface_normal_not_reverse_facing_flag() -> None:
    shader = WGPU_JS.read_text(encoding="utf-8")
    fn = shader[shader.index("function mirrorFrameForLightMesh"):shader.index("function resolveLinkedMirrorLight")]
    assert "meshReverseFacing(meshLike)" not in fn
    assert "scaleVec3(frame.normal, -1.0)" not in fn


def test_surface_camera_paths_use_rendered_part_not_authored_mesh() -> None:
    shader = WGPU_JS.read_text(encoding="utf-8")
    render_fn = shader[shader.index("_buildPlanarSurfaceRenderCamera: function"):shader.index("_ensureShadowTarget")]
    assert "resolveSceneMeshById" not in render_fn
    aperture_fn = shader[shader.index("_buildPlanarSurfaceApertureCamera: function"):shader.index("_buildMirrorEyeLockedCamera")]
    assert "resolveSceneMeshById" not in aperture_fn
    assert "part: part" in render_fn
    assert "part: part" in aperture_fn


def test_point_light_shadow_fit_aims_at_caster_bounds_not_light_target() -> None:
    shader = WGPU_JS.read_text(encoding="utf-8")
    fn = shader[shader.index("function fitShadowViewProjection"):shader.index("function meshTiming")]
    assert 'if (normalizeLightKind(light.kind) === "point")' in fn
    assert "for (var centerIndex = 0; centerIndex < worldPoints.length; centerIndex += 1)" in fn
    assert "target = scaleVec3(target, 1.0 / Math.max(1, worldPoints.length));" in fn


def test_native_linked_camera_uses_rendered_mirror_payload() -> None:
    source = NATIVE_SCENE_JS.read_text(encoding="utf-8")
    assert "function renderedMirrorPartForCamera" in source
    assert "var mirrorPart = renderedMirrorPartForCamera(mirrorMesh, sourceCamera, \"linked reflected camera\");" in source
    assert "var mirrorPart = renderedMirrorPartForCamera(mirrorMesh, baseCamera, \"aperture camera\");" in source
    linked_fn = source[source.index("function resolveLinkedMirrorCamera"):source.index("function resolveMirrorApertureCamera")]
    assert "part: { mesh: mirrorMesh }" not in linked_fn
    assert "part: mirrorPart" in linked_fn


def test_native_scene_does_not_precompute_mirror_light_planes() -> None:
    source = NATIVE_SCENE_JS.read_text(encoding="utf-8")
    assert "function quadApertureFrame(mesh)" not in source
    assert "function resolveLinkedMirrorLight" not in source
    assert "function resolveProjectedLightSpec" not in source
    assert "projected_aperture" not in source


def test_mirror_light_paths_fail_loudly_instead_of_falling_back() -> None:
    native_source = NATIVE_SCENE_JS.read_text(encoding="utf-8")
    assert "resolveProjectedLightSpec(resolveLinkedMirrorLight" not in native_source

    wgpu_source = WGPU_JS.read_text(encoding="utf-8")
    wgpu_light_fn = wgpu_source[wgpu_source.index("function resolveLinkedMirrorLight"):wgpu_source.index("function resolveProjectedLightFromMeshId")]
    assert "reflected light requires both reflect_of_light_id and reflect_mirror_mesh_id" in wgpu_light_fn
    assert 'reflected light source "' in wgpu_light_fn
    geometry_fn = wgpu_source[wgpu_source.index("function resolvePlanarMirrorGeometry"):wgpu_source.index("function orientMirrorBasisForEye")]
    assert 'did not produce a canonical planar frame' in geometry_fn
    assert "if (!sourceLight) { return lightSpec; }" not in wgpu_light_fn
    assert "if (!frame) { return lightSpec; }" not in wgpu_light_fn


def test_planar_mirror_uniform_packets_never_fallback_to_origin() -> None:
    wgpu_source = WGPU_JS.read_text(encoding="utf-8")
    assert "function requirePlanarPacket(packet, label)" in wgpu_source

    contact_fn = wgpu_source[wgpu_source.index("function writePlanarContactOccluder"):wgpu_source.index("writePlanarContactOccluder(76")]
    assert 'requirePlanarPacket(occluder, "planar contact occluder")' in contact_fn
    assert "occluder.plane_point) ? occluder.plane_point : [0.0, 0.0, 0.0]" not in contact_fn
    assert "occluder.points) ? occluder.points : []" not in contact_fn

    aperture_fn = wgpu_source[wgpu_source.index("function writeLightAperture"):wgpu_source.index("writeLightAperture(0")]
    assert 'requirePlanarPacket(aperture, "projected light aperture")' in aperture_fn
    assert "aperture.plane_point) ? aperture.plane_point : [0.0, 0.0, 0.0]" not in aperture_fn
    assert "aperture.points) ? aperture.points : []" not in aperture_fn

    shadow_fit_fn = wgpu_source[wgpu_source.index("function fitShadowViewProjection"):wgpu_source.index("function meshTiming")]
    assert 'requirePlanarPacket(aperture, "projected shadow aperture")' in shadow_fit_fn
    assert "vec3Or(aperture.plane_point, [0.0, 0.0, 0.0])" not in shadow_fit_fn


def test_reflected_light_shadow_fit_excludes_its_aperture_mesh() -> None:
    wgpu_source = WGPU_JS.read_text(encoding="utf-8")
    helper_fn = wgpu_source[wgpu_source.index("function shadowCasterPartsForLight"):wgpu_source.index("function isPlanarScreenShadowSurface")]
    assert "light.projected_aperture.mesh_id" in helper_fn
    assert 'String(casterMesh.id || "") === apertureCasterId' in helper_fn
    assert "canPlanarSurfaceCastShadowForLight(casterMesh, light, t)" in helper_fn

    shadow_prepare_fn = wgpu_source[wgpu_source.index("var prepareLightShadow = function"):wgpu_source.index("var shadowState0 = prepareLightShadow")]
    assert "var lightCasterParts = shadowCasterPartsForLight(casterParts, light, t);" in shadow_prepare_fn
    assert "canPlanarSurfaceCastShadowForLight(casterPart && casterPart.mesh, light, t)" not in shadow_prepare_fn


def test_surface_local_bounds_use_mesh_local_origin_space() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");

const sandbox = {{
  console: {{ log() {{}}, warn() {{}}, error() {{}} }},
  Float32Array,
  Uint32Array,
  Math,
  setTimeout,
  clearTimeout,
}};
sandbox.window = sandbox;

vm.runInNewContext(fs.readFileSync({json.dumps(str(MATH_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-math.js" }});
vm.runInNewContext(fs.readFileSync({json.dumps(str(WGPU_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-wgpu.js" }});

const bounds = sandbox.VfGeomWgpuUtil.surfaceLocalBounds({{
  vertices: new Float32Array([
    -3.5, -3.5, 0,  0,0,1,  1,1,1,1,
     3.5, -3.5, 0,  0,0,1,  1,1,1,1,
     3.5,  3.5, 0,  0,0,1,  1,1,1,1,
    -3.5,  3.5, 0,  0,0,1,  1,1,1,1
  ])
}});

process.stdout.write(JSON.stringify(bounds));
"""
    payload = _run_node(script)
    assert payload["minX"] == pytest.approx(-3.5)
    assert payload["minY"] == pytest.approx(-3.5)
    assert payload["spanX"] == pytest.approx(7.0)
    assert payload["spanY"] == pytest.approx(7.0)


def test_planar_mirror_adapter_reflects_camera_across_floor_plane() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");

const sandbox = {{
  console: {{ log() {{}}, warn() {{}}, error() {{}} }},
  Float32Array,
  Uint32Array,
  Math,
  setTimeout,
  clearTimeout,
}};
sandbox.window = sandbox;

vm.runInNewContext(fs.readFileSync({json.dumps(str(MATH_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-math.js" }});
vm.runInNewContext(fs.readFileSync({json.dumps(str(WGPU_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-wgpu.js" }});

const adapter = sandbox.VfGeomWgpuUtil.createPlanarMirrorAdapter();
const camera = adapter.buildRenderCamera({{
  part: {{
    mesh: {{
      center: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      vertices: new Float32Array([
        -1, -1, 0,  0,0,1,  1,1,1,1,
         1, -1, 0,  0,0,1,  1,1,1,1,
        -1,  1, 0,  0,0,1,  1,1,1,1,
         1,  1, 0,  0,0,1,  1,1,1,1
      ])
    }}
  }},
  surfaceCamera: {{
    pos: [1, 2, 3],
    target: [0, 0, 0],
    up: [0, 0, 1],
    fov: 45
  }},
  timeMs: 0,
  targetAspect: 1.5,
  math: sandbox.VfGeomMath
}});

process.stdout.write(JSON.stringify(camera));
    """
    payload = _run_node(script)
    assert payload["pos"] == pytest.approx([1.0, 2.0, -3.0])
    assert payload["_mirrorDebug"]["reflectedTarget"] == pytest.approx([0.0, 0.0, 0.0])
    assert payload["target"] == pytest.approx([1.0, 2.0, -2.0])
    assert payload["up"] == pytest.approx([0.0, 1.0, 0.0])
    assert len(payload["view_matrix"]) == 16
    assert len(payload["projection_matrix"]) == 16
    assert len(payload["_mirrorViewProjection"]) == 16


def test_planar_mirror_adapter_pushes_mirror_plane_to_near_clip() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");

const sandbox = {{
  console: {{ log() {{}}, warn() {{}}, error() {{}} }},
  Float32Array,
  Uint32Array,
  Math,
  setTimeout,
  clearTimeout,
}};
sandbox.window = sandbox;

vm.runInNewContext(fs.readFileSync({json.dumps(str(MATH_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-math.js" }});
vm.runInNewContext(fs.readFileSync({json.dumps(str(WGPU_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-wgpu.js" }});

function mulPoint(m, p) {{
  return [
    (m[0] * p[0]) + (m[4] * p[1]) + (m[8] * p[2]) + m[12],
    (m[1] * p[0]) + (m[5] * p[1]) + (m[9] * p[2]) + m[13],
    (m[2] * p[0]) + (m[6] * p[1]) + (m[10] * p[2]) + m[14],
    (m[3] * p[0]) + (m[7] * p[1]) + (m[11] * p[2]) + m[15]
  ];
}}

const adapter = sandbox.VfGeomWgpuUtil.createPlanarMirrorAdapter();
const camera = adapter.buildRenderCamera({{
  part: {{
    mesh: {{
      center: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      vertices: new Float32Array([
        -2, -2, 0,  0,0,1,  1,1,1,1,
         2, -2, 0,  0,0,1,  1,1,1,1,
        -2,  2, 0,  0,0,1,  1,1,1,1,
         2,  2, 0,  0,0,1,  1,1,1,1
      ])
    }}
  }},
  surfaceCamera: {{
    pos: [2.5, -4.0, 3.0],
    target: [0, 0, 0.5],
    up: [0, 0, 1],
    fov: 36
  }},
  timeMs: 0,
  targetAspect: 1.0,
  math: sandbox.VfGeomMath
}});

const clip = mulPoint(camera._mirrorViewProjection, [0, 0, 0]);
process.stdout.write(JSON.stringify({{
  ndcZ: clip[2] / clip[3],
  clipW: clip[3]
}}));
"""
    payload = _run_node(script)
    assert payload["clipW"] > 0.0
    assert payload["ndcZ"] == pytest.approx(0.0, abs=5e-4)


def test_planar_mirror_adapter_fits_wall_mirror_corners_into_projector() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");

const sandbox = {{
  console,
  Float32Array,
  Uint32Array,
  Math,
  setTimeout,
  clearTimeout,
}};
sandbox.window = sandbox;

vm.runInNewContext(fs.readFileSync({json.dumps(str(MATH_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-math.js" }});
vm.runInNewContext(fs.readFileSync({json.dumps(str(WGPU_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-wgpu.js" }});

function mulPoint(m, p) {{
  return [
    (m[0] * p[0]) + (m[4] * p[1]) + (m[8] * p[2]) + m[12],
    (m[1] * p[0]) + (m[5] * p[1]) + (m[9] * p[2]) + m[13],
    (m[2] * p[0]) + (m[6] * p[1]) + (m[10] * p[2]) + m[14],
    (m[3] * p[0]) + (m[7] * p[1]) + (m[11] * p[2]) + m[15]
  ];
}}

const adapter = sandbox.VfGeomWgpuUtil.createPlanarMirrorAdapter();
const camera = adapter.buildRenderCamera({{
  part: {{
    mesh: {{
      center: [0, 3.5, 3.5],
      rotation: [90, 0, 0],
      scale: [1, 1, 1],
      vertices: new Float32Array([
        -3.5, -3.5, 0,  0,0,1,  1,1,1,1,
         3.5, -3.5, 0,  0,0,1,  1,1,1,1,
        -3.5,  3.5, 0,  0,0,1,  1,1,1,1,
         3.5,  3.5, 0,  0,0,1,  1,1,1,1
      ])
    }}
  }},
  surfaceCamera: {{
    pos: [0.0, -4.45, 3.2],
    target: [0.0, 1.4, 1.0],
    up: [0.0, 0.0, 1.0],
    fov: 34
  }},
  timeMs: 0,
  targetAspect: 1.0,
  math: sandbox.VfGeomMath
}});

const corners = [
  [-3.5, 3.5, 0.0],
  [ 3.5, 3.5, 0.0],
  [-3.5, 3.5, 7.0],
  [ 3.5, 3.5, 7.0]
].map((p) => {{
  const clip = mulPoint(camera._mirrorViewProjection, p);
  return [clip[0] / clip[3], clip[1] / clip[3], clip[2] / clip[3]];
}});

process.stdout.write(JSON.stringify({{ corners }}));
"""
    payload = _run_node(script)
    xs = [c[0] for c in payload["corners"]]
    ys = [c[1] for c in payload["corners"]]
    zs = [c[2] for c in payload["corners"]]
    assert min(xs) == pytest.approx(-1.0, abs=5e-3)
    assert max(xs) == pytest.approx(1.0, abs=5e-3)
    assert min(ys) == pytest.approx(-1.0, abs=5e-3)
    assert max(ys) == pytest.approx(1.0, abs=5e-3)


def test_planar_mirror_adapter_matches_physical_wall_hit_mapping() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");

const sandbox = {{
  console,
  Float32Array,
  Uint32Array,
  Math,
  setTimeout,
  clearTimeout,
}};
sandbox.window = sandbox;

vm.runInNewContext(fs.readFileSync({json.dumps(str(MATH_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-math.js" }});
vm.runInNewContext(fs.readFileSync({json.dumps(str(WGPU_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-wgpu.js" }});

function mulPoint(m, p) {{
  return [
    (m[0] * p[0]) + (m[4] * p[1]) + (m[8] * p[2]) + m[12],
    (m[1] * p[0]) + (m[5] * p[1]) + (m[9] * p[2]) + m[13],
    (m[2] * p[0]) + (m[6] * p[1]) + (m[10] * p[2]) + m[14],
    (m[3] * p[0]) + (m[7] * p[1]) + (m[11] * p[2]) + m[15]
  ];
}}

function dot(a, b) {{
  return (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2]);
}}

function sub(a, b) {{
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}}

function add(a, b) {{
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}}

function scale(a, s) {{
  return [a[0] * s, a[1] * s, a[2] * s];
}}

function reflectPoint(point, planePoint, planeNormal) {{
  const delta = sub(point, planePoint);
  const dist = dot(delta, planeNormal);
  return sub(point, scale(planeNormal, 2.0 * dist));
}}

const util = sandbox.VfGeomWgpuUtil;
const math = sandbox.VfGeomMath;
const part = {{
  mesh: {{
    center: [0, 3.5, 3.5],
    rotation: [90, 0, 0],
    scale: [1, 1, 1],
    vertices: new Float32Array([
      -3.5, -3.5, 0,  0,0,1,  1,1,1,1,
       3.5, -3.5, 0,  0,0,1,  1,1,1,1,
       3.5,  3.5, 0,  0,0,1,  1,1,1,1,
      -3.5,  3.5, 0,  0,0,1,  1,1,1,1
    ])
  }}
}};

const frame = util.derivePlanarSurfaceWorldFrame(part, 0, math);
const adapter = util.createPlanarMirrorAdapter();
const eye = [-4.5, -4.0, 3.2];
const point = [-1.0, 0.0, 1.2];
const camera = adapter.buildRenderCamera({{
  part,
  surfaceCamera: {{
    pos: eye,
    target: [0.0, 1.4, 1.0],
    up: [0.0, 0.0, 1.0],
    fov: 34
  }},
  timeMs: 0,
  targetAspect: 1.0,
  math
}});

const clip = mulPoint(camera._mirrorViewProjection, point);
    const projectedUv = [
      (clip[0] / clip[3]) * 0.5 + 0.5,
      1.0 - (((clip[1] / clip[3]) * 0.5) + 0.5)
    ];
    if (camera._mirrorFlipU === true) {{
      projectedUv[0] = 1.0 - projectedUv[0];
    }}

const reflectedPoint = reflectPoint(point, frame.point, frame.normal);
const ray = sub(reflectedPoint, eye);
const t = dot(frame.normal, sub(frame.point, eye)) / dot(frame.normal, ray);
const hit = add(eye, scale(ray, t));
const rel = sub(hit, frame.point);
const u = dot(rel, frame.uAxis);
const v = dot(rel, frame.vAxis);
const physicalUv = [
  (u - frame.minU) / frame.spanU,
  1.0 - ((v - frame.minV) / frame.spanV)
];

process.stdout.write(JSON.stringify({{
  projectedUv,
  physicalUv
}}));
"""
    payload = _run_node(script)
    assert payload["projectedUv"][0] == pytest.approx(payload["physicalUv"][0], abs=1e-4)
    assert payload["projectedUv"][1] == pytest.approx(payload["physicalUv"][1], abs=1e-4)


def test_planar_mirror_adapter_camera_tuple_matches_view_matrix() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");

const sandbox = {{
  console,
  Float32Array,
  Uint32Array,
  Math,
  setTimeout,
  clearTimeout,
}};
sandbox.window = sandbox;

vm.runInNewContext(fs.readFileSync({json.dumps(str(MATH_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-math.js" }});
vm.runInNewContext(fs.readFileSync({json.dumps(str(WGPU_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-wgpu.js" }});

function dot(a, b) {{
  return (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2]);
}}

function cross(a, b) {{
  return [
    (a[1] * b[2]) - (a[2] * b[1]),
    (a[2] * b[0]) - (a[0] * b[2]),
    (a[0] * b[1]) - (a[1] * b[0])
  ];
}}

function sub(a, b) {{
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}}

function norm(v, fallback) {{
  const len = Math.hypot(v[0], v[1], v[2]);
  if (!(len > 1e-9)) {{
    return fallback.slice();
  }}
  return [v[0] / len, v[1] / len, v[2] / len];
}}

function mat4LookAt(eye, target, up) {{
  const z = norm(sub(eye, target), [0, 0, 1]);
  const x = norm(cross(up, z), [1, 0, 0]);
  const y = cross(z, x);
  return [
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1
  ];
}}

const adapter = sandbox.VfGeomWgpuUtil.createPlanarMirrorAdapter();
const camera = adapter.buildRenderCamera({{
  part: {{
    mesh: {{
      center: [0, 3.5, 3.5],
      rotation: [90, 0, 0],
      scale: [1, 1, 1],
      vertices: new Float32Array([
        -3.5, -3.5, 0,  0,0,1,  1,1,1,1,
         3.5, -3.5, 0,  0,0,1,  1,1,1,1,
         3.5,  3.5, 0,  0,0,1,  1,1,1,1,
        -3.5,  3.5, 0,  0,0,1,  1,1,1,1
      ])
    }}
  }},
  surfaceCamera: {{
    pos: [-6.0, 2.0, 3.2],
    target: [0.0, 3.5, 3.5],
    up: [0.0, 0.0, 1.0],
    fov: 34
  }},
  timeMs: 0,
  targetAspect: 1.0,
  math: sandbox.VfGeomMath
}});

const tupleView = mat4LookAt(camera.pos, camera.target, camera.up);
let maxErr = 0.0;
for (let i = 0; i < 16; i += 1) {{
  maxErr = Math.max(maxErr, Math.abs(Number(camera.view_matrix[i] || 0.0) - Number(tupleView[i] || 0.0)));
}}

process.stdout.write(JSON.stringify({{ maxErr }}));
"""
    payload = _run_node(script)
    assert payload["maxErr"] == pytest.approx(0.0, abs=1e-5)


def test_mirror_plane_intersection_line_stays_fixed_across_viewers() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");

const sandbox = {{
  console,
  Float32Array,
  Uint32Array,
  Math,
  setTimeout,
  clearTimeout,
}};
sandbox.window = sandbox;

vm.runInNewContext(fs.readFileSync({json.dumps(str(MATH_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-math.js" }});
vm.runInNewContext(fs.readFileSync({json.dumps(str(WGPU_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-wgpu.js" }});

function mulPoint(m, p) {{
  return [
    (m[0] * p[0]) + (m[4] * p[1]) + (m[8] * p[2]) + m[12],
    (m[1] * p[0]) + (m[5] * p[1]) + (m[9] * p[2]) + m[13],
    (m[2] * p[0]) + (m[6] * p[1]) + (m[10] * p[2]) + m[14],
    (m[3] * p[0]) + (m[7] * p[1]) + (m[11] * p[2]) + m[15]
  ];
}}

function dot(a, b) {{
  return (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2]);
}}

function sub(a, b) {{
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}}

const util = sandbox.VfGeomWgpuUtil;
const math = sandbox.VfGeomMath;
const part = {{
  mesh: {{
    center: [0, 3.5, 3.5],
    rotation: [90, 0, 0],
    scale: [1, 1, 1],
    vertices: new Float32Array([
      -3.5, -3.5, 0,  0,0,1,  1,1,1,1,
       3.5, -3.5, 0,  0,0,1,  1,1,1,1,
       3.5,  3.5, 0,  0,0,1,  1,1,1,1,
      -3.5,  3.5, 0,  0,0,1,  1,1,1,1
    ])
  }}
}};
const frame = util.derivePlanarSurfaceWorldFrame(part, 0, math);
const linePoints = [
  [-3.5, 3.5, 0.0],
  [0.0, 3.5, 0.0],
  [3.5, 3.5, 0.0]
];
const viewers = [
  {{ pos: [0.0, -4.45, 3.2], target: [0.0, 1.4, 1.0] }},
  {{ pos: [-6.0, 2.0, 3.2], target: [0.0, 3.5, 3.5] }},
  {{ pos: [-8.0, 3.1, 3.0], target: [0.0, 3.5, 3.5] }}
];

function physicalUv(point) {{
  const rel = sub(point, frame.point);
  const u = dot(rel, frame.uAxis);
  const v = dot(rel, frame.vAxis);
  return [
    (u - frame.minU) / frame.spanU,
    1.0 - ((v - frame.minV) / frame.spanV)
  ];
}}

const samples = viewers.map((viewer) => {{
  const camera = util.createPlanarMirrorAdapter().buildRenderCamera({{
    part,
    surfaceCamera: {{
      pos: viewer.pos,
      target: viewer.target,
      up: [0.0, 0.0, 1.0],
      fov: 34
    }},
    timeMs: 0,
    targetAspect: 1.0,
    math
  }});
  return linePoints.map((point) => {{
    const clip = mulPoint(camera._mirrorViewProjection, point);
    const uv = [
      (clip[0] / clip[3]) * 0.5 + 0.5,
      1.0 - (((clip[1] / clip[3]) * 0.5) + 0.5)
    ];
    if (camera._mirrorFlipU === true) {{
      uv[0] = 1.0 - uv[0];
    }}
    return {{ uv, expected: physicalUv(point) }};
  }});
}});

process.stdout.write(JSON.stringify({{ samples }}));
"""
    payload = _run_node(script)
    samples = payload["samples"]
    baseline = samples[0]
    for viewer_samples in samples:
        for idx, sample in enumerate(viewer_samples):
            assert sample["uv"][0] == pytest.approx(sample["expected"][0], abs=1e-4)
            assert sample["uv"][1] == pytest.approx(sample["expected"][1], abs=1e-4)
            assert sample["uv"][0] == pytest.approx(baseline[idx]["uv"][0], abs=1e-4)
            assert sample["uv"][1] == pytest.approx(baseline[idx]["uv"][1], abs=1e-4)


def test_wall_mirror_visual_up_maps_floor_seam_to_bottom_edge() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");

const sandbox = {{
  console,
  Float32Array,
  Uint32Array,
  Math,
  setTimeout,
  clearTimeout,
}};
sandbox.window = sandbox;

vm.runInNewContext(fs.readFileSync({json.dumps(str(MATH_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-math.js" }});
vm.runInNewContext(fs.readFileSync({json.dumps(str(WGPU_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-wgpu.js" }});

function mulPoint(m, p) {{
  return [
    (m[0] * p[0]) + (m[4] * p[1]) + (m[8] * p[2]) + m[12],
    (m[1] * p[0]) + (m[5] * p[1]) + (m[9] * p[2]) + m[13],
    (m[2] * p[0]) + (m[6] * p[1]) + (m[10] * p[2]) + m[14],
    (m[3] * p[0]) + (m[7] * p[1]) + (m[11] * p[2]) + m[15]
  ];
}}

const adapter = sandbox.VfGeomWgpuUtil.createPlanarMirrorAdapter();
const camera = adapter.buildRenderCamera({{
  part: {{
    mesh: {{
      center: [0, 3.5, 3.5],
      rotation: [90, 0, 0],
      scale: [1, 1, 1],
      vertices: new Float32Array([
        -3.5, -3.5, 0,  0,0,1,  1,1,1,1,
         3.5, -3.5, 0,  0,0,1,  1,1,1,1,
         3.5,  3.5, 0,  0,0,1,  1,1,1,1,
        -3.5,  3.5, 0,  0,0,1,  1,1,1,1
      ])
    }}
  }},
  surfaceCamera: {{
    pos: [0.0, -4.45, 3.2],
    target: [0.0, 1.4, 1.0],
    up: [0.0, 0.0, 1.0],
    fov: 34
  }},
  timeMs: 0,
  targetAspect: 1.0,
  math: sandbox.VfGeomMath
}});

function mirrorUv(point) {{
  const clip = mulPoint(camera._mirrorViewProjection, point);
  let uv = [
    (clip[0] / clip[3]) * 0.5 + 0.5,
    1.0 - (((clip[1] / clip[3]) * 0.5) + 0.5)
  ];
  if (camera._mirrorFlipU === true) {{
    uv[0] = 1.0 - uv[0];
  }}
  if (camera._mirrorFlipV === true) {{
    uv[1] = 1.0 - uv[1];
  }}
  return uv;
}}

process.stdout.write(JSON.stringify({{
  seamUv: mirrorUv([0.0, 3.5, 0.0]),
  topUv: mirrorUv([0.0, 3.5, 7.0])
}}));
"""
    payload = _run_node(script)
    assert payload["seamUv"][1] == pytest.approx(1.0, abs=5e-3)
    assert payload["topUv"][1] == pytest.approx(0.0, abs=5e-3)


def test_expanded_seam_edge_stays_on_true_seam_under_reflected_camera() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const sandbox = {{
  console: {{ log() {{}}, warn() {{}}, error() {{}} }},
  Float32Array,
  Uint32Array,
  Uint8Array,
  Uint8ClampedArray,
  Math,
  Date,
  setTimeout,
  clearTimeout,
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {{}},
  addEventListener: () => {{}},
  dispatchEvent: () => {{}},
  fetch: async () => ({{ ok: true }}),
  CustomEvent: function(name, init) {{
    this.type = name;
    this.detail = init && init.detail;
  }},
}};
sandbox.window = sandbox;
sandbox.document = {{
  activeElement: null,
  querySelector: () => null,
  addEventListener: () => {{}},
  createElement: () => ({{
    style: {{}},
    setAttribute() {{}},
    appendChild() {{}},
    querySelector() {{ return null; }},
    closest() {{ return null; }},
    classList: {{ add() {{}}, remove() {{}}, contains() {{ return false; }}, toggle() {{}} }},
  }}),
  head: {{ appendChild() {{}} }},
  body: {{ appendChild() {{}}, querySelector() {{ return null; }} }},
  documentElement: {{ appendChild() {{}} }},
}};

vm.runInNewContext(fs.readFileSync({json.dumps(str(MATH_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-math.js" }});
vm.runInNewContext(fs.readFileSync({json.dumps(str(CORE_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-core.js" }});
vm.runInNewContext(fs.readFileSync({json.dumps(str(WGPU_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-wgpu.js" }});
vm.runInNewContext(fs.readFileSync({json.dumps(str(DISPLAY_JS))}, "utf8"), sandbox, {{ filename: "vf-display.js" }});

const part = {{
  mesh: {{
    center: [0, 3.5, 3.5],
    rotation: [90, 0, 0],
    scale: [1, 1, 1],
    vertices: new Float32Array([
      -3.5, -3.5, 0,  0,0,1,  1,1,1,1,
       3.5, -3.5, 0,  0,0,1,  1,1,1,1,
       3.5,  3.5, 0,  0,0,1,  1,1,1,1,
      -3.5,  3.5, 0,  0,0,1,  1,1,1,1
    ])
  }}
}};
const camera = sandbox.VfGeomWgpuUtil.createPlanarMirrorAdapter().buildRenderCamera({{
  part,
  surfaceCamera: {{
    pos: [0.0, -4.45, 3.2],
    target: [0.0, 1.4, 1.0],
    up: [0.0, 0.0, 1.0],
    fov: 34
  }},
  timeMs: 0,
  targetAspect: 1.0,
  math: sandbox.VfGeomMath
}});

const seamSpec = {{
  id: "mirror_probe_edge",
  type: "field_mesh",
  topology: "line-list",
  vertices: new Float32Array([
    -3.5, 3.5, 0.0,  0,0,1,  0.12,0.82,0.22,1,
     3.5, 3.5, 0.0,  0,0,1,  0.12,0.82,0.22,1
  ]),
  indices: new Uint32Array([0, 1]),
  edge_width: 10.0,
  edge_caps: true
}};

const mesh = sandbox.VfDisplay.__test.buildSingleMesh(
  seamSpec,
  Object.assign({{}}, camera, {{ viewport_height_px: 1024 }}),
  []
);

let sumY = 0.0;
let sumZ = 0.0;
let count = 0;
for (let i = 0; i < mesh.vertices.length; i += 10) {{
  sumY += Number(mesh.vertices[i + 1] || 0.0);
  sumZ += Number(mesh.vertices[i + 2] || 0.0);
  count += 1;
}}

process.stdout.write(JSON.stringify({{
  centroidY: sumY / Math.max(1, count),
  centroidZ: sumZ / Math.max(1, count)
}}));
"""
    payload = _run_node(script)
    assert payload["centroidY"] == pytest.approx(3.5, abs=1e-3)
    assert payload["centroidZ"] == pytest.approx(0.0, abs=1e-3)


def test_aperture_camera_supports_quad_spec_without_vertex_buffer() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");

const sandbox = {{
  console: {{ log() {{}}, warn() {{}}, error() {{}} }},
  Float32Array,
  Uint32Array,
  Math,
  setTimeout,
  clearTimeout,
}};
sandbox.window = sandbox;

vm.runInNewContext(fs.readFileSync({json.dumps(str(MATH_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-math.js" }});
vm.runInNewContext(fs.readFileSync({json.dumps(str(WGPU_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-wgpu.js" }});

const camera = sandbox.VfGeomWgpuUtil.createPlanarMirrorAdapter().buildApertureCamera({{
  part: {{
    mesh: {{
      id: "quad_mm",
      kind: "quad",
      center: [0.0, 0.0, 0.0],
      size: [1.3333333, 1.3333333],
      rotation: [90.0, 0.0, 0.0]
    }}
  }},
  surfaceCamera: {{
    pos: [0.0, -6.0, 0.0],
    target: [0.0, 0.0, 0.0],
    up: [0.0, 0.0, 1.0],
    fov: 34.0
  }},
  timeMs: 0,
  targetAspect: 1.0,
  math: sandbox.VfGeomMath
}});

process.stdout.write(JSON.stringify({{
  viewMatrixLength: Array.isArray(camera.view_matrix) ? camera.view_matrix.length : 0,
  projectionMatrixLength: Array.isArray(camera.projection_matrix) ? camera.projection_matrix.length : 0,
  pos: camera.pos,
  target: camera.target
}}));
"""
    payload = _run_node(script)
    assert payload["viewMatrixLength"] == 16
    assert payload["projectionMatrixLength"] == 16
    assert payload["pos"] == pytest.approx([0.0, -6.0, 0.0])
    assert payload["target"][0] == pytest.approx(0.0, abs=1e-6)
    assert payload["target"][1] > payload["pos"][1]


def test_planar_mirror_target_dims_follow_live_frame_size() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");

const sandbox = {{
  console: {{ log() {{}}, warn() {{}}, error() {{}} }},
  Float32Array,
  Uint32Array,
  Math,
  setTimeout,
  clearTimeout,
}};
sandbox.window = sandbox;

vm.runInNewContext(fs.readFileSync({json.dumps(str(MATH_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-math.js" }});
vm.runInNewContext(fs.readFileSync({json.dumps(str(WGPU_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-wgpu.js" }});

const adapter = sandbox.VfGeomWgpuUtil.createPlanarMirrorAdapter();
const small = adapter.targetDims(640, 480);
const large = adapter.targetDims(1280, 960);
const clamped = adapter.targetDims(8192, 4096);

process.stdout.write(JSON.stringify({{ small, large, clamped }}));
"""
    payload = _run_node(script)
    assert payload["small"] == {"width": 640, "height": 480}
    assert payload["large"] == {"width": 1280, "height": 960}
    assert payload["clamped"] == {"width": 2048, "height": 2048}


def test_aperture_camera_missing_host_mesh_fails_loudly() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");

const sandbox = {{
  console: {{ log() {{}}, warn() {{}}, error() {{}} }},
  Float32Array,
  Uint32Array,
  Math,
  setTimeout,
  clearTimeout,
}};
sandbox.window = sandbox;
sandbox.document = {{
  readyState: "loading",
  addEventListener() {{}},
  querySelector() {{ return null; }}
}};

vm.runInNewContext(fs.readFileSync({json.dumps(str(MATH_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-math.js" }});
vm.runInNewContext(fs.readFileSync({json.dumps(str(WGPU_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-wgpu.js" }});

let sceneSrc = fs.readFileSync({json.dumps(str(REPO / "web" / "vf-ui" / "vf-native-scene.js"))}, "utf8");
sceneSrc = sceneSrc.replace(/\\}}\\)\\(typeof window !== "undefined" \\? window : this\\);\\s*$/, `
global.__sceneTest = {{
  resolveMirrorApertureCamera: resolveMirrorApertureCamera
}};
}})(typeof window !== "undefined" ? window : this);
`);

sandbox.__vfNativeSceneConfig = {{
  scene_ir: {{
    frame: {{ frame_id: "f0" }},
    camera: {{ properties: {{ aperture_mirror_mesh_id: "missing_quad" }} }},
    meshes: [],
    timing: {{ fps: 60, duration_seconds: 1, boundary: "repeat" }}
  }}
}};

vm.runInNewContext(sceneSrc, sandbox, {{ filename: "vf-native-scene.js" }});
sandbox.__sceneTest.resolveMirrorApertureCamera({{
  pos: [0, -6, 0],
  target: [0, 0, 0],
  up: [0, 0, 1],
  fov: 34
}}, 0, 1.0);
"""
    result = _run_node_raw(script)
    assert result.returncode != 0
    assert "mesh id \"missing_quad\" was not found" in result.stderr


def test_linked_reflected_camera_requires_complete_config() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");

const sandbox = {{
  console: {{ log() {{}}, warn() {{}}, error() {{}} }},
  Float32Array,
  Uint32Array,
  Math,
  setTimeout,
  clearTimeout,
}};
sandbox.window = sandbox;
sandbox.document = {{
  readyState: "loading",
  addEventListener() {{}},
  querySelector() {{ return null; }}
}};

vm.runInNewContext(fs.readFileSync({json.dumps(str(MATH_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-math.js" }});
vm.runInNewContext(fs.readFileSync({json.dumps(str(WGPU_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-wgpu.js" }});

let sceneSrc = fs.readFileSync({json.dumps(str(REPO / "web" / "vf-ui" / "vf-native-scene.js"))}, "utf8");
sceneSrc = sceneSrc.replace(/\\}}\\)\\(typeof window !== "undefined" \\? window : this\\);\\s*$/, `
global.__sceneTest = {{
  resolveLinkedMirrorCamera: resolveLinkedMirrorCamera
}};
}})(typeof window !== "undefined" ? window : this);
`);

sandbox.__vfNativeSceneConfig = {{
  scene_ir: {{
    frame: {{ frame_id: "f0", rect: [0, 0, 1, 1] }},
    camera: {{ properties: {{ reflect_of_frame_id: "source_only" }} }},
    meshes: [],
    timing: {{ fps: 60, duration_seconds: 1, boundary: "repeat" }}
  }}
}};

vm.runInNewContext(sceneSrc, sandbox, {{ filename: "vf-native-scene.js" }});
sandbox.__sceneTest.resolveLinkedMirrorCamera({{
  pos: [0, -6, 0],
  target: [0, 0, 0],
  up: [0, 0, 1],
  fov: 34
}}, 0);
"""
    result = _run_node_raw(script)
    assert result.returncode != 0
    assert "requires both reflect_of_frame_id and reflect_mirror_mesh_id" in result.stderr


def test_linked_reflected_camera_does_not_silently_use_base_camera() -> None:
    source = NATIVE_SCENE_JS.read_text(encoding="utf-8")
    camera_fn = source[source.index("function resolveLinkedMirrorCamera"):source.index("function resolveMirrorApertureCamera")]
    assert 'linked reflected camera source frame "' in camera_fn
    assert "mirror surface_system camera lies on or behind the mirror plane" not in camera_fn
    assert "return cloneCameraState(baseCamera, baseCamera);" not in camera_fn

    aperture_fn = source[source.index("function resolveMirrorApertureCamera"):source.index("function cameraBehaviorProps")]
    assert "mirror aperture camera lies on or behind the mirror plane" not in aperture_fn
    assert "return cloneCameraState(baseCamera, baseCamera);" not in aperture_fn


def test_native_clone_camera_preserves_mirror_metadata() -> None:
    source = NATIVE_SCENE_JS.read_text(encoding="utf-8")
    clone_fn = source[source.index("function cloneCameraState"):source.index("function cameraOrbitStepRadians")]
    assert "cloned._mirrorDebug = cloneJsonValue(source._mirrorDebug);" in clone_fn
    assert "cloned._mirrorViewProjection = source._mirrorViewProjection.slice();" in clone_fn


def test_offscreen_reflected_frame_waits_for_source_before_resolving_camera() -> None:
    source = NATIVE_SCENE_JS.read_text(encoding="utf-8")
    assert 'dependent reflected frame "' in source
    assert 'timed out waiting for source frame "' in source
    assert "global.setTimeout(renderFrame, 16);" in source
    assert "resolveLinkedMirrorCamera(authoredCamera, seconds)" in source
    wait_index = source.index('timed out waiting for source frame "')
    resolve_index = source.index("resolveLinkedMirrorCamera(authoredCamera, seconds)")
    assert wait_index < resolve_index


def test_native_scene_resets_stale_camera_controls_on_boot() -> None:
    source = NATIVE_SCENE_JS.read_text(encoding="utf-8")
    boot_fn = source[source.index("function boot()"):source.index("function ensureGeomRendererReady")]
    assert "controlState.zoomFactor = 1.0;" in boot_fn
    assert "controlState.orbitPhi = 0.0;" in boot_fn
    assert "controlState.orbitTheta = 0.0;" in boot_fn
    assert "controlState.keyLeft = false;" in boot_fn
    assert "controlState.apertureInitDone = false;" in boot_fn
    assert "controlState.exactInitCamera = null;" in boot_fn
    assert "if (controlState.configSignature !== configSignature)" not in boot_fn


def test_native_scene_wheel_requires_frame_target_but_arrow_keys_allow_document_target() -> None:
    source = NATIVE_SCENE_JS.read_text(encoding="utf-8")
    boot_fn = source[source.index("function boot()"):source.index("function ensureGeomRendererReady")]
    assert "function eventFrameId(ev)" in boot_fn
    assert "function keyEventAllowedForActiveFrame(ev, activeFrameId)" in boot_fn
    assert "var fid = eventFrameId(ev);" in boot_fn
    assert "if (!fid || fid !== activeFrameId) { return; }" in boot_fn
    wheel_index = boot_fn.index('global.addEventListener("wheel"')
    wheel_apply_index = boot_fn.index("applyWheelZoom(activeState, ev);")
    wheel_gate_index = boot_fn.index("if (!fid || fid !== activeFrameId) { return; }", wheel_index)
    assert wheel_index < wheel_gate_index < wheel_apply_index
    key_index = boot_fn.index('global.addEventListener("keydown"')
    prevent_index = boot_fn.index("ev.preventDefault();", key_index)
    key_gate_index = boot_fn.index("if (!keyEventAllowedForActiveFrame(ev, activeFrameId)) { return; }", key_index)
    assert key_index < key_gate_index < prevent_index
    allow_fn = boot_fn[boot_fn.index("function keyEventAllowedForActiveFrame"):boot_fn.index("if (useVisibleFrame)")]
    assert "if (keyEventTargetsTextInput(ev)) { return false; }" in allow_fn
    assert "return !fid || fid === activeFrameId;" in allow_fn


def test_native_scene_light_markers_do_not_enable_screen_space_flare_ghosts() -> None:
    source = NATIVE_SCENE_JS.read_text(encoding="utf-8")
    build_state_fn = source[source.index("function buildSceneState"):source.index("function renderPayload")]
    render_payload_fn = source[source.index("function renderPayload"):source.index("function resolveMeshSpecById")]

    assert "buildLightMarkerMeshes(lights, camera, renderOptions.light_marker_size)" in build_state_fn
    assert "enabled: renderOptions.light_flares === true" in render_payload_fn
    assert "enabled: renderOptions.show_light_markers === true" not in render_payload_fn


def test_linked_reflected_camera_uses_planar_mirror_adapter_camera() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");

const sandbox = {{
  console: {{ log() {{}}, warn() {{}}, error() {{}} }},
  Float32Array,
  Uint32Array,
  Math,
  setTimeout,
  clearTimeout,
}};
sandbox.window = sandbox;
sandbox.document = {{
  readyState: "loading",
  addEventListener() {{}},
  querySelector() {{ return null; }}
}};

vm.runInNewContext(fs.readFileSync({json.dumps(str(MATH_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-math.js" }});
vm.runInNewContext(fs.readFileSync({json.dumps(str(WGPU_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-wgpu.js" }});

let sceneSrc = fs.readFileSync({json.dumps(str(REPO / "web" / "vf-ui" / "vf-native-scene.js"))}, "utf8");
sceneSrc = sceneSrc.replace(/\\}}\\)\\(typeof window !== "undefined" \\? window : this\\);\\s*$/, `
global.__sceneTest = {{
  resolveLinkedMirrorCamera: resolveLinkedMirrorCamera
}};
}})(typeof window !== "undefined" ? window : this);
`);

sandbox.__vfNativeSceneLiveCameras = {{
  main_frame: {{
    pos: [0.0, -4.45, 3.2],
    target: [0.0, 1.4, 1.0],
    up: [0.0, 0.0, 1.0],
    fov: 34.0
  }}
}};

sandbox.__vfNativeSceneConfig = {{
  scene_ir: {{
    frame: {{ frame_id: "reflected_frame", rect: [0.67, 0.54, 0.27, 0.27] }},
    camera: {{ properties: {{
      reflect_of_frame_id: "main_frame",
      reflect_mirror_mesh_id: "quad_0"
    }} }},
    meshes: [{{
      id: "quad_0",
      kind: "quad",
      center: [0.0, 3.5, 3.5],
      size: [7.0, 7.0],
      rotation: [90.0, 0.0, 0.0]
    }}],
    timing: {{ fps: 60, duration_seconds: 1, boundary: "repeat" }}
  }}
}};

vm.runInNewContext(sceneSrc, sandbox, {{ filename: "vf-native-scene.js" }});

const linked = sandbox.__sceneTest.resolveLinkedMirrorCamera({{
  pos: [1.0, 2.0, 3.0],
  target: [1.0, 2.0, 2.0],
  up: [0.0, 0.0, 1.0],
  fov: 20.0
}}, 0);

const expected = sandbox.VfGeomWgpuUtil.createPlanarMirrorAdapter().buildRenderCamera({{
  part: {{
    mesh: {{
      id: "quad_0",
      kind: "quad",
      center: [0.0, 3.5, 3.5],
      size: [7.0, 7.0],
      rotation: [90.0, 0.0, 0.0]
    }}
  }},
  surfaceCamera: sandbox.__vfNativeSceneLiveCameras.main_frame,
  timeMs: 0.0,
  targetAspect: 1.0,
  math: sandbox.VfGeomMath
}});

process.stdout.write(JSON.stringify({{
  linkedPos: linked.pos,
  linkedTarget: linked.target,
  expectedPos: expected.pos,
  expectedTarget: expected.target
}}));
"""
    payload = _run_node(script)
    assert payload["linkedPos"] == pytest.approx(payload["expectedPos"])
    assert payload["linkedTarget"] == pytest.approx(payload["expectedTarget"])


def test_locked_linked_reflected_camera_still_applies_aperture_camera() -> None:
    script = f"""
const fs = require("fs");
const vm = require("vm");

const sandbox = {{
  console: {{ log() {{}}, warn() {{}}, error() {{}} }},
  Float32Array,
  Uint32Array,
  Math,
  setTimeout,
  clearTimeout,
}};
sandbox.window = sandbox;
sandbox.document = {{
  readyState: "loading",
  addEventListener() {{}},
  querySelector() {{ return null; }}
}};

vm.runInNewContext(fs.readFileSync({json.dumps(str(MATH_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-math.js" }});
vm.runInNewContext(fs.readFileSync({json.dumps(str(WGPU_JS))}, "utf8"), sandbox, {{ filename: "vf-geom-wgpu.js" }});

let renderCalls = 0;
let apertureCalls = 0;
const originalFactory = sandbox.VfGeomWgpuUtil.createPlanarMirrorAdapter;
sandbox.VfGeomWgpuUtil.createPlanarMirrorAdapter = function () {{
  const adapter = originalFactory();
  return {{
    name: adapter.name,
    targetDims: adapter.targetDims,
    buildRenderCamera(args) {{
      renderCalls += 1;
      return adapter.buildRenderCamera(args);
    }},
    buildApertureCamera(args) {{
      apertureCalls += 1;
      return adapter.buildApertureCamera(args);
    }}
  }};
}};

let sceneSrc = fs.readFileSync({json.dumps(str(REPO / "web" / "vf-ui" / "vf-native-scene.js"))}, "utf8");
sceneSrc = sceneSrc.replace(/\\}}\\)\\(typeof window !== "undefined" \\? window : this\\);\\s*$/, `
global.__sceneTest = {{
  resolveLinkedMirrorCamera: resolveLinkedMirrorCamera,
  resolveMirrorApertureCamera: resolveMirrorApertureCamera
}};
}})(typeof window !== "undefined" ? window : this);
`);

sandbox.__vfNativeSceneLiveCameras = {{
  main_frame: {{
    pos: [0.0, -4.0, 2.5],
    target: [0.0, 0.0, 1.0],
    up: [0.0, 0.0, 1.0],
    fov: 34.0
  }}
}};

sandbox.__vfNativeSceneConfig = {{
  scene_ir: {{
    frame: {{ frame_id: "reflected_frame", rect: [0.0, 0.0, 1.0, 1.0] }},
    camera: {{ properties: {{
      reflect_of_frame_id: "main_frame",
      reflect_mirror_mesh_id: "mirror",
      aperture_mirror_mesh_id: "mirror",
      lock_aperture_camera: true,
      reflect_eye_only: true
    }} }},
    meshes: [{{
      id: "mirror",
      kind: "quad",
      center: [0.0, 1.0, 1.0],
      size: [2.0, 2.0],
      rotation: [90.0, 0.0, 0.0],
      surface_system: {{ kind: "screen", reverse_facing: true }}
    }}],
    timing: {{ fps: 60, duration_seconds: 1, boundary: "repeat" }}
  }}
}};

vm.runInNewContext(sceneSrc, sandbox, {{ filename: "vf-native-scene.js" }});

const linked = sandbox.__sceneTest.resolveLinkedMirrorCamera({{
  pos: [0.0, -2.0, 2.0],
  target: [0.0, 0.0, 1.0],
  up: [0.0, 0.0, 1.0],
  fov: 34.0
}}, 0);
const finalCamera = sandbox.__sceneTest.resolveMirrorApertureCamera(linked, 0, 1.0);

process.stdout.write(JSON.stringify({{
  renderCalls,
  apertureCalls,
  hasView: Array.isArray(finalCamera.view_matrix) && finalCamera.view_matrix.length === 16,
  hasProjection: Array.isArray(finalCamera.projection_matrix) && finalCamera.projection_matrix.length === 16
}}));
"""
    payload = _run_node(script)
    assert payload["renderCalls"] == 1
    assert payload["apertureCalls"] == 1
    assert payload["hasView"] is True
    assert payload["hasProjection"] is True

