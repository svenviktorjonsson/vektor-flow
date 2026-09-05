# Browser output boundary — accepted

Decision: **A — all VKF values stay inside WASM**.
Accepted by Viktor on 2026-09-05; relayed by the Integration Steward.

JavaScript receives compiler-formatted UTF-8 console output and versioned
graphics/UI packets. It must not receive, decode or interpret arbitrary VKF
scalars, vectors, tuples or records. VKF owns indexing, updates, equality,
lifting, evaluation and display formatting. No VKF syntax or semantics change.

```vkf
pair() -> (num,num): (3,4)
:: pair()
```

The tuple remains a VKF value. The webpage receives its compiler-formatted
console output, not a JavaScript tuple, array, object or value handle. Graphics
consumers receive only compiler-owned versioned presentation packets.

Counterexample: `(3,4)` must never be exported as the vector `[3,4]` or a
JavaScript object, including when nested in records. A browser adapter cannot
implement missing tuple support by decoding or relabeling data in JavaScript.

## Delivery

First remove arbitrary `values` from the unpublished shared browser adapter's
execution result while continuing to invoke the emitted WASM program. Preserve
exact native stdout, failure behavior and regression predicates. Do not connect
the published runner until its independent parity and UI packet gates pass.

Representation inside WASM remains a compiler implementation concern; this
decision does not itself implement tuples, invent a UI packet schema or approve
new language behavior. Opaque byte movement between WASM memories is transport,
not host interpretation or an exposed language-value API.

## Superseded proposal

The earlier draft offered directly inspectable tuples versus opaque JavaScript
handles and labeled the inspectable option A. That draft was **not approved**.
Viktor's accepted A is the output-only boundary stated above, not that earlier
option label. Neither arbitrary decoded values nor arbitrary value handles are
part of the accepted webpage boundary.
