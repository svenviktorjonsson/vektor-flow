from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class ReleaseChannelSpec:
    name: str
    host_platform: str
    ui_modes: tuple[str, ...]
    overlay_required: bool
    executable_name: str
    release_kind: str


_CHANNELS: dict[str, ReleaseChannelSpec] = {
    "windows-overlay": ReleaseChannelSpec(
        name="windows-overlay",
        host_platform="win32",
        ui_modes=("overlay", "browser", "headless"),
        overlay_required=True,
        executable_name="vkf.exe",
        release_kind="beta",
    ),
    "macos-browser": ReleaseChannelSpec(
        name="macos-browser",
        host_platform="darwin",
        ui_modes=("browser", "headless"),
        overlay_required=False,
        executable_name="vkf",
        release_kind="beta",
    ),
    "linux-browser": ReleaseChannelSpec(
        name="linux-browser",
        host_platform="linux",
        ui_modes=("browser", "headless"),
        overlay_required=False,
        executable_name="vkf",
        release_kind="beta",
    ),
}

_PLATFORM_DEFAULTS = {
    "win32": "windows-overlay",
    "darwin": "macos-browser",
    "linux": "linux-browser",
}


def release_channel(name: str) -> ReleaseChannelSpec:
    try:
        return _CHANNELS[name]
    except KeyError as exc:
        known = ", ".join(sorted(_CHANNELS))
        raise ValueError(f"unknown release channel {name!r}; expected one of: {known}") from exc


def release_channels() -> tuple[ReleaseChannelSpec, ...]:
    return tuple(_CHANNELS[name] for name in sorted(_CHANNELS))


def default_release_channel_for_platform(platform: str) -> ReleaseChannelSpec:
    try:
        return release_channel(_PLATFORM_DEFAULTS[platform])
    except KeyError as exc:
        raise ValueError(f"unsupported platform for release bundling: {platform!r}") from exc


def default_release_output_dir(root: Path) -> Path:
    return root / "dist" / "releases"


def release_sample_sources(root: Path) -> tuple[Path, ...]:
    return (
        root / "examples" / "01_hello.vkf",
        root / "examples" / "100_axis_4_panel.vkf",
        root / "examples" / "110_mirror_showcase.vkf",
    )


def release_demo_launchers(root: Path) -> tuple[Path, ...]:
    return (
        root / "scripts" / "run-shared-runtime-demo.ps1",
        root / "scripts" / "run-shared-runtime-demo.sh",
    )


def release_native_tool_sources(root: Path, channel: ReleaseChannelSpec) -> dict[str, tuple[Path, ...]]:
    json_source = root / "native" / "VfOverlay" / "vf" / "json.cpp"
    exe_suffix = ".exe" if channel.host_platform == "win32" else ""
    return {
        f"{channel.executable_name}": (
            root / "compiler" / "native" / "vkf_driver_artifact_smoke.cpp",
            json_source,
        ),
        f"vf-browser-server{exe_suffix}": (
            root / "compiler" / "native" / "vf_browser_server_smoke.cpp",
        ),
        f"vkf_lexer_cursor_smoke{exe_suffix}": (
            root / "compiler" / "native" / "vkf_lexer_cursor_smoke.cpp",
        ),
        f"vkf_parser_token_stream_smoke{exe_suffix}": (
            root / "compiler" / "native" / "vkf_parser_token_stream_smoke.cpp",
            json_source,
        ),
        f"vkf_ast_to_ir_smoke{exe_suffix}": (
            root / "compiler" / "native" / "vkf_ast_to_ir_smoke.cpp",
            json_source,
        ),
        f"vkf_compiler_artifact_smoke{exe_suffix}": (
            root / "compiler" / "native" / "vkf_compiler_artifact_smoke.cpp",
            json_source,
        ),
    }


def build_release_manifest(
    *,
    channel: ReleaseChannelSpec,
    version: str,
    include_extension: bool,
    include_overlay: bool,
    include_ui_assets: bool,
    samples: tuple[str, ...],
) -> dict[str, Any]:
    smoke_argv = (
        [f".\\{channel.executable_name}", "-e", ':: "hello, world"']
        if channel.host_platform == "win32"
        else [f"./{channel.executable_name}", "-e", ':: "hello, world"']
    )
    smoke_command = (
        f".\\{channel.executable_name} -e ':: \"hello, world\"'"
        if channel.host_platform == "win32"
        else f"./{channel.executable_name} -e ':: \"hello, world\"'"
    )
    extension_path = "extensions" if include_extension else None
    testing_guide = "TESTING.md"
    demo_launchers = (
        ["run-shared-runtime-demo.ps1", "run-shared-runtime-demo.sh"]
        if include_ui_assets
        else []
    )
    return {
        "kind": "vektorflow-release-bundle",
        "channel": channel.name,
        "release_kind": channel.release_kind,
        "version": version,
        "host_platform": channel.host_platform,
        "entrypoint": channel.executable_name,
        "ui_modes": list(channel.ui_modes),
        "artifacts": {
            "vkf": channel.executable_name,
            "native_pipeline_tools": list(release_native_tool_sources(Path("."), channel).keys()),
            "extension_vsix_included": include_extension,
            "overlay_binary_included": include_overlay,
            "ui_assets_included": include_ui_assets,
            "samples": list(samples),
            "extension_path": extension_path,
            "testing_guide": testing_guide,
            "demo_launchers": demo_launchers,
        },
        "tester_onboarding": {
            "smoke_command": smoke_command,
            "smoke_argv": smoke_argv,
            "sample_smoke_paths": list(samples),
            "vscode_supported": include_extension,
        },
    }


def release_readme_text(channel: ReleaseChannelSpec, version: str, manifest_name: str) -> str:
    ui_modes = ", ".join(channel.ui_modes)
    smoke_command = (
        f".\\{channel.executable_name} -e ':: \"hello, world\"'"
        if channel.host_platform == "win32"
        else f"./{channel.executable_name} -e ':: \"hello, world\"'"
    )
    overlay_note = (
        "The native transparent overlay host is bundled in this channel."
        if channel.overlay_required
        else "This channel uses browser/headless UI modes; no native transparent overlay host is bundled."
    )
    return (
        f"Vektor Flow {version} ({channel.name})\n"
        f"Release kind: {channel.release_kind}\n"
        f"Entrypoint: {channel.executable_name}\n"
        f"UI modes: {ui_modes}\n\n"
        "Quick start:\n"
        f"- Run: {smoke_command}\n"
        "- Run samples/01_hello.vkf.\n"
        "- Run samples/100_axis_4_panel.vkf.\n"
        "- Run samples/110_mirror_showcase.vkf.\n"
        "- Run the Python-free shared-runtime UI demo with run-shared-runtime-demo.\n"
        "- Install the VS Code extension from the extensions/ folder if included.\n\n"
        f"{overlay_note}\n"
        f"Bundle manifest: {manifest_name}\n"
        "Tester guide: TESTING.md\n"
    )
