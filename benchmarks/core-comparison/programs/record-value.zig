const c = @cImport(@cInclude("stdio.h"));

const State = struct { x: f64, y: f64, vx: f64, vy: f64 };

fn advance(state: State) State {
    return .{
        .x = state.x + state.vx,
        .y = state.y + state.vy,
        .vx = state.vx * 0.999999 + state.y * 0.000001,
        .vy = state.vy * 0.999998 - state.x * 0.000001,
    };
}

fn run(n: f64) f64 {
    var i: f64 = 0.0;
    var state = State{ .x = 1.0, .y = 2.0, .vx = 0.01, .vy = 0.02 };
    while (i < n) {
        state = advance(state);
        i += 1.0;
    }
    return state.x + state.y + state.vx + state.vy;
}

pub fn main() void {
    var count: f64 = {{COUNT}}.0;
    const runtime_count: *volatile f64 = &count;
    _ = c.printf("%.17g\n", run(runtime_count.*));
}
