<template>
  <section class="playground-card">
    <div class="playground-card__header">
      <div>
        <p class="playground-card__eyebrow">Playground Draft</p>
        <h3>Switch between real Vektor Flow examples</h3>
        <p>
          This first draft keeps the renderer honest: every preview comes from the browser UI path,
          captured from a real example. The next step is freeform live execution in the page.
        </p>
      </div>
      <div class="playground-card__tabs">
        <button
          v-for="example in examples"
          :key="example.id"
          :class="['playground-card__tab', { 'is-active': example.id === activeId }]"
          type="button"
          @click="activeId = example.id"
        >
          {{ example.label }}
        </button>
      </div>
    </div>

    <div class="playground-card__body">
      <div class="playground-card__editor">
        <div class="playground-card__editor-head">
          <span>{{ active.label }}</span>
          <button type="button" @click="copyCode">Copy</button>
        </div>
        <textarea :value="active.code" readonly spellcheck="false" />
        <p class="playground-card__hint">Install the packaged <code>vkf</code> or use the VS Code extension to run this exact snippet locally today.</p>
      </div>

      <figure class="playground-card__preview">
        <img :src="active.image" :alt="active.label" />
        <figcaption>{{ active.caption }}</figcaption>
      </figure>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

const examples = [
  {
    id: 'widgets',
    label: 'Widget stack',
    image: '/images/ui-widgets-static.png',
    caption: 'Dropdowns, buttons, and sliders laid out in one compact frame.',
    code: `ui:.ui\ncol:.collections\n\nd: ui.display\nw: ui.widgets\n\na: d.frame(title: "Anchor", dock_loc: "bl", resizable: true)\nd.add_frame(\n  a,\n  (0.28, 0.32, 0.2, 0.15),\n  body: col.list(\n    w.label("l0", text: "Label + dropdown + button + slider"),\n    w.dropdown("dd", col.list("one", "two", "three"), value: 0),\n    w.button("go", label: "Button"),\n    w.slider("sl", value: 0.5, vmin: 0, vmax: 1, step: 0.02)\n  )\n)`
  },
  {
    id: 'box',
    label: '3D frame',
    image: '/images/ui-frame-transparency-box.png',
    caption: 'A framed camera scene with geometry and lighting in a few lines.',
    code: `ui:.ui\n\nd : ui.display\nf : d.add_frame((0.32, 0.08, 0.62, 0.84))\n\nbox   : f.add_box(center:[0,0,0], scale:[1.4,1.4,1.4], color:"#ff8844")\ncam   : f.add_camera(pos:[4,3,5], target:[0,0,0], fov:45)\nlight : f.add_light(pos:[7,8,6], model:"blinn_phong", color:"white")\n\nbox.rotate_by(25, around:"y")`
  }
] as const

const activeId = ref(examples[0].id)
const active = computed(() => examples.find((example) => example.id === activeId.value) ?? examples[0])

async function copyCode() {
  try {
    await navigator.clipboard.writeText(active.value.code)
  } catch {
    // no-op fallback for older browsers or denied clipboard access
  }
}
</script>
