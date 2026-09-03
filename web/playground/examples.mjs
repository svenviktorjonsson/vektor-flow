const GROUPS = [
  { kind: "plot", label: "2D · static graphs", examples: [
    ["curve-static", "Sine curve", "sin(x)"],
    ["curve-cosine", "Cosine curve", "cos(x)"],
    ["curve-sum", "Sine + cosine", "sin(x)+cos(x)"],
    ["curve-product", "Interference", "sin(x)*cos(x)"],
    ["curve-line", "Linear", "x/4"],
    ["curve-parabola", "Parabola", "x*x/8"],
    ["curve-double", "Double frequency", "sin(x*2)/2"],
    ["curve-wide", "Wide cosine", "cos(x/2)"],
    ["curve-harmonics", "Harmonics", "sin(x)+sin(x*2)/2"],
    ["curve-energy", "Cosine energy", "cos(x)*cos(x)"],
  ] },
  { kind: "plot-time", label: "2D · animations", examples: [
    ["curve-time", "Travelling sine", "sin(x-t)"],
    ["curve-time-cosine", "Travelling cosine", "cos(x+t)"],
    ["curve-time-pulse", "Pulsing sine", "sin(x)*cos(t)"],
    ["curve-time-standing", "Standing wave", "cos(x)*sin(t)"],
    ["curve-time-crossing", "Crossing waves", "sin(x+t)+cos(x-t)/2"],
    ["curve-time-double", "Fast ripple", "sin(x*2-t)/2"],
    ["curve-time-wide", "Wide drift", "cos(x/2+t)"],
    ["curve-time-envelope", "Moving envelope", "sin(x-t)*cos(t)"],
    ["curve-time-harmonics", "Animated harmonics", "sin(x+t)+sin(x*2-t)/2"],
    ["curve-time-energy", "Oscillating energy", "cos(x-t)*cos(t)"],
  ] },
  { kind: "surface", label: "3D · static models", examples: [
    ["surface-static", "Wave surface", "sin(x)*cos(y)"],
    ["surface-ridges", "Crossed ridges", "sin(x)+cos(y)"],
    ["surface-saddle", "Saddle", "x*y/4"],
    ["surface-hyperbolic", "Hyperbolic sheet", "(x*x-y*y)/8"],
    ["surface-ripple", "Multiplicative ripple", "sin(x*y)"],
    ["surface-dome", "Cosine dome", "cos(x)*cos(y)"],
    ["surface-woven", "Woven field", "sin(x*2)*cos(y/2)"],
    ["surface-ramp", "Diagonal ramp", "(x+y)/4"],
    ["surface-rings", "Concentric rings", "sin(x*x+y*y)"],
    ["surface-diagonal", "Diagonal wave", "cos(x+y)"],
  ] },
  { kind: "surface-time", label: "3D · animated models", examples: [
    ["surface-time", "Breathing surface", "sin(x-t)*cos(y)"],
    ["surface-time-ridges", "Moving ridges", "sin(x)+cos(y-t)"],
    ["surface-time-saddle", "Breathing saddle", "x*y*cos(t)/4"],
    ["surface-time-sheet", "Oscillating sheet", "(x*x-y*y)*sin(t)/8"],
    ["surface-time-ripple", "Travelling ripple", "sin(x*y-t)"],
    ["surface-time-dome", "Orbiting dome", "cos(x-t)*cos(y+t)"],
    ["surface-time-woven", "Animated weave", "sin(x*2-t)*cos(y/2)"],
    ["surface-time-ramp", "Rotating ramp", "(x*cos(t)+y*sin(t))/4"],
    ["surface-time-rings", "Expanding rings", "sin(x*x+y*y-t)"],
    ["surface-time-diagonal", "Diagonal drift", "cos(x+y-t)"],
  ] },
];

export const LIVE_EXAMPLE_GROUPS = Object.freeze(GROUPS.map((group) => Object.freeze({
  kind: group.kind,
  label: group.label,
  examples: Object.freeze(group.examples.map(([id, title, source]) => Object.freeze({
    id, title, source, kind: group.kind,
  }))),
})));

export const LIVE_EXAMPLES = Object.freeze(LIVE_EXAMPLE_GROUPS.flatMap(({ examples }) => examples));
export const LIVE_EXAMPLES_BY_ID = Object.freeze(
  Object.fromEntries(LIVE_EXAMPLES.map((example) => [example.id, example])),
);
