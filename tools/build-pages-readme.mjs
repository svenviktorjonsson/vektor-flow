import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function filesystemRoot(root) {
  return root instanceof URL ? fileURLToPath(root) : resolve(root);
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function slugText(value) {
  return value
    .replaceAll(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replaceAll(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replaceAll(/[`*_~]/gu, "")
    .trim();
}

function slugger() {
  const used = new Map();
  return (text) => {
    const base = slugText(text)
      .toLocaleLowerCase()
      .normalize("NFKD")
      .replaceAll(/[^\p{L}\p{N}\s-]/gu, "")
      .trim()
      .replaceAll(/\s+/gu, "-") || "section";
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}

function externalRepositoryUrl(path) {
  return `https://github.com/svenviktorjonsson/vektor-flow/blob/codex/0.5/integration/${path}`;
}

function safeHref(raw, { image = false } = {}) {
  const href = raw.trim();
  if (/^(?:https?:|mailto:|#)/u.test(href)) return escapeHtml(href);
  const [path, fragment = ""] = href.split("#", 2);
  if (image) return `./generated/assets/${escapeHtml(path)}${fragment ? `#${escapeHtml(fragment)}` : ""}`;
  return `${externalRepositoryUrl(escapeHtml(path))}${fragment ? `#${escapeHtml(fragment)}` : ""}`;
}

function renderInline(source) {
  let html = "";
  let offset = 0;
  while (offset < source.length) {
    const rest = source.slice(offset);
    const linkedImage = /^\[!\[([^\]]*)\]\(([^)]+)\)\]\(([^)]+)\)/u.exec(rest);
    const image = /^!\[([^\]]*)\]\(([^)]+)\)/u.exec(rest);
    const link = /^\[([^\]]+)\]\(([^)]+)\)/u.exec(rest);
    const code = /^`([^`]+)`/u.exec(rest);
    const strong = /^\*\*([^*]+)\*\*/u.exec(rest);
    const emphasis = /^\*([^*]+)\*/u.exec(rest);
    const token = linkedImage ?? image ?? link ?? code ?? strong ?? emphasis;
    if (!token) {
      html += escapeHtml(source[offset]);
      offset += 1;
      continue;
    }
    if (linkedImage) {
      html += `<a href="${safeHref(linkedImage[3])}"><img src="${safeHref(linkedImage[2], { image: true })}" alt="${escapeHtml(linkedImage[1])}"></a>`;
    } else if (image) {
      html += `<img src="${safeHref(image[2], { image: true })}" alt="${escapeHtml(image[1])}">`;
    } else if (link) {
      html += `<a href="${safeHref(link[2])}">${renderInline(link[1])}</a>`;
    } else if (code) {
      html += `<code>${escapeHtml(code[1])}</code>`;
    } else if (strong) {
      html += `<strong>${renderInline(strong[1])}</strong>`;
    } else {
      html += `<em>${renderInline(emphasis[1])}</em>`;
    }
    offset += token[0].length;
  }
  return html;
}

function tableCells(line) {
  return line.trim().replace(/^\||\|$/gu, "").split("|").map((cell) => cell.trim());
}

function isTableDivider(line) {
  return /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/u.test(line);
}

export async function buildReadmeDocument(repoRoot) {
  const root = filesystemRoot(repoRoot);
  const markdown = await readFile(resolve(root, "README.md"), "utf8");
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const headings = [];
  const examples = [];
  const html = [];
  const makeSlug = slugger();
  let paragraph = [];
  let currentHeading = "README example";

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    html.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const marker = /^<!--\s*readme-example:\s*([^ ]+)\s*-->$/u.exec(line);
    if (marker) continue;
    if (/^<!--/u.test(line)) continue;

    const fence = /^```([^ ]*)\s*$/u.exec(line);
    if (fence) {
      flushParagraph();
      const language = fence[1].toLocaleLowerCase();
      const code = [];
      while (++index < lines.length && !/^```\s*$/u.test(lines[index])) code.push(lines[index]);
      const source = code.join("\n");
      if (language === "vkf") {
        const id = `readme-${String(examples.length + 1).padStart(2, "0")}`;
        const title = currentHeading;
        const item = Object.freeze({
          id,
          source,
          title,
        });
        examples.push(item);
        html.push(
          `<section class="readme-example" data-vkf-example-id="${id}">`,
          `<div class="readme-example-bar"><span>VKF</span><button type="button" class="readme-example-play">Play</button></div>`,
          `<div class="readme-example-layout"><div class="readme-example-workspace">`,
          `<div class="readme-example-editor"><pre class="readme-example-highlight" aria-hidden="true"><code></code></pre><textarea class="readme-example-source" data-example-id="${id}" aria-label="Editable VKF source for ${escapeHtml(title)}" spellcheck="false">${escapeHtml(source)}</textarea></div>`,
          `<section class="readme-example-terminal" hidden><span>Console</span><pre class="readme-example-output" aria-live="polite"></pre></section>`,
          `</div></div>`,
          `</section>`,
        );
      } else {
        html.push(`<pre><code>${escapeHtml(source)}</code></pre>`);
      }
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/u.exec(line);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      const title = slugText(heading[2]);
      const id = makeSlug(heading[2]);
      currentHeading = title;
      headings.push(Object.freeze({ level, title, id }));
      html.push(`<h${level} id="${id}">${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    if (line.startsWith(">")) {
      flushParagraph();
      const quote = [];
      while (index < lines.length && lines[index].startsWith(">")) {
        quote.push(lines[index].replace(/^> ?/u, ""));
        index += 1;
      }
      index -= 1;
      const content = quote.filter(Boolean).map(renderInline).join("<br>");
      html.push(`<blockquote>${content}</blockquote>`);
      continue;
    }

    if (line.includes("|") && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      flushParagraph();
      const headers = tableCells(line);
      index += 2;
      const rows = [];
      while (index < lines.length && /^\s*\|/u.test(lines[index])) {
        rows.push(tableCells(lines[index]));
        index += 1;
      }
      index -= 1;
      html.push(
        `<div class="table-scroll"><table><thead><tr>${headers.map((cell) => `<th>${renderInline(cell)}</th>`).join("")}</tr></thead>`,
        `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`,
      );
      continue;
    }

    const unordered = /^\s*[-*]\s+(.+)$/u.exec(line);
    const ordered = /^\s*\d+\.\s+(.+)$/u.exec(line);
    if (unordered || ordered) {
      flushParagraph();
      const tag = ordered ? "ol" : "ul";
      const items = [];
      while (index < lines.length) {
        const item = tag === "ol"
          ? /^\s*\d+\.\s+(.+)$/u.exec(lines[index])
          : /^\s*[-*]\s+(.+)$/u.exec(lines[index]);
        if (!item) break;
        items.push(item[1]);
        index += 1;
      }
      index -= 1;
      html.push(`<${tag}>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${tag}>`);
      continue;
    }

    if (/^<(?:details|\/details|summary|\/summary)>/u.test(line.trim())) {
      flushParagraph();
      html.push(line.trim());
      continue;
    }

    if (/^---+$/u.test(line.trim())) {
      flushParagraph();
      html.push("<hr>");
      continue;
    }

    if (line.trim() === "") flushParagraph();
    else paragraph.push(line.trim());
  }
  flushParagraph();

  return Object.freeze({
    html: html.join("\n"),
    headings: Object.freeze(headings),
    examples: Object.freeze(examples),
    imagePaths: Object.freeze([...markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/gu)]
      .map((match) => match[1])
      .filter((path) => !/^(?:https?:|data:)/u.test(path))),
  });
}

export async function writeReadmeDocument(repoRoot, outputRoot) {
  const root = filesystemRoot(repoRoot);
  const output = resolve(outputRoot);
  const document = await buildReadmeDocument(root);
  for (const path of document.imagePaths) {
    const destination = resolve(output, "assets", path);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(resolve(root, path), destination);
  }
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, "readme.json"), `${JSON.stringify(document)}\n`, "utf8");
  return document;
}

async function main() {
  const argument = process.argv.slice(2).find((value) => value.startsWith("--output="));
  if (!argument) throw new Error("usage: node tools/build-pages-readme.mjs --output=<directory>");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const output = resolve(root, argument.slice("--output=".length));
  const document = await writeReadmeDocument(root, output);
  console.log(`${document.headings.length} README sections and ${document.examples.length} executable blocks written`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
