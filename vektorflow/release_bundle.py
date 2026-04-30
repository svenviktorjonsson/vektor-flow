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
        root / "examples" / "hello.vkf",
        root / "examples" / "core_language_tour.vkf",
    )


def build_release_manifest(
    *,
    channel: ReleaseChannelSpec,
    version: str,
    include_extension: bool,
    include_overlay: bool,
    include_ui_assets: bool,
    samples: tuple[str, ...],
) -> dict[str, Any]:
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
            "extension_vsix_included": include_extension,
            "overlay_binary_included": include_overlay,
            "ui_assets_included": include_ui_assets,
            "samples": list(samples),
        },
    }


def release_readme_text(channel: ReleaseChannelSpec, version: str, manifest_name: str) -> str:
    ui_modes = ", ".join(channel.ui_modes)
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
        f"- Run {channel.executable_name} with an inline smoke check.\n"
        "- Open samples/hello.vkf or samples/core_language_tour.vkf.\n"
        "- Install the VS Code extension from the extensions/ folder if included.\n\n"
        f"{overlay_note}\n"
        f"Bundle manifest: {manifest_name}\n"
    )
