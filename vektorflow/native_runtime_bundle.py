from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import shutil

from .native_overlay_scene_bundle import try_build_native_overlay_scene_program
from .native_program_artifact import emit_native_program_artifact_from_source_file
from .ui.runtime_packet_transport import empty_payload_files

RUNTIME_ARTIFACT_SUFFIX = ".vfprog.json"


@dataclass(frozen=True)
class NativeRuntimeBundle:
    executable_path: Path
    artifact_path: Path


@dataclass(frozen=True)
class NativeRuntimeBundlePackage:
    bundle_dir: Path
    executable_path: Path | None
    artifact_path: Path | None
    launcher_path: Path | None
    manifest_path: Path
    overlay_bundle_dir: Path | None = None
    overlay_launcher_path: Path | None = None
    overlay_page_rel: str | None = None


def discover_vf_core_runner(repo_root: Path | None = None) -> Path:
    base = repo_root or Path(__file__).resolve().parent.parent
    candidate = base / "native" / "build" / "VfCore" / "Release" / "vf-core.exe"
    if not candidate.is_file():
        raise FileNotFoundError(
            "native runtime runner not found; build native\\build\\VfCore\\Release\\vf-core.exe first"
        )
    return candidate


def discover_vf_overlay_bundle(repo_root: Path | None = None) -> Path:
    base = repo_root or Path(__file__).resolve().parent.parent
    candidates = [
        base / "native" / "build" / "VfOverlay" / "Release",
        base / "native" / "VfOverlay" / "build" / "dist" / "vf-overlay-win64",
    ]
    for candidate in candidates:
        if (candidate / "vf-overlay.exe").is_file() and (candidate / "web").is_dir():
            return candidate
    raise FileNotFoundError(
        "native overlay bundle not found; build native\\build\\VfOverlay\\Release or "
        "native\\VfOverlay\\build\\dist\\vf-overlay-win64 first"
    )


def _sanitize_packaged_overlay_bundle(overlay_dir: Path) -> None:
    web_dir = overlay_dir / "web"
    if not web_dir.is_dir():
        return
    sessions_dir = web_dir / "sessions"
    if sessions_dir.exists():
        shutil.rmtree(sessions_dir)
    sessions_dir.mkdir(parents=True, exist_ok=True)
    for filename, text in empty_payload_files().items():
        (web_dir / filename).write_text(text, encoding="utf-8")


def _repo_web_runtime_root() -> Path:
    root = Path(__file__).resolve().parent.parent
    web_dir = root / "web" / "vf-ui"
    if not web_dir.is_dir():
        raise FileNotFoundError(f"repo web runtime not found: {web_dir}")
    return web_dir


def _materialize_packaged_overlay_web_runtime(overlay_dir: Path) -> None:
    repo_web_dir = _repo_web_runtime_root()
    target_web_dir = overlay_dir / "web"
    if target_web_dir.exists():
        shutil.rmtree(target_web_dir)
    target_web_dir.mkdir(parents=True, exist_ok=True)
    for child in repo_web_dir.iterdir():
        if child.name == "sessions":
            continue
        dst = target_web_dir / child.name
        if child.is_dir():
            shutil.copytree(child, dst, dirs_exist_ok=True)
        else:
            shutil.copy2(child, dst)


def _copy_overlay_bundle_clean(source_overlay_dir: Path, target_overlay_dir: Path) -> None:
    def _ignore(dir_path: str, names: list[str]) -> set[str]:
        current = Path(dir_path)
        ignored: set[str] = set()
        if current == source_overlay_dir and "web" in names:
            ignored.add("web")
        return ignored

    shutil.copytree(source_overlay_dir, target_overlay_dir, ignore=_ignore, dirs_exist_ok=True)
    _materialize_packaged_overlay_web_runtime(target_overlay_dir)
    _sanitize_packaged_overlay_bundle(target_overlay_dir)


def artifact_path_for_executable(executable_path: Path) -> Path:
    return executable_path.with_suffix(RUNTIME_ARTIFACT_SUFFIX)


