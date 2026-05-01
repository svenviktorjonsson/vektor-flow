<template>
  <main class="welcome-page">
    <section class="welcome-hero">
      <div class="welcome-hero__copy">
        <p class="welcome-kicker">Try out Vektor Flow</p>
        <h1>Build vivid UI, structural data, and tight math with a compact symbolic language.</h1>
        <p class="welcome-lede">
          Think some Python speed, some C++ terseness, then add reaching in, spilling, typed shapes,
          and UI as first-class ideas.
        </p>

        <div class="welcome-pills">
          <span>keyword-light</span>
          <span>spill structure</span>
          <span>reflect types</span>
          <span>browser + overlay UI</span>
        </div>

        <div class="welcome-actions">
          <a class="welcome-button" href="/install">Do this to get started</a>
          <a class="welcome-button welcome-button--ghost" href="/try-live">Open the browser draft</a>
        </div>

        <div class="welcome-shell">
          <div class="welcome-shell__bar">
            <span></span><span></span><span></span>
            <strong>Hello world</strong>
          </div>
          <pre><code>vkf -e ':: "hello, world"'
vkf samples/hello.vkf
vkf samples/core_language_tour.vkf</code></pre>
        </div>
      </div>

      <div class="welcome-hero__visuals">
        <figure class="welcome-shot welcome-shot--primary">
          <img src="/images/ui-frame-transparency-box.png" alt="Transparent 3D scene" />
          <figcaption>Browser-rendered 3D frame generated from Vektor Flow.</figcaption>
        </figure>
        <figure class="welcome-shot welcome-shot--secondary">
          <img src="/images/ui-widgets-static.png" alt="Widget layout" />
          <figcaption>Widget stack with labels, dropdowns, buttons, and sliders.</figcaption>
        </figure>
      </div>
    </section>

    <section class="welcome-principles">
      <article v-for="principle in principles" :key="principle.title" class="welcome-principle">
        <p class="welcome-principle__index">{{ principle.index }}</p>
        <h3>{{ principle.title }}</h3>
        <p>{{ principle.body }}</p>
      </article>
    </section>

    <section class="welcome-snippets">
      <header class="welcome-section-head">
        <p class="welcome-kicker">Language core ideas</p>
        <h2>Small snippets, big surface area</h2>
      </header>

      <article v-for="snippet in snippets" :key="snippet.title" class="snippet-card">
        <div class="snippet-card__meta">
          <div>
            <p class="snippet-card__eyebrow">{{ snippet.eyebrow }}</p>
            <h3>{{ snippet.title }}</h3>
          </div>
          <p>{{ snippet.description }}</p>
        </div>
        <div class="snippet-card__body">
          <pre class="vf-code" v-html="snippet.codeHtml"></pre>
          <div class="snippet-card__result">
            <p class="snippet-card__result-label">What it gives you</p>
            <p>{{ snippet.result }}</p>
          </div>
        </div>
      </article>
    </section>

    <section class="welcome-demos">
      <header class="welcome-section-head">
        <p class="welcome-kicker">Code and result together</p>
        <h2>The docs should prove the language, not just describe it</h2>
      </header>

      <DemoPair variant="widgets"></DemoPair>
      <DemoPair variant="box"></DemoPair>
    </section>

    <section class="welcome-vscode">
      <div>
        <p class="welcome-kicker">Get the good syntax highlighting</p>
        <h2>Use the VS Code extension for the full Vektor Flow grammar</h2>
        <p>
          GitHub README code blocks cannot use the full extension grammar. This docs site can get closer,
          and the VS Code extension gives you the real syntax highlighting, commands, and diagnostics.
        </p>
      </div>
      <div class="welcome-vscode__cards">
        <div class="welcome-mini-card">
          <h3>1. Install the bundled VSIX</h3>
          <p>Open VS Code, choose <code>Install from VSIX...</code>, and select the bundled extension.</p>
        </div>
        <div class="welcome-mini-card">
          <h3>2. Point it at <code>vkf</code></h3>
          <pre><code>{
  "vektorflow.compilerPath": "/path/to/vkf"
}</code></pre>
        </div>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import DemoPair from './DemoPair.vue'

const principles = [
  {
    index: '01',
    title: 'Reaching in',
    body: 'Use dot access, updates, and reflection to inspect and reshape nested values directly.'
  },
  {
    index: '02',
    title: 'Spilling',
    body: 'Expand structure without forcing verbose helper code around every transformation.'
  },
  {
    index: '03',
    title: 'Typed shapes',
    body: 'Vector widths and reflected types are visible parts of the language surface.'
  },
  {
    index: '04',
    title: 'UI as code',
    body: 'The same language can describe widgets, frames, geometry, and interaction surfaces.'
  }
] as const

const snippets = [
  {
    eyebrow: 'compact arithmetic',
    title: 'Keyword-free where it counts',
    description: 'Bindings and output stay lean, so the expression is the star.',
    result: 'You read the structure of the idea immediately instead of fighting boilerplate.',
    codeHtml: `<code><span class="vf-name">a</span><span class="vf-punc">:</span> <span class="vf-num">7</span>\n<span class="vf-name">b</span><span class="vf-punc">:</span> <span class="vf-num">5</span>\n<span class="vf-op">::</span> <span class="vf-str">"a + b = $(a + b)"</span>\n<span class="vf-op">::</span> <span class="vf-str">"a * b = $(a * b)"</span></code>`
  },
  {
    eyebrow: 'reaching in',
    title: 'Update nested structure directly',
    description: 'Records do not need ceremony-heavy setter APIs.',
    result: 'Nested fields are visible, editable, and easy to print or reflect.',
    codeHtml: `<code><span class="vf-name">person</span><span class="vf-punc">:</span> <span class="vf-punc">()</span>\n<span class="vf-name">person</span><span class="vf-dot">.</span><span class="vf-field">name</span><span class="vf-punc">:</span> <span class="vf-str">"Ada"</span>\n<span class="vf-name">person</span><span class="vf-dot">.</span><span class="vf-field">score</span><span class="vf-punc">:</span> <span class="vf-num">42</span>\n<span class="vf-name">person</span><span class="vf-dot">.</span><span class="vf-field">tags</span><span class="vf-punc">:</span> <span class="vf-punc">[</span><span class="vf-str">"math"</span><span class="vf-punc">,</span> <span class="vf-str">"logic"</span><span class="vf-punc">,</span> <span class="vf-str">"code"</span><span class="vf-punc">]</span></code>`
  },
  {
    eyebrow: 'typed shape logic',
    title: 'Make vector shape part of the function contract',
    description: 'Lengths are not hidden assumptions.',
    result: 'Types and shapes become visible pieces of the design, not comments in your head.',
    codeHtml: `<code><span class="vf-fn">join_scale</span><span class="vf-punc">(</span><span class="vf-name">x</span><span class="vf-punc">:</span><span class="vf-type">[num:n]</span><span class="vf-punc">,</span> <span class="vf-name">y</span><span class="vf-punc">:</span><span class="vf-type">[num:m]</span><span class="vf-punc">,</span> <span class="vf-name">s</span><span class="vf-punc">:</span><span class="vf-type">num</span><span class="vf-punc">)</span> <span class="vf-arrow">-&gt;</span> <span class="vf-type">[num:n+m]</span><span class="vf-punc">:</span>\n  <span class="vf-punc">(</span><span class="vf-name">x</span> <span class="vf-op">&amp;</span> <span class="vf-name">y</span><span class="vf-punc">)</span> <span class="vf-op">*</span> <span class="vf-name">s</span></code>`
  }
] as const
</script>