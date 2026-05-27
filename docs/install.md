# Install Vektor Flow

## Windows

1. Download and extract the Windows package
2. Open PowerShell in the extracted folder
3. Run:

```powershell
.\vkf.exe -e ':: "hello, world"'
```

You should see:

```text
hello, world
```

Then try:

```powershell
.\vkf.exe .\samples\01_hello.vkf
.\vkf.exe .\samples\100_axis_4_panel.vkf
```

## macOS / Linux

1. Download and extract the package for your OS
2. Open a shell in the extracted folder
3. Run:

```bash
./vkf -e ':: "hello, world"'
```

Then try:

```bash
./vkf ./samples/01_hello.vkf
./vkf ./samples/100_axis_4_panel.vkf
```

## Need more detail?

- [Testing](./testing)
- [INSTALL.md on GitHub](https://github.com/svenviktorjonsson/vektor-flow/blob/main/INSTALL.md)
