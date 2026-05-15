"""Run-scoped UI session artifacts.

The legacy UI bridge wrote live files directly into global locations like
``web/vf-ui/vf-display.json`` and ``native/VfOverlay/build/Release/web``.
That made independent runs bleed into each other.

This module introduces a per-run session directory under ``web/vf-ui/sessions``.
For native overlay compatibility we still stage ``sessions/<id>/vkf-scene.html``
into built overlay ``web`` folders, but payload/state/history files stay scoped
to run-session adapters rather than being mirrored back into the global
``web/vf-ui`` root on the live runtime path.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
import time
import uuid

from vektorflow.ui.runtime_packet_transport import seed_payload_dir


@dataclass(frozen=True)
class UISessionArtifacts:
    session_id: str
    page_rel: str
    repo_web_dir: Path
    repo_session_dir: Path
    built_web_dirs: tuple[Path, ...]

    @property
    def built_session_dirs(self) -> tuple[Path, ...]:
        rel = Path("sessions") / self.session_id
        return tuple((web_dir / rel).resolve() for web_dir in self.built_web_dirs)


_CURRENT_SESSION: UISessionArtifacts | None = None

_VERSION_RE = re.compile(r"\?v=\d+")
_ROOT_ASSET_RE = re.compile(
    r'((?:href|src)=["\'])(vf-frame\.css(?:\?[^"\']*)?|vf-frame\.js(?:\?[^"\']*)?|vf-widgets\.js(?:\?[^"\']*)?|vf-display\.js(?:\?[^"\']*)?|vf-browser-transport\.js(?:\?[^"\']*)?|vf-game-camera\.js(?:\?[^"\']*)?|vf-runtime-shell\.js(?:\?[^"\']*)?|vf-runtime-source\.js(?:\?[^"\']*)?|vf-runtime-scene\.js(?:\?[^"\']*)?|vf-runtime-flow\.js(?:\?[^"\']*)?|katex/[^"\']+|geom/[^"\']+)(["\'])'
)


def _built_web_dirs(root: Path) -> tuple[Path, ...]:
    dirs: list[Path] = []
    for rel in (
        Path("native") / "VfOverlay" / "build" / "Release" / "web",
        Path("native") / "VfOverlay" / "build" / "Debug" / "web",
        Path("native") / "VfOverlay" / "build" / "x64" / "Release" / "web",
        Path("native") / "VfOverlay" / "build" / "x64" / "Debug" / "web",
        Path("native") / "build" / "VfOverlay" / "Release" / "web",
        Path("native") / "build" / "VfOverlay" / "Debug" / "web",
    ):
        d = (root / rel).resolve()
        if d.is_dir() and (d / "vkf-scene.html").is_file():
            dirs.append(d)
    return tuple(dirs)


def _new_session_id() -> str:
    stamp = time.strftime("%Y%m%d-%H%M%S")
    return f"{stamp}-{uuid.uuid4().hex[:8]}"


def _render_session_html(source_html: str) -> str:
    version = str(int(time.time()))
    stamped = _VERSION_RE.sub(f"?v={version}", source_html)

    def repl(match: re.Match[str]) -> str:
        prefix, asset, suffix = match.groups()
        asset = _VERSION_RE.sub("", asset)
        return f"{prefix}../../{asset}?v={version}{suffix}"

    return _ROOT_ASSET_RE.sub(repl, stamped)


def _ensure_sessions_dir(base_dir: Path) -> None:
    try:
        base_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass


def _stage_overlay_session_host(session_dir: Path, session_html: str) -> None:
    seed_payload_dir(session_dir, session_html=session_html)


def reset_ui_session() -> None:
    global _CURRENT_SESSION
    _CURRENT_SESSION = None


def get_ui_session() -> UISessionArtifacts | None:
    return _CURRENT_SESSION


def ensure_ui_session(root: Path) -> UISessionArtifacts:
    global _CURRENT_SESSION
    if _CURRENT_SESSION is not None:
        return _CURRENT_SESSION

    repo_web_dir = (root / "web" / "vf-ui").resolve()
    repo_web_dir.mkdir(parents=True, exist_ok=True)
    built_web_dirs = _built_web_dirs(root)

    session_id = _new_session_id()
    rel = Path("sessions") / session_id
    _ensure_sessions_dir(repo_web_dir / "sessions")
    for built_web_dir in built_web_dirs:
        _ensure_sessions_dir(built_web_dir / "sessions")
    repo_session_dir = (repo_web_dir / rel).resolve()
    repo_session_dir.mkdir(parents=True, exist_ok=True)

    source_html = (repo_web_dir / "vkf-scene.html").read_text(encoding="utf-8")
    session_html = _render_session_html(source_html)

    seed_payload_dir(repo_session_dir, session_html=session_html)

    for built_web_dir in built_web_dirs:
        built_session_dir = (built_web_dir / rel).resolve()
        _stage_overlay_session_host(built_session_dir, session_html)

    _CURRENT_SESSION = UISessionArtifacts(
        session_id=session_id,
        page_rel=rel.as_posix() + "/vkf-scene.html",
        repo_web_dir=repo_web_dir,
        repo_session_dir=repo_session_dir,
        built_web_dirs=built_web_dirs,
    )
    return _CURRENT_SESSION


def write_session_file(session: UISessionArtifacts, filename: str, text: str, *, mirror_root: bool = False) -> None:
    (session.repo_session_dir / filename).write_text(text, encoding="utf-8")
    for built_session_dir in session.built_session_dirs:
        built_session_dir.mkdir(parents=True, exist_ok=True)
        (built_session_dir / filename).write_text(text, encoding="utf-8")
    if mirror_root:
        (session.repo_web_dir / filename).write_text(text, encoding="utf-8")
