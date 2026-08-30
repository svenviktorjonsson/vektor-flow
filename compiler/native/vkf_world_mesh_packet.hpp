#pragma once

#include <array>
#include <cmath>
#include <cstdint>
#include <iomanip>
#include <initializer_list>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace vkf::world_mesh {

struct CompiledMesh {
    std::vector<double> vertices;
    std::vector<std::uint32_t> indices;
    std::array<double, 4> base_color{};
    std::uint64_t material_id = 0;
};

inline std::string number_array_json(const std::vector<double>& values) {
    std::ostringstream out;
    out << "[";
    for (std::size_t index = 0; index < values.size(); ++index) {
        if (index > 0) out << ",";
        out << std::setprecision(17) << values[index];
    }
    out << "]";
    return out.str();
}

inline std::string index_array_json(const std::vector<std::uint32_t>& values) {
    std::ostringstream out;
    out << "[";
    for (std::size_t index = 0; index < values.size(); ++index) {
        if (index > 0) out << ",";
        out << values[index];
    }
    out << "]";
    return out.str();
}

inline CompiledMesh compile(
    const std::vector<double>& positions,
    const std::vector<double>& topology,
    const std::vector<double>& colors,
    const std::vector<double>& materials
) {
    if (positions.size() < 9 || positions.size() % 3 != 0) {
        throw std::runtime_error(
            "typed World mesh positions must contain at least three 3D positions");
    }
    const std::size_t vertex_count = positions.size() / 3;
    if (topology.empty() || topology.size() % 3 != 0) {
        throw std::runtime_error(
            "typed World mesh topology must contain triangle index triples");
    }
    if (colors.size() != 4 && colors.size() != vertex_count * 4) {
        throw std::runtime_error(
            "typed World mesh color must contain one RGBA or one RGBA per position");
    }
    if (materials.size() != 1 || !std::isfinite(materials.front()) ||
        materials.front() < 0.0 || std::floor(materials.front()) != materials.front() ||
        materials.front() > 9007199254740991.0) {
        throw std::runtime_error(
            "typed World mesh material must contain one nonnegative integer id");
    }

    CompiledMesh mesh;
    mesh.material_id = static_cast<std::uint64_t>(materials.front());
    for (std::size_t component = 0; component < 4; ++component) {
        mesh.base_color[component] = colors[component];
    }
    mesh.indices.reserve(topology.size());
    for (double raw_index : topology) {
        if (!std::isfinite(raw_index) || raw_index < 0.0 ||
            std::floor(raw_index) != raw_index || raw_index >= vertex_count ||
            raw_index > static_cast<double>(std::numeric_limits<std::uint32_t>::max())) {
            throw std::runtime_error(
                "typed World mesh topology indices must reference positions");
        }
        mesh.indices.push_back(static_cast<std::uint32_t>(raw_index));
    }

    std::vector<double> normals(positions.size(), 0.0);
    for (std::size_t triangle = 0; triangle < mesh.indices.size(); triangle += 3) {
        const std::size_t a = static_cast<std::size_t>(mesh.indices[triangle]) * 3;
        const std::size_t b = static_cast<std::size_t>(mesh.indices[triangle + 1]) * 3;
        const std::size_t c = static_cast<std::size_t>(mesh.indices[triangle + 2]) * 3;
        const double ab_x = positions[b] - positions[a];
        const double ab_y = positions[b + 1] - positions[a + 1];
        const double ab_z = positions[b + 2] - positions[a + 2];
        const double ac_x = positions[c] - positions[a];
        const double ac_y = positions[c + 1] - positions[a + 1];
        const double ac_z = positions[c + 2] - positions[a + 2];
        const double nx = ab_y * ac_z - ab_z * ac_y;
        const double ny = ab_z * ac_x - ab_x * ac_z;
        const double nz = ab_x * ac_y - ab_y * ac_x;
        const double magnitude = std::sqrt(nx * nx + ny * ny + nz * nz);
        if (!(magnitude > 1e-15) || !std::isfinite(magnitude)) {
            throw std::runtime_error("typed World mesh triangles must have nonzero finite area");
        }
        for (std::size_t vertex : {a, b, c}) {
            normals[vertex] += nx;
            normals[vertex + 1] += ny;
            normals[vertex + 2] += nz;
        }
    }

    mesh.vertices.reserve(vertex_count * 10);
    for (std::size_t vertex = 0; vertex < vertex_count; ++vertex) {
        const std::size_t position_offset = vertex * 3;
        const std::size_t color_offset = colors.size() == 4 ? 0 : vertex * 4;
        double nx = normals[position_offset];
        double ny = normals[position_offset + 1];
        double nz = normals[position_offset + 2];
        const double magnitude = std::sqrt(nx * nx + ny * ny + nz * nz);
        if (magnitude > 1e-15 && std::isfinite(magnitude)) {
            nx /= magnitude;
            ny /= magnitude;
            nz /= magnitude;
        } else {
            nx = 0.0;
            ny = 0.0;
            nz = 1.0;
        }
        for (std::size_t component = 0; component < 3; ++component) {
            mesh.vertices.push_back(positions[position_offset + component]);
        }
        mesh.vertices.push_back(nx);
        mesh.vertices.push_back(ny);
        mesh.vertices.push_back(nz);
        for (std::size_t component = 0; component < 4; ++component) {
            mesh.vertices.push_back(colors[color_offset + component]);
        }
    }
    return mesh;
}

inline std::string mesh_json(
    const CompiledMesh& mesh,
    const std::string& mesh_id,
    std::uint64_t layer_id
) {
    std::ostringstream out;
    out << "{\"type\":\"field_mesh\",\"id\":\"" << mesh_id
        << "\",\"topology\":\"triangle-list\",\"mode3d\":true,\"vertices\":"
        << number_array_json(mesh.vertices)
        << ",\"indices\":" << index_array_json(mesh.indices)
        << ",\"material_id\":\"" << mesh.material_id
        << "\",\"depth_write\":true,\"no_lighting\":false,\"pickable\":true,\"layer_id\":"
        << layer_id << "}";
    return out.str();
}

inline std::string materials_json(const CompiledMesh& mesh) {
    std::ostringstream out;
    out << "{\"" << mesh.material_id << "\":{\"base_color\":["
        << std::setprecision(17) << mesh.base_color[0] << ","
        << mesh.base_color[1] << "," << mesh.base_color[2] << "," << mesh.base_color[3]
        << "],\"alpha\":" << mesh.base_color[3]
        << ",\"transparent\":" << (mesh.base_color[3] < 0.999 ? "true" : "false")
        << ",\"depth_write\":true,\"light_model\":\"blinn_phong\"}}";
    return out.str();
}

}  // namespace vkf::world_mesh
