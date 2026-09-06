import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const suffix = process.platform === "win32" ? ".exe" : "";
const nativeBin = resolve(process.env.VKF_NATIVE_BIN ?? join(root, "build/native-windows/bin"));
const compiler = join(nativeBin, `vkf-strict${suffix}`);

test("real parser cursor preserves tagged expression values and spans into typed IR", () => {
  const workRoot = resolve(process.env.VKF_TEST_WORK_ROOT ?? join(root, "build/bootstrap-tests"));
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, "real-parser-cursor-typed-"));
  try {
    for (const name of ["lexer", "parser", "typed_ir"]) {
      copyFileSync(join(root, `compiler/self_hosted/${name}.vkf`), join(work, `${name}.vkf`));
    }
    const source = join(work, "probe.vkf");
    const artifact = join(work, `probe${suffix}`);
    writeFileSync(source, [
      "lexer: .lexer",
      "parser: .parser",
      "typed: .typed_ir",
      'tokens: lexer.bounded_parser_expression_stream("alpha+42")',
      "left: parser.tagged_cursor(tokens.tokens.0)",
      "operator: parser.tagged_advance(left, tokens.tokens.1)",
      "right: parser.tagged_advance(operator, tokens.tokens.2)",
      "parsed: parser.parse_module_from_cursor(left, operator, right)",
      "expression: parsed.module.body.0",
      "typed_expression: typed.typed_tagged_ast_binary_expression(",
      "    expression.left.name, expression.op, expression.right.value,",
      "    expression.span.start.file, expression.span.start.line,",
      "    expression.span.start.column, expression.span.stop.line,",
      "    expression.span.stop.column",
      ")",
      "matches: (parsed.module.kind = \"module\" /\\ expression.left.name = \"alpha\" /\\",
      "    expression.op = \"+\" /\\ expression.right.value = 42 /\\",
      "    expression.span.start.line = 1 /\\ expression.span.start.column = 1 /\\",
      "    expression.span.stop.line = 1 /\\ expression.span.stop.column = 7 /\\",
      "    typed_expression.left.name = \"alpha\" /\\ typed_expression.op = \"+\" /\\",
      "    typed_expression.right.value = 42 /\\",
      "    typed_expression.span.start.column = 1 /\\ typed_expression.span.stop.column = 7)",
      'matches?! "real parser cursor lost tagged AST or typed IR values/spans"',
      ":: typed_expression.right.value",
      "",
    ].join("\n"), "utf8");

    const compiled = spawnSync(compiler, ["-b", source, "-o", artifact, "--optimizer-policy", "mask-0"], {
      cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true,
    });
    assert.equal(compiled.status, 0, compiled.stderr);
    const executed = spawnSync(artifact, [], {
      cwd: work, encoding: "utf8", timeout: 3_000, windowsHide: true,
    });
    assert.equal(executed.status, 0, executed.stderr);
    assert.equal(executed.stdout.trim(), "42");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("real parser cursor preserves a numeric binding into typed IR", () => {
  const workRoot = resolve(process.env.VKF_TEST_WORK_ROOT ?? join(root, "build/bootstrap-tests"));
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, "real-parser-binding-typed-"));
  try {
    for (const name of ["lexer", "parser", "typed_ir"]) {
      copyFileSync(join(root, `compiler/self_hosted/${name}.vkf`), join(work, `${name}.vkf`));
    }
    const source = join(work, "probe.vkf");
    const artifact = join(work, `probe${suffix}`);
    writeFileSync(source, [
      "lexer: .lexer",
      "parser: .parser",
      "typed: .typed_ir",
      'tokens: lexer.bounded_parser_binding_stream("answer:42")',
      "target: parser.tagged_cursor(tokens.tokens.0)",
      "colon: parser.tagged_advance(target, tokens.tokens.1)",
      "value: parser.tagged_advance(colon, tokens.tokens.2)",
      "newline: parser.tagged_advance(value, tokens.tokens.3)",
      "parsed: parser.parse_module_from_cursor(target, colon, value, newline)",
      "binding: parsed.module.body.0",
      "typed_binding: typed.typed_tagged_ast_numeric_binding(",
      "    binding.target.name, binding.value.value, binding.span.start.file,",
      "    binding.span.start.line, binding.span.start.column,",
      "    binding.span.stop.line, binding.span.stop.column",
      ")",
      "matches: (parsed.module.kind = \"module\" /\\ binding.kind = \"bind\" /\\",
      "    binding.target.name = \"answer\" /\\ binding.value.value = 42 /\\",
      "    binding.span.start.line = 1 /\\ binding.span.start.column = 1 /\\",
      "    binding.span.stop.line = 1 /\\ binding.span.stop.column = 8 /\\",
      "    typed_binding.kind = \"store_binding\" /\\ typed_binding.name = \"answer\" /\\",
      "    typed_binding.value.value = 42 /\\ typed_binding.span.start.column = 1 /\\",
      "    typed_binding.span.stop.column = 8)",
      'matches?! "real parser cursor lost binding AST or typed IR values/spans"',
      ":: typed_binding.value.value",
      "",
    ].join("\n"), "utf8");

    const compiled = spawnSync(compiler, ["-b", source, "-o", artifact, "--optimizer-policy", "mask-0"], {
      cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true,
    });
    assert.equal(compiled.status, 0, compiled.stderr);
    const executed = spawnSync(artifact, [], {
      cwd: work, encoding: "utf8", timeout: 3_000, windowsHide: true,
    });
    assert.equal(executed.status, 0, executed.stderr);
    assert.equal(executed.stdout.trim(), "42");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("real parser cursor preserves a typed numeric function declaration and call", () => {
  const workRoot = resolve(process.env.VKF_TEST_WORK_ROOT ?? join(root, "build/bootstrap-tests"));
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, "real-parser-function-typed-"));
  try {
    for (const name of ["lexer", "parser", "typed_ir", "machine_ir"]) {
      copyFileSync(join(root, `compiler/self_hosted/${name}.vkf`), join(work, `${name}.vkf`));
    }
    const source = join(work, "probe.vkf");
    const artifact = join(work, `probe${suffix}`);
    writeFileSync(source, [
      "lexer: .lexer",
      "parser: .parser",
      "typed: .typed_ir",
      "mir: .machine_ir",
      'source: ": .system\\ntwice(value:num):\\n    value * 2\\n:: twice(cpu_count())\\n"',
      "tokens: lexer.tagged_numeric_function_token_tape(source)",
      "cursor: parser.tagged_tape_cursor(tokens.source, tokens.rows, tokens.count)",
      "parsed: parser.parse_module_from_cursor(cursor)",
      "import_statement: parser.tagged_module_statement(parsed, 0)",
      "header_statement: parser.tagged_module_statement(parsed, 1)",
      "body_statement: parser.tagged_module_statement(parsed, 2)",
      "call_statement: parser.tagged_module_statement(parsed, 3)",
      "ast: parser.tagged_cursor_ast(parsed)",
      "ast_import: parser.tagged_cursor_ast_node(ast, 0)",
      "ast_header: parser.tagged_cursor_ast_node(ast, 1)",
      "ast_body: parser.tagged_cursor_ast_node(ast, 2)",
      "ast_call: parser.tagged_cursor_ast_node(ast, 3)",
      "function_block: parser.tagged_cursor_block(ast, 0)",
      "header_payload: parser.tagged_cursor_ast_payload(ast, 1)",
      "body_payload: parser.tagged_cursor_ast_payload(ast, 2)",
      "call_payload: parser.tagged_cursor_ast_payload(ast, 3)",
      "typed_cursor: typed.typed_tagged_cursor_ast_module(",
      "    ast.source, ast.node_rows, ast.node_count,",
      "    ast.block_rows, ast.block_count,",
      "    ast.span.start.file, ast.span.start.line, ast.span.start.column,",
      "    ast.span.stop.line, ast.span.stop.column",
      ")",
      "typed_import: typed.typed_tagged_cursor_node(typed_cursor, 0)",
      "typed_header: typed.typed_tagged_cursor_node(typed_cursor, 1)",
      "typed_body: typed.typed_tagged_cursor_node(typed_cursor, 2)",
      "typed_call: typed.typed_tagged_cursor_node(typed_cursor, 3)",
      "typed_expression: typed.typed_tagged_cursor_numeric_expression(",
      "    body_payload.first_text, body_payload.operator_kind, body_payload.number_value,",
      "    header_payload.second_text, header_payload.third_text,",
      "    body_payload.span.start.file, body_payload.span.start.line,",
      "    body_payload.span.start.column, body_payload.span.stop.line,",
      "    body_payload.span.stop.column",
      ")",
      "typed_module: typed.typed_numeric_parameter_multiply_application(",
      "    header_payload.first_text, header_payload.second_text, body_payload.number_value",
      ")",
      "function: typed_module.body.0",
      "call: typed_module.body.1.expr.args.0",
      "instructions: mir.mir_numeric_parameter_multiply_instructions(body_payload.number_value)",
      "machine: mir.mir_lower_numeric_parameter_multiply_typed_module(typed_module)",
      "module_matches: (parsed.kind = \"module\" /\\ parsed.statement_count = 4 /\\",
      "    parsed.span.start.line = 1 /\\ parsed.span.start.column = 1 /\\",
      "    parsed.span.stop.line = 4 /\\ parsed.span.stop.column = 21)",
      'module_matches?! "real parser cursor lost module order or span"',
      "import_matches: (import_statement.kind = \"import\" /\\ import_statement.order = 0 /\\",
      "    import_statement.depth = 0 /\\ import_statement.parent_order = -1 /\\",
      "    import_statement.token_count = 3 /\\",
      "    import_statement.span.start.line = 1 /\\ import_statement.span.start.column = 1 /\\",
      "    import_statement.span.stop.line = 1 /\\ import_statement.span.stop.column = 4)",
      'import_matches?! "real parser cursor lost import span"',
      "function_statements_match: (header_statement.kind = \"function\" /\\",
      "    header_statement.order = 1 /\\ header_statement.depth = 0 /\\",
      "    header_statement.parent_order = -1 /\\ header_statement.token_count = 7 /\\",
      "    header_statement.span.start.line = 2 /\\ header_statement.span.start.column = 1 /\\",
      "    header_statement.span.stop.line = 2 /\\ header_statement.span.stop.column = 17 /\\",
      "    body_statement.kind = \"expression\" /\\ body_statement.order = 2 /\\",
      "    body_statement.depth = 1 /\\ body_statement.parent_order = 1 /\\",
      "    body_statement.token_count = 3 /\\",
      "    body_statement.span.start.line = 3 /\\ body_statement.span.start.column = 5 /\\",
      "    body_statement.span.stop.line = 3 /\\ body_statement.span.stop.column = 13)",
      'function_statements_match?! "real parser cursor lost function statement spans"',
      "call_matches: (call_statement.kind = \"output\" /\\ call_statement.order = 3 /\\",
      "    call_statement.depth = 0 /\\ call_statement.parent_order = -1 /\\",
      "    call_statement.token_count = 8 /\\",
      "    call_statement.span.start.line = 4 /\\ call_statement.span.start.column = 1 /\\",
      "    call_statement.span.stop.line = 4 /\\ call_statement.span.stop.column = 21)",
      'call_matches?! "real parser cursor lost call span"',
      "ast_matches: (ast.kind = \"module\" /\\ ast.node_count = 4 /\\ ast.block_count = 1 /\\",
      "    ast_import.kind = \"import\" /\\ ast_header.kind = \"function\" /\\",
      "    ast_body.kind = \"expression\" /\\ ast_call.kind = \"output\" /\\",
      "    function_block.owner_order = 1 /\\ function_block.depth = 1 /\\",
      "    function_block.first_child_order = 2 /\\ function_block.child_count = 1 /\\",
      "    function_block.span.start.line = 3 /\\ function_block.span.start.column = 5 /\\",
      "    function_block.span.stop.line = 3 /\\ function_block.span.stop.column = 13)",
      'ast_matches?! "general cursor lost concrete AST nodes or function block"',
      "typed_cursor_matches: (typed_cursor.kind = \"typed_module\" /\\ typed_cursor.node_count = 4 /\\",
      "    typed_import.kind = \"store_binding\" /\\ typed_header.kind = \"function\" /\\",
      "    typed_body.kind = \"expr_stmt\" /\\ typed_call.kind = \"expr_stmt\" /\\",
      "    typed_body.parent_order = 1 /\\ typed_body.span.start.line = 3 /\\",
      "    typed_body.span.start.column = 5 /\\ typed_body.span.stop.column = 13)",
      'typed_cursor_matches?! "general AST lowering lost typed nodes, nesting, or spans"',
      "payload_matches: (header_payload.first_text = \"twice\" /\\",
      "    header_payload.second_text = \"value\" /\\ header_payload.third_text = \"num\" /\\",
      "    header_payload.operator_kind = \"UNKNOWN\" /\\ header_payload.has_number = false /\\",
      "    body_payload.first_text = \"value\" /\\ body_payload.operator_kind = \"STAR\" /\\",
      "    body_payload.has_number /\\ body_payload.number_value = 2 /\\",
      "    call_payload.first_text = \"twice\" /\\",
      "    call_payload.second_text = \"cpu_count\")",
      'payload_matches?! "general AST payload decoding lost token values"',
      "expression_matches: (typed_expression.left.name = \"value\" /\\",
      "    typed_expression.left.type = \"num\" /\\ typed_expression.op = \"STAR\" /\\",
      "    typed_expression.right.value = 2 /\\ typed_expression.type = \"num\" /\\",
      "    typed_expression.span.start.column = 5 /\\ typed_expression.span.stop.column = 13)",
      'expression_matches?! "general expression typing lost payload or span"',
      "mir_matches: (machine.schema = \"vektorflow.machine_ir\" /\\",
      "    instructions.0.kind = \"load_local\" /\\",
      "    instructions.1.kind = \"push_f64\" /\\",
      "    instructions.1.value = body_payload.number_value /\\",
      "    instructions.2.kind = \"multiply_f64\" /\\",
      "    instructions.3.kind = \"return_f64\")",
      'mir_matches?! "decoded AST payload did not feed executable Machine IR"',
      "typed_matches: (function.kind = \"function\" /\\ function.name = \"twice\" /\\",
      "    function.params.0.name = \"value\" /\\ function.params.0.type = \"num\" /\\",
      "    function.body.body.0.expr.op = \"STAR\" /\\",
      "    function.body.body.0.expr.right.value = 2 /\\",
      "    call.kind = \"call\" /\\ call.callee.name = \"twice\" /\\",
      "    call.args.0.callee.name = \"cpu_count\")",
      'typed_matches?! "real parser cursor lost typed function or call"',
      ":: function.body.body.0.expr.right.value",
      "",
    ].join("\n"), "utf8");

    const compiled = spawnSync(compiler, ["-b", source, "-o", artifact, "--optimizer-policy", "mask-0"], {
      cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true,
    });
    assert.equal(compiled.status, 0, compiled.stderr);
    const executed = spawnSync(artifact, [], {
      cwd: work, encoding: "utf8", timeout: 3_000, windowsHide: true,
    });
    assert.equal(executed.status, 0, `${executed.stderr}\n${executed.stdout}`);
    assert.equal(executed.stdout.trim(), "2");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("general typed cursor lowers nested control flow and collection arguments into Machine IR", () => {
  const workRoot = resolve(process.env.VKF_TEST_WORK_ROOT ?? join(root, "build/bootstrap-tests"));
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, "real-parser-expression-dispatch-"));
  try {
    for (const name of ["lexer", "parser", "typed_ir", "machine_ir"]) {
      copyFileSync(join(root, `compiler/self_hosted/${name}.vkf`), join(work, `${name}.vkf`));
    }
    const source = join(work, "probe.vkf");
    const artifact = join(work, `probe${suffix}`);
    writeFileSync(source, [
      "lexer: .lexer",
      "parser: .parser",
      "typed: .typed_ir",
      "mir: .machine_ir",
      'source: ": .system\\ncombine(first:num, second:num, third:[num]):\\n    first > 0?\\n        @: 1\\n    @: 0\\n:: combine(cpu_count(), cpu_count() * 2, [1, cpu_count() * 2, 3])\\n"',
      "tokens: lexer.tagged_numeric_function_token_tape(source)",
      "cursor: parser.tagged_tape_cursor(tokens.source, tokens.rows, tokens.count)",
      "parsed: parser.parse_module_from_cursor(cursor)",
      "ast: parser.tagged_cursor_ast(parsed)",
      "condition_node: parser.tagged_cursor_ast_node(ast, 2)",
      "then_return_node: parser.tagged_cursor_ast_node(ast, 3)",
      "final_return_node: parser.tagged_cursor_ast_node(ast, 4)",
      "block: parser.tagged_cursor_block(ast, 0)",
      "conditional_block: parser.tagged_cursor_block(ast, 1)",
      "payload_rows: parser.tagged_cursor_ast_payload_rows(ast)",
      "typed_module: typed.typed_tagged_cursor_concrete_module(",
      "    ast.source, ast.token_rows, ast.token_count, ast.node_rows, ast.node_count,",
      "    ast.block_rows, ast.block_count,",
      "    payload_rows, ast.span.start.file, ast.span.start.line,",
      "    ast.span.start.column, ast.span.stop.line, ast.span.stop.column",
      ")",
      "body: typed.typed_tagged_function_body_arena(typed_module, 1)",
      "typed_condition: typed.typed_tagged_function_body_node(body, 0)",
      "typed_then_return: typed.typed_tagged_function_body_node(body, 1)",
      "typed_final_return: typed.typed_tagged_function_body_node(body, 2)",
      "typed_output: typed.typed_tagged_cursor_concrete_node(typed_module, 5)",
      "declarations: typed.typed_tagged_declaration_table(typed_module)",
      "function_symbol: typed.typed_tagged_declaration(declarations, 0)",
      "resolved_call: typed.typed_tagged_resolve_output_call(typed_module, declarations, 5)",
      "parameters: typed.typed_tagged_parameter_arena(declarations)",
      "parameter: typed.typed_tagged_parameter(parameters, 0)",
      "second_parameter: typed.typed_tagged_parameter(parameters, 1)",
      "third_parameter: typed.typed_tagged_parameter(parameters, 2)",
      "arguments: typed.typed_tagged_argument_arena(typed_module, resolved_call)",
      "argument: typed.typed_tagged_argument(arguments, 0)",
      "second_argument: typed.typed_tagged_argument(arguments, 1)",
      "third_argument: typed.typed_tagged_argument(arguments, 2)",
      "argument_binary_mir: mir.mir_lower_tagged_scalar_expression(second_argument.expression_kind, second_argument.name, second_argument.op, second_argument.value, second_argument.type)",
      "concrete_machine: mir.mir_assemble_tagged_resolved_module(",
      "    function_symbol.name, [parameter.name, second_parameter.name, third_parameter.name],",
      "    [parameter.type, second_parameter.type, third_parameter.type],",
      "    [typed_condition.expression_kind, typed_then_return.expression_kind, typed_final_return.expression_kind],",
      "    [typed_condition.first_text, typed_then_return.first_text, typed_final_return.first_text],",
      "    [typed_condition.op, typed_then_return.op, typed_final_return.op],",
      "    [typed_condition.value, typed_then_return.value, typed_final_return.value],",
      "    [typed_condition.depth, typed_then_return.depth, typed_final_return.depth], resolved_call.callee,",
      "    [argument.expression_kind, second_argument.expression_kind, third_argument.expression_kind],",
      "    [argument.name, second_argument.name, third_argument.name],",
      "    [argument.op, second_argument.op, third_argument.op],",
      "    [argument.value, second_argument.value, third_argument.value],",
      "    [0, 0, third_argument.values.length()], third_argument.element_kinds, third_argument.element_names, third_argument.element_ops, third_argument.values",
      ")",
      "machine_body_matches: mir.mir_tagged_resolved_module_matches(concrete_machine, function_symbol.name, [parameter.name, second_parameter.name, third_parameter.name], [parameter.type, second_parameter.type, third_parameter.type], arguments.count, true, third_argument.values.length(), true)",
      "ast_matches: (ast.node_count = 6 /\\ ast.block_count = 2 /\\",
      "    block.owner_order = 1 /\\ block.first_child_order = 2 /\\",
      "    block.child_count = 2 /\\ conditional_block.owner_order = 2 /\\",
      "    conditional_block.first_child_order = 3 /\\ conditional_block.child_count = 1 /\\",
      "    condition_node.parent_order = 1 /\\ then_return_node.parent_order = 2 /\\",
      "    final_return_node.parent_order = 1)",
      'ast_matches?! "general parser lost conditional block nesting"',
      "typed_matches: (body.count = 3 /\\ typed_condition.kind = \"if_stmt\" /\\ typed_condition.expression_kind = \"binary_op\" /\\ typed_condition.type = \"bit\" /\\ typed_condition.first_text = \"first\" /\\ typed_condition.op = \"GT\" /\\ typed_condition.value = 0 /\\ typed_condition.depth = 1 /\\ typed_then_return.kind = \"return\" /\\ typed_then_return.expression_kind = \"const\" /\\ typed_then_return.value = 1 /\\ typed_then_return.depth = 2 /\\ typed_then_return.parent_order = 2 /\\ typed_final_return.kind = \"return\" /\\ typed_final_return.value = 0 /\\ typed_final_return.depth = 1 /\\ typed_final_return.parent_order = 1)",
      'typed_matches?! "typed control-flow nodes lost kind, payload, or nesting"',
      "resolution_matches: (function_symbol.arity = 3 /\\ resolved_call.callee = \"combine\" /\\ resolved_call.callee_type = \"fn(num,num,[num])->num\" /\\ resolved_call.argument_count = 3 /\\ resolved_call.span.start.line = 6 /\\ resolved_call.span.stop.column = 65)",
      'resolution_matches?! "control-flow function signature or call resolution failed"',
      "arena_matches: (parameters.count = 3 /\\ parameter.name = \"first\" /\\ second_parameter.name = \"second\" /\\ third_parameter.name = \"third\" /\\ third_parameter.type = \"[num]\" /\\ arguments.count = 3 /\\ argument.expression_kind = \"call\" /\\ second_argument.expression_kind = \"binary_op\" /\\ second_argument.op = \"STAR\" /\\ second_argument.value = 2 /\\ third_argument.expression_kind = \"collection\" /\\ third_argument.type = \"[num]\" /\\ third_argument.values.length() = 3 /\\ third_argument.element_kinds.(0) = \"const\" /\\ third_argument.element_kinds.(1) = \"binary_op\" /\\ third_argument.element_names.(1) = \"cpu_count\" /\\ third_argument.element_ops.(1) = \"STAR\" /\\ third_argument.values.(0) = 1 /\\ third_argument.values.(1) = 2 /\\ third_argument.values.(2) = 3)",
      'arena_matches?! "control-flow tracer lost general parameter or argument arenas"',
      "expression_mir_matches: (argument_binary_mir.instruction_count = 4 /\\ argument_binary_mir.instructions.2.kind = \"multiply_f64\")",
      'expression_mir_matches?! "argument expressions lost scalar Machine IR dispatch"',
      "machine_matches: (concrete_machine.schema = \"vektorflow.machine_ir\" /\\ concrete_machine.version = 4 /\\ concrete_machine.output_kind = \"f64\" /\\ concrete_machine.entry.max_stack = 5 /\\ machine_body_matches)",
      'machine_matches?! "nested conditional did not lower into concrete MachineModule"',
      ":: typed_then_return.value",
      "",
    ].join("\n"), "utf8");

    const compiled = spawnSync(compiler, ["-b", source, "-o", artifact, "--optimizer-policy", "mask-0"], {
      cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true,
    });
    assert.equal(compiled.status, 0, compiled.stderr);
    const executed = spawnSync(artifact, [], {
      cwd: work, encoding: "utf8", timeout: 3_000, windowsHide: true,
    });
    assert.equal(executed.status, 0, `${executed.stderr}\n${executed.stdout}`);
    assert.equal(executed.stdout.trim(), "1");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
