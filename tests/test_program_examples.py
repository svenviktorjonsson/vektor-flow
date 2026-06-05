import json
import subprocess
import sys
from pathlib import Path

import pytest

from vektorflow.interpreter import Interpreter
from vektorflow.native_overlay_scene_bundle import try_build_native_overlay_scene_program
from vektorflow.parser import parse_module


ROOT = Path(__file__).resolve().parent.parent


def _extract_native_scene_configs(html_text: str) -> list[dict]:
    decoder = json.JSONDecoder()
    marker = "window.__vfNativeSceneConfigs"
    start = html_text.find(marker)
    if start >= 0:
        equals = html_text.find("=", start)
        assert equals >= 0
        value, _ = decoder.raw_decode(html_text[equals + 1:].lstrip())
        return value
    marker = "window.__vfNativeSceneConfig"
    start = html_text.find(marker)
    assert start >= 0
    equals = html_text.find("=", start)
    assert equals >= 0
    value, _ = decoder.raw_decode(html_text[equals + 1:].lstrip())
    return [value]


def test_chess_engine_core_builds_and_runs_native(tmp_path: Path) -> None:
    source = ROOT / "examples" / "programs" / "chess_engine_core.vkf"
    exe = tmp_path / ("chess_engine_core.exe" if sys.platform.startswith("win") else "chess_engine_core")

    build = subprocess.run(
        [sys.executable, "-m", "vektorflow", "build-native-core", str(source), "-o", str(exe)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert build.returncode == 0, build.stderr

    result = subprocess.run([str(exe)], capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    assert result.stdout.splitlines() == [
        "e4",
        "d5",
        "exd5",
        "4",
        "5",
        "true",
        "1",
        "false",
        "true",
        "true",
        "true",
        "true",
        "true",
        "false",
        "Qxe7",
        "assets/chess/models/gltf/Knight_White.glb",
        "2.5",
        "-3.5",
        "assets/chess/models/gltf/Pawn_Black.glb",
        "5.25",
        "-3.5",
        "false",
        "true",
        "false",
        "true",
        "queen",
        "pawn",
        "false",
    ]


def test_chess_3d_scene_contract_builds_and_runs_native(tmp_path: Path) -> None:
    source = ROOT / "examples" / "programs" / "chess_3d_scene_contract.vkf"
    exe = tmp_path / ("chess_3d_scene_contract.exe" if sys.platform.startswith("win") else "chess_3d_scene_contract")

    build = subprocess.run(
        [sys.executable, "-m", "vektorflow", "build-native-core", str(source), "-o", str(exe)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert build.returncode == 0, build.stderr

    result = subprocess.run([str(exe)], cwd=ROOT, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    assert result.stdout.splitlines() == [
        "0",
        "0",
        "30",
        "45",
        "0.8",
        "0.2",
        "capture",
        "5",
        "select",
        "1",
        "move",
        "3",
        "reject",
        "noop",
    ]


def test_chess_playable_turns_builds_and_runs_native(tmp_path: Path) -> None:
    source = ROOT / "examples" / "programs" / "chess_playable_turns.vkf"
    exe = tmp_path / ("chess_playable_turns.exe" if sys.platform.startswith("win") else "chess_playable_turns")

    build = subprocess.run(
        [sys.executable, "-m", "vektorflow", "build-native-core", str(source), "-o", str(exe)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert build.returncode == 0, build.stderr

    result = subprocess.run([str(exe)], cwd=ROOT, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    assert result.stdout.splitlines() == [
        "white",
        "true",
        "black",
        "e4",
        "wrong-turn",
        "false",
        "black",
        "e4",
        "true",
        "white",
        "e4 d5",
        "true",
        "black",
        "Moves",
        "e4 d5 exd5",
        "New Game",
        "white",
        "0",
        "",
        "move",
        "0.5",
        "-0.5",
        "280",
        "none",
        "capture",
        "0.55",
        "180",
    ]


def test_foldered_vkf_chess_3d_program_builds_scene_and_reduces_events() -> None:
    source = ROOT / "examples" / "programs" / "vkf_chess_3d" / "main.vkf"
    interpreter = Interpreter(source)
    interpreter.run_module(parse_module(source.read_text(encoding="utf-8"), filename=str(source)))

    move = interpreter.globals["move_e4"]
    assert move["ok"] is True
    assert move["intent"]["notation"] == "e4"
    assert move["state"]["turn"] == "black"
    assert interpreter.globals["selected_e2"]["state"]["status"] == "selected"
    assert interpreter.globals["target_e2"] == {
        "kind": "piece",
        "file": 5,
        "rank": 2,
        "piece_side": "white",
        "piece_role": "pawn",
    }
    assert interpreter.globals["anim_e4"]["kind"] == "move"
    assert interpreter.globals["anim_e4"]["duration_ms"] == 280
    assert interpreter.globals["camera_after_arrow"]["theta"] == 60
    assert interpreter.globals["reset_state"]["turn"] == "white"
    assert interpreter.globals["loop_probe"]["status"] == "ready"

    display = interpreter.globals["d"]
    meshes = display._geom["vkf_chess_board"]["meshes"]
    assert len(meshes) == 97
    assert meshes[1]["type"] == "box"
    assert meshes[65]["type"] == "box"
    side_frame = display._frame_refs[1]
    assert side_frame.id == "vkf_chess_moves"
    assert side_frame._pending.body_layout == {
        "type": "grid",
        "rows": 7,
        "cols": 2,
        "row_heights": "max-content max-content max-content max-content max-content max-content minmax(0,1fr)",
    }


def test_foldered_vkf_chess_3d_exposes_native_overlay_contract() -> None:
    source = ROOT / "examples" / "programs" / "vkf_chess_3d" / "main.vkf"

    program = try_build_native_overlay_scene_program(source)

    assert program is not None
    assert program.session_name == "main"
    assert program.page_rel == "sessions/main/vkf-scene.html"
    assert "VKF Chess 3D Native" in program.runtime_packets_text
    assert "vf-native-scene.js" in program.html_text
    assert "vkf_chess_board" in program.html_text
    assert program.html_text.count('"kind": "cube"') == 0
    assert program.html_text.count('"kind": "field_mesh"') >= 32
    assert program.html_text.count('"kind": "quad"') >= 2
    assert '"look_only_controls": true' in program.html_text
    assert '"motion": "fixed"' in program.html_text
    assert "board_soft_mirror" not in program.html_text
    assert "board_reflection_overlay" in program.html_text
    assert "window.__vfNativeSceneConfigs" in program.html_text
    assert '"kind": "screen"' in program.html_text
    assert '"reflectivity": 0.2' in program.html_text
    assert '"kind": "checker"' in program.html_text
    assert '"scale": [8.0, 8.0]' in program.html_text
    assert '"size": [8.0, 8.0]' in program.html_text
    assert "white_king_e1" in program.html_text
    assert "black_queen_d8" in program.html_text
    assert "sq_h8" not in program.html_text
    assert '"square_region_object_id": 2' in program.html_text
    assert '"kind": "chess_board"' in program.html_text

    scene_configs = _extract_native_scene_configs(program.html_text)
    assert len(scene_configs) == 2
    hidden_configs = [config for config in scene_configs if config["scene_ir"]["frame"].get("visible") is False]
    visible_configs = [config for config in scene_configs if config["scene_ir"]["frame"].get("visible") is not False]
    assert len(hidden_configs) == 1
    assert len(visible_configs) == 1
    assert "__surface_source_" in hidden_configs[0]["scene_ir"]["frame"]["frame_id"]
    assert "interaction" not in hidden_configs[0]
    assert visible_configs[0]["interaction"]["controls_frame_id"] == "vkf_chess_controls"
    hidden_camera = hidden_configs[0]["scene_ir"]["camera"]["properties"]
    assert hidden_camera["flip_x"] is False

    scene_config = visible_configs[0]
    mesh_ids = [mesh["id"] for mesh in scene_config["scene_ir"]["meshes"]]
    assert "board_reflection_overlay" in mesh_ids
    assert "sq_a1" not in mesh_ids
    assert "sq_h8" not in mesh_ids
    assert "white_king_e1" in mesh_ids
    assert "black_queen_d8" in mesh_ids
    board_mesh = next(mesh for mesh in scene_config["scene_ir"]["meshes"] if mesh["id"] == "board_reflection_overlay")
    assert board_mesh["properties"]["texture"]["kind"] == "checker"
    assert board_mesh["properties"]["surface_system"]["kind"] == "screen"
    assert board_mesh["properties"]["surface_system"]["reflectivity"] == 0.2
    assert board_mesh["properties"]["surface_system"]["flip_y"] is True
    white_rook = next(mesh for mesh in scene_config["scene_ir"]["meshes"] if mesh["id"] == "white_rook_a1")
    piece_meshes = [
        mesh for mesh in scene_config["scene_ir"]["meshes"]
        if mesh["kind"] == "field_mesh" and mesh["properties"].get("object_id", 0) >= 66
    ]
    assert len(piece_meshes) == 32
    assert all(mesh["properties"].get("interpolation") is True for mesh in piece_meshes)
    assert white_rook["kind"] == "field_mesh"
    assert white_rook["properties"]["topology"] == "triangle-list"
    assert white_rook["properties"]["vertex_size"] == 0.0
    assert white_rook["properties"]["edge_width"] == 0.0
    assert white_rook["properties"]["interpolation"] is True
    assert white_rook["properties"]["rotation"] == [0.0, 0.0, 0.0]
    assert white_rook["properties"]["object_id"] == 66
    assert white_rook["properties"]["specular_strength"] == 0.055
    assert white_rook["properties"]["center"][2] == pytest.approx(board_mesh["properties"]["center"][2])
    assert len(white_rook["properties"]["vertices"]) > 7000
    assert len(white_rook["properties"]["indices"]) > 1200
    white_knight = next(mesh for mesh in scene_config["scene_ir"]["meshes"] if mesh["id"] == "white_knight_b1")
    black_knight = next(mesh for mesh in scene_config["scene_ir"]["meshes"] if mesh["id"] == "black_knight_b8")
    assert white_knight["properties"]["interpolation"] is True
    assert black_knight["properties"]["interpolation"] is True
    assert white_knight["properties"]["rotation"] == [0.0, 0.0, 180.0]
    assert black_knight["properties"]["rotation"] == [0.0, 0.0, 0.0]
    assert scene_config["interaction"]["square_region_object_id"] == 2
    assert scene_config["interaction"]["square_object_id_first"] == 2
    assert scene_config["interaction"]["piece_object_id_first"] == 66
    for light in scene_config["scene_ir"]["lights"]:
        assert light["properties"]["motion"] == "fixed"
        assert "angular_velocity" not in light["properties"]


def test_native_chess_runtime_handles_overlay_clicks_highlights_and_piece_motion() -> None:
    runtime = (ROOT / "web" / "vf-ui" / "vf-native-scene.js").read_text(encoding="utf-8")

    assert "function entityStateEmbeddings(entity)" in runtime
    assert "function applyEntityStateEmbedding(entity, stateName)" in runtime
    assert "function buildChessSquareRegionMesh(cfg, runtime)" in runtime
    assert '"vkf_chess_square_regions"' in runtime
    assert "alpha: 0.0" in runtime
    assert "pickable: true" in runtime
    assert "surface.square_highlights = chessSquareHighlightColors(runtime)" in runtime
    assert "function chessSquareFromSimplexId(runtime, simplexId)" in runtime
    assert "primitive/simplex" not in runtime
    assert 'var stateName = !runtime.selected || sameAsSelected ? "selectable" : (legal ? "legal" : "illegal");' in runtime
    assert "setChessSquareRegionState(runtime, runtime.hoverSquare.file, runtime.hoverSquare.rank, stateName, fallbackColor)" in runtime
    assert 'center[2] = Math.max(Number(center[2] || 0.0), 0.12)' in runtime
    assert 'eventName !== "down" && eventName !== "up" && eventName !== "click"' in runtime
    assert 'setEntityProp(mesh, "center", cloneEntityStateValue(entityProp(piece.mesh, "center", pieceBoardCenter(piece, 0.0))))' in runtime
    assert 'piece._animating = true' in runtime
    assert "runtime.animations.push({ piece: piece, captured: target || null, from: fromCenter, to: toCenter, start: now, progress: 0.0 })" in runtime
    assert "var eased = t * t * (3.0 - (2.0 * t));" in runtime
    assert "function chessLagDebugEnabled()" in runtime
    assert "if (!chessLagDebugEnabled()) { return; }" in runtime
    assert "camera_request_coalesced" in runtime
    assert "render_camera_only" in runtime
    assert "dependentMirrorFramePending" in runtime
    assert "renderOptions.mirror_source_scale" in runtime
    assert "renderOptions.mirror_source_max_px" in runtime
    assert ": 1.0" in runtime
    assert "function visibleRenderBackpressureActive()" in runtime
    assert "function ensureVisibleSceneFrameShell()" in runtime
    assert "global.VfFrame.mount(layer" in runtime
    assert "exitWhenLastFrameClosed: true" in runtime
    assert 'typeof global.VfDisplay.mountDynamicGeomFrame === "function"' in runtime
    assert "function markChessSceneDirty(runtime)" in runtime
    assert "function updateVisibleCameraOnly(camera)" in runtime
    assert "function updateOffscreenCameraOnly(camera)" in runtime
    assert "controlState.requestCameraFrame = function ()" in runtime
    assert "controlState.cameraFramePending = true" in runtime
    assert "continuationFramePending" in runtime
    assert "function scheduleNextFrameIfNeeded(animationActive)" in runtime
    assert "cameraKeysActive() || animationActive === true" in runtime
    assert "Math.min(1.0 / 30.0" in runtime
    assert "var chessAnimationActive = applyChessInteractionFrame(seconds)" in runtime
    assert 'typeof activeState.requestCameraFrame === "function"' in runtime
    assert 'typeof state.requestCameraFrame === "function"' in runtime
    assert "function smoothInterpolatedFieldMeshVertices(spec, vertices, indices, enabled)" in runtime
    assert "var faceNormalsApplied = false" in runtime
    assert "var areaWeight = Math.max(1e-6, Math.sqrt((cx * cx) + (cy * cy) + (cz * cz)))" in runtime
    assert "global.__vfSmoothFieldMeshVerticesByKey[cacheKey]" in runtime
    assert "function resolveRawMeshById(rawMeshes, meshId, purpose)" in runtime
    assert "normalizeMeshSpec(resolveRawMeshById(rawMeshes, mirrorMeshId" in runtime
    assert "rawMeshSpecs = rawMeshSpecs.filter(function (mesh)" in runtime
    assert "spec.__vfSmoothFieldMeshVertices = out" in runtime
    assert "vertices: fieldVertices" in runtime
    assert "indices: fieldIndices" in runtime
    assert "dirtyVersion === visibleLastDirtyVersion && updateVisibleCameraOnly(renderCamera)" in runtime
    assert "dirtyVersion === offscreenLastDirtyVersion && updateOffscreenCameraOnly(renderCamera)" in runtime
    assert "cameraOnlyUpdates" in runtime
    assert "fullSceneUpdates" in runtime
    assert "var nextVisibleSpec = Object.assign({}, geomPayload)" in runtime
    assert "vertices: Array.isArray(mesh.vertices) ? mesh.vertices : []" in runtime
    assert "indices: Array.isArray(mesh.indices) ? mesh.indices : []" in runtime
    assert "static_vertices: true" in runtime
    assert "static_indices: true" in runtime
    display_runtime = (ROOT / "web" / "vf-ui" / "vf-display.js").read_text(encoding="utf-8")
    assert "function updateDynamicGeomFrameCamera(fid, camera, lights, lightFlares)" in display_runtime
    assert "function dynamicGeomFrameHasRenderBackpressure(fid)" in display_runtime
    assert "dynamicGeomFrameHasRenderBackpressure: dynamicGeomFrameHasRenderBackpressure" in display_runtime
    assert "var _vfPostedKeyDown = Object.create(null)" in display_runtime
    assert "_vfPostedKeyDown[keyId] === true" in display_runtime
    assert "scene.parts[partIndex].camera = camera" in display_runtime
    assert "scene.__cameraOnlyRevision = Number(scene.__cameraOnlyRevision || 0) + 1" in display_runtime
    assert "global.__vfDynamicGeomCameraOnlyRenders[String(fid)]" in display_runtime
    assert "r._renderOnDemand = true" in display_runtime
    assert "typeof renderer.requestFrame === \"function\"" in display_runtime
    assert "function requestLinkedMirrorTextureFrameForSource(sourceFrameId)" in display_runtime
    assert "entry.requestTextureFrame = function ()" in display_runtime
    assert "scheduleTextureFrame(false)" in display_runtime
    assert "[DEBUG-chess-lag] linked_texture_draw" in display_runtime
    assert "[DEBUG-chess-lag] linked_texture_notify" in display_runtime
    assert "requestLinkedMirrorTextureFrameForSource: requestLinkedMirrorTextureFrameForSource" in display_runtime
    renderer_runtime = (ROOT / "web" / "vf-ui" / "geom" / "vf-geom-wgpu.js").read_text(encoding="utf-8")
    assert "this._renderOnDemand = false" in renderer_runtime
    assert "requestFrame: function ()" in renderer_runtime
    assert "this._offscreenFrame === true" in renderer_runtime
    assert "self._renderContent(t)" in renderer_runtime
    assert "if (self._renderOnDemand === true) { return; }" in renderer_runtime
    assert "function publishPerfSample(renderer, sample)" in renderer_runtime
    assert "function markSubmittedGpuWork(renderer)" in renderer_runtime
    assert "function gpuSchedulerState(renderer)" in renderer_runtime
    assert "function drainQueuedGpuRenderers(scheduler)" in renderer_runtime
    assert "function notifyLinkedTextureFrames(renderer)" in renderer_runtime
    assert "notifyLinkedTextureFrames(this)" in renderer_runtime
    assert "[DEBUG-chess-lag]" in renderer_runtime
    assert "gpu_pending_block" in renderer_runtime
    assert "global_queued=" in renderer_runtime
    assert "request_coalesced" in renderer_runtime
    assert "renderer._renderQueuedWhileGpuPending = true" in renderer_runtime
    assert "this._gpuWorkPending = false" in renderer_runtime
    assert "data-vf-last-perf-total-ms" in renderer_runtime
    assert "data-vf-last-perf-heavy-stage" in renderer_runtime
    assert "function maybeLogSlowFrame(renderer, sample)" in renderer_runtime
    assert "fs_pick(@builtin(primitive_index) primitiveIndex: u32)" in renderer_runtime
    assert "vec2<u32>(pk.object_id, primitiveIndex + 1u)" in renderer_runtime
    assert "fn screenSquareHighlight(surfaceUv: vec2<f32>)" in renderer_runtime
    assert "surfaceSystem.square_highlights" in renderer_runtime
    assert "mix(mirrorComposite, highlight.rgb" in renderer_runtime
    assert "surfaceSystem._runtime_texture_ready = !!part.surfaceExternalView" in renderer_runtime
    assert "if (surfaceSystem.flip_x === true) { screenFlags += 2.0; }" in renderer_runtime
    assert "surfaceSystem.flip_x === true || surfaceSystem._renderFlipU === true" not in renderer_runtime
    assert 'frame_ref "\' + sourceFrameId + \'" has no ready texture view' not in renderer_runtime
    assert "textureKind = fixedSurfaceTextureKind > 0.0 ? fixedSurfaceTextureKind : 0.0" in renderer_runtime
    assert "(meshLike.alpha_mul == null ? meshLike.alpha : meshLike.alpha_mul)" in renderer_runtime
    assert "if (partMesh.visible === false) { return; }" in renderer_runtime
    assert "if (partMesh && partMesh.visible === false)" in renderer_runtime
    assert "if (sceneSourceBackups) {" in renderer_runtime
    assert "renderer._offscreenFrame === true" in display_runtime
    assert "renderer._renderContent(performance.now())" in display_runtime
    assert "updateDynamicGeomFrameCamera offscreen render" in display_runtime
    assert "updateDynamicGeomFrameCamera: updateDynamicGeomFrameCamera" in display_runtime
    assert "triggerFrameDependents(String(frameSpec.frame_id || config.frame_id));" in runtime


def test_imported_typed_vkf_module_functions_remain_callable_from_interpreter() -> None:
    source = ROOT / "examples" / "programs" / "vkf_chess_3d" / "inline_import_smoke.vkf"
    program = (
        "events: .lib.events\n"
        "target: events.click_target_from_object_id(78)\n"
        ":: target.piece_side != \"\"\n"
    )
    interpreter = Interpreter(source)
    interpreter.run_module(parse_module(program, filename=str(source)))
    assert interpreter.globals["target"]["piece_role"] == "pawn"


def test_chess_asset_loader_reads_manifest_and_glb_bytes_natively(tmp_path: Path) -> None:
    source = ROOT / "assets" / "chess" / "chess_asset_loader.vkf"
    exe = tmp_path / ("chess_asset_loader.exe" if sys.platform.startswith("win") else "chess_asset_loader")

    build = subprocess.run(
        [sys.executable, "-m", "vektorflow", "build-native-core", str(source), "-o", str(exe)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert build.returncode == 0, build.stderr

    manifest = ROOT / "assets" / "chess" / "manifest.csv"
    white_pawn = ROOT / "assets" / "chess" / "models" / "gltf" / "Pawn_White.glb"
    black_king = ROOT / "assets" / "chess" / "models" / "gltf" / "King_Black.glb"
    result = subprocess.run([str(exe)], cwd=ROOT, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    assert result.stdout.splitlines() == [
        str(len(manifest.read_text(encoding="utf-8"))),
        str(white_pawn.stat().st_size),
        str(black_king.stat().st_size),
    ]


def test_chess_assets_manifest_covers_every_standard_piece_glb() -> None:
    manifest = ROOT / "assets" / "chess" / "manifest.csv"
    rows = manifest.read_text(encoding="utf-8").splitlines()[1:]
    expected_roles = {
        ("white", "bishop"),
        ("white", "king"),
        ("white", "knight"),
        ("white", "pawn"),
        ("white", "queen"),
        ("white", "rook"),
        ("black", "bishop"),
        ("black", "king"),
        ("black", "knight"),
        ("black", "pawn"),
        ("black", "queen"),
        ("black", "rook"),
    }

    seen = set()
    for row in rows:
        side, role, asset_path, fmt, source = row.split(",")
        seen.add((side, role))
        assert fmt == "glb"
        assert source == "lyricsz-stylized-chess-pieces"
        assert (ROOT / asset_path).is_file()

    assert seen == expected_roles
