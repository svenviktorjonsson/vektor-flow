import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


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
