package main

import (
	"fmt"
	"os"
)

func advance(x, i float64) float64 {
	y := x*1.00000011920929 + i*0.0000001
	if y > 1000.0 {
		return y - 999.5
	}
	return y
}

func run(n float64) float64 {
	i := 0.0
	x := 1.0
	for i < n {
		x = advance(x, i)
		i += 1.0
	}
	return x
}

func main() {
	count := float64({{COUNT}} + len(os.Args) - 1)
	fmt.Printf("%.17g\n", run(count))
}
