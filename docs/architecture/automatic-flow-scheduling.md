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
no-argument scalar calls and records `automatic-cpu-pair-selected` only when
that same safety plan admits it. A selected Windows native artifact with the
exact two-numeric-result shape runs one demand on a private operating-system
thread while the caller runs the other, joins before observation, and then
commits both results in source order. Thread creation failure falls back to the
same serial order. Other target and result shapes remain selection-only and
serial. This is execution evidence, not a wall-clock performance claim.

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
