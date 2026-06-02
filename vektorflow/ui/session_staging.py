"""Session staging contract for UI runtime files."""

from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import re
import time
import uuid

from vektorflow.ui.file_io import write_text_if_changed
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


_VERSION_RE = re.compile(r"\?v=\d+")
_ROOT_ASSET_RE = re.compile(
    r'((?:href|src)=["\'])(vf-frame\.css(?:\?[^"\']*)?|vf-frame\.js(?:\?[^"\']*)?|vf-widgets\.js(?:\?[^"\']*)?|vf-display\.js(?:\?[^"\']*)?|vf-browser-transport\.js(?:\?[^"\']*)?|vf-game-camera\.js(?:\?[^"\']*)?|vf-runtime-shell\.js(?:\?[^"\']*)?|vf-runtime-source\.js(?:\?[^"\']*)?|vf-runtime-scene\.js(?:\?[^"\']*)?|vf-runtime-flow\.js(?:\?[^"\']*)?|katex/[^"\']+|geom/[^"\']+)(["\'])'
)
_BODY_OPEN_RE = re.compile(r"<body\b([^>]*)>", re.IGNORECASE)


def discover_built_web_dirs(root: Path) -> tuple[Path, ...]:
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


def new_session_id() -> str:
    stamp = time.strftime("%Y%m%d-%H%M%S")
    return f"{stamp}-{uuid.uuid4().hex[:8]}"


def render_session_html(source_html: str) -> str:
    version = str(int(time.time()))
    stamped = _VERSION_RE.sub(f"?v={version}", source_html)

    def repl(match: re.Match[str]) -> str:
        prefix, asset, suffix = match.groups()
        asset = _VERSION_RE.sub("", asset)
        return f"{prefix}../../{asset}?v={version}{suffix}"

    rendered = _ROOT_ASSET_RE.sub(repl, stamped)
    if not strict_packet_only_session_mode_enabled():
        return rendered

    def body_repl(match: re.Match[str]) -> str:
        attrs = match.group(1)
        if "data-vf-runtime-strict-packet-only" in attrs:
            return match.group(0)
        return f'<body{attrs} data-vf-runtime-packet-only="true" data-vf-runtime-strict-packet-only="true">'

    return _BODY_OPEN_RE.sub(body_repl, rendered, count=1)


def _ensure_sessions_dir(base_dir: Path) -> None:
    try:
        base_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass


def strict_packet_only_session_mode_enabled() -> bool:
    raw = str(os.environ.get("VF_UI_PACKET_ONLY_STRICT", "") or "").strip().lower()
    return raw not in ("", "0", "false", "off", "no")


def stage_overlay_session_host(
    session_dir: Path,
    session_html: str,
    *,
    seed_compatibility_payloads: bool = True,
) -> None:
    seed_payload_dir(
        session_dir,
        session_html=session_html,
        seed_compatibility_payloads=seed_compatibility_payloads,
    )


def stage_ui_session(root: Path, *, session_id: str | None = None) -> UISessionArtifacts:
    repo_web_dir = (root / "web" / "vf-ui").resolve()
    repo_web_dir.mkdir(parents=True, exist_ok=True)
    built_web_dirs = discover_built_web_dirs(root)

    resolved_session_id = session_id or new_session_id()
    rel = Path("sessions") / resolved_session_id
    _ensure_sessions_dir(repo_web_dir / "sessions")
    for built_web_dir in built_web_dirs:
        _ensure_sessions_dir(built_web_dir / "sessions")
    repo_session_dir = (repo_web_dir / rel).resolve()
    repo_session_dir.mkdir(parents=True, exist_ok=True)

    source_html = (repo_web_dir / "vkf-scene.html").read_text(encoding="utf-8")
    session_html = render_session_html(source_html)
    seed_compatibility_payloads = not strict_packet_only_session_mode_enabled()

    seed_payload_dir(
        repo_session_dir,
        session_html=session_html,
        seed_compatibility_payloads=seed_compatibility_payloads,
    )

    for built_web_dir in built_web_dirs:
        built_session_dir = (built_web_dir / rel).resolve()
        stage_overlay_session_host(
            built_session_dir,
            session_html,
            seed_compatibility_payloads=seed_compatibility_payloads,
        )

    return UISessionArtifacts(
        session_id=resolved_session_id,
        page_rel=rel.as_posix() + "/vkf-scene.html",
        repo_web_dir=repo_web_dir,
        repo_session_dir=repo_session_dir,
        built_web_dirs=built_web_dirs,
    )


def mirror_session_file(session: UISessionArtifacts, filename: str, text: str, *, mirror_root: bool = False) -> None:
    write_text_if_changed(session.repo_session_dir / filename, text)
    for built_session_dir in session.built_session_dirs:
        built_session_dir.mkdir(parents=True, exist_ok=True)
        write_text_if_changed(built_session_dir / filename, text)
    if mirror_root:
        write_text_if_changed(session.repo_web_dir / filename, text)


__all__ = [
    "UISessionArtifacts",
    "discover_built_web_dirs",
    "mirror_session_file",
    "new_session_id",
    "render_session_html",
    "stage_overlay_session_host",
    "stage_ui_session",
    "strict_packet_only_session_mode_enabled",
    "write_text_if_changed",
]