def build_native_runtime_bundle(
    source_path: Path,
    target_executable: Path,
    *,
    runner_executable: Path | None = None,
) -> NativeRuntimeBundle:
    runner = runner_executable or discover_vf_core_runner()
    target = target_executable.resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = emit_native_program_artifact_from_source_file(source_path)
    artifact_path = artifact_path_for_executable(target)

    shutil.copy2(runner, target)
    artifact_path.write_text(payload, encoding="utf-8")

    return NativeRuntimeBundle(
        executable_path=target,
        artifact_path=artifact_path,
    )


def package_native_runtime_bundle(
    source_path: Path,
    bundle_dir: Path,
    *,
    program_name: str | None = None,
    runner_executable: Path | None = None,
    overlay_bundle_dir: Path | None = None,
) -> NativeRuntimeBundlePackage:
    scene_program = try_build_native_overlay_scene_program(source_path)
    if scene_program is not None:
        return _package_native_overlay_scene_program(
            scene_program,
            source_path=source_path,
            bundle_dir=bundle_dir,
            overlay_bundle_dir=overlay_bundle_dir or discover_vf_overlay_bundle(),
        )

    target_dir = bundle_dir.resolve()
    if target_dir.exists():
        shutil.rmtree(target_dir)
    target_dir.mkdir(parents=True, exist_ok=True)

    exe_name = program_name or source_path.stem or "program"
    if not exe_name.lower().endswith(".exe"):
        exe_name = exe_name + ".exe"
    executable_path = target_dir / exe_name

    bundle = build_native_runtime_bundle(
        source_path,
        executable_path,
        runner_executable=runner_executable,
    )

    launcher_path = target_dir / "launch.cmd"
    launcher_path.write_text(
        "@echo off\r\n"
        "setlocal\r\n"
        "cd /d \"%~dp0\"\r\n"
        f"start \"\" \"%~dp0{bundle.executable_path.name}\"\r\n",
        encoding="ascii",
    )

    packaged_overlay_dir: Path | None = None
    overlay_launcher_path: Path | None = None
    if overlay_bundle_dir is not None:
        source_overlay_dir = overlay_bundle_dir.resolve()
        if not source_overlay_dir.is_dir():
            raise FileNotFoundError(f"overlay bundle directory not found: {source_overlay_dir}")
        packaged_overlay_dir = target_dir / "overlay"
        _copy_overlay_bundle_clean(source_overlay_dir, packaged_overlay_dir)
        overlay_launcher_path = target_dir / "launch-ui.cmd"
        overlay_entry = packaged_overlay_dir / "vf-overlay.exe"
        if not overlay_entry.is_file():
            raise FileNotFoundError(f"overlay bundle missing vf-overlay.exe: {overlay_entry}")
        overlay_launcher_path.write_text(
            "@echo off\r\n"
            "setlocal\r\n"
            "cd /d \"%~dp0\"\r\n"
            "start \"vf-overlay\" \"%~dp0overlay\\vf-overlay.exe\"\r\n"
            f"start \"\" \"%~dp0{bundle.executable_path.name}\"\r\n",
            encoding="ascii",
        )

    manifest_path = target_dir / "runtime-bundle-manifest.json"
    manifest = {
        "bundle_name": target_dir.name,
        "entry_exe": bundle.executable_path.name,
        "artifact": bundle.artifact_path.name,
        "launcher": launcher_path.name,
        "schema": "vf-native-runtime-bundle",
        "version": 1,
        "target_runtime": "native-vf-core",
        "python_required_on_target": False,
        "origin_source": source_path.resolve().as_posix(),
        "files": [
            {"path": bundle.executable_path.name, "size": bundle.executable_path.stat().st_size},
            {"path": bundle.artifact_path.name, "size": bundle.artifact_path.stat().st_size},
            {"path": launcher_path.name, "size": launcher_path.stat().st_size},
        ],
    }
    if packaged_overlay_dir is not None and overlay_launcher_path is not None:
        manifest["overlay"] = {
            "bundle_dir": packaged_overlay_dir.name,
            "entry_exe": "overlay/vf-overlay.exe",
            "launcher": overlay_launcher_path.name,
        }
        manifest["files"].append({"path": overlay_launcher_path.name, "size": overlay_launcher_path.stat().st_size})
        for overlay_file in packaged_overlay_dir.rglob("*"):
            if overlay_file.is_file():
                manifest["files"].append(
                    {
                        "path": overlay_file.relative_to(target_dir).as_posix(),
                        "size": overlay_file.stat().st_size,
                    }
                )
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    return NativeRuntimeBundlePackage(
        bundle_dir=target_dir,
        executable_path=bundle.executable_path,
        artifact_path=bundle.artifact_path,
        launcher_path=launcher_path,
        manifest_path=manifest_path,
        overlay_bundle_dir=packaged_overlay_dir,
        overlay_launcher_path=overlay_launcher_path,
    )


