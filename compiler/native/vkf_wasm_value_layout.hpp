#pragma once

#include <cstdint>
#include <limits>
#include <stdexcept>

namespace vkf::wasm::values {

// Compiler-owned value layout. Legacy browser transport accepts tags 0–5;
// private emitted-program tuples and UI effects never cross the output-only
// host boundary as language values.
//   slot +0  u32 tag
//   slot +4  u32 byte length / element count / field count
//   slot +8  f64 Number, u32 Boolean, or u32 payload pointer
//   slot +12 reserved and zero
// Array payloads are contiguous u32 slot pointers. Record payloads are
// contiguous {u32 UTF-8 key slot pointer, u32 value slot pointer} entries.
// Exports: memory, vkf_vm_value_slot_size, vkf_vm_arguments_ptr/capacity,
// vkf_vm_results_ptr/capacity, vkf_vm_heap_base/ptr/limit, vkf_vm_alloc,
// vkf_vm_reset, vkf_vm_invoke, and vkf_vm_evaluate. Transport code writes
// slots and payload bytes only; expression semantics remain inside WASM.
enum class Tag : std::uint32_t {
    Null = 0,
    Boolean = 1,
    Number = 2,
    Utf8String = 3,
    Array = 4,
    Record = 5,
    Tuple = 6,
    UiEffect = 7,
    // Compiler-private stdout wrapper: length is a nominal-name string slot;
    // payload is the represented value. JavaScript never decodes this tag.
    NominalDisplay = 8,
};

inline constexpr std::uint32_t slot_alignment = 8;
inline constexpr std::uint32_t slot_size = 16;
inline constexpr std::uint32_t tag_offset = 0;
inline constexpr std::uint32_t length_offset = 4;
inline constexpr std::uint32_t payload_offset = 8;
inline constexpr std::uint32_t pointer_size = 4;
inline constexpr std::uint32_t record_entry_size = 8;
inline constexpr std::uint32_t record_key_offset = 0;
inline constexpr std::uint32_t record_value_offset = 4;
inline constexpr std::uint32_t utf8_cursor_size = 8;
inline constexpr std::uint32_t utf8_cursor_string_offset = 0;
inline constexpr std::uint32_t utf8_cursor_byte_offset = 4;

struct LayoutError : public std::runtime_error {
    explicit LayoutError(const char* message)
        : std::runtime_error(message) {}
};

inline constexpr bool is_valid_tag(std::uint32_t tag) {
    return tag <= static_cast<std::uint32_t>(Tag::Record);
}

inline std::uint32_t align_up(
    std::uint32_t value,
    std::uint32_t alignment = slot_alignment
) {
    if (alignment == 0 || (alignment & (alignment - 1U)) != 0) {
        throw LayoutError("value alignment must be a power of two");
    }
    const std::uint32_t mask = alignment - 1U;
    if (value > std::numeric_limits<std::uint32_t>::max() - mask) {
        throw LayoutError("value layout exceeds 32-bit linear memory");
    }
    return (value + mask) & ~mask;
}

inline std::uint32_t checked_bytes(
    std::uint32_t count,
    std::uint32_t stride
) {
    if (stride != 0
        && count > std::numeric_limits<std::uint32_t>::max() / stride) {
        throw LayoutError("value payload exceeds 32-bit linear memory");
    }
    return count * stride;
}

}  // namespace vkf::wasm::values
