"""Tests for VFunction.__call__ — calling vkf functions/lambdas from Python.

Covers:
  - Named functions called from Python via __call__
  - Lambdas ($(param): expr) stored in a variable and called from Python
  - Lambdas passed to a Python function as a callback, then invoked
  - Multi-param functions called from Python
  - Functions that reference closure variables
  - VFunction with ip=None raises TypeError
  - Return values pass through correctly (int, float, str, list)
  - Callbacks registered on UIMouse via VFunction (integration)
"""

from __future__ import annotations

import tempfile
import os
from pathlib import Path
from typing import Any

import pytest

from vektorflow.interpreter import VFunction, Interpreter
from vektorflow.parser import parse_module
from vektorflow.stdlib.events import UIMouse


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _run(src: str) -> Interpreter:
    """Parse + execute vkf source, return the Interpreter so tests can
    inspect globals."""
    with tempfile.NamedTemporaryFile(suffix=".vkf", mode="w",
                                     delete=False, encoding="utf-8") as f:
        f.write(src)
        fname = f.name
    try:
        p = Path(fname)
        mod = parse_module(p.read_text(encoding="utf-8"), filename=fname)
        ip = Interpreter(p)
        ip.run_module(mod)
        return ip
    finally:
        os.unlink(fname)


def _vfunc(ip: Interpreter, name: str) -> VFunction:
    fn = ip.globals[name]
    assert isinstance(fn, VFunction), f"Expected VFunction, got {type(fn).__name__}"
    return fn


# ---------------------------------------------------------------------------
# Named function __call__
# ---------------------------------------------------------------------------

class TestNamedFunctionCall:
    def test_identity(self) -> None:
        ip = _run("identity(x):\n  @: x\n")
        assert _vfunc(ip, "identity")(42) == pytest.approx(42)

    def test_arithmetic(self) -> None:
        ip = _run("double(x):\n  @: x * 2\n")
        assert _vfunc(ip, "double")(5) == pytest.approx(10)

    def test_string_return(self) -> None:
        ip = _run('greet(name):\n  @: "hello " + name\n')
        result = _vfunc(ip, "greet")("world")
        assert result == "hello world"

    def test_multi_param(self) -> None:
        ip = _run("add(a, b):\n  @: a + b\n")
        assert _vfunc(ip, "add")(3, 4) == pytest.approx(7)

    def test_ip_is_set(self) -> None:
        ip = _run("f(x):\n  @: x\n")
        fn = _vfunc(ip, "f")
        assert fn.ip is ip

    def test_multiple_calls(self) -> None:
        ip = _run("square(x):\n  @: x * x\n")
        fn = _vfunc(ip, "square")
        results = [fn(i) for i in range(1, 6)]
        assert results == pytest.approx([1, 4, 9, 16, 25])

    def test_float_result(self) -> None:
        ip = _run("half(x):\n  @: x / 2\n")
        assert _vfunc(ip, "half")(9) == pytest.approx(4.5)


# ---------------------------------------------------------------------------
# Lambda __call__
# ---------------------------------------------------------------------------

class TestLambdaCall:
    def test_lambda_stored_and_called(self) -> None:
        ip = _run("fn: ($(x): x + 1)\n")
        fn = _vfunc(ip, "fn")
        assert fn(10) == pytest.approx(11)

    def test_lambda_ip_is_set(self) -> None:
        ip = _run("fn: ($(x): x)\n")
        assert _vfunc(ip, "fn").ip is ip

    def test_lambda_multi_arg(self) -> None:
        ip = _run("fn: ($(a, b): a * b)\n")
        assert _vfunc(ip, "fn")(3, 7) == pytest.approx(21)

    def test_lambda_string_op(self) -> None:
        ip = _run('fn: ($(s): s + "!")\n')
        assert _vfunc(ip, "fn")("hello") == "hello!"


# ---------------------------------------------------------------------------
# Closure capture
# ---------------------------------------------------------------------------

class TestClosureCapture:
    def test_closes_over_outer_binding(self) -> None:
        ip = _run("factor: 3\nscale(x):\n  @: x * factor\n")
        assert _vfunc(ip, "scale")(4) == pytest.approx(12)

    def test_lambda_closes_over_outer_binding(self) -> None:
        ip = _run("offset: 100\nfn: ($(x): x + offset)\n")
        assert _vfunc(ip, "fn")(5) == pytest.approx(105)


# ---------------------------------------------------------------------------
# VFunction without ip raises TypeError
# ---------------------------------------------------------------------------

