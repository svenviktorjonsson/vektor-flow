#pragma once

// Test-only inspection seam. Not part of the production frontend or its JSON API.
#ifdef VKF_PRIVATE_UI_EFFECTS_TEST_PROBE
#include "native/VfOverlay/vf/json.hpp"
namespace vkf::native_frontend::private_ui_probe {
vf::JsonValue lower_execution_value(const vf::JsonValue& ast);
}
#endif
