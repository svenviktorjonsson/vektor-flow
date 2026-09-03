#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace vkf::wasm::bytecode {

class BytecodeError : public std::runtime_error {
public:
    explicit BytecodeError(const std::string& message)
        : std::runtime_error(message) {}
};

enum class ValueType : std::uint8_t {
    Void = 0,
    Dynamic = 1,
    Number = 2,
    Boolean = 3,
    String = 4,
    Array = 5,
    Object = 6,
};

enum class Opcode : std::uint16_t {
    Nop = 0,
    PushConstant = 1,
    PushNull = 2,
    LoadLocal = 3,
    StoreLocal = 4,
    Pop = 5,
    Duplicate = 6,
    Add = 7,
    Subtract = 8,
    Multiply = 9,
    Divide = 10,
    Remainder = 11,
    Negate = 12,
    Equal = 13,
    NotEqual = 14,
    Less = 15,
    LessEqual = 16,
    Greater = 17,
    GreaterEqual = 18,
    LogicalNot = 19,
    Jump = 20,
    JumpIfFalse = 21,
    Call = 22,
    Return = 23,
    MakeArray = 24,
    ArrayGet = 25,
    ArraySet = 26,
    MakeObject = 27,
    ObjectGet = 28,
    ObjectSet = 29,
    LogicalAnd = 30,
    LogicalOr = 31,
    Power = 32,
    SquareRoot = 33,
    Atan2 = 34,
    Utf8Length = 35,
    Utf8Eof = 36,
    Utf8PeekScalar = 37,
    Utf8Advance = 38,
    Concatenate = 39,
    StringConcat = Concatenate,
    DecimalParse = 40,
    DecimalScan = DecimalParse,
    NumberToString = 41,
    Utf8IsIdentifierStart = 42,
    Utf8IsIdentifierContinue = 43,
    Sine = 44,
    Cosine = 45,
    Tangent = 46,
    Absolute = 47,
    IdentifierScan = 48,
    OperatorScan = 49,
    ArrayLength = 50,
    Utf8Slice = 51,
    DecimalScanEnd = 52,
    IdentifierScanEnd = 53,
    OperatorWidth = 54,
    OperatorKind = 55,
    PlotPack = 56,
    PlotBuilderCreate = 57,
    PlotBuilderPush = 58,
    PlotBuilderFinish = 59,
    AllocateArray = 60,
    NaturalLog = 61,
    Exponential = 62,
    Trap = 63,
    ArrayConcat = 64,
    FloorDivide = 65,
    StringLess = 66,
    StringLessEqual = 67,
    StringGreater = 68,
    StringGreaterEqual = 69,
};

enum class ConstantKind : std::uint8_t {
    Number = 0,
    Utf8String = 1,
};

struct Constant {
    ConstantKind kind = ConstantKind::Number;
    double number = 0.0;
    std::string string;

    static Constant number_value(double value) {
        Constant constant;
        constant.number = value;
        return constant;
    }

    static Constant utf8_string(std::string value) {
        Constant constant;
        constant.kind = ConstantKind::Utf8String;
        constant.string = std::move(value);
        return constant;
    }

    bool operator==(const Constant& other) const {
        if (kind != other.kind) {
            return false;
        }
        if (kind == ConstantKind::Utf8String) {
            return string == other.string;
        }
        std::uint64_t left = 0;
        std::uint64_t right = 0;
        std::memcpy(&left, &number, sizeof(left));
        std::memcpy(&right, &other.number, sizeof(right));
        return left == right;
    }
};

struct Instruction {
    Opcode opcode = Opcode::Nop;
    ValueType result_type = ValueType::Void;
    std::uint32_t first = 0;
    std::uint32_t second = 0;

    bool operator==(const Instruction& other) const {
        return opcode == other.opcode
            && result_type == other.result_type
            && first == other.first
            && second == other.second;
    }
};

struct Function {
    std::uint32_t name_constant = 0;
    std::uint32_t parameter_count = 0;
    ValueType return_type = ValueType::Void;
    std::vector<ValueType> local_types;
    std::vector<Instruction> instructions;

    bool operator==(const Function& other) const {
        return name_constant == other.name_constant
            && parameter_count == other.parameter_count
            && return_type == other.return_type
            && local_types == other.local_types
            && instructions == other.instructions;
    }
};

inline constexpr std::uint32_t no_entry_function =
    std::numeric_limits<std::uint32_t>::max();

struct Module {
    std::vector<Constant> constants;
    std::vector<Function> functions;
    std::uint32_t entry_function = no_entry_function;

    bool operator==(const Module& other) const {
        return constants == other.constants
            && functions == other.functions
            && entry_function == other.entry_function;
    }
};

