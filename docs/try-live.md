# Try live

This is the first browser-first draft of the interactive Vektor Flow docs.

<CuratedPlayground />

## What this proves already

- the docs site can carry the Vektor Flow grammar and highlight `vkf` blocks directly
- the visual examples are generated through the browser UI path, not the Windows overlay host
- we can pair real code with real rendered output in one place

## What comes next

1. freeform editing that rerenders in-page
2. more examples pulled from the actual sample catalog
3. a broader browser execution subset so the page can run more than curated demos

Until that lands, the strongest real path is still:

```bash
vkf -e ':: "hello, world"'
vkf samples/hello.vkf
vkf samples/core_language_tour.vkf
```

Then install the VS Code extension and point it at your packaged `vkf`.