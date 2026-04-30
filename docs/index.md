# Try out Vektor Flow

Vektor Flow is a compact structural language for math, geometry, data, and UI.

It is built to feel:

- more compact than Python
- more expression-oriented than C++
- good at reaching into structure directly
- good at turning code into visible output fast

## Start in 30 seconds

Install a package for your OS, then run:

```bash
vkf -e ':: "hello, world"'
```

Then try:

```bash
vkf samples/hello.vkf
vkf samples/core_language_tour.vkf
```

For the packaged flow, install the VS Code extension from the included `.vsix`
and point it at your packaged `vkf`.

## A compact language

```vkf
a: 7
b: 5
:: "a + b = $(a + b)"
:: "a * b = $(a * b)"
```

```text
a + b = 12
a * b = 35
```

## Reaching in

```vkf
person: ()
person.name: "Ada"
person.score: 42
person.tags: ["math", "logic", "code"]

:: person.name
:: person.tags.0
:: person.
```

Values are meant to be easy to inspect, update, and navigate without a lot of
ceremony.

## Typed shapes

```vkf
join_scale(x:[num:n], y:[num:m], s:num) -> [num:n+m]:
  (x & y) * s

a2: [1,2]
b3: [3,4,5]
joined: join_scale(a2, b3, 2)
:: joined
:: joined.
```

Vectors, records, tuples, multisets, and reflected types are first-class ideas,
not library afterthoughts.

## UI example: static widgets

```vkf
ui:.ui
col:.collections

d: ui.display
w: ui.widgets

a: d.frame(title: "Anchor", dock_loc: "bl", resizable: true)
d.add_frame(
  a,
  (0.28, 0.32, 0.2, 0.15),
  body: col.list(
    w.label("l0", text: "Label + dropdown + button + slider"),
    w.dropdown("dd", col.list("one", "two", "three"), value: 0),
    w.button("go", label: "Button"),
    w.slider("sl", value: 0.5, vmin: 0, vmax: 1, step: 0.02)
  )
)
```

![Static widgets](/images/ui-widgets-static.png)

## UI example: transparent framed 3D box

```vkf
ui:.ui

d : ui.display
f : d.add_frame((0.32, 0.08, 0.62, 0.84))

box   : f.add_box(center:[0,0,0], scale:[1.4,1.4,1.4], color:"#ff8844")
cam   : f.add_camera(pos:[4,3,5], target:[0,0,0], fov:45)
light : f.add_light(pos:[7,8,6], model:"blinn_phong", color:"white")

box.rotate_by(25, around:"y")
```

![Transparent 3D box frame](/images/ui-frame-transparency-box.png)

## Get syntax highlighting in VS Code

1. Install the bundled `.vsix`
2. Set:

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

Then open a `.vkf` file and use the Vektor Flow commands directly from VS Code.

## Next

- [Install](./install)
- [VS Code](./vscode)
- [Try live](./try-live)
