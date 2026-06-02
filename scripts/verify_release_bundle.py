from __future__ import annotations

import argparse
import json
import shlex
import subprocess
import sys
from pathlib import Path


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Verify a built Vektor Flow release bundle.")
    parser.add_argument("bundle", type=Path, help="Path to the release bundle directory.")
    return parser.parse_args()


def _run(argv: list[str], *, cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(argv, cwd=cwd, capture_output=True, text=True)


def _expect(path: Path, errors: list[str], label: str) -> None:
    if not path.exists():
        errors.append(f"missing {label}: {path.name}")


def main() -> int:
    args = _parse_args()
    bundle = args.bundle.resolve()
    manifest_path = bundle / "vektorflow-release.json"
    errors: list[str] = []

    _expect(bundle, errors, "bundle directory")
    _expect(manifest_path, errors, "release manifest")
    _expect(bundle / "README.txt", errors, "bundle README")
    _expect(bundle / "README.md", errors, "README.md")
    _expect(bundle / "INSTALL.md", errors, "INSTALL.md")
    _expect(bundle / "TESTING.md", errors, "TESTING.md")

    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    entrypoint = bundle / manifest["entrypoint"]
    _expect(entrypoint, errors, "entrypoint")

    for sample in manifest.get("artifacts", {}).get("samples", []):
        _expect(bundle / sample, errors, f"sample {sample}")

    for native_tool in manifest.get("artifacts", {}).get("native_pipeline_tools", []):
        _expect(bundle / native_tool, errors, f"native pipeline tool {native_tool}")

    if manifest.get("artifacts", {}).get("extension_vsix_included"):
        ext_dir = bundle / "extensions"
        if not ext_dir.exists() or not any(ext_dir.glob("*.vsix")):
            errors.append("missing extension VSIX in extensions/")

    if manifest.get("artifacts", {}).get("ui_assets_included"):
        _expect(bundle / "vf-ui", errors, "vf-ui assets")
        _expect(bundle / "vf-ui" / "vf-shared-rect-demo.html", errors, "shared-runtime demo HTML")
        _expect(bundle / "vf-ui" / "vf-shared-rect-demo.js", errors, "shared-runtime demo JS")
        if manifest.get("host_platform") == "win32" or (bundle / "vf-overlay.exe").exists():
            _expect(bundle / "web", errors, "overlay web assets")
            _expect(bundle / "web" / "index.html", errors, "overlay web index")
            _expect(bundle / "web" / "vf-shared-rect-demo.html", errors, "overlay shared-runtime demo HTML")
        for launcher in manifest.get("artifacts", {}).get("demo_launchers", []):
            _expect(bundle / launcher, errors, f"demo launcher {launcher}")

    if manifest.get("artifacts", {}).get("overlay_binary_included"):
        _expect(bundle / "vf-overlay.exe", errors, "overlay binary")

    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1

    tester_onboarding = manifest.get("tester_onboarding", {})
    smoke_argv = tester_onboarding.get("smoke_argv")
    smoke_command = tester_onboarding.get("smoke_command")
    if not smoke_argv and not smoke_command:
        print("missing tester smoke command in manifest", file=sys.stderr)
        return 1

    if smoke_argv:
        command = [str(arg) for arg in smoke_argv]
    else:
        command = shlex.split(str(smoke_command), posix=manifest.get("host_platform") != "win32")
    probe = _run(command, cwd=bundle)
    if probe.returncode != 0:
        print(probe.stdout, end="")
        print(probe.stderr, end="", file=sys.stderr)
        print("bundle smoke command failed", file=sys.stderr)
        return probe.returncode or 1

    if "hello, world" not in probe.stdout:
        print(probe.stdout, end="")
        print("bundle smoke output did not contain expected text", file=sys.stderr)
        return 1

    print(bundle)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
