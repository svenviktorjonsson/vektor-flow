import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitepress";

const vfGrammar = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../vscode/syntaxes/vektorflow.tmLanguage.json"),
    "utf-8"
  )
);
vfGrammar.aliases = ["vkf", "vektorflow"];

export default defineConfig({
  title: "Vektor Flow",
  description: "A compact structural language for math, data, geometry, and UI.",
  cleanUrls: true,
  markdown: {
    languages: [vfGrammar],
    langAlias: {
      vkf: "vektorflow"
    }
  },
  themeConfig: {
    nav: [
      { text: "Welcome", link: "/" },
      { text: "Install", link: "/install" },
      { text: "VS Code", link: "/vscode" },
      { text: "Try Live", link: "/try-live" },
      { text: "Testing", link: "/testing" }
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/svenviktorjonsson/vektor-flow" }
    ]
  }
});
