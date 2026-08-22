const c = @cImport(@cInclude("stdio.h"));

fn advance(x: f64, i: f64) f64 {
    const y = x * 1.00000011920929 + i * 0.0000001;
    return if (y > 1000.0) y - 999.5 else y;
}

fn run(n: f64) f64 {
    var i: f64 = 0.0;
    var x: f64 = 1.0;
    while (i < n) {
        x = advance(x, i);
        i += 1.0;
    }
    return x;
}

pub fn main() void {
    var count: f64 = 20000.0;
    const runtime_count: *volatile f64 = &count;
    _ = c.printf("%.17g\n", run(runtime_count.*));
}
