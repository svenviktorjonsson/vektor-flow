"""Built-in ``io`` library: read/write text and bytes, and load numeric tables."""

from __future__ import annotations

import time
from collections import namedtuple
from pathlib import Path
from typing import Any

import numpy as np


def _as_path(path: str) -> Path:
    if not isinstance(path, str):
        raise TypeError("path must be a string")
    return Path(path)


def write_bytes(path: str, data: bytes) -> None:
    """Write raw bytes to ``path`` (overwrites)."""
    if not isinstance(data, (bytes, bytearray)):
        raise TypeError("write_bytes expects bytes")
    _as_path(path).write_bytes(bytes(data))


def read_bytes(path: str) -> bytes:
    """Read the entire file as bytes."""
    return _as_path(path).read_bytes()


def write_text(path: str, text: str, encoding: str = "utf-8") -> None:
    """Write ``text`` to ``path`` (overwrites)."""
    _as_path(path).write_text(str(text), encoding=encoding)


def read_text(path: str, encoding: str = "utf-8") -> str:
    """Read the entire file as a decoded string."""
    return _as_path(path).read_text(encoding=encoding)


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
) -> np.ndarray:
    """2-D float matrix ``(n_rows, n_cols)`` — row vectors are ``array[i, :]``.

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
    if not matrix:
        return np.zeros((0, 0), dtype=np.float64)
    return np.asarray(matrix, dtype=np.float64)


def _dict_from_header_lines(
    lines: list[str],
    delimiter: str | None,
    names: list[str],
) -> Any:
    """Named tuple of column vectors (each column is ``numpy.ndarray`` 1-D)."""
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
    col_arrays = tuple(np.asarray(columns[j], dtype=np.float64) for j in range(n_cols))
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
      **1-D** :class:`numpy.ndarray` ``dtype=float64`` (column vector). Data rows
      that are not fully numeric or whose width differs from the header are
      **skipped**.
    * **Without header** (``header is False``, or auto-detected numeric first row):
      returns a **2-D** :class:`numpy.ndarray` ``dtype=float64``, shape
      ``(n_rows, n_cols)`` (rows × columns). Row ``i`` is ``array[i, :]``. The
      **first** row where every cell is numeric sets the column count; leading
      non-numeric lines are skipped; later rows that do not match width or are not
      all-numeric are skipped.
    * ``header is None`` (default): auto-detect — if the first row looks like a
      header (no cell parses as a float), use header mode; otherwise matrix mode.

    Empty files: ``{}`` when ``header is True`` and there are no lines; a **0×0**
    float array when no matrix rows are found.
    """
    text = read_text(path)
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if not lines:
        if header is True:
            return {}
        return np.zeros((0, 0), dtype=np.float64)

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
    time.sleep(float(ms) * 0.001)


def build_io_namespace() -> dict[str, Any]:
    return {
        "read_text": read_text,
        "write_text": write_text,
        "read_bytes": read_bytes,
        "write_bytes": write_bytes,
        "read_numbers": read_numbers,
        "sleep_ms": sleep_ms,
    }
