"""Built-in ``io`` library: read/write text and bytes, and load numeric tables."""

from __future__ import annotations

import os
import time
from collections import namedtuple
from pathlib import Path
from typing import Any, Protocol

try:
    import numpy as np  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - exercised via fallback tests
    np = None


class IoFileHost(Protocol):
    """Filesystem host seam for stdlib ``io``.

    The table parsing logic in this module is portable; file reads/writes route
    through this interface so a future native runtime can replace the Python
    filesystem host without rewriting that logic.
    """

    def read_bytes(self, path: str) -> bytes: ...

    def write_bytes(self, path: str, data: bytes) -> None: ...

    def read_text(self, path: str, *, encoding: str) -> str: ...

    def write_text(self, path: str, text: str, *, encoding: str) -> None: ...


class IoClockHost(Protocol):
    """Timing host seam for stdlib ``io`` compatibility helpers."""

    def sleep_ms(self, ms: float) -> None: ...


class PythonIoFileHost:
    """Default filesystem host backed by Python ``pathlib``."""

    def _as_path(self, path: str) -> Path:
        if not isinstance(path, str):
            raise TypeError("path must be a string")
        # On Windows, vkf source often embeds raw paths with backslashes
        # (e.g. "C:\Users\name\..."), which can contain control chars
        # after string unescaping (\t, \n, \r). Re-hydrate those into
        # literal backslash sequences for robust file I/O.
        if os.name == "nt":
            path = path.replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r")
        return Path(path)

    def read_bytes(self, path: str) -> bytes:
        return self._as_path(path).read_bytes()

    def write_bytes(self, path: str, data: bytes) -> None:
        self._as_path(path).write_bytes(data)

    def read_text(self, path: str, *, encoding: str) -> str:
        return self._as_path(path).read_text(encoding=encoding)

    def write_text(self, path: str, text: str, *, encoding: str) -> None:
        self._as_path(path).write_text(text, encoding=encoding)


class PythonIoClockHost:
    """Default timing host backed by Python ``time.sleep``."""

    def sleep_ms(self, ms: float) -> None:
        time.sleep(float(ms) * 0.001)


class IoHost(IoFileHost, IoClockHost, Protocol):
    """Combined compatibility protocol for callers that install one host object."""


_file_host: IoFileHost = PythonIoFileHost()
_clock_host: IoClockHost = PythonIoClockHost()


def set_io_host(host: IoHost) -> None:
    """Install one host that satisfies both the file and clock seams."""
    set_io_file_host(host)
    set_io_clock_host(host)


def set_io_file_host(host: IoFileHost) -> None:
    """Install a custom filesystem host adapter for stdlib ``io`` operations."""
    global _file_host
    _file_host = host


def set_io_clock_host(host: IoClockHost) -> None:
    """Install a custom timing host adapter for stdlib ``io`` compatibility helpers."""
    global _clock_host
    _clock_host = host


def reset_io_host() -> None:
    """Restore the default Python-backed host adapters."""
    reset_io_file_host()
    reset_io_clock_host()


def reset_io_file_host() -> None:
    """Restore the default Python-backed filesystem host adapter."""
    global _file_host
    _file_host = PythonIoFileHost()


def reset_io_clock_host() -> None:
    """Restore the default Python-backed timing host adapter."""
    global _clock_host
    _clock_host = PythonIoClockHost()


class NumericColumn(list[float]):
    """Tiny numpy-free 1-D numeric column fallback."""

    @property
    def dtype(self) -> str:
        return "float64"

    @property
    def shape(self) -> tuple[int]:
        return (len(self),)

    @property
    def ndim(self) -> int:
        return 1


class NumericMatrix:
    """Tiny numpy-free 2-D numeric matrix fallback."""

    def __init__(self, rows: list[list[float]]) -> None:
        self._rows = rows

    def __iter__(self):
        return iter(self._rows)

    def __len__(self) -> int:
        return len(self._rows)

    def __getitem__(self, idx: int) -> list[float]:
        return self._rows[idx]

    @property
    def dtype(self) -> str:
        return "float64"

    @property
    def shape(self) -> tuple[int, int]:
        if not self._rows:
            return (0, 0)
        return (len(self._rows), len(self._rows[0]))

    @property
    def ndim(self) -> int:
        return 2

    def to_list(self) -> list[list[float]]:
        return [list(row) for row in self._rows]

    def __repr__(self) -> str:
        return f"NumericMatrix(shape={self.shape}, rows={self._rows!r})"


def _make_matrix(rows: list[list[float]]) -> Any:
    if np is not None:
        if not rows:
            return np.zeros((0, 0), dtype=np.float64)
        return np.asarray(rows, dtype=np.float64)
    return NumericMatrix(rows)


def _make_column(values: list[float]) -> Any:
    if np is not None:
        return np.asarray(values, dtype=np.float64)
    return NumericColumn(values)


def write_bytes(path: str, data: bytes) -> None:
    """Write raw bytes to ``path`` (overwrites)."""
    if not isinstance(data, (bytes, bytearray)):
        raise TypeError("write_bytes expects bytes")
    _file_host.write_bytes(path, bytes(data))


def read_bytes(path: str) -> bytes:
    """Read the entire file as bytes."""
    return _file_host.read_bytes(path)


def write_text(path: str, text: str, encoding: str = "utf-8") -> None:
    """Write ``text`` to ``path`` (overwrites)."""
    _file_host.write_text(path, str(text), encoding=encoding)


