const c = @cImport(@cInclude("stdio.h"));

const n = 100;

fn matrixValue(row: usize, column: usize) f64 {
    const diagonal = row + column;
    return 1.0 / @as(f64, @floatFromInt(diagonal * (diagonal + 1) / 2 + row + 1));
}

fn multiplyAv(input: *const [n]f64, output: *[n]f64) void {
    for (0..n) |row| {
        var total: f64 = 0.0;
        for (0..n) |column| total += matrixValue(row, column) * input[column];
        output[row] = total;
    }
}

fn multiplyAtv(input: *const [n]f64, output: *[n]f64) void {
    for (0..n) |row| {
        var total: f64 = 0.0;
        for (0..n) |column| total += matrixValue(column, row) * input[column];
        output[row] = total;
    }
}

fn multiplyAtAv(input: *const [n]f64, output: *[n]f64) void {
    var temporary = [_]f64{0.0} ** n;
    multiplyAv(input, &temporary);
    multiplyAtv(&temporary, output);
}

export fn vkf_benchmark() callconv(.c) f64 {
    var u = [_]f64{1.0} ** n;
    var v = [_]f64{0.0} ** n;
    for (0..10) |_| {
        multiplyAtAv(&u, &v);
        multiplyAtAv(&v, &u);
    }
    var numerator: f64 = 0.0;
    var denominator: f64 = 0.0;
    for (0..n) |index| {
        numerator += u[index] * v[index];
        denominator += v[index] * v[index];
    }
    return @sqrt(numerator / denominator);
}

pub fn main() void {
    _ = c.printf("%.17g\n", vkf_benchmark());
}
