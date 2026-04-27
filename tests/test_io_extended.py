"""Extensive tests for ``vektorflow.stdlib.io`` — text, bytes, read_numbers,
sleep_ms, path errors, encodings, and VKF interpreter integration."""

from __future__ import annotations

import contextlib
import time
from io import StringIO
from pathlib import Path

import numpy as np
import pytest

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module
from vektorflow.stdlib import resolve_stdlib
from vektorflow.stdlib.io import (
    build_io_native_namespace,
    build_io_namespace,
    build_io_seconds_namespace,
    read_bytes,
    read_numbers,
    read_text,
    sleep,
    sleep_ms,
    write_bytes,
    write_text,
)


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _run(src: str) -> list[str]:
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        ip.run_module(mod)
    return [ln for ln in buf.getvalue().splitlines() if ln.strip()]


# ---------------------------------------------------------------------------
# resolve_stdlib
# ---------------------------------------------------------------------------

class TestResolveIo:
    def test_io_keys_present(self) -> None:
        io = resolve_stdlib("io")
        assert {"read_text", "write_text", "read_bytes", "write_bytes",
                "read_numbers", "sleep_ms"} <= set(io.keys())

    def test_all_callable(self) -> None:
        io = resolve_stdlib("io")
        for k in ("read_text", "write_text", "read_bytes", "write_bytes",
                  "read_numbers", "sleep_ms"):
            assert callable(io[k])


# ---------------------------------------------------------------------------
# Text I/O
# ---------------------------------------------------------------------------

class TestTextIo:
    def test_roundtrip_simple(self, tmp_path: Path) -> None:
        p = str(tmp_path / "t.txt")
        write_text(p, "hello")
        assert read_text(p) == "hello"

    def test_roundtrip_multiline(self, tmp_path: Path) -> None:
        content = "line1\nline2\nline3\n"
        p = str(tmp_path / "ml.txt")
        write_text(p, content)
        assert read_text(p) == content

    def test_roundtrip_unicode(self, tmp_path: Path) -> None:
        content = "héllo wörld 日本語 🎉"
        p = str(tmp_path / "u.txt")
        write_text(p, content, encoding="utf-8")
        assert read_text(p, encoding="utf-8") == content

    def test_overwrite(self, tmp_path: Path) -> None:
        p = str(tmp_path / "ow.txt")
        write_text(p, "first")
        write_text(p, "second")
        assert read_text(p) == "second"

    def test_empty_file(self, tmp_path: Path) -> None:
        p = str(tmp_path / "empty.txt")
        write_text(p, "")
        assert read_text(p) == ""

    def test_path_must_be_string(self, tmp_path: Path) -> None:
        with pytest.raises(TypeError):
            write_text(tmp_path, "hi")  # type: ignore[arg-type]

    def test_read_nonexistent_raises(self, tmp_path: Path) -> None:
        with pytest.raises(FileNotFoundError):
            read_text(str(tmp_path / "nope.txt"))

    def test_large_file(self, tmp_path: Path) -> None:
        content = "x" * 100_000
        p = str(tmp_path / "big.txt")
        write_text(p, content)
        assert read_text(p) == content

    def test_newline_preserved(self, tmp_path: Path) -> None:
        content = "a\nb\nc"
        p = str(tmp_path / "nl.txt")
        write_text(p, content)
        assert read_text(p) == content


# ---------------------------------------------------------------------------
# Bytes I/O
# ---------------------------------------------------------------------------

class TestBytesIo:
    def test_roundtrip(self, tmp_path: Path) -> None:
        p = str(tmp_path / "b.bin")
        write_bytes(p, b"\x00\x01\x02\xff")
        assert read_bytes(p) == b"\x00\x01\x02\xff"

    def test_empty_bytes(self, tmp_path: Path) -> None:
        p = str(tmp_path / "empty.bin")
        write_bytes(p, b"")
        assert read_bytes(p) == b""

    def test_overwrite_bytes(self, tmp_path: Path) -> None:
        p = str(tmp_path / "ow.bin")
        write_bytes(p, b"\x01\x02")
        write_bytes(p, b"\xAA\xBB\xCC")
        assert read_bytes(p) == b"\xAA\xBB\xCC"

    def test_rejects_string_input(self, tmp_path: Path) -> None:
        p = str(tmp_path / "bad.bin")
        with pytest.raises(TypeError):
            write_bytes(p, "not bytes")  # type: ignore[arg-type]

    def test_rejects_int_input(self, tmp_path: Path) -> None:
        p = str(tmp_path / "bad2.bin")
        with pytest.raises(TypeError):
            write_bytes(p, 42)  # type: ignore[arg-type]

    def test_bytearray_accepted(self, tmp_path: Path) -> None:
        p = str(tmp_path / "ba.bin")
        write_bytes(p, bytearray(b"\x10\x20"))
        assert read_bytes(p) == b"\x10\x20"

    def test_large_binary(self, tmp_path: Path) -> None:
        data = bytes(range(256)) * 100
        p = str(tmp_path / "large.bin")
        write_bytes(p, data)
        assert read_bytes(p) == data


