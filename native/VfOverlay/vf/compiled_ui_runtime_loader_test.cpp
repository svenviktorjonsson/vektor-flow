#include "vf/compiled_ui_runtime_loader.hpp"
#include "vf/compiled_ui_runtime_registry.hpp"

#include <filesystem>
#include <iostream>
#include <vector>

namespace {

int Fail(const char* message) {
    std::cerr << message << std::endl;
    return 1;
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
    if (argc < 2 || argv[1] == nullptr || argv[1][0] == L'\0') {
        return Fail("usage: vf-compiled-ui-demo-loader-test <module-path> | --builtin <module-dir> <name>");
    }

    try {
        std::wstring modulePath;
        std::optional<vf::CompiledUiRuntimeModule> builtinModule;
        if (std::wstring(argv[1]) == L"--builtin") {
            if (argc < 4) {
                return Fail("usage: vf-compiled-ui-demo-loader-test --builtin <module-dir> <name>");
            }
            builtinModule = vf::CompiledUiRuntimeModule::LoadBuiltinFromDirectory(argv[2], argv[3]);
            if (!builtinModule.has_value()) {
                return Fail("builtin module could not be resolved");
            }
        } else {
            modulePath = argv[1];
        }

        vf::CompiledUiRuntimeModule module =
            builtinModule.has_value() ? std::move(*builtinModule) : vf::CompiledUiRuntimeModule::LoadFromPath(modulePath);
        if (!module) {
            return Fail("module failed to load required exports");
        }

        std::vector<float> mat4(vf::kVfTransformMat4F32, 0.0F);
        vf::VfDirtyRange dirty{};
        std::vector<double> geometry(4 * vf::kVfGeometryVertexF64, 0.0);
        vf::VfDirtyRange geometryDirty{};
        vf::VfRuntimeApi api{};
        api.transforms.mat4 = mat4.data();
        api.transforms.slot_count = 1;
        api.transforms.dirty = &dirty;
        api.geometry.xyz = geometry.data();
        api.geometry.vertex_capacity = 4;
        api.geometry.dirty = &geometryDirty;

        vf::VfInputSnapshot input{};
        input.sequence = 7;
        input.pointer_x = 123.0;
        input.pointer_y = 92.0;
        input.pointer_anchor_x = 23.0;
        input.pointer_anchor_y = 12.0;
        const std::int32_t updateResult = module.RunBootstrapOnce(&api, &input);
        if (updateResult != 7) {
            return Fail("update did not echo sequence");
        }
        if (mat4[12] != 100.0F || mat4[13] != 80.0F) {
            return Fail("update did not write expected translation");
        }
        if (geometryDirty.version == 0) {
            return Fail("update did not mark geometry dirty");
        }
        const std::vector<double> expectedGeometry{
            100.0, 80.0, 0.0,
            196.0, 80.0, 0.0,
            196.0, 144.0, 0.0,
            100.0, 144.0, 0.0,
        };
        if (geometry != expectedGeometry) {
            return Fail("update did not write expected geometry");
        }
        std::wcout << L"vf-compiled-ui-demo-loader-test passed" << std::endl;
        return 0;
    } catch (const std::exception& ex) {
        std::cerr << ex.what() << std::endl;
        return 1;
    }
}
