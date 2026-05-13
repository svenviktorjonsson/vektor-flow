"use strict";

function splitTopLevelComma(text) {
  const parts = [];
  let cur = "";
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if ("([{".includes(ch)) depth += 1;
    else if (")]}".includes(ch) && depth > 0) depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function normalizeParam(param) {
  const p = param.trim();
  if (!p) return null;
  if (p.startsWith("...")) {
    const body = p.slice(3).trim();
    if (body.includes(":")) return `...${body}`;
    return `...${body}:any`;
  }
  if (p.startsWith(":::")) {
    const body = p.slice(3).trim();
    if (body.includes(":")) return `:::${body}`;
    return `:::${body}:any`;
  }
  if (p.includes(":")) return p;
  const eq = p.indexOf("=");
  if (eq >= 0) {
    const left = p.slice(0, eq).trim();
    const right = p.slice(eq);
    if (left.includes(" ")) {
      const bits = left.split(/\s+/);
      if (bits.length === 2) return `${bits[1]}:${bits[0]}${right}`;
    }
    return `${left}:any${right}`;
  }
  const bits = p.split(/\s+/);
  if (bits.length === 2) return `${bits[1]}:${bits[0]}`;
  return `${p}:any`;
}

function normalizeSignature(name, paramsText, returnText) {
  const params = splitTopLevelComma(paramsText)
    .map(normalizeParam)
    .filter(Boolean)
    .join(", ");
  const ret = returnText && returnText.trim() ? returnText.trim() : "any";
  return `${name}(${params}) -> ${ret}`;
}

function parseStringLiteralLine(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  return null;
}

function parseTripleQuotedBlock(lines, startLine, indent) {
  const line = lines[startLine];
  const trimmed = line.trim();
  let marker = null;
  if (trimmed.startsWith('"""')) marker = '"""';
  else if (trimmed.startsWith("'''")) marker = "'''";
  if (!marker) return null;

  const start = trimmed.slice(marker.length);
  const endSame = start.indexOf(marker);
  if (endSame >= 0) {
    return { docstring: start.slice(0, endSame), endLine: startLine };
  }

  const chunks = [start];
  for (let j = startLine + 1; j < lines.length; j += 1) {
    const next = lines[j];
    const nextIndent = next.match(/^\s*/)[0].length;
    if (nextIndent < indent) break;
    const raw = next.slice(indent);
    const close = raw.indexOf(marker);
    if (close >= 0) {
      chunks.push(raw.slice(0, close));
      return { docstring: chunks.join("\n"), endLine: j };
    }
    chunks.push(raw);
  }
  return null;
}

function findLeadingDocstring(lines, headerLine, indent) {
  for (let j = headerLine + 1; j < lines.length; j += 1) {
    const next = lines[j];
    if (!next.trim()) continue;
    const nextIndent = next.match(/^\s*/)[0].length;
    if (nextIndent <= indent) return null;
    const bodyText = next.slice(nextIndent);
    const triple = parseTripleQuotedBlock(lines, j, nextIndent);
    if (triple) return triple.docstring;
    return parseStringLiteralLine(bodyText);
  }
  return null;
}

function parseFunctionSymbols(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  const headerRe = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)\s*(?:->\s*([^:]+))?\s*:\s*(.*)$/;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(headerRe);
    if (!match) continue;

    const indent = match[1].length;
    const name = match[2];
    const paramsText = match[3] || "";
    const returnText = match[4] || "";
    const trailing = (match[5] || "").trim();
    let docstring = null;

    const tripleInline = trailing.startsWith('"""') || trailing.startsWith("'''")
      ? parseTripleQuotedBlock([trailing], 0, 0)
      : null;
    if (tripleInline) {
      docstring = tripleInline.docstring;
    } else {
      docstring = parseStringLiteralLine(trailing);
    }
    if (docstring === null) {
      docstring = findLeadingDocstring(lines, i, indent);
    }

    out.push({
      name,
      signature: normalizeSignature(name, paramsText, returnText),
      docstring,
      line: i,
      startCol: indent,
      endCol: indent + name.length,
    });
  }

  return out;
}

function findFunctionSymbolAt(text, line, character) {
  const symbols = parseFunctionSymbols(text);
  for (const symbol of symbols) {
    if (
      symbol.line === line &&
      character >= symbol.startCol &&
      character <= symbol.endCol
    ) {
      return symbol;
    }
  }
  return null;
}

module.exports = {
  parseFunctionSymbols,
  findFunctionSymbolAt,
};
