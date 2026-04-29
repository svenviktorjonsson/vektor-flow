"""Evaluate ``$`` interpolation inside double-quoted string literals."""

from __future__ import annotations

import re
from typing import Any, Callable

from .errors import EvalError


def interpolate_string(
    s: str,
    eval_expr: Callable[[str], Any],
    resolve_chain: Callable[[str], Any],
    stringify: Callable[[Any], str],
) -> str:
    """``eval_expr`` parses and evaluates a ``$(...)`` substring.

    ``resolve_chain`` resolves a dotted path (``a.b.c``) to a value.
    """
    out: list[str] = []
    i = 0
    n = len(s)
    while i < n:
        if s[i] == "\\" and i + 1 < n and s[i + 1] == "$":
            out.append("$")
            i += 2
            continue
        if s[i] != "$":
            out.append(s[i])
            i += 1
            continue
        # $(expr) or $(expr).fmt
        if i + 1 < n and s[i + 1] == "(":
            depth = 1
            j = i + 2
            start = j
            while j < n and depth:
                if s[j] == "(":
                    depth += 1
                elif s[j] == ")":
                    depth -= 1
                j += 1
            if depth != 0:
                raise EvalError("unclosed $(...) in string")
            inner = s[start : j - 1]
            k = j
            fmt = ""
            if k < n and s[k] == ".":
                k += 1
                fm = re.match(r"(\d*[a-zA-Z]+)", s[k:])
                if not fm:
                    raise EvalError("expected format after $(...).")
                fmt = fm.group(1)
                k += len(fmt)
            val = eval_expr(inner.strip())
            out.append(_format_value(val, fmt, stringify))
            i = k
            continue
        # $ident / $a.b / $a.b.2f — field segments start with a letter; .2f is format, not field "2f"
        j = i + 1
        if j >= n or not (s[j].isalpha() or s[j] == "_"):
            raise EvalError("invalid $ in string")
        j += 1
        while j < n and (s[j].isalnum() or s[j] == "_"):
            j += 1
        parts: list[str] = [s[i + 1 : j]]
        fmt = ""
        while j < n and s[j] == ".":
            rest = s[j + 1 :]
            m_field = re.match(r"^([a-zA-Z_][\w]*)", rest)
            m_fmt = re.match(r"^(\d*[a-zA-Z]+)", rest)
            if m_field:
                parts.append(m_field.group(1))
                j += 1 + m_field.end()
                continue
            if m_fmt:
                fmt = m_fmt.group(1)
                j += 1 + m_fmt.end()
                break
            raise EvalError(f"invalid segment after '.' in string interpolation")
        path = ".".join(parts)
        val = resolve_chain(path)
        out.append(_format_value(val, fmt, stringify))
        i = j
    return "".join(out)


def _format_value(val: Any, fmt: str, stringify: Callable[[Any], str]) -> str:
    if not fmt:
        if isinstance(val, float) and val == int(val):
            return str(int(val))
        return stringify(val)
    fs = fmt
    if fs[0].isdigit():
        fs = "." + fs
    try:
        return format(val, fs)
    except (ValueError, TypeError) as e:
        raise EvalError(f"bad format {fmt!r} for value: {e}") from e
