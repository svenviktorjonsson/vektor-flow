import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
GENERATOR = ROOT / "native" / "VfOverlay" / "tools" / "generate_embedded_vf_ui_assets.py"


def _load_generator():
    spec = importlib.util.spec_from_file_location("generate_embedded_vf_ui_assets", GENERATOR)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_embedded_vf_ui_assets_exclude_generated_sessions() -> None:
    generator = _load_generator()

    assert generator.should_embed("vf-frame.js") is True
    assert generator.should_embed("vf-native-scene.js") is True
    assert generator.should_embed("geom/vf-geom-ledger.js") is True
    assert generator.should_embed("geom/vf-geom-ledger-layout.js") is True
    assert generator.should_embed("geom/vf-geom-ledger-transport.js") is True
    assert generator.should_embed("geom/vf-geom-parametric-surface.js") is True
    assert generator.should_embed("geom/vf-geom-wgpu.js") is True
    assert generator.should_embed("assets/fonts/NotoSans-Regular-chess-sdf.png") is True
    assert generator.should_embed("assets/fonts/NotoSans-Regular.ttf") is False
    assert generator.should_embed("katex/katex.min.js") is False
    assert generator.should_embed("vf-widgets.js") is False
    assert generator.should_embed("sessions/main/vkf-scene.html") is False
    assert generator.should_embed("sessions/main/vf-native-scene-configs-deadbeef.json") is False
