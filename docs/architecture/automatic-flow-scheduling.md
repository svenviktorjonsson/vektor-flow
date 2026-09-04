# Automatic flow scheduling

VKF programs describe one ordinary lazy value flow. Authors do not create
workers, pools, futures, joins, core counts, device objects, or chunk sizes for
ordinary computation. The compiler and runtime may privately simplify a flow
symbolically, fuse it, use SIMD, partition it across threads, submit it to a
GPU, or isolate computation in another process. Those choices never change the
program's serial meaning.

The first native safety tracer is deliberately conservative. Pure,
deterministic, non-fallible functions without owned runtime resources may enter
private replay and partition analysis. Dependency analysis must still prove
that demanded regions are independent. Effectful functions keep source effect
order. Fallible functions keep demand/error order. Numeric reductions require
a fixed logical merge tree before parallel scheduling so worker or device count
cannot change their result.

Demand-backed vectors remain descriptors until an observation requires values.
Scheduling one index, tile, preview, viewport, or reduction region does not
authorize full-vector materialization. Small values may be retained or eagerly
computed only when that preserves the same demand and error observations and
fits the active memory budget.

Random vector elements are functions of the seed and logical index. Scheduling
order, cache state, backend selection, retries, and parallel width therefore do
not alter them. Device failure may retry immutable pure work on another backend
before effects commit. Ordered effects are never replayed.

UI-visible demands receive bounded queues and latency priority; producers meet
consumer capacity through backpressure rather than unbounded buffering. This
is an internal scheduling policy, not a second public stream abstraction.

`::` printing is an ordered effect and merge point. Independent proven-pure
prefixes may execute in parallel, but their `WriteString` commits serialize in
source/logical order and output never interleaves nondeterministically. A
future region-level scheduler may partition a proven-pure prefix inside an
otherwise effectful function; the initial conservative function safety tracer
keeps the complete function ordered until that proof exists.

`.process.run` and `.process.shell` remain explicit external-command
boundaries. Their shared native `ProcessRun` operation is effect ordered,
non-replayable, and never treated as an ordinary automatic-flow partition.

The first native CPU execution seam accepts exactly two privately planned
demands. Both Machine IR functions must be replay-safe partition candidates,
the demand planner must prove them independent, each branch must exceed the
conservative work threshold, and the effective CPU limit must be at least two.
One branch runs on a private CPU task while the caller runs the other; results
return in source order so commits remain deterministic. A one-core limit,
dependencies, effects, fallibility, owned resources, reductions without a
stable merge tree, or small work all retain serial execution. The native
artifact compiler now identifies the exact source-derived pair of retained
scalar calls. Each root is either argument-free or receives exactly one
immediate numeric literal through a fully described read-only scalar parameter
slot. It records `automatic-cpu-pair-selected` only when that same safety plan
admits the roots and a retained bit-exact paired benchmark proves the threaded
candidate faster than the serial baseline. A selected Windows
native artifact with the exact two-numeric-result shape runs one demand on a
private operating-system thread while the caller runs the other, joins before
observation, and then commits both results in source order. Thread creation or
join failure aborts the artifact; a selected threaded policy never silently
falls back to serial execution. An unchanged function/dependency graph may
reuse the retained proof only under the same host and toolchain fingerprints.
At the entry/root boundary and inside either otherwise-proven root closure, a
parameterized call is admitted only when each argument is an immediate numeric
literal passed by value into a fully described, read-only scalar parameter
slot. Computed or forwarded argument provenance, defaults, parameter writes,
ownership transfer, address/aggregate parameters, or incomplete borrow
metadata keep the pair serial with an explicit private reason. Multiple root
parameters and other target or result shapes remain serial. This host-specific
proof is not a general wall-clock performance claim.

The same exact pair shape may contain one statically bounded, terminal
`AssertTruthy` in either otherwise-pure root. The dependency receipt must prove
the complete fallible closure, source-ordered error selection, and mandatory
join/cleanup before the pair is eligible. Serial and threaded candidates compare
the exact error message bytes, length bits, and error mask as well as the ordered
numeric results; any partial result rejects the candidate. A threaded artifact
records each lane's result or error privately, waits for the worker, closes its
handle, and only then propagates the left/source-first error when both lanes fail.
It never publishes partial results or retries serially. Cooperative cancellation
is admitted only when both roots have an explicit fixed-bound, initialized,
unit-increment loop backedge recorded by the dependency receipt. A source-left
terminal error publishes the shared request; the right lane observes it only at
its proven backedge, records that observation, returns without output, and is
always joined and closed. A right-lane error never cancels the source-left lane,
so later left errors still win exact source-order arbitration. Forced thread
termination is never used. Missing or unsafe polling proof keeps the pair serial
with `cancellation-polling-unknown`. Handled, dynamic, nested, resource-owning,
or incompletely described fallibility remains serial.

A pair root may also contain fixed-arity `SumF64Values` only when its private
receipt records every reduction as `sum-f64-values:left-fold:<arity>` in exact
function/instruction order. The Windows x64 serial and threaded candidates call
the same root body, whose scalar additions remain the original stack-order IEEE
left fold; parallelism is between roots and never partitions or reassociates a
reduction. Candidate outputs must be bit-exact, and a reduction-tree or operand
change invalidates retained proof. List/local reductions, mean/variance and
other associative-looking operations, malformed or unknown arity, and any plan
that cannot preserve source-order IEEE evaluation remain serial with the private
reason `reduction-order-unknown`. A proof miss still benchmarks only the serial
baseline and one guided threaded candidate and applies threading only on a
measured win.

The only approved public scheduling settings are process-wide ceilings:

~~~vkf
process.max_cores: 6
process.enable_gpu: true
~~~

Both may be omitted for automatic selection. `max_cores` caps CPU use and never
forces that many lanes. `enable_gpu` is a `bit`: `true` permits a beneficial,
supported GPU plan and `false` forbids GPU use. Permission never requires GPU
execution. A GPU plan must safely fall back to CPU before effects commit. The
default numerical contract follows one deterministic logical flow and fixed
reduction policy, with declared floating tolerance where the operation's
contract permits it. These settings do not expose workers, pools, futures,
joins, chunk controls, or a target-specific object. The native compiler binds
these settings into its private automatic-flow limits and reports the effective
CPU ceiling in diagnostic artifact metadata. Target scheduling remains
follow-up work.
