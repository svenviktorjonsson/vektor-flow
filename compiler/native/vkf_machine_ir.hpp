#pragma once

#include <cstdint>
#include <cstring>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace vkf::machine_ir {

inline constexpr std::uint32_t schema_version = 16;
inline constexpr std::uint32_t runtime_output_base = 192;
inline constexpr std::uint32_t assertion_error_mask = 0b1000011;
inline constexpr std::uint32_t index_error_mask = 0b1000100001;
inline constexpr std::uint32_t value_error_mask = 0b10100001;
inline constexpr std::uint64_t null_value_bits = 0x7ff8000000000001ull;

inline double null_value() {
    double value = 0.0;
    std::memcpy(&value, &null_value_bits, sizeof(value));
    return value;
}

enum class ValueClass : std::uint8_t {
    F64,
    I64,
    Bool,
    Address,
    Aggregate,
};

enum class OutputKind : std::uint8_t {
    None,
    F64,
    String,
    MultipleF64,
    MixedSequence,
    StructuredSequence,
};

enum class OutputTokenKind : std::uint8_t {
    F64,
    String,
    Bit,
    Null,
    Text,
};

struct OutputToken {
    OutputTokenKind kind = OutputTokenKind::Text;
    std::string text;
};

inline std::uint32_t output_token_width(OutputTokenKind kind) {
    if (kind == OutputTokenKind::String) return 2;
    if (kind == OutputTokenKind::Text) return 0;
    return 1;
}

enum class Opcode : std::uint8_t {
    PushF64,
    PushNull,
    PushString,
    FormatF64String,
    FormatBitString,
    FormatChrString,
    DecodeUtf8At,
    CloneString,
    ConcatStrings,
    WriteString,
    ReadFileString,
    WriteFileString,
    StringEqual,
    StringNotEqual,
    StringLess,
    StringLessEqual,
    StringGreater,
    StringGreaterEqual,
    ReleaseStringValue,
    ReleaseStringLocal,
    LoadLocal,
    StoreLocal,
    Drop,
    Duplicate,
    IdentityF64,
    NegateF64,
    LogicalNotF64,
    BooleanizeF64,
    AddF64,
    SubtractF64,
    MultiplyF64,
    DivideF64,
    FloorDivideF64,
    AbsF64,
    SqrtF64,
    SinF64,
    CosF64,
    ExpF64,
    LnF64,
    MonotonicF64,
    WallTimeF64,
    SleepF64,
    LocalTimeParts,
    SystemCpuCount,
    SystemCwdString,
    SystemEnvString,
    ProcessRun,
    CaptureRegex,
    SumF64Values,
    MeanF64Values,
    VarianceF64Values,
    StdDevF64Values,
    RangeF64Values,
    CountValues,
    SumF64Locals,
    MeanF64Locals,
    VarianceF64Locals,
    StdDevF64Locals,
    RangeF64Locals,
    CountLocalValues,
    MakeOwnedF64List,
    MakeOwnedF64ListLiteral,
    LoadF64LocalsIndex,
    StoreF64LocalsIndex,
    LoadF64ListIndex,
    StoreF64ListIndex,
    SumF64List,
    MeanF64List,
    VarianceF64List,
    StdDevF64List,
    RangeF64List,
    CountF64List,
    CloneF64List,
    ConcatF64Lists,
    NormalizeF64Multiset,
    UnionF64Multisets,
    DifferenceF64Multisets,
    FloorDivideF64Multisets,
    RemainderF64Multisets,
    AddF64MultisetScalar,
    SubtractF64MultisetScalar,
    FloorDivideF64MultisetScalar,
    ReleaseF64ListValue,
    ReleaseF64ListLocal,
    RemainderF64,
    PowerF64,
    LogicalXorF64,
    OrderedLessF64,
    OrderedLessEqualF64,
    OrderedGreaterF64,
    OrderedGreaterEqualF64,
    OrderedEqualF64,
    UnorderedNotEqualF64,
    EqualBits,
    NotEqualBits,
    Call,
    Label,
    Jump,
    JumpIfFalse,
    JumpIfTrue,
    JumpIfParameterProvided,
    ErrorTypeMatches,
    RethrowError,
    AssertTruthy,
    AssertTruthyString,
    ExitProgram,
    ReturnF64,
    ReturnValues,
};

