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
.\vkf.exe .\samples\hello.vkf
.\vkf.exe .\samples\core_language_tour.vkf
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
./vkf ./samples/hello.vkf
./vkf ./samples/core_language_tour.vkf
```

## Need more detail?

- [Testing](./testing)
- [INSTALL.md on GitHub](https://github.com/svenviktorjonsson/vektor-flow/blob/main/INSTALL.md)
