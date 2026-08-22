const c = @cImport(@cInclude("stdio.h"));

export fn vkf_benchmark() callconv(.c) f64 {
    const n: usize = 8;
    var permutation = [_]i32{0} ** 12;
    var working = [_]i32{0} ** 12;
    var rotations = [_]i32{0} ** 12;
    for (0..n) |index| permutation[index] = @intCast(index);
    var r = n;
    var permutation_index: i32 = 0;
    var checksum: i32 = 0;
    var maximum_flips: i32 = 0;
    while (true) {
        while (r > 1) { rotations[r - 1] = @intCast(r); r -= 1; }
        @memcpy(working[0..n], permutation[0..n]);
        var flips: i32 = 0;
        while (working[0] != 0) {
            var left: usize = 0;
            var right: usize = @intCast(working[0]);
            while (left < right) {
                const temporary = working[left];
                working[left] = working[right];
                working[right] = temporary;
                left += 1;
                right -= 1;
            }
            flips += 1;
        }
        maximum_flips = @max(maximum_flips, flips);
        checksum += if ((permutation_index & 1) == 0) flips else -flips;
        while (true) {
            if (r == n) return @floatFromInt(checksum * 100 + maximum_flips);
            const first = permutation[0];
            for (0..r) |index| permutation[index] = permutation[index + 1];
            permutation[r] = first;
            rotations[r] -= 1;
            if (rotations[r] > 0) break;
            r += 1;
        }
        permutation_index += 1;
    }
}

pub fn main() void {
    _ = c.printf("%.17g\n", vkf_benchmark());
}
