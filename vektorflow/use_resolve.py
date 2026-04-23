"""Resolve import paths to a concrete ``.vkf`` file or directory.

* ``resolve_use_path`` — legacy string spec (relative to ``base``), optional
  ``.vkf`` suffix.
* ``resolve_dot_module`` — ``.a.b.c`` segments from cwd ``base``; if both
  ``name.vkf`` and a directory ``name`` exist, the **file** wins (use a quoted
  segment to pick the folder).
"""

from __future__ import annotations

from pathlib import Path


def resolve_dot_module(base: Path | str, segments: list[str]) -> Path:
    """Resolve a dot-module path (segments after a leading ``.``) under ``base``."""
    if not segments:
        raise FileNotFoundError("empty dot module path")

    cur = Path(base).resolve()

    for i, seg in enumerate(segments):
        last = i == len(segments) - 1

        if seg.endswith(".vkf"):
            p = (cur / seg).resolve()
            if not p.is_file():
                raise FileNotFoundError(f"dot module path not found: {seg!r} under {cur}")
            if not last:
                raise FileNotFoundError(
                    f"cannot append past file {p.name!r} in dot module path"
                )
            return p

        p_dir = (cur / seg).resolve()
        p_vkf = (cur / f"{seg}.vkf").resolve()

        if p_vkf.is_file() and p_dir.is_dir():
            chosen = p_vkf
        elif p_vkf.is_file():
            chosen = p_vkf
        elif p_dir.is_dir():
            chosen = p_dir
        else:
            raise FileNotFoundError(f"dot module segment not found: {seg!r} under {cur}")

        if chosen.is_file():
            if not last:
                raise FileNotFoundError(
                    f"cannot traverse past file {chosen.name!r} in dot module path"
                )
            return chosen
        cur = chosen

    return cur


def resolve_use_path(base: Path | str, spec: str) -> Path:
    """Return an existing ``Path`` for ``spec``, relative to ``base``.

    ``spec`` is the string inside ``use("...")`` (no surrounding quotes).
    """
    base_path = Path(base).resolve()
    raw = Path(spec)
    if raw.is_absolute():
        p = raw.resolve()
    else:
        p = (base_path / raw).resolve()

    if p.exists():
        return p

    if p.suffix.lower() != ".vkf":
        with_vkf = p.with_suffix(".vkf")
        if with_vkf.is_file():
            return with_vkf

    raise FileNotFoundError(f"use path not found: {spec!r} (looked under {base_path})")
