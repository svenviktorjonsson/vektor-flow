import { copyFile, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const SITE_PAGES = Object.freeze({
  "README.md": "index.html",
  "docs/site/guide.md": "guide.html",
  "docs/language-guide.md": "reference.html",
  "docs/site/performance.md": "performance.html",
  "docs/site/execution.md": "execution.html",
  "docs/site/origins.md": "origins.html",
  "INSTALL.md": "install.html",
  "docs/style-guide.md": "style.html",
  "TESTING.md": "testing.html",
  "RELEASES.md": "releases.html",
  "vscode/README.md": "editor.html",
  "docs/adr/0001-ui-runtime-shared-memory-gpu.md": "ui-architecture.html",
  "docs/adr/0004-browser-symbolic-kernel.md": "browser-architecture.html",
  "docs/adr/0005-staged-self-hosting-and-direct-machine-code.md": "compiler-architecture.html",
  "benchmarks/core-comparison/results/linux-x64-030.md": "benchmarks/core-0.3.0.html",
});
const REPOSITORY = "https://github.com/svenviktorjonsson/vektor-flow";
const ORIGIN = "https://vektorflow.org/";
const REPORT = "benchmarks/core-comparison/results/linux-x64-030.md";
const rootPath = (root) => root instanceof URL ? fileURLToPath(root) : resolve(root);
export const escapeHtml = (text) => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const routeFor = (source) => SITE_PAGES[source] ?? `reference/${source.replace(/\.md$/iu, ".html")}`;
const stripInline = (text) => text.replaceAll(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1").replaceAll(/[`*_~]/gu, "");

async function safeFile(root, source) {
  const base = await realpath(root);
  const file = await realpath(resolve(root, source));
  const rel = relative(base, file);
  if (rel === ".." || rel.startsWith(`..${sep}`) || resolve(base, rel) !== file) {
    throw new Error(`Document path escapes the repository: ${source}`);
  }
  if (!(await stat(file)).isFile()) throw new Error(`Document link is not a file: ${source}`);
  return file;
}

function tableCells(line) {
  const cells = [];
  let value = "", code = false, escaped = false;
  for (const char of line.trim().replace(/^\||\|$/gu, "")) {
    if (escaped) { value += `\\${char}`; escaped = false; continue; }
    if (char === "\\") { escaped = true; continue; }
    if (char === "`") code = !code;
    if (char === "|" && !code) { cells.push(value.trim()); value = ""; }
    else value += char;
  }
  cells.push(value.trim());
  return cells;
}

export function benchmarkSummary(report) {
  const section = report.split("## Raw kernel runtime (ms)")[1]?.split(/^## /mu)[0];
  if (!section) throw new Error("Missing raw-kernel table in the 0.3.0 benchmark report");
  const rows = section.split(/\r?\n/u).filter((line) => /^\| (?:spectral norm|fannkuch|five-body)/u.test(line));
  if (rows.length !== 3) throw new Error("Expected exactly three measured benchmark rows");
  const names = ["Spectral norm", "Fannkuch", "N-body"];
  const output = ["| Workload | VKF mean ± std (ms) | VKF / C | VKF / Rust | VKF / Zig |", "| --- | ---: | ---: | ---: | ---: |"];
  for (const [index, row] of rows.entries()) {
    const cells = tableCells(row);
    const timings = cells.slice(5, 9).map((cell) => Number.parseFloat(cell));
    if (timings.length !== 4 || timings.some((n) => !Number.isFinite(n) || n <= 0)) throw new Error("Invalid benchmark timings");
    output.push(`| ${names[index]} | ${cells[5]} | ${timings.slice(1).map((n) => `${(timings[0] / n).toFixed(2)}×`).join(" | ")} |`);
  }
  return output.join("\n");
}

/** Render trusted repository Markdown. Raw HTML is escaped, apart from details/summary. */
export async function buildSiteDocument(repoRoot, source = "README.md") {
  const root = rootPath(repoRoot);
  let markdown = await readFile(await safeFile(root, source), "utf8");
  const dependencies = new Set(), assets = new Set();
  const route = routeFor(source);
  const prefix = posix.relative(posix.dirname(route), ".") || ".";
  const siteLink = (path) => `${prefix}/${path}`;
  const included = [...markdown.matchAll(/^<!-- live-example: ([^\r\n]+) -->$/gmu)];
  for (const match of included) {
    const path = match[1].trim();
    const code = (await readFile(await safeFile(root, path), "utf8")).trimEnd();
    markdown = markdown.replace(match[0], `\`\`\`vkf live\n${code}\n\`\`\``);
  }
  if (markdown.includes("<!-- benchmark-summary -->")) {
    markdown = markdown.replace("<!-- benchmark-summary -->", benchmarkSummary(await readFile(await safeFile(root, REPORT), "utf8")));
  }
  if (markdown.startsWith("---\n")) markdown = markdown.replace(/^---\n[\s\S]*?\n---\n/u, "");

  function href(raw, image = false) {
    const value = raw.trim();
    if (value.startsWith(ORIGIN)) return escapeHtml(siteLink(value.slice(ORIGIN.length) || "index.html"));
    if (/^(?:https?:|mailto:|#)/iu.test(value)) return escapeHtml(value);
    if (/^[a-z][a-z0-9+.-]*:/iu.test(value) || value.startsWith("//")) return "#";
    const [target, fragment] = value.split("#", 2);
    if (!target) return `#${escapeHtml(fragment ?? "")}`;
    let decoded;
    try { decoded = decodeURIComponent(target); } catch { throw new Error(`Invalid link in ${source}: ${value}`); }
    const path = posix.normalize(posix.join(posix.dirname(source), decoded));
    if (path === ".." || path.startsWith("../") || posix.isAbsolute(path)) throw new Error(`Unsafe link in ${source}: ${value}`);
    const suffix = fragment ? `#${escapeHtml(fragment)}` : "";
    if (/\.md$/iu.test(path)) {
      dependencies.add(path);
      return `${escapeHtml(siteLink(routeFor(path)))}${suffix}`;
    }
    if (!posix.extname(path) || path.endsWith("/")) return `${REPOSITORY}/tree/main/${escapeHtml(path)}${suffix}`;
    // HTML and scripts are presented as source, never as executable hosted applications.
    const output = `sources/${path}${!image && /\.(?:html?|m?js)$/iu.test(path) ? ".txt" : ""}`;
    assets.add(JSON.stringify({ source: path, output }));
    return `${escapeHtml(siteLink(output))}${suffix}`;
  }

  function inline(text) {
    let output = "", offset = 0;
    while (offset < text.length) {
      const rest = text.slice(offset);
      const code = /^`([^`]+)`/u.exec(rest);
      if (code) { output += `<code>${escapeHtml(code[1])}</code>`; offset += code[0].length; continue; }
      const strong = /^\*\*([\s\S]+?)\*\*/u.exec(rest);
      if (strong) { output += `<strong>${inline(strong[1])}</strong>`; offset += strong[0].length; continue; }
      const emphasis = /^\*([^*]+)\*/u.exec(rest);
      if (emphasis) { output += `<em>${inline(emphasis[1])}</em>`; offset += emphasis[0].length; continue; }
      const link = /^(!?)\[([^\]]*)\]\(/u.exec(rest);
      if (link) {
        let end = link[0].length, depth = 1;
        for (; end < rest.length && depth > 0; end++) {
          if (rest[end] === "(") depth++;
          if (rest[end] === ")") depth--;
        }
        if (!depth) {
          const url = rest.slice(link[0].length, end - 1);
          output += link[1] ? `<img loading="lazy" src="${href(url, true)}" alt="${escapeHtml(link[2])}">` : `<a href="${href(url)}">${inline(link[2])}</a>`;
          offset += end; continue;
        }
      }
      if (rest.startsWith("\\") && rest.length > 1 && /[\p{P}\p{S}]/u.test(rest[1])) { output += escapeHtml(rest[1]); offset += 2; continue; }
      output += escapeHtml(text[offset++]);
    }
    return output;
  }

  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const html = [], headings = [], examples = [], slugs = new Map();
  let paragraph = [], title = "Vektor Flow";
  const flush = () => { if (paragraph.length) html.push(`<p>${inline(paragraph.join(" "))}</p>`); paragraph = []; };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^<!--/u.test(line.trim())) {
      while (!lines[index]?.includes("-->") && index + 1 < lines.length) index++;
      continue;
    }
    const fence = /^\s*(`{3,}|~{3,})(.*)$/u.exec(line);
    if (fence) {
      flush();
      const [language = "", mode = ""] = fence[2].trim().split(/\s+/u);
      const code = [];
      while (++index < lines.length && !lines[index].trimStart().startsWith(fence[1])) code.push(lines[index]);
      const sourceCode = code.join("\n");
      if (language === "vkf" && mode === "live") {
        const id = `example-${examples.length + 1}`;
        examples.push(Object.freeze({ id, source: sourceCode, title }));
        html.push(`<section class="readme-example" data-vkf-example-id="${id}"><div class="readme-example-bar"><span>Run in browser</span><button type="button" class="readme-example-play">Run</button></div><div class="readme-example-layout"><div class="readme-example-workspace"><div class="readme-example-editor"><pre class="readme-example-highlight" aria-hidden="true"><code></code></pre><textarea class="readme-example-source" data-example-id="${id}" aria-label="Editable VKF source: ${escapeHtml(title)}" spellcheck="false">${escapeHtml(sourceCode)}</textarea></div><section class="readme-example-terminal" hidden><span>Console</span><pre class="readme-example-output" aria-live="polite"></pre></section></div></div></section>`);
      } else html.push(`<pre${language === "vkf" ? ' class="vkf-static" data-vkf-source' : ""}><code>${escapeHtml(sourceCode)}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/u.exec(line);
    if (heading) {
      flush();
      title = stripInline(heading[2]);
      const slug = title.toLowerCase().normalize("NFKD").replaceAll(/[^\p{L}\p{N}\s-]/gu, "").trim().replaceAll(/\s+/gu, "-") || "section";
      const count = slugs.get(slug) ?? 0; slugs.set(slug, count + 1);
      const id = count ? `${slug}-${count}` : slug;
      headings.push({ level: heading[1].length, title, id });
      html.push(`<h${heading[1].length} id="${id}">${inline(heading[2])}</h${heading[1].length}>`);
      continue;
    }
    if (line.includes("|") && /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/u.test(lines[index + 1] ?? "")) {
      flush();
      const headers = tableCells(line), rows = [];
      index += 2;
      while (index < lines.length && /^\s*\|/u.test(lines[index])) rows.push(tableCells(lines[index++]));
      index--;
      html.push(`<div class="table-scroll" tabindex="0" role="region" aria-label="Scrollable table"><table><thead><tr>${headers.map((cell) => `<th scope="col">${inline(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    const list = /^\s*(?:[-*]|\d+\.)\s+(.+)$/u.exec(line);
    if (list) {
      flush(); const ordered = /^\s*\d+\./u.test(line), items = [];
      const pattern = ordered ? /^\s*\d+\.\s+(.+)$/u : /^\s*[-*]\s+(.+)$/u;
      while (index < lines.length) {
        const match = pattern.exec(lines[index]); if (!match) break;
        let value = match[1]; index++;
        while (index < lines.length && /^\s{2,}\S/u.test(lines[index]) && !/^\s*(?:[-*]|\d+\.|```)/u.test(lines[index])) value += ` ${lines[index++].trim()}`;
        items.push(value);
      }
      index--;
      const tag = ordered ? "ol" : "ul";
      html.push(`<${tag}>${items.map((item) => `<li>${inline(item)}</li>`).join("")}</${tag}>`); continue;
    }
    if (line.startsWith(">")) {
      flush(); const quote = [];
      while (index < lines.length && lines[index].startsWith(">")) quote.push(lines[index++].replace(/^> ?/u, ""));
      index--;
      html.push(`<blockquote>${quote.map((text) => inline(text.replace(/^\[!([A-Z]+)\]$/u, "**$1**"))).join("<br>")}</blockquote>`); continue;
    }
    const summary = /^<summary>(.*?)<\/summary>$/u.exec(line.trim());
    if (summary) { flush(); html.push(`<summary>${inline(summary[1])}</summary>`); continue; }
    if (/^<\/?details>$/u.test(line.trim())) { flush(); html.push(line.trim()); continue; }
    if (/^---+$/u.test(line.trim())) { flush(); html.push("<hr>"); continue; }
    if (!line.trim()) flush(); else paragraph.push(line.trim());
  }
  flush();
  return Object.freeze({ html: html.join("\n"), headings, examples, source, route,
    dependencies: [...dependencies], assets: [...assets].map(JSON.parse) });
}

export function pageHtml(document) {
  const prefix = posix.relative(posix.dirname(document.route), ".") || ".";
  const home = document.route === "index.html";
  const title = document.headings.find((h) => h.level === 1)?.title ?? "Vektor Flow";
  const nav = [["Guide", "guide.html"], ["Reference", "reference.html"], ["Performance", "performance.html"], ["Download", "install.html"]];
  const sectionLinks = document.headings.filter((h) => h.level === 2);
  const toc = !home && sectionLinks.length > 4 ? `<details class="contents"><summary>On this page</summary><nav aria-label="On this page">${sectionLinks.map((h) => `<a href="#${escapeHtml(h.id)}">${escapeHtml(h.title)}</a>`).join("")}</nav></details>` : "";
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="description" content="Vektor Flow: a few powerful principles for calculations, data and visual programs. Try supported examples in your browser."><title>${escapeHtml(title)}${home ? "" : " · Vektor Flow"}</title><link rel="canonical" href="${ORIGIN}${document.route === "index.html" ? "" : document.route}"><link rel="stylesheet" href="${prefix}/site.css"></head><body><a class="skip-link" href="#readme-documentation">Skip to content</a><header class="site-nav"><a class="wordmark" href="${prefix}/index.html">Vektor Flow</a><nav aria-label="Main navigation">${nav.map(([label, path]) => `<a${document.route === path ? ' aria-current="page"' : ""} href="${prefix}/${path}">${label}</a>`).join("")}</nav></header><main class="${home ? "landing" : "documentation"}">${toc}<article id="readme-documentation" class="readme">${document.html}</article></main><footer class="site-footer">Experimental software · <a href="${REPOSITORY}">Source</a> · <a href="${prefix}/origins.html">Origins</a></footer>${document.examples.length || document.html.includes("data-vkf-source") ? `<script type="module" src="${prefix}/documentation.mjs"></script>` : ""}</body></html>\n`;
}

/** Publish each Markdown source once. Only live-labelled examples become editors. */
export async function writeSite(repoRoot, outputRoot, { pages = Object.keys(SITE_PAGES) } = {}) {
  const root = rootPath(repoRoot), output = resolve(outputRoot), publishRoot = dirname(output);
  const queue = [...pages], documents = new Map();
  while (queue.length) {
    const source = queue.shift();
    if (documents.has(source)) continue;
    const document = await buildSiteDocument(root, source);
    documents.set(source, document);
    queue.push(...document.dependencies.filter((path) => !documents.has(path)));
  }
  // Validate every dependency before writing any public page.
  const assets = new Map();
  for (const document of documents.values()) for (const asset of document.assets) {
    assets.set(asset.output, await safeFile(root, asset.source));
  }
  for (const [path, source] of assets) {
    const destination = resolve(publishRoot, path); await mkdir(dirname(destination), { recursive: true }); await copyFile(source, destination);
  }
  for (const document of documents.values()) {
    const destination = resolve(publishRoot, document.route); await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, pageHtml(document), "utf8");
    const data = resolve(output, document.route.replace(/\.html$/u, ".json")); await mkdir(dirname(data), { recursive: true });
    await writeFile(data, `${JSON.stringify(document)}\n`, "utf8");
  }
  const home = documents.get("README.md");
  if (home) await writeFile(resolve(output, "readme.json"), `${JSON.stringify(home)}\n`, "utf8");
  return { pages: documents.size, examples: [...documents.values()].reduce((n, doc) => n + doc.examples.length, 0) };
}