namespace detail {

inline constexpr std::array<std::uint8_t, 8> magic = {
    'V', 'K', 'F', 'B', 'C', 0x0d, 0x0a, 0x00,
};
inline constexpr std::uint16_t format_version = 2;
inline constexpr std::uint32_t maximum_collection_size = 16U * 1024U * 1024U;

inline bool is_value_type(ValueType type) {
    return static_cast<std::uint8_t>(type)
        <= static_cast<std::uint8_t>(ValueType::Object);
}

inline bool is_opcode(Opcode opcode) {
    return static_cast<std::uint16_t>(opcode)
        <= static_cast<std::uint16_t>(Opcode::StringGreaterEqual);
}

inline bool is_valid_utf8(const std::string& value) {
    const auto* bytes =
        reinterpret_cast<const unsigned char*>(value.data());
    std::size_t index = 0;
    while (index < value.size()) {
        const unsigned char lead = bytes[index];
        if (lead <= 0x7f) {
            ++index;
            continue;
        }

        std::size_t width = 0;
        std::uint32_t code_point = 0;
        if (lead >= 0xc2 && lead <= 0xdf) {
            width = 2;
            code_point = lead & 0x1fU;
        } else if (lead >= 0xe0 && lead <= 0xef) {
            width = 3;
            code_point = lead & 0x0fU;
        } else if (lead >= 0xf0 && lead <= 0xf4) {
            width = 4;
            code_point = lead & 0x07U;
        } else {
            return false;
        }
        if (index + width > value.size()) {
            return false;
        }
        for (std::size_t offset = 1; offset < width; ++offset) {
            const unsigned char continuation = bytes[index + offset];
            if ((continuation & 0xc0U) != 0x80U) {
                return false;
            }
            code_point = (code_point << 6U) | (continuation & 0x3fU);
        }
        if ((width == 3 && code_point < 0x800U)
            || (width == 4 && code_point < 0x10000U)
            || code_point > 0x10ffffU
            || (code_point >= 0xd800U && code_point <= 0xdfffU)) {
            return false;
        }
        index += width;
    }
    return true;
}

inline void require_constant(
    const Module& module,
    std::uint32_t index,
    const std::string& context
) {
    if (index >= module.constants.size()) {
        throw BytecodeError(context + " references missing constant "
            + std::to_string(index));
    }
}

inline void validate_instruction(
    const Module& module,
    const Function& function,
    std::size_t function_index,
    std::size_t instruction_index
) {
    const auto& instruction = function.instructions[instruction_index];
    const std::string context =
        "function " + std::to_string(function_index)
        + " instruction " + std::to_string(instruction_index);
    if (!is_opcode(instruction.opcode)) {
        throw BytecodeError(context + " has unknown opcode");
    }
    if (!is_value_type(instruction.result_type)) {
        throw BytecodeError(context + " has unknown result type");
    }

    switch (instruction.opcode) {
        case Opcode::PushConstant:
            require_constant(module, instruction.first, context);
            break;
        case Opcode::LoadLocal:
        case Opcode::StoreLocal:
            if (instruction.first >= function.local_types.size()) {
                throw BytecodeError(context + " references missing local "
                    + std::to_string(instruction.first));
            }
            break;
        case Opcode::Jump:
        case Opcode::JumpIfFalse:
            if (instruction.first >= function.instructions.size()) {
                throw BytecodeError(context + " references invalid jump target "
                    + std::to_string(instruction.first));
            }
            break;
        case Opcode::Call:
            if (instruction.first >= module.functions.size()) {
                throw BytecodeError(context + " references missing function "
                    + std::to_string(instruction.first));
            }
            if (instruction.second
                != module.functions[instruction.first].parameter_count) {
                throw BytecodeError(context + " has invalid call arity");
            }
            break;
        case Opcode::ObjectGet:
        case Opcode::ObjectSet:
            require_constant(module, instruction.first, context);
            if (module.constants[instruction.first].kind
                != ConstantKind::Utf8String) {
                throw BytecodeError(context
                    + " requires a UTF-8 string field constant");
            }
            break;
        default:
            break;
    }
}

class Writer {
public:
    void u8(std::uint8_t value) {
        bytes_.push_back(value);
    }

    void u16(std::uint16_t value) {
        u8(static_cast<std::uint8_t>(value & 0xffU));
        u8(static_cast<std::uint8_t>((value >> 8U) & 0xffU));
    }

    void u32(std::uint32_t value) {
        for (unsigned shift = 0; shift < 32; shift += 8) {
            u8(static_cast<std::uint8_t>((value >> shift) & 0xffU));
        }
    }

