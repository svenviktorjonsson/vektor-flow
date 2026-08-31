(function (global) {
  "use strict";

  function bundleRoot(baseUrl) {
    const url = new global.URL(baseUrl);
    const match = url.pathname.match(/^(.*\/vf-static-ui-[0-9a-f]{16}\/)/);
    if (!match) throw new Error("static HTML resource is outside a content-addressed bundle");
    return { origin: url.origin, path: match[1] };
  }

  function resolveLocal(rawReference, baseUrl, root, context) {
    const reference = String(rawReference || "").trim().split(/[?#]/, 1)[0];
    if (!reference || reference.startsWith("/") || reference.startsWith("#") ||
        reference.includes(":")) {
      throw new Error(`${context} must be source-relative`);
    }
    const resolved = new global.URL(reference, baseUrl);
    if (resolved.origin !== root.origin || !resolved.pathname.startsWith(root.path)) {
      throw new Error(`${context} escapes its static bundle`);
    }
    return resolved.href;
  }

  function staticDocument(text, baseUrl, root) {
    const parsed = new global.DOMParser().parseFromString(text, "text/html");
    if (parsed.querySelector("script")) {
      throw new Error("static HTML cannot contain scripts");
    }
    for (const element of parsed.querySelectorAll("*")) {
      for (const attribute of element.attributes) {
        if (attribute.name.toLowerCase().startsWith("on") ||
            /^javascript:/i.test(attribute.value.trim())) {
          throw new Error("static HTML cannot contain JavaScript");
        }
      }
    }
    const stylesheets = [];
    const assets = [];
    for (const link of parsed.querySelectorAll('link[rel~="stylesheet"]')) {
      const resolved = resolveLocal(
        link.getAttribute("href"), baseUrl, root, "static HTML stylesheet",
      );
      link.setAttribute("href", resolved);
      stylesheets.push(resolved);
    }
    for (const image of parsed.querySelectorAll("img[src], source[src]")) {
      const resolved = resolveLocal(
        image.getAttribute("src"), baseUrl, root, "static HTML image",
      );
      image.setAttribute("src", resolved);
      assets.push(resolved);
    }
    return { parsed, stylesheets, assets, entry: baseUrl };
  }

  async function fetchOk(url) {
    const response = await global.fetch(url);
    if (!response.ok) throw new Error("static HTML resource could not be loaded");
    return response;
  }

  function cssReferences(css) {
    const imports = [];
    const assets = [];
    css.replace(
      /@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^'"\s;)]+))\s*\)?/gi,
      (match, doubleQuoted, singleQuoted, bare) => {
        imports.push(doubleQuoted ?? singleQuoted ?? bare);
        return match;
      },
    );
    css.replace(
      /url\(\s*(?:"([^"]*)"|'([^']*)'|([^'"\s)]+))\s*\)/gi,
      (match, doubleQuoted, singleQuoted, bare) => {
        const reference = doubleQuoted ?? singleQuoted ?? bare;
        if (!/^data:/i.test(reference)) assets.push(reference);
        return match;
      },
    );
    return { imports, assets };
  }

  async function preflightStaticGraph(prepared, root) {
    const visiting = new Set();
    const visited = new Set();
    const fetchedAssets = new Set();
    const claimed = new Set([prepared.entry]);
    function claim(url) {
      if (claimed.has(url)) return false;
      if (claimed.size >= 256) {
        throw new Error("static HTML resource graph exceeds 256 files");
      }
      claimed.add(url);
      return true;
    }
    async function fetchAsset(url) {
      if (fetchedAssets.has(url)) return;
      claim(url);
      fetchedAssets.add(url);
      await fetchOk(url);
    }
    async function visitCss(url, depth) {
      if (depth > 64) throw new Error("static HTML CSS graph exceeds depth 64");
      if (visiting.has(url)) throw new Error("static HTML CSS import cycle");
      if (visited.has(url)) return;
      claim(url);
      visiting.add(url);
      const response = await fetchOk(url);
      const references = cssReferences(await response.text());
      for (const reference of references.imports) {
        await visitCss(resolveLocal(reference, response.url, root, "static HTML CSS import"), depth + 1);
      }
      for (const reference of references.assets) {
        await fetchAsset(resolveLocal(reference, response.url, root, "static HTML CSS URL"));
      }
      visiting.delete(url);
      visited.add(url);
    }
    for (const stylesheet of prepared.stylesheets) await visitCss(stylesheet, 0);
    for (const asset of prepared.assets) await fetchAsset(asset);
  }

  function emitVfEvent(event) {
    const message = global.Object.assign({ type: "vf_event" }, event);
    try {
      if (global.chrome && global.chrome.webview &&
          typeof global.chrome.webview.postMessage === "function") {
        global.chrome.webview.postMessage(message);
        return;
      }
    } catch (_) {}
    if (global.VfRetainedEventAdapter &&
        typeof global.VfRetainedEventAdapter.dispatch === "function") {
      global.VfRetainedEventAdapter.dispatch(message).catch(function (error) {
        global.__vfRetainedEventError = error;
        global.document.body?.setAttribute("data-vf-retained-event-error", "1");
      });
      return;
    }
    if (typeof global.fetch === "function") {
      global.fetch("/api/enqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ line: JSON.stringify(message) }),
        cache: "no-store",
      }).catch(function () {});
    }
  }

  function bindRetainedEvents(root, frameId) {
    for (const button of root.querySelectorAll("button[id]")) {
      button.addEventListener("click", function () {
        emitVfEvent({
          event: "ButtonClicked",
          widget_id: button.id,
          frame_id: frameId,
        });
      });
    }
    for (const input of root.querySelectorAll('input[type="range"][id]')) {
      input.addEventListener("input", function () {
        emitVfEvent({
          event: "SliderValueChanged",
          widget_id: input.id,
          frame_id: frameId,
          value: Number(input.value),
        });
      });
    }
  }

  async function mountFrameHtml(frameRoot, resourcePath) {
    if (!(frameRoot instanceof global.Element)) {
      throw new Error("static HTML requires a Frame root");
    }
    const frameBody = Array.from(frameRoot.children).find(
      (element) => element.classList.contains("vf-frame__body"),
    );
    if (!frameBody) throw new Error("static HTML requires a Frame body");
    if (frameBody.querySelector("[data-vf-static-html-root]")) {
      throw new Error("static HTML already has a Frame mount root");
    }

    const response = await fetchOk(resourcePath);
    const rootBoundary = bundleRoot(response.url);
    const prepared = staticDocument(await response.text(), response.url, rootBoundary);
    await preflightStaticGraph(prepared, rootBoundary);

    const root = global.document.createElement("div");
    root.setAttribute("data-vf-static-html-root", "");
    const fragment = global.document.createDocumentFragment();
    for (const node of prepared.parsed.head.querySelectorAll('link[rel~="stylesheet"], style')) {
      fragment.appendChild(global.document.importNode(node, true));
    }
    for (const node of prepared.parsed.body.childNodes) {
      fragment.appendChild(global.document.importNode(node, true));
    }
    root.appendChild(fragment);
    frameBody.appendChild(root);
    try {
      if (!global.VfHtmlComponents || !global.VfHtmlComponents.__internal ||
          typeof global.VfHtmlComponents.__internal.adoptTree !== "function") {
        throw new Error("static HTML retained lookup runtime is unavailable");
      }
      global.VfHtmlComponents.__internal.adoptTree(frameRoot, [root]);
      bindRetainedEvents(root, String(frameRoot.dataset.vfFrameId || ""));
    } catch (error) {
      frameBody.removeChild(root);
      throw error;
    }
    frameBody.classList.remove("vf-frame__body--empty");
  }

  async function frameFor(frameId) {
    for (let attempt = 0; attempt < 240; attempt += 1) {
      const frame = Array.from(global.document.querySelectorAll("[data-vf-frame-id]"))
        .find((candidate) => candidate.dataset.vfFrameId === frameId);
      if (frame) return frame;
      await new Promise((resolve) => global.setTimeout(resolve, 16));
    }
    throw new Error("static HTML target Frame was not retained");
  }

  async function mountManifest(manifestUrl) {
    const mounts = await fetchOk(manifestUrl).then((response) => response.json());
    if (!Array.isArray(mounts)) throw new Error("static HTML mount manifest must be an array");
    for (const mount of mounts) {
      const resource = new global.URL(String(mount.resource), manifestUrl).href;
      await mountFrameHtml(await frameFor(String(mount.frame_id)), resource);
    }
  }

  function boot() {
    const manifest = global.document.body?.dataset.vfStaticHtmlLoads;
    if (!manifest) return;
    mountManifest(new global.URL(manifest, global.document.baseURI).href).catch((error) => {
      global.__vfStaticHtmlLoadError = error;
      global.document.body?.setAttribute("data-vf-static-html-error", "1");
    });
  }

  global.VfStaticHtmlLoader = { mountFrameHtml, mountManifest };
  if (global.document.readyState === "loading") {
    global.document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    global.setTimeout(boot, 0);
  }
})(typeof window !== "undefined" ? window : this);
