const c = @cImport(@cInclude("stdio.h"));

const Vector4 = struct { x0: f64, x1: f64, x2: f64, x3: f64 };

fn advance(v: Vector4) Vector4 {
    return .{
        .x0 = v.x0 * 1.0000001 + v.x1 * 0.000001,
        .x1 = v.x1 * 0.9999999 - v.x2 * 0.000001,
        .x2 = v.x2 * 1.0000002 + v.x3 * 0.000001,
        .x3 = v.x3 * 0.9999998 - v.x0 * 0.000001,
    };
}

fn run(n: f64) f64 {
    var i: f64 = 0.0;
    var v = Vector4{ .x0 = 1.0, .x1 = 2.0, .x2 = 3.0, .x3 = 4.0 };
    while (i < n) {
        v = advance(v);
        i += 1.0;
    }
    return v.x0 + v.x1 + v.x2 + v.x3;
}

pub fn main() void {
    var count: f64 = {{COUNT}}.0;
    const runtime_count: *volatile f64 = &count;
    _ = c.printf("%.17g\n", run(runtime_count.*));
}
