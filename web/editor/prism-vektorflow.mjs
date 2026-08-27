export const TEXTMATE_GRAMMAR_SHA256 = '5f8c3727423ac51c604bd7af5db38d9abed15cc6b0bf003eff2cf6a41f192924';

export function registerVektorFlowPrism(Prism) {
  if (!Prism?.languages) throw new TypeError('Prism.languages is required.');

  const interpolation = {
    pattern: /(^|[^\\])\$\([\s\S]*?\)/,
    lookbehind: true,
    inside: {
      punctuation: /^\$\(|\)$/,
      number: /\b\d+(?:\.\d+)?\b/,
      operator: /:::|::|>>|==|~=|!=|<=|>=|=>|->|\/\/|\.\.|><|\/\\|\\\/|@::|@:|@>|@\||@!|[=<>+\-*/^%&~:$?.|]/,
      function: /\b[a-zA-Z_][a-zA-Z0-9_]*(?=\s*\()/,
      variable: /\b[a-zA-Z_][a-zA-Z0-9_]*\b/,
    },
  };

  Prism.languages.vektorflow = {
    comment: /#.*/,
    'triple-quoted-string': [
      { pattern: /"""[\s\S]*?"""/, greedy: true, alias: 'string' },
      { pattern: /'''[\s\S]*?'''/, greedy: true, alias: 'string' },
    ],
    string: {
      pattern: /"(?:\\.|[^"\\])*"/,
      greedy: true,
      inside: {
        interpolation,
        escape: /\\(?:["\\nrt$]|.)/,
      },
    },
    'line-print-sugar': { pattern: /:::/, alias: 'keyword' },
    module: {
      pattern: /(:)(\.)([a-zA-Z_][a-zA-Z0-9_]*)/,
      inside: {
        punctuation: /^:\./,
        namespace: /[a-zA-Z_][a-zA-Z0-9_]*$/,
      },
    },
    'stdlib-call': {
      pattern: /\b(?:math|stat|random|time|io|collections|errors|system|process|regex|linalg|physics|symbolic)\b\s*\.\s*[a-zA-Z_][a-zA-Z0-9_]*\s*(?=\()/,
      inside: {
        namespace: /^[a-zA-Z_][a-zA-Z0-9_]*/,
        punctuation: /\./,
        function: /[a-zA-Z_][a-zA-Z0-9_]*$/,
      },
    },
    'function-definition': {
      pattern: /^\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\([^\n)]*\)\s*(?:->\s*[^:\n]+)?\s*:(?:\s*(?:#.*)?)?$/m,
      inside: {
        function: /^[\s]*[a-zA-Z_][a-zA-Z0-9_]*/,
        parameter: /\([^)]*\)/,
        operator: /->/,
        punctuation: /[():]/,
      },
    },
    binding: { pattern: /^\s*[a-zA-Z_][a-zA-Z0-9_]*(?=\s*:(?!::))/m, alias: 'variable' },
    boolean: /\b(?:true|false)\??\b/,
    wildcard: { pattern: /\b_\?/, alias: 'keyword' },
    builtin: /\b(?:bit|chr|int|num|str|type|any)\b/,
    number: /\b(?:\d+\.\d+|\d+)\b/,
    operator: /:::|::|>>|==|~=|!=|<=|>=|=>|->|\/\/|\.\.|><|\/\\|\\\/|@::|@:|@>|@\||@!|\(\s*[+\-*/]\s*\)|\{\s*[+\-*/]\s*\}|[=<>+\-*/^%&~:$?.|]/,
    function: /\b[a-zA-Z_][a-zA-Z0-9_]*(?=\s*\()/,
    'class-name': /\b[A-Z][a-zA-Z0-9_]*\b/,
    variable: /\b[a-zA-Z_][a-zA-Z0-9_]*\b/,
    punctuation: /[;,()[\]{}]/,
  };
  Prism.languages.vkf = Prism.languages.vektorflow;
  return Prism.languages.vektorflow;
}
