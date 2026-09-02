#pragma once

#include "native/material/vf_deterministic_packet_reference.hpp"
#include "native/material/vf_forest_tree_material_pipeline.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <utility>
#include <vector>

namespace vf::material {

struct ForestTreeCameraResidencyDefinition {
    ForestTreeMaterialPipelineDefinition pipeline;
    std::size_t bundle_capacity;
};

struct ForestTreeCameraResidencyEntry {
    std::uint64_t tree_id;
    std::vector<std::uint8_t> bytes;
    std::uint64_t last_used;
};

struct ForestTreeCameraResidencyState {
    std::vector<ForestTreeCameraResidencyEntry> cache;
    std::uint64_t tick;
    std::size_t upload_bytes;
    std::size_t resident_bytes;
    std::vector<std::uint64_t> evicted_tree_ids;
    std::uint64_t frame_version;
    std::uint64_t cache_version;
};

inline bool ForestTreeCameraContains(
    const std::vector<std::uint64_t>& ordered_tree_ids,
    std::uint64_t tree_id
) {
    return std::binary_search(
        ordered_tree_ids.begin(),
        ordered_tree_ids.end(),
        tree_id
    );
}

inline std::uint64_t ForestTreeCameraCacheVersion(
    const std::vector<ForestTreeCameraResidencyEntry>& cache
) {
    std::vector<std::uint8_t> bytes;
    bytes.reserve(
        cache.size() *
        (sizeof(std::uint64_t) +
         kForestTreeMaterialBundleBytes)
    );
    for (const auto& entry : cache) {
        AppendDeterministicPacketWord64(bytes, entry.tree_id);
        bytes.insert(
            bytes.end(),
            entry.bytes.begin(),
            entry.bytes.end()
        );
    }
    return HashDeterministicPacketBytes(bytes);
}

inline ForestTreeCameraResidencyState
UpdateForestTreeCameraResidencyReference(
    const ForestTreeCameraResidencyDefinition& definition,
    const ForestPopulationRealization& forest,
    const std::vector<std::uint64_t>& demanded_tree_ids,
    const ForestTreeCameraResidencyState* previous
) {
    if (definition.bundle_capacity == 0) {
        throw std::invalid_argument(
            "forest tree camera cache capacity is zero"
        );
    }
    if (demanded_tree_ids.size() > definition.bundle_capacity) {
        throw std::range_error(
            "forest tree camera demand exceeds cache capacity"
        );
    }
    auto realization =
        RealizeForestTreeMaterialPipelineReference(
            definition.pipeline,
            forest,
            demanded_tree_ids,
            demanded_tree_ids.size()
        );
    auto frame_bytes =
        PackForestTreeMaterialPipelineBytesReference(realization);
    if (frame_bytes.size() !=
        realization.bundles.size() *
            kForestTreeMaterialBundleBytes) {
        throw std::logic_error(
            "forest tree camera packet layout is invalid"
        );
    }
    std::vector<std::uint64_t> ordered_tree_ids;
    ordered_tree_ids.reserve(realization.bundles.size());
    for (const auto& bundle : realization.bundles) {
        ordered_tree_ids.push_back(bundle.population.tree_id);
    }
    auto cache = previous == nullptr
        ? std::vector<ForestTreeCameraResidencyEntry>{}
        : previous->cache;
    const std::uint64_t tick = previous == nullptr
        ? 1
        : previous->tick + 1;
    std::size_t upload_bytes = 0;
    for (std::size_t index = 0;
         index < ordered_tree_ids.size();
         ++index) {
        const auto begin = frame_bytes.begin() +
            static_cast<std::ptrdiff_t>(
                index * kForestTreeMaterialBundleBytes
            );
        const auto end = begin +
            static_cast<std::ptrdiff_t>(
                kForestTreeMaterialBundleBytes
            );
        std::vector<std::uint8_t> bundle_bytes(begin, end);
        const std::uint64_t tree_id = ordered_tree_ids[index];
        const auto found = std::find_if(
            cache.begin(),
            cache.end(),
            [tree_id](const auto& entry) {
                return entry.tree_id == tree_id;
            }
        );
        if (found == cache.end()) {
            cache.push_back(
                {tree_id, std::move(bundle_bytes), tick}
            );
            upload_bytes += kForestTreeMaterialBundleBytes;
        } else {
            if (found->bytes != bundle_bytes) {
                found->bytes = std::move(bundle_bytes);
                upload_bytes += kForestTreeMaterialBundleBytes;
            }
            found->last_used = tick;
        }
    }
    std::vector<std::uint64_t> evicted_tree_ids;
    while (cache.size() > definition.bundle_capacity) {
        auto victim = cache.end();
        for (auto entry = cache.begin(); entry != cache.end(); ++entry) {
            if (ForestTreeCameraContains(
                    ordered_tree_ids,
                    entry->tree_id
                )) {
                continue;
            }
            if (victim == cache.end() ||
                entry->last_used < victim->last_used ||
                (entry->last_used == victim->last_used &&
                 entry->tree_id < victim->tree_id)) {
                victim = entry;
            }
        }
        if (victim == cache.end()) {
            throw std::logic_error(
                "forest tree camera cannot evict demanded bundle"
            );
        }
        evicted_tree_ids.push_back(victim->tree_id);
        cache.erase(victim);
    }
    std::sort(
        cache.begin(),
        cache.end(),
        [](const auto& first, const auto& second) {
            return first.tree_id < second.tree_id;
        }
    );
    std::sort(
        evicted_tree_ids.begin(),
        evicted_tree_ids.end()
    );
    const std::size_t resident_bytes = cache.size() *
        kForestTreeMaterialBundleBytes;
    const std::uint64_t cache_version =
        ForestTreeCameraCacheVersion(cache);
    return {
        std::move(cache),
        tick,
        upload_bytes,
        resident_bytes,
        std::move(evicted_tree_ids),
        HashDeterministicPacketBytes(frame_bytes),
        cache_version,
    };
}

}  // namespace vf::material