def read_text(path: str, encoding: str = "utf-8") -> str:
    """Read the entire file as a decoded string."""
    return _file_host.read_text(path, encoding=encoding)


def _parse_float(cell: str) -> float | None:
    s = cell.strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _split_row(line: str, delimiter: str | None) -> list[str]:
    if delimiter is not None:
        return line.split(delimiter)
    s = line.strip()
    if "," in s:
        return [p.strip() for p in s.split(",")]
    return s.split()


def _parse_numeric_row(cells: list[str]) -> list[float] | None:
    """Every cell must be non-empty and parse as a float."""
    if not cells:
        return None
    out: list[float] = []
    for c in cells:
        s = c.strip()
        if not s:
            return None
        v = _parse_float(s)
        if v is None:
            return None
        out.append(v)
    return out


def _classify_first_row(cells: list[str]) -> str:
    """``'data'`` if the row is all numeric, ``'header'`` if none parse as floats, else ``'ambiguous'``."""
    non_empty = [c.strip() for c in cells if c.strip()]
    if not non_empty:
        return "data"
    parses = [_parse_float(c) is not None for c in non_empty]
    if all(parses):
        return "data"
    if not any(parses):
        return "header"
    return "ambiguous"


def _matrix_from_lines(
    lines: list[str], delimiter: str | None
) -> Any:
    """2-D float matrix ``(n_rows, n_cols)``.

    First row where every cell is numeric sets the column count; other rows must
    match or are skipped.
    """
    matrix: list[list[float]] = []
    n_cols: int | None = None
    for ln in lines:
        cells = _split_row(ln, delimiter)
        row = _parse_numeric_row(cells)
        if row is None:
            continue
        if n_cols is None:
            n_cols = len(row)
            matrix.append(row)
            continue
        if len(row) == n_cols:
            matrix.append(row)
        # else: wrong width — skip
    return _make_matrix(matrix)


def _dict_from_header_lines(
    lines: list[str],
    delimiter: str | None,
    names: list[str],
) -> Any:
    """Named tuple of column vectors."""
    n_cols = len(names)
    if not names or not any(names):
        raise ValueError("read_numbers: empty header row")
    for name in names:
        if not name:
            raise ValueError("read_numbers: empty column name")
    columns: list[list[float]] = [[] for _ in range(n_cols)]
    for ln in lines:
        cells = _split_row(ln, delimiter)
        row = _parse_numeric_row(cells)
        if row is None or len(row) != n_cols:
            continue
        for j in range(n_cols):
            columns[j].append(row[j])
    col_arrays = tuple(_make_column(columns[j]) for j in range(n_cols))
    Table = namedtuple("Table", names, rename=True)  # type: ignore[misc]
    return Table(*col_arrays)


def read_numbers(
    path: str,
    *,
    delimiter: str | None = None,
    header: bool | None = None,
) -> Any:
    """Load a delimiter-separated numeric table from ``path``.

    Rows are split by newlines; within a row, cells are separated by ``delimiter``,
    or if ``delimiter`` is omitted, by comma (if the line contains ``,``) else by
    whitespace.

    * **With header** (``header is True``, or auto-detected): returns a
      :func:`collections.namedtuple` whose fields are column names; each field is a
      numeric column vector. When NumPy is installed this is a **1-D**
      :class:`numpy.ndarray` ``dtype=float64``; otherwise it is a built-in
      ``NumericColumn`` list-like fallback. Data rows that are not fully numeric or
      whose width differs from the header are **skipped**.
    * **Without header** (``header is False``, or auto-detected numeric first row):
      returns a numeric matrix. When NumPy is installed this is a **2-D**
      :class:`numpy.ndarray` ``dtype=float64`` with shape ``(n_rows, n_cols)``;
      otherwise it is a built-in ``NumericMatrix`` fallback with the same
      row/column shape metadata. The **first** row where every cell is numeric sets
      the column count; leading non-numeric lines are skipped; later rows that do
      not match width or are not all-numeric are skipped.
    * ``header is None`` (default): auto-detect — if the first row looks like a
      header (no cell parses as a float), use header mode; otherwise matrix mode.

    Empty files: ``{}`` when ``header is True`` and there are no lines; a **0×0**
    numeric matrix when no matrix rows are found.
    """
    text = read_text(path)
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if not lines:
        if header is True:
            return {}
        return _make_matrix([])

    first = _split_row(lines[0], delimiter)

    if header is True:
        names = [c.strip() for c in first]
        return _dict_from_header_lines(lines[1:], delimiter, names)

    if header is False:
        return _matrix_from_lines(lines, delimiter)

    # header is None — auto-detect
    kind = _classify_first_row(first)
    if kind == "ambiguous":
        raise ValueError(
            "read_numbers: first row mixes numbers and text; set header=True or False"
        )
    if kind == "header":
        names = [c.strip() for c in first]
        return _dict_from_header_lines(lines[1:], delimiter, names)

    # First row is all numeric — matrix (first numeric row anchors column count)
    return _matrix_from_lines(lines, delimiter)


def sleep_ms(ms: float) -> None:
    """Cooperative sleep (event-loop friendly). *ms* in milliseconds (fractional allowed)."""
    _clock_host.sleep_ms(ms)


def build_io_namespace() -> dict[str, Any]:
    return {
        "read_text": read_text,
        "write_text": write_text,
        "read_bytes": read_bytes,
        "write_bytes": write_bytes,
        "read_numbers": read_numbers,
        "sleep_ms": sleep_ms,
    }