    void f64(double value) {
        std::uint64_t bits = 0;
        std::memcpy(&bits, &value, sizeof(bits));
        for (unsigned shift = 0; shift < 64; shift += 8) {
            u8(static_cast<std::uint8_t>((bits >> shift) & 0xffU));
        }
    }

    void raw(const std::uint8_t* data, std::size_t size) {
        bytes_.insert(bytes_.end(), data, data + size);
    }

    std::vector<std::uint8_t> take() {
        return std::move(bytes_);
    }

private:
    std::vector<std::uint8_t> bytes_;
};

class Reader {
public:
    explicit Reader(const std::vector<std::uint8_t>& bytes)
        : bytes_(bytes) {}

    std::uint8_t u8() {
        require(1);
        return bytes_[offset_++];
    }

    std::uint16_t u16() {
        std::uint16_t value = u8();
        value |= static_cast<std::uint16_t>(u8()) << 8U;
        return value;
    }

    std::uint32_t u32() {
        std::uint32_t value = 0;
        for (unsigned shift = 0; shift < 32; shift += 8) {
            value |= static_cast<std::uint32_t>(u8()) << shift;
        }
        return value;
    }

    double f64() {
        std::uint64_t bits = 0;
        for (unsigned shift = 0; shift < 64; shift += 8) {
            bits |= static_cast<std::uint64_t>(u8()) << shift;
        }
        double value = 0.0;
        std::memcpy(&value, &bits, sizeof(value));
        return value;
    }

    std::string string(std::uint32_t size) {
        require(size);
        const auto begin = bytes_.begin()
            + static_cast<std::vector<std::uint8_t>::difference_type>(offset_);
        offset_ += size;
        return std::string(begin, begin + size);
    }

    bool done() const {
        return offset_ == bytes_.size();
    }

private:
    void require(std::size_t count) const {
        if (count > bytes_.size() - offset_) {
            throw BytecodeError("truncated bytecode");
        }
    }

    const std::vector<std::uint8_t>& bytes_;
    std::size_t offset_ = 0;
};

inline std::uint32_t checked_size(std::size_t size, const std::string& field) {
    if (size > maximum_collection_size
        || size > std::numeric_limits<std::uint32_t>::max()) {
        throw BytecodeError(field + " exceeds bytecode size limit");
    }
    return static_cast<std::uint32_t>(size);
}

}  // namespace detail

inline void validate(const Module& module) {
    if (module.constants.size() > detail::maximum_collection_size
        || module.functions.size() > detail::maximum_collection_size) {
        throw BytecodeError("module exceeds bytecode size limit");
    }
    if (module.entry_function != no_entry_function
        && module.entry_function >= module.functions.size()) {
        throw BytecodeError("module references missing entry function "
            + std::to_string(module.entry_function));
    }

    for (std::size_t index = 0; index < module.constants.size(); ++index) {
        const auto& constant = module.constants[index];
        if (constant.kind != ConstantKind::Number
            && constant.kind != ConstantKind::Utf8String) {
            throw BytecodeError("constant " + std::to_string(index)
                + " has unknown kind");
        }
        if (constant.kind == ConstantKind::Utf8String
            && !detail::is_valid_utf8(constant.string)) {
            throw BytecodeError("constant " + std::to_string(index)
                + " is not valid UTF-8");
        }
    }

    for (std::size_t index = 0; index < module.functions.size(); ++index) {
        const auto& function = module.functions[index];
        detail::require_constant(
            module,
            function.name_constant,
            "function " + std::to_string(index)
        );
        if (module.constants[function.name_constant].kind
            != ConstantKind::Utf8String) {
            throw BytecodeError("function " + std::to_string(index)
                + " name is not a UTF-8 string constant");
        }
        if (!detail::is_value_type(function.return_type)) {
            throw BytecodeError("function " + std::to_string(index)
                + " has unknown return type");
        }
        if (function.parameter_count > function.local_types.size()) {
            throw BytecodeError("function " + std::to_string(index)
                + " has more parameters than locals");
        }
        if (function.local_types.size() > detail::maximum_collection_size
            || function.instructions.size() > detail::maximum_collection_size) {
            throw BytecodeError("function " + std::to_string(index)
                + " exceeds bytecode size limit");
        }
        for (const auto type : function.local_types) {
            if (!detail::is_value_type(type) || type == ValueType::Void) {
                throw BytecodeError("function " + std::to_string(index)
                    + " has invalid local type");
            }
        }
        for (std::size_t instruction_index = 0;
             instruction_index < function.instructions.size();
             ++instruction_index) {
            detail::validate_instruction(
                module,
                function,
                index,
                instruction_index
            );
        }
    }
}

