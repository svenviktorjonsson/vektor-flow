# Why Vektor Flow?

Viktor Jonsson started with a small function parser for a drawing program.
Then came a question: if a language compiler can handle functions, why not build
the language too?

His experience doing numerical work supplied the motivation. He had spent time
fighting Python arrays to express the calculations he wanted, waiting for large
datasets to load and trying to fit execution frameworks around the problem.
Graphics libraries added more names to learn without the freedom he wanted.

At first, VKF accumulated too many clever operations. The turning point was to
make vectors the foundation and let a few consistent rules do more work.
A keyword-free syntax became a design constraint: operators, types, functions
and scopes, with useful shorthand—not minimalism at the expense of convenience.

The name fits the model: vectors flowing naturally through operations. It also
carries a personal connection: **Viktor**, with a K, and his school nickname **Flo**.

## From a parser to a compiler

The early implementation translated a rough syntax into Python. It then moved
to generated C++ before gaining direct machine-code output, without a separate
assembler or linker in the installed compilation path.

Self-hosting is the next step: making VKF build its own compiler. That work is
still in progress; it is not presented here as a completed release capability.
[The staged compiler architecture](../adr/0005-staged-self-hosting-and-direct-machine-code.md)
records that direction.

The implementation has been developed with AI-assisted, “vibe-coded” workflows.
That is its history, not a quality guarantee. Readable source, reproducible tests
and honest measurements are how it should earn trust.

[Back to the guide](guide.md).
