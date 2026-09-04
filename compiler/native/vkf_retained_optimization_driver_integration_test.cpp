#include "compiler/native/vkf_machine_ir.hpp"
#include "compiler/native/vkf_x64_backend.hpp"
#include "native/VfOverlay/vf/json.hpp"

#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <string>

namespace {

int failures = 0;

void expect(bool condition, const std::string& message) {
    if (condition) return;
    std::cerr << message << '\n';
    ++failures;
}

std::string read_text(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    return {
        std::istreambuf_iterator<char>(input),
        std::istreambuf_iterator<char>(),
    };
}

const vf::JsonValue& member(
    const vf::JsonValue& value,
    const std::string& name
) {
    return value.as_object().at(name);
}

void append_integer_loop(
    vkf::machine_ir::Function& function,
    double result
) {
    function.max_stack = 2;
    function.result_is_numeric_scalar = true;
    function.locals = {"counter"};
    function.local_classes = {vkf::machine_ir::ValueClass::I64};
    vkf::machine_ir::Instruction instruction;
    instruction.opcode = vkf::machine_ir::Opcode::PushF64;
    instruction.f64 = 0.0;
    function.instructions.push_back(instruction);
    instruction.opcode = vkf::machine_ir::Opcode::StoreLocal;
    instruction.index = 0;
    function.instructions.push_back(instruction);
    instruction.opcode = vkf::machine_ir::Opcode::Label;
    instruction.label = 1;
    function.instructions.push_back(instruction);
    instruction.opcode = vkf::machine_ir::Opcode::LoadLocal;
    function.instructions.push_back(instruction);
    instruction.opcode = vkf::machine_ir::Opcode::PushF64;
    instruction.f64 = 10000.0;
    function.instructions.push_back(instruction);
    instruction.opcode = vkf::machine_ir::Opcode::OrderedLessF64;
    function.instructions.push_back(instruction);
    instruction.opcode = vkf::machine_ir::Opcode::JumpIfFalse;
    instruction.label = 2;
    function.instructions.push_back(instruction);
    instruction.opcode = vkf::machine_ir::Opcode::LoadLocal;
    instruction.index = 0;
    function.instructions.push_back(instruction);
    instruction.opcode = vkf::machine_ir::Opcode::PushF64;
    instruction.f64 = 1.0;
    function.instructions.push_back(instruction);
    instruction.opcode = vkf::machine_ir::Opcode::AddF64;
    function.instructions.push_back(instruction);
    instruction.opcode = vkf::machine_ir::Opcode::StoreLocal;
    function.instructions.push_back(instruction);
    instruction.opcode = vkf::machine_ir::Opcode::Jump;
    instruction.label = 1;
    function.instructions.push_back(instruction);
    instruction.opcode = vkf::machine_ir::Opcode::Label;
    instruction.label = 2;
    function.instructions.push_back(instruction);
    instruction.opcode = vkf::machine_ir::Opcode::PushF64;
    instruction.f64 = result;
    function.instructions.push_back(instruction);
    instruction.opcode = vkf::machine_ir::Opcode::ReturnF64;
    function.instructions.push_back(instruction);
}

vkf::machine_ir::Module parameterized_call_module() {
    vkf::machine_ir::Instruction instruction;
    instruction.opcode = vkf::machine_ir::Opcode::PushF64;
    instruction.f64 = 21.0;
    vkf::machine_ir::Function entry;
    entry.name = "entry";
    entry.max_stack = 1;
    entry.result_is_numeric_scalar = true;
    entry.instructions.push_back(instruction);
    instruction.opcode = vkf::machine_ir::Opcode::Call;
    instruction.symbol = "twice";
    instruction.argument_count = 1;
    instruction.result_count = 1;
    instruction.provided_parameter_mask = 1;
    entry.instructions.push_back(instruction);
    instruction.opcode = vkf::machine_ir::Opcode::ReturnF64;
    entry.instructions.push_back(instruction);

    vkf::machine_ir::Function twice;
    twice.name = "twice";
    twice.parameters = {"value"};
    twice.parameter_is_numeric_scalar = {true};
    twice.locals = {"value"};
    twice.local_classes = {vkf::machine_ir::ValueClass::F64};
    twice.max_stack = 2;
    twice.result_is_numeric_scalar = true;
    instruction = {};
    instruction.opcode = vkf::machine_ir::Opcode::LoadLocal;
    instruction.index = 0;
    twice.instructions.push_back(instruction);
    instruction.opcode = vkf::machine_ir::Opcode::PushF64;
    instruction.f64 = 2.0;
    twice.instructions.push_back(instruction);
    instruction.opcode = vkf::machine_ir::Opcode::MultiplyF64;
    twice.instructions.push_back(instruction);
    instruction.opcode = vkf::machine_ir::Opcode::ReturnF64;
    twice.instructions.push_back(instruction);

    vkf::machine_ir::Module module;
    module.entry = std::move(entry);
    module.functions = {std::move(twice)};
    module.output_kind = vkf::machine_ir::OutputKind::F64;
    module.output_count = 1;
    return module;
}

vkf::machine_ir::Module zero_argument_pure_call_module() {
    vkf::machine_ir::Instruction instruction;
    instruction.opcode = vkf::machine_ir::Opcode::Call;
    instruction.symbol = "answer";
    instruction.result_count = 1;
    vkf::machine_ir::Function entry;
    entry.name = "entry";
    entry.max_stack = 1;
    entry.result_is_numeric_scalar = true;
    entry.instructions.push_back(instruction);
    instruction = {};
    instruction.opcode = vkf::machine_ir::Opcode::ReturnF64;
    entry.instructions.push_back(instruction);

    vkf::machine_ir::Function answer;
    answer.name = "answer";
    append_integer_loop(answer, 42.0);

    vkf::machine_ir::Module module;
    module.entry = std::move(entry);
    module.functions = {std::move(answer)};
    module.output_kind = vkf::machine_ir::OutputKind::F64;
    module.output_count = 1;
    return module;
}

void append_calling_loop(
    vkf::machine_ir::Function& function,
    double result
) {
    append_integer_loop(function, result);
    function.parameters = {"root_value"};
    function.parameter_is_numeric_scalar = {true};
    function.locals.insert(function.locals.begin(), "root_value");
    function.local_classes.insert(
        function.local_classes.begin(), vkf::machine_ir::ValueClass::F64
    );
    for (auto& instruction : function.instructions) {
        if (instruction.opcode == vkf::machine_ir::Opcode::LoadLocal ||
            instruction.opcode == vkf::machine_ir::Opcode::StoreLocal) {
            ++instruction.index;
        }
    }
    function.instructions[function.instructions.size() - 2].opcode =
        vkf::machine_ir::Opcode::LoadLocal;
    function.instructions[function.instructions.size() - 2].index = 0;
    function.instructions[4].f64 = 1048576.0;
    vkf::machine_ir::Instruction argument;
    argument.opcode = vkf::machine_ir::Opcode::PushF64;
    argument.f64 = result / 2.0;
    vkf::machine_ir::Instruction call;
    call.opcode = vkf::machine_ir::Opcode::Call;
    call.symbol = "shared";
    call.argument_count = 1;
    call.result_count = 1;
    call.provided_parameter_mask = 1;
    vkf::machine_ir::Instruction drop;
    drop.opcode = vkf::machine_ir::Opcode::Drop;
    function.instructions.insert(function.instructions.begin() + 7, argument);
    function.instructions.insert(function.instructions.begin() + 8, call);
    function.instructions.insert(function.instructions.begin() + 9, drop);
}

vkf::machine_ir::Module independent_multi_result_graph() {
    vkf::machine_ir::Function left;
    left.name = "left";
    append_calling_loop(left, 42.0);
    vkf::machine_ir::Function right;
    right.name = "right";
    append_calling_loop(right, 43.0);
    vkf::machine_ir::Function shared;
    shared.name = "shared";
    shared.parameters = {"value"};
    shared.parameter_is_numeric_scalar = {true};
    shared.locals = {"value"};
    shared.local_classes = {vkf::machine_ir::ValueClass::F64};
    shared.max_stack = 1;
    shared.result_is_numeric_scalar = true;
    vkf::machine_ir::Instruction instruction;
    instruction.opcode = vkf::machine_ir::Opcode::LoadLocal;
    instruction.index = 0;
    shared.instructions.push_back(instruction);
    instruction = {};
    instruction.opcode = vkf::machine_ir::Opcode::ReturnF64;
    shared.instructions.push_back(instruction);

    vkf::machine_ir::Function entry;
    entry.name = "entry";
    entry.max_stack = 4;
    entry.locals = {"left", "right"};
    entry.local_classes = {
        vkf::machine_ir::ValueClass::F64,
        vkf::machine_ir::ValueClass::F64,
    };
    auto call = [&](const std::string& symbol) {
        vkf::machine_ir::Instruction value;
        value.opcode = vkf::machine_ir::Opcode::Call;
        value.symbol = symbol;
        value.argument_count = 1;
        value.result_count = 1;
        value.provided_parameter_mask = 1;
        return value;
    };
    auto literal = [](double number) {
        vkf::machine_ir::Instruction value;
        value.opcode = vkf::machine_ir::Opcode::PushF64;
        value.f64 = number;
        return value;
    };
    auto local = [](vkf::machine_ir::Opcode opcode, std::uint32_t index) {
        vkf::machine_ir::Instruction value;
        value.opcode = opcode;
        value.index = index;
        return value;
    };
    vkf::machine_ir::Instruction finish;
    finish.opcode = vkf::machine_ir::Opcode::ReturnValues;
    finish.result_count = 2;
    entry.instructions = {
        literal(42.0),
        call("left"),
        local(vkf::machine_ir::Opcode::StoreLocal, 0),
        literal(43.0),
        call("right"),
        local(vkf::machine_ir::Opcode::StoreLocal, 1),
        local(vkf::machine_ir::Opcode::LoadLocal, 0),
        local(vkf::machine_ir::Opcode::LoadLocal, 1),
        finish,
    };

    vkf::machine_ir::Module module;
    module.entry = std::move(entry);
    module.functions = {
        std::move(left), std::move(right), std::move(shared),
    };
    module.output_kind = vkf::machine_ir::OutputKind::MultipleF64;
    module.output_count = 2;
    module.outputs = {
        vkf::machine_ir::OutputKind::F64,
        vkf::machine_ir::OutputKind::F64,
    };
    return module;
}

vkf::machine_ir::Module fallible_multi_result_graph(
    bool left_succeeds,
    bool right_succeeds,
    double left_bound = 1048576.0,
    double right_bound = 1048576.0
) {
    auto module = independent_multi_result_graph();
    module.functions[0].instructions[4].f64 = left_bound;
    module.functions[1].instructions[4].f64 = right_bound;
    module.string_data.assign(
        {'l','e','f','t',' ','f','a','i','l','u','r','e',
         'r','i','g','h','t',' ','f','a','i','l','u','r','e'}
    );
    const auto make_fallible = [](
        vkf::machine_ir::Function& function,
        bool succeeds,
        std::uint32_t message_offset,
        std::uint32_t message_size
    ) {
        function.may_error = true;
        vkf::machine_ir::Instruction condition;
        condition.opcode = vkf::machine_ir::Opcode::PushF64;
        condition.f64 = succeeds ? 1.0 : 0.0;
        vkf::machine_ir::Instruction assertion;
        assertion.opcode = vkf::machine_ir::Opcode::AssertTruthy;
        assertion.index = message_offset;
        assertion.byte_count = message_size;
        vkf::machine_ir::Instruction drop;
        drop.opcode = vkf::machine_ir::Opcode::Drop;
        function.instructions.insert(
            function.instructions.end() - 2,
            {condition, assertion, drop}
        );
    };
    make_fallible(module.functions[0], left_succeeds, 0, 12);
    make_fallible(module.functions[1], right_succeeds, 12, 13);
    module.entry.may_error = true;
    module.entry.max_stack = 10;
    module.entry.instructions[1].may_error = true;
    module.entry.instructions[4].may_error = true;
    return module;
}

vkf::machine_ir::Module fixed_reduction_multi_result_graph() {
    auto module = independent_multi_result_graph();
    vkf::machine_ir::Instruction positive_scale;
    positive_scale.opcode = vkf::machine_ir::Opcode::PushF64;
    positive_scale.f64 = 1.0e16;
    auto negative_scale = positive_scale;
    negative_scale.f64 = -1.0e16;
    vkf::machine_ir::Instruction source_order_sum;
    source_order_sum.opcode = vkf::machine_ir::Opcode::SumF64Values;
    source_order_sum.argument_count = 3;
    for (std::size_t index = 0; index < 2; ++index) {
        auto& root = module.functions[index];
        root.max_stack = 3;
        root.instructions.insert(
            root.instructions.end() - 2,
            {positive_scale, negative_scale}
        );
        root.instructions.insert(
            root.instructions.end() - 1,
            source_order_sum
        );
    }
    return module;
}

}  // namespace

