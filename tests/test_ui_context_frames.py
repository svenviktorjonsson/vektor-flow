from __future__ import annotations

import contextlib
from io import StringIO
from pathlib import Path

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module


def _run(source: str) -> str:
    module = parse_module(source, filename="<ui-context-frame>")
    interpreter = Interpreter(Path(__file__))
    output = StringIO()
    with contextlib.redirect_stdout(output):
        interpreter.run_module(module)
    return output.getvalue().strip()


def test_vkf_scope_step_updates_its_persistent_state_every_frame() -> None:
    assert _run("""
:.ui

state:
    count:0
    last_t:-1
    @:

context:
    state:state
    step(state,t,dt,index):
        state.count:state.count+1
        state.last_t:t
    @:

loop:event_loop(fps:10,frames:3,realtime:false)
loop.run(context)
:: context.state.count
:: context.state.last_t
""") == "3\n0.2"


def test_frame_scopes_only_update_their_own_context_state() -> None:
    assert _run("""
:.ui

left_state:
    value:0
    @:
left:
    state:left_state
    step(state,t,dt,index):
        state.value:state.value+1
    @:

right_state:
    value:100
    @:
right:
    state:right_state
    step(state,t,dt,index):
        state.value:state.value+10
    @:

event_loop(frames:2,realtime:false).run(left)
event_loop(frames:3,realtime:false).run(right)
:: left.state.value
:: right.state.value
""") == "2\n130"


def test_frame_scope_step_executes_regular_vkf_code() -> None:
    assert _run("""
:.ui

state:
    value:0
    @:
context:
    state:state
    step(state,t,dt,index):
        increment(value): value+1
        index=0? state.value:7
        index>0? state.value:increment(state.value)
    @:

event_loop(frames:3,realtime:false).run(context)
:: context.state.value
""") == "9"


def test_frame_scope_receives_time_and_frame_delta() -> None:
    assert _run("""
:.ui

state:
    t:-1
    dt:-1
    @:
context:
    state:state
    step(state,t,dt,index):
        state.t:t
        state.dt:dt
    @:

event_loop(fps:20,frames:3,realtime:false).run(context)
:: context.state.t
:: context.state.dt
""") == "0.1\n0.05"


def test_frame_scope_can_read_ui_variables_from_the_ui_module() -> None:
    assert _run("""
:.ui

state:
    touch_count:-1
    @:
context:
    state:state
    step(state,t,dt,index):
        state.touch_count:touch.n
    @:

event_loop(frames:1,realtime:false).run(context)
:: context.state.touch_count
""") == "0"


def test_frame_scope_mutates_in_place_and_ignores_early_exit_values() -> None:
    assert _run("""
:.ui

state:
    count:0
    @:
replacement:
    count:99
    @:
context:
    state:state
    step(state,t,dt,index):
        state.count:state.count+1
        @: replacement
    @:

event_loop(frames:2,realtime:false).run(context)
:: context.state.count
""") == "2"
