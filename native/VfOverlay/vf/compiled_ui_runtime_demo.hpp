#pragma once

#include "vf/compiled_ui_runtime_abi.hpp"

namespace vf {

std::int32_t CompiledUiRectDemoInit(VfRuntimeApi* api);
std::int32_t CompiledUiRectDemoUpdate(const VfInputSnapshot* input, VfRuntimeApi* api);
void CompiledUiRectDemoShutdown(VfRuntimeApi* api);
VfCompiledUiExports MakeCompiledUiRectDemoExports();

}  // namespace vf

extern "C" {

__declspec(dllexport) std::int32_t VkfCompiledUiRectDemoInit(vf::VfRuntimeApi* api);
__declspec(dllexport) std::int32_t VkfCompiledUiRectDemoUpdate(const vf::VfInputSnapshot* input, vf::VfRuntimeApi* api);
__declspec(dllexport) void VkfCompiledUiRectDemoShutdown(vf::VfRuntimeApi* api);
__declspec(dllexport) vf::VfCompiledUiExports VkfCompiledUiRectDemoExports();

}
