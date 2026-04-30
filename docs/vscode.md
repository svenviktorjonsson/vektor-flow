# VS Code

To get Vektor Flow syntax highlighting, commands, and diagnostics:

1. Install the bundled `.vsix` from the package
2. Point the extension at your packaged `vkf`

## Windows

```json
{
  "vektorflow.compilerPath": "C:\\path\\to\\vkf.exe"
}
```

## macOS / Linux

```json
{
  "vektorflow.compilerPath": "/path/to/vkf"
}
```

Then:

1. Open `samples/hello.vkf`
2. Run `Run Vektor Flow File`

You should get:

- syntax highlighting
- run / parse / build commands
- compiler-backed diagnostics

More detail:

- [Extension README on GitHub](https://github.com/svenviktorjonsson/vektor-flow/blob/main/vscode/README.md)
