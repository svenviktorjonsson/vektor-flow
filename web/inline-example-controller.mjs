function displayValue(execution) {
  if (execution.packets) return "Program emitted UI output.";
  if (typeof execution.output === "string") return execution.output;
  if (execution.output === undefined) return "Program completed.";
  if (execution.output?.kind === "console" && typeof execution.output.stdout === "string") {
    return execution.output.stdout.replace(/\n$/u, "");
  }
  if (execution.output?.kind === "console" && Array.isArray(execution.output.values)) {
    return execution.output.values.map((value) => JSON.stringify(value)).join("\n");
  }
  return JSON.stringify(execution.output, null, 2);
}

export function createInlineExampleController({ runner, view }) {
  return Object.freeze({
    async run(source) {
      view.start();
      try {
        const execution = await runner.run(source);
        view.showTerminal(displayValue(execution));
        if (execution.packets) view.showResult(execution.packets);
        else view.hideResult();
      } catch (error) {
        view.showTerminal(`${error.message}. No fallback result was rendered.`);
        view.hideResult();
      } finally {
        view.finish();
      }
    },
  });
}
