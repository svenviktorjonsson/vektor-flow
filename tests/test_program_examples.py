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
    assert move["state"]["turn"] == 2
    assert interpreter.globals["selected_e2"]["state"]["status"] == "selected"
    assert interpreter.globals["target_e2"] == {
        "kind": 2,
        "file": 5,
        "rank": 2,
        "piece_side": 1,
        "piece_role": 1,
    }
    assert interpreter.globals["anim_e4"]["kind"] == 0
    assert interpreter.globals["anim_e4"]["duration_ms"] == 280
    assert interpreter.globals["camera_after_arrow"]["theta"] == 60
    assert interpreter.globals["reset_state"]["turn"] == 1
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


def test_foldered_vkf_chess_3d_bot_selects_two_ply_move() -> None:
    source = ROOT / "examples" / "programs" / "vkf_chess_3d" / "bot_smoke.vkf"
    interpreter = Interpreter(source)
    interpreter.run_module(parse_module(source.read_text(encoding="utf-8"), filename=str(source)))

    choice = interpreter.globals["choice"]
    assert choice["ok"] is True
    assert choice["result"]["ok"] is True
    assert choice["result"]["intent"]["notation"]
    assert choice["result"]["state"]["turn"] == 2


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
    assert '"kind": "chess_board"' in program.html_text
    assert '"font": "noto_sans"' in program.html_text
    assert '"scale": [8.0, 8.0]' in program.html_text
    assert '"size": [8.6, 8.6]' in program.html_text
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
    assert board_mesh["properties"]["texture"]["kind"] == "chess_board"
    assert board_mesh["properties"]["texture"]["font"] == "noto_sans"
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
    assert white_rook["properties"]["center"][2] > board_mesh["properties"]["center"][2]
    assert white_rook["properties"]["center"][2] == pytest.approx(0.077)
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
    assert scene_config["interaction"]["square_highlight_hover"] == [0.24, 0.62, 1.0, 0.78]
    assert scene_config["interaction"]["square_highlight_selected"] == [0.28, 0.72, 1.0, 0.92]
    assert scene_config["interaction"]["selected_piece_specular_strength"] == pytest.approx(0.16)
    assert [mode["id"] for mode in scene_config["interaction"]["player_modes"]] == [
        "human_human",
        "human_bot",
        "bot_human",
        "bot_bot",
    ]
    assert scene_config["interaction"]["default_player_mode"] == "human_human"
    first_piece = scene_config["interaction"]["pieces"][0]
    black_piece = next(piece for piece in scene_config["interaction"]["pieces"] if piece["id"] == "black_rook_a8")
    assert first_piece["side"] == "white"
    assert first_piece["role"] == "rook"
    assert black_piece["side"] == "black"
    assert black_piece["role"] == "rook"
    assert scene_config["interaction"]["hit_regions"][0]["exclusive"] is True
    for light in scene_config["scene_ir"]["lights"]:
        assert light["properties"]["motion"] == "fixed"
        assert "angular_velocity" not in light["properties"]


