from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def test_verify_release_bundle_checks_smoke_and_required_files(tmp_path: Path) -> None:
    bundle = tmp_path / "windows-overlay"
    bundle.mkdir()
    entry = bundle / "vkf.cmd"
    entry.write_text(
        "@echo off\r\n"
        "echo hello, world\r\n",
        encoding="utf-8",
    )
    manifest = {
        "entrypoint": "vkf.cmd",
        "artifacts": {
            "samples": ["samples/hello.vkf"],
            "extension_vsix_included": True,
            "ui_assets_included": True,
            "overlay_binary_included": True,
            "demo_launchers": ["run-shared-runtime-demo.ps1"],
        },
        "tester_onboarding": {
            "smoke_command": '.\\vkf.cmd -e \':: "hello, world"\'',
        },
    }
    (bundle / "vektorflow-release.json").write_text(json.dumps(manifest), encoding="utf-8")
    (bundle / "README.txt").write_text("ok", encoding="utf-8")
    (bundle / "README.md").write_text("ok", encoding="utf-8")
    (bundle / "INSTALL.md").write_text("ok", encoding="utf-8")
    (bundle / "TESTING.md").write_text("ok", encoding="utf-8")
    samples = bundle / "samples"
    samples.mkdir()
    (samples / "hello.vkf").write_text(':: "hello"', encoding="utf-8")
    ext = bundle / "extensions"
    ext.mkdir()
    (ext / "vektorflow-0.0.8.vsix").write_text("ok", encoding="utf-8")
    (bundle / "vf-ui").mkdir()
    (bundle / "vf-ui" / "vf-shared-rect-demo.html").write_text("ok", encoding="utf-8")
    (bundle / "vf-ui" / "vf-shared-rect-demo.js").write_text("ok", encoding="utf-8")
    (bundle / "run-shared-runtime-demo.ps1").write_text("ok", encoding="utf-8")
    (bundle / "vf-overlay.exe").write_text("ok", encoding="utf-8")

    result = subprocess.run(
        [sys.executable, "scripts/verify_release_bundle.py", str(bundle)],
        cwd=Path(__file__).resolve().parents[1],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert str(bundle) in result.stdout