# ---------------------------------------------------------------------------
# read_numbers — matrix mode
# ---------------------------------------------------------------------------

class TestReadNumbersMatrix:
    def test_whitespace_separated(self, tmp_path: Path) -> None:
        p = tmp_path / "m.txt"
        p.write_text("1 2\n3 4\n")
        out = read_numbers(str(p), header=False)
        np.testing.assert_array_equal(out, np.array([[1, 2], [3, 4]], dtype=np.float64))

    def test_comma_separated(self, tmp_path: Path) -> None:
        p = tmp_path / "m.csv"
        p.write_text("1,2,3\n4,5,6\n")
        out = read_numbers(str(p), header=False)
        np.testing.assert_array_equal(out, np.array([[1, 2, 3], [4, 5, 6]], dtype=np.float64))

    def test_tab_separated(self, tmp_path: Path) -> None:
        p = tmp_path / "m.tsv"
        p.write_text("1\t2\n3\t4\n")
        out = read_numbers(str(p), delimiter="\t", header=False)
        np.testing.assert_array_equal(out, np.array([[1, 2], [3, 4]], dtype=np.float64))

    def test_single_row(self, tmp_path: Path) -> None:
        p = tmp_path / "r.txt"
        p.write_text("5 10 15\n")
        out = read_numbers(str(p), header=False)
        assert out.shape == (1, 3)
        np.testing.assert_array_equal(out[0], [5.0, 10.0, 15.0])

    def test_single_column(self, tmp_path: Path) -> None:
        p = tmp_path / "c.txt"
        p.write_text("1\n2\n3\n")
        out = read_numbers(str(p), header=False)
        assert out.shape == (3, 1)

    def test_skips_comment_lines(self, tmp_path: Path) -> None:
        p = tmp_path / "cmt.txt"
        p.write_text("# comment\n1 2\n3 4\n")
        out = read_numbers(str(p), header=False)
        np.testing.assert_array_equal(out, [[1, 2], [3, 4]])

    def test_skips_ragged_rows(self, tmp_path: Path) -> None:
        p = tmp_path / "rag.txt"
        p.write_text("1 2\n3\n4 5\n")
        out = read_numbers(str(p), header=False)
        np.testing.assert_array_equal(out, [[1, 2], [4, 5]])

    def test_empty_file_returns_0x0(self, tmp_path: Path) -> None:
        p = tmp_path / "empty.txt"
        p.write_text("")
        out = read_numbers(str(p), header=False)
        assert out.shape == (0, 0)
        assert out.dtype == np.float64

    def test_floats_preserved(self, tmp_path: Path) -> None:
        p = tmp_path / "f.txt"
        p.write_text("1.5 2.5\n3.5 4.5\n")
        out = read_numbers(str(p), header=False)
        np.testing.assert_allclose(out, [[1.5, 2.5], [3.5, 4.5]])

    def test_negative_numbers(self, tmp_path: Path) -> None:
        p = tmp_path / "neg.txt"
        p.write_text("-1 -2\n-3 -4\n")
        out = read_numbers(str(p), header=False)
        np.testing.assert_array_equal(out, [[-1, -2], [-3, -4]])


# ---------------------------------------------------------------------------
# read_numbers — header mode
# ---------------------------------------------------------------------------

