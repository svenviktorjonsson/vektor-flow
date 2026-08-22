const c = @cImport(@cInclude("stdio.h"));

export fn vkf_benchmark() callconv(.c) f64 { return 0.0; }

pub fn main() void {
    _ = c.printf("0\n");
}
