#include "native/material/vf_terrain_material_association.hpp"
#include <iostream>
#include <bit>
#include <limits>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

namespace {
void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}
template<class Function> void rejects(Function&& call, std::string_view message) {
    try { call(); } catch (const std::exception& error) {
        require(error.what() == message, "changed rejection diagnostic");
        return;
    }
    throw std::runtime_error("invalid input was accepted");
}
std::vector<char> trace;
void word(std::uint64_t value) {
    for (unsigned byte = 0; byte < 8; ++byte) trace.push_back(static_cast<char>((value >> (byte * 8)) & 255));
}
void real(double value) { word(std::bit_cast<std::uint64_t>(value)); }
void string(std::string_view value) {
    word(value.size());
    trace.insert(trace.end(), value.begin(), value.end());
}
void record(const vf::material::ResearchedMaterialPreset& value) {
    word(static_cast<unsigned>(value.family)); string(value.stable_id); string(value.spectral.subset_id);
    const auto& fit = value.spectral.fit;
    for (const auto v : fit.wavelengths_nm) word(v);
    for (const auto* values : {&fit.spectral_reflectance, &fit.base_color_proxy, &fit.band_rmse,
        &fit.band_standard_error, &fit.normalized_rmse}) for (const auto v : *values) real(v);
    word(fit.observation_count);
    const auto& p = value.spectral.provenance;
    word(static_cast<unsigned>(p.kind)); word(p.generator_version);
    for (const auto text : {p.source, p.source_version, p.license, p.license_url, p.units,
        p.measurement_conditions, p.fit_method, p.uncertainty, p.authoring_note}) string(text);
    const auto evidence = [](const vf::material::MaterialOpticalEvidence& e) {
        word(static_cast<unsigned>(e.family)); word(static_cast<unsigned>(e.evidence_class));
        for (const auto text : {e.stable_id, e.property, e.source_url, e.source_version, e.license,
            e.license_url, e.conditions, e.uncertainty, e.limitation}) string(text);
    };
    word(value.optical_index.has_value());
    if (value.optical_index) {
        const auto& optical = *value.optical_index;
        word(static_cast<unsigned>(optical.scope));
        for (const auto v : {optical.fit.index_of_refraction, optical.fit.fresnel_f0, optical.fit.rmse,
            optical.fit.standard_error, optical.fit.normalized_rmse}) real(v);
        word(optical.fit.observation_count); evidence(optical.evidence);
    }
    word(value.directional_diffuse.has_value());
    if (value.directional_diffuse) {
        const auto& directional = *value.directional_diffuse;
        word(static_cast<unsigned>(directional.semantic));
        real(directional.albedo); real(directional.oren_nayar_roughness); real(directional.weighted_normalized_rmse);
        evidence(directional.evidence);
    }
}
}
int main(int argc, char** argv) try {
#ifdef _WIN32
    _setmode(_fileno(stdout), _O_BINARY);
    _setmode(_fileno(stderr), _O_BINARY);
#endif
    using namespace vf::material;
    const TerrainHeightCondition condition{{{1, 2}, {3, 4}}, 0.125, 0, 2};
    const auto terrain = RealizeTerrainTileReference(condition, {-1, 2}, 3, 81);
    const auto surface = std::make_shared<const TerrainSurfacePacket>(AssembleTerrainSurfacePacketReference(
        DeriveTerrainNormalsReference(terrain, 0.015625),
        BindTerrainWaterLevelMaterialsReference(terrain, 0, 101, 202)));
    // Existing researched records are arbitrary explicit assignments, not sand
    // presets or evidence that any material belongs at this terrain location.
    const auto stone = std::make_shared<const ResearchedMaterialPreset>(BuildResearchedMaterialPresetV1(MaterialOpticalFamily::stone));
    const auto leaf = std::make_shared<const ResearchedMaterialPreset>(BuildResearchedMaterialPresetV1(MaterialOpticalFamily::vegetation));
    const auto table = std::make_shared<const TerrainMaterialTable>(TerrainMaterialTable{{202, leaf}, {101, stone}});
    const auto associated = AssociateTerrainMaterialsReference(surface, table, 81);
    require(associated.source == surface && associated.table == table, "association lost source or table ownership");
    require(associated.records.size() == 81 && !associated.truncated, "association lost selected samples");
    for (std::size_t i = 0; i < 81; ++i)
        require(associated.records[i] == (surface->material_ids[i] == 101 ? stone : leaf), "association selected a different record");
    const auto duplicate = std::make_shared<const TerrainMaterialTable>(TerrainMaterialTable{{202, leaf}, {101, stone}, {101, leaf}});
    rejects([&] { AssociateTerrainMaterialsReference(surface, duplicate, 81); }, "terrain material table ID is duplicated");
    auto invalid_record = std::make_shared<ResearchedMaterialPreset>(*stone);
    invalid_record->stable_id = {};
    const auto invalid_table = std::make_shared<const TerrainMaterialTable>(TerrainMaterialTable{{101, invalid_record}, {202, leaf}});
    rejects([&] { AssociateTerrainMaterialsReference(surface, invalid_table, 0); }, "researched spectral preset identity is invalid");
    const auto missing = std::make_shared<const TerrainMaterialTable>(TerrainMaterialTable{});
    rejects([&] { AssociateTerrainMaterialsReference(surface, missing, 1); }, "terrain material ID has no record");
    auto stale_surface = std::make_shared<TerrainSurfacePacket>(*surface);
    stale_surface->water_level = -100;
    rejects([&] { AssociateTerrainMaterialsReference(stale_surface, table, 0); },
        "terrain material association does not match retained level");
    rejects([&] { AssociateTerrainMaterialsReference(surface, table, 65537); },
        "terrain material sample budget must be from 0 to 65536");
    rejects([&] { AssociateTerrainMaterialsReference(nullptr, nullptr, 65537); }, "terrain surface working set is required");
    rejects([&] { AssociateTerrainMaterialsReference(surface, nullptr, 65537); }, "terrain material table is required");
    const auto null_record = std::make_shared<const TerrainMaterialTable>(TerrainMaterialTable{{101, nullptr}});
    rejects([&] { AssociateTerrainMaterialsReference(surface, null_record, 0); }, "terrain material record is required");
    rejects([&] { AssociateTerrainMaterialsReference(surface, duplicate, 0); }, "terrain material table ID is duplicated");
    auto large_table = std::make_shared<TerrainMaterialTable>(65537, TerrainMaterialEntry{101, stone});
    rejects([&] { AssociateTerrainMaterialsReference(surface, large_table, 65537); },
        "terrain material table must contain at most 65536 records");
    *stale_surface = *surface;
    stale_surface->water_level = std::numeric_limits<double>::infinity();
    rejects([&] { AssociateTerrainMaterialsReference(stale_surface, nullptr, 65537); }, "terrain water level must be finite");
    *stale_surface = *surface;
    stale_surface->material_ids[0] ^= 1;
    rejects([&] { AssociateTerrainMaterialsReference(stale_surface, table, 0); },
        "terrain material association does not match retained level");
    *stale_surface = *surface;
    stale_surface->vertices[0][0] += 1;
    rejects([&] { AssociateTerrainMaterialsReference(stale_surface, table, 81); },
        "terrain surface must align with source positions and materials");
    const auto empty = AssociateTerrainMaterialsReference(surface, missing, 0);
    require(empty.records.empty() && empty.records.capacity() == 0 && empty.truncated, "zero budget allocated records");
    const auto first_id = surface->material_ids[0];
    const auto first_record = first_id == 101 ? stone : leaf;
    const auto sparse = std::make_shared<const TerrainMaterialTable>(TerrainMaterialTable{{first_id, first_record}});
    require(AssociateTerrainMaterialsReference(surface, sparse, 1).records[0] == first_record,
        "unselected missing IDs affected a selected prefix");
    const auto reverse_table = std::make_shared<const TerrainMaterialTable>(TerrainMaterialTable{{101, stone}, {202, leaf}});
    require(AssociateTerrainMaterialsReference(surface, reverse_table, 81).records == associated.records,
        "table order changed associated records");
    const auto presets = BuildResearchedMaterialPresetsV1();
    for (const auto& preset : presets) record(preset);
    for (const auto seed : {1u, 67u}) {
        auto field = condition;
        field.stream.key[0] = seed;
        for (const auto refinement : {3u, 8u}) {
            const auto available = refinement == 3 ? 81u : 65536u;
            const auto source = RealizeTerrainTileReference(field, {-1, 2}, refinement, available);
            const auto normals = DeriveTerrainNormalsReference(source, 0.015625);
            for (const double level : {-0.5, 0.0, 0.5}) {
                const auto packet = std::make_shared<const TerrainSurfacePacket>(AssembleTerrainSurfacePacketReference(
                    normals, BindTerrainWaterLevelMaterialsReference(source, level, 101, 202)));
                for (const auto cap : {0u, 1u, available}) {
                    const auto selected = AssociateTerrainMaterialsReference(packet, table, cap);
                    require(selected.source == packet && selected.table == table && selected.records.size() == cap &&
                        selected.records.capacity() == cap && selected.truncated == (cap < available), "bounded identity changed");
                    require(AssociateTerrainMaterialsReference(packet, reverse_table, cap).records == selected.records,
                        "replay/table permutation changed records");
                    const bool capture = refinement == 3 || (seed == 1 && level == 0);
                    if (capture) { word(seed); word(refinement); real(level); word(cap); word(selected.truncated); }
                    for (std::size_t i = 0; i < cap; ++i) {
                        const auto expected = source->positions[i][1] <= level ? leaf : stone;
                        require(selected.records[i] == expected, "source-order ID association changed");
                        if (capture) {
                            word(packet->material_ids[i]); word(static_cast<unsigned>(selected.records[i]->family));
                            for (const auto value : packet->vertices[i]) real(value);
                        }
                    }
                }
            }
        }
    }
    // Complete table cap is explicit input, not a generated material population.
    large_table->resize(65536);
    for (std::size_t i = 0; i < large_table->size(); ++i) (*large_table)[i] = {static_cast<std::uint32_t>(i), stone};
    const auto full_table_result = AssociateTerrainMaterialsReference(surface, large_table, 81);
    for (const auto& selected : full_table_result.records) require(selected == stone, "full table selected another record");
    if (argc == 2 && std::string_view(argv[1]) == "--trace") {
        std::cout.write(trace.data(), static_cast<std::streamsize>(trace.size()));
    } else {
        require(argc == 1, "association test mode is invalid");
        std::cout << "terrain material association: source=owned records=exact\n";
    }
} catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
}
