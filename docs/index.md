<div class="vf-hero">
  <div class="vf-hero__grid">
    <div>
      <p class="vf-kicker">Try out Vektor Flow</p>
      <h1>Compact code that reaches into structure and turns into visible output fast.</h1>
      <p>
        Vektor Flow blends some of the terseness people like in C++ with some of the speed and
        directness people like in Python, then adds structural operations, spilling, typed shapes,
        and UI as first-class ideas.
      </p>
      <div class="vf-button-row">
        <a class="vf-button" href="./install">Do this to get started</a>
        <a class="vf-button--ghost" href="./try-live">See the browser draft</a>
      </div>
    </div>

    <figure class="vf-hero__card">
      <img src="/images/ui-frame-transparency-box.png" alt="Vektor Flow 3D frame example" />
      <figcaption>
        A framed 3D scene generated from compact Vektor Flow code and rendered through the browser UI path.
      </figcaption>
    </figure>
  </div>
</div>

<div class="vf-install-strip">
  <p><strong>Do this to get started.</strong></p>
  <pre><code>vkf -e ':: "hello, world"'
vkf samples/hello.vkf
vkf samples/core_language_tour.vkf</code></pre>
</div>

## Hello world

```vkf
:: "hello, world"
```

```text
hello, world
```

## Core ideas

<div class="vf-principles">
  <div class="vf-principle">
    <h3>Keyword-light</h3>
    <p>Expressions stay compact, structural, and readable without a lot of ceremony.</p>
  </div>
  <div class="vf-principle">
    <h3>Reaching in</h3>
    <p>Dot access, updates, and reflection make nested structures easy to inspect and reshape.</p>
  </div>
  <div class="vf-principle">
    <h3>Spilling</h3>
    <p>Collections and structure can be expanded directly instead of hidden behind verbose helper code.</p>
  </div>
  <div class="vf-principle">
    <h3>Shapes matter</h3>
    <p>Typed vectors, shape parameters, and reflected types are part of the language, not bolted on.</p>
  </div>
</div>

## The language in small pieces

```vkf
a: 7
b: 5
:: "a + b = $(a + b)"
:: "a * b = $(a * b)"
```

```vkf
person: ()
person.name: "Ada"
person.score: 42
person.tags: ["math", "logic", "code"]

:: person.name
:: person.tags.0
:: person.
```

```vkf
join_scale(x:[num:n], y:[num:m], s:num) -> [num:n+m]:
  (x & y) * s
```

## Code and result, side by side

<DemoPair variant="widgets"></DemoPair>

<DemoPair variant="box"></DemoPair>

## Get the good syntax highlighting

The GitHub README cannot use the full Vektor Flow grammar directly. The docs site and the VS Code extension can.

1. Install the bundled `.vsix`
2. Point it at your packaged `vkf`
3. Open a `.vkf` file and use the Vektor Flow commands directly from VS Code

```json
{
  "vektorflow.compilerPath": "/path/to/vkf"
}
```

On Windows:

```json
{
  "vektorflow.compilerPath": "C:\\path\\to\\vkf.exe"
}
```

## Next

- [Install](./install)
- [VS Code](./vscode)
- [Try live](./try-live)
- [Testing](./testing)