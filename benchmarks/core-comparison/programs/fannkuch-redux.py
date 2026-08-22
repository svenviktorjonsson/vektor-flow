N = {{COUNT}}
permutation = list(range(N))
working = [0] * N
rotations = [0] * N
r = N
permutation_index = 0
checksum = 0
maximum_flips = 0
while True:
    while r > 1:
        rotations[r - 1] = r
        r -= 1
    working[:] = permutation
    flips = 0
    while working[0] != 0:
        right = working[0]
        working[:right + 1] = working[right::-1]
        flips += 1
    maximum_flips = max(maximum_flips, flips)
    checksum += flips if permutation_index & 1 == 0 else -flips
    while True:
        if r == N:
            print(checksum * 100 + maximum_flips)
            raise SystemExit
        first = permutation[0]
        permutation[:r] = permutation[1:r + 1]
        permutation[r] = first
        rotations[r] -= 1
        if rotations[r] > 0:
            break
        r += 1
    permutation_index += 1
