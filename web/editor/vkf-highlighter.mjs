const KEYWORDS = new Set(["true", "false"]);
const BUILTINS = new Set(["any", "bit", "chr", "int", "num", "str", "type"]);

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function token(kind, value) {
  return `<span class="vf-token ${kind}">${escapeHtml(value)}</span>`;
}

function identifierKind(source, start, value, end) {
  const lineStart = source.lastIndexOf("\n", start - 1) + 1;
  const before = source.slice(lineStart, start);
  const after = source.slice(end);
  if (/^\s*$/u.test(before) && /^\s*:(?!:)/u.test(after)) return "binding";
  if (KEYWORDS.has(value)) return "keyword";
  if (BUILTINS.has(value)) return "builtin";
  if (/^\s*\(/u.test(after)) return "function";
  if (/^[A-Z]/u.test(value)) return "type";
  return null;
}

export function highlightVkf(source) {
  let html = "";
  let cursor = 0;
  while (cursor < source.length) {
    const rest = source.slice(cursor);
    const comment = /^#[^\n]*/u.exec(rest);
    if (comment) {
      html += token("comment", comment[0]);
      cursor += comment[0].length;
      continue;
    }
    const string = /^(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*")/u.exec(rest);
    if (string) {
      html += token("string", string[0]);
      cursor += string[0].length;
      continue;
    }
    const number = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(rest);
    if (number) {
      html += token("number", number[0]);
      cursor += number[0].length;
      continue;
    }
    const identifier = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(rest);
    if (identifier) {
      const kind = identifierKind(source, cursor, identifier[0], cursor + identifier[0].length);
      html += kind ? token(kind, identifier[0]) : escapeHtml(identifier[0]);
      cursor += identifier[0].length;
      continue;
    }
    const operator = /^(?:::|>>|==|~=|!=|<=|>=|=>|->|\/\/|\.\.|><|\/\\|\\\/|@::|@:|@>|@\||@!|[=<>+\-*/^%&~:$?.|])/u.exec(rest);
    if (operator) {
      html += token("operator", operator[0]);
      cursor += operator[0].length;
      continue;
    }
    const punctuation = /^[;,()[\]{}]/u.exec(rest);
    if (punctuation) {
      html += token("punctuation", punctuation[0]);
      cursor += punctuation[0].length;
      continue;
    }
    html += escapeHtml(source[cursor]);
    cursor += 1;
  }
  return html;
}