class TestMissingIp:
    def test_raises_typeerror(self) -> None:
        from dataclasses import dataclass, field

        # Build a VFunction manually with ip=None
        fn = VFunction.__new__(VFunction)
        fn.name = "orphan"
        fn.params = []
        fn.body = None
        fn.closure = {}
        fn.func_type = None
        fn.field_sources = {}
        fn.ip = None

        with pytest.raises(TypeError, match="interpreter reference"):
            fn()


# ---------------------------------------------------------------------------
# Callback pattern: Python code receives a VFunction and invokes it
# ---------------------------------------------------------------------------

class TestCallbackPattern:
    def test_named_fn_as_callback(self) -> None:
        """Simulate: Python stores a named vkf function and calls it later."""
        callbacks: list[Any] = []

        ip = _run("handler(x):\n  @: x * 10\n")
        fn = _vfunc(ip, "handler")

        # Python code registers the callback
        callbacks.append(fn)

        # Later invocation
        results = [cb(i) for cb, i in zip(callbacks, [3])]
        assert results == pytest.approx([30])

    def test_lambda_as_callback(self) -> None:
        """Simulate: vkf passes a lambda to a Python function via injection."""
        captured: list[VFunction] = []

        ip = _run("fn: ($(x): x + 1)\n")
        # Python code "receives" the lambda
        captured.append(_vfunc(ip, "fn"))

        assert captured[0](99) == pytest.approx(100)

    def test_python_injected_fn_receives_vfunction(self) -> None:
        """Register a Python function, vkf calls it with a lambda — Python
        stores it and can later invoke it."""
        store: list[Any] = []

        with tempfile.NamedTemporaryFile(suffix=".vkf", mode="w",
                                         delete=False, encoding="utf-8") as f:
            f.write("register_cb(($(x): x * 3))\n")
            fname = f.name

        try:
            p = Path(fname)
            mod = parse_module(p.read_text(encoding="utf-8"), filename=fname)
            ip = Interpreter(p)

            def register_cb(fn: Any) -> None:
                store.append(fn)

            ip.globals["register_cb"] = register_cb
            ip.run_module(mod)
        finally:
            os.unlink(fname)

        assert len(store) == 1
        fn = store[0]
        assert isinstance(fn, VFunction)
        assert fn(4) == pytest.approx(12)


# ---------------------------------------------------------------------------
# Integration: VFunction registered on UIMouse.on_wheel / on_hover
# ---------------------------------------------------------------------------

class TestVFunctionWithUIMouse:
    def _push_mouse(self, mouse: UIMouse, event: str, **kw: Any) -> None:
        base = dict(type="vf_event", event=event, x=0.0, y=0.0,
                    frame_id="f1", object_id=0, simplex_id=0,
                    button=-1, step=0)
        base.update(kw)
        mouse._push(base)

    def test_vfunction_on_wheel(self) -> None:
        """A VFunction should be callable as a wheel handler."""
        ip = _run("handler(e):\n  @: e.step * 2\n")
        fn = _vfunc(ip, "handler")

        mouse = UIMouse()
        results: list[Any] = []

        # Wrap VFunction — UIMouse expects a Python callable (which VFunction now is)
        mouse.on_wheel(lambda e: results.append(fn(e)))

        self._push_mouse(mouse, "wheel", step=3)
        mouse.poll()

        assert len(results) == 1
        assert results[0] == pytest.approx(6)

    def test_vfunction_on_hover_object_id(self) -> None:
        """VFunction handler can read object_id from a MouseEvent."""
        ip = _run("get_id(e):\n  @: e.object_id\n")
        fn = _vfunc(ip, "get_id")

        mouse = UIMouse()
        ids: list[Any] = []

        mouse.on_hover(lambda e: ids.append(fn(e)))

        self._push_mouse(mouse, "hover", object_id=7)
        mouse.poll()

        assert ids == [7]

    def test_vfunction_registered_directly_on_wheel(self) -> None:
        """VFunction can be passed directly to on_wheel (no Python wrapper)."""
        ip = _run("zoom(e):\n  @: e.step * -0.3\n")
        fn = _vfunc(ip, "zoom")

        mouse = UIMouse()
        results: list[Any] = []

        # VFunction IS a callable — register it directly
        mouse.on_wheel(fn)
        # Intercept via a second listener
        mouse.on_wheel(lambda e: results.append(True))

        self._push_mouse(mouse, "wheel", step=2)
        mouse.poll()

        # Direct registration must not raise; second listener confirms poll ran
        assert results == [True]
