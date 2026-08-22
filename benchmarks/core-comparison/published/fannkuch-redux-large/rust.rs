#[no_mangle]
pub extern "C" fn vkf_benchmark() -> f64 {
    const N: usize = 9;
    let mut permutation = [0_i32; 12];
    let mut working = [0_i32; 12];
    let mut rotations = [0_i32; 12];
    for index in 0..N { permutation[index] = index as i32; }
    let mut r = N;
    let mut permutation_index = 0_i32;
    let mut checksum = 0_i32;
    let mut maximum_flips = 0_i32;
    loop {
        while r > 1 { rotations[r - 1] = r as i32; r -= 1; }
        working[..N].copy_from_slice(&permutation[..N]);
        let mut flips = 0_i32;
        while working[0] != 0 {
            let mut left = 0_usize;
            let mut right = working[0] as usize;
            while left < right {
                working.swap(left, right);
                left += 1;
                right -= 1;
            }
            flips += 1;
        }
        maximum_flips = maximum_flips.max(flips);
        checksum += if permutation_index & 1 == 0 { flips } else { -flips };
        loop {
            if r == N {
                return (checksum * 100 + maximum_flips) as f64;
            }
            let first = permutation[0];
            for index in 0..r { permutation[index] = permutation[index + 1]; }
            permutation[r] = first;
            rotations[r] -= 1;
            if rotations[r] > 0 { break; }
            r += 1;
        }
        permutation_index += 1;
    }
}

fn main() {
    println!("{:.17}", vkf_benchmark());
}
