<template>
  <section class="demo-pair">
    <div class="demo-pair__text">
      <p class="demo-pair__eyebrow">{{ active.eyebrow }}</p>
      <h3 class="demo-pair__title">{{ active.title }}</h3>
      <p class="demo-pair__description">{{ active.description }}</p>
      <div class="demo-pair__code">
        <pre class="vf-code" v-html="active.codeHtml"></pre>
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
    codeHtml: `<code><span class="vf-namespace">ui</span><span class="vf-punc">:.ui</span>\n<span class="vf-namespace">col</span><span class="vf-punc">:.collections</span>\n\n<span class="vf-name">d</span><span class="vf-punc">:</span> <span class="vf-name">ui</span><span class="vf-dot">.</span><span class="vf-field">display</span>\n<span class="vf-name">w</span><span class="vf-punc">:</span> <span class="vf-name">ui</span><span class="vf-dot">.</span><span class="vf-field">widgets</span>\n\n<span class="vf-name">a</span><span class="vf-punc">:</span> <span class="vf-name">d</span><span class="vf-dot">.</span><span class="vf-fn">frame</span><span class="vf-punc">(</span><span class="vf-field">title</span><span class="vf-punc">:</span> <span class="vf-str">"Anchor"</span><span class="vf-punc">,</span> <span class="vf-field">dock_loc</span><span class="vf-punc">:</span> <span class="vf-str">"bl"</span><span class="vf-punc">,</span> <span class="vf-field">resizable</span><span class="vf-punc">:</span> <span class="vf-bool">true</span><span class="vf-punc">)</span>\n<span class="vf-name">d</span><span class="vf-dot">.</span><span class="vf-fn">add_frame</span><span class="vf-punc">(</span>\n  <span class="vf-name">a</span><span class="vf-punc">,</span>\n  <span class="vf-punc">(</span><span class="vf-num">0.28</span><span class="vf-punc">,</span> <span class="vf-num">0.32</span><span class="vf-punc">,</span> <span class="vf-num">0.2</span><span class="vf-punc">,</span> <span class="vf-num">0.15</span><span class="vf-punc">)</span><span class="vf-punc">,</span>\n  <span class="vf-field">body</span><span class="vf-punc">:</span> <span class="vf-name">col</span><span class="vf-dot">.</span><span class="vf-fn">list</span><span class="vf-punc">(</span>…<span class="vf-punc">)</span>\n<span class="vf-punc">)</span></code>`
  },
  box: {
    eyebrow: 'UI example',
    title: 'Transparent 3D box frame',
    description: 'Geometry, camera, and lighting can be expressed directly in the same language.',
    image: '/images/ui-frame-transparency-box.png',
    caption: 'This same browser-oriented render path is what the docs and future playground are built around.',
    codeHtml: `<code><span class="vf-namespace">ui</span><span class="vf-punc">:.ui</span>\n\n<span class="vf-name">d</span> <span class="vf-punc">:</span> <span class="vf-name">ui</span><span class="vf-dot">.</span><span class="vf-field">display</span>\n<span class="vf-name">f</span> <span class="vf-punc">:</span> <span class="vf-name">d</span><span class="vf-dot">.</span><span class="vf-fn">add_frame</span><span class="vf-punc">((</span><span class="vf-num">0.32</span><span class="vf-punc">,</span> <span class="vf-num">0.08</span><span class="vf-punc">,</span> <span class="vf-num">0.62</span><span class="vf-punc">,</span> <span class="vf-num">0.84</span><span class="vf-punc">))</span>\n\n<span class="vf-name">box</span>   <span class="vf-punc">:</span> <span class="vf-name">f</span><span class="vf-dot">.</span><span class="vf-fn">add_box</span><span class="vf-punc">(</span><span class="vf-field">center</span><span class="vf-punc">:</span><span class="vf-punc">[</span><span class="vf-num">0</span><span class="vf-punc">,</span><span class="vf-num">0</span><span class="vf-punc">,</span><span class="vf-num">0</span><span class="vf-punc">]</span><span class="vf-punc">,</span> …<span class="vf-punc">)</span>\n<span class="vf-name">cam</span>   <span class="vf-punc">:</span> <span class="vf-name">f</span><span class="vf-dot">.</span><span class="vf-fn">add_camera</span><span class="vf-punc">(</span>…<span class="vf-punc">)</span>\n<span class="vf-name">light</span> <span class="vf-punc">:</span> <span class="vf-name">f</span><span class="vf-dot">.</span><span class="vf-fn">add_light</span><span class="vf-punc">(</span>…<span class="vf-punc">)</span>\n\n<span class="vf-name">box</span><span class="vf-dot">.</span><span class="vf-fn">rotate_by</span><span class="vf-punc">(</span><span class="vf-num">25</span><span class="vf-punc">,</span> <span class="vf-field">around</span><span class="vf-punc">:</span><span class="vf-str">"y"</span><span class="vf-punc">)</span></code>`
  }
} as const

const active = computed(() => demos[props.variant])
</script>