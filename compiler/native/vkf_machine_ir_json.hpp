#pragma once

#include "compiler/native/vkf_machine_ir.hpp"
#include "native/VfOverlay/vf/json.hpp"

#include <stdexcept>

namespace vkf::machine_ir {

inline const char* opcode_name(Opcode opcode) {
    switch (opcode) {
        case Opcode::PushF64: return "push_f64";
        case Opcode::PushNull: return "push_null";
        case Opcode::PushString: return "push_string";
        case Opcode::FormatF64String: return "format_f64_string";
        case Opcode::FormatBitString: return "format_bit_string";
        case Opcode::FormatChrString: return "format_chr_string";
        case Opcode::DecodeUtf8At: return "decode_utf8_at";
        case Opcode::CloneString: return "clone_string";
        case Opcode::ConcatStrings: return "concat_strings";
        case Opcode::WriteString: return "write_string";
        case Opcode::ReadFileString: return "read_file_string";
        case Opcode::WriteFileString: return "write_file_string";
        case Opcode::StringEqual: return "string_equal";
        case Opcode::StringNotEqual: return "string_not_equal";
        case Opcode::StringLess: return "string_less";
        case Opcode::StringLessEqual: return "string_less_equal";
        case Opcode::StringGreater: return "string_greater";
        case Opcode::StringGreaterEqual: return "string_greater_equal";
        case Opcode::ReleaseStringValue: return "release_string_value";
        case Opcode::ReleaseStringLocal: return "release_string_local";
        case Opcode::LoadLocal: return "load_local";
        case Opcode::StoreLocal: return "store_local";
        case Opcode::Drop: return "drop";
        case Opcode::Duplicate: return "duplicate";
        case Opcode::IdentityF64: return "identity_f64";
        case Opcode::NegateF64: return "negate_f64";
        case Opcode::LogicalNotF64: return "logical_not_f64";
        case Opcode::BooleanizeF64: return "booleanize_f64";
        case Opcode::AddF64: return "add_f64";
        case Opcode::SubtractF64: return "subtract_f64";
        case Opcode::MultiplyF64: return "multiply_f64";
        case Opcode::DivideF64: return "divide_f64";
        case Opcode::FloorDivideF64: return "floor_divide_f64";
        case Opcode::AbsF64: return "abs_f64";
        case Opcode::SqrtF64: return "sqrt_f64";
        case Opcode::SinF64: return "sin_f64";
        case Opcode::CosF64: return "cos_f64";
        case Opcode::ExpF64: return "exp_f64";
        case Opcode::LnF64: return "ln_f64";
        case Opcode::MonotonicF64: return "monotonic_f64";
        case Opcode::WallTimeF64: return "wall_time_f64";
        case Opcode::SleepF64: return "sleep_f64";
        case Opcode::LocalTimeParts: return "local_time_parts";
        case Opcode::SystemCpuCount: return "system_cpu_count";
        case Opcode::SystemCwdString: return "system_cwd_string";
        case Opcode::SystemEnvString: return "system_env_string";
        case Opcode::ProcessRun: return "process_run";
        case Opcode::CaptureRegex: return "capture_regex";
        case Opcode::SumF64Values: return "sum_f64_values";
        case Opcode::MeanF64Values: return "mean_f64_values";
        case Opcode::VarianceF64Values: return "variance_f64_values";
        case Opcode::StdDevF64Values: return "stddev_f64_values";
        case Opcode::RangeF64Values: return "range_f64_values";
        case Opcode::CountValues: return "count_values";
        case Opcode::SumF64Locals: return "sum_f64_locals";
        case Opcode::MeanF64Locals: return "mean_f64_locals";
        case Opcode::VarianceF64Locals: return "variance_f64_locals";
        case Opcode::StdDevF64Locals: return "stddev_f64_locals";
        case Opcode::RangeF64Locals: return "range_f64_locals";
        case Opcode::CountLocalValues: return "count_local_values";
        case Opcode::MakeOwnedF64List: return "make_owned_f64_list";
        case Opcode::MakeOwnedF64ListLiteral: return "make_owned_f64_list_literal";
        case Opcode::LoadF64LocalsIndex: return "load_f64_locals_index";
        case Opcode::StoreF64LocalsIndex: return "store_f64_locals_index";
        case Opcode::LoadF64ListIndex: return "load_f64_list_index";
        case Opcode::StoreF64ListIndex: return "store_f64_list_index";
        case Opcode::SumF64List: return "sum_f64_list";
        case Opcode::MeanF64List: return "mean_f64_list";
        case Opcode::VarianceF64List: return "variance_f64_list";
        case Opcode::StdDevF64List: return "stddev_f64_list";
        case Opcode::RangeF64List: return "range_f64_list";
        case Opcode::CountF64List: return "count_f64_list";
        case Opcode::CloneF64List: return "clone_f64_list";
        case Opcode::ConcatF64Lists: return "concat_f64_lists";
        case Opcode::NormalizeF64Multiset: return "normalize_f64_multiset";
        case Opcode::UnionF64Multisets: return "union_f64_multisets";
        case Opcode::DifferenceF64Multisets: return "difference_f64_multisets";
        case Opcode::FloorDivideF64Multisets: return "floor_divide_f64_multisets";
        case Opcode::RemainderF64Multisets: return "remainder_f64_multisets";
        case Opcode::AddF64MultisetScalar: return "add_f64_multiset_scalar";
        case Opcode::SubtractF64MultisetScalar: return "subtract_f64_multiset_scalar";
        case Opcode::FloorDivideF64MultisetScalar: return "floor_divide_f64_multiset_scalar";
        case Opcode::ReleaseF64ListValue: return "release_f64_list_value";
        case Opcode::ReleaseF64ListLocal: return "release_f64_list_local";
        case Opcode::RemainderF64: return "remainder_f64";
        case Opcode::PowerF64: return "power_f64";
        case Opcode::LogicalXorF64: return "logical_xor_f64";
        case Opcode::OrderedLessF64: return "ordered_less_f64";
        case Opcode::OrderedLessEqualF64: return "ordered_less_equal_f64";
        case Opcode::OrderedGreaterF64: return "ordered_greater_f64";
        case Opcode::OrderedGreaterEqualF64: return "ordered_greater_equal_f64";
        case Opcode::OrderedEqualF64: return "ordered_equal_f64";
        case Opcode::UnorderedNotEqualF64: return "unordered_not_equal_f64";
        case Opcode::EqualBits: return "equal_bits";
        case Opcode::NotEqualBits: return "not_equal_bits";
        case Opcode::Call: return "call";
        case Opcode::Label: return "label";
        case Opcode::Jump: return "jump";
        case Opcode::JumpIfFalse: return "jump_if_false";
        case Opcode::JumpIfTrue: return "jump_if_true";
        case Opcode::JumpIfParameterProvided: return "jump_if_parameter_provided";
        case Opcode::ErrorTypeMatches: return "error_type_matches";
        case Opcode::RethrowError: return "rethrow_error";
        case Opcode::AssertTruthy: return "assert_truthy";
        case Opcode::AssertTruthyString: return "assert_truthy_string";
        case Opcode::ExitProgram: return "exit_program";
        case Opcode::ReturnF64: return "return_f64";
        case Opcode::ReturnValues: return "return_values";
    }
    throw std::runtime_error("unknown machine IR opcode");
}

inline vf::JsonValue instruction_json(const Instruction& instruction) {
    vf::JsonValue::Object object;
    object["kind"] = opcode_name(instruction.opcode);
    if (instruction.opcode == Opcode::PushF64) object["value"] = instruction.f64;
    if (instruction.opcode == Opcode::PushString || instruction.opcode == Opcode::FormatF64String) {
        object["offset"] = static_cast<double>(instruction.index);
        object["byte_count"] = static_cast<double>(instruction.byte_count);
    }
    if (instruction.opcode == Opcode::FormatBitString) {
        object["false_offset"] = static_cast<double>(instruction.index);
        object["true_offset"] = static_cast<double>(instruction.error_message_offset);
    }
    if (instruction.opcode == Opcode::LoadLocal || instruction.opcode == Opcode::StoreLocal ||
        instruction.opcode == Opcode::ReleaseStringLocal) {
        object["index"] = static_cast<double>(instruction.index);
    }
    if (instruction.opcode == Opcode::Call) {
        object["argument_count"] = static_cast<double>(instruction.argument_count);
        object["provided_parameter_mask"] = static_cast<double>(instruction.provided_parameter_mask);
        object["uses_parameter_mask"] = instruction.uses_parameter_mask;
        object["result_count"] = static_cast<double>(instruction.result_count);
        object["symbol"] = instruction.symbol;
        object["may_error"] = instruction.may_error;
        object["has_error_handler"] = instruction.has_error_handler;
        if (instruction.has_error_handler) {
            object["error_label"] = static_cast<double>(instruction.label);
            object["error_value_local"] = static_cast<double>(instruction.error_value_local);
            object["error_type_local"] = static_cast<double>(instruction.error_type_local);
        }
    }
    if (instruction.opcode == Opcode::SumF64Values ||
        instruction.opcode == Opcode::MeanF64Values ||
        instruction.opcode == Opcode::VarianceF64Values ||
        instruction.opcode == Opcode::StdDevF64Values ||
        instruction.opcode == Opcode::RangeF64Values ||
        instruction.opcode == Opcode::CountValues) {
        object["argument_count"] = static_cast<double>(instruction.argument_count);
    }
    if (instruction.opcode == Opcode::VarianceF64Values ||
        instruction.opcode == Opcode::VarianceF64Locals ||
        instruction.opcode == Opcode::VarianceF64List ||
        instruction.opcode == Opcode::StdDevF64Values ||
        instruction.opcode == Opcode::StdDevF64Locals ||
        instruction.opcode == Opcode::StdDevF64List) {
        object["ddof"] = static_cast<double>(instruction.degrees_of_freedom);
    }
    if (instruction.opcode == Opcode::SumF64Locals ||
        instruction.opcode == Opcode::MeanF64Locals ||
        instruction.opcode == Opcode::VarianceF64Locals ||
        instruction.opcode == Opcode::StdDevF64Locals ||
        instruction.opcode == Opcode::RangeF64Locals ||
        instruction.opcode == Opcode::CountLocalValues) {
        object["index"] = static_cast<double>(instruction.index);
        object["argument_count"] = static_cast<double>(instruction.argument_count);
    }
    if (instruction.opcode == Opcode::MakeOwnedF64List ||
        instruction.opcode == Opcode::MakeOwnedF64ListLiteral) {
        object["argument_count"] = static_cast<double>(instruction.argument_count);
    }
    if (instruction.opcode == Opcode::MakeOwnedF64ListLiteral) {
        object["offset"] = static_cast<double>(instruction.index);
    }
    if (instruction.opcode == Opcode::WriteString ||
        instruction.opcode == Opcode::ReadFileString ||
        instruction.opcode == Opcode::SystemEnvString ||
        instruction.opcode == Opcode::LoadF64ListIndex ||
        instruction.opcode == Opcode::SumF64List ||
        instruction.opcode == Opcode::MeanF64List ||
        instruction.opcode == Opcode::VarianceF64List ||
        instruction.opcode == Opcode::StdDevF64List ||
        instruction.opcode == Opcode::RangeF64List ||
        instruction.opcode == Opcode::CountF64List) {
        object["owns_input"] = instruction.owns_input;
    }
    if (instruction.opcode == Opcode::ProcessRun) {
        object["argument_count"] = static_cast<double>(instruction.argument_count);
        object["offset"] = static_cast<double>(instruction.index);
        object["owns_input"] = instruction.owns_input;
    }
    if (instruction.opcode == Opcode::CaptureRegex) {
        object["group_count"] = static_cast<double>(instruction.argument_count);
        object["pattern"] = instruction.symbol;
        object["owns_input"] = instruction.owns_input;
    }
    if (instruction.opcode == Opcode::SystemEnvString) {
        object["offset"] = static_cast<double>(instruction.index);
    }
    if (instruction.opcode == Opcode::WriteFileString) {
        object["owns_left"] = instruction.owns_left;
        object["owns_right"] = instruction.owns_right;
    }
    if (instruction.opcode == Opcode::StoreF64ListIndex ||
        instruction.opcode == Opcode::StoreF64LocalsIndex) {
        object["index"] = static_cast<double>(instruction.index);
    }
    if (instruction.opcode == Opcode::LoadF64LocalsIndex ||
        instruction.opcode == Opcode::StoreF64LocalsIndex) {
        object["index"] = static_cast<double>(instruction.index);
        object["argument_count"] = static_cast<double>(instruction.argument_count);
    }
    if (instruction.opcode == Opcode::LoadF64ListIndex ||
        instruction.opcode == Opcode::LoadF64LocalsIndex ||
        instruction.opcode == Opcode::StoreF64LocalsIndex ||
        instruction.opcode == Opcode::StoreF64ListIndex) {
        object["may_error"] = instruction.may_error;
        object["has_error_handler"] = instruction.has_error_handler;
        object["error_message_offset"] = static_cast<double>(instruction.error_message_offset);
        object["byte_count"] = static_cast<double>(instruction.byte_count);
        if (instruction.has_error_handler) {
            object["error_label"] = static_cast<double>(instruction.label);
            object["error_value_local"] = static_cast<double>(instruction.error_value_local);
            object["error_type_local"] = static_cast<double>(instruction.error_type_local);
        }
    }
    if (instruction.opcode == Opcode::ConcatF64Lists ||
        instruction.opcode == Opcode::UnionF64Multisets ||
        instruction.opcode == Opcode::DifferenceF64Multisets ||
        instruction.opcode == Opcode::FloorDivideF64Multisets ||
        instruction.opcode == Opcode::RemainderF64Multisets ||
        instruction.opcode == Opcode::AddF64MultisetScalar ||
        instruction.opcode == Opcode::SubtractF64MultisetScalar ||
        instruction.opcode == Opcode::FloorDivideF64MultisetScalar ||
        instruction.opcode == Opcode::ConcatStrings ||
        instruction.opcode == Opcode::StringEqual || instruction.opcode == Opcode::StringNotEqual ||
        instruction.opcode == Opcode::StringLess || instruction.opcode == Opcode::StringLessEqual ||
        instruction.opcode == Opcode::StringGreater || instruction.opcode == Opcode::StringGreaterEqual) {
        object["owns_left"] = instruction.owns_left;
        object["owns_right"] = instruction.owns_right;
    }
    if (instruction.opcode == Opcode::ReleaseF64ListLocal) {
        object["index"] = static_cast<double>(instruction.index);
    }
    if (instruction.opcode == Opcode::ReturnValues) {
        object["result_count"] = static_cast<double>(instruction.result_count);
    }
    if (instruction.opcode == Opcode::AssertTruthy) {
        object["has_error_handler"] = instruction.has_error_handler;
        object["error_type_mask"] = static_cast<double>(instruction.error_type_mask);
        if (instruction.has_error_handler) {
            object["error_label"] = static_cast<double>(instruction.label);
            object["error_value_local"] = static_cast<double>(instruction.error_value_local);
            object["error_type_local"] = static_cast<double>(instruction.error_type_local);
        }
    }
    if (instruction.opcode == Opcode::ErrorTypeMatches) {
        object["mask"] = static_cast<double>(instruction.index);
    }
    if (instruction.opcode == Opcode::RethrowError) {
        object["error_value_local"] = static_cast<double>(instruction.error_value_local);
        object["error_type_local"] = static_cast<double>(instruction.error_type_local);
        object["has_error_handler"] = instruction.has_error_handler;
        if (instruction.has_error_handler) {
            object["error_label"] = static_cast<double>(instruction.label);
            object["handler_error_value_local"] = static_cast<double>(instruction.handler_error_value_local);
            object["handler_error_type_local"] = static_cast<double>(instruction.handler_error_type_local);
        }
    }
    if (instruction.opcode == Opcode::Label || instruction.opcode == Opcode::Jump ||
        instruction.opcode == Opcode::JumpIfFalse || instruction.opcode == Opcode::JumpIfTrue ||
        instruction.opcode == Opcode::JumpIfParameterProvided) {
        object["label"] = static_cast<double>(instruction.label);
    }
    if (instruction.opcode == Opcode::JumpIfParameterProvided) {
        object["index"] = static_cast<double>(instruction.index);
    }
    return vf::JsonValue(std::move(object));
}

inline vf::JsonValue function_json(const Function& function) {
    vf::JsonValue::Array parameters;
    for (const auto& parameter : function.parameters) parameters.emplace_back(parameter);
    vf::JsonValue::Array locals;
    for (const auto& local : function.locals) locals.emplace_back(local);
    vf::JsonValue::Array instructions;
    for (const auto& instruction : function.instructions) instructions.push_back(instruction_json(instruction));
    vf::JsonValue::Array owned_f64_list_locals;
    for (const auto index : function.owned_f64_list_locals) {
        owned_f64_list_locals.emplace_back(static_cast<double>(index));
    }

    vf::JsonValue::Object object;
    object["instructions"] = vf::JsonValue(std::move(instructions));
    object["locals"] = vf::JsonValue(std::move(locals));
    object["max_stack"] = static_cast<double>(function.max_stack);
    object["name"] = function.name;
    object["may_error"] = function.may_error;
    object["owned_f64_list_locals"] = vf::JsonValue(std::move(owned_f64_list_locals));
    vf::JsonValue::Array owned_string_locals;
    for (const auto index : function.owned_string_locals) {
        owned_string_locals.emplace_back(static_cast<double>(index));
    }
    object["owned_string_locals"] = vf::JsonValue(std::move(owned_string_locals));
    object["parameter_mask_local"] = function.parameter_mask_local
        ? vf::JsonValue(static_cast<double>(*function.parameter_mask_local))
        : vf::JsonValue(nullptr);
    object["parameters"] = vf::JsonValue(std::move(parameters));
    return vf::JsonValue(std::move(object));
}

inline vf::JsonValue module_json(const Module& module) {
    vf::JsonValue::Array functions;
    for (const auto& function : module.functions) functions.push_back(function_json(function));
    vf::JsonValue::Object object;
    object["entry"] = function_json(module.entry);
    object["functions"] = vf::JsonValue(std::move(functions));
    object["schema"] = "vektorflow.machine_ir";
    object["output_kind"] = module.output_kind == OutputKind::String ? "string"
        : module.output_kind == OutputKind::F64 ? "f64"
        : module.output_kind == OutputKind::MultipleF64 ? "multiple_f64"
        : module.output_kind == OutputKind::MixedSequence ? "mixed_sequence"
        : module.output_kind == OutputKind::StructuredSequence ? "structured_sequence" : "none";
    object["output_count"] = static_cast<double>(module.output_count);
    vf::JsonValue::Array outputs;
    for (const auto kind : module.outputs) {
        outputs.emplace_back(kind == OutputKind::String ? "string" : "f64");
    }
    object["outputs"] = vf::JsonValue(std::move(outputs));
    vf::JsonValue::Array output_tokens;
    for (const auto& token : module.output_tokens) {
        vf::JsonValue::Object value;
        value["kind"] = token.kind == OutputTokenKind::F64 ? "f64"
            : token.kind == OutputTokenKind::String ? "string"
            : token.kind == OutputTokenKind::Bit ? "bit"
            : token.kind == OutputTokenKind::Null ? "null" : "text";
        if (token.kind == OutputTokenKind::Text) value["text"] = token.text;
        output_tokens.emplace_back(std::move(value));
    }
    object["output_tokens"] = vf::JsonValue(std::move(output_tokens));
    object["string_bytes"] = static_cast<double>(module.string_data.size());
    object["version"] = static_cast<double>(schema_version);
    return vf::JsonValue(std::move(object));
}

}  // namespace vkf::machine_ir
