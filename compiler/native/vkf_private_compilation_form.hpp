#pragma once

#include "native/VfOverlay/vf/json.hpp"

// Compiler-internal ownership only. Neither this type nor execution_ir is a
// serialized frontend schema or a browser export. Public lower_value is unchanged.
namespace vkf::native_frontend::private_compilation {
struct Module {
    vf::JsonValue canonical_ir;
    // Null when no private retained effects exist; avoid a second full IR copy.
    vf::JsonValue execution_ir;
};
Module lower_module(const vf::JsonValue& ast);
}
