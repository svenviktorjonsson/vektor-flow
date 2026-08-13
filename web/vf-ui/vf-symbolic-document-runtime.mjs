export function createSymbolicDocumentRuntime({
  compiler,
  segmentDocument,
  definitions = () => ({ global: [], local: {} }),
  normalizeMath = (source) => source
} = {}) {
  requireCompilerMethod(compiler, 'setDefinitions');
  if (typeof segmentDocument !== 'function') {
    throw new TypeError('Symbolic Document Runtime requires a segmentDocument adapter.');
  }

  return Object.freeze({
    compile(source, {
      scopeId = null,
      context,
      preview = false,
      validateLatex = () => false,
      compileMath = null
    } = {}) {
      if (!compileMath) {
        requireCompilerMethod(compiler, preview ? 'previewScoped' : 'compileScoped');
      }
      const plan = definitions(scopeId) || {};
      const local = { ...(plan.local || {}) };
      const active = [...(local[scopeId] || [])];
      const allDefinitions = () => [...(plan.global || []), ...active];
      const publish = () => compiler.setDefinitions({
        global: [...(plan.global || [])],
        local: { ...local, ...(scopeId ? { [scopeId]: [...active] } : {}) }
      });
      publish();
      return segmentDocument(String(source ?? ''), {
        preview,
        validateLatex,
        isImplicitProductIdentifier(identifier) {
          return normalizeMath(identifier, allDefinitions()) !== identifier;
        },
        compileMath(mathSource) {
          const symbolicSource = normalizeMath(mathSource, allDefinitions());
          const result = compileMath
            ? compileMath(symbolicSource, { compiler, context, preview, scopeId })
            : preview
              ? compiler.previewScoped(symbolicSource, { scopeId })
              : compiler.compileScoped(symbolicSource, { scopeId, context });
          if (result?.classification === 'definition') {
            active.push(mathSource);
            publish();
          }
          return result;
        }
      });
    }
  });
}

function requireCompilerMethod(compiler, method) {
  if (typeof compiler?.[method] !== 'function') {
    throw new TypeError(`Symbolic Document Runtime compiler must provide ${method}.`);
  }
}
