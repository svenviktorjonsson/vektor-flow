(function (global) {
  "use strict";

  function staticDocument(text, baseUrl) {
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
    for (const link of parsed.querySelectorAll('link[rel~="stylesheet"]')) {
      const href = String(link.getAttribute("href") || "").trim();
      if (!href || href.startsWith("/") || href.startsWith("#") || href.includes(":")) {
        throw new Error("static HTML stylesheet must be source-relative");
      }
      const resolved = new global.URL(href, baseUrl);
      if (resolved.origin !== new global.URL(baseUrl).origin) {
        throw new Error("static HTML stylesheet must be source-relative");
      }
      link.setAttribute("href", resolved.href);
      stylesheets.push(resolved.href);
    }
    return { parsed, stylesheets };
  }

  async function fetchOk(url) {
    const response = await global.fetch(url);
    if (!response.ok) throw new Error("static HTML resource could not be loaded");
    return response;
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
    const prepared = staticDocument(await response.text(), response.url);
    await Promise.all(prepared.stylesheets.map(fetchOk));

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
