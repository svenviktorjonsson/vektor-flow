"""Stdlib ``io``: text/bytes I/O and ``read_numbers`` tables."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from vektorflow.stdlib import resolve_stdlib
from vektorflow.stdlib import io as iolib
from vektorflow.stdlib.io import (
    build_io_clock_namespace,
    build_io_file_namespace,
    build_io_native_file_namespace,
    build_io_native_namespace,
    build_io_native_time_namespace,
    build_io_namespace,
    build_io_seconds_namespace,
    build_io_time_namespace,
    get_io_clock_host,
    get_io_file_host,
    get_io_native_host,
    get_io_seconds_host,
    get_io_time_host,
    read_numbers,
    reset_io_native_host,
    set_io_native_host,
    set_io_seconds_host,
)


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

    def test_file_and_clock_subnamespaces_are_separate(self) -> None:
        file_ns = build_io_file_namespace()
        native_file_ns = build_io_native_file_namespace()
        native_ns = build_io_native_namespace()
        clock_ns = build_io_clock_namespace()
        seconds_ns = build_io_seconds_namespace()
        native_time_ns = build_io_native_time_namespace()
        time_ns = build_io_time_namespace()
        full_ns = build_io_namespace()

        assert set(file_ns.keys()) == {
            "read_text",
            "write_text",
            "read_bytes",
            "write_bytes",
            "read_numbers",
        }
        assert native_file_ns == file_ns
        assert set(native_ns.keys()) == set(file_ns.keys()) | {"sleep"}
        assert set(seconds_ns.keys()) == {"sleep"}
        assert native_time_ns == seconds_ns
        assert set(clock_ns.keys()) == {"sleep", "sleep_ms"}
        assert native_ns == native_file_ns | native_time_ns
        assert native_ns["sleep"] is seconds_ns["sleep"]
        assert seconds_ns["sleep"] is time_ns["sleep"]
        assert time_ns == clock_ns
        assert set(full_ns.keys()) == set(file_ns.keys()) | set(clock_ns.keys())


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

    def test_io_host_accepts_preferred_seconds_based_combined_host(self) -> None:
        class FakeHost:
            def __init__(self) -> None:
                self.calls: list[tuple[str, object]] = []

            def read_bytes(self, path: str) -> bytes:
                self.calls.append(("read_bytes", path))
                return b"seconds-host-bytes"

            def write_bytes(self, path: str, data: bytes) -> None:
                self.calls.append(("write_bytes", (path, data)))

            def read_text(self, path: str, *, encoding: str) -> str:
                self.calls.append(("read_text", (path, encoding)))
                return "seconds-host-text"

            def write_text(self, path: str, text: str, *, encoding: str) -> None:
                self.calls.append(("write_text", (path, text, encoding)))

            def sleep(self, seconds: float) -> None:
                self.calls.append(("sleep", float(seconds)))

        host = FakeHost()
        iolib.set_io_host(host)

        assert iolib.read_text("virtual.txt") == "seconds-host-text"
        assert iolib.read_bytes("virtual.bin") == b"seconds-host-bytes"
        iolib.write_text("virtual.txt", "hello")
        iolib.write_bytes("virtual.bin", b"abc")
        iolib.sleep(0.5)
        iolib.sleep_ms(250)

        assert host.calls == [
            ("read_text", ("virtual.txt", "utf-8")),
            ("read_bytes", "virtual.bin"),
            ("write_text", ("virtual.txt", "hello", "utf-8")),
            ("write_bytes", ("virtual.bin", b"abc")),
            ("sleep", 0.5),
            ("sleep", 0.25),
        ]

    def test_file_and_clock_hosts_can_be_overridden_independently(self) -> None:
        class FakeFileHost:
            def __init__(self) -> None:
                self.calls: list[tuple[str, object]] = []

            def read_bytes(self, path: str) -> bytes:
                self.calls.append(("read_bytes", path))
                return b"sep-bytes"

            def write_bytes(self, path: str, data: bytes) -> None:
                self.calls.append(("write_bytes", (path, data)))

            def read_text(self, path: str, *, encoding: str) -> str:
                self.calls.append(("read_text", (path, encoding)))
                return "sep-text"

            def write_text(self, path: str, text: str, *, encoding: str) -> None:
                self.calls.append(("write_text", (path, text, encoding)))

        class FakeClockHost:
            def __init__(self) -> None:
                self.calls: list[float] = []

            def sleep_ms(self, ms: float) -> None:
                self.calls.append(float(ms))

        file_host = FakeFileHost()
        clock_host = FakeClockHost()
        iolib.set_io_file_host(file_host)
        iolib.set_io_clock_host(clock_host)

        assert iolib.read_text("file.txt") == "sep-text"
        assert iolib.read_bytes("file.bin") == b"sep-bytes"
        iolib.write_text("file.txt", "payload")
        iolib.write_bytes("file.bin", b"x")
        iolib.sleep_ms(7)

        assert file_host.calls == [
            ("read_text", ("file.txt", "utf-8")),
            ("read_bytes", "file.bin"),
            ("write_text", ("file.txt", "payload", "utf-8")),
            ("write_bytes", ("file.bin", b"x")),
        ]
        assert clock_host.calls == [7.0]

    def test_time_host_alias_matches_clock_host_behavior(self) -> None:
        class FakeTimeHost:
            def __init__(self) -> None:
                self.calls: list[float] = []

            def sleep_ms(self, ms: float) -> None:
                self.calls.append(float(ms))

        host = FakeTimeHost()
        iolib.set_io_time_host(host)
        iolib.sleep_ms(3.5)
        assert host.calls == [3.5]

        iolib.reset_io_time_host()

    def test_sleep_uses_time_host_with_seconds_input(self) -> None:
        class FakeTimeHost:
            def __init__(self) -> None:
                self.calls: list[float] = []

            def sleep_ms(self, ms: float) -> None:
                self.calls.append(float(ms))

        host = FakeTimeHost()
        iolib.set_io_time_host(host)
        build_io_time_namespace()["sleep"](0.25)

        assert host.calls == [250.0]

    def test_sleep_prefers_seconds_method_when_host_exposes_it(self) -> None:
        class FakeTimeHost:
            def __init__(self) -> None:
                self.second_calls: list[float] = []
                self.ms_calls: list[float] = []

            def sleep(self, seconds: float) -> None:
                self.second_calls.append(float(seconds))

            def sleep_ms(self, ms: float) -> None:
                self.ms_calls.append(float(ms))

        host = FakeTimeHost()
        iolib.set_io_time_host(host)
        build_io_time_namespace()["sleep"](0.125)

        assert host.second_calls == [0.125]
        assert host.ms_calls == []

    def test_seconds_namespace_uses_preferred_sleep_surface(self) -> None:
        class FakeSecondsHost:
            def __init__(self) -> None:
                self.calls: list[float] = []

            def sleep(self, seconds: float) -> None:
                self.calls.append(float(seconds))

        host = FakeSecondsHost()
        set_io_seconds_host(host)
        build_io_seconds_namespace()["sleep"](0.75)

        assert host.calls == [0.75]

    def test_native_namespace_combines_file_and_preferred_time_surfaces(self) -> None:
        class FakeHost:
            def __init__(self) -> None:
                self.calls: list[tuple[str, object]] = []

            def read_bytes(self, path: str) -> bytes:
                self.calls.append(("read_bytes", path))
                return b"native-bytes"

            def write_bytes(self, path: str, data: bytes) -> None:
                self.calls.append(("write_bytes", (path, data)))

            def read_text(self, path: str, *, encoding: str) -> str:
                self.calls.append(("read_text", (path, encoding)))
                return "native-text"

            def write_text(self, path: str, text: str, *, encoding: str) -> None:
                self.calls.append(("write_text", (path, text, encoding)))

            def sleep(self, seconds: float) -> None:
                self.calls.append(("sleep", float(seconds)))

        host = FakeHost()
        iolib.set_io_host(host)
        ns = build_io_native_namespace()

        assert ns["read_text"]("native.txt") == "native-text"
        assert ns["read_bytes"]("native.bin") == b"native-bytes"
        ns["write_text"]("native.txt", "hello")
        ns["write_bytes"]("native.bin", b"abc")
        ns["sleep"](0.4)

        assert "sleep_ms" not in ns
        assert host.calls == [
            ("read_text", ("native.txt", "utf-8")),
            ("read_bytes", "native.bin"),
            ("write_text", ("native.txt", "hello", "utf-8")),
            ("write_bytes", ("native.bin", b"abc")),
            ("sleep", 0.4),
        ]

    def test_set_io_native_host_installs_preferred_combined_surface(self) -> None:
        class FakeHost:
            def __init__(self) -> None:
                self.calls: list[tuple[str, object]] = []

            def read_bytes(self, path: str) -> bytes:
                self.calls.append(("read_bytes", path))
                return b"native-host-bytes"

            def write_bytes(self, path: str, data: bytes) -> None:
                self.calls.append(("write_bytes", (path, data)))

            def read_text(self, path: str, *, encoding: str) -> str:
                self.calls.append(("read_text", (path, encoding)))
                return "native-host-text"

            def write_text(self, path: str, text: str, *, encoding: str) -> None:
                self.calls.append(("write_text", (path, text, encoding)))

            def sleep(self, seconds: float) -> None:
                self.calls.append(("sleep", float(seconds)))

        host = FakeHost()
        set_io_native_host(host)

        assert get_io_native_host() is host
        assert iolib.read_text("native.txt") == "native-host-text"
        assert iolib.read_bytes("native.bin") == b"native-host-bytes"
        iolib.write_text("native.txt", "hello")
        iolib.write_bytes("native.bin", b"abc")
        iolib.sleep(0.2)
        iolib.sleep_ms(300)

        assert host.calls == [
            ("read_text", ("native.txt", "utf-8")),
            ("read_bytes", "native.bin"),
            ("write_text", ("native.txt", "hello", "utf-8")),
            ("write_bytes", ("native.bin", b"abc")),
            ("sleep", 0.2),
            ("sleep", 0.3),
        ]

    def test_reset_io_native_host_restores_default_native_surface(self) -> None:
        class FakeHost:
            def read_bytes(self, path: str) -> bytes:
                return b"fake"

            def write_bytes(self, path: str, data: bytes) -> None:
                return None

            def read_text(self, path: str, *, encoding: str) -> str:
                return "fake"

            def write_text(self, path: str, text: str, *, encoding: str) -> None:
                return None

            def sleep(self, seconds: float) -> None:
                return None

        set_io_native_host(FakeHost())
        native_host = get_io_native_host()
        assert native_host.read_text("any.txt", encoding="utf-8") == "fake"

        reset_io_native_host()

        native_host = get_io_native_host()
        assert native_host is not get_io_file_host()
        assert native_host is not get_io_time_host()
        assert native_host._file_host.__class__.__name__ == "PythonIoFileHost"
        assert native_host._time_host.__class__.__name__ == "PythonIoTimeHost"

    def test_get_io_native_host_round_trips_combined_host_identity(self) -> None:
        class FakeHost:
            def read_bytes(self, path: str) -> bytes:
                return b"combined"

            def write_bytes(self, path: str, data: bytes) -> None:
                return None

            def read_text(self, path: str, *, encoding: str) -> str:
                return "combined"

            def write_text(self, path: str, text: str, *, encoding: str) -> None:
                return None

            def sleep(self, seconds: float) -> None:
                return None

        host = FakeHost()
        iolib.set_io_host(host)

        assert get_io_native_host() is host

    def test_get_io_native_host_adapts_separate_file_and_time_hosts(self) -> None:
        class FakeFileHost:
            def __init__(self) -> None:
                self.calls: list[tuple[str, object]] = []

            def read_bytes(self, path: str) -> bytes:
                self.calls.append(("read_bytes", path))
                return b"split-bytes"

            def write_bytes(self, path: str, data: bytes) -> None:
                self.calls.append(("write_bytes", (path, data)))

            def read_text(self, path: str, *, encoding: str) -> str:
                self.calls.append(("read_text", (path, encoding)))
                return "split-text"

            def write_text(self, path: str, text: str, *, encoding: str) -> None:
                self.calls.append(("write_text", (path, text, encoding)))

        class FakeSecondsHost:
            def __init__(self) -> None:
                self.calls: list[float] = []

            def sleep(self, seconds: float) -> None:
                self.calls.append(float(seconds))

        file_host = FakeFileHost()
        time_host = FakeSecondsHost()
        iolib.set_io_file_host(file_host)
        set_io_seconds_host(time_host)

        native_host = get_io_native_host()

        assert native_host.read_text("split.txt", encoding="utf-8") == "split-text"
        assert native_host.read_bytes("split.bin") == b"split-bytes"
        native_host.write_text("split.txt", "payload", encoding="utf-8")
        native_host.write_bytes("split.bin", b"x")
        native_host.sleep(0.6)

        assert native_host is not file_host
        assert native_host is not time_host
        assert file_host.calls == [
            ("read_text", ("split.txt", "utf-8")),
            ("read_bytes", "split.bin"),
            ("write_text", ("split.txt", "payload", "utf-8")),
            ("write_bytes", ("split.bin", b"x")),
        ]
        assert time_host.calls == [0.6]

    def test_seconds_only_host_installs_through_preferred_setter(self) -> None:
        class FakeSecondsHost:
            def __init__(self) -> None:
                self.calls: list[float] = []

            def sleep(self, seconds: float) -> None:
                self.calls.append(float(seconds))

        host = FakeSecondsHost()
        set_io_seconds_host(host)

        iolib.sleep(0.5)
        iolib.sleep_ms(250)

        assert host.calls == [0.5, 0.25]
        assert get_io_time_host() is not host

    def test_time_host_setter_rejects_host_without_sleep_methods(self) -> None:
        class BadHost:
            pass

        with pytest.raises(TypeError, match="time host must define"):
            iolib.set_io_time_host(BadHost())  # type: ignore[arg-type]

    def test_get_io_seconds_host_adapts_legacy_ms_host(self) -> None:
        class FakeTimeHost:
            def __init__(self) -> None:
                self.calls: list[float] = []

            def sleep_ms(self, ms: float) -> None:
                self.calls.append(float(ms))

        host = FakeTimeHost()
        iolib.set_io_time_host(host)

        seconds_host = get_io_seconds_host()
        seconds_host.sleep(0.2)

        assert host.calls == [200.0]
        assert seconds_host is not host

    def test_get_io_seconds_host_round_trips_seconds_host_identity(self) -> None:
        class FakeSecondsHost:
            def sleep(self, seconds: float) -> None:
                return None

        host = FakeSecondsHost()
        set_io_seconds_host(host)

        assert get_io_seconds_host() is host

    def test_getters_expose_current_hosts_for_restore(self) -> None:
        original_file_host = get_io_file_host()
        original_time_host = get_io_time_host()

        class FakeFileHost:
            def read_bytes(self, path: str) -> bytes:
                return b"override"

            def write_bytes(self, path: str, data: bytes) -> None:
                return None

            def read_text(self, path: str, *, encoding: str) -> str:
                return "override"

            def write_text(self, path: str, text: str, *, encoding: str) -> None:
                return None

        class FakeTimeHost:
            def sleep_ms(self, ms: float) -> None:
                return None

        file_host = FakeFileHost()
        time_host = FakeTimeHost()
        iolib.set_io_file_host(file_host)
        iolib.set_io_time_host(time_host)

        assert get_io_file_host() is file_host
        assert get_io_time_host() is time_host
        assert get_io_clock_host() is time_host

        iolib.set_io_file_host(original_file_host)
        iolib.set_io_time_host(original_time_host)

        assert get_io_file_host() is original_file_host
        assert get_io_time_host() is original_time_host


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
        class FakeFileHost:
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

        iolib.set_io_file_host(FakeFileHost())
        out = read_numbers("virtual.csv")
        np.testing.assert_array_equal(out.x, np.array([1.0, 3.0]))
        np.testing.assert_array_equal(out.y, np.array([2.0, 4.0]))