struct Instruction {
    Opcode opcode = Opcode::Drop;
    double f64 = 0.0;
    std::uint32_t index = 0;
    std::uint32_t argument_count = 0;
    std::uint32_t degrees_of_freedom = 0;
    std::uint32_t result_count = 1;
    std::uint32_t byte_count = 0;
    std::uint32_t label = 0;
    std::uint32_t provided_parameter_mask = 0;
    std::uint32_t error_value_local = 0;
    std::uint32_t error_type_local = 0;
    std::uint32_t error_message_offset = 0;
    std::uint32_t handler_error_value_local = 0;
    std::uint32_t handler_error_type_local = 0;
    std::uint32_t error_type_mask = assertion_error_mask;
    bool owns_input = false;
    bool owns_left = false;
    bool owns_right = false;
    bool uses_parameter_mask = false;
    bool may_error = false;
    bool has_error_handler = false;
    std::string symbol;
};

struct Function {
    std::string name;
    std::vector<std::string> parameters;
    std::vector<std::string> locals;
    std::vector<std::uint32_t> owned_f64_list_locals;
    std::vector<std::uint32_t> owned_string_locals;
    std::optional<std::uint32_t> parameter_mask_local;
    bool may_error = false;
    std::vector<Instruction> instructions;
    std::uint32_t max_stack = 0;
};

struct Module {
    Function entry;
    std::vector<Function> functions;
    std::vector<std::uint8_t> string_data;
    OutputKind output_kind = OutputKind::None;
    std::uint32_t output_count = 0;
    std::vector<OutputKind> outputs;
    std::vector<OutputToken> output_tokens;
};

inline std::optional<Opcode> scalar_unary_opcode(std::string_view typed_ir_operator) {
    if (typed_ir_operator == "PLUS") return Opcode::IdentityF64;
    if (typed_ir_operator == "MINUS") return Opcode::NegateF64;
    if (typed_ir_operator == "NOT") return Opcode::LogicalNotF64;
    return std::nullopt;
}

inline std::optional<Opcode> scalar_binary_opcode(std::string_view typed_ir_operator) {
    if (typed_ir_operator == "PLUS") return Opcode::AddF64;
    if (typed_ir_operator == "MINUS") return Opcode::SubtractF64;
    if (typed_ir_operator == "STAR") return Opcode::MultiplyF64;
    if (typed_ir_operator == "SLASH") return Opcode::DivideF64;
    if (typed_ir_operator == "FLOORDIV") return Opcode::FloorDivideF64;
    if (typed_ir_operator == "PERCENT") return Opcode::RemainderF64;
    if (typed_ir_operator == "CARET") return Opcode::PowerF64;
    if (typed_ir_operator == "XOR") return Opcode::LogicalXorF64;
    if (typed_ir_operator == "LT") return Opcode::OrderedLessF64;
    if (typed_ir_operator == "LE") return Opcode::OrderedLessEqualF64;
    if (typed_ir_operator == "GT") return Opcode::OrderedGreaterF64;
    if (typed_ir_operator == "GE") return Opcode::OrderedGreaterEqualF64;
    if (typed_ir_operator == "EQ" || typed_ir_operator == "EXACT_EQ") {
        return Opcode::OrderedEqualF64;
    }
    if (typed_ir_operator == "NE" || typed_ir_operator == "NEQ" || typed_ir_operator == "STRUCT_NEQ") {
        return Opcode::UnorderedNotEqualF64;
    }
    return std::nullopt;
}

}  // namespace vkf::machine_ir
