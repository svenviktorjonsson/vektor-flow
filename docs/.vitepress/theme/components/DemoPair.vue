<template>
  <section class="demo-pair">
    <div class="demo-pair__text">
      <p class="demo-pair__eyebrow">{{ active.eyebrow }}</p>
      <h3 class="demo-pair__title">{{ active.title }}</h3>
      <p class="demo-pair__description">{{ active.description }}</p>
      <div class="demo-pair__code">
        <pre><code>{{ active.code }}</code></pre>
      </div>
    </div>
    <figure class="demo-pair__visual">
      <img :src="active.image" :alt="active.title" />
      <figcaption>{{ active.caption }}</figcaption>
    </figure>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  variant: 'widgets' | 'box'
}>()

const demos = {
  widgets: {
    eyebrow: 'UI example',
    title: 'Static widgets',
    description: 'Frames, widgets, and layout can stay declarative and compact.',
    image: '/images/ui-widgets-static.png',
    caption: 'Rendered through the browser UI path and captured offscreen with Playwright.',
    code: `ui:.ui
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
)`
  },
  box: {
    eyebrow: 'UI example',
    title: 'Transparent 3D box frame',
    description: 'Geometry, camera, and lighting can be expressed directly in the same language.',
    image: '/images/ui-frame-transparency-box.png',
    caption: 'This same browser-oriented render path is what the docs and future playground are built around.',
    code: `ui:.ui

d : ui.display
f : d.add_frame((0.32, 0.08, 0.62, 0.84))

box   : f.add_box(center:[0,0,0], scale:[1.4,1.4,1.4], color:"#ff8844")
cam   : f.add_camera(pos:[4,3,5], target:[0,0,0], fov:45)
light : f.add_light(pos:[7,8,6], model:"blinn_phong", color:"white")

box.rotate_by(25, around:"y")`
  }
} as const

const active = computed(() => demos[props.variant])
</script>