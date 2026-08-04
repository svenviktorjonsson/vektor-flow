from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CMAKE_LISTS = ROOT / "native" / "VfOverlay" / "CMakeLists.txt"
GENERATOR = ROOT / "native" / "VfOverlay" / "tools" / "generate_embedded_vf_ui_assets.cmake"
OLD_PYTHON_GENERATOR = ROOT / "native" / "VfOverlay" / "tools" / "generate_embedded_vf_ui_assets.py"


def test_embedded_vf_ui_assets_generator_is_cmake_native() -> None:
    cmake_lists = CMAKE_LISTS.read_text(encoding="utf-8")

    assert not OLD_PYTHON_GENERATOR.exists()
    assert "find_package(Python3" not in cmake_lists
    assert "Python3_EXECUTABLE" not in cmake_lists
    assert "generate_embedded_vf_ui_assets.py" not in cmake_lists
    assert "generate_embedded_vf_ui_assets.cmake" in cmake_lists
    assert '"${CMAKE_COMMAND}"' in cmake_lists


def test_embedded_vf_ui_assets_exclude_generated_sessions() -> None:
    generator = GENERATOR.read_text(encoding="utf-8")

    assert 'if(rel MATCHES "^sessions/")' in generator
    assert 'if(rel MATCHES "^katex/fonts/[^/]+$")' in generator
    assert '"vf-frame.js"' in generator
    assert '"vf-native-scene.js"' in generator
    assert '"vf-widgets.js"' in generator
    assert '"katex/katex.min.js"' in generator
    assert '"geom/vf-geom-ledger.js"' in generator
    assert '"geom/vf-geom-ledger-layout.js"' in generator
    assert '"geom/vf-geom-ledger-transport.js"' in generator
    assert '"geom/vf-geom-parametric-surface.js"' in generator
    assert '"geom/vf-geom-wgpu.js"' in generator
    assert '"assets/fonts/NotoSans-Regular-chess-sdf.png"' in generator
    assert '"assets/fonts/NotoSans-Regular.ttf"' not in generator