inline std::vector<std::uint8_t> serialize(const Module& module) {
    validate(module);
    detail::Writer writer;
    writer.raw(detail::magic.data(), detail::magic.size());
    writer.u16(detail::format_version);
    writer.u16(0);
    writer.u32(detail::checked_size(module.constants.size(), "constants"));
    writer.u32(detail::checked_size(module.functions.size(), "functions"));
    writer.u32(module.entry_function);

    for (const auto& constant : module.constants) {
        writer.u8(static_cast<std::uint8_t>(constant.kind));
        if (constant.kind == ConstantKind::Number) {
            writer.f64(constant.number);
        } else {
            writer.u32(detail::checked_size(
                constant.string.size(),
                "UTF-8 string"
            ));
            writer.raw(
                reinterpret_cast<const std::uint8_t*>(constant.string.data()),
                constant.string.size()
            );
        }
    }

    for (const auto& function : module.functions) {
        writer.u32(function.name_constant);
        writer.u32(function.parameter_count);
        writer.u8(static_cast<std::uint8_t>(function.return_type));
        writer.u32(detail::checked_size(
            function.local_types.size(),
            "function locals"
        ));
        for (const auto type : function.local_types) {
            writer.u8(static_cast<std::uint8_t>(type));
        }
        writer.u32(detail::checked_size(
            function.instructions.size(),
            "function instructions"
        ));
        for (const auto& instruction : function.instructions) {
            writer.u16(static_cast<std::uint16_t>(instruction.opcode));
            writer.u8(static_cast<std::uint8_t>(instruction.result_type));
            writer.u32(instruction.first);
            writer.u32(instruction.second);
        }
    }
    return writer.take();
}

inline Module deserialize(const std::vector<std::uint8_t>& bytes) {
    detail::Reader reader(bytes);
    for (const auto expected : detail::magic) {
        if (reader.u8() != expected) {
            throw BytecodeError("invalid bytecode magic");
        }
    }
    if (reader.u16() != detail::format_version) {
        throw BytecodeError("unsupported bytecode version");
    }
    if (reader.u16() != 0) {
        throw BytecodeError("non-zero reserved bytecode flags");
    }

    const std::uint32_t constant_count = reader.u32();
    const std::uint32_t function_count = reader.u32();
    if (constant_count > detail::maximum_collection_size
        || function_count > detail::maximum_collection_size) {
        throw BytecodeError("encoded module exceeds bytecode size limit");
    }

    Module module;
    module.entry_function = reader.u32();
    module.constants.reserve(constant_count);
    module.functions.reserve(function_count);

    for (std::uint32_t index = 0; index < constant_count; ++index) {
        const auto kind = static_cast<ConstantKind>(reader.u8());
        if (kind == ConstantKind::Number) {
            module.constants.push_back(Constant::number_value(reader.f64()));
        } else if (kind == ConstantKind::Utf8String) {
            const std::uint32_t size = reader.u32();
            if (size > detail::maximum_collection_size) {
                throw BytecodeError("encoded UTF-8 string exceeds size limit");
            }
            module.constants.push_back(Constant::utf8_string(
                reader.string(size)
            ));
        } else {
            throw BytecodeError("unknown encoded constant kind");
        }
    }

    for (std::uint32_t index = 0; index < function_count; ++index) {
        Function function;
        function.name_constant = reader.u32();
        function.parameter_count = reader.u32();
        function.return_type = static_cast<ValueType>(reader.u8());
        const std::uint32_t local_count = reader.u32();
        if (local_count > detail::maximum_collection_size) {
            throw BytecodeError("encoded local list exceeds size limit");
        }
        function.local_types.reserve(local_count);
        for (std::uint32_t local = 0; local < local_count; ++local) {
            function.local_types.push_back(
                static_cast<ValueType>(reader.u8())
            );
        }
        const std::uint32_t instruction_count = reader.u32();
        if (instruction_count > detail::maximum_collection_size) {
            throw BytecodeError("encoded instruction list exceeds size limit");
        }
        function.instructions.reserve(instruction_count);
        for (std::uint32_t instruction = 0;
             instruction < instruction_count;
             ++instruction) {
            function.instructions.push_back({
                static_cast<Opcode>(reader.u16()),
                static_cast<ValueType>(reader.u8()),
                reader.u32(),
                reader.u32(),
            });
        }
        module.functions.push_back(std::move(function));
    }

    if (!reader.done()) {
        throw BytecodeError("trailing data after bytecode module");
    }
    validate(module);
    return module;
}

}  // namespace vkf::wasm::bytecode
