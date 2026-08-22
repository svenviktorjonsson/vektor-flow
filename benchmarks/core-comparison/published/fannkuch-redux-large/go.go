package main

import "fmt"

func main() {
	const n = 9
	permutation := [12]int{}
	working := [12]int{}
	rotations := [12]int{}
	for index := 0; index < n; index++ { permutation[index] = index }
	r, permutationIndex, checksum, maximumFlips := n, 0, 0, 0
	for {
		for r > 1 { rotations[r-1] = r; r-- }
		copy(working[:n], permutation[:n])
		flips := 0
		for working[0] != 0 {
			for left, right := 0, working[0]; left < right; left, right = left+1, right-1 {
				working[left], working[right] = working[right], working[left]
			}
			flips++
		}
		if flips > maximumFlips { maximumFlips = flips }
		if permutationIndex&1 == 0 { checksum += flips } else { checksum -= flips }
		for {
			if r == n { fmt.Println(checksum*100 + maximumFlips); return }
			first := permutation[0]
			copy(permutation[:r], permutation[1:r+1])
			permutation[r] = first
			rotations[r]--
			if rotations[r] > 0 { break }
			r++
		}
		permutationIndex++
	}
}
