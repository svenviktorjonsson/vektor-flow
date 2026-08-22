n = 7
permutation = collect(0:n-1)
working = zeros(Int, n)
rotations = zeros(Int, n)
r = n
permutation_index = 0
checksum = 0
maximum_flips = 0
while true
    while r > 1
        rotations[r] = r
        r -= 1
    end
    copyto!(working, permutation)
    flips = 0
    while working[1] != 0
        reverse!(working, 1, working[1] + 1)
        flips += 1
    end
    maximum_flips = max(maximum_flips, flips)
    checksum += iseven(permutation_index) ? flips : -flips
    while true
        if r == n
            println(checksum * 100 + maximum_flips)
            exit()
        end
        first = permutation[1]
        for index in 1:r
            permutation[index] = permutation[index + 1]
        end
        permutation[r + 1] = first
        rotations[r + 1] -= 1
        rotations[r + 1] > 0 && break
        r += 1
    end
    permutation_index += 1
end
