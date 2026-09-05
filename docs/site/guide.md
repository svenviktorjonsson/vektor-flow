# Vektor Flow guide

**[Why](origins.md)** — the problems and decisions behind the language.

**[How](getting-started.md)** — start writing, running and sharing programs.

**[What](concepts.md)** — the core ideas and measured performance.

The examples below are editable. Press **Run** to execute them locally in your
browser. Nothing to install; no compilation backend. The browser supports a
subset of VKF; the linked guides distinguish browser and native capabilities.

## Why

Viktor wanted to express mathematics without fighting array libraries or
learning a different graphics function for every shape. The initial constraint
was no keywords; the direction became a few consistent operations.

Here, one function works through vectors without an array-specific rewrite.

<!-- live-example: examples/introduction/vector-functions.vkf -->

[Why these design choices, and how VKF began →](origins.md)

## How

Change either vector and press **Run**. Matching axes multiply element by
element; different axes build a matrix or tensor.

<!-- live-example: examples/introduction/named-axes.vkf -->

[Build your first program →](getting-started.md), then use familiar
[HTML and CSS](getting-started.md#build-an-interface) for interfaces or
[download the compiler and use the CLI](../../INSTALL.md).

## What

Immutable values and rebinding, automatic vectorisation, mathematical libraries
and a small graphics core. Geometry is structured data: change the coordinates
and run this example again.

<!-- live-example: examples/introduction/geometry.vkf -->

[Explore the core ideas →](concepts.md)

[Performance: VKF 0.3.0 compared with C, Rust and Zig →](performance.md)

[Complete language reference →](../language-guide.md)
