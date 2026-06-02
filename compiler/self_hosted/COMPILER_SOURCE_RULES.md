# Compiler Source Rules

These rules are for any file under `compiler/self_hosted/`.

The self-hosted compiler source is the language teaching the language how to
compile itself. Because of that, syntax and programming style are part of the
compiler contract, not a cosmetic choice.

## Non-Negotiable Syntax Rules

- Use real VKF syntax only.
- Do not invent keyword forms such as `switch`, `match`, `case`, or
  keyword-shaped defaults.
- Multi-arm discrimination uses `??`.
- Explicit match arms use `=>`.
- The default arm in `??` is a plain direct body at arm scope.
- `_ =>` is not supported and must never appear in compiler source.

Canonical example:

```vkf
token.kind??
    "NUMBER" => lower_number(token)
    "STRING" => lower_string(token)
    fail("expected literal")
```

## Style Rules For Compiler Code

- Write compiler source in the clearest final language form, not in a temporary
  bootstrap-looking form.
- If logic is "one discriminant, many cases", prefer `??` over chained
  single-branch guards.
- If a source rewrite is done for canonical language shape, that is correct
  even before it becomes a runtime speed win.
- Optimize lowering around canonical source shape instead of distorting source
  to fit a temporary bootstrap implementation.

## Edit Protocol

Before editing compiler files:

1. Verify the syntax in `vektorflow/parser.py`.
2. Verify user-facing examples in `tests/test_control_flow.py` or other
   language tests.
3. Only then patch `compiler/self_hosted/*.vkf`.

Never let an agent edit compiler source based on guessed syntax or style.
