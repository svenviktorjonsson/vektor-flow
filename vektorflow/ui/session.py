"""Cached adapter over session staging contract."""

from __future__ import annotations

from pathlib import Path

from .session_staging import UISessionArtifacts, mirror_session_file, stage_ui_session


_CURRENT_SESSION: UISessionArtifacts | None = None


def reset_ui_session() -> None:
    global _CURRENT_SESSION
    _CURRENT_SESSION = None


def get_ui_session() -> UISessionArtifacts | None:
    return _CURRENT_SESSION


def ensure_ui_session(root: Path) -> UISessionArtifacts:
    global _CURRENT_SESSION
    if _CURRENT_SESSION is None:
        _CURRENT_SESSION = stage_ui_session(root)
    return _CURRENT_SESSION


def write_session_file(session: UISessionArtifacts, filename: str, text: str, *, mirror_root: bool = False) -> None:
    mirror_session_file(session, filename, text, mirror_root=mirror_root)


__all__ = [
    "UISessionArtifacts",
    "ensure_ui_session",
    "get_ui_session",
    "reset_ui_session",
    "write_session_file",
]
