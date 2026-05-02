from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from vektorflow import __version__
from vektorflow.release_bundle import (
    build_release_manifest,
    default_release_channel_for_platform,
    default_release_output_dir,
    release_demo_launchers,
    release_channel,
    release_readme_text,
    release_sample_sources,
)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a host-native Vektor Flow tester bundle.")
    parser.add_argument("--channel", help="Release channel name. Defaults from the current host OS.")
    parser.add_argument("--output", type=Path, help="Output directory root. Defaults to dist/releases.")
    parser.add_argument("--skip-extension", action="store_true", help="Do not package the VS Code extension.")
    parser.add_argument("--skip-ui-assets", action="store_true", help="Do not copy web/vf-ui assets.")
    parser.add_argument(
        "--allow-missing-overlay",
        action="store_true",
        help="Allow windows-overlay bundle generation without vf-overlay.exe present.",
    )
    return parser.parse_args()


def _run(argv: list[str], *, cwd: Path | None = None) -> None:
    subprocess.run(argv, cwd=cwd, check=True)


def _require_pyinstaller() -> None:
    probe = subprocess.run(
        [sys.executable, "-m", "PyInstaller", "--version"],
        capture_output=True,
        text=True,
    )
    if probe.returncode != 0:
        raise RuntimeError(
            "PyInstaller is required to build tester bundles. "
            "Install it in the build environment with: "
            f"{sys.executable} -m pip install pyinstaller"
        )


def _build_vkf_executable(channel_name: str, executable_name: str, bundle_dir: Path) -> Path:
    _require_pyinstaller()
    with tempfile.TemporaryDirectory(prefix="vf-release-") as tmp_name:
        tmp = Path(tmp_name)
        entry = tmp / "vkf_entry.py"
        entry.write_text(
            "from vektorflow.cli import main\n"
            "if __name__ == '__main__':\n"
            "    raise SystemExit(main())\n",
            encoding="utf-8",
        )
        work = tmp / "work"
        spec = tmp / "spec"
        dist = tmp / "dist"
        exe_stem = executable_name[:-4] if executable_name.endswith(".exe") else executable_name
        _run(
            [
                sys.executable,
                "-m",
                "PyInstaller",
                "--noconfirm",
                "--clean",
                "--onefile",
                "--name",
                exe_stem,
                "--distpath",
                str(dist),
                "--workpath",
                str(work),
                "--specpath",
                str(spec),
                str(entry),
            ],
            cwd=ROOT,
        )
        built = dist / executable_name
        if not built.exists():
            raise RuntimeError(f"PyInstaller did not produce expected executable: {built}")
        target = bundle_dir / executable_name
        shutil.copy2(built, target)
        return target


def _package_extension(bundle_dir: Path) -> Path:
    ext_dir = ROOT / "vscode"
    cmd = shutil.which("vsce")
    if cmd:
        _run([cmd, "package", "--allow-missing-repository"], cwd=ext_dir)
    else:
        npx = shutil.which("npx")
        if not npx:
            raise RuntimeError("Need either vsce or npx on PATH to package the VS Code extension.")
        _run([npx, "--yes", "@vscode/vsce", "package", "--allow-missing-repository"], cwd=ext_dir)
    vsix = max(ext_dir.glob("*.vsix"), key=lambda p: p.stat().st_mtime)
    target_dir = bundle_dir / "extensions"
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / vsix.name
    shutil.copy2(vsix, target)
    return target


def _copy_samples(bundle_dir: Path) -> tuple[str, ...]:
    target_dir = bundle_dir / "samples"
    target_dir.mkdir(parents=True, exist_ok=True)
    copied: list[str] = []
    for source in release_sample_sources(ROOT):
        if source.exists():
            target = target_dir / source.name
            shutil.copy2(source, target)
            copied.append(str(Path("samples") / source.name))
    return tuple(copied)


def _copy_tester_docs(bundle_dir: Path) -> None:
    for name in ("README.md", "INSTALL.md", "TESTING.md"):
        source = ROOT / name
        if source.exists():
            shutil.copy2(source, bundle_dir / name)


def _copy_demo_launchers(bundle_dir: Path) -> tuple[str, ...]:
    copied: list[str] = []
    for source in release_demo_launchers(ROOT):
        if source.exists():
            target = bundle_dir / source.name
            shutil.copy2(source, target)
            copied.append(source.name)
    return tuple(copied)


def _copy_ui_assets(bundle_dir: Path) -> None:
    source = ROOT / "web" / "vf-ui"
    target = bundle_dir / "vf-ui"
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(source, target)


def _copy_overlay_if_present(bundle_dir: Path) -> Path | None:
    candidates = (
        ROOT / "native" / "VfOverlay" / "build" / "Release" / "vf-overlay.exe",
        ROOT / "native" / "VfOverlay" / "build" / "vf-overlay.exe",
    )
    for candidate in candidates:
        if candidate.exists():
            target = bundle_dir / "vf-overlay.exe"
            shutil.copy2(candidate, target)
            return target
    return None


def main() -> int:
    args = _parse_args()
    channel = release_channel(args.channel) if args.channel else default_release_channel_for_platform(sys.platform)
    if sys.platform != channel.host_platform:
        raise RuntimeError(
            f"Channel {channel.name!r} must be built on {channel.host_platform!r}, "
            f"but current host is {sys.platform!r}."
        )

    output_root = args.output.resolve() if args.output else default_release_output_dir(ROOT)
    bundle_dir = output_root / channel.name
    if bundle_dir.exists():
        shutil.rmtree(bundle_dir)
    bundle_dir.mkdir(parents=True, exist_ok=True)

    executable = _build_vkf_executable(channel.name, channel.executable_name, bundle_dir)
    samples = _copy_samples(bundle_dir)
    _copy_tester_docs(bundle_dir)
    _copy_demo_launchers(bundle_dir)

    include_extension = False
    if not args.skip_extension:
        _package_extension(bundle_dir)
        include_extension = True

    include_ui_assets = False
    if not args.skip_ui_assets:
        _copy_ui_assets(bundle_dir)
        include_ui_assets = True

    overlay_path = None
    if channel.overlay_required:
        overlay_path = _copy_overlay_if_present(bundle_dir)
        if overlay_path is None and not args.allow_missing_overlay:
            raise RuntimeError(
                "windows-overlay bundle requires vf-overlay.exe. "
                "Build native/VfOverlay first or pass --allow-missing-overlay."
            )

    manifest_name = "vektorflow-release.json"
    manifest = build_release_manifest(
        channel=channel,
        version=__version__,
        include_extension=include_extension,
        include_overlay=overlay_path is not None,
        include_ui_assets=include_ui_assets,
        samples=samples,
    )
    manifest["artifacts"]["vkf_path"] = executable.name
    manifest_path = bundle_dir / manifest_name
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    readme_path = bundle_dir / "README.txt"
    readme_path.write_text(
        release_readme_text(channel, __version__, manifest_name),
        encoding="utf-8",
    )

    print(bundle_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
