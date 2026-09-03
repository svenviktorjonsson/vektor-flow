#include "vf/startup_cache_identity.hpp"

#include <array>
#include <functional>
#include <stdexcept>
#include <string>

namespace {

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

vf::StartupCacheIdentityInputs baseline_inputs() {
    return {
        .compiled_scene_hash = "scene:a1",
        .topology_hash = "topology:b2",
        .buffer_hash = "buffers:c3",
        .wgsl_hash = "wgsl:d4",
        .pipeline_state_hash = "pipeline-state:e5",
        .renderer_version = "renderer:0.4.1",
        .runtime_version = "runtime:0.4.1",
        .edge_runtime_version = "edge:140.0.3485.81",
        .gpu_adapter_identity = "adapter:10de:2684:luid-0001",
        .gpu_driver_identity = "driver:32.0.15.7283",
    };
}

}  // namespace

int main() {
    const auto expected = vf::StartupCacheIdentity::Build(baseline_inputs());
    require(expected.has_value(), "complete identity must be accepted");
    require(
        expected->namespace_token() ==
            vf::StartupCacheIdentity::Build(baseline_inputs())->namespace_token(),
        "same identity must produce a deterministic namespace token");
    require(expected->compiler_payload_token() == "f8d711f331d68c16",
            "compiler payload token must be stable across builds");
    require(expected->namespace_token() == "fbd77241e2a027a2",
            "startup namespace token must be stable across builds");

    auto missing_driver = baseline_inputs();
    missing_driver.gpu_driver_identity.clear();
    require(!vf::StartupCacheIdentity::Build(missing_driver).has_value(),
            "incomplete platform identity must not be cacheable");

    vf::StartupCacheEntry exact{
        .identity = *expected,
        .compiler_retained_payload_token = expected->compiler_payload_token(),
        .compiler_retained_payload_available = true,
    };
    vf::StartupCacheAdmission admission(*expected);
    require(admission.TryReuse(exact), "exact cache identity must be reused");
    require(admission.reusable_entry() == &exact,
            "exact hit must reuse the existing retained entry");
    require(admission.pipelines_must_be_recreated(),
            "WebGPU pipelines must never be treated as portable cache data");
    require(!admission.CommitReveal(),
            "a cache hit alone must not reveal the window");

    admission.MarkWebGpuDeviceReady();
    require(!admission.CommitReveal(),
            "device readiness must not imply pipeline readiness");
    admission.MarkPipelinesRecreated();
    require(!admission.CommitReveal(),
            "pipeline recreation must not imply a validated first frame");
    admission.MarkFirstFrameValidated();
    require(admission.CommitReveal(),
            "validated cache, recreated pipelines, and first frame may reveal");
    require(!admission.CommitReveal(), "atomic reveal must commit only once");

    using Mutation = std::function<void(vf::StartupCacheIdentityInputs&)>;
    const std::array<Mutation, 10> mutations{
        [](auto& in) { in.compiled_scene_hash += ":changed"; },
        [](auto& in) { in.topology_hash += ":changed"; },
        [](auto& in) { in.buffer_hash += ":changed"; },
        [](auto& in) { in.wgsl_hash += ":changed"; },
        [](auto& in) { in.pipeline_state_hash += ":changed"; },
        [](auto& in) { in.renderer_version += ":changed"; },
        [](auto& in) { in.runtime_version += ":changed"; },
        [](auto& in) { in.edge_runtime_version += ":changed"; },
        [](auto& in) { in.gpu_adapter_identity += ":changed"; },
        [](auto& in) { in.gpu_driver_identity += ":changed"; },
    };
    for (std::size_t index = 0; index < mutations.size(); ++index) {
        auto changed_inputs = baseline_inputs();
        mutations[index](changed_inputs);
        const auto changed = vf::StartupCacheIdentity::Build(changed_inputs);
        require(changed.has_value(), "changed complete identity must be valid");
        require(changed->namespace_token() != expected->namespace_token(),
                "every identity component must invalidate the namespace");
        if (index >= 7) {
            require(changed->compiler_payload_token() ==
                        expected->compiler_payload_token(),
                    "Edge, adapter, and driver changes must preserve the "
                    "compiler-owned payload identity");
        } else {
            require(changed->compiler_payload_token() !=
                        expected->compiler_payload_token(),
                    "compiled data or renderer/runtime changes must invalidate "
                    "the compiler-owned payload identity");
        }
        vf::StartupCacheAdmission miss(*expected);
        vf::StartupCacheEntry changed_entry{
            .identity = *changed,
            .compiler_retained_payload_token =
                changed->compiler_payload_token(),
            .compiler_retained_payload_available = true,
        };
        require(!miss.TryReuse(changed_entry),
                "changed identity must not reuse retained data");
        miss.MarkWebGpuDeviceReady();
        miss.MarkPipelinesRecreated();
        miss.MarkFirstFrameValidated();
        require(!miss.CommitReveal(),
                "an invalid cache entry must never authorize reveal");
    }

    auto corrupt = exact;
    corrupt.compiler_retained_payload_token = "corrupt";
    vf::StartupCacheAdmission corrupt_admission(*expected);
    require(!corrupt_admission.TryReuse(corrupt),
            "retained compiler data must pass content validation");

    return 0;
}
