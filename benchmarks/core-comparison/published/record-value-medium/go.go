package main

import (
	"fmt"
	"os"
)

type State struct{ x, y, vx, vy float64 }

func advance(state State) State {
	return State{
		state.x + state.vx,
		state.y + state.vy,
		state.vx*0.999999 + state.y*0.000001,
		state.vy*0.999998 - state.x*0.000001,
	}
}

func run(n float64) float64 {
	i := 0.0
	state := State{1.0, 2.0, 0.01, 0.02}
	for i < n {
		state = advance(state)
		i += 1.0
	}
	return state.x + state.y + state.vx + state.vy
}

func main() {
	count := float64(75000 + len(os.Args) - 1)
	fmt.Printf("%.17g\n", run(count))
}
