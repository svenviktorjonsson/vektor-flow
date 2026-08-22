package main

import (
	"fmt"
	"os"
)

type Vector4 struct{ x0, x1, x2, x3 float64 }

func advance(v Vector4) Vector4 {
	return Vector4{
		v.x0*1.0000001 + v.x1*0.000001,
		v.x1*0.9999999 - v.x2*0.000001,
		v.x2*1.0000002 + v.x3*0.000001,
		v.x3*0.9999998 - v.x0*0.000001,
	}
}

func run(n float64) float64 {
	i := 0.0
	v := Vector4{1.0, 2.0, 3.0, 4.0}
	for i < n {
		v = advance(v)
		i += 1.0
	}
	return v.x0 + v.x1 + v.x2 + v.x3
}

func main() {
	count := float64({{COUNT}} + len(os.Args) - 1)
	fmt.Printf("%.17g\n", run(count))
}