def test_native_chess_runtime_handles_overlay_clicks_highlights_and_piece_motion() -> None:
    runtime = (ROOT / "web" / "vf-ui" / "vf-native-scene.js").read_text(encoding="utf-8")

    assert "function entityStateEmbeddings(entity)" in runtime
    assert "function applyEntityStateEmbedding(entity, stateName)" in runtime
    assert "function assertChessHitRegionContract(cfg)" in runtime
    assert "chess interaction requires a plane_grid hit region" in runtime
    assert "chess interaction requires declared hit_regions in geom payload" in runtime
    assert "must be exclusive=true" in runtime
    assert "surface.square_highlights = chessSquareHighlightColors(runtime)" in runtime
    assert "function chessSquareFromSimplexId(runtime, simplexId)" in runtime
    assert "primitive/simplex" not in runtime
    assert "if (runtime.hoverSquare && runtime.selected)" in runtime
    assert "var previousHoverSquareKey = runtime.hoverSquare" in runtime
    assert "var nextHoverSquareKey = runtime.hoverSquare" in runtime
    assert 'var stateName = legal ? "legal" : "illegal";' in runtime
    assert "setChessSquareRegionState(runtime, runtime.hoverSquare.file, runtime.hoverSquare.rank, stateName, fallbackColor)" in runtime
    assert "function attachChessSquareVisualState(mesh, runtime)" in runtime
    assert "var hoveredPieceCandidate = target.kind === \"piece\" ? target.piece : (target.kind === \"square\" ? target.piece : null);" in runtime
    assert "runtime.hoverPiece = targetPieceIsSelectable(runtime, hoveredPieceCandidate) ? hoveredPieceCandidate : null;" in runtime
    assert "blendRgba(color, [0.34, 0.70, 1.0, 1.0], 0.38)" in runtime
    assert "blendRgba(color, [0.28, 0.78, 1.0, 1.0], 0.56)" in runtime
    assert "function chessCastleInfo(runtime, piece, toFile, toRank)" in runtime
    assert "function chessEnPassantCapturedPiece(runtime, piece, toFile, toRank)" in runtime
    assert "function recordChessLastDoublePawn(runtime, piece, fromRank, toFile, toRank)" in runtime
    assert "runtime.lastDoublePawn = null" in runtime
    assert "lastDoublePawn: runtime && runtime.lastDoublePawn ? {" in runtime
    assert "if (adf === 1 && dr === dir && chessEnPassantCapturedPiece(runtime, piece, toFile, toRank)) { return true; }" in runtime
    assert "var enPassantCaptured = chessEnPassantCapturedPiece(runtime, piece, toFile, toRank);" in runtime
    assert "delete runtime.occupied[chessSquareKey(enPassantCaptured.file, enPassantCaptured.rank)];" in runtime
    assert "queueCapturedPieceAnimation(runtime, enPassantCaptured, piece.side);" in runtime
    assert "recordChessLastDoublePawn(runtime, piece, fromRank, toFile, toRank);" in runtime
    assert "chessMoveNotation(runtime, piece, target, toFile, toRank, castle, enPassantCaptured, fromFile)" in runtime
    assert "var fromFileName = \"abcdefgh\".charAt(Math.max(0, Math.min(7, Number(fromFile || piece.file) - 1)))" in runtime
    assert "chessSquareAttackedBy(runtime, throughFile, toRank, enemySide)" in runtime
    assert "function chessWouldLeaveKingInCheck(runtime, piece, toFile, toRank)" in runtime
    assert "function chessKingInCheck(runtime, side)" in runtime
    assert "function chessSideHasLegalMove(runtime, side)" in runtime
    assert "return notation + (chessSideHasLegalMove(runtime, enemySide) ? \"+\" : \"++\")" in runtime
    assert 'notation: kingside ? "O-O" : "O-O-O"' in runtime
    assert "rook.has_moved = true" in runtime
    assert 'center[2] = Math.max(Number(center[2] || 0.0), 0.12)' in runtime
    assert 'eventName !== "down" && eventName !== "up" && eventName !== "click"' in runtime
    assert 'setEntityProp(mesh, "center", cloneEntityStateValue(entityProp(piece.mesh, "center", pieceBoardCenter(piece, 0.0))))' in runtime
    assert 'piece._animating = true' in runtime
    assert "function queueChessAnimation(runtime, piece, path, capturedPiece, options)" in runtime
    assert "queueChessAnimation(runtime, piece, [fromCenter, toCenter], null)" in runtime
    assert "function queueCapturedPieceAnimation(runtime, capturedPiece, capturerSide)" in runtime
    assert "function chessCapturedTrayCenter(runtime, piece, index)" in runtime
    assert "function chessPieceFootprintRadius(piece)" in runtime
    assert "function assignChessCapturedTraySlots(runtime, capturerSide)" in runtime
    assert "var radius = chessPieceFootprintRadius(piece);" in runtime
    assert "piece.capture_tray_center = [centerX, sideY + (row * rowDir * 0.74), Number(piece.base_z || 0.065) || 0.065];" in runtime
    assert "capture_order: Number(piece.capture_order || 0) || 0" in runtime
    assert "capture_tray_index: Number(piece.capture_tray_index || -1)" in runtime
    assert "function chessSortCapturedPieces(a, b)" in runtime
    assert "var orderDelta = (Number(a && a.capture_order || 0) || 0) - (Number(b && b.capture_order || 0) || 0);" in runtime
    assert "function startChessPromotion(runtime, piece, target, fromFile, fromRank, toFile, toRank)" in runtime
    assert "function completeChessPromotion(runtime, option)" in runtime
    assert "runtime.promotionOptionsByObjectId[String(objectId)]" in runtime
    assert "runtime.meshByObjectId[String(objectId)] = mesh" in runtime
    assert "delete runtime.meshByObjectId[String(option.object_id || 0)]" in runtime
    assert "function applyChessPieceInteractionVisual(runtime, mesh, side, hovered, selected, baseCenter)" in runtime
    assert "applyChessPieceInteractionVisual(runtime, option.mesh, option.side, hovered, false, baseCenter)" in runtime
    assert "applyChessPieceInteractionVisual(runtime, piece.mesh, piece.side, hovered, selected, pieceBoardCenter(piece, 0.0))" in runtime
    assert "selected ? 0.18 : 0.0" not in runtime
    assert "center[2] += 0.12" not in runtime
    assert 'setEntityProp(mesh, "use_vertex_color", false)' in runtime
    assert 'setEntityProp(mesh, "static_vertices", false)' in runtime
    assert "delete mesh.__vfSmoothFieldMeshVertices" in runtime
    assert "delete mesh.__vfSmoothFieldMeshVertices" in runtime
    assert "config.meshes.push(mesh)" in runtime
    assert "keepChosenPromotionMesh(runtime, option)" in runtime
    assert "rawMeshSpecs.push(option.mesh)" in runtime
    assert "baseCenter: [baseX, baseY, boardZ + promotionUnitHeight]" in runtime
    assert "baseX + (i * promotionSpacing)" in runtime
    assert "queueChessAnimation(runtime, piece, [fromCenter, abovePawnCenter, toCenter], null);" in runtime
    assert "function formatChessClock(ms)" in runtime
    assert "function setChessClockRunning(runtime, running)" in runtime
    assert "function toggleChessClock(runtime)" in runtime
    assert "runtime.clock.running !== true" in runtime
    assert "data-vf-chess-start-game" in runtime
    assert "data-vf-chess-clock-side=\"white\"" in runtime
    assert "function attachInlineClockEditor(runtime, input)" in runtime
    assert "beginInlineClockEdit(runtime, input)" in runtime
    assert "commitInlineClockEdit(runtime, input, true)" in runtime
    assert "runtime.clock.start_white_ms = Number(runtime.clock.white_ms || 0) || 0" in runtime
    assert "runtime.clock.white_ms = Number(runtime.clock.start_white_ms || runtime.clock.default_ms || 600000)" in runtime
    assert "default_ms: 600000" in runtime
    assert 'value="10:00"' in runtime
    assert "whiteClockEl.readOnly = runtime.clock.running === true" in runtime
    assert "global.prompt" not in runtime
    assert "runtime.clock.interval_id = global.setInterval" in runtime
    assert "function startChessEndAnimation(runtime, result)" in runtime
    assert "function finishChessMoveResult(runtime, moverSide)" in runtime
    assert "function chessPositionKey(runtime)" in runtime
    assert "function updateChessDrawCountersAfterMove(runtime, movedPiece, capturedPiece)" in runtime
    assert "function chessDrawRuleResult(runtime)" in runtime
    assert 'if ((Number(runtime.halfmoveClock || 0) || 0) >= 100) { return "draw"; }' in runtime
    assert "runtime.positionCounts[key]" in runtime
    assert "function chessEndMatedKing(runtime, result)" in runtime
    assert "function chessMatedKingFallPose(runtime, king)" in runtime
    assert "function mat4RotateAroundPoint(axis, angleRad, pivot, baseModel)" in runtime
    assert "function chessPieceFallContactPivot(piece, baseModel, direction, fallback)" in runtime
    assert "[2, 1], [2, -1], [-2, 1], [-2, -1]" in runtime
    assert "[1, 2], [1, -2], [-1, 2], [-1, -2]" in runtime
    assert "pivot: pivot" in runtime
    assert "axis: axis" in runtime
    assert "angle_rad: Math.PI * 0.58" in runtime
    assert "base_model: baseModel" in runtime
    assert "base_center: origin" in runtime
    assert "var pivot = chessPieceFallContactPivot(king, baseModel, dir, origin);" in runtime
    assert "var pivotRadius = Math.max" not in runtime
    assert "function finiteVec3(value, fallback)" in runtime
    assert "function fallRotationFromAxis(axis, angleRad, fallback)" in runtime
    assert "function startChessMatedKingFall(runtime)" in runtime
    assert "function chessPendingEndPieceAnimating(runtime)" in runtime
    assert "function startChessEndCenterAnimation(runtime)" in runtime
    assert "function advanceChessEndSequence(runtime, now)" in runtime
    assert "function chessAnimationEase(anim, t)" in runtime
    assert 'stage: runtime.gameOver === "draw" ? "wait_before_center" : "wait_before_fall"' in runtime
    assert "due_ms: now + 1000.0" in runtime
    assert 'runtime.endSequence.stage = "falling";' in runtime
    assert 'runtime.endSequence.stage = "centering";' in runtime
    assert "runtime.endSequence.stage = \"wait_before_center\";\n        runtime.endSequence.due_ms = now + 1000.0;" in runtime
    assert "runtime.endSequence = null;" in runtime
    assert "queueChessAnimation(runtime, matedKing, [fromCenter, fromCenter], null, {" in runtime
    assert "fall_pose: matedFallPose" in runtime
    assert 'easing: "king_fall"' in runtime
    assert "startChessMatedKingFall(runtime);" in runtime
    assert "runtime.pendingEndPieceObjectId = moveResult ? (Number(piece.object_id || 0) || 0) : 0;" in runtime
    assert "runtime.pendingEndPieceObjectId = promotionResult ? (Number(piece.object_id || 0) || 0) : 0;" in runtime
    assert "return 1.0 + (Math.sin(bounceT * Math.PI) * 0.14 * (1.0 - bounceT));" in runtime
    assert 'transform: resolveTrackedMatrix4(spec, "transform"' in runtime
    assert 'setEntityProp(mesh, "transform", cloneEntityStateValue(entityProp(piece.mesh, "transform", null)))' in runtime
    assert 'setEntityProp(anim.piece.mesh, "transform", finiteMat4(fallModel));' in runtime
    assert 'setEntityProp(anim.piece.mesh, "transform", finiteMat4(finalModel));' in runtime
    assert 'setEntityProp(anim.piece.mesh, "center", [0.0, 0.0, 0.0]);' in runtime
    assert 'setEntityProp(anim.piece.mesh, "rotation", [0.0, 0.0, 0.0]);' in runtime
    assert "mesh._modelMatrix = null;" in runtime
    assert "var fallModel = mat4RotateAroundPoint" in runtime
    assert "bake_vertices" not in runtime
    assert "source_vertices" not in runtime
    assert "transformedFieldMeshVertices" not in runtime
    assert "anim.piece.mesh._modelMatrix = mat4RotateAroundPoint" not in runtime
    assert "piece.mesh._modelMatrix = null;" in runtime
    assert "sceneWorldAnimationsPending()" in runtime
    assert "runtime.endSequence" in runtime
    assert "pendingEndResult" in runtime
    assert "endResult: String(runtime && (runtime.pendingEndResult || runtime.gameOver) || \"\")" in runtime
    assert "runtime.pendingEndResult = String(snapshot.endResult || \"\");" in runtime
    assert "runtime.pendingEndPieceObjectId = 0;" in runtime
    assert "runtime.pendingEndResult = moveResult || \"\";" in runtime
    assert "runtime.pendingEndResult = promotionResult || \"\";" in runtime
    assert "if (!runtime.gameOver && runtime.pendingEndResult)" in runtime
    assert "startChessEndAnimation(runtime, endResult);" in runtime
    assert "if (moveResult) {\n      startChessEndAnimation(runtime, moveResult);\n    }" not in runtime
    assert "if (promotionResult) {\n      startChessEndAnimation(runtime, promotionResult);\n    }" not in runtime
    assert "from_rotation: fromRotation" in runtime
    assert "to_rotation: toRotation" in runtime
    assert "setEntityProp(anim.piece.mesh, \"rotation\", [" in runtime
    assert "replaceChessPieceRoleMesh(runtime, piece, \"pawn\")" in runtime
    assert "if (!runtime.gameOver) {\n        refreshChessPieceSelectionPose(runtime);\n      }" in runtime
    assert "white_win" in runtime
    assert "black_win" in runtime
    assert "draw" in runtime
    assert "notation += chessSideHasLegalMove(runtime, enemySide) ? \"+\" : \"++\";" in runtime
    assert "function restoreChessHistory(runtime, moveIndex)" in runtime
    assert "runtime.historySnapshots[index] = chessSnapshot(runtime)" in runtime
    assert 'data-vf-chess-history-index' in runtime
    assert 'data-vf-chess-auto-switch' in runtime
    assert "function playerSideCamera(camera, side)" in runtime
    assert "playerSideCameraStates: Object.create(null)" in runtime
    assert "function activatePlayerSideCameraState(side, seedCamera)" in runtime
    assert "function applyCameraSwitch(camera)" in runtime
    assert "runtime.pendingAutoSwitchAfterAnimations = runtime.autoSwitchView === true" in runtime
    assert 'runtime.pendingAutoSwitchSide = String(runtime.turn || "white")' in runtime
    assert "startAutoSwitchCamera(renderCamera, controlState.pendingAutoSwitchSide || \"white\")" in runtime
    assert "applyChessPieceInteractionVisual(runtime, option.mesh, option.side, hovered, false, baseCenter)" in runtime
    assert "var hoverVisualChanged = false;" in runtime
    assert "if (previousHoverPromotion !== runtime.hoverPromotion)" in runtime
    assert "if (hoverVisualChanged) {\n        requestChessInteractionFrame(runtime);\n      }" in runtime
    assert "var fieldProxySize = Math.max(0.1, fieldSpanX, fieldSpanY, fieldSpanZ)" in runtime
    assert "pick_passthrough_when = \"promotion_active\"" in runtime
    assert "pick_context: {" in runtime
    assert "global.__vfGeomPickContext[String(frameSpec.frame_id || config.frame_id)]" in runtime
    assert "promotion_active: promotionActive" in runtime
    assert "function chessMeshStructureSignature()" in runtime
    assert "meshStructureSignature === visibleLastMeshStructureSignature" in runtime
    assert "runtime.animations.filter(function (anim) { return !anim || anim.piece !== piece; })" in runtime
    assert "var before = chessCapturedPiecesForSide(runtime, capturerSide);" in runtime
    assert "runtime.nextCaptureOrder += 1;" in runtime
    assert "capturedPiece.capture_order = runtime.nextCaptureOrder;" in runtime
    assert "var capturedForSide = assignChessCapturedTraySlots(runtime, capturerSide);" in runtime
    assert "if (oldIndex >= 0 && i <= oldIndex) { continue; }" in runtime
    assert "queueChessAnimation(runtime, trayPiece, [currentCenter, sortedCenter], null);" in runtime
    assert "[trayCenter[0], trayCenter[1], liftZ]" in runtime
    assert "piece.captured !== true || piece.in_capture_tray === true" in runtime
    assert "function chessPathLength(path)" in runtime
    assert "function chessMotionDurationMs(runtime, path)" in runtime
    assert "piece_motion_units_per_second" in runtime
    assert "duration_ms: Math.max(16.0, Number(options.duration_ms || 0.0) || chessMotionDurationMs(runtime, normalizedPath))" in runtime
    assert 'easing: String(options.easing || "linear")' in runtime
    assert "fall_pose: options.fall_pose && typeof options.fall_pose === \"object\" ? cloneJsonValue(options.fall_pose) : null" in runtime
    assert "var durationMs = Math.max(16.0, Number(anim.duration_ms || 0.0) || chessMotionDurationMs(runtime, anim.path));" in runtime
    assert "anim.elapsed_ms = Math.max(0.0, Number(anim.elapsed_ms || 0.0) || 0.0) + dtMs;" in runtime
    assert "var t = Math.max(0.0, Math.min(1.0, anim.elapsed_ms / durationMs));" in runtime
    assert "var easedT = chessAnimationEase(anim, t);" in runtime
    assert "var path = Array.isArray(anim.path) && anim.path.length >= 2 ? anim.path : [anim.from, anim.to];" in runtime
    assert "var remainingDistance = easedT * totalLength;" in runtime
    assert "function currentSceneWorldDirtyVersion()" in runtime
    assert "function sceneWorldAnimationsPending()" in runtime
    assert "function applySceneWorldFrame(seconds)" in runtime
    assert "var rawMeshSpecs = Array.isArray(config.meshes) ? config.meshes.slice() : [];" in runtime
    assert "function sceneWorldMeshStructureSignature()" in runtime
    assert "if (useVisibleFrame && sceneWorldAnimationsPending() && visibleRenderBackpressureActive())" in runtime
    assert "function chessLagDebugEnabled()" in runtime
    assert "if (!chessLagDebugEnabled()) { return; }" in runtime
    assert "camera_request_coalesced" in runtime
    assert "render_camera_only" in runtime
    assert "renderOptions.mirror_source_scale" in runtime
    assert "renderOptions.mirror_source_max_px" in runtime
    assert ": 1.0" in runtime
    assert "function visibleRenderBackpressureActive()" in runtime
    assert "function ensureVisibleSceneFrameShell()" in runtime
    assert "global.VfFrame.mount(layer" in runtime
    assert "function chessPlayerModes(runtime)" in runtime
    assert 'failFast("chess interaction requires player_modes in the VKF contract")' in runtime
    assert "data-vf-chess-player-mode" in runtime
    assert "runtime.playerModeSpec = chessPlayerModeById(runtime, runtime.playerMode);" in runtime
    assert "function scheduleChessBotTurn(runtime, delayMs)" in runtime
    assert "Math.max(2000, Number(cfg.bot_min_think_ms || 2000) || 2000)" in runtime
    assert "function chessBotBestMove(runtime)" in runtime
    assert "function chessBotMinimaxScore(runtime, depth, perspective, alpha, beta)" in runtime
    assert "var maxDepth = Math.max(1, Math.min(6, Number(cfg.bot_search_plies || 4) || 4));" in runtime
    assert "function chessBotSearchTimedOut(context)" in runtime
    assert "function chessBotStaticExchangeScore(runtime, move)" in runtime
    assert "function chessBotQuiescenceScore(runtime, perspective, alpha, beta, context, qDepth)" in runtime
    assert "function chessBotPieceSafetyScore(runtime, piece)" in runtime
    assert "function chessBotBishopPairScore(runtime, side)" in runtime
    assert "function chessBotMatingNetScore(runtime, side)" in runtime
    assert "function chessBotKingTropismScore(runtime, side)" in runtime
    assert "function chessBotChooseEquivalentBestMove(runtime, scoredMoves)" in runtime
    assert "bot_random_equal_cp" in runtime
    assert "if (equivalents.length > 10) { equivalents = equivalents.slice(0, 10); }" in runtime
    assert "function chessBotPreMoveStrategicAdjustment(runtime, move, perspective)" in runtime
    assert "function chessBotPostMoveStrategicAdjustment(runtime, movedPiece, perspective, wasInCheck)" in runtime
    assert "function chessBotOpeningPieceScore(runtime, piece)" in runtime
    assert "runtime.botPendingPromotionRole = String(move.promotionRole || \"\");" in runtime
    assert "scheduleChessBotTurn(runtime, chessBotDelayMs(runtime));" in runtime
    assert "var shellAspect = chessInteractionConfig() ? null : (frameSpec.aspect != null ? String(frameSpec.aspect) : null);" in runtime
    assert 'String(frameSpec && frameSpec.aspect || "").toLowerCase() === "equal" && !chessInteractionConfig()' in runtime
    assert "exitWhenLastFrameClosed: true" in runtime
    assert "function ensureChessRuntimeEventsAttached()" in runtime
    assert "function scheduleVisibleInitialSceneRender()" in runtime
    assert "function mountResponsiveVisibleShell()" in runtime
    assert "postVisibleShellLayout();" in runtime
    assert runtime.index("mountResponsiveVisibleShell();") < runtime.index("global.requestAnimationFrame(startInitialSceneRender);")
    assert 'if (typeof global.requestIdleCallback === "function")' in runtime
    assert "global.requestIdleCallback(start, { timeout: 600 });" in runtime
    assert "global.setTimeout(start, 120);" in runtime
    assert 'sceneFrame.setAttribute("data-vf-chess-board-frame", "1")' in runtime
    assert 'sceneFrameBody.appendChild(panel)' in runtime
    assert 'panel.classList.add("vf-chess-panel--in-frame")' in runtime
    assert "function attachChessPanelToSceneFrame(runtime, sceneFrame, sceneFrameBody, controlsFrameClass)" in runtime
    assert "attachChessPanelToSceneFrame(runtime, sceneFrame, sceneFrameBody, controlsFrameClass)" in runtime
    assert "ensureChessBoardHost(sceneFrameBody)" in runtime
    assert 'runtime.panelBody.classList.remove("vf-chess-panel--fallback")' in runtime
    assert 'typeof global.VfDisplay.mountDynamicGeomFrame === "function"' in runtime
    assert "function markChessSceneDirty(runtime)" in runtime
    assert "function updateVisibleCameraOnly(camera, options)" in runtime
    assert "function chessViewportElement(bodyEl)" in runtime
    assert "function resizeChessViewportToFit(bodyEl)" in runtime
    assert 'global.addEventListener("vf-frame-live-resize"' in runtime
    assert "controlState.requestCameraFrame = function ()" in runtime
    assert "controlState.cameraFramePending = true" in runtime
    assert "continuationFramePending" in runtime
    assert "function scheduleNextFrameIfNeeded(animationActive)" in runtime
    assert "if (cameraKeysActive()) {\n        ensureCameraHoldLoop(controlState);\n        return;\n      }" in runtime
    assert "animationActive === true || cameraSwitchActive()" in runtime
    assert "cameraKeyLastTsMs" in runtime
    assert "cameraKeyStepPending" in runtime
    assert "cameraKeyStepCount" not in runtime
    assert "requestCameraHoldFrame" in runtime
    assert "global.setTimeout(function () {\n        state.cameraHoldLoopPending = false;" in runtime
    assert "state.requestCameraHoldFrame();" in runtime
    assert "activeState.requestCameraHoldFrame();" in runtime
    assert "if (visibleRenderBackpressureActive()) {\n        controlState.cameraFrameDirty = true;\n        return;\n      }" not in runtime
    assert "var keyHoldActive = cameraKeysActive();" in runtime
    assert "controlState.cameraKeyStepCount = Math.min(8" not in runtime
    assert "var queuedKeySteps = Math.max(0, Number(controlState.cameraKeyStepCount || 0) || 0);" not in runtime
    assert "controlState.cameraKeyStepPending = true;" not in runtime
    assert "if (keyHoldActive && controlState.cameraKeyStepPending === true && visibleRenderBackpressureActive())" not in runtime
    assert "if (keyHoldActive) {" in runtime
    assert "if (useVisibleFrame && keyHoldActive && visibleRenderBackpressureActive())" in runtime
    backpressure_guard = runtime.index("if (useVisibleFrame && keyHoldActive && visibleRenderBackpressureActive())")
    orbit_mutation = runtime.index("controlState.orbitPhi += deltaPhi;", backpressure_guard)
    assert backpressure_guard < orbit_mutation
    assert "controlState.cameraKeyLastTsMs = nowMs;\n            controlState.cameraKeyStepPending = false;\n            controlState.rendering = false;\n            ensureCameraHoldLoop(controlState);\n            return;" in runtime
    assert "var keyElapsedSec = controlState.cameraKeyLastTsMs > 0.0" in runtime
    assert "var keyDtSec = Math.max(1.0 / 240.0, Math.min(1.0 / 120.0, keyElapsedSec || (1.0 / 120.0)))" in runtime
    assert "controlState.cameraKeyStepPending = false;" in runtime
    assert "activeState.cameraKeyLastTsMs = global.performance" in runtime
    assert "Math.min(1.0 / 30.0" in runtime
    assert "var worldAnimationActive = dependencySourceFrameId" in runtime
    assert "? sceneWorldAnimationsPending()\n          : applySceneWorldFrame(seconds);" in runtime
    assert "var heldCameraKeyActive = cameraKeysActive();" in runtime
    assert "function renderFrameDependentsBeforePresent()" in runtime
    assert "if (heldCameraKeyActive && useVisibleFrame && visibleSpec) {" in runtime
    held_camera_path = runtime.index("if (heldCameraKeyActive && useVisibleFrame && visibleSpec) {")
    held_camera_trigger = runtime.index("renderFrameDependentsBeforePresent();", held_camera_path)
    held_camera_update = runtime.index("updateVisibleCameraOnly(renderCamera, { immediate: true })", held_camera_path)
    assert held_camera_trigger < held_camera_update
    assert 'could not present immediately' in runtime
    assert 'typeof activeState.requestCameraFrame === "function"' in runtime
    assert 'typeof state.requestCameraFrame === "function"' in runtime
    assert "function smoothInterpolatedFieldMeshVertices(spec, vertices, indices, enabled)" in runtime
    assert "var areaWeight = Math.max(1e-6, Math.sqrt((cx * cx) + (cy * cy) + (cz * cz)))" in runtime
    assert "global.__vfSmoothFieldMeshVerticesByKey[cacheKey]" in runtime
    assert "function resolveRawMeshById(rawMeshes, meshId, purpose)" in runtime
    assert "normalizeMeshSpec(resolveRawMeshById(rawMeshes, mirrorMeshId" in runtime
    assert "rawMeshSpecs = rawMeshSpecs.map(function (mesh)" in runtime
    assert "return attachChessSquareVisualState(mesh, chessRuntime)" in runtime
    assert "updateChessBoardHighlightsFast(runtime)" in runtime
    assert "setEntityProp(mesh, \"pickable\", false)" in runtime
    assert "spec.__vfSmoothFieldMeshVertices = out" in runtime
    assert "vertices: fieldVertices" in runtime
    assert "indices: fieldIndices" in runtime
    assert 'pickable: entityProp(spec, "pickable", true) !== false' in runtime
    assert 'static_vertices: entityProp(spec, "static_vertices", false) === true' in runtime
    assert 'static_indices: entityProp(spec, "static_indices", false) === true' in runtime
    assert "var canUseVisibleCameraOnly = cameraOnlyFastPathEnabled && useVisibleFrame && !worldAnimationActive && visibleSpec && dirtyVersion === visibleLastDirtyVersion && meshStructureSignature === visibleLastMeshStructureSignature;" in runtime
    assert "triggerFrameDependents(String(frameSpec.frame_id || config.frame_id), { immediate: true });" in runtime
    assert 'requires immediate source-synchronous rendering' in runtime
    assert "global.requestAnimationFrame(flushDependentMirrorFrame)" not in runtime
    assert "dependentMirrorFramePending" not in runtime
    assert "function publishLiveCamera(renderCamera, markerReferenceHeightPx, markerSizeCamera)" in runtime
    assert "renderCamera = applyCameraSwitch(renderCamera);\n        publishLiveCamera(renderCamera, markerReferenceHeightPx, markerSizeCamera);" in runtime
    camera_only_path = runtime.index("if (canUseVisibleCameraOnly) {")
    camera_only_trigger = runtime.index("renderFrameDependentsBeforePresent();", camera_only_path)
    camera_only_update = runtime.index("updateVisibleCameraOnly(renderCamera, { immediate: heldCameraKeyActive })", camera_only_path)
    assert camera_only_trigger < camera_only_update
    full_render_trigger = runtime.index("if (useVisibleFrame) {\n          triggerFrameDependents(String(frameSpec.frame_id || config.frame_id), { immediate: true });\n        }\n        var rendered = renderPayload")
    full_render_payload = runtime.index("var rendered = renderPayload(renderCamera, seconds, { skipChessInteraction: true });", full_render_trigger)
    assert full_render_trigger < full_render_payload
    assert "requestLinkedMirrorTextureFrameForSource(String(frameSpec.frame_id || config.frame_id));" not in runtime
    assert "_skip_render" not in runtime
    assert "updateVisibleCameraOnly(renderCamera, { immediate: heldCameraKeyActive })" in runtime
    assert "function updateOffscreenCameraOnly(camera, options)" in runtime
    assert "updateOffscreenCameraOnly(renderCamera, { immediate: dependencySourceFrameId ? true : heldCameraKeyActive })" in runtime
    assert "cameraOnlyUpdates" in runtime
    assert "fullSceneUpdates" in runtime
    assert "var nextVisibleSpec = Object.assign({}, geomPayload)" in runtime
    assert "vertices: numericArrayLike(mesh.vertices) ? mesh.vertices : []" in runtime
    assert "indices: numericArrayLike(mesh.indices) ? mesh.indices : []" in runtime
    assert "static_vertices: true" in runtime
    assert "static_indices: true" in runtime
    display_runtime = (ROOT / "web" / "vf-ui" / "vf-display.js").read_text(encoding="utf-8")
    assert "pick_passthrough_when" in display_runtime
    assert "geomSpec.pick_context" in display_runtime
    assert "function geomPickContextFlag(fid, geomSpec, key)" in display_runtime
    assert "global.__vfGeomPickContext" in display_runtime
    assert "function declaredHitRegionsBlockMeshPick(geomSpec, fid)" in display_runtime
    assert "declaredHitRegionsBlockMeshPick(liveGeomSpec, fid)" in display_runtime
    assert "function updateDynamicGeomFrameCamera(fid, camera, lights, lightFlares, options)" in display_runtime
    assert "(renderer._offscreenFrame === true || options.immediate === true)" in display_runtime
    assert "function dynamicGeomFrameHasRenderBackpressure(fid)" in display_runtime
    assert "dynamicGeomFrameHasRenderBackpressure: dynamicGeomFrameHasRenderBackpressure" in display_runtime
    geom_runtime = (ROOT / "web" / "vf-ui" / "geom" / "vf-geom-wgpu.js").read_text(encoding="utf-8")
    assert "function createChessFontAtlas(device)" in geom_runtime
    assert "NotoSans-Regular-chess-sdf.png" in geom_runtime
    assert "fn chessCoordLabelMask(localPos: vec3<f32>) -> f32" in geom_runtime
    assert "textureSampleLevel(fontAtlas, fontSampler, atlasUv, 0.0).r" in geom_runtime
    assert "return smoothstep(0.42, 0.58, distanceValue);" in geom_runtime
    assert 'var chessBoardHost = body.querySelector(".vf-chess-board-host")' in display_runtime
    assert "function resizeChessBoardHostToFit(hostEl)" in display_runtime
    assert "var hostEl = resizeChessBoardHostToFit(canvas.parentElement || canvas);" in display_runtime
    assert 'global.addEventListener("vf-frame-live-resize"' in display_runtime
    assert 'var liveFrameId = String(detail.frameId || detail.id || "");' in display_runtime
    assert 'var liveFrameId = String(detail.frameId || detail.id || "");' in runtime
    assert "liveFrameId !== String(geomTargetFrameId(fid)) && liveFrameId !== String(fid)" in display_runtime
    assert "rec.dynamicAdapter.onHostResize(liveHost.clientWidth || 0, liveHost.clientHeight || 0);" in display_runtime
    assert "if (r && typeof r.onResize === \"function\")" in display_runtime
    assert "entry.resizeRaf = requestAnimationFrame" not in display_runtime
    assert 'phase: "move"' in (ROOT / "web" / "vf-ui" / "vf-frame.js").read_text(encoding="utf-8")
    assert 'phase: "end"' in (ROOT / "web" / "vf-ui" / "vf-frame.js").read_text(encoding="utf-8")
    assert "window.__vfFrameResizeClockPaused = true;" in (ROOT / "web" / "vf-ui" / "vf-frame.js").read_text(encoding="utf-8")
    assert "window.__vfFrameResizeClockPaused = false;" in (ROOT / "web" / "vf-ui" / "vf-frame.js").read_text(encoding="utf-8")
    assert 'if (String(detail.phase || "") === "move") { return; }' not in runtime
    assert "updateVisibleCameraOnly(resizeCamera" not in runtime
    assert "resizeClockPausedTotalMs" in runtime
    assert "textureFit" not in display_runtime
    assert "resizeDeferred" not in display_runtime
    assert "function syncCanvasStyle(canvas, size)" in display_runtime
    assert "syncCanvasSize(canvas, { deferStyle: true })" in display_runtime
    assert display_runtime.index("var liveSize = syncCanvasSize(canvas, { deferStyle: true });") < display_runtime.index("syncCanvasStyle(canvas, liveSize);")
    assert "function ensureResizeSnapshot(canvas)" not in display_runtime
    assert "function attachGeomCanvasPresentationSwap(canvas)" not in display_runtime
    assert "vf-geom-frame-presented" not in display_runtime
    assert "vf-geom-frame-presented" not in geom_runtime
    assert "canvas.__vfPendingResizeSnapshotRemoval" not in display_runtime
    assert "removeResizeSnapshot(canvas);" not in display_runtime
    assert 'data-vf-geom-resize-pending' not in display_runtime
    assert 'data-vf-geom-resize-pending' not in geom_runtime
    assert display_runtime.index("if (canvas.width  !== w)") < display_runtime.index("canvas.style.width = w + \"px\";")
    assert "options.forceResize !== true" in geom_runtime
    assert "this._renderContent(performance.now(), { forceResize: true })" in geom_runtime
    assert 'id: String(id),' in (ROOT / "web" / "vf-ui" / "vf-frame.js").read_text(encoding="utf-8")
    frame_css = (ROOT / "web" / "vf-ui" / "vf-frame.css").read_text(encoding="utf-8")
    assert "canvas.vf-geom-canvas" in frame_css
    assert "object-fit: contain;" in frame_css
    assert "object-fit:contain;object-position:center center;" in display_runtime
    assert "function frameContentAspectMode(frameEl)" in display_runtime
    assert "dataset.vfContentAspect" in display_runtime
    assert 'hostOwnsViewport = !!(hostEl && hostEl.classList && hostEl.classList.contains("vf-chess-board-host"))' in display_runtime
    assert 'if (!hostOwnsViewport && frameContentAspectMode(frameEl) === "equal")' in display_runtime
    assert "frameAspectMode(frameEl) === \"equal\"" not in display_runtime
    assert "self._resizeRaf = requestAnimationFrame" not in geom_runtime
    assert "function cameraProjectionMatrixMatchesRenderAspect(camera, renderAspect)" in geom_runtime
    assert "projection_matrix.length === 16 && cameraProjectionMatrixMatchesRenderAspect(cam, asp)" in geom_runtime
    assert "projection_matrix.length === 16 && cameraProjectionMatrixMatchesRenderAspect(camPart, aspect)" in geom_runtime
    assert "delete nextCamera.projection_matrix;" in runtime
    stager_runtime = (ROOT / "compiler" / "native" / "vkf_native_scene_artifact_stager.cpp").read_text(encoding="utf-8")
    shell_runtime = (ROOT / "web" / "vf-ui" / "vf-runtime-shell.js").read_text(encoding="utf-8")
    assert "vf-launch-manifest.json" in stager_runtime
    assert "native_scene_launch_manifest_json" in stager_runtime
    assert "mountLaunchFramesFromUrl" in stager_runtime
    assert "function mountLaunchFrames(manifest)" in shell_runtime
    assert "function mountLaunchFramesFromUrl(url)" in shell_runtime
    assert "launch manifest requires VfFrame.mount" in shell_runtime
    assert "window.__vfNativeSceneShell=" not in stager_runtime
    assert "function mountShell()" not in stager_runtime
    assert "data-vf-chess-preload-panel" not in stager_runtime
    assert "querySelector(\"[data-vf-chess-preload-panel]\")" not in runtime
    assert 'id: controlsFrameId' not in runtime
    assert 'title: "Moves",' not in runtime
    assert "chess controls require the scene frame shell before panel mount" in runtime
    assert display_runtime.count("ensureGeomCanvas(frameEl, 0, fid)") >= 3
    assert "ensureGeomCanvas(frameEl, 0);" not in display_runtime
    assert "function currentGeomEventHost()" in display_runtime
    assert "var eventHost = currentGeomEventHost()" in display_runtime
    assert "function geomLiveCanvasPickRect(rec, fallbackRect)" in display_runtime
    assert "var pickRect = geomLiveCanvasPickRect(rec, frameRect)" in display_runtime
    assert "var regionHit = pickDeclaredHitRegion(fid, liveGeomSpec, eventHost, req.clientX, req.clientY, pickRect)" in display_runtime
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
    assert "fn fs_pick() -> @location(0) vec2<u32>" in renderer_runtime
    assert "return vec2<u32>(pk.object_id, 0u)" in renderer_runtime
    assert "fn screenSquareHighlight(localPos: vec3<f32>)" in renderer_runtime
    assert "let boardSpan = max(sc.texture_params.yz, vec2<f32>(1e-4, 1e-4));" in renderer_runtime
    assert "let boardUv = vec2<f32>(" in renderer_runtime
    assert "clamp((localPos.x / boardSpan.x) + 0.5, 0.0, 0.9999)" in renderer_runtime
    assert "surfaceSystem.square_highlights" in renderer_runtime
    assert "let highlightedFixedTextureLayer = mix(" in renderer_runtime
    assert "let materialBase = mix(base, highlightedFixedTextureLayer, hasBaseTexture);" in renderer_runtime
    assert "surfaceSystem._runtime_texture_ready = !!part.surfaceExternalView" in renderer_runtime
    assert "if (surfaceSystem.flip_x === true) { screenFlags += 2.0; }" in renderer_runtime
    assert "surfaceSystem.flip_x === true || surfaceSystem._renderFlipU === true" not in renderer_runtime
    assert 'frame_ref "\' + sourceFrameId + \'" has no ready texture view' not in renderer_runtime
    assert "textureKind = 4.0" in renderer_runtime
    assert "surfaceTextureReady && surfaceSystem" in renderer_runtime
    assert "textureKind = fixedSurfaceTextureKind > 0.0 ? fixedSurfaceTextureKind : 0.0" not in renderer_runtime
    assert "(meshLike.alpha_mul == null ? meshLike.alpha : meshLike.alpha_mul)" in renderer_runtime
    assert "if (partMesh.visible === false) { return; }" in renderer_runtime
    assert "if (partMesh && partMesh.visible === false)" in renderer_runtime
    assert "if (sceneSourceBackups) {" in renderer_runtime
    assert "renderer._offscreenFrame === true" in display_runtime
    assert "renderer._renderContent(performance.now())" in display_runtime
    assert "immediate render failed" in display_runtime
    assert "updateDynamicGeomFrameCamera offscreen render" in display_runtime
    assert "updateDynamicGeomFrameCamera: updateDynamicGeomFrameCamera" in display_runtime
    assert "triggerFrameDependents(String(frameSpec.frame_id || config.frame_id));" not in runtime


def test_native_scene_waits_for_packet_owned_visible_frame() -> None:
    runtime = (ROOT / "web" / "vf-ui" / "vf-native-scene.js").read_text(encoding="utf-8")
    assert "function sceneFrameShellIsPacketOwned()" in runtime
    assert "return global.__vfNativeSceneFramesArePacketOwned === true;" in runtime
    assert "if (sceneFrameShellIsPacketOwned()) { return null; }" in runtime
    assert "if (!frame && sceneFrameVisible() && !sceneFrameShellIsPacketOwned())" in runtime
    assert 'failFast("timed out waiting for packet-owned scene frame");' in runtime


def test_native_scene_game_camera_mouse_right_turns_right_and_locks_page_root() -> None:
    runtime = (ROOT / "web" / "vf-ui" / "vf-native-scene.js").read_text(encoding="utf-8")
    assert "activeState.gameYaw -= dx * sensitivity;" in runtime
    assert 'type: "transparent-overlay.cursor"' in runtime
    assert 'cursor: enabled ? "none" : "auto"' in runtime
    assert "var overlayHostCursor = !!(global.chrome && global.chrome.webview" in runtime
    assert "global.document.documentElement" in runtime
    assert "var lockTarget = body || frame;" not in runtime


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
