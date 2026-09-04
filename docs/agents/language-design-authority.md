# Language Design Authority workflow

The language designer is the final authority for every public VKF language and
API decision. Autonomous agents accelerate evidence and implementation; they do
not vote a language into existence.

## Decisions reserved for the language designer

Explicit approval is required before freezing or merging any change to:

- source syntax, parsing precedence, desugaring, or canonical source style;
- the type system, inference, lifting, ownership, effects, errors, or
  evaluation semantics;
- public stdlib, compiler, UI, package, server/session, or host-capability APIs;
- observable diagnostics or source-span rules;
- serialized public schemas, package format, lockfile, runtime/event/UI ABI, or
  compatibility policy; and
- removal, renaming, or semantic reinterpretation of an existing public form.

Agents may add tests for already approved behavior, refactor behind a frozen
contract, implement target consumers, improve tooling, measure performance, and
prepare design alternatives without a new decision.

## Language decision packet

When implementation reaches a public design choice, the Integration Steward
opens a GitHub Issue labeled `ready-for-human` and sends the language designer a
short, plain-language packet containing exactly one question:

~~~text
Decision ID and one plain user-story question
One tiny happy-path VKF example
Two or three user-observable choices, with the recommendation first
One counterexample when it exposes an important boundary
What the user would notice now and under future compatibility
An exact short reply such as "choose A"
~~~

The packet must be small enough to decide directly and must never contain more
than one question. If several independent choices exist, ask the first blocking
question and queue the others separately.

Questions must describe a concrete user story in ordinary language. Do not ask
the language designer to choose schemas, ABI layouts, lowering strategies,
target adapters, memory representations, build mechanics, or performance
techniques. Agents choose the most performant correct technical design
autonomously whenever those details do not change what a VKF author or end user
observes. If a technical constraint really changes public behavior, translate
it into the smallest observable user choice instead of presenting the internal
mechanism.

Ask as soon as a genuine public choice is discovered. Do not silently freeze
the behavior and do not save several decisions for a later batch. Safe work
that does not depend on the answer continues in parallel. An agent must not
disguise a preferred public design as the only option.

The language designer can reply compactly, for example:

~~~text
LD-004: choose B. Keep explicit capture. Rename InputRegion to InputSurface.
Diagnostic wording approved as shown.
~~~

The steward records the exact decision and examples in the issue, updates
`CONTEXT.md` and an ADR when architectural, freezes a contract hash, removes
`ready-for-human`, and releases dependent packets.

Silence is not approval. While a decision waits, agents work only on independent
paths or paths that consume already frozen contracts.

## Raw user-story stream

The language designer may send incomplete, contradictory, conversational use
cases without following a template. The Integration Steward owns all
translation work. For each useful fragment, the steward:

1. preserves the designer's original intent;
2. assigns a stable user-story ID and groups it with related stories;
3. extracts actors, desired observations, invariants, defaults, failure
   behavior, and unresolved terms;
4. updates the relevant release plan and acceptance matrix;
5. separates language/API decisions from implementation decisions;
6. creates TDD work packets for everything already approved; and
7. returns only the smallest genuine language choice to the designer.

The designer is not responsible for managing issues, agents, branches, build
systems, test architecture, lowering, platform adapters, or performance
evidence. An approximate example or "I want it to feel like..." statement is
valid input. Agents must not reinterpret ambiguity as permission to freeze an
API.

## Highest-leverage help from the language designer

The language designer helps most by streaming semantics and taste, not build
labor. The following details are useful when they arise, but are never a form
the designer must complete:

1. **Approve one canonical happy-path example.** A tiny real VKF program is a
   better interface contract than a list of method names.
2. **Give counterexamples.** State what visually plausible or convenient forms
   must be rejected and why.
3. **Name the concepts.** Confirm which term owns each idea and which similar
   terms must remain distinct.
4. **Choose defaults and escape hatches.** Decide the common case, what remains
   explicit, and which behavior must never happen silently.
5. **Classify observed failures.** For visual tests, identify whether a result
   violates language/UI semantics, host capability behavior, or only rendering
   tolerance.
6. **Protect compatibility intentionally.** Mark decisions experimental,
   provisional for 0.4, or stable enough to constrain 0.5/1.0.
7. **Settle one question at a time.** Short decisions unblock several parallel
   implementation packets without forcing the designer into their internal
   details.

## Current collaboration lanes

For 0.4, the language designer owns the public UI source/API and the semantic
meaning behind visual fixtures. Agents own lowering, native/WASM parity, host
adapters, generated contracts, packaging, and measurement after those API
decisions.

For 0.5, agents can inventory bridges, build differential harnesses, migrate
already-approved behavior, improve direct target coverage, and prepare
self-hosting stages autonomously. Any language pressure discovered while
writing the compiler returns as a language decision packet before syntax or API
is added.

The next design reviews are individual user stories from the smallest 0.4
draggable-visualization program. Each review asks about only one observable
behavior, including surface and frame ownership, dragging and pointer capture,
ordered event-loop handling through `??>`, or the live `.ui` boundary.
