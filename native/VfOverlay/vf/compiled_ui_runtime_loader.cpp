#include "vf/compiled_ui_runtime_loader.hpp"

#include "vf/compiled_ui_runtime_registry.hpp"

#include <stdexcept>
#include <utility>

namespace vf {

namespace {

template <typename T>
T LoadProc(HMODULE module, const char* name) {
    FARPROC proc = ::GetProcAddress(module, name);
    if (proc == nullptr) {
        throw std::runtime_error(std::string("missing export: ") + name);
    }
    return reinterpret_cast<T>(proc);
}

std::string LastErrorString() {
    const DWORD error = ::GetLastError();
    return "win32 error " + std::to_string(static_cast<unsigned long>(error));
}

}  // namespace

CompiledUiRuntimeModule::CompiledUiRuntimeModule(HMODULE module, VfCompiledUiExports exports) noexcept
    : module_(module), exports_(exports) {}

CompiledUiRuntimeModule::CompiledUiRuntimeModule(CompiledUiRuntimeModule&& other) noexcept
    : module_(other.module_), exports_(other.exports_) {
    other.module_ = nullptr;
    other.exports_ = {};
}

CompiledUiRuntimeModule& CompiledUiRuntimeModule::operator=(CompiledUiRuntimeModule&& other) noexcept {
    if (this != &other) {
        Reset();
        module_ = other.module_;
        exports_ = other.exports_;
        other.module_ = nullptr;
        other.exports_ = {};
    }
    return *this;
}

CompiledUiRuntimeModule::~CompiledUiRuntimeModule() {
    Reset();
}

CompiledUiRuntimeModule CompiledUiRuntimeModule::LoadFromPath(const std::wstring& path) {
    HMODULE module = ::LoadLibraryExW(path.c_str(), nullptr, LOAD_WITH_ALTERED_SEARCH_PATH);
    if (module == nullptr) {
        throw std::runtime_error("LoadLibraryExW failed: " + LastErrorString());
    }
    try {
        using ExportsFn = VfCompiledUiExports (*)();
        ExportsFn exportsFn = reinterpret_cast<ExportsFn>(::GetProcAddress(module, "VkfCompiledUiRectDemoExports"));
        VfCompiledUiExports exports{};
        if (exportsFn != nullptr) {
            exports = exportsFn();
        } else {
            exports.init = LoadProc<VfInitFn>(module, "VkfCompiledUiRectDemoInit");
            exports.update = LoadProc<VfUpdateFn>(module, "VkfCompiledUiRectDemoUpdate");
            exports.shutdown = LoadProc<VfShutdownFn>(module, "VkfCompiledUiRectDemoShutdown");
        }
        if (exports.init == nullptr || exports.update == nullptr) {
            throw std::runtime_error("compiled UI module did not expose required exports");
        }
        return CompiledUiRuntimeModule(module, exports);
    } catch (...) {
        ::FreeLibrary(module);
        throw;
    }
}

std::optional<CompiledUiRuntimeModule> CompiledUiRuntimeModule::LoadBuiltinFromDirectory(const std::wstring& directory,
                                                                                         const std::wstring& name) {
    auto resolved = ResolveBuiltinCompiledUiRuntimeModulePath(directory, name);
    if (!resolved.has_value()) {
        return std::nullopt;
    }
    return LoadFromPath(*resolved);
}

std::int32_t CompiledUiRuntimeModule::RunBootstrapOnce(VfRuntimeApi* api, const VfInputSnapshot* input) const {
    if (api == nullptr || exports_.init == nullptr || exports_.update == nullptr) {
        return -1;
    }
    const std::int32_t initResult = exports_.init(api);
    if (initResult != 0) {
        return initResult;
    }
    VfInputSnapshot defaultInput{};
    const std::int32_t updateResult = exports_.update(input ? input : &defaultInput, api);
    if (exports_.shutdown != nullptr) {
        exports_.shutdown(api);
    }
    return updateResult;
}

std::optional<CompiledUiRuntimeModule> BootstrapBuiltinCompiledUiModule(const std::wstring& directory,
                                                                        const std::wstring& name,
                                                                        VfRuntimeApi* api,
                                                                        const VfInputSnapshot* input) {
    auto module = CompiledUiRuntimeModule::LoadBuiltinFromDirectory(directory, name);
    if (!module.has_value()) {
        return std::nullopt;
    }
    module->RunBootstrapOnce(api, input);
    return module;
}

void CompiledUiRuntimeModule::Reset() noexcept {
    if (module_ != nullptr) {
        ::FreeLibrary(module_);
        module_ = nullptr;
    }
    exports_ = {};
}

}  // namespace vf
