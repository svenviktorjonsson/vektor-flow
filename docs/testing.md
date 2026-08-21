# Testing Vektor Flow

Language tests are ordinary `.vkf` files. Every public top-level function
with no required parameters is a test and ends in an assertion:

```vkf
addition_is_exact() -> bit:
    (2 + 2 == 4)?!
```

Run a file, folder, or one named function without Python:

```text
vkftest tests/vkf
vkftest tests/vkf/core_assertions.vkf addition_is_exact
vkftest tests/vkf --function addition_is_exact
```

Passing functions print one `PASS` row. A failure prints the function source
and assertion error. Prefix helper functions with `_`. Parameters with VKF
defaults are called without arguments. Required parameter fixtures will later
come from `.testing`.

If you are trying a package build and want to help with debugging:

1. run the inline smoke command
2. run `samples/01_hello.vkf`
3. run `samples/100_axis_4_panel.vkf`
4. try the bundled VS Code extension

## Good bug reports include

- your OS and version
- the exact command you ran
- the exact output or screenshot
- whether VS Code was involved
- `vektorflow-release.json` if the issue came from a package build

Full tester checklist:

- [TESTING.md on GitHub](https://github.com/svenviktorjonsson/vektor-flow/blob/main/TESTING.md)