class TestReadNumbersHeader:
    def test_auto_detect_header(self, tmp_path: Path) -> None:
        p = tmp_path / "h.csv"
        p.write_text("x,y\n1,2\n3,4\n")
        out = read_numbers(str(p))
        np.testing.assert_array_equal(out.x, [1.0, 3.0])
        np.testing.assert_array_equal(out.y, [2.0, 4.0])

    def test_explicit_header_true(self, tmp_path: Path) -> None:
        p = tmp_path / "h.csv"
        p.write_text("a,b,c\n1,2,3\n4,5,6\n")
        out = read_numbers(str(p), header=True)
        np.testing.assert_array_equal(out.a, [1.0, 4.0])
        np.testing.assert_array_equal(out.b, [2.0, 5.0])
        np.testing.assert_array_equal(out.c, [3.0, 6.0])

    def test_header_only_no_data(self, tmp_path: Path) -> None:
        p = tmp_path / "h.csv"
        p.write_text("col1,col2\n")
        out = read_numbers(str(p), header=True)
        assert out.col1.shape == (0,)
        assert out.col2.shape == (0,)

    def test_header_skips_bad_rows(self, tmp_path: Path) -> None:
        p = tmp_path / "h.csv"
        p.write_text("x,y\n1,2\nbad_row\n3,4\n")
        out = read_numbers(str(p), header=True)
        np.testing.assert_array_equal(out.x, [1.0, 3.0])
        np.testing.assert_array_equal(out.y, [2.0, 4.0])

    def test_header_whitespace_separated(self, tmp_path: Path) -> None:
        p = tmp_path / "h.txt"
        p.write_text("alpha beta\n10 20\n30 40\n")
        out = read_numbers(str(p), header=True)
        np.testing.assert_array_equal(out.alpha, [10.0, 30.0])
        np.testing.assert_array_equal(out.beta, [20.0, 40.0])

    def test_ambiguous_first_row_raises(self, tmp_path: Path) -> None:
        p = tmp_path / "bad.csv"
        p.write_text("1,x\n2,3\n")
        with pytest.raises(ValueError, match="mixes"):
            read_numbers(str(p))

    def test_empty_file_header_true_returns_empty(self, tmp_path: Path) -> None:
        p = tmp_path / "e.csv"
        p.write_text("")
        out = read_numbers(str(p), header=True)
        assert out == {}

    def test_named_tuple_is_tuple(self, tmp_path: Path) -> None:
        p = tmp_path / "nt.csv"
        p.write_text("a,b\n1,2\n")
        out = read_numbers(str(p), header=True)
        assert isinstance(out, tuple)

    def test_column_dtype_float64(self, tmp_path: Path) -> None:
        p = tmp_path / "dt.csv"
        p.write_text("v\n1\n2\n3\n")
        out = read_numbers(str(p), header=True)
        assert out.v.dtype == np.float64


# ---------------------------------------------------------------------------
# sleep_ms
# ---------------------------------------------------------------------------

class TestSleepMs:
    def test_sleep_zero(self) -> None:
        start = time.monotonic()
        sleep_ms(0)
        elapsed = time.monotonic() - start
        assert elapsed < 0.5  # should be nearly instant

    def test_sleep_short(self) -> None:
        start = time.monotonic()
        sleep_ms(50)
        elapsed = time.monotonic() - start
        # Allow generous range to avoid flakiness in CI
        assert elapsed >= 0.03

    def test_sleep_ms_via_namespace(self) -> None:
        io = build_io_namespace()
        start = time.monotonic()
        io["sleep_ms"](10)
        elapsed = time.monotonic() - start
        assert elapsed < 1.0  # just shouldn't hang

    def test_sleep_seconds_via_public_api(self) -> None:
        start = time.monotonic()
        sleep(0.01)
        elapsed = time.monotonic() - start
        assert elapsed < 1.0  # just shouldn't hang

    def test_io_namespace_has_sleep_and_sleep_ms(self) -> None:
        io = build_io_namespace()
        assert "sleep" in io
        assert "sleep_ms" in io
        assert callable(io["sleep"])
        assert callable(io["sleep_ms"])

    def test_seconds_namespace_has_only_sleep(self) -> None:
        io = build_io_seconds_namespace()
        assert set(io.keys()) == {"sleep"}
        assert callable(io["sleep"])

    def test_native_namespace_has_file_io_and_preferred_sleep(self) -> None:
        io = build_io_native_namespace()
        assert {
            "read_text",
            "write_text",
            "read_bytes",
            "write_bytes",
            "read_numbers",
            "sleep",
        } == set(io.keys())
        assert "sleep_ms" not in io


# ---------------------------------------------------------------------------
# VKF interpreter integration
# ---------------------------------------------------------------------------

class TestIoVkfIntegration:
    def test_write_read_text_via_vkf(self, tmp_path: Path) -> None:
        p = str(tmp_path / "vkf.txt")
        src = f"""
:.io
io.write_text("{p}", "from vkf")
t : io.read_text("{p}")
:: t
"""
        lines = _run(src)
        assert lines[0] == "from vkf"

    def test_write_read_text_bound_module(self, tmp_path: Path) -> None:
        # io is auto-loaded in builtins — use io.write_text / io.read_text directly
        p = str(tmp_path / "vkf2.txt")
        src = f"""
io.write_text("{p}", "bound")
:: io.read_text("{p}")
"""
        lines = _run(src)
        assert lines[0] == "bound"

    def test_io_namespace_has_sleep_ms(self) -> None:
        io = resolve_stdlib("io")
        assert "sleep" in io
        assert "sleep_ms" in io
        assert callable(io["sleep"])
        assert callable(io["sleep_ms"])
