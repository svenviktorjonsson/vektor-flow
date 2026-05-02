from __future__ import annotations

from pathlib import Path

import pytest

from vektorflow.release_bundle import (
    build_release_manifest,
    default_release_channel_for_platform,
    default_release_output_dir,
    release_channel,
    release_channels,
    release_demo_launchers,
    release_readme_text,
    release_sample_sources,
)


def test_release_channels_expose_expected_names() -> None:
    assert [channel.name for channel in release_channels()] == [
        "linux-browser",
        "macos-browser",
        "windows-overlay",
    ]


@pytest.mark.parametrize(
    ("platform", "expected"),
    [
        ("win32", "windows-overlay"),
        ("darwin", "macos-browser"),
        ("linux", "linux-browser"),
    ],
)
def test_default_release_channel_for_platform(platform: str, expected: str) -> None:
    assert default_release_channel_for_platform(platform).name == expected


def test_unknown_release_channel_raises_helpful_error() -> None:
    with pytest.raises(ValueError, match="unknown release channel"):
        release_channel("nope")


def test_release_manifest_tracks_channel_contract() -> None:
    channel = release_channel("windows-overlay")
    manifest = build_release_manifest(
        channel=channel,
        version="0.1.0",
        include_extension=True,
        include_overlay=True,
        include_ui_assets=True,
        samples=("samples/hello.vkf",),
    )
    assert manifest["channel"] == "windows-overlay"
    assert manifest["entrypoint"] == "vkf.exe"
    assert manifest["ui_modes"] == ["overlay", "browser", "headless"]
    assert manifest["artifacts"]["overlay_binary_included"] is True
    assert manifest["artifacts"]["extension_vsix_included"] is True
    assert manifest["artifacts"]["testing_guide"] == "TESTING.md"
    assert manifest["artifacts"]["demo_launchers"] == [
        "run-shared-runtime-demo.ps1",
        "run-shared-runtime-demo.sh",
    ]
    assert manifest["tester_onboarding"]["vscode_supported"] is True
    assert "hello, world" in manifest["tester_onboarding"]["smoke_command"]


def test_release_readme_text_mentions_bundle_manifest_and_ui_modes() -> None:
    channel = release_channel("linux-browser")
    text = release_readme_text(channel, "0.1.0", "vektorflow-release.json")
    assert "linux-browser" in text
    assert "browser, headless" in text
    assert "vektorflow-release.json" in text
    assert "no native transparent overlay host is bundled" in text
    assert "Python-free shared-runtime UI demo" in text
    assert "TESTING.md" in text
    assert "./vkf -e ':: \"hello, world\"'" in text


def test_release_sample_sources_point_at_user_facing_examples(tmp_path: Path) -> None:
    root = tmp_path
    examples = root / "examples"
    examples.mkdir()
    (examples / "hello.vkf").write_text(':: "hello"', encoding="utf-8")
    (examples / "core_language_tour.vkf").write_text(':: "tour"', encoding="utf-8")
    sample_names = [path.name for path in release_sample_sources(root)]
    assert sample_names == ["hello.vkf", "core_language_tour.vkf"]


def test_default_release_output_dir_is_under_dist_releases(tmp_path: Path) -> None:
    assert default_release_output_dir(tmp_path) == tmp_path / "dist" / "releases"


def test_release_demo_launchers_point_at_python_free_demo_scripts(tmp_path: Path) -> None:
    scripts = tmp_path / "scripts"
    scripts.mkdir()
    (scripts / "run-shared-runtime-demo.ps1").write_text("ok", encoding="utf-8")
    (scripts / "run-shared-runtime-demo.sh").write_text("ok", encoding="utf-8")
    launcher_names = [path.name for path in release_demo_launchers(tmp_path)]
    assert launcher_names == ["run-shared-runtime-demo.ps1", "run-shared-runtime-demo.sh"]
