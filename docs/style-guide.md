# VKF Style Guide

This guide covers canonical VKF forms and repository documentation style.
General software-design advice does not belong here.

## Documentation

Wrap Markdown prose at 80 columns. Leave code fences, tables, badges, HTML,
link targets, and generated markers intact when wrapping would damage their
syntax or generated form.

## Functions And Returns

Keep a single-expression function on one row and use its implicit result:

```vkf
square(value:num) -> num: value^2
```

Keep a function or nominal constructor whose complete body is a bare null or
local-scope return on one row too:

```vkf
empty(): @
Point(x:num, y:num): :
```

Use explicit `@:` to make the result of a multi-row function visible:

```vkf
shift(value:num) -> num:
    squared: value^2
    @: squared + 1
```

## Pipe Layout

Keep a single-expression pipeline inline:

```vkf
ret: (..3 >> $^2)
```

Semicolons are suitable for a short multi-row stage. Each semicolon begins a
new row at the stage's current logical indentation; following spaces are
ignored:

```vkf static
ret: (array >> doubled: $ * 2; doubled + 1)
```

A parenthesized multiline pipeline is valid, but direct block evaluation is the
canonical form. Align each following `>>` with the first stage:

```vkf static
ret:
    array >>
        doubled: $ * 2
        doubled + 1
    >>
        $^2
```

The final pipeline value becomes `ret` automatically.

## Scope Names

After spilling a record into local scope, consistently use its exposed names:

```vkf
measure(system:System) -> num:
    :system
    @: |positions.0| * masses.0
```

Do not mix `positions` with redundant forms such as `system.positions` in the
same spilled scope.

Spill a standard-library module when using its members throughout an example.
Keep the resulting expressions focused on the operation:

```vkf
:.math
x: [..512] / 256 - 1
y: sin(x * pi)
```

## Iteration

Use a range pipe for fixed unit-step iteration:

```vkf static
total: 0
..9 >> .total+: $
```

Use `condition?>` when termination depends on changing program state rather
than a fixed range.

## Vectors And Indices

Use vector operations instead of manually separating components. A literal
member or index uses `.name` or `.0`; a computed index uses `.(expression)`:

```vkf static
.position+: velocity * timestep
value: positions.(index)
first: positions.0
```

## Updates

Declare with `name:`. Update the declared name with `.name:` or a compound form
such as `.name+:`. Updating a selected record field or container element keeps
the selection on the left:

```vkf static
count: 0
.count+: 1
point.x: 4
values.(index): 7
```