def _package_native_overlay_scene_program(
    scene_program,
    *,
    source_path: Path,
    bundle_dir: Path,
    overlay_bundle_dir: Path,
) -> NativeRuntimeBundlePackage:
    target_dir = bundle_dir.resolve()
    if target_dir.exists():
        shutil.rmtree(target_dir)
    target_dir.mkdir(parents=True, exist_ok=True)

    source_overlay_dir = overlay_bundle_dir.resolve()
    if not source_overlay_dir.is_dir():
        raise FileNotFoundError(f"overlay bundle directory not found: {source_overlay_dir}")

    packaged_overlay_dir = target_dir / "overlay"
    _copy_overlay_bundle_clean(source_overlay_dir, packaged_overlay_dir)

    session_dir = packaged_overlay_dir / "web" / "sessions" / scene_program.session_name
    session_dir.mkdir(parents=True, exist_ok=True)
    (session_dir / "vkf-scene.html").write_text(scene_program.html_text, encoding="utf-8")
    (session_dir / "vf-runtime-packets.json").write_text(scene_program.runtime_packets_text, encoding="utf-8")
    if scene_program.geom_transport_text:
        (session_dir / "vf-geom-ledger-transport.json").write_text(
            scene_program.geom_transport_text,
            encoding="utf-8",
        )
    if scene_program.geom_state_text:
        (session_dir / "vf-geom-ledger-state.json").write_text(
            scene_program.geom_state_text,
            encoding="utf-8",
        )

    overlay_entry = packaged_overlay_dir / "vf-overlay.exe"
    if not overlay_entry.is_file():
        raise FileNotFoundError(f"overlay bundle missing vf-overlay.exe: {overlay_entry}")

    overlay_launcher_path = target_dir / "launch-ui.cmd"
    overlay_launcher_path.write_text(
        "@echo off\r\n"
        "setlocal\r\n"
        "cd /d \"%~dp0\"\r\n"
        f"start \"vf-overlay\" \"%~dp0overlay\\vf-overlay.exe\" \"{scene_program.page_rel}\"\r\n",
        encoding="ascii",
    )

    manifest_path = target_dir / "runtime-bundle-manifest.json"
    manifest = {
        "bundle_name": target_dir.name,
        "schema": "vf-native-runtime-bundle",
        "version": 1,
        "target_runtime": "native-vf-overlay-scene",
        "python_required_on_target": False,
        "origin_source": source_path.resolve().as_posix(),
        "overlay": {
            "bundle_dir": packaged_overlay_dir.name,
            "entry_exe": "overlay/vf-overlay.exe",
            "launcher": overlay_launcher_path.name,
            "page": scene_program.page_rel,
        },
        "files": [
            {"path": overlay_launcher_path.name, "size": overlay_launcher_path.stat().st_size},
        ],
    }
    for overlay_file in packaged_overlay_dir.rglob("*"):
        if overlay_file.is_file():
            manifest["files"].append(
                {
                    "path": overlay_file.relative_to(target_dir).as_posix(),
                    "size": overlay_file.stat().st_size,
                }
            )
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    return NativeRuntimeBundlePackage(
        bundle_dir=target_dir,
        executable_path=None,
        artifact_path=None,
        launcher_path=None,
        manifest_path=manifest_path,
        overlay_bundle_dir=packaged_overlay_dir,
        overlay_launcher_path=overlay_launcher_path,
        overlay_page_rel=scene_program.page_rel,
    )