int main() {
    const auto unique = std::to_string(
        std::chrono::steady_clock::now().time_since_epoch().count()
    );
    const auto root = std::filesystem::temp_directory_path() /
        ("vkf-qopt04-integration-" + unique);
    std::filesystem::create_directories(root);
    const auto source = root / "answer.vkf";
    const auto typed_ir_path = root / "answer.typed.json";
#ifdef _WIN32
    const auto artifact = root / "answer.exe";
#else
    const auto artifact = root / "answer.native";
#endif
    {
        std::ofstream output(source);
        output << "40 + 2 ::\n";
    }

    vf::JsonValue::Object typed_module;
    typed_module["schema"] = "private-qopt04-test";
    const vf::JsonValue typed_ir(std::move(typed_module));

    vkf::machine_ir::Module machine;
    machine.output_kind = vkf::machine_ir::OutputKind::F64;
    machine.output_count = 1;
    machine.entry.name = "entry";
    append_integer_loop(machine.entry, 42.0);
    vkf::machine_ir::Function independent;
    independent.name = "independent";
    append_integer_loop(independent, 7.0);
    machine.functions.push_back(std::move(independent));

    const auto compiled = vkf_x64_backend::compile(
        typed_ir,
        source,
        typed_ir_path,
        {},
        true,
        artifact,
        "source-graph-v1",
        "auto",
        32,
        2000.0,
        0,
        &machine
    );
    const auto manifest = vf::parse_json(read_text(compiled.manifest_path));
    const auto& tuning = member(manifest, "empirical_tuning");
    const auto& candidates = member(tuning, "candidates").as_array();
    expect(candidates.size() == 4,
           "real auto compilation must measure two candidates for each independent leaf");
    expect(member(candidates[0], "policy").as_string() == "mask-0" &&
               member(candidates[1], "policy").as_string() == "mask-fc" &&
               member(candidates[2], "policy").as_string() == "mask-0" &&
               member(candidates[3], "policy").as_string() == "mask-fc",
           "each leaf must report baseline before its ABI-neutral guided candidate");
    bool exact_candidates = true;
    for (const auto& candidate : candidates) {
        exact_candidates = exact_candidates &&
            member(candidate, "tested").as_boolean() &&
            member(candidate, "correct").as_boolean();
    }
    expect(exact_candidates,
           "every real per-function candidate must be measured and preserve exact output parity");

    machine.functions[0].instructions[13].f64 = 8.0;
    const auto incrementally_compiled = vkf_x64_backend::compile(
        typed_ir,
        source,
        typed_ir_path,
        {},
        true,
        artifact,
        "source-graph-v2",
        "auto",
        32,
        2000.0,
        0,
        &machine
    );
    const auto incremental_manifest = vf::parse_json(
        read_text(incrementally_compiled.manifest_path)
    );
    const auto& incremental_candidates = member(
        member(incremental_manifest, "empirical_tuning"), "candidates"
    ).as_array();
    expect(incremental_candidates.size() == 2 &&
               member(incremental_candidates[0], "policy").as_string() ==
                   "mask-0" &&
               member(incremental_candidates[1], "policy").as_string() ==
                   "mask-fc",
           "surrounding code changes must reuse the unchanged entry proof and measure only the changed leaf");

    const auto stdout_path = root / "answer.stdout";
    const std::string command =
#ifdef _WIN32
        "\"\"" + compiled.artifact_path.string() + "\" > \"" +
            stdout_path.string() + "\"\"";
#else
        "\"" + compiled.artifact_path.string() + "\" > \"" +
            stdout_path.string() + "\"";
#endif
    const int run_status = std::system(command.c_str());
    const std::string expected_stdout =
#ifdef _WIN32
        "42\r\n";
#else
        "42\n";
#endif
    expect(run_status == 0 && read_text(stdout_path) == expected_stdout,
           "the selected real artifact must execute with the exact expected result");

    auto call_graph = parameterized_call_module();
    const auto call_artifact = root /
#ifdef _WIN32
        "call.exe";
#else
        "call.native";
#endif
    const auto call_compiled = vkf_x64_backend::compile(
        typed_ir,
        source,
        typed_ir_path,
        {},
        true,
        call_artifact,
        "parameterized-call-graph-v1",
        "auto",
        32,
        2000.0,
        0,
        &call_graph
    );
    const auto call_manifest = vf::parse_json(
        read_text(call_compiled.manifest_path)
    );
    const auto& call_candidates = member(
        member(call_manifest, "empirical_tuning"), "candidates"
    ).as_array();
    expect(call_candidates.size() == 2 &&
               member(call_candidates[0], "policy").as_string() == "mask-0" &&
               member(call_candidates[1], "policy").as_string() == "mask-ff",
           "a parameterized call graph must stay on the serial whole-entry two-candidate proof path");

    const auto call_stdout_path = root / "call.stdout";
    const std::string call_command =
#ifdef _WIN32
        "\"\"" + call_compiled.artifact_path.string() + "\" > \"" +
            call_stdout_path.string() + "\"\"";
#else
        "\"" + call_compiled.artifact_path.string() + "\" > \"" +
            call_stdout_path.string() + "\"";
#endif
    const int call_run_status = std::system(call_command.c_str());
    expect(call_run_status == 0 &&
               read_text(call_stdout_path) == expected_stdout,
           "the serial call-graph artifact must retain exact output");

    auto pure_call_graph = zero_argument_pure_call_module();
    const auto pure_call_artifact = root /
#ifdef _WIN32
        "pure-call.exe";
#else
        "pure-call.native";
#endif
    const auto pure_call_compiled = vkf_x64_backend::compile(
        typed_ir,
        source,
        typed_ir_path,
        {},
        true,
        pure_call_artifact,
        "zero-argument-pure-call-graph-v1",
        "auto",
        32,
        2000.0,
        0,
        &pure_call_graph
    );
    const auto pure_call_manifest = vf::parse_json(
        read_text(pure_call_compiled.manifest_path)
    );
    const auto& pure_call_candidates = member(
        member(pure_call_manifest, "empirical_tuning"), "candidates"
    ).as_array();
    expect(pure_call_candidates.size() == 2 &&
               member(pure_call_candidates[0], "policy").as_string() ==
                   "mask-0" &&
               member(pure_call_candidates[1], "policy").as_string() ==
                   "mask-ff" &&
               member(pure_call_candidates[0], "correct").as_boolean() &&
               member(pure_call_candidates[1], "correct").as_boolean(),
           "a pure resolved call graph miss must measure only baseline plus one guided bit-exact candidate");
    const auto pure_call_stdout_path = root / "pure-call.stdout";
    const std::string pure_call_command =
#ifdef _WIN32
        "\"\"" + pure_call_compiled.artifact_path.string() + "\" > \"" +
            pure_call_stdout_path.string() + "\"\"";
#else
        "\"" + pure_call_compiled.artifact_path.string() + "\" > \"" +
            pure_call_stdout_path.string() + "\"";
#endif
    const int pure_call_run_status = std::system(pure_call_command.c_str());
    expect(pure_call_run_status == 0 &&
               read_text(pure_call_stdout_path) == expected_stdout,
           "the selected pure call-graph artifact must preserve exact output");

    auto pair_graph = independent_multi_result_graph();
    const auto pair_source = root / "pair.vkf";
    const auto pair_typed_ir_path = root / "pair.typed.json";
    {
        std::ofstream output(pair_source);
        output << "42 ::\n43 ::\n";
    }
    const auto pair_artifact = root /
#ifdef _WIN32
        "pair.exe";
#else
        "pair.native";
#endif
    const auto pair_compiled = vkf_x64_backend::compile(
        typed_ir, pair_source, pair_typed_ir_path, {}, true, pair_artifact,
        "independent-multi-result-graph-v1", "auto", 10, 20000.0, 0,
        &pair_graph
    );
    const auto pair_manifest = vf::parse_json(
        read_text(pair_compiled.manifest_path)
    );
    const auto& pair_tuning = member(pair_manifest, "empirical_tuning");
    const auto& pair_candidates = member(pair_tuning, "candidates").as_array();
    expect(pair_candidates.size() == 2 &&
               member(pair_candidates[0], "policy").as_string() ==
                   "serial-mask-0" &&
               member(pair_candidates[1], "policy").as_string() ==
                   "threaded-scalar" &&
               member(pair_candidates[0], "tested").as_boolean() &&
               member(pair_candidates[1], "tested").as_boolean() &&
               member(pair_candidates[0], "correct").as_boolean() &&
               member(pair_candidates[1], "correct").as_boolean() &&
               member(pair_tuning, "total_runs").as_number() <= 10.0,
           "literal scalar arguments to independent read-only roots must benchmark one threaded candidate against the serial baseline");
    if (pair_candidates.size() != 2u) {
        std::filesystem::remove_all(root);
        return 1;
    }
    const auto pair_selected_policy =
        member(pair_tuning, "selected_policy").as_string();

    const auto reused_pair = vkf_x64_backend::compile(
        typed_ir, pair_source, pair_typed_ir_path, {}, true, pair_artifact,
        "independent-multi-result-graph-v2", "auto", 10, 20000.0, 0,
        &pair_graph
    );
    const auto reused_pair_manifest = vf::parse_json(
        read_text(reused_pair.manifest_path)
    );
    const auto& reused_pair_tuning = member(
        reused_pair_manifest, "empirical_tuning"
    );
    expect(member(reused_pair_tuning, "candidates").as_array().empty() &&
               member(reused_pair_tuning, "selected_policy").as_string() ==
                   pair_selected_policy &&
               reused_pair.machine_code_fingerprint ==
                   pair_compiled.machine_code_fingerprint,
           "a surrounding program change must reuse the exact unchanged graph proof without remeasurement: candidates=" +
               std::to_string(member(
                   reused_pair_tuning, "candidates"
               ).as_array().size()) + " cache_hit=" +
               std::to_string(member(
                   reused_pair_tuning, "cache_hit"
               ).as_boolean()) + " first_runs=" +
               std::to_string(member(
                   pair_candidates[0], "runs"
               ).as_number()) + " selected=" + pair_selected_policy);

    vkf::machine_ir::Instruction dependency_delta;
    dependency_delta.opcode = vkf::machine_ir::Opcode::PushF64;
    dependency_delta.f64 = 2.0;
    vkf::machine_ir::Instruction dependency_add;
    dependency_add.opcode = vkf::machine_ir::Opcode::AddF64;
    pair_graph.functions[2].instructions.insert(
        pair_graph.functions[2].instructions.begin() + 1,
        dependency_delta
    );
    pair_graph.functions[2].instructions.insert(
        pair_graph.functions[2].instructions.begin() + 2,
        dependency_add
    );
    const auto changed_pair = vkf_x64_backend::compile(
        typed_ir, pair_source, pair_typed_ir_path, {}, true, pair_artifact,
        "independent-multi-result-graph-v3", "auto", 10, 20000.0, 0,
        &pair_graph
    );
    const auto changed_pair_manifest = vf::parse_json(
        read_text(changed_pair.manifest_path)
    );
    const auto& changed_pair_candidates = member(
        member(changed_pair_manifest, "empirical_tuning"), "candidates"
    ).as_array();
    expect(changed_pair_candidates.size() == 2,
           "a changed transitive dependency fingerprint must invalidate the pair proof and remeasure exactly two candidates");
    const auto pair_stdout_path = root / "pair.stdout";
    const std::string pair_command =
#ifdef _WIN32
        "\"\"" + pair_compiled.artifact_path.string() + "\" > \"" +
            pair_stdout_path.string() + "\"\"";
#else
        "\"" + pair_compiled.artifact_path.string() + "\" > \"" +
            pair_stdout_path.string() + "\"";
#endif
    const int pair_run_status = std::system(pair_command.c_str());
    const std::string expected_pair_stdout =
#ifdef _WIN32
        "42\r\n43\r\n";
#else
        "42\n43\n";
#endif
    expect(pair_run_status == 0 &&
               read_text(pair_stdout_path) == expected_pair_stdout,
           "the measured multi-result artifact must preserve both exact results in source order");

    auto reduction_graph = fixed_reduction_multi_result_graph();
    const auto reduction_source = root / "fixed-reduction.vkf";
    const auto reduction_ir = root / "fixed-reduction.typed.json";
    {
        std::ofstream output(reduction_source);
        output << "fixed source-order reduction proof\n";
    }
    const auto reduction_artifact = root /
#ifdef _WIN32
        "fixed-reduction.exe";
#else
        "fixed-reduction.native";
#endif
    const auto reduction_compiled = vkf_x64_backend::compile(
        typed_ir, reduction_source, reduction_ir, {}, true,
        reduction_artifact, "fixed-reduction-pair-v1", "auto", 10,
        20000.0, 0, &reduction_graph
    );
    const auto reduction_manifest = vf::parse_json(
        read_text(reduction_compiled.manifest_path)
    );
    const auto& reduction_tuning = member(
        reduction_manifest, "empirical_tuning"
    );
    const auto& reduction_candidates = member(
        reduction_tuning, "candidates"
    ).as_array();
    const auto reduction_selected = member(
        reduction_tuning, "selected_policy"
    ).as_string();
    expect(reduction_candidates.size() == 2 &&
               member(reduction_candidates[0], "correct").as_boolean() &&
               member(reduction_candidates[1], "correct").as_boolean() &&
               member(reduction_tuning, "total_runs").as_number() <= 10.0,
           "a fixed source-order reduction must prove bit-exact serial/threaded parity with two bounded candidates");
    if (reduction_candidates.size() != 2u) {
        std::filesystem::remove_all(root);
        return 1;
    }
    const auto reused_reduction = vkf_x64_backend::compile(
        typed_ir, reduction_source, reduction_ir, {}, true,
        reduction_artifact, "fixed-reduction-pair-v2", "auto", 10,
        20000.0, 0, &reduction_graph
    );
    const auto reused_reduction_manifest = vf::parse_json(
        read_text(reused_reduction.manifest_path)
    );
    const auto& reused_reduction_tuning = member(
        reused_reduction_manifest, "empirical_tuning"
    );
    expect(member(reused_reduction_tuning, "candidates").as_array().empty() &&
               member(reused_reduction_tuning, "selected_policy").as_string() ==
                   reduction_selected &&
               reused_reduction.machine_code_fingerprint ==
                   reduction_compiled.machine_code_fingerprint,
           "an unchanged fixed reduction tree must reuse its proof across a surrounding source change");
    reduction_graph.functions[0].instructions[
        reduction_graph.functions[0].instructions.size() - 5
    ].f64 = -1.0e16;
    reduction_graph.functions[0].instructions[
        reduction_graph.functions[0].instructions.size() - 4
    ].f64 = 1.0e16;
    const auto changed_reduction = vkf_x64_backend::compile(
        typed_ir, reduction_source, reduction_ir, {}, true,
        reduction_artifact, "fixed-reduction-pair-v3", "auto", 10,
        20000.0, 0, &reduction_graph
    );
    const auto changed_reduction_manifest = vf::parse_json(
        read_text(changed_reduction.manifest_path)
    );
    const auto& changed_reduction_candidates = member(
        member(changed_reduction_manifest, "empirical_tuning"), "candidates"
    ).as_array();
    expect(changed_reduction_candidates.size() == 2,
           "a changed reduction operand order must invalidate retained proof and remeasure exactly two candidates");
    const auto reduction_stdout = root / "fixed-reduction.stdout";
    const std::string reduction_command =
#ifdef _WIN32
        "\"\"" + reduction_compiled.artifact_path.string() + "\" > \"" +
            reduction_stdout.string() + "\"\"";
#else
        "\"" + reduction_compiled.artifact_path.string() + "\" > \"" +
            reduction_stdout.string() + "\"";
#endif
    const int reduction_status = std::system(reduction_command.c_str());
    expect(reduction_status == 0 &&
               read_text(reduction_stdout) == expected_pair_stdout,
           "the production reduction artifact must preserve the adversarial source-order IEEE result");

    auto right_error_graph = fallible_multi_result_graph(true, false);
    const auto right_error_source = root / "right-error.vkf";
    const auto right_error_ir = root / "right-error.typed.json";
    {
        std::ofstream output(right_error_source);
        output << "right error proof\n";
    }
    const auto right_error_artifact = root /
#ifdef _WIN32
        "right-error.exe";
#else
        "right-error.native";
#endif
    const auto right_error_compiled = vkf_x64_backend::compile(
        typed_ir, right_error_source, right_error_ir, {}, true,
        right_error_artifact, "right-error-pair-v1", "auto", 10, 20000.0,
        0, &right_error_graph
    );
    const auto right_error_manifest = vf::parse_json(
        read_text(right_error_compiled.manifest_path)
    );
    const auto& right_error_tuning = member(
        right_error_manifest, "empirical_tuning"
    );
    const auto& right_error_candidates = member(
        right_error_tuning, "candidates"
    ).as_array();
    const auto right_error_selected = member(
        right_error_tuning, "selected_policy"
    ).as_string();
    expect(right_error_candidates.size() == 2 &&
               member(right_error_candidates[0], "correct").as_boolean() &&
               member(right_error_candidates[1], "correct").as_boolean(),
           "a right-root error must retain exact serial/threaded error parity with two bounded candidates");
    const auto reused_right_error = vkf_x64_backend::compile(
        typed_ir, right_error_source, right_error_ir, {}, true,
        right_error_artifact, "right-error-pair-v2", "auto", 10, 20000.0,
        0, &right_error_graph
    );
    const auto reused_right_error_manifest = vf::parse_json(
        read_text(reused_right_error.manifest_path)
    );
    const auto& reused_right_error_tuning = member(
        reused_right_error_manifest, "empirical_tuning"
    );
    expect(member(reused_right_error_tuning, "candidates").as_array().empty() &&
               member(reused_right_error_tuning, "selected_policy").as_string() ==
                   right_error_selected,
           "an unchanged fallible pair must reuse its retained exact-error proof across a surrounding source change");
    const auto right_error_stdout = root / "right-error.stdout";
    const std::string right_error_command =
#ifdef _WIN32
        "\"\"" + right_error_compiled.artifact_path.string() + "\" > \"" +
            right_error_stdout.string() + "\" 2>&1\"";
#else
        "\"" + right_error_compiled.artifact_path.string() + "\" > \"" +
            right_error_stdout.string() + "\" 2>&1";
#endif
    const int right_error_status = std::system(right_error_command.c_str());
    expect(right_error_status != 0 && read_text(right_error_stdout).empty(),
           "a fallible artifact must return no partial results and must not fall back to serial output");

    auto cancellation_graph = fallible_multi_result_graph(
        false, true, 1048576.0, 100000000.0
    );
    const auto cancellation_source = root / "cooperative-cancellation.vkf";
    const auto cancellation_ir = root / "cooperative-cancellation.typed.json";
    {
        std::ofstream output(cancellation_source);
        output << "cooperative cancellation proof\n";
    }
    const auto cancellation_artifact = root /
#ifdef _WIN32
        "cooperative-cancellation.exe";
#else
        "cooperative-cancellation.native";
#endif
    const auto cancellation_compiled = vkf_x64_backend::compile(
        typed_ir, cancellation_source, cancellation_ir, {}, true,
        cancellation_artifact, "cooperative-cancellation-pair-v1", "auto",
        10, 20000.0, 0, &cancellation_graph
    );
    const auto cancellation_manifest = vf::parse_json(
        read_text(cancellation_compiled.manifest_path)
    );
    const auto& cancellation_tuning = member(
        cancellation_manifest, "empirical_tuning"
    );
    const auto& cancellation_candidates = member(
        cancellation_tuning, "candidates"
    ).as_array();
    const auto cancellation_selected = member(
        cancellation_tuning, "selected_policy"
    ).as_string();
    expect(cancellation_candidates.size() == 2 &&
               member(cancellation_candidates[0], "correct").as_boolean() &&
               member(cancellation_candidates[1], "correct").as_boolean() &&
               cancellation_compiled.optimizer_cancellation_observed &&
               cancellation_compiled.optimizer_thread_cleanup_complete,
           "a source-left exact root error must cancel a long safe-loop sibling, preserve exact zero-output parity, and join and close its worker");

    auto concurrent_error_graph = fallible_multi_result_graph(false, false);
    const auto concurrent_error_source = root / "concurrent-error.vkf";
    const auto concurrent_error_ir = root / "concurrent-error.typed.json";
    {
        std::ofstream output(concurrent_error_source);
        output << "concurrent error proof\n";
    }
    const auto concurrent_error_artifact = root /
#ifdef _WIN32
        "concurrent-error.exe";
#else
        "concurrent-error.native";
#endif
    const auto concurrent_error_compiled = vkf_x64_backend::compile(
        typed_ir, concurrent_error_source, concurrent_error_ir, {}, true,
        concurrent_error_artifact, "concurrent-error-pair-v1", "auto", 10,
        20000.0, 0, &concurrent_error_graph
    );
    const auto concurrent_error_manifest = vf::parse_json(
        read_text(concurrent_error_compiled.manifest_path)
    );
    const auto& concurrent_error_candidates = member(
        member(concurrent_error_manifest, "empirical_tuning"), "candidates"
    ).as_array();
    expect(concurrent_error_candidates.size() == 2 &&
               member(concurrent_error_candidates[0], "correct").as_boolean() &&
               member(concurrent_error_candidates[1], "correct").as_boolean(),
           "concurrent root errors must benchmark as the exact source-first error after joining both lanes");

    std::filesystem::remove_all(root);
    std::cout << "retained optimization driver integration: candidates="
              << candidates.size() << " incremental_candidates="
              << incremental_candidates.size() << " exact_output="
              << (run_status == 0) << " call_candidates="
              << call_candidates.size() << " pure_call_candidates="
              << pure_call_candidates.size() << " pair_candidates="
              << pair_candidates.size() << " pair_selected="
              << pair_selected_policy << " serial_median_ns="
              << member(pair_candidates[0], "median_ns").as_number()
              << " threaded_median_ns="
              << member(pair_candidates[1], "median_ns").as_number()
              << " changed_pair_candidates="
              << changed_pair_candidates.size()
              << " reduction_candidates=" << reduction_candidates.size()
              << " reduction_selected=" << reduction_selected
              << " reduction_serial_median_ns="
              << member(reduction_candidates[0], "median_ns").as_number()
              << " reduction_threaded_median_ns="
              << member(reduction_candidates[1], "median_ns").as_number()
              << " changed_reduction_candidates="
              << changed_reduction_candidates.size()
              << " right_error_candidates=" << right_error_candidates.size()
              << " right_error_selected=" << right_error_selected
              << " cancellation_candidates="
              << cancellation_candidates.size()
              << " cancellation_selected=" << cancellation_selected
              << " cancellation_serial_median_ns="
              << member(cancellation_candidates[0], "median_ns").as_number()
              << " cancellation_threaded_median_ns="
              << member(cancellation_candidates[1], "median_ns").as_number()
              << " cancellation_observed="
              << cancellation_compiled.optimizer_cancellation_observed
              << " cancellation_cleanup="
              << cancellation_compiled.optimizer_thread_cleanup_complete
              << " concurrent_error_candidates="
              << concurrent_error_candidates.size()
              << '\n';
    return failures == 0 ? 0 : 1;
}
