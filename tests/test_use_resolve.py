"""``resolve_use_path`` — optional ``.vkf`` suffix."""

from __future__ import annotations

from pathlib import Path

import pytest

from vektorflow.use_resolve import resolve_use_path


def test_explicit_vkf(tmp_path: Path) -> None:
    f = tmp_path / "m.vkf"
    f.write_text("# ok\n", encoding="utf-8")
    assert resolve_use_path(tmp_path, "m.vkf") == f.resolve()


def test_omit_vkf_suffix(tmp_path: Path) -> None:
    f = tmp_path / "m.vkf"
    f.write_text("# ok\n", encoding="utf-8")
    assert resolve_use_path(tmp_path, "m") == f.resolve()


def test_nested_path_omit_suffix(tmp_path: Path) -> None:
    sub = tmp_path / "lib"
    sub.mkdir()
    f = sub / "helpers.vkf"
    f.write_text("# ok\n", encoding="utf-8")
    assert resolve_use_path(tmp_path, "lib/helpers") == f.resolve()


def test_directory_module(tmp_path: Path) -> None:
    d = tmp_path / "pkg"
    d.mkdir()
    assert resolve_use_path(tmp_path, "pkg") == d.resolve()


def test_missing_raises(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        resolve_use_path(tmp_path, "nope")
