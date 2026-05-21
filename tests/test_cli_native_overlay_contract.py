from __future__ import annotations

from pathlib import Path

from vektorflow import cli


def test_try_run_native_overlay_scene_dispatches_contract_path(monkeypatch, tmp_path: Path) -> None:
    path = tmp_path / "scene.contract.json"
    path.write_text("{}\n", encoding="utf-8")
    called: list[tuple[str, Path]] = []

    def fake_try_run_contract(resolved: Path) -> int | None:
        called.append(("contract", resolved))
        return 0

    def fake_try_run_source(resolved: Path) -> int | None:
        called.append(("source", resolved))
        return 0

    monkeypatch.setattr(
        "vektorflow.native_overlay_scene_runtime.try_run_native_overlay_scene_contract",
        fake_try_run_contract,
    )
    monkeypatch.setattr(
        "vektorflow.native_overlay_scene_runtime.try_run_native_overlay_scene",
        fake_try_run_source,
    )

    rc = cli._try_run_native_overlay_scene(path)
    assert rc == 0
    assert called == [("contract", path.resolve())]


def test_try_run_native_overlay_scene_dispatches_vkf_source_path(monkeypatch, tmp_path: Path) -> None:
    path = tmp_path / "scene.vkf"
    path.write_text('native_scene: (kind: "scene_3d")\n', encoding="utf-8")
    called: list[tuple[str, Path]] = []

    def fake_try_run_contract(resolved: Path) -> int | None:
        called.append(("contract", resolved))
        return 0

    def fake_try_run_source(resolved: Path) -> int | None:
        called.append(("source", resolved))
        return 0

    monkeypatch.setattr(
        "vektorflow.native_overlay_scene_runtime.try_run_native_overlay_scene_contract",
        fake_try_run_contract,
    )
    monkeypatch.setattr(
        "vektorflow.native_overlay_scene_runtime.try_run_native_overlay_scene",
        fake_try_run_source,
    )

    rc = cli._try_run_native_overlay_scene(path)
    assert rc == 0
    assert called == [("source", path.resolve())]

