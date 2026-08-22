package main

import (
	"fmt"
	"math"
)

const n = 500

func matrixValue(row, column int) float64 {
	diagonal := row + column
	return 1.0 / float64(diagonal*(diagonal+1)/2+row+1)
}

func multiplyAv(input, output []float64) {
	for row := 0; row < n; row++ {
		total := 0.0
		for column := 0; column < n; column++ {
			total += matrixValue(row, column) * input[column]
		}
		output[row] = total
	}
}

func multiplyAtv(input, output []float64) {
	for row := 0; row < n; row++ {
		total := 0.0
		for column := 0; column < n; column++ {
			total += matrixValue(column, row) * input[column]
		}
		output[row] = total
	}
}

func multiplyAtAv(input, output, temporary []float64) {
	multiplyAv(input, temporary)
	multiplyAtv(temporary, output)
}

func main() {
	u := make([]float64, n)
	v := make([]float64, n)
	temporary := make([]float64, n)
	for index := range u { u[index] = 1.0 }
	for iteration := 0; iteration < 10; iteration++ {
		multiplyAtAv(u, v, temporary)
		multiplyAtAv(v, u, temporary)
	}
	numerator, denominator := 0.0, 0.0
	for index := 0; index < n; index++ {
		numerator += u[index] * v[index]
		denominator += v[index] * v[index]
	}
	fmt.Printf("%.17g\n", math.Sqrt(numerator/denominator))
}
