from __future__ import annotations

import os
from pathlib import Path
import subprocess

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module


def _cleanup_stale_overlay_runs(repo: Path) -> None:
    if os.name != "nt":
        return
    current_pid = os.getpid()
    ps = r"""
$repo = $args[0].ToLower()
$current = [int]$args[1]
Get-CimInstance Win32_Process | Where-Object {
    $_.ProcessId -ne $current -and (
      $_.Name -ieq 'vf-overlay.exe' -or (
        $_.Name -ieq 'python.exe' -and (
          ($_.CommandLine -as [string]).ToLower().Contains($repo) -or
          ($_.CommandLine -as [string]).ToLower().Contains('vf_tmp_loop.vkf') -or
          ($_.CommandLine -as [string]).ToLower().Contains('-m vektorflow') -or
          ($_.CommandLine -as [string]).ToLower().Contains('examples/ui_') -or
          ($_.CommandLine -as [string]).ToLower().Contains('run_ui_style_content_overlay.py')
        )
      )
    )
  } |
  ForEach-Object {
    try {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
    } catch {
    }
  }
""".strip()
    try:
        subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps, str(repo), str(current_pid)],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        return


def main() -> None:
    repo = Path(__file__).resolve().parents[1]
    _cleanup_stale_overlay_runs(repo)
    example = repo / "examples" / "ui_interactive_projection.vkf"
    mod = parse_module(example.read_text(encoding="utf-8"), filename=str(example))
    ip = Interpreter(example)
    ip.run_module(mod)


if __name__ == "__main__":
    main()
