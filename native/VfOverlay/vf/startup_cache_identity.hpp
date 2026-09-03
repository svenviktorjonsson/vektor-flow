#pragma once

#include <array>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <utility>

namespace vf {

struct StartupCacheIdentityInputs {
    std::string compiled_scene_hash;
    std::string topology_hash;
    std::string buffer_hash;
    std::string wgsl_hash;
    std::string pipeline_state_hash;
    std::string renderer_version;
    std::string runtime_version;
    std::string edge_runtime_version;
    std::string gpu_adapter_identity;
    std::string gpu_driver_identity;

    bool operator==(const StartupCacheIdentityInputs&) const = default;
};

namespace startup_cache_detail {

inline void HashFramed(std::uint64_t& hash, std::string_view value) {
    constexpr std::uint64_t prime = 1099511628211ull;
    const std::string length = std::to_string(value.size());
    for (const unsigned char byte : length) {
        hash ^= byte;
        hash *= prime;
    }
    hash ^= static_cast<unsigned char>(':');
    hash *= prime;
    for (const unsigned char byte : value) {
        hash ^= byte;
        hash *= prime;
    }
    hash ^= static_cast<unsigned char>(';');
    hash *= prime;
}

template <std::size_t Size>
inline std::string Token(const std::array<std::string_view, Size>& fields) {
    std::uint64_t hash = 14695981039346656037ull;
    HashFramed(hash, "vektor-flow/startup-cache-identity-v1");
    for (const auto field : fields) HashFramed(hash, field);

    constexpr char hex[] = "0123456789abcdef";
    std::string token(16, '0');
    for (int index = 15; index >= 0; --index) {
        token[static_cast<std::size_t>(index)] = hex[hash & 0xfull];
        hash >>= 4;
    }
    return token;
}

}  // namespace startup_cache_detail

class StartupCacheIdentity {
public:
    static std::optional<StartupCacheIdentity> Build(
        StartupCacheIdentityInputs inputs) {
        const std::array<std::string_view, 10> fields{
            inputs.compiled_scene_hash,
            inputs.topology_hash,
            inputs.buffer_hash,
            inputs.wgsl_hash,
            inputs.pipeline_state_hash,
            inputs.renderer_version,
            inputs.runtime_version,
            inputs.edge_runtime_version,
            inputs.gpu_adapter_identity,
            inputs.gpu_driver_identity,
        };
        for (const auto field : fields) {
            if (field.empty()) return std::nullopt;
        }
        return StartupCacheIdentity(std::move(inputs));
    }

    const std::string& namespace_token() const { return namespace_token_; }
    const std::string& compiler_payload_token() const {
        return compiler_payload_token_;
    }

    bool operator==(const StartupCacheIdentity& other) const {
        // Tokens select a namespace; exact fields validate it, so even a token
        // collision cannot turn changed content or platform state into a hit.
        return namespace_token_ == other.namespace_token_ &&
               inputs_ == other.inputs_;
    }

private:
    explicit StartupCacheIdentity(StartupCacheIdentityInputs inputs)
        : inputs_(std::move(inputs)),
          compiler_payload_token_(startup_cache_detail::Token(
              std::array<std::string_view, 7>{
                  inputs_.compiled_scene_hash,
                  inputs_.topology_hash,
                  inputs_.buffer_hash,
                  inputs_.wgsl_hash,
                  inputs_.pipeline_state_hash,
                  inputs_.renderer_version,
                  inputs_.runtime_version,
              })),
          namespace_token_(startup_cache_detail::Token(
              std::array<std::string_view, 10>{
                  inputs_.compiled_scene_hash,
                  inputs_.topology_hash,
                  inputs_.buffer_hash,
                  inputs_.wgsl_hash,
                  inputs_.pipeline_state_hash,
                  inputs_.renderer_version,
                  inputs_.runtime_version,
                  inputs_.edge_runtime_version,
                  inputs_.gpu_adapter_identity,
                  inputs_.gpu_driver_identity,
              })) {}

    StartupCacheIdentityInputs inputs_;
    std::string compiler_payload_token_;
    std::string namespace_token_;
};

struct StartupCacheEntry {
    StartupCacheIdentity identity;
    std::string compiler_retained_payload_token;
    bool compiler_retained_payload_available = false;
};

// This gate owns only retained compiler data: scene/topology/buffer bytes, WGSL,
// and pipeline descriptors. Edge and the native GPU driver own their caches.
// WebGPU objects are deliberately recreated on the current device and are never
// represented here as portable serialized pipelines.
class StartupCacheAdmission {
public:
    explicit StartupCacheAdmission(StartupCacheIdentity expected)
        : expected_(std::move(expected)) {}

    bool TryReuse(const StartupCacheEntry& candidate) {
        reusable_entry_ = nullptr;
        webgpu_device_ready_ = false;
        pipelines_recreated_ = false;
        first_frame_validated_ = false;
        revealed_ = false;
        if (!(candidate.identity == expected_) ||
            !candidate.compiler_retained_payload_available ||
            candidate.compiler_retained_payload_token !=
                expected_.compiler_payload_token()) {
            return false;
        }
        reusable_entry_ = &candidate;
        return true;
    }

    const StartupCacheEntry* reusable_entry() const { return reusable_entry_; }

    bool pipelines_must_be_recreated() const { return !pipelines_recreated_; }

    void MarkWebGpuDeviceReady() {
        if (reusable_entry_ != nullptr) webgpu_device_ready_ = true;
    }

    void MarkPipelinesRecreated() {
        if (webgpu_device_ready_) pipelines_recreated_ = true;
    }

    void MarkFirstFrameValidated() {
        if (pipelines_recreated_) first_frame_validated_ = true;
    }

    bool CommitReveal() {
        if (revealed_ || reusable_entry_ == nullptr ||
            !webgpu_device_ready_ || !pipelines_recreated_ ||
            !first_frame_validated_) {
            return false;
        }
        revealed_ = true;
        return true;
    }

private:
    StartupCacheIdentity expected_;
    const StartupCacheEntry* reusable_entry_ = nullptr;
    bool webgpu_device_ready_ = false;
    bool pipelines_recreated_ = false;
    bool first_frame_validated_ = false;
    bool revealed_ = false;
};

}  // namespace vf
