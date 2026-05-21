"""Runtime boot plans for browser and overlay launch."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from vektorflow.ui.overlay_host_contract import overlay_web_dir_for_exe
from vektorflow.ui.session_staging import UISessionArtifacts


@dataclass(frozen=True)
class BrowserLaunchPlan:
    serve_dir: Path
    page_rel: str
    url: str


@dataclass(frozen=True)
class OverlayLaunchPlan:
    root: Path
    exe: Path
    overlay_web_dir: Path
    overlay_page: Path
    page_rel: str
    argv: list[str]
    cwd: Path


def build_browser_launch_plan(*, root: Path, session: UISessionArtifacts, port: int) -> BrowserLaunchPlan:
    serve_dir = (Path(root).resolve() / "web" / "vf-ui").resolve()
    page_rel = str(session.page_rel)
    return BrowserLaunchPlan(
        serve_dir=serve_dir,
        page_rel=page_rel,
        url=f"http://127.0.0.1:{int(port)}/{page_rel}",
    )


def build_overlay_launch_plan(*, root: Path, exe: Path, session: UISessionArtifacts) -> OverlayLaunchPlan:
    resolved_root = Path(root).resolve()
    resolved_exe = Path(exe).resolve()
    overlay_web_dir = overlay_web_dir_for_exe(resolved_exe)
    if not overlay_web_dir.is_dir():
        raise RuntimeError(
            f"UI not started: expected overlay web root next to executable: {overlay_web_dir}"
        )
    if not (overlay_web_dir / "vkf-scene.html").is_file():
        raise RuntimeError(
            f"UI not started: overlay web root missing vkf-scene.html: {overlay_web_dir}"
        )
    page_rel = str(session.page_rel)
    overlay_page = (overlay_web_dir / page_rel).resolve()
    if not overlay_page.is_file():
        raise RuntimeError(
            f"UI not started: staged overlay session page missing for launched executable: {overlay_page}"
        )
    return OverlayLaunchPlan(
        root=resolved_root,
        exe=resolved_exe,
        overlay_web_dir=overlay_web_dir,
        overlay_page=overlay_page,
        page_rel=page_rel,
        argv=[str(resolved_exe), page_rel],
        cwd=resolved_exe.parent.resolve(),
    )


__all__ = [
    "BrowserLaunchPlan",
    "OverlayLaunchPlan",
    "build_browser_launch_plan",
    "build_overlay_launch_plan",
]
