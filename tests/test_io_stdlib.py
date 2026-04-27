"""Stdlib ``io``: text/bytes I/O and ``read_numbers`` tables."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from vektorflow.stdlib import resolve_stdlib
from vektorflow.stdlib import io as iolib
from vektorflow.stdlib.io import build_io_namespace, read_numbers


@pytest.fixture(autouse=True)
def _reset_io_host() -> None:
    iolib.reset_io_host()
    yield
    iolib.reset_io_host()


class TestResolve:
    def test_io_in_resolve_stdlib(self) -> None:
        io = resolve_stdlib("io")
        assert set(io.keys()) >= {
            "read_text",
            "write_text",
            "read_bytes",
            "write_bytes",
            "read_numbers",
        }


class TestTextBytes:
    def test_write_read_text_roundtrip(self, tmp_path: Path) -> None:
        io = build_io_namespace()
        p = tmp_path / "t.txt"
        io["write_text"](str(p), "héllo\n", encoding="utf-8")
        assert io["read_text"](str(p), encoding="utf-8") == "héllo\n"

    def test_write_read_bytes_roundtrip(self, tmp_path: Path) -> None:
        io = build_io_namespace()
        p = tmp_path / "b.bin"
        io["write_bytes"](str(p), b"\x00\xff\x80")
        assert io["read_bytes"](str(p)) == b"\x00\xff\x80"

    def test_write_bytes_rejects_non_bytes(self, tmp_path: Path) -> None:
        io = build_io_namespace()
        with pytest.raises(TypeError):
            io["write_bytes"](str(tmp_path / "x.bin"), "not bytes")  # type: ignore[arg-type]

    def test_io_host_seam_can_override_text_bytes_and_sleep(self) -> None:
        class FakeHost:
            def __init__(self) -> None:
                self.calls: list[tuple[str, object]] = []

            def read_bytes(self, path: str) -> bytes:
                self.calls.append(("read_bytes", path))
                return b"host-bytes"

            def write_bytes(self, path: str, data: bytes) -> None:
                self.calls.append(("write_bytes", (path, data)))

            def read_text(self, path: str, *, encoding: str) -> str:
                self.calls.append(("read_text", (path, encoding)))
                return "host-text"

            def write_text(self, path: str, text: str, *, encoding: str) -> None:
                self.calls.append(("write_text", (path, text, encoding)))

            def sleep_ms(self, ms: float) -> None:
                self.calls.append(("sleep_ms", float(ms)))

        host = FakeHost()
        iolib.set_io_host(host)

        assert iolib.read_text("virtual.txt") == "host-text"
        assert iolib.read_bytes("virtual.bin") == b"host-bytes"
        iolib.write_text("virtual.txt", "hello")
        iolib.write_bytes("virtual.bin", b"abc")
        iolib.sleep_ms(12.5)

        assert host.calls == [
            ("read_text", ("virtual.txt", "utf-8")),
            ("read_bytes", "virtual.bin"),
            ("write_text", ("virtual.txt", "hello", "utf-8")),
            ("write_bytes", ("virtual.bin", b"abc")),
            ("sleep_ms", 12.5),
        ]


class TestReadNumbers:
    def test_auto_header_csv_named_tuple_columns(self, tmp_path: Path) -> None:
        p = tmp_path / "d.csv"
        p.write_text("a,b\n1,2\n3,4\n", encoding="utf-8")
        out = read_numbers(str(p))
        np.testing.assert_array_equal(out.a, np.array([1.0, 3.0]))
        np.testing.assert_array_equal(out.b, np.array([2.0, 4.0]))
        assert isinstance(out, tuple)

    def test_no_header_matrix_2d_array(self, tmp_path: Path) -> None:
        p = tmp_path / "n.txt"
        p.write_text("1 2\n3 4\n", encoding="utf-8")
        out = read_numbers(str(p), header=False)
        np.testing.assert_array_equal(
            out, np.array([[1.0, 2.0], [3.0, 4.0]], dtype=np.float64)
        )
        assert out.ndim == 2

    def test_auto_all_numeric_first_row_is_matrix(self, tmp_path: Path) -> None:
        p = tmp_path / "d.txt"
        p.write_text("1,2\n3,4\n", encoding="utf-8")
        out = read_numbers(str(p))
        np.testing.assert_array_equal(
            out, np.array([[1.0, 2.0], [3.0, 4.0]], dtype=np.float64)
        )

    def test_explicit_header_true(self, tmp_path: Path) -> None:
        p = tmp_path / "d.csv"
        p.write_text("x,y\n10,20\n", encoding="utf-8")
        out = read_numbers(str(p), header=True)
        np.testing.assert_array_equal(out.x, np.array([10.0]))
        np.testing.assert_array_equal(out.y, np.array([20.0]))

    def test_ambiguous_first_row_errors(self, tmp_path: Path) -> None:
        p = tmp_path / "bad.csv"
        p.write_text("1,x\n2,3\n", encoding="utf-8")
        with pytest.raises(ValueError, match="mixes"):
            read_numbers(str(p))

    def test_empty_file_auto(self, tmp_path: Path) -> None:
        p = tmp_path / "e.txt"
        p.write_text("", encoding="utf-8")
        out = read_numbers(str(p))
        assert out.shape == (0, 0)
        assert out.dtype == np.float64

    def test_header_only_no_data_rows(self, tmp_path: Path) -> None:
        p = tmp_path / "h.csv"
        p.write_text("a,b,c\n", encoding="utf-8")
        out = read_numbers(str(p))
        assert out.a.shape == (0,)
        assert out.b.shape == (0,)
        assert out.c.shape == (0,)

    def test_delimiter_tab(self, tmp_path: Path) -> None:
        p = tmp_path / "t.tsv"
        p.write_text("1\t2\n3\t4\n", encoding="utf-8")
        out = read_numbers(str(p), delimiter="\t", header=False)
        np.testing.assert_array_equal(
            out, np.array([[1.0, 2.0], [3.0, 4.0]], dtype=np.float64)
        )

    def test_matrix_skips_non_numeric_and_ragged_rows(self, tmp_path: Path) -> None:
        p = tmp_path / "m.txt"
        p.write_text(
            "# skip me\n"
            "1 2 3\n"
            "garbage\n"
            "4 5 6\n"
            "7 8\n\n",
            encoding="utf-8",
        )
        out = read_numbers(str(p), header=False)
        np.testing.assert_array_equal(
            out, np.array([[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]], dtype=np.float64)
        )

    def test_header_mode_skips_bad_data_rows(self, tmp_path: Path) -> None:
        p = tmp_path / "h.csv"
        p.write_text("a,b\n1,2\noops\n3,4\n", encoding="utf-8")
        out = read_numbers(str(p), header=True)
        np.testing.assert_array_equal(out.a, np.array([1.0, 3.0]))
        np.testing.assert_array_equal(out.b, np.array([2.0, 4.0]))

    def test_no_numpy_matrix_fallback(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        p = tmp_path / "n.txt"
        p.write_text("1 2\n3 4\n", encoding="utf-8")
        monkeypatch.setattr(iolib, "np", None)
        out = read_numbers(str(p), header=False)
        assert out.shape == (2, 2)
        assert out.ndim == 2
        assert out.dtype == "float64"
        assert list(out) == [[1.0, 2.0], [3.0, 4.0]]

    def test_no_numpy_header_fallback(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        p = tmp_path / "d.csv"
        p.write_text("a,b\n1,2\n3,4\n", encoding="utf-8")
        monkeypatch.setattr(iolib, "np", None)
        out = read_numbers(str(p))
        assert list(out.a) == [1.0, 3.0]
        assert list(out.b) == [2.0, 4.0]
        assert out.a.dtype == "float64"
        assert out.a.shape == (2,)

    def test_read_numbers_uses_installed_host_text_reader(self) -> None:
        class FakeHost:
            def read_bytes(self, path: str) -> bytes:
                raise AssertionError("unused")

            def write_bytes(self, path: str, data: bytes) -> None:
                raise AssertionError("unused")

            def read_text(self, path: str, *, encoding: str) -> str:
                assert path == "virtual.csv"
                assert encoding == "utf-8"
                return "x,y\n1,2\n3,4\n"

            def write_text(self, path: str, text: str, *, encoding: str) -> None:
                raise AssertionError("unused")

            def sleep_ms(self, ms: float) -> None:
                raise AssertionError("unused")

        iolib.set_io_host(FakeHost())
        out = read_numbers("virtual.csv")
        np.testing.assert_array_equal(out.x, np.array([1.0, 3.0]))
        np.testing.assert_array_equal(out.y, np.array([2.0, 4.0]))
