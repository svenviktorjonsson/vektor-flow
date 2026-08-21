#pragma once

#include "native/VfOverlay/vf/json.hpp"

#include <cstddef>
#include <filesystem>
#include <stdexcept>
#include <string>

namespace vkf_x64_backend {

struct ArtifactResult {
    std::filesystem::path artifact_path;
    std::filesystem::path manifest_path;
    std::filesystem::path machine_ir_path;
    std::size_t code_bytes = 0;
};

struct SupportResult {
    bool supported = false;
    std::string reason;
};

class Unsupported : public std::runtime_error {
public:
    explicit Unsupported(const std::string& reason) : std::runtime_error(reason) {}
};

bool supports(const vf::JsonValue& typed_ir) noexcept;
SupportResult inspect(const vf::JsonValue& typed_ir) noexcept;

ArtifactResult compile(
    const vf::JsonValue& typed_ir,
    const std::filesystem::path& source,
    const std::filesystem::path& typed_ir_path,
    const std::filesystem::path& runner_template,
    bool emit_debug_files = true
);

}  // namespace vkf_x64_backend
