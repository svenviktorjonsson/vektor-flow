#include "native/VfOverlay/vf/json.hpp"
#include "vkf_native_scene_lowering.hpp"
#include "vkf_retained_scene_packet.hpp"

#include <algorithm>
#include <array>
#include <cstdint>
#include <cmath>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <limits>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>
#include <tuple>
#include <utility>
#include <vector>

namespace {

constexpr const char* compiler_version = "vkf-webgpu-artifact-smoke-0.2";

class WebGpuArtifactFailure : public std::runtime_error {
public:
    explicit WebGpuArtifactFailure(std::string message)
        : std::runtime_error(std::move(message)) {}
};

struct Dependency {
    std::string name;
    std::filesystem::path path;
    std::string hash;
};

struct Binding {
    std::string name;
    enum class Kind {
        I32,
        I32Array,
        F64,
        F64Array,
    } kind;
    std::int32_t i32_value = 0;
    double f64_value = 0.0;
    std::vector<std::int32_t> i32_array_values;
    std::vector<double> f64_array_values;
    std::string axis_key;
};

struct EvaluatedBindingValue {
    bool is_array = false;
    double scalar_value = 0.0;
    std::vector<double> array_values;
    std::string axis_key;
};

struct UpdateExpr {
    enum class Kind {
        ConstI32,
        ConstF64,
        LoadState,
        LoadInput,
        LoadStateField,
        LoadInputField,
        LoadBinding,
        LoadBindingAxisElem,
        IntrinsicCall,
        BinaryOp,
    } kind;
    std::int32_t i32_value = 0;
    double f64_value = 0.0;
    std::string op;
    std::string binding_name;
    std::vector<UpdateExpr> args;
};

struct FieldDesc {
    std::string name;
    std::string type;
    std::string storage = "i32";
    std::string axis_key;
    std::size_t axis_length = 0;
    std::uint32_t offset = 0;
};

struct UpdatePlan {
    bool enabled = false;
    bool record_mode = false;
    bool axis_vector_mode = false;
    bool axis_input_vector = false;
    bool axis_float_mode = false;
    bool scalar_float_mode = false;
    std::string axis_key;
    std::size_t axis_vector_length = 0;
    std::vector<FieldDesc> state_fields;
    std::vector<FieldDesc> input_fields;
    UpdateExpr scalar_expr{UpdateExpr::Kind::ConstI32};
    std::vector<std::pair<std::string, UpdateExpr>> record_fields;
};

struct ModulePlan {
    struct RetainedSceneFeatures {
        struct ReflectiveSurface {
            std::string id;
            std::uint32_t object_index = 0;
            double reflectivity = 0.0;
            std::uint32_t aperture_byte_offset = 0;
            std::uint32_t aperture_vertex_count = 0;
            std::uint32_t aperture_vertex_stride = 40;
            std::uint32_t aperture_position_offset = 0;
        };
        struct Light {
            std::string id;
            std::uint32_t light_index = 0;
            bool casts_shadow = false;
            std::string kind;
            std::string reflect_source_id;
            std::string reflect_surface_id;
            bool show_marker = true;
            std::uint32_t shadow_view_count = 1;
            std::optional<std::uint32_t> source_object_index;
            std::optional<std::uint32_t> source_layer_id;
            std::uint32_t kind_code = 0;
            double source_area = 0.0;
            double source_radius = 0.0;
            std::uint32_t area_sample_count = 0;
            bool derived_emitter_view = false;
            std::string source_id;
            std::optional<std::uint32_t> source_light_index;
            std::optional<std::uint32_t> reflect_surface_object_index;
            std::uint32_t reflection_depth = 0;
            std::vector<std::string> reflection_path;
        };
        struct ShadowReceiver {
            std::uint32_t receiver_object_index = 0;
            std::vector<std::uint32_t> light_indices;
        };
        struct ObjectLocalBounds {
            bool valid = false;
            std::array<double, 3> minimum{};
            std::array<double, 3> maximum{};
        };
        bool checker_texture = false;
        bool planar_mirror = false;
        bool shadow_map = false;
        bool light_flares = false;
        double light_marker_size = 0.18;
        std::uint32_t max_reflection_depth = 0;
        std::string mount_target_id;
        std::uint32_t object_count = 0;
        std::array<double, 4> background{0.0, 0.0, 0.0, 0.0};
        bool direct_shadow_bounds_valid = false;
        std::array<double, 3> direct_shadow_bounds_min{};
        std::array<double, 3> direct_shadow_bounds_max{};
        std::vector<ReflectiveSurface> reflective_surfaces;
        std::vector<Light> lights;
        std::vector<ShadowReceiver> shadow_receivers;
        std::vector<ObjectLocalBounds> object_local_bounds;
    } retained_scene;
    std::vector<Binding> bindings;
    UpdatePlan update;
    bool retained_scene_render = false;
    bool typed_retained_scene_render = false;
    bool dom_only = false;
};

using ReflectionPath = vkf::native_scene::PlanarReflectionPath;

std::string reflection_path_token(
    const ReflectionPath& path,
    const ModulePlan::RetainedSceneFeatures& scene,
    const std::string& separator
) {
    std::string token;
    for (const auto surface_index : path) {
        if (!token.empty()) token += separator;
        token += scene.reflective_surfaces[surface_index].id;
    }
    return token;
}

std::size_t reflection_path_index(
    const std::vector<ReflectionPath>& paths,
    const ReflectionPath& expected
) {
    const auto found = std::find(paths.begin(), paths.end(), expected);
    if (found == paths.end()) {
        throw WebGpuArtifactFailure("reflection camera path is unavailable");
    }
    return static_cast<std::size_t>(std::distance(paths.begin(), found));
}

bool literal_string_equals(
    const vkf::native_scene::LiteralValue* value,
    const std::string& expected
) {
    return value != nullptr &&
        value->kind == vkf::native_scene::LiteralKind::String &&
        value->text == expected;
}

std::string literal_string_or(
    const vkf::native_scene::LiteralValue* value,
    const std::string& fallback
) {
    return value != nullptr &&
        value->kind == vkf::native_scene::LiteralKind::String
        ? value->text : fallback;
}

double literal_number_or(
    const vkf::native_scene::LiteralValue* value,
    double fallback
) {
    if (value == nullptr ||
        value->kind != vkf::native_scene::LiteralKind::Number) {
        return fallback;
    }
    return std::stod(value->text);
}

bool literal_bool_equals(
    const vkf::native_scene::LiteralValue* value,
    bool expected
);

std::array<double, 3> literal_vec3_or(
    const vkf::native_scene::LiteralValue* value,
    const std::array<double, 3>& fallback
) {
    if (value == nullptr ||
        value->kind != vkf::native_scene::LiteralKind::Array) {
        return fallback;
    }
    auto result = fallback;
    for (std::size_t index = 0;
         index < result.size() && index < value->array.size(); ++index) {
        result[index] = literal_number_or(&value->array[index], result[index]);
    }
    return result;
}

std::array<double, 3> transform_scene_point(
    std::array<double, 3> point,
    const std::array<double, 3>& center,
    const std::array<double, 3>& scale,
    const std::array<double, 3>& rotation_degrees
) {
    constexpr double radians_per_degree =
        3.14159265358979323846 / 180.0;
    point = {
        point[0] * scale[0],
        point[1] * scale[1],
        point[2] * scale[2],
    };
    const double rx = rotation_degrees[0] * radians_per_degree;
    const double ry = rotation_degrees[1] * radians_per_degree;
    const double rz = rotation_degrees[2] * radians_per_degree;
    const double cx = std::cos(rx);
    const double sx = std::sin(rx);
    const double cy = std::cos(ry);
    const double sy = std::sin(ry);
    const double cz = std::cos(rz);
    const double sz = std::sin(rz);
    point = {point[0], cx * point[1] - sx * point[2],
             sx * point[1] + cx * point[2]};
    point = {cy * point[0] + sy * point[2], point[1],
             -sy * point[0] + cy * point[2]};
    point = {cz * point[0] - sz * point[1],
             sz * point[0] + cz * point[1], point[2]};
    return {
        point[0] + center[0],
        point[1] + center[1],
        point[2] + center[2],
    };
}

void extend_direct_shadow_bounds(
    ModulePlan::RetainedSceneFeatures& features,
    const std::array<double, 3>& point
) {
    if (!features.direct_shadow_bounds_valid) {
        features.direct_shadow_bounds_min = point;
        features.direct_shadow_bounds_max = point;
        features.direct_shadow_bounds_valid = true;
        return;
    }
    for (std::size_t axis = 0; axis < point.size(); ++axis) {
        features.direct_shadow_bounds_min[axis] = std::min(
            features.direct_shadow_bounds_min[axis], point[axis]);
        features.direct_shadow_bounds_max[axis] = std::max(
            features.direct_shadow_bounds_max[axis], point[axis]);
    }
}

void collect_direct_shadow_bounds(
    const vkf::native_scene::LiteralValue& object,
    bool is_surface,
    ModulePlan::RetainedSceneFeatures& features
) {
    using vkf::native_scene::LiteralKind;
    if (!literal_bool_equals(
            vkf::native_scene::object_field(object, "visible"), false)) {
        auto center = literal_vec3_or(
            vkf::native_scene::object_field(object, "center"),
            {0.0, 0.0, 0.0});
        center[2] = literal_number_or(
            vkf::native_scene::object_field(object, "z"), center[2]);
        auto scale = literal_vec3_or(
            vkf::native_scene::object_field(object, "scale"),
            {1.0, 1.0, 1.0});
        if (const auto* size = vkf::native_scene::object_field(object, "size");
            size != nullptr && size->kind == LiteralKind::Array) {
            scale = literal_vec3_or(size, {1.0, 1.0, 1.0});
        }
        const auto rotation = literal_vec3_or(
            vkf::native_scene::object_field(object, "rotation"),
            {0.0, 0.0, 0.0});
        if (is_surface) {
            for (const auto& local : std::array<std::array<double, 3>, 4>{
                     std::array<double, 3>{-0.5, -0.5, 0.0},
                     std::array<double, 3>{0.5, -0.5, 0.0},
                     std::array<double, 3>{0.5, 0.5, 0.0},
                     std::array<double, 3>{-0.5, 0.5, 0.0},
                 }) {
                extend_direct_shadow_bounds(features, transform_scene_point(
                    local, center, scale, rotation));
            }
            return;
        }
        const auto* vertices = vkf::native_scene::object_field(
            object, "vertices");
        if (vertices == nullptr || vertices->kind != LiteralKind::Array) return;
        constexpr std::size_t vertex_stride_floats = 10;
        for (std::size_t offset = 0;
             offset + 2 < vertices->array.size();
             offset += vertex_stride_floats) {
            const std::array<double, 3> local{
                literal_number_or(&vertices->array[offset], 0.0),
                literal_number_or(&vertices->array[offset + 1], 0.0),
                literal_number_or(&vertices->array[offset + 2], 0.0),
            };
            extend_direct_shadow_bounds(features, transform_scene_point(
                local, center, scale, rotation));
        }
    }
}

ModulePlan::RetainedSceneFeatures::ObjectLocalBounds
collect_object_local_bounds(
    const vkf::native_scene::LiteralValue& object,
    bool is_surface
) {
    using vkf::native_scene::LiteralKind;
    ModulePlan::RetainedSceneFeatures::ObjectLocalBounds bounds;
    if (literal_bool_equals(
            vkf::native_scene::object_field(object, "visible"), false)) {
        return bounds;
    }
    const auto extend = [&bounds](const std::array<double, 3>& point) {
        if (!bounds.valid) {
            bounds.minimum = point;
            bounds.maximum = point;
            bounds.valid = true;
            return;
        }
        for (std::size_t axis = 0; axis < point.size(); ++axis) {
            bounds.minimum[axis] = std::min(bounds.minimum[axis], point[axis]);
            bounds.maximum[axis] = std::max(bounds.maximum[axis], point[axis]);
        }
    };
    if (is_surface) {
        extend({-0.5, -0.5, 0.0});
        extend({0.5, 0.5, 0.0});
        return bounds;
    }
    const auto* vertices = vkf::native_scene::object_field(object, "vertices");
    if (vertices == nullptr || vertices->kind != LiteralKind::Array) {
        return bounds;
    }
    constexpr std::size_t vertex_stride_floats = 10;
    for (std::size_t offset = 0;
         offset + 2 < vertices->array.size();
         offset += vertex_stride_floats) {
        extend({
            literal_number_or(&vertices->array[offset], 0.0),
            literal_number_or(&vertices->array[offset + 1], 0.0),
            literal_number_or(&vertices->array[offset + 2], 0.0),
        });
    }
    return bounds;
}

void collect_retained_scene_entities(
    const vkf::native_scene::LiteralValue& root,
    ModulePlan::RetainedSceneFeatures& features,
    bool derive_reflected_emitter_views
) {
    using vkf::native_scene::LiteralKind;
    const auto* background = vkf::native_scene::object_field(
        root, "background");
    features.light_flares = literal_bool_equals(
        vkf::native_scene::object_field(root, "light_flares"), true);
    features.light_marker_size = literal_number_or(
        vkf::native_scene::object_field(root, "light_marker_size"), 0.18);
    if (background != nullptr && background->kind == LiteralKind::Array) {
        for (std::size_t index = 0;
             index < features.background.size() &&
             index < background->array.size(); ++index) {
            features.background[index] = literal_number_or(
                &background->array[index], features.background[index]);
        }
    }
    std::uint32_t object_index = 0;
    std::map<std::string, std::uint32_t> object_indices;
    for (const auto* collection_name : {"surfaces", "meshes"}) {
        const auto* collection = vkf::native_scene::object_field(
            root, collection_name);
        if (collection == nullptr || collection->kind != LiteralKind::Array) {
            continue;
        }
        for (const auto& object : collection->array) {
            features.object_local_bounds.push_back(
                collect_object_local_bounds(
                    object, std::string(collection_name) == "surfaces"));
            collect_direct_shadow_bounds(
                object, std::string(collection_name) == "surfaces", features);
            const std::string object_id = literal_string_or(
                vkf::native_scene::object_field(object, "id"),
                "object_" + std::to_string(object_index));
            object_indices[object_id] = object_index;
            const bool reflective =
                vkf::native_scene::is_planar_reflective_object(
                    object, std::string(collection_name) == "surfaces");
            if (reflective) {
                features.reflective_surfaces.push_back({
                    object_id,
                    object_index,
                    literal_number_or(vkf::native_scene::object_field(
                        object, "reflectivity"), 0.0),
                });
            }
            ++object_index;
        }
    }
    if (!features.reflective_surfaces.empty()) {
        features.planar_mirror = true;
        features.max_reflection_depth =
            vkf::native_scene::planar_reflection_max_depth;
    }
    features.object_count = object_index;
    const auto* lights = vkf::native_scene::object_field(root, "lights");
    std::map<std::string, std::uint32_t> light_indices;
    if (lights != nullptr && lights->kind == LiteralKind::Array) {
        for (std::size_t index = 0; index < lights->array.size(); ++index) {
            const auto& light = lights->array[index];
            const std::string light_id = literal_string_or(
                vkf::native_scene::object_field(light, "id"),
                "light_" + std::to_string(index));
            light_indices[light_id] = static_cast<std::uint32_t>(index);
            const bool casts_shadow = literal_bool_equals(
                vkf::native_scene::object_field(light, "casts_shadow"), true);
            const std::string light_kind = literal_string_or(
                vkf::native_scene::object_field(light, "kind"), "point");
            const auto light_position = literal_vec3_or(
                vkf::native_scene::object_field(light, "pos"),
                {0.0, 0.0, 0.0});
            bool point_requires_full_sphere = false;
            if (light_kind == "point" &&
                features.direct_shadow_bounds_valid) {
                std::array<double, 3> bounds_center{};
                std::array<double, 3> view_direction{};
                double view_distance_squared = 0.0;
                for (std::size_t axis = 0; axis < 3; ++axis) {
                    bounds_center[axis] =
                        (features.direct_shadow_bounds_min[axis] +
                         features.direct_shadow_bounds_max[axis]) * 0.5;
                    view_direction[axis] =
                        bounds_center[axis] - light_position[axis];
                    view_distance_squared +=
                        view_direction[axis] * view_direction[axis];
                }
                if (view_distance_squared <= 1.0e-12) {
                    point_requires_full_sphere = true;
                } else {
                    const double inverse_view_distance =
                        1.0 / std::sqrt(view_distance_squared);
                    for (double& component : view_direction) {
                        component *= inverse_view_distance;
                    }
                    for (std::uint32_t corner = 0;
                         corner < 8 && !point_requires_full_sphere; ++corner) {
                        double forward_distance = 0.0;
                        double corner_distance_squared = 0.0;
                        for (std::size_t axis = 0; axis < 3; ++axis) {
                            const double coordinate =
                                (corner & (1u << axis)) != 0
                                ? features.direct_shadow_bounds_max[axis]
                                : features.direct_shadow_bounds_min[axis];
                            const double offset =
                                coordinate - light_position[axis];
                            forward_distance += offset * view_direction[axis];
                            corner_distance_squared += offset * offset;
                        }
                        const double safe_front_margin = std::max(
                            1.0e-6,
                            std::sqrt(corner_distance_squared) * 1.0e-4);
                        point_requires_full_sphere =
                            forward_distance <= safe_front_margin;
                    }
                }
            }
            features.lights.push_back({
                light_id,
                static_cast<std::uint32_t>(index),
                casts_shadow,
                light_kind,
                literal_string_or(vkf::native_scene::object_field(
                    light, "reflect_of_light_id"), ""),
                literal_string_or(vkf::native_scene::object_field(
                    light, "reflect_mirror_mesh_id"), ""),
                !literal_bool_equals(vkf::native_scene::object_field(
                    light, "show_marker"), false),
                point_requires_full_sphere ? 6u : 1u,
            });
            if (casts_shadow) features.shadow_map = true;
        }
    }
    const std::uint32_t authored_light_count = lights != nullptr &&
        lights->kind == LiteralKind::Array
        ? static_cast<std::uint32_t>(lights->array.size())
        : 0u;
    const auto emitters = vkf::native_scene::geometry_emitters(root);
    for (std::size_t index = 0; index < emitters.size(); ++index) {
        const auto& emitter = emitters[index];
        ModulePlan::RetainedSceneFeatures::Light light;
        light.id = emitter.id;
        light.light_index = authored_light_count +
            static_cast<std::uint32_t>(index);
        light.casts_shadow = emitter.casts_shadow;
        light.kind = "geometry_emitter";
        light.show_marker = emitter.show_marker;
        light.shadow_view_count = 1;
        light.source_object_index = emitter.object_index;
        light.source_layer_id = emitter.layer_id;
        light.kind_code = vkf::native_scene::geometry_emitter_kind_code;
        light.source_area = emitter.area;
        light.source_radius = std::sqrt(
            emitter.area / 3.14159265358979323846);
        light.area_sample_count = 8;
        if (light.show_marker) features.light_flares = true;
        light_indices[light.id] = light.light_index;
        if (light.casts_shadow) features.shadow_map = true;
        features.lights.push_back(std::move(light));
    }
    const auto emitter_views = derive_reflected_emitter_views
        ? vkf::native_scene::geometry_emitter_views(
            root, authored_light_count, emitters,
            features.max_reflection_depth)
        : std::vector<vkf::native_scene::GeometryEmitterView>{};
    for (const auto& view : emitter_views) {
        ModulePlan::RetainedSceneFeatures::Light light;
        light.id = view.id;
        light.light_index = view.light_index;
        light.casts_shadow = view.casts_shadow;
        light.kind = "projected";
        light.reflect_source_id = view.source_id;
        light.reflect_surface_id = view.reflect_surface_id;
        light.show_marker = false;
        light.shadow_view_count = 1;
        light.source_object_index = view.source_object_index;
        light.source_layer_id = view.source_layer_id;
        light.kind_code =
            vkf::native_scene::reflected_emitter_view_kind_code;
        light.derived_emitter_view = true;
        light.source_id = view.source_id;
        light.source_light_index = view.source_light_index;
        light.reflect_surface_object_index =
            view.reflect_surface_object_index;
        light.reflection_depth = static_cast<std::uint32_t>(
            view.reflection_path.size());
        light.reflection_path = view.reflection_path;
        const auto source = std::find_if(
            emitters.begin(), emitters.end(), [&](const auto& emitter) {
                return emitter.id == view.source_id;
            });
        if (source != emitters.end()) {
            light.source_area = source->area;
            light.source_radius = std::sqrt(
                source->area / 3.14159265358979323846);
            light.area_sample_count = 8;
        }
        light_indices[light.id] = light.light_index;
        if (light.casts_shadow) features.shadow_map = true;
        features.lights.push_back(std::move(light));
    }
    const auto* receivers = vkf::native_scene::object_field(
        root, "shadow_receivers");
    if (receivers == nullptr || receivers->kind != LiteralKind::Array) return;
    for (const auto& receiver : receivers->array) {
        const std::string receiver_id = literal_string_or(
            vkf::native_scene::object_field(receiver, "receiver_mesh"), "");
        const auto receiver_index = object_indices.find(receiver_id);
        if (receiver_index == object_indices.end()) continue;
        ModulePlan::RetainedSceneFeatures::ShadowReceiver entry;
        entry.receiver_object_index = receiver_index->second;
        const auto* receiver_lights = vkf::native_scene::object_field(
            receiver, "lights");
        if (receiver_lights != nullptr &&
            receiver_lights->kind == LiteralKind::Array) {
            for (const auto& receiver_light : receiver_lights->array) {
                if (receiver_light.kind != LiteralKind::String) continue;
                const auto light_index = light_indices.find(receiver_light.text);
                if (light_index != light_indices.end()) {
                    entry.light_indices.push_back(light_index->second);
                }
            }
        }
        features.shadow_receivers.push_back(std::move(entry));
    }
}

std::size_t retained_shadow_view_count(
    const ModulePlan::RetainedSceneFeatures& scene
) {
    std::size_t count = 0;
    for (const auto& light : scene.lights) {
        if (light.casts_shadow) count += light.shadow_view_count;
    }
    return count;
}

bool literal_bool_equals(
    const vkf::native_scene::LiteralValue* value,
    bool expected
) {
    return value != nullptr &&
        value->kind == vkf::native_scene::LiteralKind::Bool &&
        value->bool_value == expected;
}

void collect_retained_scene_features(
    const vkf::native_scene::LiteralValue& value,
    ModulePlan::RetainedSceneFeatures& features
) {
    using vkf::native_scene::LiteralKind;
    if (value.kind == LiteralKind::Array) {
        for (const auto& item : value.array) {
            collect_retained_scene_features(item, features);
        }
        return;
    }
    if (value.kind != LiteralKind::Object) return;

    const auto* kind = vkf::native_scene::object_field(value, "kind");
    const auto* type = vkf::native_scene::object_field(value, "type");
    if (features.mount_target_id.empty() &&
        literal_string_equals(type, "plot_panel")) {
        const auto* id = vkf::native_scene::object_field(value, "id");
        if (id != nullptr && id->kind == LiteralKind::String) {
            features.mount_target_id = id->text;
        }
    }
    if (literal_string_equals(kind, "checker")) {
        features.checker_texture = true;
    }
    if (literal_string_equals(kind, "mirror")) {
        features.planar_mirror = true;
        features.max_reflection_depth = 1;
    }
    const auto* casts_shadow = vkf::native_scene::object_field(
        value, "casts_shadow");
    if (literal_bool_equals(casts_shadow, true)) {
        features.shadow_map = true;
    }
    const auto* shadow = vkf::native_scene::object_field(value, "shadow");
    if (shadow != nullptr && shadow->kind == LiteralKind::Object &&
        literal_bool_equals(vkf::native_scene::object_field(*shadow, "enabled"), true)) {
        features.shadow_map = true;
    }
    const auto* shadow_receivers = vkf::native_scene::object_field(
        value, "shadow_receivers");
    if (shadow_receivers != nullptr &&
        shadow_receivers->kind == LiteralKind::Array &&
        !shadow_receivers->array.empty()) {
        features.shadow_map = true;
    }
    for (const auto& item : value.object) {
        collect_retained_scene_features(item.second, features);
    }
}

const vf::JsonValue::Object& object_of(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_object()) {
        throw WebGpuArtifactFailure("expected object for " + context);
    }
    return value.as_object();
}

const vf::JsonValue::Array& array_of(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_array()) {
        throw WebGpuArtifactFailure("expected array for " + context);
    }
    return value.as_array();
}

const vf::JsonValue& field(const vf::JsonValue::Object& object, const std::string& name, const std::string& context) {
    const auto found = object.find(name);
    if (found == object.end()) {
        throw WebGpuArtifactFailure("missing field " + name + " in " + context);
    }
    return found->second;
}

std::string string_field(const vf::JsonValue::Object& object, const std::string& name, const std::string& context) {
    const vf::JsonValue& value = field(object, name, context);
    if (!value.is_string()) {
        throw WebGpuArtifactFailure("expected string field " + name + " in " + context);
    }
    return value.as_string();
}

std::string read_file(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) {
        throw WebGpuArtifactFailure("could not read " + path.string());
    }
    std::ostringstream buffer;
    buffer << input.rdbuf();
    return buffer.str();
}

void write_text(const std::filesystem::path& path, const std::string& text) {
    std::ofstream output(path, std::ios::binary);
    if (!output) {
        throw WebGpuArtifactFailure("could not write " + path.string());
    }
    output << text;
}

std::string hex_u64(std::uint64_t value) {
    const char* digits = "0123456789abcdef";
    std::string out(16, '0');
    for (int i = 15; i >= 0; --i) {
        out[static_cast<std::size_t>(i)] = digits[value & 0xF];
        value >>= 4;
    }
    return out;
}

std::string stable_hash(const std::string& text) {
    std::uint64_t hash = 1469598103934665603ull;
    for (unsigned char ch : text) {
        hash ^= ch;
        hash *= 1099511628211ull;
    }
    return hex_u64(hash);
}

std::filesystem::path repo_root_from_source(const std::filesystem::path& source) {
    auto parent = std::filesystem::absolute(source).parent_path();
    if (parent.empty()) {
        return std::filesystem::current_path();
    }
    return parent;
}

std::string stem_of(const std::filesystem::path& source) {
    std::string stem = source.stem().string();
    return stem.empty() ? "stdin" : stem;
}

std::string artifact_stem_of(const std::filesystem::path& source) {
    const std::string stem = stem_of(source);
    constexpr std::size_t max_stem_length = 16;
    if (stem.size() <= max_stem_length) {
        return stem;
    }
    constexpr std::size_t hash_length = 8;
    constexpr std::size_t prefix_length = max_stem_length - hash_length - 1;
    return stem.substr(0, prefix_length) + "-" + stable_hash(stem).substr(0, hash_length);
}

std::int32_t checked_i32(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_number()) {
        throw WebGpuArtifactFailure("expected numeric value for " + context);
    }
    const double raw = value.as_number();
    const double integral = static_cast<double>(static_cast<std::int32_t>(raw));
    if (raw != integral || raw < static_cast<double>(std::numeric_limits<std::int32_t>::min())
        || raw > static_cast<double>(std::numeric_limits<std::int32_t>::max())) {
        throw WebGpuArtifactFailure("expected i32-compatible numeric value for " + context);
    }
    return static_cast<std::int32_t>(raw);
}

const Binding* find_binding(const std::vector<Binding>& bindings, const std::string& name) {
    for (const auto& binding : bindings) {
        if (binding.name == name) {
            return &binding;
        }
    }
    return nullptr;
}

bool is_i32_compatible(double raw) {
    const double integral = static_cast<double>(static_cast<std::int32_t>(raw));
    return raw == integral
        && raw >= static_cast<double>(std::numeric_limits<std::int32_t>::min())
        && raw <= static_cast<double>(std::numeric_limits<std::int32_t>::max());
}

std::string parse_math_intrinsic_name(const vf::JsonValue::Object& callee, const std::string& context);

EvaluatedBindingValue binding_to_evaluated_value(const Binding& binding) {
    EvaluatedBindingValue out;
    if (binding.kind == Binding::Kind::I32) {
        out.scalar_value = static_cast<double>(binding.i32_value);
        return out;
    }
    if (binding.kind == Binding::Kind::F64) {
        out.scalar_value = binding.f64_value;
        return out;
    }
    if (binding.kind == Binding::Kind::I32Array) {
        out.is_array = true;
        out.axis_key = binding.axis_key;
        out.array_values.reserve(binding.i32_array_values.size());
        for (std::int32_t value : binding.i32_array_values) {
            out.array_values.push_back(static_cast<double>(value));
        }
        return out;
    }
    if (binding.kind == Binding::Kind::F64Array) {
        out.is_array = true;
        out.axis_key = binding.axis_key;
        out.array_values = binding.f64_array_values;
        return out;
    }
    throw WebGpuArtifactFailure("unsupported binding kind for numeric evaluation");
}

EvaluatedBindingValue apply_binary_binding_op(
    const std::string& op,
    const EvaluatedBindingValue& left,
    const EvaluatedBindingValue& right
) {
    auto apply_scalar = [&op](double lhs, double rhs) -> double {
        if (op == "PLUS") return lhs + rhs;
        if (op == "MINUS") return lhs - rhs;
        if (op == "STAR") return lhs * rhs;
        if (op == "SLASH") return lhs / rhs;
        if (op == "CARET") return std::pow(lhs, rhs);
        throw WebGpuArtifactFailure("webgpu computed binding only supports PLUS, MINUS, STAR, SLASH, and CARET");
    };
    if (!left.is_array && !right.is_array) {
        EvaluatedBindingValue out;
        out.scalar_value = apply_scalar(left.scalar_value, right.scalar_value);
        return out;
    }
    EvaluatedBindingValue out;
    out.is_array = true;
    if (left.is_array && right.is_array) {
        if (left.axis_key != right.axis_key || left.array_values.size() != right.array_values.size()) {
            throw WebGpuArtifactFailure("webgpu computed binding only supports same-axis vector arithmetic");
        }
        out.axis_key = left.axis_key;
        for (std::size_t i = 0; i < left.array_values.size(); ++i) {
            out.array_values.push_back(apply_scalar(left.array_values[i], right.array_values[i]));
        }
        return out;
    }
    const EvaluatedBindingValue& array_side = left.is_array ? left : right;
    const EvaluatedBindingValue& scalar_side = left.is_array ? right : left;
    out.axis_key = array_side.axis_key;
    for (double value : array_side.array_values) {
        out.array_values.push_back(
            left.is_array ? apply_scalar(value, scalar_side.scalar_value) : apply_scalar(scalar_side.scalar_value, value)
        );
    }
    return out;
}

EvaluatedBindingValue evaluate_binding_value(const vf::JsonValue& value, const std::vector<Binding>& bindings) {
    const auto& object = object_of(value, "computed binding");
    const std::string kind = string_field(object, "kind", "computed binding");
    if (kind == "const") {
        const vf::JsonValue& const_value = field(object, "value", "const");
        if (!const_value.is_number() && !const_value.is_boolean()) {
            throw WebGpuArtifactFailure("webgpu computed binding const must be numeric or boolean");
        }
        EvaluatedBindingValue out;
        out.scalar_value = const_value.is_boolean() ? (const_value.as_boolean() ? 1.0 : 0.0) : const_value.as_number();
        return out;
    }
    if (kind == "axis_align") {
        EvaluatedBindingValue out;
        out.is_array = true;
        out.axis_key = string_field(object, "axis_key", "axis_align");
        const auto& inner = object_of(field(object, "value", "axis_align"), "axis_align.value");
        if (string_field(inner, "kind", "axis_align.value") != "list") {
            throw WebGpuArtifactFailure("webgpu axis_align binding requires a list value");
        }
        for (const auto& item_value : array_of(field(inner, "items", "list"), "list.items")) {
            const EvaluatedBindingValue item = evaluate_binding_value(item_value, bindings);
            if (item.is_array) {
                throw WebGpuArtifactFailure("webgpu axis_align binding only supports scalar items");
            }
            out.array_values.push_back(item.scalar_value);
        }
        return out;
    }
    if (kind == "load") {
        const std::string name = string_field(object, "name", "load");
        const Binding* binding = find_binding(bindings, name);
        if (binding == nullptr) {
            throw WebGpuArtifactFailure("unknown binding " + name + " in computed webgpu binding");
        }
        return binding_to_evaluated_value(*binding);
    }
    if (kind == "binary_op") {
        return apply_binary_binding_op(
            string_field(object, "op", "binary_op"),
            evaluate_binding_value(field(object, "left", "binary_op.left"), bindings),
            evaluate_binding_value(field(object, "right", "binary_op.right"), bindings)
        );
    }
    if (kind == "call") {
        const auto& callee = object_of(field(object, "callee", "call"), "call.callee");
        const std::string field_name = parse_math_intrinsic_name(callee, "call.callee");
        const auto& args = array_of(field(object, "args", "call"), "call.args");
        if (args.size() != 1
            || (field_name != "sin" && field_name != "cos" && field_name != "sqrt" && field_name != "exp")) {
            throw WebGpuArtifactFailure("webgpu computed binding only supports unary math.sin/math.cos/math.sqrt/math.exp");
        }
        const EvaluatedBindingValue arg = evaluate_binding_value(args[0], bindings);
        auto apply_intrinsic = [&field_name](double value) -> double {
            if (field_name == "sin") {
                return std::sin(value);
            }
            if (field_name == "cos") {
                return std::cos(value);
            }
            if (field_name == "sqrt") {
                return std::sqrt(value);
            }
            return std::exp(value);
        };
        if (!arg.is_array) {
            EvaluatedBindingValue out;
            out.scalar_value = apply_intrinsic(arg.scalar_value);
            return out;
        }
        EvaluatedBindingValue out;
        out.is_array = true;
        out.axis_key = arg.axis_key;
        for (double value : arg.array_values) {
            out.array_values.push_back(apply_intrinsic(value));
        }
        return out;
    }
    throw WebGpuArtifactFailure("unsupported computed webgpu binding kind " + kind);
}

Binding binding_from_store(const vf::JsonValue::Object& stmt, const std::vector<Binding>& bindings) {
    Binding binding;
    binding.name = string_field(stmt, "name", "store_binding");
    const auto& value = field(stmt, "value", "store_binding");
    const EvaluatedBindingValue evaluated = evaluate_binding_value(value, bindings);
    if (evaluated.is_array) {
        binding.axis_key = evaluated.axis_key;
        bool all_i32 = true;
        for (double item : evaluated.array_values) {
            if (!is_i32_compatible(item)) {
                all_i32 = false;
                break;
            }
        }
        if (all_i32) {
            binding.kind = Binding::Kind::I32Array;
            for (double item : evaluated.array_values) {
                binding.i32_array_values.push_back(static_cast<std::int32_t>(item));
            }
        } else {
            binding.kind = Binding::Kind::F64Array;
            binding.f64_array_values = evaluated.array_values;
        }
        return binding;
    }
    if (is_i32_compatible(evaluated.scalar_value)) {
        binding.kind = Binding::Kind::I32;
        binding.i32_value = static_cast<std::int32_t>(evaluated.scalar_value);
    } else {
        binding.kind = Binding::Kind::F64;
        binding.f64_value = evaluated.scalar_value;
    }
    return binding;
}

bool parse_axis_vector_type(
    const std::string& type_name,
    std::string& axis_key,
    std::string& value_type
);

const Binding* find_axis_seed_binding(const std::vector<Binding>& bindings, const std::string& axis_key);

std::string parse_math_intrinsic_name(const vf::JsonValue::Object& callee, const std::string& context) {
    const std::string callee_kind = string_field(callee, "kind", context);
    if (callee_kind == "field_access") {
        const std::string field_name = string_field(callee, "field", context);
        const auto& base = object_of(field(callee, "object", context + ".object"), context + ".object");
        if (string_field(base, "kind", context + ".object") != "load"
            || string_field(base, "name", context + ".object") != "math") {
            throw WebGpuArtifactFailure("webgpu update expr only supports math intrinsic calls");
        }
        return field_name;
    }
    if (callee_kind == "stdlib_function") {
        const std::string full_name = string_field(callee, "full_name", context);
        if (full_name == "math.sin") {
            return "sin";
        }
        if (full_name == "math.cos") {
            return "cos";
        }
        if (full_name == "math.sqrt") {
            return "sqrt";
        }
        if (full_name == "math.exp") {
            return "exp";
        }
        throw WebGpuArtifactFailure("webgpu update expr only supports math intrinsic calls");
    }
    throw WebGpuArtifactFailure("webgpu update expr only supports stdlib math intrinsic calls");
}

std::size_t binding_array_length(const Binding& binding) {
    if (binding.kind == Binding::Kind::I32Array) {
        return binding.i32_array_values.size();
    }
    if (binding.kind == Binding::Kind::F64Array) {
        return binding.f64_array_values.size();
    }
    return 0;
}

const FieldDesc* find_field_desc(const std::vector<FieldDesc>& fields, const std::string& name) {
    for (const auto& field : fields) {
        if (field.name == name) {
            return &field;
        }
    }
    return nullptr;
}

std::uint32_t field_storage_words(const FieldDesc& field) {
    return static_cast<std::uint32_t>(field.axis_length > 0 ? field.axis_length : 1);
}

bool is_webgpu_float_type(const std::string& type_name) {
    return type_name == "f32" || type_name == "f64";
}

bool is_float_field(const FieldDesc& field) {
    return field.storage == "f32";
}

std::string field_wgsl_scalar_type(const FieldDesc& field) {
    return is_float_field(field) ? "f32" : "i32";
}

std::string field_wgsl_type(const FieldDesc& field) {
    if (field.axis_length > 0) {
        return "array<" + field_wgsl_scalar_type(field) + ", " + std::to_string(field.axis_length) + ">";
    }
    return field_wgsl_scalar_type(field);
}

std::uint32_t layout_size_bytes(const std::vector<FieldDesc>& fields) {
    if (fields.empty()) {
        return 0;
    }
    const FieldDesc& last = fields.back();
    return last.offset + (field_storage_words(last) * 4);
}

std::vector<FieldDesc> parse_record_fields(
    const std::string& type_name,
    const std::string& context,
    const std::vector<Binding>& bindings
) {
    const std::string prefix = "record{";
    if (type_name.rfind(prefix, 0) != 0 || type_name.empty() || type_name.back() != '}') {
        throw WebGpuArtifactFailure(context + " must be a record{...} type");
    }
    const std::string inner = type_name.substr(prefix.size(), type_name.size() - prefix.size() - 1);
    std::vector<FieldDesc> fields;
    std::uint32_t next_offset = 0;
    if (inner.empty()) {
        return fields;
    }
    std::size_t start = 0;
    while (start < inner.size()) {
        const std::size_t comma = inner.find(',', start);
        const std::string part = inner.substr(start, comma == std::string::npos ? std::string::npos : comma - start);
        const std::size_t colon = part.find(':');
        if (colon == std::string::npos) {
            throw WebGpuArtifactFailure("malformed record field in " + context);
        }
        FieldDesc field_desc;
        field_desc.name = part.substr(0, colon);
        const std::string field_type = part.substr(colon + 1);
        field_desc.type = field_type;
        field_desc.offset = next_offset;
        if (field_type == "num" || is_webgpu_float_type(field_type)) {
            if (is_webgpu_float_type(field_type)) {
                field_desc.storage = "f32";
            }
            next_offset += 4;
        } else {
            std::string axis_key;
            std::string value_type;
            if (!parse_axis_vector_type(field_type, axis_key, value_type)
                || (value_type != "list<num>" && value_type != "list<f32>" && value_type != "list<f64>")) {
                throw WebGpuArtifactFailure(context + " only supports num/f32/f64 fields or axis<k>:list<num|f32|f64> fields");
            }
            const Binding* seed = find_axis_seed_binding(bindings, axis_key);
            if (seed == nullptr) {
                throw WebGpuArtifactFailure(context + " axis-vector fields require an axis-aligned const binding seed");
            }
            field_desc.axis_key = axis_key;
            field_desc.axis_length = binding_array_length(*seed);
            if (value_type != "list<num>" || seed->kind == Binding::Kind::F64Array) {
                field_desc.storage = "f32";
            }
            next_offset += static_cast<std::uint32_t>(field_desc.axis_length * 4);
        }
        fields.push_back(std::move(field_desc));
        if (comma == std::string::npos) {
            break;
        }
        start = comma + 1;
    }
    return fields;
}

bool parse_axis_vector_type(
    const std::string& type_name,
    std::string& axis_key,
    std::string& value_type
) {
    const std::string prefix = "axis<";
    if (type_name.rfind(prefix, 0) != 0) {
        return false;
    }
    const std::size_t close = type_name.find(">:");
    if (close == std::string::npos) {
        return false;
    }
    axis_key = type_name.substr(prefix.size(), close - prefix.size());
    value_type = type_name.substr(close + 2);
    return !axis_key.empty() && !value_type.empty();
}

const Binding* find_axis_seed_binding(const std::vector<Binding>& bindings, const std::string& axis_key) {
    for (const auto& binding : bindings) {
        if ((binding.kind == Binding::Kind::I32Array || binding.kind == Binding::Kind::F64Array)
            && binding.axis_key == axis_key) {
            return &binding;
        }
    }
    return nullptr;
}

UpdateExpr parse_update_expr(
    const vf::JsonValue& value,
    const std::vector<Binding>& bindings,
    const std::vector<FieldDesc>* state_fields,
    const std::vector<FieldDesc>* input_fields,
    const std::map<std::string, vf::JsonValue>* local_bindings = nullptr
) {
    const auto& object = object_of(value, "webgpu update expr");
    const std::string kind = string_field(object, "kind", "webgpu update expr");
    if (kind == "const") {
        const vf::JsonValue& const_value = field(object, "value", "const");
        if (!const_value.is_number()) {
            throw WebGpuArtifactFailure("webgpu update expr only supports numeric const values");
        }
        UpdateExpr out{UpdateExpr::Kind::ConstI32};
        const double raw = const_value.as_number();
        if (is_i32_compatible(raw)) {
            out.i32_value = static_cast<std::int32_t>(raw);
        } else {
            out.kind = UpdateExpr::Kind::ConstF64;
            out.f64_value = raw;
        }
        return out;
    }
    if (kind == "load") {
        const std::string name = string_field(object, "name", "load");
        if (name == "state") {
            return UpdateExpr{UpdateExpr::Kind::LoadState};
        }
        if (name == "input") {
            return UpdateExpr{UpdateExpr::Kind::LoadInput};
        }
        if (local_bindings != nullptr) {
            const auto found_local = local_bindings->find(name);
            if (found_local != local_bindings->end()) {
                return parse_update_expr(found_local->second, bindings, state_fields, input_fields, local_bindings);
            }
        }
        const Binding* binding = find_binding(bindings, name);
        if (binding != nullptr) {
            if (binding->kind == Binding::Kind::I32Array || binding->kind == Binding::Kind::F64Array) {
                UpdateExpr out{UpdateExpr::Kind::LoadBindingAxisElem};
                out.binding_name = name;
                return out;
            }
            if (binding->kind == Binding::Kind::I32 || binding->kind == Binding::Kind::F64) {
                UpdateExpr out{UpdateExpr::Kind::LoadBinding};
                out.binding_name = name;
                return out;
            }
            throw WebGpuArtifactFailure("webgpu update expr only supports numeric const bindings and axis-aligned numeric bindings");
        }
        throw WebGpuArtifactFailure("webgpu update expr only supports load(state), load(input), or numeric const bindings");
    }
    if (kind == "field_access") {
        const auto& base = object_of(field(object, "object", "field_access.object"), "field_access.object");
        const std::string base_kind = string_field(base, "kind", "field_access.object");
        if (base_kind != "load") {
            throw WebGpuArtifactFailure("webgpu field_access only supports load(state) or load(input)");
        }
        const std::string base_name = string_field(base, "name", "field_access.object");
        const std::string field_name = string_field(object, "field", "field_access");
        if (base_name == "state" && state_fields != nullptr) {
            if (find_field_desc(*state_fields, field_name) == nullptr) {
                throw WebGpuArtifactFailure("unknown field " + field_name + " in state");
            }
            UpdateExpr out{UpdateExpr::Kind::LoadStateField};
            out.binding_name = field_name;
            return out;
        }
        if (base_name == "input" && input_fields != nullptr) {
            if (find_field_desc(*input_fields, field_name) == nullptr) {
                throw WebGpuArtifactFailure("unknown field " + field_name + " in input");
            }
            UpdateExpr out{UpdateExpr::Kind::LoadInputField};
            out.binding_name = field_name;
            return out;
        }
        throw WebGpuArtifactFailure("webgpu field_access only supports declared state/input record fields");
    }
    if (kind == "call") {
        const auto& callee = object_of(field(object, "callee", "call"), "call.callee");
        const std::string field_name = parse_math_intrinsic_name(callee, "call.callee");
        const auto& args = array_of(field(object, "args", "call"), "call.args");
        if (args.size() != 1
            || (field_name != "sin" && field_name != "cos" && field_name != "sqrt" && field_name != "exp")) {
            throw WebGpuArtifactFailure("webgpu update expr only supports unary math.sin/math.cos/math.sqrt/math.exp");
        }
        UpdateExpr out{UpdateExpr::Kind::IntrinsicCall};
        out.op = field_name;
        out.args.push_back(parse_update_expr(args[0], bindings, state_fields, input_fields, local_bindings));
        return out;
    }
    if (kind == "binary_op") {
        UpdateExpr out{UpdateExpr::Kind::BinaryOp};
        out.op = string_field(object, "op", "binary_op");
        out.args.push_back(parse_update_expr(field(object, "left", "binary_op.left"), bindings, state_fields, input_fields, local_bindings));
        out.args.push_back(parse_update_expr(field(object, "right", "binary_op.right"), bindings, state_fields, input_fields, local_bindings));
        if (out.op != "PLUS" && out.op != "MINUS" && out.op != "STAR" && out.op != "SLASH" && out.op != "CARET") {
            throw WebGpuArtifactFailure("webgpu update expr only supports PLUS, MINUS, STAR, SLASH, and CARET");
        }
        return out;
    }
    throw WebGpuArtifactFailure("unsupported webgpu update expr kind " + kind);
}

bool parse_update_function(const vf::JsonValue::Object& stmt, const std::vector<Binding>& bindings, UpdatePlan& out_plan) {
    if (string_field(stmt, "kind", "typed IR stmt") != "function") {
        return false;
    }
    if (string_field(stmt, "name", "function") != "vkf_update") {
        return false;
    }
    const auto& params = array_of(field(stmt, "params", "function"), "function.params");
    if (params.size() != 2) {
        throw WebGpuArtifactFailure("webgpu vkf_update function must take exactly two params");
    }
    const auto& p0 = object_of(params[0], "function.param");
    const auto& p1 = object_of(params[1], "function.param");
    const std::string p0_name = string_field(p0, "name", "function.param");
    const std::string p1_name = string_field(p1, "name", "function.param");
    const std::string p0_type = string_field(p0, "type", "function.param");
    const std::string p1_type = string_field(p1, "type", "function.param");
    const std::string return_type = string_field(stmt, "return_type", "function");
    if (p0_name != "state") {
        throw WebGpuArtifactFailure("webgpu vkf_update first param must be named state");
    }
    if (p1_name != "input") {
        throw WebGpuArtifactFailure("webgpu vkf_update second param must be named input");
    }
    const auto& body = object_of(field(stmt, "body", "function"), "function.body");
    if (string_field(body, "kind", "function.body") != "block") {
        throw WebGpuArtifactFailure("webgpu vkf_update body must be a block");
    }
    const auto& statements = array_of(field(body, "body", "function.body"), "function.body.body");
    if (statements.empty()) {
        throw WebGpuArtifactFailure("webgpu vkf_update body must contain a return");
    }
    std::map<std::string, vf::JsonValue> local_bindings;
    for (std::size_t i = 0; i + 1 < statements.size(); ++i) {
        const auto& local_stmt = object_of(statements[i], "function.body.stmt");
        const std::string local_kind = string_field(local_stmt, "kind", "function.body.stmt");
        if (local_kind != "store_binding") {
            throw WebGpuArtifactFailure("webgpu vkf_update body only supports local store_binding statements before the final return");
        }
        local_bindings[string_field(local_stmt, "name", "store_binding")] = field(local_stmt, "value", "store_binding");
    }
    const auto& only_stmt = object_of(statements.back(), "function.body.stmt");
    if (string_field(only_stmt, "kind", "function.body.stmt") != "return") {
        throw WebGpuArtifactFailure("webgpu vkf_update body must end with a return");
    }
    const vf::JsonValue& return_value = field(only_stmt, "value", "function.return");
    if ((p0_type == "num" || is_webgpu_float_type(p0_type))
        && p1_type == p0_type) {
        if (return_type != p0_type) {
            throw WebGpuArtifactFailure("webgpu scalar vkf_update must return the state scalar type");
        }
        out_plan.enabled = true;
        out_plan.record_mode = false;
        out_plan.scalar_float_mode = is_webgpu_float_type(p0_type);
        out_plan.scalar_expr = parse_update_expr(return_value, bindings, nullptr, nullptr, &local_bindings);
        return true;
    }
    std::string axis_key;
    std::string axis_value_type;
    std::string input_axis_key;
    std::string input_axis_value_type;
    if (parse_axis_vector_type(p0_type, axis_key, axis_value_type)
        && (p1_type == "num" || is_webgpu_float_type(p1_type) || parse_axis_vector_type(p1_type, input_axis_key, input_axis_value_type))) {
        if (return_type != p0_type
            || (axis_value_type != "list<num>" && axis_value_type != "list<f32>" && axis_value_type != "list<f64>")) {
            throw WebGpuArtifactFailure("webgpu axis-vector vkf_update must return the state axis-vector type");
        }
        const Binding* seed = find_axis_seed_binding(bindings, axis_key);
        if (seed == nullptr) {
            throw WebGpuArtifactFailure("webgpu axis-vector vkf_update requires an axis-aligned const binding seed");
        }
        bool vector_input = false;
        if (p1_type != "num" && !is_webgpu_float_type(p1_type)) {
            if (input_axis_key != axis_key
                || (input_axis_value_type != axis_value_type)) {
                throw WebGpuArtifactFailure("webgpu axis-vector vkf_update only supports matching axis-vector input");
            }
            vector_input = true;
        }
        out_plan.enabled = true;
        out_plan.axis_vector_mode = true;
        out_plan.axis_input_vector = vector_input;
        out_plan.axis_key = axis_key;
        out_plan.axis_float_mode = (axis_value_type != "list<num>") || seed->kind == Binding::Kind::F64Array;
        out_plan.axis_vector_length = binding_array_length(*seed);
        out_plan.scalar_expr = parse_update_expr(return_value, bindings, nullptr, nullptr, &local_bindings);
        return true;
    }
    if (p0_type.rfind("record{", 0) != 0 || p1_type.rfind("record{", 0) != 0) {
        throw WebGpuArtifactFailure("webgpu vkf_update must use either num/num->num or matching record state/input types");
    }
    if (return_type != p0_type) {
        throw WebGpuArtifactFailure("webgpu vkf_update record mode must return the state record type");
    }
    out_plan.enabled = true;
    out_plan.record_mode = true;
    out_plan.state_fields = parse_record_fields(p0_type, "webgpu vkf_update state", bindings);
    out_plan.input_fields = parse_record_fields(p1_type, "webgpu vkf_update input", bindings);
    const auto& returned = object_of(return_value, "webgpu vkf_update return");
    if (string_field(returned, "kind", "webgpu vkf_update return") != "record") {
        throw WebGpuArtifactFailure("webgpu vkf_update record mode must return a record");
    }
    const auto& fields = array_of(field(returned, "fields", "record"), "record.fields");
    if (fields.size() != out_plan.state_fields.size()) {
        throw WebGpuArtifactFailure("webgpu vkf_update record return must include every state field exactly once");
    }
    for (std::size_t i = 0; i < fields.size(); ++i) {
        const auto& field_object = object_of(fields[i], "record field");
        const std::string field_name = string_field(field_object, "name", "record field");
        if (field_name != out_plan.state_fields[i].name) {
            throw WebGpuArtifactFailure("webgpu vkf_update record fields must match state field order");
        }
        out_plan.record_fields.push_back({
            field_name,
            parse_update_expr(field(field_object, "value", "record field"), bindings, &out_plan.state_fields, &out_plan.input_fields, &local_bindings)
        });
    }
    return true;
}

ModulePlan collect_module_plan(const vf::JsonValue& root) {
    const auto& module = object_of(root, "typed IR module");
    const std::string kind = string_field(module, "kind", "typed IR module");
    if (kind != "typed_module") {
        throw WebGpuArtifactFailure("unsupported typed IR root kind " + kind);
    }
    ModulePlan plan;
    // A retained native scene is a render artifact, not a scalar compute
    // kernel. Detect it before the generic statement walk so module imports and
    // structured scene records never enter the arithmetic binding evaluator.
    for (const auto& stmt_value : array_of(
             field(module, "body", "typed_module"), "typed_module.body")) {
        const auto& stmt = object_of(stmt_value, "typed IR stmt");
        const auto kind_it = stmt.find("kind");
        const auto name_it = stmt.find("name");
        if (kind_it != stmt.end() && kind_it->second.is_string() &&
            kind_it->second.as_string() == "store_binding") {
            const auto& value = object_of(
                field(stmt, "value", "store binding"),
                "store binding.value");
            const std::string value_kind = string_field(
                value, "kind", "store binding.value");
            const bool retained_scene_value = value_kind == "native_scene_frame";
            const bool legacy_retained_scene_binding =
                name_it != stmt.end() && name_it->second.is_string() &&
                name_it->second.as_string() == "native_scene" &&
                value_kind == "record";
            if (!retained_scene_value && !legacy_retained_scene_binding) {
                continue;
            }
            plan.retained_scene_render = true;
            return plan;
        }
    }
    const auto ui_program = module.find("ui_program");
    if (ui_program != module.end() && ui_program->second.is_object()) {
        const auto operations = ui_program->second.as_object().find(
            "operations");
        if (operations != ui_program->second.as_object().end() &&
            operations->second.is_array()) {
            for (const auto& raw_operation : operations->second.as_array()) {
                if (!raw_operation.is_object()) continue;
                const auto kind = raw_operation.as_object().find("kind");
                if (kind == raw_operation.as_object().end() ||
                    !kind->second.is_string()) {
                    continue;
                }
                const std::string& operation_kind = kind->second.as_string();
                if (operation_kind == "set_geom_options" ||
                    operation_kind == "add_camera" ||
                    operation_kind == "add_light" ||
                    operation_kind == "add") {
                    plan.retained_scene_render = true;
                    plan.typed_retained_scene_render = true;
                    return plan;
                }
            }
        }
        plan.dom_only = true;
        return plan;
    }
    for (const auto& stmt_value : array_of(field(module, "body", "typed_module"), "typed_module.body")) {
        const auto& stmt = object_of(stmt_value, "typed IR stmt");
        const std::string stmt_kind = string_field(stmt, "kind", "typed IR stmt");
        if (stmt_kind == "store_binding") {
            plan.bindings.push_back(binding_from_store(stmt, plan.bindings));
            continue;
        }
        if (stmt_kind == "expr_stmt") {
            continue;
        }
        if (stmt_kind == "function") {
            if (plan.update.enabled) {
                throw WebGpuArtifactFailure("only one webgpu vkf_update function is supported");
            }
            if (parse_update_function(stmt, plan.bindings, plan.update)) {
                continue;
            }
        }
        throw WebGpuArtifactFailure("unsupported typed IR statement kind " + stmt_kind + " for webgpu artifact emission");
    }
    if (!plan.update.enabled) {
        throw WebGpuArtifactFailure("webgpu artifact smoke requires a vkf_update function");
    }
    return plan;
}

std::string emit_expr(
    const UpdateExpr& expr,
    const ModulePlan& plan,
    const std::string& state_name,
    const std::string& input_name,
    const std::string& axis_index_name = "",
    bool float_expr_mode_override = false
) {
    const bool float_expr_mode = float_expr_mode_override || (plan.update.axis_vector_mode && plan.update.axis_float_mode) || plan.update.scalar_float_mode;
    auto format_float = [](double value) -> std::string {
        std::ostringstream out;
        out.setf(std::ios::fixed);
        out.precision(8);
        out << static_cast<float>(value);
        std::string text = out.str();
        while (text.size() > 2 && text.back() == '0' && text[text.size() - 2] != '.') {
            text.pop_back();
        }
        if (!text.empty() && text.back() == '.') {
            text.push_back('0');
        }
        return text;
    };
    if (expr.kind == UpdateExpr::Kind::ConstI32) {
        return float_expr_mode ? format_float(static_cast<double>(expr.i32_value)) : std::to_string(expr.i32_value);
    }
    if (expr.kind == UpdateExpr::Kind::ConstF64) {
        return format_float(expr.f64_value);
    }
    if (expr.kind == UpdateExpr::Kind::LoadState) {
        return plan.update.axis_vector_mode ? (state_name + ".values[" + axis_index_name + "]") : (state_name + ".value");
    }
    if (expr.kind == UpdateExpr::Kind::LoadInput) {
        return (plan.update.axis_vector_mode && plan.update.axis_input_vector)
            ? (input_name + ".values[" + axis_index_name + "]")
            : (input_name + ".value");
    }
    if (expr.kind == UpdateExpr::Kind::LoadStateField) {
        const FieldDesc* field = find_field_desc(plan.update.state_fields, expr.binding_name);
        if (field == nullptr) {
            throw WebGpuArtifactFailure("unknown state field " + expr.binding_name + " during emission");
        }
        if (field->axis_length > 0) {
            if (axis_index_name.empty()) {
                throw WebGpuArtifactFailure("axis-vector state field " + expr.binding_name + " requires axis element context");
            }
            return state_name + "." + expr.binding_name + "[" + axis_index_name + "]";
        }
        return state_name + "." + expr.binding_name;
    }
    if (expr.kind == UpdateExpr::Kind::LoadInputField) {
        const FieldDesc* field = find_field_desc(plan.update.input_fields, expr.binding_name);
        if (field == nullptr) {
            throw WebGpuArtifactFailure("unknown input field " + expr.binding_name + " during emission");
        }
        if (field->axis_length > 0) {
            if (axis_index_name.empty()) {
                throw WebGpuArtifactFailure("axis-vector input field " + expr.binding_name + " requires axis element context");
            }
            return input_name + "." + expr.binding_name + "[" + axis_index_name + "]";
        }
        return input_name + "." + expr.binding_name;
    }
    if (expr.kind == UpdateExpr::Kind::LoadBinding) {
        return expr.binding_name;
    }
    if (expr.kind == UpdateExpr::Kind::LoadBindingAxisElem) {
        return expr.binding_name + "[" + axis_index_name + "]";
    }
    if (expr.kind == UpdateExpr::Kind::IntrinsicCall) {
        const std::string arg = emit_expr(expr.args[0], plan, state_name, input_name, axis_index_name, true);
        if (expr.op == "sin") {
            return "sin(" + arg + ")";
        }
        if (expr.op == "cos") {
            return "cos(" + arg + ")";
        }
        if (expr.op == "sqrt") {
            return "sqrt(" + arg + ")";
        }
        if (expr.op == "exp") {
            return "exp(" + arg + ")";
        }
        throw WebGpuArtifactFailure("unsupported webgpu intrinsic during emission");
    }
    if (expr.kind == UpdateExpr::Kind::BinaryOp) {
        const std::string left = emit_expr(expr.args[0], plan, state_name, input_name, axis_index_name, float_expr_mode_override);
        const std::string right = emit_expr(expr.args[1], plan, state_name, input_name, axis_index_name, float_expr_mode_override);
        if (expr.op == "CARET") {
            return "pow(" + left + ", " + right + ")";
        }
        std::string op = "+";
        if (expr.op == "MINUS") {
            op = "-";
        } else if (expr.op == "STAR") {
            op = "*";
        } else if (expr.op == "SLASH") {
            op = "/";
        }
        return "(" + left + " " + op + " " + right + ")";
    }
    throw WebGpuArtifactFailure("unsupported webgpu update expr during emission");
}

std::string emit_wgsl(const ModulePlan& plan) {
    if (plan.retained_scene_render) {
        std::ostringstream out;
        const auto wgsl_f32 = [](double value) {
            std::ostringstream formatted;
            formatted.setf(std::ios::fixed);
            formatted.precision(8);
            formatted << static_cast<float>(value);
            return formatted.str();
        };
        const auto reflection_paths =
            vkf::native_scene::planar_reflection_paths(
                plan.retained_scene.reflective_surfaces.size(),
                plan.retained_scene.max_reflection_depth);
        const std::size_t shadow_light_count = std::max<std::size_t>(
            1, retained_shadow_view_count(plan.retained_scene));
        const std::size_t reflection_camera_count = std::max<std::size_t>(
            1, reflection_paths.size());
        out << R"wgsl(// Generated feature-specialized retained-scene renderer
struct SceneCamera {
  view_projection: mat4x4<f32>,
)wgsl";
        out << "  light_view_projection: array<mat4x4<f32>, "
            << shadow_light_count << ">,\n";
        out << "  shadow_near_far: array<vec4<f32>, "
            << shadow_light_count << ">,\n";
        out << "  mirror_view_projection: array<mat4x4<f32>, "
            << reflection_camera_count << ">,\n";
        out << "  mirror_view_position: array<vec4<f32>, "
            << reflection_camera_count << ">,\n";
        out << "  mirror_view_target: array<vec4<f32>, "
            << reflection_camera_count << ">,\n";
        out << R"wgsl(  view_position: vec4<f32>,
  ambient: vec4<f32>,
};
@group(0) @binding(0) var<uniform> scene: SceneCamera;

struct SceneLight {
  position_and_range: vec4<f32>,
  color_and_intensity: vec4<f32>,
  target_and_radius: vec4<f32>,
  kind_and_shadow: vec4<f32>,
  aperture_float_offset: u32,
  aperture_vertex_count: u32,
  aperture_vertex_stride_floats: u32,
  aperture_object_index: u32,
  polarization: vec4<f32>,
  polarization_basis: vec4<f32>,
};
@group(0) @binding(1) var<storage, read> lights: array<SceneLight>;
)wgsl";
        out << "const VKF_LIGHT_COUNT: u32 = "
            << plan.retained_scene.lights.size() << "u;\n";
        if (plan.retained_scene.shadow_map) {
            out << R"wgsl(@group(0) @binding(2) var shadow_depth: texture_depth_2d_array;
@group(0) @binding(3) var shadow_sampler: sampler_comparison;
)wgsl";
        }
        out << R"wgsl(
fn vkf_light_attenuation(
  distance: f32,
  intensity: f32,
  range: f32,
) -> f32 {
  let inverse_square = intensity / max(distance * distance, 1.0e-6);
  if (range <= 1.0e-6) {
    return inverse_square;
  }
  if (distance >= range) {
    return 0.0;
  }
  let range_ratio = clamp(distance / range, 0.0, 1.0);
  let fade = 1.0 - range_ratio * range_ratio;
  return inverse_square * fade * fade;
}

const VKF_AREA_LIGHT_SAMPLE_COUNT: u32 = 8u;
const VKF_AREA_LIGHT_DISK: array<vec2<f32>, 8> = array<vec2<f32>, 8>(
  vec2<f32>(0.353553, 0.000000),
  vec2<f32>(-0.353553, 0.000000),
  vec2<f32>(0.000000, 0.612372),
  vec2<f32>(0.000000, -0.612372),
  vec2<f32>(0.559017, 0.559017),
  vec2<f32>(-0.559017, -0.559017),
  vec2<f32>(-0.661438, 0.661438),
  vec2<f32>(0.661438, -0.661438)
);

fn vkf_transport_safe_normalize(value: vec3<f32>) -> vec3<f32> {
  return value / max(length(value), 1.0e-12);
}

fn vkf_sample_area_light_transport(
  world_position: vec3<f32>,
  light: SceneLight,
) -> vec4<f32> {
  let source_normal = vkf_transport_safe_normalize(
    light.target_and_radius.xyz - light.position_and_range.xyz);
  let basis_hint = select(
    vec3<f32>(0.0, 0.0, 1.0),
    vec3<f32>(0.0, 1.0, 0.0),
    abs(source_normal.z) > 0.9);
  let basis_x = vkf_transport_safe_normalize(cross(
    basis_hint, source_normal));
  let basis_y = cross(source_normal, basis_x);
  var weighted_direction = vec3<f32>(0.0);
  var attenuation_sum = 0.0;
  for (var sample_index = 0u;
       sample_index < VKF_AREA_LIGHT_SAMPLE_COUNT;
       sample_index = sample_index + 1u) {
    let sample_offset = VKF_AREA_LIGHT_DISK[sample_index];
    let sample_position = light.position_and_range.xyz +
      (basis_x * sample_offset.x + basis_y * sample_offset.y) *
      light.target_and_radius.w;
    let to_sample = sample_position - world_position;
    let sample_attenuation = vkf_light_attenuation(
      length(to_sample),
      light.color_and_intensity.w,
      light.position_and_range.w);
    weighted_direction = weighted_direction +
      vkf_transport_safe_normalize(to_sample) * sample_attenuation;
    attenuation_sum = attenuation_sum + sample_attenuation;
  }
  return vec4<f32>(
    vkf_transport_safe_normalize(weighted_direction),
    attenuation_sum / f32(VKF_AREA_LIGHT_SAMPLE_COUNT));
}

fn vkf_sample_light_transport(
  world_position: vec3<f32>,
  light: SceneLight,
  centroid_vector: vec3<f32>,
) -> vec4<f32> {
  if (u32(light.kind_and_shadow.x) == 5u) {
    return vkf_sample_area_light_transport(world_position, light);
  }
  return vec4<f32>(
    vkf_transport_safe_normalize(centroid_vector),
    vkf_light_attenuation(
      length(centroid_vector),
      light.color_and_intensity.w,
      light.position_and_range.w));
}

const VKF_FINAL_MIDDLE_GRAY: f32 = 0.18;

fn vkf_final_camera_response(linear_radiance: vec3<f32>) -> vec3<f32> {
  let exposed = max(linear_radiance, vec3<f32>(0.0)) / VKF_FINAL_MIDDLE_GRAY;
  return exposed / (vec3<f32>(1.0) + exposed);
}
)wgsl";
        out << "const VKF_MAX_REFLECTION_DEPTH: u32 = "
            << std::max<std::uint32_t>(
                2u, plan.retained_scene.max_reflection_depth) << "u;\n";
        out << R"wgsl(@group(0) @binding(4) var planar_reflection_texture: texture_2d<f32>;
@group(0) @binding(5) var planar_reflection_sampler: sampler;

struct FinalPresentVertexOut {
  @builtin(position) clip_position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vkf_present_vertex(
  @builtin(vertex_index) vertex_index: u32,
) -> FinalPresentVertexOut {
  var out: FinalPresentVertexOut;
  let x = select(-1.0, 3.0, vertex_index == 1u);
  let y = select(-1.0, 3.0, vertex_index == 2u);
  out.clip_position = vec4<f32>(x, y, 0.0, 1.0);
  out.uv = vec2<f32>(x * 0.5 + 0.5, 0.5 - y * 0.5);
  return out;
}

@fragment
fn vkf_present_fragment(
  input: FinalPresentVertexOut,
) -> @location(0) vec4<f32> {
  let linear = textureSampleLevel(
    planar_reflection_texture, planar_reflection_sampler,
    input.uv, 0.0);
  return vec4<f32>(vkf_final_camera_response(linear.rgb), linear.a);
}
)wgsl";
        out << R"wgsl(struct PassState {
  camera_state_index: u32,
  reflection_depth: u32,
  light_index: u32,
  target_layer: u32,
  object_index: u32,
  aperture_float_offset: u32,
  aperture_vertex_count: u32,
  aperture_vertex_stride_floats: u32,
};
@group(0) @binding(6) var<uniform> pass_state: PassState;
)wgsl";
        out << R"wgsl(
struct ObjectMaterial {
  model: mat4x4<f32>,
  normal_matrix: mat4x4<f32>,
  base_color: vec4<f32>,
  checker_color_a: vec4<f32>,
  checker_color_b: vec4<f32>,
  checker_scale: vec2<f32>,
  reflectivity: f32,
  texture_kind: u32,
  receives_shadow: u32,
  reflection_depth: u32,
  roughness: f32,
  specular_strength: f32,
  no_backface_specular: u32,
  surface_kind: u32,
  reflection_camera_index: u32,
  object_index: u32,
  ior: f32,
  extinction: f32,
};
@group(1) @binding(0) var<uniform> object: ObjectMaterial;

struct ViewportInput {
  width: f32,
  height: f32,
};
@group(2) @binding(0) var<storage, read> raw_camera: array<f32>;
@group(2) @binding(1) var<storage, read> raw_lights: array<f32>;
@group(2) @binding(2) var<storage, read> raw_objects: array<f32>;
@group(2) @binding(3) var<storage, read> aperture_vertices: array<f32>;
@group(2) @binding(4) var<uniform> viewport: ViewportInput;

struct DerivedObjectSlot {
  @size(256) value: ObjectMaterial,
};
@group(3) @binding(0) var<storage, read_write> derived_scene: SceneCamera;
@group(3) @binding(1) var<storage, read_write> derived_lights: array<SceneLight>;
@group(3) @binding(2) var<storage, read> derived_objects: array<DerivedObjectSlot>;
@group(3) @binding(3) var<storage, read_write> derived_objects_write: array<DerivedObjectSlot>;

)wgsl";
        out << "const VKF_OBJECT_COUNT: u32 = "
            << plan.retained_scene.object_count << "u;\n";
        const auto shadow_min = plan.retained_scene.direct_shadow_bounds_valid
            ? plan.retained_scene.direct_shadow_bounds_min
            : std::array<double, 3>{-1.0, -1.0, -1.0};
        const auto shadow_max = plan.retained_scene.direct_shadow_bounds_valid
            ? plan.retained_scene.direct_shadow_bounds_max
            : std::array<double, 3>{1.0, 1.0, 1.0};
        out << "const VKF_DIRECT_SHADOW_BOUNDS_MIN: vec3<f32> = vec3<f32>("
            << wgsl_f32(shadow_min[0]) << ", "
            << wgsl_f32(shadow_min[1]) << ", "
            << wgsl_f32(shadow_min[2]) << ");\n";
        out << "const VKF_DIRECT_SHADOW_BOUNDS_MAX: vec3<f32> = vec3<f32>("
            << wgsl_f32(shadow_max[0]) << ", "
            << wgsl_f32(shadow_max[1]) << ", "
            << wgsl_f32(shadow_max[2]) << ");\n";
        out << "fn vkf_object_local_bounds_min(object_index: u32) -> vec3<f32> {\n";
        for (std::size_t index = 0;
             index < plan.retained_scene.object_local_bounds.size(); ++index) {
            const auto& bounds = plan.retained_scene.object_local_bounds[index];
            if (!bounds.valid) continue;
            out << "  if (object_index == " << index << "u) { return vec3<f32>("
                << wgsl_f32(bounds.minimum[0]) << ", "
                << wgsl_f32(bounds.minimum[1]) << ", "
                << wgsl_f32(bounds.minimum[2]) << "); }\n";
        }
        out << "  return vec3<f32>(0.0);\n}\n";
        out << "fn vkf_object_local_bounds_max(object_index: u32) -> vec3<f32> {\n";
        for (std::size_t index = 0;
             index < plan.retained_scene.object_local_bounds.size(); ++index) {
            const auto& bounds = plan.retained_scene.object_local_bounds[index];
            if (!bounds.valid) continue;
            out << "  if (object_index == " << index << "u) { return vec3<f32>("
                << wgsl_f32(bounds.maximum[0]) << ", "
                << wgsl_f32(bounds.maximum[1]) << ", "
                << wgsl_f32(bounds.maximum[2]) << "); }\n";
        }
        out << "  return vec3<f32>(0.0);\n}\n";
        out << "fn vkf_object_has_local_bounds(object_index: u32) -> bool {\n";
        for (std::size_t index = 0;
             index < plan.retained_scene.object_local_bounds.size(); ++index) {
            if (!plan.retained_scene.object_local_bounds[index].valid) continue;
            out << "  if (object_index == " << index << "u) { return true; }\n";
        }
        out << "  return false;\n}\n";
        out << R"wgsl(

fn vkf_safe_normalize(value: vec3<f32>) -> vec3<f32> {
  return value * inverseSqrt(max(dot(value, value), 1.0e-12));
}

fn vkf_adaptive_shadow_up(direction: vec3<f32>) -> vec3<f32> {
  let unit_direction = vkf_safe_normalize(direction);
  return select(
    vec3<f32>(0.0, 0.0, 1.0),
    vec3<f32>(0.0, 1.0, 0.0),
    abs(unit_direction.z) > 0.98
  );
}

fn vkf_polarization_axis(
  propagation: vec3<f32>,
  basis_hint: vec3<f32>,
) -> vec3<f32> {
  let k = vkf_safe_normalize(propagation);
  let projected = basis_hint - k * dot(basis_hint, k);
  let fallback_hint = select(
    vec3<f32>(0.0, 0.0, 1.0),
    vec3<f32>(1.0, 0.0, 0.0),
    abs(k.z) > 0.9
  );
  let fallback = fallback_hint - k * dot(fallback_hint, k);
  return vkf_safe_normalize(select(
    projected, fallback, dot(projected, projected) < 1.0e-10));
}

fn vkf_rotate_stokes_basis(
  polarization: vec4<f32>,
  propagation: vec3<f32>,
  from_basis_hint: vec3<f32>,
  to_basis_hint: vec3<f32>,
) -> vec4<f32> {
  let k = vkf_safe_normalize(propagation);
  let from_axis = vkf_polarization_axis(k, from_basis_hint);
  let to_axis = vkf_polarization_axis(k, to_basis_hint);
  let perpendicular_axis = cross(k, from_axis);
  let cosine = clamp(dot(from_axis, to_axis), -1.0, 1.0);
  let sine = clamp(dot(perpendicular_axis, to_axis), -1.0, 1.0);
  let cos_double = cosine * cosine - sine * sine;
  let sin_double = 2.0 * cosine * sine;
  return vec4<f32>(
    polarization.x,
    polarization.y * cos_double + polarization.z * sin_double,
    -polarization.y * sin_double + polarization.z * cos_double,
    polarization.w
  );
}

fn vkf_look_at(
  eye: vec3<f32>,
  focus_point: vec3<f32>,
  up_hint: vec3<f32>,
) -> mat4x4<f32> {
  let z_axis = vkf_safe_normalize(eye - focus_point);
  let x_axis = vkf_safe_normalize(cross(up_hint, z_axis));
  let y_axis = cross(z_axis, x_axis);
  return mat4x4<f32>(
    vec4<f32>(x_axis.x, y_axis.x, z_axis.x, 0.0),
    vec4<f32>(x_axis.y, y_axis.y, z_axis.y, 0.0),
    vec4<f32>(x_axis.z, y_axis.z, z_axis.z, 0.0),
    vec4<f32>(-dot(x_axis, eye), -dot(y_axis, eye), -dot(z_axis, eye), 1.0)
  );
}

fn vkf_perspective(
  fov_y_radians: f32,
  aspect: f32,
  near_plane: f32,
  far_plane: f32,
) -> mat4x4<f32> {
  let focal = 1.0 / tan(fov_y_radians * 0.5);
  let depth = far_plane / (near_plane - far_plane);
  return mat4x4<f32>(
    vec4<f32>(focal / max(aspect, 1.0e-6), 0.0, 0.0, 0.0),
    vec4<f32>(0.0, focal, 0.0, 0.0),
    vec4<f32>(0.0, 0.0, depth, -1.0),
    vec4<f32>(0.0, 0.0, near_plane * depth, 0.0)
  );
}

fn vkf_reflect_point(
  point: vec3<f32>,
  plane_point: vec3<f32>,
  plane_normal: vec3<f32>,
) -> vec3<f32> {
  return point - 2.0 * dot(point - plane_point, plane_normal) * plane_normal;
}

fn vkf_reflect_direction(
  direction: vec3<f32>,
  plane_normal: vec3<f32>,
) -> vec3<f32> {
  return direction - 2.0 * dot(direction, plane_normal) * plane_normal;
}

fn vkf_flip_clip_x() -> mat4x4<f32> {
  return mat4x4<f32>(
    vec4<f32>(-1.0, 0.0, 0.0, 0.0),
    vec4<f32>(0.0, 1.0, 0.0, 0.0),
    vec4<f32>(0.0, 0.0, 1.0, 0.0),
    vec4<f32>(0.0, 0.0, 0.0, 1.0)
  );
}

fn vkf_scale_matrix(scale: vec3<f32>) -> mat4x4<f32> {
  return mat4x4<f32>(
    vec4<f32>(scale.x, 0.0, 0.0, 0.0),
    vec4<f32>(0.0, scale.y, 0.0, 0.0),
    vec4<f32>(0.0, 0.0, scale.z, 0.0),
    vec4<f32>(0.0, 0.0, 0.0, 1.0)
  );
}

fn vkf_translation_matrix(offset: vec3<f32>) -> mat4x4<f32> {
  return mat4x4<f32>(
    vec4<f32>(1.0, 0.0, 0.0, 0.0),
    vec4<f32>(0.0, 1.0, 0.0, 0.0),
    vec4<f32>(0.0, 0.0, 1.0, 0.0),
    vec4<f32>(offset, 1.0)
  );
}

fn vkf_rotation_matrix(degrees: vec3<f32>) -> mat4x4<f32> {
  let radians = degrees * 0.017453292519943295;
  let cx = cos(radians.x);
  let sx = sin(radians.x);
  let cy = cos(radians.y);
  let sy = sin(radians.y);
  let cz = cos(radians.z);
  let sz = sin(radians.z);
  let rotation_x = mat4x4<f32>(
    vec4<f32>(1.0, 0.0, 0.0, 0.0),
    vec4<f32>(0.0, cx, sx, 0.0),
    vec4<f32>(0.0, -sx, cx, 0.0),
    vec4<f32>(0.0, 0.0, 0.0, 1.0)
  );
  let rotation_y = mat4x4<f32>(
    vec4<f32>(cy, 0.0, -sy, 0.0),
    vec4<f32>(0.0, 1.0, 0.0, 0.0),
    vec4<f32>(sy, 0.0, cy, 0.0),
    vec4<f32>(0.0, 0.0, 0.0, 1.0)
  );
  let rotation_z = mat4x4<f32>(
    vec4<f32>(cz, sz, 0.0, 0.0),
    vec4<f32>(-sz, cz, 0.0, 0.0),
    vec4<f32>(0.0, 0.0, 1.0, 0.0),
    vec4<f32>(0.0, 0.0, 0.0, 1.0)
  );
  return rotation_z * rotation_y * rotation_x;
}

fn vkf_aperture_position(vertex_index: u32) -> vec3<f32> {
  let base = pass_state.aperture_float_offset +
    vertex_index * pass_state.aperture_vertex_stride_floats;
  let local_position = vec3<f32>(
    aperture_vertices[base],
    aperture_vertices[base + 1u],
    aperture_vertices[base + 2u]
  );
  return (derived_objects[pass_state.object_index].value.model *
    vec4<f32>(local_position, 1.0)).xyz;
}

fn vkf_aperture_near_plane(
  view: mat4x4<f32>,
  near_hint: f32,
) -> f32 {
  var aperture_distance = 1.0e30;
  for (var vertex_index = 0u;
       vertex_index < pass_state.aperture_vertex_count;
       vertex_index = vertex_index + 1u) {
    let camera_vertex = view * vec4<f32>(
      vkf_aperture_position(vertex_index), 1.0);
    aperture_distance = min(
      aperture_distance, max(-camera_vertex.z, 1.0e-4));
  }
  return max(near_hint, aperture_distance - 1.0e-3);
}

fn vkf_off_axis_projection(
  view: mat4x4<f32>,
  near_hint: f32,
  far_plane: f32,
) -> mat4x4<f32> {
  let near_plane = vkf_aperture_near_plane(view, near_hint);
  var min_x = 1.0e30;
  var max_x = -1.0e30;
  var min_y = 1.0e30;
  var max_y = -1.0e30;
  for (var vertex_index = 0u;
       vertex_index < pass_state.aperture_vertex_count;
       vertex_index = vertex_index + 1u) {
    let camera_vertex = view * vec4<f32>(
      vkf_aperture_position(vertex_index), 1.0);
    let scale = near_plane / max(-camera_vertex.z, 1.0e-4);
    min_x = min(min_x, camera_vertex.x * scale);
    max_x = max(max_x, camera_vertex.x * scale);
    min_y = min(min_y, camera_vertex.y * scale);
    max_y = max(max_y, camera_vertex.y * scale);
  }
  let width = max(max_x - min_x, 1.0e-5);
  let height = max(max_y - min_y, 1.0e-5);
  let depth = far_plane / (near_plane - far_plane);
  return mat4x4<f32>(
    vec4<f32>(2.0 * near_plane / width, 0.0, 0.0, 0.0),
    vec4<f32>(0.0, 2.0 * near_plane / height, 0.0, 0.0),
    vec4<f32>((max_x + min_x) / width,
      (max_y + min_y) / height, depth, -1.0),
    vec4<f32>(0.0, 0.0, near_plane * depth, 0.0)
  );
}

)wgsl";
        out << "fn vkf_shadow_slot(light_index: u32) -> i32 {\n";
        std::uint32_t emitted_shadow_slot = 0;
        for (const auto& light : plan.retained_scene.lights) {
            if (!light.casts_shadow) continue;
            out << "  if (light_index == " << light.light_index
                << "u) { return " << emitted_shadow_slot << "; }\n";
            emitted_shadow_slot += light.shadow_view_count;
        }
        out << "  return -1;\n}\n";
        constexpr auto shadow_receiver_mask_bits =
            std::numeric_limits<std::uint32_t>::digits;
        if (plan.retained_scene.shadow_receivers.empty() &&
            plan.retained_scene.lights.size() > shadow_receiver_mask_bits) {
            throw WebGpuArtifactFailure(
                "compiled shadow receiver masks support at most 32 lights");
        }
        std::map<std::uint32_t, std::uint32_t> shadow_receiver_masks;
        for (const auto& receiver : plan.retained_scene.shadow_receivers) {
            auto& mask = shadow_receiver_masks[receiver.receiver_object_index];
            for (const auto light_index : receiver.light_indices) {
                if (light_index >= shadow_receiver_mask_bits) {
                    throw WebGpuArtifactFailure(
                        "compiled shadow receiver masks support at most 32 lights");
                }
                mask |= std::uint32_t{1} << light_index;
            }
        }
        const auto default_shadow_receiver_mask =
            plan.retained_scene.shadow_receivers.empty()
            ? (plan.retained_scene.lights.size() == shadow_receiver_mask_bits
                ? std::numeric_limits<std::uint32_t>::max()
                : ((std::uint32_t{1} << plan.retained_scene.lights.size()) - 1u))
            : 0u;
        out << "fn vkf_shadow_receiver_light_mask("
            << "receiver_object_index: u32) -> u32 {\n";
        for (const auto& [receiver_object_index, mask] :
             shadow_receiver_masks) {
            out << "  if (receiver_object_index == "
                << receiver_object_index << "u) { return " << mask
                << "u; }\n";
        }
        out << "  return " << default_shadow_receiver_mask << "u;\n}\n";
        out << "fn vkf_shadow_view_count(light_index: u32) -> u32 {\n";
        for (const auto& light : plan.retained_scene.lights) {
            if (!light.casts_shadow) continue;
            out << "  if (light_index == " << light.light_index
                << "u) { return " << light.shadow_view_count << "u; }\n";
        }
        out << "  return 0u;\n}\n";
        out << "fn vkf_reflection_camera_slot(object_index: u32) -> u32 {\n";
        for (std::size_t surface_index = 0;
             surface_index <
                 plan.retained_scene.reflective_surfaces.size();
             ++surface_index) {
            const auto& surface =
                plan.retained_scene.reflective_surfaces[surface_index];
            out << "  if (object_index == " << surface.object_index
                << "u) { return " << surface_index << "u; }\n";
        }
        out << "  return 0xffffffffu;\n}\n";
        out << "fn vkf_reflection_parent_slot(camera_index: u32) -> u32 {\n";
        for (std::size_t path_index = 0; path_index < reflection_paths.size();
             ++path_index) {
            if (reflection_paths[path_index].size() < 2) continue;
            auto parent = reflection_paths[path_index];
            parent.pop_back();
            out << "  if (camera_index == " << path_index << "u) { return "
                << reflection_path_index(reflection_paths, parent)
                << "u; }\n";
        }
        out << "  return 0xffffffffu;\n}\n";
        out << "fn vkf_next_reflection_camera_slot(\n"
            << "  camera_index: u32, object_index: u32,\n"
            << ") -> u32 {\n";
        for (std::size_t path_index = 0; path_index < reflection_paths.size();
             ++path_index) {
            const auto& parent = reflection_paths[path_index];
            if (parent.size() >= plan.retained_scene.max_reflection_depth) {
                continue;
            }
            for (std::size_t surface_index = 0;
                 surface_index < plan.retained_scene.reflective_surfaces.size();
                 ++surface_index) {
                if (surface_index == parent.back()) continue;
                auto child = parent;
                child.push_back(surface_index);
                out << "  if (camera_index == " << path_index
                    << "u && object_index == "
                    << plan.retained_scene.reflective_surfaces[surface_index]
                           .object_index
                    << "u) { return "
                    << reflection_path_index(reflection_paths, child)
                    << "u; }\n";
            }
        }
        out << "  return 0xffffffffu;\n}\n";
        out << R"wgsl(

struct VkfDirectShadowBounds {
  minimum: vec3<f32>,
  maximum: vec3<f32>,
};

fn vkf_scene_transform_revision() -> u32 {
  var transform_revision = 2166136261u;
  for (var object_index = 0u;
       object_index < VKF_OBJECT_COUNT;
       object_index = object_index + 1u) {
    let base = object_index * 32u;
    for (var field_index = 0u; field_index < 9u;
         field_index = field_index + 1u) {
      transform_revision =
        (transform_revision ^ bitcast<u32>(raw_objects[base + field_index])) *
        16777619u;
    }
  }
  return transform_revision;
}

fn vkf_refit_direct_shadow_bounds() -> VkfDirectShadowBounds {
  var minimum = vec3<f32>(1.0e30);
  var maximum = vec3<f32>(-1.0e30);
  var point_count = 0u;
  for (var object_index = 0u;
       object_index < VKF_OBJECT_COUNT;
       object_index = object_index + 1u) {
    if (!vkf_object_has_local_bounds(object_index)) {
      continue;
    }
    let local_minimum = vkf_object_local_bounds_min(object_index);
    let local_maximum = vkf_object_local_bounds_max(object_index);
    let model = derived_objects[object_index].value.model;
    for (var corner_index = 0u; corner_index < 8u;
         corner_index = corner_index + 1u) {
      let local_corner = vec3<f32>(
        select(local_minimum.x, local_maximum.x,
          (corner_index & 1u) != 0u),
        select(local_minimum.y, local_maximum.y,
          (corner_index & 2u) != 0u),
        select(local_minimum.z, local_maximum.z,
          (corner_index & 4u) != 0u)
      );
      let world_corner = (model * vec4<f32>(local_corner, 1.0)).xyz;
      minimum = min(minimum, world_corner);
      maximum = max(maximum, world_corner);
      point_count = point_count + 1u;
    }
  }
  if (point_count == 0u) {
    minimum = VKF_DIRECT_SHADOW_BOUNDS_MIN;
    maximum = VKF_DIRECT_SHADOW_BOUNDS_MAX;
  }
  return VkfDirectShadowBounds(minimum, maximum);
}

fn vkf_direct_shadow_bounds_corner(
  bounds: VkfDirectShadowBounds,
  index: u32,
) -> vec3<f32> {
  return vec3<f32>(
    select(bounds.minimum.x, bounds.maximum.x, (index & 1u) != 0u),
    select(bounds.minimum.y, bounds.maximum.y, (index & 2u) != 0u),
    select(bounds.minimum.z, bounds.maximum.z, (index & 4u) != 0u)
  );
}

fn vkf_cube_shadow_direction(face: u32) -> vec3<f32> {
  switch face {
    case 0u: { return vec3<f32>(1.0, 0.0, 0.0); }
    case 1u: { return vec3<f32>(-1.0, 0.0, 0.0); }
    case 2u: { return vec3<f32>(0.0, 1.0, 0.0); }
    case 3u: { return vec3<f32>(0.0, -1.0, 0.0); }
    case 4u: { return vec3<f32>(0.0, 0.0, 1.0); }
    default: { return vec3<f32>(0.0, 0.0, -1.0); }
  }
}

fn vkf_cube_shadow_up(face: u32) -> vec3<f32> {
  return select(
    vec3<f32>(0.0, 0.0, 1.0),
    vec3<f32>(0.0, 1.0, 0.0),
    face >= 4u
  );
}

fn vkf_cube_shadow_view_projection(
  light: SceneLight,
  face: u32,
  near_plane: f32,
  far_plane: f32,
) -> mat4x4<f32> {
  let eye = light.position_and_range.xyz;
  return vkf_perspective(
    1.5707963267948966, 1.0, near_plane, far_plane) *
    vkf_look_at(
      eye,
      eye + vkf_cube_shadow_direction(face),
      vkf_cube_shadow_up(face)
    );
}

fn vkf_cube_shadow_face(direction: vec3<f32>) -> u32 {
  let absolute = abs(direction);
  if (absolute.x >= absolute.y && absolute.x >= absolute.z) {
    return select(1u, 0u, direction.x >= 0.0);
  }
  if (absolute.y >= absolute.z) {
    return select(3u, 2u, direction.y >= 0.0);
  }
  return select(5u, 4u, direction.z >= 0.0);
}

fn vkf_direct_shadow_view(
  light: SceneLight,
  bounds: VkfDirectShadowBounds,
) -> mat4x4<f32> {
  let center = (bounds.minimum + bounds.maximum) * 0.5;
  let direction = vkf_safe_normalize(center - light.position_and_range.xyz);
  let up = vkf_adaptive_shadow_up(direction);
  return vkf_look_at(light.position_and_range.xyz, center, up);
}

fn vkf_direct_shadow_near_far(
  light: SceneLight,
  view: mat4x4<f32>,
  bounds: VkfDirectShadowBounds,
) -> vec2<f32> {
  var min_depth = 1.0e30;
  var max_depth = 0.0;
  for (var index = 0u; index < 8u; index = index + 1u) {
    let camera_corner = view * vec4<f32>(
      vkf_direct_shadow_bounds_corner(bounds, index), 1.0);
    let depth = max(-camera_corner.z, 1.0e-4);
    min_depth = min(min_depth, depth);
    max_depth = max(max_depth, depth);
  }
  let source_near = max(0.01, light.target_and_radius.w * 0.05);
  let near_plane = max(source_near, min_depth * 0.5);
  let far_plane = max(
    max(near_plane + 0.01, light.position_and_range.w),
    max_depth * 1.05
  );
  return vec2<f32>(near_plane, far_plane);
}

fn vkf_fit_direct_shadow_view_projection(
  light: SceneLight,
  near_plane: f32,
  far_plane: f32,
  bounds: VkfDirectShadowBounds,
) -> mat4x4<f32> {
  let view = vkf_direct_shadow_view(light, bounds);
  var min_x = 1.0e30;
  var max_x = -1.0e30;
  var min_y = 1.0e30;
  var max_y = -1.0e30;
  for (var index = 0u; index < 8u; index = index + 1u) {
    let camera_corner = view * vec4<f32>(
      vkf_direct_shadow_bounds_corner(bounds, index), 1.0);
    let scale = near_plane / max(-camera_corner.z, 1.0e-4);
    min_x = min(min_x, camera_corner.x * scale);
    max_x = max(max_x, camera_corner.x * scale);
    min_y = min(min_y, camera_corner.y * scale);
    max_y = max(max_y, camera_corner.y * scale);
  }
  let center_x = (min_x + max_x) * 0.5;
  let center_y = (min_y + max_y) * 0.5;
  let half_width = max((max_x - min_x) * 0.515, 1.0e-5);
  let half_height = max((max_y - min_y) * 0.515, 1.0e-5);
  let left = center_x - half_width;
  let right = center_x + half_width;
  let bottom = center_y - half_height;
  let top = center_y + half_height;
  let width = right - left;
  let height = top - bottom;
  let depth = far_plane / (near_plane - far_plane);
  let projection = mat4x4<f32>(
    vec4<f32>(2.0 * near_plane / width, 0.0, 0.0, 0.0),
    vec4<f32>(0.0, 2.0 * near_plane / height, 0.0, 0.0),
    vec4<f32>((right + left) / width,
      (top + bottom) / height, depth, -1.0),
    vec4<f32>(0.0, 0.0, near_plane * depth, 0.0)
  );
  return projection * view;
}

)wgsl";
        out << R"wgsl(
fn vkf_store_shadow_matrix(
  light_index: u32,
  bounds: VkfDirectShadowBounds,
) {
  let shadow_slot = vkf_shadow_slot(light_index);
  if (shadow_slot >= 0) {
    let shadow_view_count = vkf_shadow_view_count(light_index);
    derived_lights[light_index].kind_and_shadow.z = f32(shadow_slot);
    derived_lights[light_index].kind_and_shadow.w = f32(shadow_view_count);
    if (shadow_view_count == 6u) {
      let near_plane = max(
        0.01, derived_lights[light_index].target_and_radius.w * 0.05);
      let far_plane = max(
        near_plane + 0.01,
        derived_lights[light_index].position_and_range.w);
      for (var face = 0u; face < 6u; face = face + 1u) {
        let view_index = u32(shadow_slot) + face;
        derived_scene.shadow_near_far[view_index] =
          vec4<f32>(near_plane, far_plane, 0.0, 0.0);
        derived_scene.light_view_projection[view_index] =
          vkf_cube_shadow_view_projection(
            derived_lights[light_index], face, near_plane, far_plane);
      }
      return;
    }
    let view = vkf_direct_shadow_view(derived_lights[light_index], bounds);
    let near_far = vkf_direct_shadow_near_far(
      derived_lights[light_index], view, bounds);
    let near_plane = near_far.x;
    let far_plane = near_far.y;
    derived_scene.shadow_near_far[u32(shadow_slot)] =
      vec4<f32>(near_plane, far_plane, 0.0, 0.0);
    derived_scene.light_view_projection[u32(shadow_slot)] =
      vkf_fit_direct_shadow_view_projection(
        derived_lights[light_index], near_plane, far_plane, bounds);
  }
}

@compute @workgroup_size(64)
fn vkf_prepare_frame(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let item_index = invocation.x;
  if (item_index == 0u) {
    let eye = vec3<f32>(raw_camera[0], raw_camera[1], raw_camera[2]);
    let focus_point = vec3<f32>(raw_camera[3], raw_camera[4], raw_camera[5]);
    let up = vec3<f32>(raw_camera[6], raw_camera[7], raw_camera[8]);
    let near_plane = max(raw_camera[10], 1.0e-4);
    let far_plane = max(raw_camera[11], near_plane + 0.01);
    let aspect = viewport.width / max(viewport.height, 1.0);
    derived_scene.view_projection = vkf_perspective(
      raw_camera[9] * 0.017453292519943295,
      aspect,
      near_plane,
      far_plane
    ) * vkf_look_at(eye, focus_point, up);
    derived_scene.view_position = vec4<f32>(eye, 1.0);
    derived_scene.ambient = vec4<f32>(
      raw_camera[12], raw_camera[13], raw_camera[14], raw_camera[15]);
  }
  if (item_index < VKF_LIGHT_COUNT) {
    let base = item_index * 28u;
    derived_lights[item_index].position_and_range = vec4<f32>(
      raw_lights[base], raw_lights[base + 1u], raw_lights[base + 2u],
      max(raw_lights[base + 11u], 0.0));
    derived_lights[item_index].color_and_intensity = vec4<f32>(
      raw_lights[base + 6u], raw_lights[base + 7u], raw_lights[base + 8u],
      raw_lights[base + 10u]);
    derived_lights[item_index].target_and_radius = vec4<f32>(
      raw_lights[base + 3u], raw_lights[base + 4u], raw_lights[base + 5u],
      raw_lights[base + 12u]);
    derived_lights[item_index].kind_and_shadow = vec4<f32>(
      raw_lights[base + 13u], raw_lights[base + 14u], -1.0, -1.0);
    derived_lights[item_index].aperture_float_offset = 0u;
    derived_lights[item_index].aperture_vertex_count = 0u;
    derived_lights[item_index].aperture_vertex_stride_floats = 0u;
    derived_lights[item_index].aperture_object_index = 0u;
    derived_lights[item_index].polarization = vec4<f32>(
      raw_lights[base + 20u], raw_lights[base + 21u],
      raw_lights[base + 22u], raw_lights[base + 23u]);
    derived_lights[item_index].polarization_basis = vec4<f32>(
      raw_lights[base + 24u], raw_lights[base + 25u],
      raw_lights[base + 26u], raw_lights[base + 27u]);
  }
  if (item_index < VKF_OBJECT_COUNT) {
    let base = item_index * 32u;
    let center = vec3<f32>(
      raw_objects[base], raw_objects[base + 1u], raw_objects[base + 2u]);
    let scale = vec3<f32>(
      raw_objects[base + 3u], raw_objects[base + 4u],
      raw_objects[base + 5u]);
    let rotation = vkf_rotation_matrix(vec3<f32>(
      raw_objects[base + 6u], raw_objects[base + 7u],
      raw_objects[base + 8u]));
    derived_objects_write[item_index].value.model =
      vkf_translation_matrix(center) * rotation * vkf_scale_matrix(scale);
    derived_objects_write[item_index].value.normal_matrix = rotation *
      vkf_scale_matrix(vec3<f32>(1.0) /
        max(abs(scale), vec3<f32>(1.0e-6)));
    derived_objects_write[item_index].value.base_color = vec4<f32>(
      raw_objects[base + 9u], raw_objects[base + 10u],
      raw_objects[base + 11u], raw_objects[base + 12u]);
    derived_objects_write[item_index].value.checker_color_a = vec4<f32>(
      raw_objects[base + 13u], raw_objects[base + 14u],
      raw_objects[base + 15u], raw_objects[base + 16u]);
    derived_objects_write[item_index].value.checker_color_b = vec4<f32>(
      raw_objects[base + 17u], raw_objects[base + 18u],
      raw_objects[base + 19u], raw_objects[base + 20u]);
    derived_objects_write[item_index].value.checker_scale = vec2<f32>(
      raw_objects[base + 21u], raw_objects[base + 22u]);
    derived_objects_write[item_index].value.reflectivity = raw_objects[base + 23u];
    derived_objects_write[item_index].value.receives_shadow =
      u32(raw_objects[base + 24u]);
    derived_objects_write[item_index].value.texture_kind =
      u32(raw_objects[base + 25u]);
    derived_objects_write[item_index].value.reflection_depth = 0u;
    derived_objects_write[item_index].value.roughness =
      clamp(raw_objects[base + 26u], 0.02, 1.0);
    derived_objects_write[item_index].value.specular_strength =
      max(raw_objects[base + 27u], 0.0);
    derived_objects_write[item_index].value.no_backface_specular =
      u32(raw_objects[base + 28u]);
    derived_objects_write[item_index].value.surface_kind =
      u32(raw_objects[base + 29u]);
    derived_objects_write[item_index].value.reflection_camera_index =
      vkf_reflection_camera_slot(item_index);
    derived_objects_write[item_index].value.object_index = item_index;
    derived_objects_write[item_index].value.ior = raw_objects[base + 30u];
    derived_objects_write[item_index].value.extinction = raw_objects[base + 31u];
  }
}

@compute @workgroup_size(1)
fn vkf_refit_shadow_views() {
  // The revision is deliberately evaluated before the refit. The first
  // correctness slice refits every frame; a later cache may skip equal values.
  let transform_revision = vkf_scene_transform_revision();
  let current_bounds = vkf_refit_direct_shadow_bounds();
  if (transform_revision == 0xffffffffu && VKF_OBJECT_COUNT == 0u) {
    return;
  }
  for (var light_index = 0u; light_index < VKF_LIGHT_COUNT;
       light_index = light_index + 1u) {
    if (u32(raw_lights[light_index * 28u + 13u]) != 2u) {
      vkf_store_shadow_matrix(light_index, current_bounds);
    }
  }
}

@compute @workgroup_size(1)
fn vkf_prepare_reflection_camera() {
  if (pass_state.aperture_vertex_count < 3u) {
    return;
  }
  let aperture_0 = vkf_aperture_position(0u);
  var aperture_center = vec3<f32>(0.0);
  for (var vertex_index = 0u;
       vertex_index < pass_state.aperture_vertex_count;
       vertex_index = vertex_index + 1u) {
    aperture_center = aperture_center + vkf_aperture_position(vertex_index);
  }
  aperture_center = aperture_center / f32(pass_state.aperture_vertex_count);
  var plane_normal_sum = vec3<f32>(0.0);
  for (var triangle_index = 1u;
       triangle_index + 1u < pass_state.aperture_vertex_count;
       triangle_index = triangle_index + 1u) {
    plane_normal_sum = plane_normal_sum + cross(
      vkf_aperture_position(triangle_index) - aperture_0,
      vkf_aperture_position(triangle_index + 1u) - aperture_0
    );
  }
  let plane_normal = vkf_safe_normalize(plane_normal_sum);
  let parent_camera_index = vkf_reflection_parent_slot(
    pass_state.camera_state_index);
  var eye = vec3<f32>(raw_camera[0], raw_camera[1], raw_camera[2]);
  var focus_point = vec3<f32>(raw_camera[3], raw_camera[4], raw_camera[5]);
  if (parent_camera_index != 0xffffffffu) {
    eye = derived_scene.mirror_view_position[parent_camera_index].xyz;
    focus_point = derived_scene.mirror_view_target[parent_camera_index].xyz;
  }
  let reflected_eye = vkf_reflect_point(eye, aperture_0, plane_normal);
  let reflected_target = vkf_reflect_point(
    focus_point, aperture_0, plane_normal);
  let reflected_view = vkf_look_at(
    reflected_eye,
    reflected_target,
    vec3<f32>(raw_camera[6], raw_camera[7], raw_camera[8])
  );
  derived_scene.mirror_view_projection[pass_state.camera_state_index] =
    vkf_off_axis_projection(
      reflected_view,
      max(raw_camera[10], 1.0e-4),
      max(raw_camera[11], raw_camera[10] + 0.01)
    ) * reflected_view;
  derived_scene.mirror_view_position[pass_state.camera_state_index] =
    vec4<f32>(reflected_eye, 1.0);
  derived_scene.mirror_view_target[pass_state.camera_state_index] =
    vec4<f32>(reflected_target, 1.0);

  for (var light_index = 0u;
       light_index < VKF_LIGHT_COUNT;
       light_index = light_index + 1u) {
    let base = light_index * 28u;
    let reflect_light_index = i32(raw_lights[base + 15u]);
    let reflect_object_index = i32(raw_lights[base + 16u]);
    if (u32(raw_lights[base + 13u]) == 2u &&
        reflect_light_index >= 0 &&
        reflect_object_index == i32(pass_state.object_index)) {
      let source = derived_lights[u32(reflect_light_index)];
      derived_lights[light_index].color_and_intensity =
        source.color_and_intensity;
      let reflected_light_position = vkf_reflect_point(
        source.position_and_range.xyz, aperture_0, plane_normal);
      let incident_propagation = vkf_safe_normalize(
        aperture_center - source.position_and_range.xyz);
      let incidence_s_axis = vkf_safe_normalize(
        cross(incident_propagation, plane_normal));
      let local_stokes = vkf_rotate_stokes_basis(
        source.polarization,
        incident_propagation,
        source.polarization_basis.xyz,
        incidence_s_axis
      );
      let mirror_material =
        derived_objects[pass_state.object_index].value;
      let reflected_stokes = vkf_reflect_stokes(
        abs(dot(incident_propagation, plane_normal)),
        mirror_material.ior,
        mirror_material.reflectivity,
        local_stokes
      );
      let reflected_power = reflected_stokes.x /
        max(local_stokes.x, 1.0e-12);
      derived_lights[light_index].color_and_intensity.w =
        source.color_and_intensity.w * reflected_power;
      derived_lights[light_index].polarization = reflected_stokes /
        max(reflected_stokes.x, 1.0e-12);
      let outgoing_propagation = vkf_safe_normalize(
        aperture_center - reflected_light_position);
      derived_lights[light_index].polarization_basis = vec4<f32>(
        vkf_polarization_axis(outgoing_propagation, incidence_s_axis), 0.0);
      derived_lights[light_index].position_and_range = vec4<f32>(
        reflected_light_position,
        source.position_and_range.w
      );
      derived_lights[light_index].target_and_radius = vec4<f32>(
        aperture_center,
        source.target_and_radius.w
      );
      derived_lights[light_index].aperture_float_offset =
        pass_state.aperture_float_offset;
      derived_lights[light_index].aperture_vertex_count =
        pass_state.aperture_vertex_count;
      derived_lights[light_index].aperture_vertex_stride_floats =
        pass_state.aperture_vertex_stride_floats;
      derived_lights[light_index].aperture_object_index =
        pass_state.object_index;
      let projected_shadow_slot = vkf_shadow_slot(light_index);
      if (projected_shadow_slot >= 0) {
        derived_lights[light_index].kind_and_shadow.z =
          f32(projected_shadow_slot);
        derived_lights[light_index].kind_and_shadow.w =
          1.0;
        let projected_direction =
          derived_lights[light_index].target_and_radius.xyz -
          derived_lights[light_index].position_and_range.xyz;
        let projected_up = vkf_adaptive_shadow_up(projected_direction);
        let projected_view = vkf_look_at(
          derived_lights[light_index].position_and_range.xyz,
          derived_lights[light_index].target_and_radius.xyz,
          vkf_adaptive_shadow_up(projected_direction)
        );
        let projected_forward = vkf_safe_normalize(
          derived_lights[light_index].position_and_range.xyz -
          derived_lights[light_index].target_and_radius.xyz
        );
        let projected_right = vkf_safe_normalize(cross(
          projected_up, projected_forward));
        let aperture_right = vkf_safe_normalize(
          vkf_aperture_position(1u) - aperture_0);
        let projected_near_plane = vkf_aperture_near_plane(
          projected_view,
          max(source.target_and_radius.w * 0.05, 1.0e-4));
        let projected_far_plane = max(
          derived_lights[light_index].position_and_range.w,
          projected_near_plane + 0.01);
        var projected_projection = vkf_off_axis_projection(
          projected_view, projected_near_plane, projected_far_plane);
        if (dot(projected_right, aperture_right) < 0.0) {
          projected_projection = vkf_flip_clip_x() * projected_projection;
        }
        derived_scene.light_view_projection[u32(projected_shadow_slot)] =
          projected_projection * projected_view;
        derived_scene.shadow_near_far[u32(projected_shadow_slot)] =
          vec4<f32>(
            projected_near_plane, projected_far_plane, 0.0, 0.0);
      }
    }
  }
}

struct SceneVertexOut {
  @builtin(position) clip_position: vec4<f32>,
  @location(0) world_position: vec3<f32>,
  @location(1) world_normal: vec3<f32>,
  @location(2) color: vec4<f32>,
  @location(3) local_position: vec3<f32>,
  @location(4) view_position: vec3<f32>,
  @interpolate(flat) @location(5) reflection_camera_index: u32,
  @location(6) local_normal: vec3<f32>,
};

@vertex
fn vkf_scene_vertex(
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) color: vec4<f32>,
) -> SceneVertexOut {
  var out: SceneVertexOut;
  let world_position = object.model * vec4<f32>(position, 1.0);
  out.clip_position = scene.view_projection * world_position;
  out.world_position = world_position.xyz;
  out.world_normal = normalize((object.normal_matrix * vec4<f32>(normal, 0.0)).xyz);
  out.color = color * object.base_color;
  out.local_position = position;
  out.local_normal = normal;
  out.view_position = scene.view_position.xyz;
  out.reflection_camera_index = object.reflection_camera_index;
  return out;
}

@vertex
fn vkf_reflection_vertex(
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) color: vec4<f32>,
) -> SceneVertexOut {
  var out: SceneVertexOut;
  let world_position = object.model * vec4<f32>(position, 1.0);
  out.clip_position = scene.mirror_view_projection[
    pass_state.camera_state_index] * world_position;
  out.world_position = world_position.xyz;
  out.world_normal = normalize((object.normal_matrix *
    vec4<f32>(normal, 0.0)).xyz);
  out.color = color * object.base_color;
  out.local_position = position;
  out.local_normal = normal;
  out.view_position = scene.mirror_view_position[
    pass_state.camera_state_index].xyz;
  out.reflection_camera_index = vkf_next_reflection_camera_slot(
    pass_state.camera_state_index, object.object_index);
  return out;
}

@vertex
fn vkf_shadow_vertex(
  @location(0) position: vec3<f32>,
) -> @builtin(position) vec4<f32> {
  return scene.light_view_projection[pass_state.camera_state_index] *
    object.model * vec4<f32>(position, 1.0);
}
)wgsl";
        if (plan.retained_scene.checker_texture) {
            out << R"wgsl(
fn vkf_checker_color(
  local_position: vec3<f32>,
  local_normal: vec3<f32>,
) -> vec4<f32> {
  let normal_weight = abs(local_normal);
  var planar_position = local_position.xy;
  if (normal_weight.y >= normal_weight.x &&
      normal_weight.y >= normal_weight.z) {
    planar_position = local_position.xz;
  } else if (normal_weight.x >= normal_weight.z) {
    planar_position = local_position.yz;
  }
  let cell = vec2<i32>(floor(planar_position * object.checker_scale));
  let parity = (cell.x + cell.y) & 1;
  return select(object.checker_color_a, object.checker_color_b, parity != 0);
}
)wgsl";
        }
        if (plan.retained_scene.shadow_map) {
            out << R"wgsl(
const VKF_SHADOW_BLOCKER_SAMPLE_COUNT: u32 = 16u;
const VKF_SHADOW_FILTER_SAMPLE_COUNT: u32 = 32u;
const VKF_SHADOW_DISK: array<vec2<f32>, 32> = array<vec2<f32>, 32>(
  vec2<f32>(0.125000, 0.000000),
  vec2<f32>(-0.159645, 0.146248),
  vec2<f32>(0.024436, -0.278438),
  vec2<f32>(0.201222, 0.262459),
  vec2<f32>(-0.369268, -0.065318),
  vec2<f32>(0.349802, -0.222516),
  vec2<f32>(-0.117002, 0.435242),
  vec2<f32>(-0.223136, -0.429634),
  vec2<f32>(0.484115, 0.176798),
  vec2<f32>(-0.503641, 0.207896),
  vec2<f32>(0.242788, -0.518824),
  vec2<f32>(0.179414, 0.572001),
  vec2<f32>(-0.540757, -0.313380),
  vec2<f32>(0.634370, -0.139464),
  vec2<f32>(-0.387146, 0.550675),
  vec2<f32>(-0.089440, -0.690200),
  vec2<f32>(0.549072, 0.462758),
  vec2<f32>(-0.738878, 0.030555),
  vec2<f32>(0.538955, -0.536332),
  vec2<f32>(-0.036058, 0.779792),
  vec2<f32>(-0.512818, -0.614527),
  vec2<f32>(0.812360, 0.109302),
  vec2<f32>(-0.688311, 0.478909),
  vec2<f32>(0.188086, -0.836061),
  vec2<f32>(0.435033, 0.759191),
  vec2<f32>(-0.850448, -0.271316),
  vec2<f32>(0.826102, -0.381680),
  vec2<f32>(-0.357888, 0.855156),
  vec2<f32>(-0.319407, -0.888034),
  vec2<f32>(0.849909, 0.446688),
  vec2<f32>(-0.944035, 0.248845),
  vec2<f32>(0.536596, -0.834530)
);

fn vkf_shadow_linear_distance(
  depth: f32,
  near_far: vec2<f32>,
) -> f32 {
  let near_plane = near_far.x;
  let far_plane = near_far.y;
  return near_plane * far_plane /
    max(far_plane - depth * (far_plane - near_plane), 1.0e-6);
}

fn vkf_shadow_projected_source_radius_uv(
  light_view_projection: mat4x4<f32>,
  source_center_world: vec3<f32>,
  source_basis_x_world: vec3<f32>,
  source_basis_y_world: vec3<f32>,
) -> f32 {
  let source_center_clip = light_view_projection *
    vec4<f32>(source_center_world, 1.0);
  let source_basis_x_clip = light_view_projection *
    vec4<f32>(source_basis_x_world, 1.0);
  let source_basis_y_clip = light_view_projection *
    vec4<f32>(source_basis_y_world, 1.0);
  if (source_center_clip.w <= 1.0e-6 ||
      source_basis_x_clip.w <= 1.0e-6 ||
      source_basis_y_clip.w <= 1.0e-6) {
    return 0.0;
  }
  let source_center_uv = source_center_clip.xy /
    source_center_clip.w * vec2<f32>(0.5, -0.5);
  let source_basis_x_uv = source_basis_x_clip.xy /
    source_basis_x_clip.w * vec2<f32>(0.5, -0.5);
  let source_basis_y_uv = source_basis_y_clip.xy /
    source_basis_y_clip.w * vec2<f32>(0.5, -0.5);
  return max(
    length(source_basis_x_uv - source_center_uv),
    length(source_basis_y_uv - source_center_uv));
}

fn vkf_shadow_receiver_bias(
  world_position: vec3<f32>,
  surface_normal: vec3<f32>,
  light_direction: vec3<f32>,
  light_view_projection: mat4x4<f32>,
  texel_size: vec2<f32>,
) -> f32 {
  let unit_light_direction = vkf_safe_normalize(light_direction);
  let basis_hint = select(
    vec3<f32>(0.0, 0.0, 1.0),
    vec3<f32>(0.0, 1.0, 0.0),
    abs(unit_light_direction.z) > 0.9);
  let basis_x = vkf_safe_normalize(cross(
    basis_hint, unit_light_direction));
  let basis_y = cross(unit_light_direction, basis_x);
  let projected_world_radius_uv = vkf_shadow_projected_source_radius_uv(
    light_view_projection,
    world_position,
    world_position + basis_x,
    world_position + basis_y);
  let texel_radius = max(texel_size.x, texel_size.y);
  let world_per_texel = texel_radius /
    max(projected_world_radius_uv, 1.0e-6);
  let slope = 1.0 - clamp(dot(
    vkf_safe_normalize(surface_normal), unit_light_direction), 0.0, 1.0);
  let world_bias = max(0.75, 3.0 * slope) * world_per_texel;
  let receiver_clip = light_view_projection *
    vec4<f32>(world_position, 1.0);
  let biased_clip = light_view_projection * vec4<f32>(
    world_position + unit_light_direction * world_bias, 1.0);
  let receiver_depth = receiver_clip.z / receiver_clip.w;
  let biased_depth = biased_clip.z / biased_clip.w;
  return max(receiver_depth - biased_depth, 0.0);
}

fn vkf_shadow_visibility(
  world_position: vec3<f32>,
  surface_normal: vec3<f32>,
  light: SceneLight,
) -> f32 {
  if (object.receives_shadow == 0u) {
    return 1.0;
  }
  let shadow_base = u32(light.kind_and_shadow.z);
  let shadow_view_count = u32(light.kind_and_shadow.w);
  var shadow_camera_index = shadow_base;
  var shadow_layer = i32(shadow_base);
  if (shadow_view_count == 6u) {
    let face = vkf_cube_shadow_face(
      world_position - light.position_and_range.xyz);
    shadow_camera_index = shadow_base + face;
    shadow_layer = i32(shadow_camera_index);
  }
  let light_view_projection =
    scene.light_view_projection[shadow_camera_index];
  let light_clip = light_view_projection * vec4<f32>(world_position, 1.0);
  let light_ndc = light_clip.xyz / light_clip.w;
  if (light_clip.w <= 0.0 ||
      light_ndc.x < -1.0 || light_ndc.x > 1.0 ||
      light_ndc.y < -1.0 || light_ndc.y > 1.0 ||
      light_ndc.z < 0.0 || light_ndc.z > 1.0) {
    return 1.0;
  }
  let uv = vec2<f32>(light_ndc.x * 0.5 + 0.5, 0.5 - light_ndc.y * 0.5);
  let depth = light_ndc.z;
  let shadow_dimensions = textureDimensions(shadow_depth, 0);
  let shadow_size = vec2<f32>(shadow_dimensions);
  let texel_size = 1.0 / shadow_size;
  let light_direction = vkf_safe_normalize(
    light.position_and_range.xyz - world_position);
  let compare_depth = depth - vkf_shadow_receiver_bias(
    world_position,
    surface_normal,
    light_direction,
    light_view_projection,
    texel_size);
  let near_far = scene.shadow_near_far[shadow_camera_index].xy;
  let receiver_view_distance = vkf_shadow_linear_distance(depth, near_far);
  let receiver_distance = length(
    world_position - light.position_and_range.xyz);
  let blocker_ray_scale = receiver_distance /
    max(receiver_view_distance, 1.0e-4);
  let source_radius = max(light.target_and_radius.w, 0.0);
  if (source_radius <= 1.0e-6) {
    return textureSampleCompareLevel(
      shadow_depth, shadow_sampler, uv, shadow_layer, compare_depth);
  }
  let source_direction = vkf_safe_normalize(
    world_position - light.position_and_range.xyz);
  let source_basis_hint = select(
    vec3<f32>(0.0, 0.0, 1.0),
    vec3<f32>(0.0, 1.0, 0.0),
    abs(source_direction.z) > 0.9);
  let source_axis_x = vkf_safe_normalize(cross(
    source_basis_hint, source_direction));
  let source_axis_y = cross(source_direction, source_axis_x);
  let source_center_world = world_position;
  let source_basis_x_world = source_center_world +
    source_axis_x * source_radius;
  let source_basis_y_world = source_center_world +
    source_axis_y * source_radius;
  let source_radius_uv = vkf_shadow_projected_source_radius_uv(
    light_view_projection,
    source_center_world,
    source_basis_x_world,
    source_basis_y_world);
  let texel_radius = max(texel_size.x, texel_size.y);
  let search_radius_uv = clamp(
    source_radius_uv,
    texel_radius, 24.0 * texel_radius);
  let uv_min = texel_size * 0.5;
  let uv_max = vec2<f32>(1.0) - uv_min;
  var blocker_distance_sum = 0.0;
  var blocker_count = 0.0;
  for (var sample_index = 0u;
       sample_index < VKF_SHADOW_BLOCKER_SAMPLE_COUNT;
       sample_index = sample_index + 1u) {
    let sample_offset = VKF_SHADOW_DISK[sample_index * 2u];
    let sample_uv = clamp(
      uv + sample_offset * search_radius_uv, uv_min, uv_max);
    let sample_texel = vec2<i32>(sample_uv * shadow_size);
    let sample_depth = textureLoad(
      shadow_depth, sample_texel, shadow_layer, 0);
    if (sample_depth < compare_depth) {
      blocker_distance_sum = blocker_distance_sum +
        vkf_shadow_linear_distance(sample_depth, near_far) *
        blocker_ray_scale;
      blocker_count = blocker_count + 1.0;
    }
  }
  if (blocker_count < 0.5) {
    return 1.0;
  }
  let average_blocker_distance = blocker_distance_sum / blocker_count;
  let penumbra_ratio = max(
    receiver_distance - average_blocker_distance, 0.0) /
    max(average_blocker_distance, 1.0e-4);
  let filter_radius_uv = clamp(
    source_radius_uv * penumbra_ratio,
    texel_radius, 32.0 * texel_radius);
  var visibility = 0.0;
  for (var sample_index = 0u;
       sample_index < VKF_SHADOW_FILTER_SAMPLE_COUNT;
       sample_index = sample_index + 1u) {
    let sample_offset = VKF_SHADOW_DISK[sample_index];
    let sample_uv = clamp(
      uv + sample_offset * filter_radius_uv, uv_min, uv_max);
    visibility = visibility + textureSampleCompareLevel(
      shadow_depth, shadow_sampler, sample_uv, shadow_layer, compare_depth);
  }
  return visibility / f32(VKF_SHADOW_FILTER_SAMPLE_COUNT);
}

fn vkf_light_aperture_position(
  light: SceneLight,
  vertex_index: u32,
) -> vec3<f32> {
  let base = light.aperture_float_offset +
    vertex_index * light.aperture_vertex_stride_floats;
  let local_position = vec3<f32>(
    aperture_vertices[base],
    aperture_vertices[base + 1u],
    aperture_vertices[base + 2u]
  );
  let model = derived_objects[light.aperture_object_index].value.model;
  return (model * vec4<f32>(local_position, 1.0)).xyz;
}

fn vkf_planar_aperture_coverage(
  world_position: vec3<f32>,
  source_position: vec3<f32>,
  aperture_light: SceneLight,
) -> f32 {
  if (aperture_light.aperture_vertex_count < 3u) {
    return 0.0;
  }
  let aperture_0 = vkf_light_aperture_position(aperture_light, 0u);
  let aperture_1 = vkf_light_aperture_position(aperture_light, 1u);
  let aperture_2 = vkf_light_aperture_position(aperture_light, 2u);
  let plane_normal = vkf_safe_normalize(cross(
    aperture_1 - aperture_0, aperture_2 - aperture_0));
  let light_side = dot(source_position - aperture_0, plane_normal);
  let point_side = dot(world_position - aperture_0, plane_normal);
  let receiver_gap = -sign(light_side) * point_side;
  if (receiver_gap < -1.0e-5) {
    return 0.0;
  }
  let ray = world_position - source_position;
  let denominator = dot(plane_normal, ray);
  if (abs(denominator) <= 1.0e-6) {
    return 0.0;
  }
  let hit_distance = dot(
    plane_normal, aperture_0 - source_position) / denominator;
  if (hit_distance <= 1.0e-5 || hit_distance > 1.0 + 1.0e-5) {
    return 0.0;
  }
  let hit = source_position + ray * hit_distance;
  let light_to_plane = max(abs(light_side), 1.0e-4);
  let softness = max(aperture_light.target_and_radius.w, 0.0) *
    max(receiver_gap, 0.0) / light_to_plane;
  let edge_softness = max(softness, 1.0e-5);
  var positive_coverage = 1.0;
  var negative_coverage = 1.0;
  for (var vertex_index = 0u;
       vertex_index < aperture_light.aperture_vertex_count;
       vertex_index = vertex_index + 1u) {
    let next_index = (vertex_index + 1u) %
      aperture_light.aperture_vertex_count;
    let edge_start = vkf_light_aperture_position(
      aperture_light, vertex_index);
    let edge_end = vkf_light_aperture_position(
      aperture_light, next_index);
    let edge = edge_end - edge_start;
    let signed_distance = dot(
      cross(edge, hit - edge_start), plane_normal) /
      max(length(edge), 1.0e-6);
    positive_coverage = positive_coverage * smoothstep(
      -edge_softness, edge_softness, signed_distance);
    negative_coverage = negative_coverage * smoothstep(
      -edge_softness, edge_softness, -signed_distance);
  }
  return max(positive_coverage, negative_coverage);
}

fn vkf_projected_light_aperture(
  world_position: vec3<f32>,
  light: SceneLight,
  receiver_object_index: u32,
) -> f32 {
  if (u32(light.kind_and_shadow.x) != 2u) {
    return 1.0;
  }
  if (receiver_object_index == light.aperture_object_index) {
    return 0.0;
  }
  return vkf_planar_aperture_coverage(
    world_position, light.position_and_range.xyz, light);
}

)wgsl";
        }
        out << R"wgsl(
fn vkf_planar_reflection(
  world_position: vec3<f32>,
  reflection_camera_index: u32,
) -> vec4<f32> {
  if (reflection_camera_index == 0xffffffffu) {
    return vec4<f32>(0.0);
  }
  let mirror_clip = scene.mirror_view_projection[
    reflection_camera_index] * vec4<f32>(world_position, 1.0);
  if (mirror_clip.w <= 0.0) {
    return vec4<f32>(0.0);
  }
  let mirror_ndc = mirror_clip.xyz / mirror_clip.w;
  if (mirror_ndc.x < -1.0 || mirror_ndc.x > 1.0 ||
      mirror_ndc.y < -1.0 || mirror_ndc.y > 1.0 ||
      mirror_ndc.z < 0.0 || mirror_ndc.z > 1.0) {
    return vec4<f32>(0.0);
  }
  let uv = vec2<f32>(mirror_ndc.x * 0.5 + 0.5, 0.5 - mirror_ndc.y * 0.5);
  return textureSampleLevel(
    planar_reflection_texture, planar_reflection_sampler, uv, 0.0);
}
)wgsl";
        out << R"wgsl(
fn vkf_fresnel_amplitudes(
  cos_theta_i: f32,
  ior: f32,
) -> vec2<f32> {
  if (ior <= 0.0) {
    return vec2<f32>(-1.0, 1.0);
  }
  let c_i = clamp(abs(cos_theta_i), 0.0, 1.0);
  let sin_theta_t_squared = (1.0 - c_i * c_i) / (ior * ior);
  if (sin_theta_t_squared >= 1.0) {
    return vec2<f32>(-1.0, 1.0);
  }
  let c_t = sqrt(max(1.0 - sin_theta_t_squared, 0.0));
  let rs_amplitude = (c_i - ior * c_t) / (c_i + ior * c_t);
  let rp_amplitude = (ior * c_i - c_t) / (ior * c_i + c_t);
  return vec2<f32>(rs_amplitude, rp_amplitude);
}

fn vkf_reflect_stokes(
  cos_theta_i: f32,
  ior: f32,
  reflectivity: f32,
  polarization: vec4<f32>,
) -> vec4<f32> {
  var amplitudes = vkf_fresnel_amplitudes(cos_theta_i, ior);
  if (ior <= 0.0) {
    let amplitude = sqrt(clamp(reflectivity, 0.0, 1.0));
    amplitudes = vec2<f32>(-amplitude, amplitude);
  }
  let rs_amplitude = amplitudes.x;
  let rp_amplitude = amplitudes.y;
  let rs = rs_amplitude * rs_amplitude;
  let rp = rp_amplitude * rp_amplitude;
  let sum = rs + rp;
  let difference = rs - rp;
  return vec4<f32>(
    0.5 * (sum * polarization.x + difference * polarization.y),
    0.5 * (difference * polarization.x + sum * polarization.y),
    rs_amplitude * rp_amplitude * polarization.z,
    rs_amplitude * rp_amplitude * polarization.w
  );
}

fn vkf_shade_authored_material(
  input: SceneVertexOut,
  front_facing: bool,
) -> vec4<f32> {
)wgsl";
        out << R"wgsl(  var material_color = input.color;
)wgsl";
        if (plan.retained_scene.checker_texture) {
            out << R"wgsl(  if (object.texture_kind == 1u) {
    material_color = vkf_checker_color(
      input.local_position, input.local_normal);
  }
)wgsl";
        }
        out << R"wgsl(
  if (object.surface_kind == 2u && !front_facing) {
    let ambient_backface = material_color.rgb * scene.ambient.rgb;
    return vec4<f32>(ambient_backface, material_color.a);
  }
  let geometric_normal = normalize(input.world_normal);
  let n = select(-geometric_normal, geometric_normal, front_facing);
  let view_direction = vkf_safe_normalize(
    input.view_position - input.world_position);
  var diffuse_rgb = vec3<f32>(0.0);
  var specular_rgb = vec3<f32>(0.0);
  for (var light_index: u32 = 0u;
       light_index < VKF_LIGHT_COUNT;
       light_index = light_index + 1u) {
    let light = lights[light_index];
)wgsl";
        if (plan.retained_scene.shadow_map) {
            out << R"wgsl(    var visibility = vkf_projected_light_aperture(
      input.world_position, light, object.object_index);
    if (visibility <= 0.0) {
      continue;
    }
)wgsl";
        } else {
            out << R"wgsl(    var visibility = 1.0;
)wgsl";
        }
        out << R"wgsl(    let to_light =
      light.position_and_range.xyz - input.world_position;
    let sampled_transport = vkf_sample_light_transport(
      input.world_position, light, to_light);
    let l = sampled_transport.xyz;
    let diffuse = max(dot(n, l), 0.0);
    var specular = 0.0;
    if (object.specular_strength > 1.0e-6) {
      let half_direction = vkf_safe_normalize(l + view_direction);
      let shininess = max(2.0 / pow(object.roughness, 4.0) - 2.0, 1.0);
      specular = pow(max(dot(n, half_direction), 0.0), shininess) *
        object.specular_strength;
      let incidence_s_axis = vkf_safe_normalize(
        cross(-l, half_direction));
      let local_stokes = vkf_rotate_stokes_basis(
        light.polarization,
        -l,
        light.polarization_basis.xyz,
        incidence_s_axis
      );
      let reflected_stokes = vkf_reflect_stokes(
        dot(l, half_direction),
        object.ior,
        object.reflectivity,
        local_stokes
      );
      specular *= reflected_stokes.x / max(local_stokes.x, 1.0e-12);
    }
    if (!front_facing && object.no_backface_specular != 0u) {
      specular = 0.0;
    }
    let attenuation = sampled_transport.w;
)wgsl";
        if (plan.retained_scene.shadow_map) {
            out << R"wgsl(    let receiver_light_mask =
      vkf_shadow_receiver_light_mask(object.object_index);
    let receives_light_shadow = light_index < 32u &&
      ((receiver_light_mask >> light_index) & 1u) != 0u;
    if (light.kind_and_shadow.y > 0.5 && receives_light_shadow) {
      visibility = visibility * vkf_shadow_visibility(
        input.world_position, n, light);
    }
)wgsl";
        }
        out << R"wgsl(    let radiance = light.color_and_intensity.rgb *
      attenuation * visibility;
    diffuse_rgb = diffuse_rgb + radiance * diffuse;
    specular_rgb = specular_rgb + radiance * specular;
  }
)wgsl";
        out << R"wgsl(  let shaded = material_color.rgb *
    (scene.ambient.rgb + diffuse_rgb) + specular_rgb;
  return vec4<f32>(shaded, material_color.a);
}

@fragment
fn vkf_terminal_scene_fragment(
  input: SceneVertexOut,
  @builtin(front_facing) front_facing: bool,
) -> @location(0) vec4<f32> {
  return vkf_shade_authored_material(input, front_facing);
}

@fragment
fn vkf_scene_fragment(
  input: SceneVertexOut,
  @builtin(front_facing) front_facing: bool,
) -> @location(0) vec4<f32> {
  let material = vkf_shade_authored_material(input, front_facing);
  var shaded = material.rgb;
  let mirror_front_visible =
    object.surface_kind != 2u || front_facing;
  if (object.reflectivity > 0.0 && mirror_front_visible &&
      object.reflection_depth <= 2u) {
    let reflected = vkf_planar_reflection(
      input.world_position, input.reflection_camera_index);
    let reflection_coverage = object.reflectivity * reflected.a;
    shaded = mix(shaded, reflected.rgb, reflection_coverage);
  }
  return vec4<f32>(shaded, material.a);
}
)wgsl";
        if (plan.retained_scene.light_flares) {
            out << R"wgsl(

struct FlareVertexOut {
  @builtin(position) clip_position: vec4<f32>,
  @location(0) local_position: vec2<f32>,
  @location(1) emitted_radiance: vec3<f32>,
  @location(2) enabled: f32,
  @location(3) source_ratio: f32,
  @location(4) bloom_strength: f32,
  @location(5) compactness: f32,
};

struct EmitterVertexOut {
  @builtin(position) clip_position: vec4<f32>,
  @location(0) emitted_radiance: vec3<f32>,
  @location(1) enabled: f32,
};

const VKF_EMITTER_LATITUDE_SEGMENTS: u32 = 16u;
const VKF_EMITTER_LONGITUDE_SEGMENTS: u32 = 24u;
const VKF_EMITTER_VERTEX_COUNT: u32 =
  VKF_EMITTER_LATITUDE_SEGMENTS * VKF_EMITTER_LONGITUDE_SEGMENTS * 6u;

fn vkf_emitter_sphere_direction(vertex_index: u32) -> vec3<f32> {
  let cell_index = vertex_index / 6u;
  let corner_index = vertex_index % 6u;
  let latitude_index = cell_index / VKF_EMITTER_LONGITUDE_SEGMENTS;
  let longitude_index = cell_index % VKF_EMITTER_LONGITUDE_SEGMENTS;
  let corner_offsets = array<vec2<u32>, 6>(
    vec2<u32>(0u, 0u), vec2<u32>(0u, 1u), vec2<u32>(1u, 0u),
    vec2<u32>(1u, 0u), vec2<u32>(0u, 1u), vec2<u32>(1u, 1u)
  );
  let corner = corner_offsets[corner_index];
  let latitude = f32(latitude_index + corner.x) /
    f32(VKF_EMITTER_LATITUDE_SEGMENTS);
  let longitude = f32(longitude_index + corner.y) /
    f32(VKF_EMITTER_LONGITUDE_SEGMENTS);
  let theta = latitude * 3.141592653589793;
  let phi = longitude * 6.283185307179586;
  return vec3<f32>(
    sin(theta) * cos(phi),
    sin(theta) * sin(phi),
    cos(theta)
  );
}

fn vkf_emitter_geometry_vertex(
  vertex_index: u32,
  light_index: u32,
  view_projection: mat4x4<f32>,
) -> EmitterVertexOut {
  let base = light_index * 28u;
  let source_position = vec3<f32>(
    raw_lights[base], raw_lights[base + 1u], raw_lights[base + 2u]);
  let source_radius = max(raw_lights[base + 12u], 0.002);
  let authored_radius = select(
    max(source_radius, )wgsl"
                << std::max(0.02, plan.retained_scene.light_marker_size)
                << R"wgsl(), source_radius,
    u32(raw_lights[base + 13u]) == 5u);
  let direction = vkf_emitter_sphere_direction(vertex_index);
  let world_position = source_position + direction * authored_radius;
  var out: EmitterVertexOut;
  out.clip_position = view_projection * vec4<f32>(world_position, 1.0);
  var emitted_radiance = vec3<f32>(
    raw_lights[base + 6u], raw_lights[base + 7u], raw_lights[base + 8u]) *
    max(raw_lights[base + 10u], 0.0);
  if (u32(raw_lights[base + 13u]) == 5u) {
    emitted_radiance = emitted_radiance / max(
      3.141592653589793 * authored_radius * authored_radius, 1.0e-8);
  }
  out.emitted_radiance = emitted_radiance;
  let is_physical = select(0.0, 1.0, u32(raw_lights[base + 13u]) != 2u);
  let is_enabled = select(0.0, 1.0, raw_lights[base + 17u] > 0.5);
  out.enabled = is_physical * is_enabled;
  return out;
}

fn vkf_projected_emitter_axes(
  center: vec3<f32>,
  radius: f32,
  viewer_position: vec3<f32>,
  view_projection: mat4x4<f32>,
) -> vec4<f32> {
  let center_clip = view_projection * vec4<f32>(center, 1.0);
  let center_ndc = center_clip.xy / max(abs(center_clip.w), 1.0e-6);
  let view_direction = vkf_safe_normalize(center - viewer_position);
  let reference_up = select(
    vec3<f32>(0.0, 0.0, 1.0),
    vec3<f32>(0.0, 1.0, 0.0),
    abs(view_direction.z) > 0.95
  );
  let tangent_x = vkf_safe_normalize(cross(view_direction, reference_up));
  let tangent_y = vkf_safe_normalize(cross(tangent_x, view_direction));
  let x_clip = view_projection * vec4<f32>(
    center + tangent_x * radius, 1.0);
  let y_clip = view_projection * vec4<f32>(
    center + tangent_y * radius, 1.0);
  let x_axis = x_clip.xy / max(abs(x_clip.w), 1.0e-6) - center_ndc;
  let y_axis = y_clip.xy / max(abs(y_clip.w), 1.0e-6) - center_ndc;
  return vec4<f32>(x_axis, y_axis);
}

fn vkf_flare_frustum_visibility(
  source_clip: vec4<f32>,
  flare_extent_ndc: f32,
) -> f32 {
  let near_visibility = smoothstep(1.0e-3, 5.0e-2, source_clip.w);
  if (near_visibility <= 0.0) {
    return 0.0;
  }
  let source_ndc = source_clip.xy / source_clip.w;
  let viewport_distance = max(abs(source_ndc.x), abs(source_ndc.y)) - 1.0;
  let viewport_visibility = 1.0 - smoothstep(
    0.0, max(flare_extent_ndc, 1.0e-3), viewport_distance);
  return near_visibility * viewport_visibility;
}

fn vkf_flare_billboard_vertex(
  vertex_index: u32,
  light_index: u32,
  viewer_position: vec3<f32>,
  view_projection: mat4x4<f32>,
) -> FlareVertexOut {
  let corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>(-1.0, 1.0),
    vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0)
  );
  let base = light_index * 28u;
  let source_position = vec3<f32>(
    raw_lights[base], raw_lights[base + 1u], raw_lights[base + 2u]);
  let source_clip = view_projection * vec4<f32>(source_position, 1.0);
  let source_ndc = source_clip.xy / max(source_clip.w, 1.0e-3);
  let source_radius = max(raw_lights[base + 12u], 0.002);
  let authored_radius = select(
    max(source_radius, )wgsl"
                << std::max(0.02, plan.retained_scene.light_marker_size)
                << R"wgsl(), source_radius,
    u32(raw_lights[base + 13u]) == 5u);
  var projected_axes = vkf_projected_emitter_axes(
    source_position, authored_radius, viewer_position, view_projection);
  let half_viewport = vec2<f32>(viewport.width, viewport.height) * 0.5;
  let raw_source_radius_px = max(
    length(projected_axes.xy * half_viewport),
    length(projected_axes.zw * half_viewport)
  );
  let source_radius_px = clamp(raw_source_radius_px, 1.0, 96.0);
  projected_axes = projected_axes *
    (source_radius_px / max(raw_source_radius_px, 1.0e-6));
  var emitted_radiance = vec3<f32>(
    raw_lights[base + 6u], raw_lights[base + 7u], raw_lights[base + 8u]) *
    max(raw_lights[base + 10u], 0.0);
  if (u32(raw_lights[base + 13u]) == 5u) {
    emitted_radiance = emitted_radiance / max(
      3.141592653589793 * authored_radius * authored_radius, 1.0e-8);
  }
  let peak_radiance = max(
    emitted_radiance.r, max(emitted_radiance.g, emitted_radiance.b));
  let threshold = 1.0;
  let knee = 0.5;
  var soft = clamp(peak_radiance - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / max(4.0 * knee, 1.0e-6);
  let bright = max(peak_radiance - threshold, soft);
  let bloom_strength = clamp(bright / 32.0, 0.0, 1.0);
  let compactness = clamp(8.0 / (source_radius_px + 8.0), 0.0, 1.0);
  let halo_radius_px = bloom_strength * (28.0 + 58.0 * compactness);
  let flare_radius_px = max(source_radius_px, source_radius_px + halo_radius_px);
  let flare_scale = flare_radius_px / max(source_radius_px, 1.0);
  let flare_extent_ndc = max(
    length(projected_axes.xy), length(projected_axes.zw)) * flare_scale;
  let frustum_visibility = vkf_flare_frustum_visibility(
    source_clip, flare_extent_ndc);
  let corner = corners[vertex_index];
  let clip_xy = source_ndc + (
    corner.x * projected_axes.xy +
    corner.y * projected_axes.zw
  ) * flare_scale;
  var out: FlareVertexOut;
  out.clip_position = select(
    vec4<f32>(2.0, 2.0, 0.0, 1.0),
    vec4<f32>(clip_xy * source_clip.w, source_clip.z, source_clip.w),
    frustum_visibility > 0.0);
  out.local_position = corner;
  out.emitted_radiance = emitted_radiance;
  let is_physical = select(0.0, 1.0, u32(raw_lights[base + 13u]) != 2u);
  let is_enabled = select(0.0, 1.0, raw_lights[base + 17u] > 0.5);
  out.enabled = is_physical * is_enabled * frustum_visibility;
  out.source_ratio = source_radius_px / max(flare_radius_px, 1.0);
  out.bloom_strength = bloom_strength;
  out.compactness = compactness;
  return out;
}

@vertex
fn vkf_emitter_vertex(
  @builtin(vertex_index) vertex_index: u32,
  @builtin(instance_index) light_index: u32,
) -> EmitterVertexOut {
  return vkf_emitter_geometry_vertex(
    vertex_index, light_index, scene.view_projection);
}

@vertex
fn vkf_reflection_emitter_vertex(
  @builtin(vertex_index) vertex_index: u32,
  @builtin(instance_index) light_index: u32,
) -> EmitterVertexOut {
  return vkf_emitter_geometry_vertex(
    vertex_index, light_index,
    scene.mirror_view_projection[pass_state.camera_state_index]);
}

@vertex
fn vkf_flare_vertex(
  @builtin(vertex_index) vertex_index: u32,
  @builtin(instance_index) light_index: u32,
) -> FlareVertexOut {
  return vkf_flare_billboard_vertex(
    vertex_index, light_index, scene.view_position.xyz,
    scene.view_projection);
}

@vertex
fn vkf_reflection_flare_vertex(
  @builtin(vertex_index) vertex_index: u32,
  @builtin(instance_index) light_index: u32,
) -> FlareVertexOut {
  return vkf_flare_billboard_vertex(
    vertex_index,
    light_index,
    scene.mirror_view_position[pass_state.camera_state_index].xyz,
    scene.mirror_view_projection[pass_state.camera_state_index]);
}

@fragment
fn vkf_emitter_fragment(input: EmitterVertexOut) -> @location(0) vec4<f32> {
  if (input.enabled <= 0.0) {
    discard;
  }
  let mapped_radiance = input.emitted_radiance /
    (vec3<f32>(1.0) + input.emitted_radiance);
  return vec4<f32>(mapped_radiance, 1.0);
}

@fragment
fn vkf_flare_fragment(input: FlareVertexOut) -> @location(0) vec4<f32> {
  let radius = length(input.local_position);
  if (radius > 1.0 || input.enabled <= 0.0) {
    discard;
  }
  let core_edge = max(input.source_ratio, 1.0e-3);
  let halo_distance = clamp(
    (radius - core_edge) / max(1.0 - core_edge, 1.0e-3), 0.0, 1.0);
  let halo = pow(1.0 - halo_distance, 2.0) *
    input.bloom_strength * 0.75;
  let cross_ray = pow(max(1.0 - min(
    abs(input.local_position.x), abs(input.local_position.y)), 0.0), 18.0) *
    (1.0 - smoothstep(core_edge, 1.0, radius)) *
    input.bloom_strength * input.compactness * 0.16;
  let bloom_color = vkf_safe_normalize(max(
    input.emitted_radiance, vec3<f32>(1.0e-6)));
  let alpha = clamp(halo + cross_ray, 0.0, 1.0);
  let color = bloom_color * (halo * 1.35 + cross_ray);
  return vec4<f32>(color, alpha);
}
)wgsl";
        }
        return out.str();
    }
    if (plan.dom_only) {
        return R"wgsl(// Generated DOM-only UI shader contract
@compute @workgroup_size(1)
fn vkf_dom_only() {}
)wgsl";
    }
    std::ostringstream out;
    const std::string axis_scalar_type = plan.update.axis_float_mode ? "f32" : "i32";
    const std::string scalar_type = plan.update.scalar_float_mode ? "f32" : "i32";
    out << "// Generated by vkf_webgpu_artifact_smoke\n";
    if (plan.update.axis_vector_mode) {
        out << "struct State {\n  values: array<" << axis_scalar_type << ", " << plan.update.axis_vector_length << ">,\n};\n";
        if (plan.update.axis_input_vector) {
            out << "struct Input {\n  values: array<" << axis_scalar_type << ", " << plan.update.axis_vector_length << ">,\n};\n";
        } else {
            out << "struct Input {\n  value: " << axis_scalar_type << ",\n};\n";
        }
    } else if (plan.update.record_mode) {
        out << "struct State {\n";
        for (const auto& field_desc : plan.update.state_fields) {
            out << "  " << field_desc.name << ": " << field_wgsl_type(field_desc) << ",\n";
        }
        out << "};\n";
        out << "struct Input {\n";
        for (const auto& field_desc : plan.update.input_fields) {
            out << "  " << field_desc.name << ": " << field_wgsl_type(field_desc) << ",\n";
        }
        out << "};\n";
    } else {
        out << "struct State {\n  value: " << scalar_type << ",\n};\n";
        out << "struct Input {\n  value: " << scalar_type << ",\n};\n";
    }
    out << "@group(0) @binding(0) var<storage, read_write> state: State;\n";
    out << "@group(0) @binding(1) var<storage, read> input: Input;\n";
    for (const auto& binding : plan.bindings) {
        if (binding.kind == Binding::Kind::I32) {
            out << "const " << binding.name << ": i32 = " << binding.i32_value << ";\n";
        } else if (binding.kind == Binding::Kind::I32Array) {
            out << "const " << binding.name << ": array<i32, " << binding.i32_array_values.size() << "> = array<i32, " << binding.i32_array_values.size() << ">(";
            for (std::size_t i = 0; i < binding.i32_array_values.size(); ++i) {
                if (i > 0) {
                    out << ", ";
                }
                out << binding.i32_array_values[i];
            }
            out << ");\n";
        } else if (binding.kind == Binding::Kind::F64) {
            out << "const " << binding.name << ": f32 = " << static_cast<float>(binding.f64_value) << ";\n";
        } else if (binding.kind == Binding::Kind::F64Array) {
            out << "const " << binding.name << ": array<f32, " << binding.f64_array_values.size() << "> = array<f32, " << binding.f64_array_values.size() << ">(";
            for (std::size_t i = 0; i < binding.f64_array_values.size(); ++i) {
                if (i > 0) {
                    out << ", ";
                }
                out << static_cast<float>(binding.f64_array_values[i]);
            }
            out << ");\n";
        }
    }
    out << "@compute @workgroup_size(1)\n";
    out << "fn vkf_update() {\n";
    if (plan.update.axis_vector_mode) {
        for (std::size_t i = 0; i < plan.update.axis_vector_length; ++i) {
            out << "  let next_value_" << i << ": " << axis_scalar_type << " = "
                << emit_expr(plan.update.scalar_expr, plan, "state", "input", std::to_string(i)) << ";\n";
        }
        for (std::size_t i = 0; i < plan.update.axis_vector_length; ++i) {
            out << "  state.values[" << i << "] = next_value_" << i << ";\n";
        }
    } else if (plan.update.record_mode) {
        for (const auto& field_expr : plan.update.record_fields) {
            const FieldDesc* target_field = find_field_desc(plan.update.state_fields, field_expr.first);
            if (target_field == nullptr) {
                throw WebGpuArtifactFailure("unknown record result field " + field_expr.first);
            }
            if (target_field->axis_length > 0) {
                for (std::size_t i = 0; i < target_field->axis_length; ++i) {
                    out << "  let next_" << field_expr.first << "_" << i << ": " << field_wgsl_scalar_type(*target_field) << " = "
                        << emit_expr(field_expr.second, plan, "state", "input", std::to_string(i), is_float_field(*target_field)) << ";\n";
                }
            } else {
                out << "  let next_" << field_expr.first << ": " << field_wgsl_scalar_type(*target_field) << " = "
                    << emit_expr(field_expr.second, plan, "state", "input", "", is_float_field(*target_field)) << ";\n";
            }
        }
        for (const auto& field_expr : plan.update.record_fields) {
            const FieldDesc* target_field = find_field_desc(plan.update.state_fields, field_expr.first);
            if (target_field == nullptr) {
                throw WebGpuArtifactFailure("unknown record result field " + field_expr.first);
            }
            if (target_field->axis_length > 0) {
                for (std::size_t i = 0; i < target_field->axis_length; ++i) {
                    out << "  state." << field_expr.first << "[" << i << "] = next_" << field_expr.first << "_" << i << ";\n";
                }
            } else {
                out << "  state." << field_expr.first << " = next_" << field_expr.first << ";\n";
            }
        }
    } else {
        out << "  let next_value: " << scalar_type << " = " << emit_expr(plan.update.scalar_expr, plan, "state", "input") << ";\n";
        out << "  state.value = next_value;\n";
    }
    out << "}\n";
    return out.str();
}

vf::JsonValue::Object manifest_payload(
    const std::filesystem::path& source,
    const std::string& source_hash,
    const std::string& typed_ir_hash,
    const std::string& artifact_hash,
    const std::vector<Dependency>& dependencies,
    const std::filesystem::path& artifact_path,
    const std::string& status,
    const ModulePlan& plan
) {
    vf::JsonValue::Object manifest;
    manifest["artifact_kind"] = vf::JsonValue("webgpu-wgsl");
    manifest["artifact_path"] = vf::JsonValue(artifact_path.string());
    manifest["compiler_version"] = vf::JsonValue(compiler_version);
    manifest["source_path"] = vf::JsonValue(std::filesystem::absolute(source).string());
    manifest["source_sha256"] = vf::JsonValue(source_hash);
    manifest["status"] = vf::JsonValue(status);
    manifest["typed_ir_sha256"] = vf::JsonValue(typed_ir_hash);
    manifest["artifact_content_sha256"] = vf::JsonValue(artifact_hash);
    manifest["runtime_hash"] = vf::JsonValue(artifact_hash);
    manifest["shader_entry"] = vf::JsonValue(
        plan.retained_scene_render
            ? "vkf_scene_fragment"
            : (plan.dom_only ? "vkf_dom_only" : "vkf_update"));
    if (plan.retained_scene_render) {
        manifest["vertex_entry"] = vf::JsonValue("vkf_scene_vertex");
        manifest["fragment_entry"] = vf::JsonValue("vkf_scene_fragment");
    } else {
        manifest["workgroup_size"] = vf::JsonValue(1.0);
    }
    vf::JsonValue::Array deps;
    for (const auto& dependency : dependencies) {
        vf::JsonValue::Object dep;
        dep["name"] = vf::JsonValue(dependency.name);
        dep["path"] = vf::JsonValue(std::filesystem::absolute(dependency.path).string());
        dep["sha256"] = vf::JsonValue(dependency.hash);
        deps.push_back(vf::JsonValue(std::move(dep)));
    }
    manifest["dependencies"] = vf::JsonValue(std::move(deps));
    vf::JsonValue::Object runtime_surface;
    if (plan.retained_scene_render) {
        const auto reflection_paths =
            vkf::native_scene::planar_reflection_paths(
                plan.retained_scene.reflective_surfaces.size(),
                plan.retained_scene.max_reflection_depth);
        runtime_surface["update_mode"] = vf::JsonValue("retained_scene_render");
        runtime_surface["camera_binding"] = vf::JsonValue(0.0);
        runtime_surface["vertex_entry"] = vf::JsonValue("vkf_scene_vertex");
        runtime_surface["fragment_entry"] = vf::JsonValue("vkf_scene_fragment");
        vf::JsonValue::Object render_plan;
        render_plan["schema"] = vf::JsonValue(
            "vektor-flow/retained-scene-render-plan");
        render_plan["version"] = vf::JsonValue(1.0);
        render_plan["execution_owner"] = vf::JsonValue("wasm_wgsl");
        if (!plan.retained_scene.mount_target_id.empty()) {
            render_plan["mount_target_id"] = vf::JsonValue(
                plan.retained_scene.mount_target_id);
        }
        render_plan["max_reflection_depth"] = vf::JsonValue(
            static_cast<double>(plan.retained_scene.max_reflection_depth));
        render_plan["light_count"] = vf::JsonValue(
            static_cast<double>(plan.retained_scene.lights.size()));
        vf::JsonValue::Array emitter_sources;
        for (const auto& light : plan.retained_scene.lights) {
            if (light.derived_emitter_view) continue;
            if (!light.source_object_index.has_value() ||
                !light.source_layer_id.has_value()) {
                continue;
            }
            emitter_sources.push_back(vf::JsonValue(vf::JsonValue::Object{
                {"id", vf::JsonValue(light.id)},
                {"layer_id", vf::JsonValue(static_cast<double>(
                    *light.source_layer_id))},
                {"object_index", vf::JsonValue(static_cast<double>(
                    *light.source_object_index))},
                {"kind_code", vf::JsonValue(static_cast<double>(
                    light.kind_code))},
                {"area", vf::JsonValue(light.source_area)},
                {"source_radius", vf::JsonValue(light.source_radius)},
                {"area_sample_count", vf::JsonValue(static_cast<double>(
                    light.area_sample_count))},
                {"casts_shadow", vf::JsonValue(light.casts_shadow)},
                {"shadow_view_count", vf::JsonValue(static_cast<double>(
                    light.shadow_view_count))},
            }));
        }
        render_plan["emitter_sources"] = vf::JsonValue(
            std::move(emitter_sources));
        vf::JsonValue::Array emitter_views;
        for (const auto& light : plan.retained_scene.lights) {
            if (!light.derived_emitter_view ||
                !light.source_object_index.has_value() ||
                !light.source_layer_id.has_value() ||
                !light.source_light_index.has_value() ||
                !light.reflect_surface_object_index.has_value()) {
                continue;
            }
            vf::JsonValue::Array reflection_path;
            for (const auto& surface_id : light.reflection_path) {
                reflection_path.push_back(vf::JsonValue(surface_id));
            }
            emitter_views.push_back(vf::JsonValue(vf::JsonValue::Object{
                {"id", vf::JsonValue(light.id)},
                {"light_index", vf::JsonValue(static_cast<double>(
                    light.light_index))},
                {"source_id", vf::JsonValue(light.source_id)},
                {"source_light_index", vf::JsonValue(static_cast<double>(
                    *light.source_light_index))},
                {"source_object_index", vf::JsonValue(static_cast<double>(
                    *light.source_object_index))},
                {"source_layer_id", vf::JsonValue(static_cast<double>(
                    *light.source_layer_id))},
                {"reflect_surface_id", vf::JsonValue(
                    light.reflect_surface_id)},
                {"reflect_surface_object_index", vf::JsonValue(
                    static_cast<double>(
                        *light.reflect_surface_object_index))},
                {"reflection_depth", vf::JsonValue(static_cast<double>(
                    light.reflection_depth))},
                {"reflection_path", vf::JsonValue(
                    std::move(reflection_path))},
                {"kind_code", vf::JsonValue(static_cast<double>(
                    light.kind_code))},
                {"casts_shadow", vf::JsonValue(light.casts_shadow)},
                {"shadow_view_count", vf::JsonValue(static_cast<double>(
                    light.shadow_view_count))},
            }));
        }
        render_plan["emitter_views"] = vf::JsonValue(
            std::move(emitter_views));
        const std::uint32_t derived_shadow_count = std::max<std::uint32_t>(
            1u, static_cast<std::uint32_t>(
                retained_shadow_view_count(plan.retained_scene)));
        const std::uint32_t derived_reflection_count =
            std::max<std::uint32_t>(1u,
                static_cast<std::uint32_t>(reflection_paths.size()));
        const std::uint32_t derived_scene_byte_size = 96u +
            64u * (derived_shadow_count + derived_reflection_count) +
            32u * derived_reflection_count +
            16u * derived_shadow_count;
        vf::JsonValue::Array reflective_surfaces;
        for (const auto& surface : plan.retained_scene.reflective_surfaces) {
            reflective_surfaces.push_back(vf::JsonValue(vf::JsonValue::Object{
                {"id", vf::JsonValue(surface.id)},
                {"object_index", vf::JsonValue(
                    static_cast<double>(surface.object_index))},
            }));
        }
        render_plan["reflective_surfaces"] = vf::JsonValue(
            std::move(reflective_surfaces));
        render_plan["arena"] = vf::JsonValue(vf::JsonValue::Object{
            {"metadata_source", vf::JsonValue("wasm_retained_scene_arena")},
            {"vertex_storage", vf::JsonValue("float32")},
            {"index_storage", vf::JsonValue("uint32")},
        });

        vf::JsonValue::Array attributes;
        for (const auto& attribute : {
                 std::tuple<double, double, const char*>{0.0, 0.0, "float32x3"},
                 std::tuple<double, double, const char*>{1.0, 12.0, "float32x3"},
                 std::tuple<double, double, const char*>{2.0, 24.0, "float32x4"}}) {
            attributes.push_back(vf::JsonValue(vf::JsonValue::Object{
                {"shader_location", vf::JsonValue(std::get<0>(attribute))},
                {"offset", vf::JsonValue(std::get<1>(attribute))},
                {"format", vf::JsonValue(std::get<2>(attribute))},
            }));
        }
        render_plan["vertex_layout"] = vf::JsonValue(vf::JsonValue::Object{
            {"array_stride", vf::JsonValue(40.0)},
            {"step_mode", vf::JsonValue("vertex")},
            {"attributes", vf::JsonValue(std::move(attributes))},
        });

        vf::JsonValue::Array bindings;
        const auto add_binding = [&](double group, double binding,
                                     const std::string& resource,
                                     const std::string& kind,
                                     bool dynamic_offset = false) {
            bindings.push_back(vf::JsonValue(vf::JsonValue::Object{
                {"group", vf::JsonValue(group)},
                {"binding", vf::JsonValue(binding)},
                {"resource", vf::JsonValue(resource)},
                {"kind", vf::JsonValue(kind)},
                {"dynamic_offset", vf::JsonValue(dynamic_offset)},
            }));
        };
        add_binding(0.0, 0.0, "derived_scene", "uniform_buffer");
        add_binding(0.0, 1.0, "derived_lights", "read_only_storage_buffer");
        if (plan.retained_scene.shadow_map) {
            add_binding(0.0, 2.0, "shadow_depth", "depth_texture_array");
            add_binding(0.0, 3.0, "shadow_comparison_sampler",
                "comparison_sampler");
        }
        add_binding(0.0, 4.0, "pass.reflection_sources_by_object",
            "sampled_texture_2d");
        add_binding(0.0, 5.0, "planar_reflection_sampler",
            "filtering_sampler");
        add_binding(0.0, 6.0, "pass_state_arena", "uniform_buffer");
        add_binding(1.0, 0.0, "derived_objects", "uniform_buffer", false);
        add_binding(2.0, 1.0, "render_parameter_arena.lights",
            "read_only_storage_buffer");
        add_binding(2.0, 2.0, "render_parameter_arena.objects",
            "read_only_storage_buffer");
        add_binding(2.0, 3.0, "retained_scene_arena",
            "read_only_storage_buffer");
        render_plan["bindings"] = vf::JsonValue(std::move(bindings));
        render_plan["samplers"] = vf::JsonValue(vf::JsonValue::Array{
            vf::JsonValue(vf::JsonValue::Object{
                {"id", vf::JsonValue("shadow_comparison_sampler")},
                {"kind", vf::JsonValue("comparison")},
                {"compare", vf::JsonValue("less")},
                {"mag_filter", vf::JsonValue("linear")},
                {"min_filter", vf::JsonValue("linear")},
                {"mipmap_filter", vf::JsonValue("nearest")},
                {"address_mode_u", vf::JsonValue("clamp-to-edge")},
                {"address_mode_v", vf::JsonValue("clamp-to-edge")},
                {"address_mode_w", vf::JsonValue("clamp-to-edge")},
            }),
            vf::JsonValue(vf::JsonValue::Object{
                {"id", vf::JsonValue("planar_reflection_sampler")},
                {"kind", vf::JsonValue("filtering")},
                {"mag_filter", vf::JsonValue("linear")},
                {"min_filter", vf::JsonValue("linear")},
                {"mipmap_filter", vf::JsonValue("nearest")},
                {"address_mode_u", vf::JsonValue("clamp-to-edge")},
                {"address_mode_v", vf::JsonValue("clamp-to-edge")},
                {"address_mode_w", vf::JsonValue("clamp-to-edge")},
            }),
        });

        vf::JsonValue::Array pipelines;
        pipelines.push_back(vf::JsonValue(vf::JsonValue::Object{
            {"id", vf::JsonValue("prepare_frame")},
            {"compute_entry", vf::JsonValue("vkf_prepare_frame")},
            {"workgroup_size", vf::JsonValue(vf::JsonValue::Array{
                vf::JsonValue(64.0), vf::JsonValue(1.0),
                vf::JsonValue(1.0)})},
        }));
        pipelines.push_back(vf::JsonValue(vf::JsonValue::Object{
            {"id", vf::JsonValue("prepare_shadow_views")},
            {"compute_entry", vf::JsonValue("vkf_refit_shadow_views")},
            {"workgroup_size", vf::JsonValue(vf::JsonValue::Array{
                vf::JsonValue(1.0), vf::JsonValue(1.0),
                vf::JsonValue(1.0)})},
        }));
        pipelines.push_back(vf::JsonValue(vf::JsonValue::Object{
            {"id", vf::JsonValue("prepare_reflection_camera")},
            {"compute_entry", vf::JsonValue(
                "vkf_prepare_reflection_camera")},
            {"workgroup_size", vf::JsonValue(vf::JsonValue::Array{
                vf::JsonValue(1.0), vf::JsonValue(1.0),
                vf::JsonValue(1.0)})},
        }));
        if (plan.retained_scene.shadow_map) {
            pipelines.push_back(vf::JsonValue(vf::JsonValue::Object{
                {"id", vf::JsonValue("shadow_depth")},
                {"vertex_entry", vf::JsonValue("vkf_shadow_vertex")},
                {"fragment_entry", vf::JsonValue(nullptr)},
                {"depth_write", vf::JsonValue(true)},
                {"color_target", vf::JsonValue(false)},
                {"depth_format", vf::JsonValue("depth32float")},
                {"depth_compare", vf::JsonValue("less")},
                {"depth_bias", vf::JsonValue(0.0)},
                {"depth_bias_clamp", vf::JsonValue(0.0)},
                {"depth_bias_slope_scale", vf::JsonValue(0.0)},
                {"cull_mode", vf::JsonValue("none")},
            }));
        }
        pipelines.push_back(vf::JsonValue(vf::JsonValue::Object{
            {"id", vf::JsonValue("retained_scene_hdr")},
            {"vertex_entry", vf::JsonValue("vkf_reflection_vertex")},
            {"fragment_entry", vf::JsonValue("vkf_scene_fragment")},
            {"depth_write", vf::JsonValue(true)},
            {"color_target", vf::JsonValue(true)},
            {"color_format", vf::JsonValue("rgba16float")},
            {"sample_count", vf::JsonValue(1.0)},
            {"depth_format", vf::JsonValue("depth32float")},
            {"depth_compare", vf::JsonValue("less")},
            {"cull_mode", vf::JsonValue("none")},
        }));
        pipelines.push_back(vf::JsonValue(vf::JsonValue::Object{
            {"id", vf::JsonValue("retained_scene_terminal_hdr")},
            {"vertex_entry", vf::JsonValue("vkf_reflection_vertex")},
            {"fragment_entry", vf::JsonValue(
                "vkf_terminal_scene_fragment")},
            {"depth_write", vf::JsonValue(true)},
            {"color_target", vf::JsonValue(true)},
            {"color_format", vf::JsonValue("rgba16float")},
            {"sample_count", vf::JsonValue(1.0)},
            {"depth_format", vf::JsonValue("depth32float")},
            {"depth_compare", vf::JsonValue("less")},
            {"cull_mode", vf::JsonValue("none")},
        }));
        pipelines.push_back(vf::JsonValue(vf::JsonValue::Object{
            {"id", vf::JsonValue("retained_scene_hdr_msaa")},
            {"vertex_entry", vf::JsonValue("vkf_scene_vertex")},
            {"fragment_entry", vf::JsonValue("vkf_scene_fragment")},
            {"depth_write", vf::JsonValue(true)},
            {"color_target", vf::JsonValue(true)},
            {"color_format", vf::JsonValue("rgba16float")},
            {"sample_count", vf::JsonValue(4.0)},
            {"depth_format", vf::JsonValue("depth32float")},
            {"depth_compare", vf::JsonValue("less")},
            {"cull_mode", vf::JsonValue("none")},
        }));
        pipelines.push_back(vf::JsonValue(vf::JsonValue::Object{
            {"id", vf::JsonValue("retained_scene_terminal_hdr_msaa")},
            {"vertex_entry", vf::JsonValue("vkf_scene_vertex")},
            {"fragment_entry", vf::JsonValue(
                "vkf_terminal_scene_fragment")},
            {"depth_write", vf::JsonValue(true)},
            {"color_target", vf::JsonValue(true)},
            {"color_format", vf::JsonValue("rgba16float")},
            {"sample_count", vf::JsonValue(4.0)},
            {"depth_format", vf::JsonValue("depth32float")},
            {"depth_compare", vf::JsonValue("less")},
            {"cull_mode", vf::JsonValue("none")},
        }));
        pipelines.push_back(vf::JsonValue(vf::JsonValue::Object{
            {"id", vf::JsonValue("retained_scene_present")},
            {"vertex_entry", vf::JsonValue("vkf_present_vertex")},
            {"fragment_entry", vf::JsonValue("vkf_present_fragment")},
            {"vertex_buffers", vf::JsonValue(false)},
            {"color_target", vf::JsonValue(true)},
            {"color_format", vf::JsonValue("preferred_canvas_format")},
            {"sample_count", vf::JsonValue(1.0)},
            {"cull_mode", vf::JsonValue("none")},
        }));
        if (plan.retained_scene.light_flares) {
            pipelines.push_back(vf::JsonValue(vf::JsonValue::Object{
                {"id", vf::JsonValue("reflection_emitters")},
                {"vertex_entry", vf::JsonValue(
                    "vkf_reflection_emitter_vertex")},
                {"fragment_entry", vf::JsonValue("vkf_emitter_fragment")},
                {"vertex_buffers", vf::JsonValue(false)},
                {"color_target", vf::JsonValue(true)},
                {"color_format", vf::JsonValue("rgba16float")},
                {"sample_count", vf::JsonValue(1.0)},
                {"depth_write", vf::JsonValue(true)},
                {"depth_format", vf::JsonValue("depth32float")},
                {"depth_compare", vf::JsonValue("less")},
                {"cull_mode", vf::JsonValue("none")},
            }));
            pipelines.push_back(vf::JsonValue(vf::JsonValue::Object{
                {"id", vf::JsonValue("reflection_flares")},
                {"vertex_entry", vf::JsonValue(
                    "vkf_reflection_flare_vertex")},
                {"fragment_entry", vf::JsonValue("vkf_flare_fragment")},
                {"vertex_buffers", vf::JsonValue(false)},
                {"color_target", vf::JsonValue(true)},
                {"color_format", vf::JsonValue("rgba16float")},
                {"sample_count", vf::JsonValue(1.0)},
                {"blend", vf::JsonValue("additive")},
                {"depth_write", vf::JsonValue(false)},
                {"depth_format", vf::JsonValue("depth32float")},
                {"depth_compare", vf::JsonValue("less-equal")},
                {"cull_mode", vf::JsonValue("none")},
            }));
            pipelines.push_back(vf::JsonValue(vf::JsonValue::Object{
                {"id", vf::JsonValue("light_emitters")},
                {"vertex_entry", vf::JsonValue("vkf_emitter_vertex")},
                {"fragment_entry", vf::JsonValue("vkf_emitter_fragment")},
                {"vertex_buffers", vf::JsonValue(false)},
                {"color_target", vf::JsonValue(true)},
                {"color_format", vf::JsonValue("rgba16float")},
                {"sample_count", vf::JsonValue(4.0)},
                {"depth_write", vf::JsonValue(true)},
                {"depth_format", vf::JsonValue("depth32float")},
                {"depth_compare", vf::JsonValue("less")},
                {"cull_mode", vf::JsonValue("none")},
            }));
            pipelines.push_back(vf::JsonValue(vf::JsonValue::Object{
                {"id", vf::JsonValue("light_flares")},
                {"vertex_entry", vf::JsonValue("vkf_flare_vertex")},
                {"fragment_entry", vf::JsonValue("vkf_flare_fragment")},
                {"vertex_buffers", vf::JsonValue(false)},
                {"color_target", vf::JsonValue(true)},
                {"color_format", vf::JsonValue("rgba16float")},
                {"sample_count", vf::JsonValue(4.0)},
                {"blend", vf::JsonValue("additive")},
                {"depth_write", vf::JsonValue(false)},
                {"depth_format", vf::JsonValue("depth32float")},
                {"depth_compare", vf::JsonValue("less-equal")},
                {"cull_mode", vf::JsonValue("none")},
            }));
        }
        render_plan["pipelines"] = vf::JsonValue(std::move(pipelines));
        render_plan["derived_buffers"] = vf::JsonValue(
            vf::JsonValue::Array{
                vf::JsonValue(vf::JsonValue::Object{
                    {"id", vf::JsonValue("derived_scene")},
                    {"kind", vf::JsonValue("storage_uniform")},
                    {"size_policy", vf::JsonValue(
                        "scene_camera_layout")},
                    {"byte_size", vf::JsonValue(static_cast<double>(
                        derived_scene_byte_size))},
                    {"usage", vf::JsonValue(vf::JsonValue::Array{
                        vf::JsonValue("storage"),
                        vf::JsonValue("uniform")})},
                }),
                vf::JsonValue(vf::JsonValue::Object{
                    {"id", vf::JsonValue("derived_lights")},
                    {"kind", vf::JsonValue("storage")},
                    {"size_policy", vf::JsonValue("light_count")},
                    {"stride", vf::JsonValue(112.0)},
                    {"byte_size", vf::JsonValue(static_cast<double>(
                        std::max<std::uint32_t>(1u,
                            static_cast<std::uint32_t>(
                                plan.retained_scene.lights.size())) * 112u))},
                    {"usage", vf::JsonValue(vf::JsonValue::Array{
                        vf::JsonValue("storage")})},
                }),
                vf::JsonValue(vf::JsonValue::Object{
                    {"id", vf::JsonValue("derived_objects")},
                    {"kind", vf::JsonValue("storage_uniform")},
                    {"size_policy", vf::JsonValue("object_count")},
                    {"stride", vf::JsonValue(256.0)},
                    {"byte_size", vf::JsonValue(static_cast<double>(
                        std::max<std::uint32_t>(1u,
                            plan.retained_scene.object_count) * 256u))},
                    {"usage", vf::JsonValue(vf::JsonValue::Array{
                        vf::JsonValue("storage"),
                        vf::JsonValue("uniform")})},
                }),
            });
        render_plan["control_buffers"] = vf::JsonValue(
            vf::JsonValue::Array{
                vf::JsonValue(vf::JsonValue::Object{
                    {"id", vf::JsonValue("pass_state_arena")},
                    {"byte_size", vf::JsonValue(static_cast<double>(
                        (2u * static_cast<std::uint32_t>(
                            plan.retained_scene.reflective_surfaces.size()) *
                            plan.retained_scene.max_reflection_depth +
                        static_cast<std::uint32_t>(
                            retained_shadow_view_count(plan.retained_scene)) +
                            1u) * 256u))},
                    {"record_stride", vf::JsonValue(256.0)},
                    {"record_byte_length", vf::JsonValue(32.0)},
                    {"usage", vf::JsonValue(vf::JsonValue::Array{
                        vf::JsonValue("uniform"),
                        vf::JsonValue("copy_dst")})},
                    {"fields", vf::JsonValue(vf::JsonValue::Array{
                        vf::JsonValue("camera_state_index:u32@0"),
                        vf::JsonValue("reflection_depth:u32@4"),
                        vf::JsonValue("light_index:u32@8"),
                        vf::JsonValue("target_layer:u32@12"),
                        vf::JsonValue("object_index:u32@16"),
                        vf::JsonValue("aperture_float_offset:u32@20"),
                        vf::JsonValue("aperture_vertex_count:u32@24"),
                        vf::JsonValue(
                            "aperture_vertex_stride_floats:u32@28")})},
                }),
                vf::JsonValue(vf::JsonValue::Object{
                    {"id", vf::JsonValue("platform_viewport")},
                    {"byte_size", vf::JsonValue(8.0)},
                    {"usage", vf::JsonValue(vf::JsonValue::Array{
                        vf::JsonValue("uniform"),
                        vf::JsonValue("copy_dst")})},
                    {"fields", vf::JsonValue(vf::JsonValue::Array{
                        vf::JsonValue("width:f32@0"),
                        vf::JsonValue("height:f32@4")})},
                }),
            });
        vf::JsonValue::Array parameter_bindings;
        const auto add_parameter_binding = [&parameter_bindings](
            double group, double binding, const std::string& source,
            const std::string& kind) {
            parameter_bindings.push_back(vf::JsonValue(
                vf::JsonValue::Object{
                    {"group", vf::JsonValue(group)},
                    {"binding", vf::JsonValue(binding)},
                    {"source", vf::JsonValue(source)},
                    {"kind", vf::JsonValue(kind)},
                }));
        };
        add_parameter_binding(2.0, 0.0, "render_parameter_arena.camera",
            "read_only_storage_buffer");
        add_parameter_binding(2.0, 1.0, "render_parameter_arena.lights",
            "read_only_storage_buffer");
        add_parameter_binding(2.0, 2.0, "render_parameter_arena.objects",
            "read_only_storage_buffer");
        add_parameter_binding(2.0, 3.0, "retained_scene_arena",
            "read_only_storage_buffer");
        add_parameter_binding(2.0, 4.0, "platform_viewport",
            "uniform_buffer");
        add_parameter_binding(3.0, 0.0, "derived_scene", "storage_buffer");
        add_parameter_binding(3.0, 1.0, "derived_lights", "storage_buffer");
        add_parameter_binding(3.0, 2.0, "derived_objects", "storage_buffer");
        render_plan["parameter_bindings"] = vf::JsonValue(
            std::move(parameter_bindings));

        const auto background_clear = [&]() {
            vf::JsonValue::Array values;
            for (const double component : plan.retained_scene.background) {
                values.push_back(vf::JsonValue(component));
            }
            return values;
        };
        vf::JsonValue::Array targets;
        const auto add_canvas_target = [&targets](
            const std::string& id,
            const std::string& kind,
            const std::string& format,
            double scale = 1.0
        ) {
            targets.push_back(vf::JsonValue(vf::JsonValue::Object{
                {"id", vf::JsonValue(id)},
                {"kind", vf::JsonValue(kind)},
                {"format", vf::JsonValue(format)},
                {"size_policy", vf::JsonValue(
                    scale < 1.0 ? "canvas_scale" : "canvas")},
                {"scale", vf::JsonValue(scale)},
                {"sample_count", vf::JsonValue(1.0)},
            }));
        };
        if (plan.retained_scene.shadow_map) {
            const auto shadow_light_count = static_cast<double>(
                retained_shadow_view_count(plan.retained_scene));
            targets.push_back(vf::JsonValue(vf::JsonValue::Object{
                {"id", vf::JsonValue("shadow_depth")},
                {"kind", vf::JsonValue("depth")},
                {"format", vf::JsonValue("depth32float")},
                {"size_policy", vf::JsonValue("fixed")},
                {"width", vf::JsonValue(2048.0)},
                {"height", vf::JsonValue(2048.0)},
                {"array_layers", vf::JsonValue(shadow_light_count)},
                {"sample_count", vf::JsonValue(1.0)},
            }));
        }
        for (const auto& path : reflection_paths) {
            double reflection_scale = 1.0;
            for (const auto surface_index : path) {
                const auto& surface =
                    plan.retained_scene.reflective_surfaces[surface_index];
                reflection_scale = std::min(
                    reflection_scale,
                    std::clamp(std::sqrt(surface.reflectivity), 0.5, 1.0));
            }
            const std::string suffix = reflection_path_token(
                path, plan.retained_scene, "__") + "_" +
                std::to_string(path.size());
            add_canvas_target(
                "planar_reflection_" + suffix,
                "color", "rgba16float", reflection_scale);
            add_canvas_target(
                "planar_reflection_depth_" + suffix,
                "depth", "depth32float", reflection_scale);
        }
        targets.push_back(vf::JsonValue(vf::JsonValue::Object{
            {"id", vf::JsonValue("scene_hdr_msaa")},
            {"kind", vf::JsonValue("color")},
            {"format", vf::JsonValue("rgba16float")},
            {"size_policy", vf::JsonValue("canvas")},
            {"sample_count", vf::JsonValue(4.0)},
        }));
        targets.push_back(vf::JsonValue(vf::JsonValue::Object{
            {"id", vf::JsonValue("scene_hdr")},
            {"kind", vf::JsonValue("color")},
            {"format", vf::JsonValue("rgba16float")},
            {"size_policy", vf::JsonValue("canvas")},
            {"sample_count", vf::JsonValue(1.0)},
        }));
        add_canvas_target(
            "swap_chain", "external_color", "preferred_canvas_format", 1.0);
        targets.push_back(vf::JsonValue(vf::JsonValue::Object{
            {"id", vf::JsonValue("scene_depth_msaa")},
            {"kind", vf::JsonValue("depth")},
            {"format", vf::JsonValue("depth32float")},
            {"size_policy", vf::JsonValue("canvas")},
            {"sample_count", vf::JsonValue(4.0)},
        }));
        render_plan["targets"] = vf::JsonValue(std::move(targets));
        render_plan["parameter_arena_source"] = vf::JsonValue(
            "runtime_surface.render_parameter_arena");
        render_plan["draw_lists_source"] = vf::JsonValue(
            "runtime_surface.render_parameter_arena.draw_lists");
        render_plan["platform_inputs"] = vf::JsonValue(
            vf::JsonValue::Array{
                vf::JsonValue(vf::JsonValue::Object{
                    {"name", vf::JsonValue("viewport_width")},
                    {"type", vf::JsonValue("f32")},
                }),
                vf::JsonValue(vf::JsonValue::Object{
                    {"name", vf::JsonValue("viewport_height")},
                    {"type", vf::JsonValue("f32")},
                }),
            });

        const auto bind_entry = [](double binding,
                                   const std::string& source,
                                   const std::string& resource_type,
                                   vf::JsonValue size,
                                   bool dynamic_offset = false) {
            return vf::JsonValue(vf::JsonValue::Object{
                {"binding", vf::JsonValue(binding)},
                {"source", vf::JsonValue(source)},
                {"resource_type", vf::JsonValue(resource_type)},
                {"size", std::move(size)},
                {"dynamic_offset", vf::JsonValue(dynamic_offset)},
            });
        };
        const auto bind_group = [](double group,
                                   vf::JsonValue::Array entries) {
            return vf::JsonValue(vf::JsonValue::Object{
                {"group", vf::JsonValue(group)},
                {"entries", vf::JsonValue(std::move(entries))},
            });
        };
        const auto compute_frame_bind_groups = [&]() {
            vf::JsonValue::Array groups;
            groups.push_back(bind_group(2.0, vf::JsonValue::Array{
                bind_entry(0.0, "render_parameter_arena.camera",
                    "read_only_storage_buffer",
                    vf::JsonValue("section.byte_length")),
                bind_entry(1.0, "render_parameter_arena.lights",
                    "read_only_storage_buffer",
                    vf::JsonValue("section.byte_length")),
                bind_entry(2.0, "render_parameter_arena.objects",
                    "read_only_storage_buffer",
                    vf::JsonValue("section.byte_length")),
                bind_entry(4.0, "platform_viewport", "uniform_buffer",
                    vf::JsonValue(8.0)),
            }));
            groups.push_back(bind_group(3.0, vf::JsonValue::Array{
                bind_entry(0.0, "derived_scene", "storage_buffer",
                    vf::JsonValue(static_cast<double>(
                        derived_scene_byte_size))),
                bind_entry(1.0, "derived_lights", "storage_buffer",
                    vf::JsonValue(static_cast<double>(
                        std::max<std::uint32_t>(1u,
                            static_cast<std::uint32_t>(
                                plan.retained_scene.lights.size())) * 112u))),
                bind_entry(3.0, "derived_objects", "storage_buffer",
                    vf::JsonValue(static_cast<double>(
                        std::max<std::uint32_t>(1u,
                            plan.retained_scene.object_count) * 256u))),
            }));
            return groups;
        };
        const auto derived_compute_read_bind_group = [&]() {
            return bind_group(3.0, vf::JsonValue::Array{
                bind_entry(0.0, "derived_scene", "storage_buffer",
                    vf::JsonValue(static_cast<double>(
                        derived_scene_byte_size))),
                bind_entry(1.0, "derived_lights", "storage_buffer",
                    vf::JsonValue(static_cast<double>(
                        std::max<std::uint32_t>(1u,
                            static_cast<std::uint32_t>(
                                plan.retained_scene.lights.size())) * 112u))),
                bind_entry(2.0, "derived_objects",
                    "read_only_storage_buffer",
                    vf::JsonValue(static_cast<double>(
                        std::max<std::uint32_t>(1u,
                            plan.retained_scene.object_count) * 256u))),
            });
        };
        const auto compute_shadow_view_bind_groups = [&]() {
            vf::JsonValue::Array groups;
            groups.push_back(bind_group(2.0, vf::JsonValue::Array{
                bind_entry(1.0, "render_parameter_arena.lights",
                    "read_only_storage_buffer",
                    vf::JsonValue("section.byte_length")),
                bind_entry(2.0, "render_parameter_arena.objects",
                    "read_only_storage_buffer",
                    vf::JsonValue("section.byte_length")),
            }));
            groups.push_back(derived_compute_read_bind_group());
            return groups;
        };
        const auto compute_reflection_bind_groups = [&]() {
            vf::JsonValue::Array groups;
            groups.push_back(bind_group(0.0, vf::JsonValue::Array{
                bind_entry(6.0, "pass_state_arena", "uniform_buffer",
                    vf::JsonValue(32.0)),
            }));
            groups.push_back(bind_group(2.0, vf::JsonValue::Array{
                bind_entry(0.0, "render_parameter_arena.camera",
                    "read_only_storage_buffer",
                    vf::JsonValue("section.byte_length")),
                bind_entry(1.0, "render_parameter_arena.lights",
                    "read_only_storage_buffer",
                    vf::JsonValue("section.byte_length")),
                bind_entry(3.0, "retained_scene_arena",
                    "read_only_storage_buffer",
                    vf::JsonValue("arena.byte_length")),
            }));
            groups.push_back(derived_compute_read_bind_group());
            return groups;
        };
        const auto render_bind_groups = [&](const std::string& reflection,
                                             bool with_lighting,
                                             bool with_pass_state,
                                             bool with_raw_objects) {
            vf::JsonValue::Array group0;
            group0.push_back(bind_entry(0.0, "derived_scene",
                "uniform_buffer", vf::JsonValue(static_cast<double>(
                    derived_scene_byte_size))));
            if (with_lighting) {
                group0.push_back(bind_entry(1.0, "derived_lights",
                    "read_only_storage_buffer", vf::JsonValue(
                        static_cast<double>(std::max<std::uint32_t>(1u,
                            static_cast<std::uint32_t>(
                                plan.retained_scene.lights.size())) * 112u))));
                group0.push_back(bind_entry(2.0, "shadow_depth",
                    "depth_texture_array", vf::JsonValue(nullptr)));
                group0.push_back(bind_entry(3.0,
                    "shadow_comparison_sampler", "comparison_sampler",
                    vf::JsonValue(nullptr)));
                if (!reflection.empty()) {
                    group0.push_back(bind_entry(4.0, reflection,
                        "sampled_texture_2d", vf::JsonValue(nullptr)));
                    group0.push_back(bind_entry(5.0,
                        "planar_reflection_sampler", "filtering_sampler",
                        vf::JsonValue(nullptr)));
                }
            }
            if (with_pass_state) {
                group0.push_back(bind_entry(6.0, "pass_state_arena",
                    "uniform_buffer", vf::JsonValue(32.0)));
            }
            vf::JsonValue::Array groups;
            groups.push_back(bind_group(0.0, std::move(group0)));
            groups.push_back(bind_group(1.0, vf::JsonValue::Array{
                bind_entry(0.0, "derived_objects", "uniform_buffer",
                    vf::JsonValue(256.0), false),
            }));
            if (with_lighting) {
                vf::JsonValue::Array group2;
                if (with_raw_objects) {
                    group2.push_back(bind_entry(2.0,
                        "render_parameter_arena.objects",
                        "read_only_storage_buffer",
                        vf::JsonValue("section.byte_length")));
                }
                group2.push_back(bind_entry(3.0, "retained_scene_arena",
                    "read_only_storage_buffer",
                    vf::JsonValue("arena.byte_length")));
                groups.push_back(bind_group(2.0, std::move(group2)));
                groups.push_back(bind_group(3.0, vf::JsonValue::Array{
                    bind_entry(2.0, "derived_objects",
                        "read_only_storage_buffer",
                        vf::JsonValue(static_cast<double>(
                            std::max<std::uint32_t>(1u,
                                plan.retained_scene.object_count) *
                            256u))),
                }));
            }
            return groups;
        };
        const auto flare_bind_groups = [&](bool with_pass_state) {
            vf::JsonValue::Array groups;
            vf::JsonValue::Array group0{
                bind_entry(0.0, "derived_scene", "uniform_buffer",
                    vf::JsonValue(static_cast<double>(
                        derived_scene_byte_size))),
            };
            if (with_pass_state) {
                group0.push_back(bind_entry(6.0, "pass_state_arena",
                    "uniform_buffer", vf::JsonValue(32.0)));
            }
            groups.push_back(bind_group(0.0, std::move(group0)));
            groups.push_back(bind_group(2.0, vf::JsonValue::Array{
                bind_entry(1.0, "render_parameter_arena.lights",
                    "read_only_storage_buffer",
                    vf::JsonValue("section.byte_length")),
                bind_entry(4.0, "platform_viewport", "uniform_buffer",
                    vf::JsonValue(8.0)),
            }));
            return groups;
        };
        const auto emitter_bind_groups = [&](bool with_pass_state) {
            vf::JsonValue::Array groups;
            vf::JsonValue::Array group0{
                bind_entry(0.0, "derived_scene", "uniform_buffer",
                    vf::JsonValue(static_cast<double>(
                        derived_scene_byte_size))),
            };
            if (with_pass_state) {
                group0.push_back(bind_entry(6.0, "pass_state_arena",
                    "uniform_buffer", vf::JsonValue(32.0)));
            }
            groups.push_back(bind_group(0.0, std::move(group0)));
            groups.push_back(bind_group(2.0, vf::JsonValue::Array{
                bind_entry(1.0, "render_parameter_arena.lights",
                    "read_only_storage_buffer",
                    vf::JsonValue("section.byte_length")),
            }));
            return groups;
        };

        vf::JsonValue::Array passes;
        const auto reflection_path_json = [&](const ReflectionPath& path) {
            vf::JsonValue::Array ids;
            for (const auto surface_index : path) {
                ids.push_back(vf::JsonValue(
                    plan.retained_scene.reflective_surfaces[surface_index].id));
            }
            return vf::JsonValue(std::move(ids));
        };
        const std::uint32_t prepare_items = std::max<std::uint32_t>(
            1, std::max<std::uint32_t>(
                plan.retained_scene.object_count,
                static_cast<std::uint32_t>(
                    plan.retained_scene.lights.size())));
        passes.push_back(vf::JsonValue(vf::JsonValue::Object{
            {"kind", vf::JsonValue("prepare_frame")},
            {"pipeline", vf::JsonValue("prepare_frame")},
            {"dispatch", vf::JsonValue(vf::JsonValue::Object{
                {"x", vf::JsonValue(static_cast<double>(
                    (prepare_items + 63u) / 64u))},
                {"y", vf::JsonValue(1.0)},
                {"z", vf::JsonValue(1.0)},
            })},
            {"reads", vf::JsonValue(vf::JsonValue::Array{
                vf::JsonValue("render_parameter_arena.camera"),
                vf::JsonValue("render_parameter_arena.lights"),
                vf::JsonValue("render_parameter_arena.objects"),
                vf::JsonValue("platform_viewport"),
            })},
            {"writes", vf::JsonValue(vf::JsonValue::Array{
                vf::JsonValue("derived_scene"),
                vf::JsonValue("derived_lights"),
                vf::JsonValue("derived_objects"),
            })},
            {"bind_resources", vf::JsonValue(vf::JsonValue::Array{
                vf::JsonValue("render_parameter_arena.camera"),
                vf::JsonValue("render_parameter_arena.lights"),
                vf::JsonValue("render_parameter_arena.objects"),
                vf::JsonValue("platform_viewport"),
                vf::JsonValue("derived_scene"),
                vf::JsonValue("derived_lights"),
                vf::JsonValue("derived_objects"),
            })},
            {"viewport", vf::JsonValue(vf::JsonValue::Object{
                {"policy", vf::JsonValue("none")},
            })},
            {"bind_groups", vf::JsonValue(compute_frame_bind_groups())},
        }));
        passes.push_back(vf::JsonValue(vf::JsonValue::Object{
            {"kind", vf::JsonValue("prepare_shadow_views")},
            {"pipeline", vf::JsonValue("prepare_shadow_views")},
            {"dispatch", vf::JsonValue(vf::JsonValue::Object{
                {"x", vf::JsonValue(1.0)},
                {"y", vf::JsonValue(1.0)},
                {"z", vf::JsonValue(1.0)},
            })},
            {"reads", vf::JsonValue(vf::JsonValue::Array{
                vf::JsonValue("render_parameter_arena.lights"),
                vf::JsonValue("render_parameter_arena.objects"),
                vf::JsonValue("derived_lights"),
                vf::JsonValue("derived_objects"),
            })},
            {"writes", vf::JsonValue(vf::JsonValue::Array{
                vf::JsonValue("derived_scene"),
                vf::JsonValue("derived_lights"),
            })},
            {"bind_resources", vf::JsonValue(vf::JsonValue::Array{
                vf::JsonValue("render_parameter_arena.camera"),
                vf::JsonValue("render_parameter_arena.lights"),
                vf::JsonValue("render_parameter_arena.objects"),
                vf::JsonValue("platform_viewport"),
                vf::JsonValue("derived_scene"),
                vf::JsonValue("derived_lights"),
                vf::JsonValue("derived_objects"),
            })},
            {"viewport", vf::JsonValue(vf::JsonValue::Object{
                {"policy", vf::JsonValue("none")},
            })},
            {"bind_groups", vf::JsonValue(compute_shadow_view_bind_groups())},
        }));
        std::uint32_t prepared_reflection_index = 0;
        for (const auto& path : reflection_paths) {
                const auto& surface = plan.retained_scene.reflective_surfaces[
                    path.back()];
                vf::JsonValue parent_camera_state_index(nullptr);
                if (path.size() > 1) {
                    auto parent = path;
                    parent.pop_back();
                    parent_camera_state_index = vf::JsonValue(
                        static_cast<double>(reflection_path_index(
                            reflection_paths, parent)));
                }
                passes.push_back(vf::JsonValue(vf::JsonValue::Object{
                    {"kind", vf::JsonValue(
                        "prepare_reflection_camera")},
                    {"pipeline", vf::JsonValue(
                        "prepare_reflection_camera")},
                    {"surface_id", vf::JsonValue(surface.id)},
                    {"reflection_path", reflection_path_json(path)},
                    {"parent_camera_state_index",
                        std::move(parent_camera_state_index)},
                    {"object_index", vf::JsonValue(
                        static_cast<double>(surface.object_index))},
                    {"reflection_depth", vf::JsonValue(
                        static_cast<double>(path.size()))},
                    {"camera_state_id", vf::JsonValue(
                        "reflection:" + reflection_path_token(
                            path, plan.retained_scene, ">"))},
                    {"camera_state_index", vf::JsonValue(
                        static_cast<double>(prepared_reflection_index))},
                    {"dispatch", vf::JsonValue(vf::JsonValue::Object{
                        {"x", vf::JsonValue(1.0)},
                        {"y", vf::JsonValue(1.0)},
                        {"z", vf::JsonValue(1.0)},
                    })},
                    {"aperture", vf::JsonValue(vf::JsonValue::Object{
                        {"arena", vf::JsonValue(
                            "retained_scene_arena")},
                        {"byte_offset", vf::JsonValue(static_cast<double>(
                            surface.aperture_byte_offset))},
                        {"vertex_count", vf::JsonValue(static_cast<double>(
                            surface.aperture_vertex_count))},
                        {"vertex_stride", vf::JsonValue(static_cast<double>(
                            surface.aperture_vertex_stride))},
                        {"position_offset", vf::JsonValue(static_cast<double>(
                            surface.aperture_position_offset))},
                        {"storage", vf::JsonValue("float32")},
                    })},
                    {"writes", vf::JsonValue(vf::JsonValue::Array{
                        vf::JsonValue("derived_scene"),
                        vf::JsonValue("derived_lights"),
                    })},
                    {"bind_resources", vf::JsonValue(vf::JsonValue::Array{
                        vf::JsonValue("render_parameter_arena.camera"),
                        vf::JsonValue("render_parameter_arena.lights"),
                        vf::JsonValue("retained_scene_arena"),
                        vf::JsonValue("pass_state_arena"),
                        vf::JsonValue("derived_scene"),
                        vf::JsonValue("derived_lights"),
                        vf::JsonValue("derived_objects"),
                    })},
                    {"viewport", vf::JsonValue(vf::JsonValue::Object{
                        {"policy", vf::JsonValue("none")},
                    })},
                    {"pass_state", vf::JsonValue(vf::JsonValue::Object{
                        {"camera_state_index", vf::JsonValue(
                            static_cast<double>(prepared_reflection_index))},
                        {"reflection_depth", vf::JsonValue(
                            static_cast<double>(path.size()))},
                        {"light_index", vf::JsonValue(0.0)},
                        {"target_layer", vf::JsonValue(0.0)},
                        {"object_index", vf::JsonValue(
                            static_cast<double>(surface.object_index))},
                        {"aperture_float_offset", vf::JsonValue(
                            static_cast<double>(
                                surface.aperture_byte_offset / 4u))},
                        {"aperture_vertex_count", vf::JsonValue(
                            static_cast<double>(
                                surface.aperture_vertex_count))},
                        {"aperture_vertex_stride_floats", vf::JsonValue(
                            static_cast<double>(
                                surface.aperture_vertex_stride / 4u))},
                    })},
                    {"bind_groups", vf::JsonValue(
                        compute_reflection_bind_groups())},
                }));
                ++prepared_reflection_index;
        }
        if (plan.retained_scene.shadow_map) {
            std::uint32_t shadow_layer = 0;
            for (const auto& light : plan.retained_scene.lights) {
                if (!light.casts_shadow) continue;
                const std::string shadow_draw_list =
                    light.kind == "projected" &&
                    !light.derived_emitter_view
                    ? "shadow_casters_" + light.id
                    : "shadow_casters";
                vf::JsonValue::Array excluded_object_indices;
                if (light.derived_emitter_view) {
                    for (const auto& surface_id : light.reflection_path) {
                        const auto surface = std::find_if(
                            plan.retained_scene.reflective_surfaces.begin(),
                            plan.retained_scene.reflective_surfaces.end(),
                            [&](const auto& candidate) {
                                return candidate.id == surface_id;
                            });
                        if (surface !=
                            plan.retained_scene.reflective_surfaces.end()) {
                            excluded_object_indices.push_back(vf::JsonValue(
                                static_cast<double>(surface->object_index)));
                        }
                    }
                }
                for (std::uint32_t shadow_face = 0;
                     shadow_face < light.shadow_view_count; ++shadow_face) {
                vf::JsonValue::Object shadow_view{
                    {"coverage", vf::JsonValue(
                        light.shadow_view_count == 6u
                            ? "cube_face" : "fitted_scene")},
                    {"projection", vf::JsonValue(
                        light.shadow_view_count == 6u
                            ? "cube" : "perspective")},
                };
                if (light.shadow_view_count == 6u) {
                    shadow_view["cube_face"] = vf::JsonValue(
                        static_cast<double>(shadow_face));
                }
                passes.push_back(vf::JsonValue(vf::JsonValue::Object{
                    {"kind", vf::JsonValue("shadow_depth")},
                    {"pipeline", vf::JsonValue("shadow_depth")},
                    {"target", vf::JsonValue("shadow_depth")},
                    {"target_layer", vf::JsonValue(
                        static_cast<double>(shadow_layer))},
                    {"depth_attachment", vf::JsonValue("shadow_depth")},
                    {"draw_list_id", vf::JsonValue(shadow_draw_list)},
                    {"excluded_object_indices", vf::JsonValue(
                        excluded_object_indices)},
                    {"light_id", vf::JsonValue(light.id)},
                    {"light_index", vf::JsonValue(
                        static_cast<double>(light.light_index))},
                    {"shadow_view", vf::JsonValue(std::move(shadow_view))},
                    {"camera_state_id", vf::JsonValue(
                        "light:" + light.id +
                        (light.shadow_view_count == 6u
                            ? ":face:" + std::to_string(shadow_face) : ""))},
                    {"camera_state_index", vf::JsonValue(
                        static_cast<double>(shadow_layer))},
                    {"vertex_entry", vf::JsonValue("vkf_shadow_vertex")},
                    {"viewport", vf::JsonValue(vf::JsonValue::Object{
                        {"policy", vf::JsonValue("target")},
                    })},
                    {"color", vf::JsonValue(nullptr)},
                    {"depth", vf::JsonValue(vf::JsonValue::Object{
                        {"target", vf::JsonValue("shadow_depth")},
                        {"array_layer", vf::JsonValue(
                            static_cast<double>(shadow_layer))},
                        {"load_op", vf::JsonValue("clear")},
                        {"store_op", vf::JsonValue("store")},
                        {"clear_value", vf::JsonValue(1.0)},
                        {"read_only", vf::JsonValue(false)},
                    })},
                    {"bind_resources", vf::JsonValue(vf::JsonValue::Array{
                        vf::JsonValue("derived_scene"),
                        vf::JsonValue("derived_objects"),
                        vf::JsonValue("pass_state_arena"),
                        vf::JsonValue("draw_list:" + shadow_draw_list),
                        vf::JsonValue("shadow_depth")
                    })},
                    {"pass_state", vf::JsonValue(vf::JsonValue::Object{
                        {"camera_state_index", vf::JsonValue(
                            static_cast<double>(shadow_layer))},
                        {"reflection_depth", vf::JsonValue(0.0)},
                        {"light_index", vf::JsonValue(
                            static_cast<double>(light.light_index))},
                        {"target_layer", vf::JsonValue(
                            static_cast<double>(shadow_layer))},
                        {"object_index", vf::JsonValue(0.0)},
                        {"aperture_float_offset", vf::JsonValue(0.0)},
                        {"aperture_vertex_count", vf::JsonValue(0.0)},
                        {"aperture_vertex_stride_floats", vf::JsonValue(0.0)},
                    })},
                    {"bind_groups", vf::JsonValue(
                        render_bind_groups("", false, true, false))},
                }));
                ++shadow_layer;
                }
            }
        }
        for (std::uint32_t depth = plan.retained_scene.max_reflection_depth;
             depth > 0; --depth) {
            for (const auto& path : reflection_paths) {
                if (path.size() != depth) continue;
                const auto camera_index = reflection_path_index(
                    reflection_paths, path);
                const auto& surface = plan.retained_scene.reflective_surfaces[
                    path.back()];
                const std::string suffix = reflection_path_token(
                    path, plan.retained_scene, "__") + "_" +
                    std::to_string(path.size());
                const std::string target =
                    "planar_reflection_" + suffix;
                passes.push_back(vf::JsonValue(vf::JsonValue::Object{
                    {"kind", vf::JsonValue("planar_reflection")},
                    {"pipeline", vf::JsonValue(
                        "retained_scene_terminal_hdr")},
                    {"target", vf::JsonValue(target)},
                    {"color_attachment", vf::JsonValue(target)},
                    {"depth_attachment", vf::JsonValue(
                        "planar_reflection_depth_" + suffix)},
                    {"draw_list_id", vf::JsonValue(
                        "reflection_visible_" + surface.id + "_" +
                            std::to_string(depth))},
                    {"surface_id", vf::JsonValue(surface.id)},
                    {"reflection_path", reflection_path_json(path)},
                    {"object_index", vf::JsonValue(
                        static_cast<double>(surface.object_index))},
                    {"camera_state_id", vf::JsonValue(
                        "reflection:" + reflection_path_token(
                            path, plan.retained_scene, ">"))},
                    {"camera_state_index", vf::JsonValue(
                        static_cast<double>(camera_index))},
                    {"reflection_depth", vf::JsonValue(
                        static_cast<double>(depth))},
                    {"vertex_entry", vf::JsonValue(
                        "vkf_reflection_vertex")},
                    {"fragment_entry", vf::JsonValue(
                        "vkf_terminal_scene_fragment")},
                    {"viewport", vf::JsonValue(vf::JsonValue::Object{
                        {"policy", vf::JsonValue("target")},
                    })},
                    {"color", vf::JsonValue(vf::JsonValue::Object{
                        {"target", vf::JsonValue(target)},
                        {"load_op", vf::JsonValue("clear")},
                        {"store_op", vf::JsonValue("store")},
                        {"clear_value", vf::JsonValue(background_clear())},
                        {"resolve_target", vf::JsonValue(nullptr)},
                    })},
                    {"depth", vf::JsonValue(vf::JsonValue::Object{
                        {"target", vf::JsonValue(
                            "planar_reflection_depth_" + suffix)},
                        {"array_layer", vf::JsonValue(0.0)},
                        {"load_op", vf::JsonValue("clear")},
                        {"store_op", vf::JsonValue("store")},
                        {"clear_value", vf::JsonValue(1.0)},
                        {"read_only", vf::JsonValue(false)},
                    })},
                    {"bind_resources", vf::JsonValue(vf::JsonValue::Array{
                        vf::JsonValue("derived_scene"),
                        vf::JsonValue("derived_lights"),
                        vf::JsonValue("derived_objects"),
                        vf::JsonValue("pass_state_arena"),
                        vf::JsonValue("draw_list:reflection_visible_" +
                            surface.id + "_" + std::to_string(depth)),
                        vf::JsonValue("shadow_depth"),
                        vf::JsonValue("render_parameter_arena.objects"),
                        vf::JsonValue("retained_scene_arena"),
                    })},
                    {"pass_state", vf::JsonValue(vf::JsonValue::Object{
                        {"camera_state_index", vf::JsonValue(
                            static_cast<double>(camera_index))},
                        {"reflection_depth", vf::JsonValue(
                            static_cast<double>(depth))},
                        {"light_index", vf::JsonValue(0.0)},
                        {"target_layer", vf::JsonValue(0.0)},
                        {"object_index", vf::JsonValue(
                            static_cast<double>(surface.object_index))},
                        {"aperture_float_offset", vf::JsonValue(0.0)},
                        {"aperture_vertex_count", vf::JsonValue(0.0)},
                        {"aperture_vertex_stride_floats", vf::JsonValue(0.0)},
                    })},
                    {"bind_groups", vf::JsonValue(
                        render_bind_groups("", true, true, false))},
                }));
                if (plan.retained_scene.light_flares) {
                    passes.push_back(vf::JsonValue(vf::JsonValue::Object{
                        {"kind", vf::JsonValue("reflection_emitters")},
                        {"pipeline", vf::JsonValue("reflection_emitters")},
                        {"target", vf::JsonValue(target)},
                        {"color_attachment", vf::JsonValue(target)},
                        {"depth_attachment", vf::JsonValue(
                            "planar_reflection_depth_" + suffix)},
                        {"surface_id", vf::JsonValue(surface.id)},
                        {"reflection_path", reflection_path_json(path)},
                        {"camera_state_index", vf::JsonValue(
                            static_cast<double>(camera_index))},
                        {"reflection_depth", vf::JsonValue(
                            static_cast<double>(depth))},
                        {"vertex_count", vf::JsonValue(2304.0)},
                        {"instance_count", vf::JsonValue(
                            static_cast<double>(
                                plan.retained_scene.lights.size()))},
                        {"vertex_entry", vf::JsonValue(
                            "vkf_reflection_emitter_vertex")},
                        {"fragment_entry", vf::JsonValue(
                            "vkf_emitter_fragment")},
                        {"viewport", vf::JsonValue(vf::JsonValue::Object{
                            {"policy", vf::JsonValue("target")},
                        })},
                        {"color", vf::JsonValue(vf::JsonValue::Object{
                            {"target", vf::JsonValue(target)},
                            {"load_op", vf::JsonValue("load")},
                            {"store_op", vf::JsonValue("store")},
                            {"resolve_target", vf::JsonValue(nullptr)},
                        })},
                        {"depth", vf::JsonValue(vf::JsonValue::Object{
                            {"target", vf::JsonValue(
                                "planar_reflection_depth_" + suffix)},
                            {"array_layer", vf::JsonValue(0.0)},
                            {"load_op", vf::JsonValue("load")},
                            {"store_op", vf::JsonValue("store")},
                            {"clear_value", vf::JsonValue(1.0)},
                            {"read_only", vf::JsonValue(false)},
                        })},
                        {"bind_resources", vf::JsonValue(
                            vf::JsonValue::Array{
                                vf::JsonValue("derived_scene"),
                                vf::JsonValue("pass_state_arena"),
                                vf::JsonValue(
                                    "render_parameter_arena.lights"),
                            })},
                        {"pass_state", vf::JsonValue(vf::JsonValue::Object{
                            {"camera_state_index", vf::JsonValue(
                                static_cast<double>(
                                    camera_index))},
                            {"reflection_depth", vf::JsonValue(
                                static_cast<double>(depth))},
                            {"light_index", vf::JsonValue(0.0)},
                            {"target_layer", vf::JsonValue(0.0)},
                            {"object_index", vf::JsonValue(
                                static_cast<double>(
                                    surface.object_index))},
                            {"aperture_float_offset", vf::JsonValue(0.0)},
                            {"aperture_vertex_count", vf::JsonValue(0.0)},
                            {"aperture_vertex_stride_floats",
                                vf::JsonValue(0.0)},
                        })},
                        {"bind_groups", vf::JsonValue(
                            emitter_bind_groups(true))},
                    }));
                    passes.push_back(vf::JsonValue(vf::JsonValue::Object{
                        {"kind", vf::JsonValue("reflection_flares")},
                        {"pipeline", vf::JsonValue("reflection_flares")},
                        {"target", vf::JsonValue(target)},
                        {"color_attachment", vf::JsonValue(target)},
                        {"depth_attachment", vf::JsonValue(
                            "planar_reflection_depth_" + suffix)},
                        {"surface_id", vf::JsonValue(surface.id)},
                        {"reflection_path", reflection_path_json(path)},
                        {"camera_state_index", vf::JsonValue(
                            static_cast<double>(camera_index))},
                        {"reflection_depth", vf::JsonValue(
                            static_cast<double>(depth))},
                        {"vertex_count", vf::JsonValue(6.0)},
                        {"instance_count", vf::JsonValue(
                            static_cast<double>(
                                plan.retained_scene.lights.size()))},
                        {"vertex_entry", vf::JsonValue(
                            "vkf_reflection_flare_vertex")},
                        {"fragment_entry", vf::JsonValue(
                            "vkf_flare_fragment")},
                        {"viewport", vf::JsonValue(vf::JsonValue::Object{
                            {"policy", vf::JsonValue("target")},
                        })},
                        {"color", vf::JsonValue(vf::JsonValue::Object{
                            {"target", vf::JsonValue(target)},
                            {"load_op", vf::JsonValue("load")},
                            {"store_op", vf::JsonValue("store")},
                            {"resolve_target", vf::JsonValue(nullptr)},
                        })},
                        {"depth", vf::JsonValue(vf::JsonValue::Object{
                            {"target", vf::JsonValue(
                                "planar_reflection_depth_" + suffix)},
                            {"array_layer", vf::JsonValue(0.0)},
                            {"load_op", vf::JsonValue("load")},
                            {"store_op", vf::JsonValue("store")},
                            {"clear_value", vf::JsonValue(1.0)},
                            {"read_only", vf::JsonValue(true)},
                        })},
                        {"bind_resources", vf::JsonValue(
                            vf::JsonValue::Array{
                                vf::JsonValue("derived_scene"),
                                vf::JsonValue("pass_state_arena"),
                                vf::JsonValue(
                                    "render_parameter_arena.lights"),
                                vf::JsonValue("platform_viewport"),
                                vf::JsonValue(
                                    "planar_reflection_depth_" + suffix),
                            })},
                        {"pass_state", vf::JsonValue(vf::JsonValue::Object{
                            {"camera_state_index", vf::JsonValue(
                                static_cast<double>(camera_index))},
                            {"reflection_depth", vf::JsonValue(
                                static_cast<double>(depth))},
                            {"light_index", vf::JsonValue(0.0)},
                            {"target_layer", vf::JsonValue(0.0)},
                            {"object_index", vf::JsonValue(
                                static_cast<double>(
                                    surface.object_index))},
                            {"aperture_float_offset", vf::JsonValue(0.0)},
                            {"aperture_vertex_count", vf::JsonValue(0.0)},
                            {"aperture_vertex_stride_floats",
                                vf::JsonValue(0.0)},
                        })},
                        {"bind_groups", vf::JsonValue(
                            flare_bind_groups(true))},
                    }));
                    std::swap(
                        passes[passes.size() - 2],
                        passes[passes.size() - 1]);
                }
            }
        }
        vf::JsonValue::Array final_reflection_sources;
        for (const auto& surface : plan.retained_scene.reflective_surfaces) {
            final_reflection_sources.push_back(vf::JsonValue(
                vf::JsonValue::Object{
                    {"surface_id", vf::JsonValue(surface.id)},
                    {"object_index", vf::JsonValue(
                        static_cast<double>(surface.object_index))},
                    {"target", vf::JsonValue(
                        "planar_reflection_" + surface.id + "_1")},
                    {"group", vf::JsonValue(0.0)},
                    {"binding", vf::JsonValue(4.0)},
                    {"sampler", vf::JsonValue(
                        "planar_reflection_sampler")},
                }));
        }
        passes.push_back(vf::JsonValue(vf::JsonValue::Object{
            {"kind", vf::JsonValue("scene_color")},
            {"pipeline", vf::JsonValue("retained_scene_hdr_msaa")},
            {"terminal_pipeline", vf::JsonValue(
                "retained_scene_terminal_hdr_msaa")},
            {"target", vf::JsonValue("scene_hdr")},
            {"color_attachment", vf::JsonValue("scene_hdr_msaa")},
            {"resolve_target", vf::JsonValue("scene_hdr")},
            {"depth_attachment", vf::JsonValue("scene_depth_msaa")},
            {"draw_list_id", vf::JsonValue("scene_visible")},
            {"reflection_sources", vf::JsonValue(
                std::move(final_reflection_sources))},
            {"reflection_depth", vf::JsonValue(0.0)},
            {"vertex_entry", vf::JsonValue("vkf_scene_vertex")},
            {"fragment_entry", vf::JsonValue("vkf_scene_fragment")},
            {"viewport", vf::JsonValue(vf::JsonValue::Object{
                {"policy", vf::JsonValue("target")},
            })},
            {"color", vf::JsonValue(vf::JsonValue::Object{
                {"target", vf::JsonValue("scene_hdr_msaa")},
                {"load_op", vf::JsonValue("clear")},
                {"store_op", vf::JsonValue("store")},
                {"clear_value", vf::JsonValue(background_clear())},
                {"resolve_target", vf::JsonValue("scene_hdr")},
            })},
            {"depth", vf::JsonValue(vf::JsonValue::Object{
                {"target", vf::JsonValue("scene_depth_msaa")},
                {"array_layer", vf::JsonValue(0.0)},
                {"load_op", vf::JsonValue("clear")},
                {"store_op", vf::JsonValue("store")},
                {"clear_value", vf::JsonValue(1.0)},
                {"read_only", vf::JsonValue(false)},
            })},
            {"bind_resources", vf::JsonValue(vf::JsonValue::Array{
                vf::JsonValue("derived_scene"),
                vf::JsonValue("derived_lights"),
                vf::JsonValue("derived_objects"),
                vf::JsonValue("draw_list:scene_visible"),
                vf::JsonValue("shadow_depth"),
                vf::JsonValue("reflection_sources"),
                vf::JsonValue("render_parameter_arena.objects"),
                vf::JsonValue("retained_scene_arena"),
            })},
            {"bind_groups", vf::JsonValue(render_bind_groups(
                "pass.reflection_sources_by_object", true, false, false))},
            {"terminal_bind_groups", vf::JsonValue(render_bind_groups(
                "", true, false, false))},
        }));
        if (plan.retained_scene.light_flares) {
            passes.push_back(vf::JsonValue(vf::JsonValue::Object{
                {"kind", vf::JsonValue("light_emitters")},
                {"pipeline", vf::JsonValue("light_emitters")},
                {"target", vf::JsonValue("scene_hdr")},
                {"color_attachment", vf::JsonValue("scene_hdr_msaa")},
                {"resolve_target", vf::JsonValue("scene_hdr")},
                {"depth_attachment", vf::JsonValue("scene_depth_msaa")},
                {"vertex_count", vf::JsonValue(2304.0)},
                {"instance_count", vf::JsonValue(static_cast<double>(
                    plan.retained_scene.lights.size()))},
                {"vertex_entry", vf::JsonValue("vkf_emitter_vertex")},
                {"fragment_entry", vf::JsonValue("vkf_emitter_fragment")},
                {"viewport", vf::JsonValue(vf::JsonValue::Object{
                    {"policy", vf::JsonValue("target")},
                })},
                {"color", vf::JsonValue(vf::JsonValue::Object{
                    {"target", vf::JsonValue("scene_hdr_msaa")},
                    {"load_op", vf::JsonValue("load")},
                    {"store_op", vf::JsonValue("store")},
                    {"resolve_target", vf::JsonValue("scene_hdr")},
                })},
                {"depth", vf::JsonValue(vf::JsonValue::Object{
                    {"target", vf::JsonValue("scene_depth_msaa")},
                    {"array_layer", vf::JsonValue(0.0)},
                    {"load_op", vf::JsonValue("load")},
                    {"store_op", vf::JsonValue("store")},
                    {"clear_value", vf::JsonValue(1.0)},
                    {"read_only", vf::JsonValue(false)},
                })},
                {"bind_resources", vf::JsonValue(vf::JsonValue::Array{
                    vf::JsonValue("derived_scene"),
                    vf::JsonValue("render_parameter_arena.lights"),
                })},
                {"bind_groups", vf::JsonValue(emitter_bind_groups(false))},
            }));
            passes.push_back(vf::JsonValue(vf::JsonValue::Object{
                {"kind", vf::JsonValue("light_flares")},
                {"pipeline", vf::JsonValue("light_flares")},
                {"target", vf::JsonValue("scene_hdr")},
                {"color_attachment", vf::JsonValue("scene_hdr_msaa")},
                {"resolve_target", vf::JsonValue("scene_hdr")},
                {"depth_attachment", vf::JsonValue("scene_depth_msaa")},
                {"vertex_count", vf::JsonValue(6.0)},
                {"instance_count", vf::JsonValue(static_cast<double>(
                    plan.retained_scene.lights.size()))},
                {"vertex_entry", vf::JsonValue("vkf_flare_vertex")},
                {"fragment_entry", vf::JsonValue("vkf_flare_fragment")},
                {"viewport", vf::JsonValue(vf::JsonValue::Object{
                    {"policy", vf::JsonValue("target")},
                })},
                {"color", vf::JsonValue(vf::JsonValue::Object{
                    {"target", vf::JsonValue("scene_hdr_msaa")},
                    {"load_op", vf::JsonValue("load")},
                    {"store_op", vf::JsonValue("store")},
                    {"resolve_target", vf::JsonValue("scene_hdr")},
                })},
                {"depth", vf::JsonValue(vf::JsonValue::Object{
                    {"target", vf::JsonValue("scene_depth_msaa")},
                    {"array_layer", vf::JsonValue(0.0)},
                    {"load_op", vf::JsonValue("load")},
                    {"store_op", vf::JsonValue("store")},
                    {"clear_value", vf::JsonValue(1.0)},
                    {"read_only", vf::JsonValue(true)},
                })},
                {"bind_resources", vf::JsonValue(vf::JsonValue::Array{
                    vf::JsonValue("derived_scene"),
                    vf::JsonValue("render_parameter_arena.lights"),
                    vf::JsonValue("platform_viewport"),
                    vf::JsonValue("scene_depth_msaa"),
                })},
                {"bind_groups", vf::JsonValue(flare_bind_groups(false))},
            }));
            std::swap(
                passes[passes.size() - 2],
                passes[passes.size() - 1]);
        }
        passes.push_back(vf::JsonValue(vf::JsonValue::Object{
            {"kind", vf::JsonValue("scene_present")},
            {"pipeline", vf::JsonValue("retained_scene_present")},
            {"target", vf::JsonValue("swap_chain")},
            {"color_attachment", vf::JsonValue("swap_chain")},
            {"vertex_count", vf::JsonValue(3.0)},
            {"instance_count", vf::JsonValue(1.0)},
            {"vertex_entry", vf::JsonValue("vkf_present_vertex")},
            {"fragment_entry", vf::JsonValue("vkf_present_fragment")},
            {"viewport", vf::JsonValue(vf::JsonValue::Object{
                {"policy", vf::JsonValue("target")},
            })},
            {"color", vf::JsonValue(vf::JsonValue::Object{
                {"target", vf::JsonValue("swap_chain")},
                {"load_op", vf::JsonValue("clear")},
                {"store_op", vf::JsonValue("store")},
                {"clear_value", vf::JsonValue(background_clear())},
            })},
            {"bind_resources", vf::JsonValue(vf::JsonValue::Array{
                vf::JsonValue("scene_hdr"),
                vf::JsonValue("planar_reflection_sampler"),
            })},
            {"bind_groups", vf::JsonValue(vf::JsonValue::Array{
                bind_group(0.0, vf::JsonValue::Array{
                    bind_entry(4.0, "scene_hdr", "sampled_texture_2d",
                        vf::JsonValue(nullptr)),
                    bind_entry(5.0, "planar_reflection_sampler",
                        "filtering_sampler", vf::JsonValue(nullptr)),
                }),
            })},
        }));
        vf::JsonValue::Array pass_state_records;
        std::uint32_t pass_state_record_index = 0;
        for (std::size_t pass_index = 0; pass_index < passes.size();
             ++pass_index) {
            auto& pass_object = passes[pass_index].as_object();
            const auto state = pass_object.find("pass_state");
            if (state != pass_object.end()) {
                const std::uint32_t byte_offset =
                    pass_state_record_index * 256u;
                pass_object["pass_state_byte_offset"] = vf::JsonValue(
                    static_cast<double>(byte_offset));
                pass_state_records.push_back(vf::JsonValue(
                    vf::JsonValue::Object{
                        {"pass_index", vf::JsonValue(
                            static_cast<double>(pass_index))},
                        {"pass_kind", pass_object.at("kind")},
                        {"byte_offset", vf::JsonValue(
                            static_cast<double>(byte_offset))},
                        {"byte_length", vf::JsonValue(32.0)},
                        {"data", state->second},
                    }));
                auto bind_groups = pass_object.find("bind_groups");
                if (bind_groups != pass_object.end()) {
                    for (auto& group_value :
                         bind_groups->second.as_array()) {
                        auto& group = group_value.as_object();
                        if (group.at("group").as_number() != 0.0) continue;
                        for (auto& entry_value :
                             group.at("entries").as_array()) {
                            auto& entry = entry_value.as_object();
                            if (entry.at("binding").as_number() != 6.0) {
                                continue;
                            }
                            entry["source"] = vf::JsonValue(
                                "pass_state_arena");
                            entry["offset"] = vf::JsonValue(
                                static_cast<double>(byte_offset));
                            entry["size"] = vf::JsonValue(32.0);
                            entry["dynamic_offset"] = vf::JsonValue(false);
                        }
                    }
                }
                ++pass_state_record_index;
            }
            if (pass_object.find("draw_list_id") != pass_object.end()) {
                pass_object["object_binding"] = vf::JsonValue(
                    vf::JsonValue::Object{
                        {"group", vf::JsonValue(1.0)},
                        {"binding", vf::JsonValue(0.0)},
                        {"source", vf::JsonValue("derived_objects")},
                        {"byte_offset_source", vf::JsonValue(
                            "draw.object_uniform_byte_offset")},
                        {"byte_length_source", vf::JsonValue(
                            "draw.object_uniform_byte_length")},
                        {"dynamic_offset", vf::JsonValue(false)},
                    });
            }
        }
        auto& control_buffers =
            render_plan.at("control_buffers").as_array();
        control_buffers[0].as_object()["records"] = vf::JsonValue(
            std::move(pass_state_records));
        control_buffers[0].as_object()["byte_size"] = vf::JsonValue(
            static_cast<double>(pass_state_record_index * 256u));
        render_plan["passes"] = vf::JsonValue(std::move(passes));
        render_plan["features"] = vf::JsonValue(vf::JsonValue::Object{
            {"checker_texture", vf::JsonValue(plan.retained_scene.checker_texture)},
            {"planar_mirror", vf::JsonValue(plan.retained_scene.planar_mirror)},
            {"shadow_map", vf::JsonValue(plan.retained_scene.shadow_map)},
        });
        runtime_surface["render_plan"] = vf::JsonValue(
            std::move(render_plan));
        manifest["runtime_surface"] = vf::JsonValue(std::move(runtime_surface));
        return manifest;
    }
    if (plan.dom_only) {
        runtime_surface["update_mode"] = vf::JsonValue("dom_only");
        runtime_surface["shader_entry"] = vf::JsonValue("vkf_dom_only");
        manifest["runtime_surface"] = vf::JsonValue(std::move(runtime_surface));
        return manifest;
    }
    runtime_surface["update_mode"] = vf::JsonValue(
        plan.update.axis_vector_mode ? (plan.update.axis_input_vector ? "axis_vector_vector" : "axis_vector_scalar") : (plan.update.record_mode ? "record" : "scalar")
    );
    runtime_surface["state_binding"] = vf::JsonValue(0.0);
    runtime_surface["input_binding"] = vf::JsonValue(1.0);
    vf::JsonValue::Array binding_exports;
    for (const auto& binding : plan.bindings) {
        vf::JsonValue::Object item;
        item["name"] = vf::JsonValue(binding.name);
        if (binding.kind == Binding::Kind::I32Array) {
            item["kind"] = vf::JsonValue("axis_i32_array");
            item["axis_key"] = vf::JsonValue(binding.axis_key);
            vf::JsonValue::Array values;
            for (std::int32_t value : binding.i32_array_values) {
                values.push_back(vf::JsonValue(static_cast<double>(value)));
            }
            item["values"] = vf::JsonValue(std::move(values));
        } else if (binding.kind == Binding::Kind::F64Array) {
            item["kind"] = vf::JsonValue("axis_f64_array");
            item["axis_key"] = vf::JsonValue(binding.axis_key);
            vf::JsonValue::Array values;
            for (double value : binding.f64_array_values) {
                values.push_back(vf::JsonValue(value));
            }
            item["values"] = vf::JsonValue(std::move(values));
        } else if (binding.kind == Binding::Kind::F64) {
            item["kind"] = vf::JsonValue("f64_const");
            item["value"] = vf::JsonValue(binding.f64_value);
        } else {
            item["kind"] = vf::JsonValue("i32_const");
            item["value"] = vf::JsonValue(static_cast<double>(binding.i32_value));
        }
        binding_exports.push_back(vf::JsonValue(std::move(item)));
    }
    runtime_surface["bindings"] = vf::JsonValue(std::move(binding_exports));
    if (plan.update.axis_vector_mode) {
        runtime_surface["state_axis_key"] = vf::JsonValue(plan.update.axis_key);
        runtime_surface["state_axis_length"] = vf::JsonValue(static_cast<double>(plan.update.axis_vector_length));
        runtime_surface["input_axis_key"] = vf::JsonValue(plan.update.axis_input_vector ? plan.update.axis_key : "");
        runtime_surface["input_axis_length"] = vf::JsonValue(static_cast<double>(plan.update.axis_input_vector ? plan.update.axis_vector_length : 1));
        vf::JsonValue::Array state_fields;
        vf::JsonValue::Object state_field;
        state_field["name"] = vf::JsonValue("values");
        state_field["offset"] = vf::JsonValue(0.0);
        state_field["type"] = vf::JsonValue(
            plan.update.axis_float_mode
                ? ("axis<" + plan.update.axis_key + ">:list<f32>")
                : ("axis<" + plan.update.axis_key + ">:list<num>")
        );
        state_field["axis_key"] = vf::JsonValue(plan.update.axis_key);
        state_field["axis_length"] = vf::JsonValue(static_cast<double>(plan.update.axis_vector_length));
        if (plan.update.axis_float_mode) {
            state_field["storage"] = vf::JsonValue("f32");
        }
        state_fields.push_back(vf::JsonValue(std::move(state_field)));
        runtime_surface["state_fields"] = vf::JsonValue(std::move(state_fields));
        vf::JsonValue::Array input_fields;
        vf::JsonValue::Object input_field;
        input_field["name"] = vf::JsonValue(plan.update.axis_input_vector ? "values" : "value");
        input_field["offset"] = vf::JsonValue(0.0);
        input_field["type"] = vf::JsonValue(
            plan.update.axis_input_vector
                ? (plan.update.axis_float_mode
                    ? ("axis<" + plan.update.axis_key + ">:list<f32>")
                    : ("axis<" + plan.update.axis_key + ">:list<num>"))
                : (plan.update.axis_float_mode ? "f32" : "num")
        );
        if (plan.update.axis_input_vector) {
            input_field["axis_key"] = vf::JsonValue(plan.update.axis_key);
            input_field["axis_length"] = vf::JsonValue(static_cast<double>(plan.update.axis_vector_length));
        }
        if (plan.update.axis_float_mode) {
            input_field["storage"] = vf::JsonValue("f32");
        }
        input_fields.push_back(vf::JsonValue(std::move(input_field)));
        runtime_surface["input_fields"] = vf::JsonValue(std::move(input_fields));
    } else if (plan.update.record_mode) {
        vf::JsonValue::Array state_fields;
        for (const auto& field_info : plan.update.state_fields) {
            vf::JsonValue::Object field_desc;
            field_desc["name"] = vf::JsonValue(field_info.name);
            field_desc["offset"] = vf::JsonValue(static_cast<double>(field_info.offset));
            field_desc["type"] = vf::JsonValue(field_info.type);
            if (is_float_field(field_info)) {
                field_desc["storage"] = vf::JsonValue("f32");
            }
            if (!field_info.axis_key.empty()) {
                field_desc["axis_key"] = vf::JsonValue(field_info.axis_key);
                field_desc["axis_length"] = vf::JsonValue(static_cast<double>(field_info.axis_length));
            }
            state_fields.push_back(vf::JsonValue(std::move(field_desc)));
        }
        vf::JsonValue::Array input_fields;
        for (const auto& field_info : plan.update.input_fields) {
            vf::JsonValue::Object field_desc;
            field_desc["name"] = vf::JsonValue(field_info.name);
            field_desc["offset"] = vf::JsonValue(static_cast<double>(field_info.offset));
            field_desc["type"] = vf::JsonValue(field_info.type);
            if (is_float_field(field_info)) {
                field_desc["storage"] = vf::JsonValue("f32");
            }
            if (!field_info.axis_key.empty()) {
                field_desc["axis_key"] = vf::JsonValue(field_info.axis_key);
                field_desc["axis_length"] = vf::JsonValue(static_cast<double>(field_info.axis_length));
            }
            input_fields.push_back(vf::JsonValue(std::move(field_desc)));
        }
        runtime_surface["state_fields"] = vf::JsonValue(std::move(state_fields));
        runtime_surface["input_fields"] = vf::JsonValue(std::move(input_fields));
    } else {
        vf::JsonValue::Array state_fields;
        vf::JsonValue::Object state_value;
        state_value["name"] = vf::JsonValue("value");
        state_value["offset"] = vf::JsonValue(0.0);
        state_value["type"] = vf::JsonValue(plan.update.scalar_float_mode ? "f32" : "num");
        if (plan.update.scalar_float_mode) {
            state_value["storage"] = vf::JsonValue("f32");
        }
        state_fields.push_back(vf::JsonValue(std::move(state_value)));
        vf::JsonValue::Array input_fields;
        vf::JsonValue::Object input_value;
        input_value["name"] = vf::JsonValue("value");
        input_value["offset"] = vf::JsonValue(0.0);
        input_value["type"] = vf::JsonValue(plan.update.scalar_float_mode ? "f32" : "num");
        if (plan.update.scalar_float_mode) {
            input_value["storage"] = vf::JsonValue("f32");
        }
        input_fields.push_back(vf::JsonValue(std::move(input_value)));
        runtime_surface["state_fields"] = vf::JsonValue(std::move(state_fields));
        runtime_surface["input_fields"] = vf::JsonValue(std::move(input_fields));
    }
    manifest["runtime_surface"] = vf::JsonValue(std::move(runtime_surface));
    return manifest;
}

std::string manifest_key(
    const std::string& source_hash,
    const std::string& typed_ir_hash,
    const std::string& artifact_hash,
    const std::vector<Dependency>& dependencies,
    const std::filesystem::path& artifact_path
) {
    std::string out = std::string(compiler_version) + "\n" + source_hash + "\n" + typed_ir_hash + "\n"
        + artifact_hash + "\n" + artifact_path.string();
    for (const auto& dependency : dependencies) {
        out += "\n" + dependency.name + "\n" + std::filesystem::absolute(dependency.path).string() + "\n" + dependency.hash;
    }
    return out;
}

std::string existing_manifest_hash(const std::filesystem::path& manifest_path) {
    if (!std::filesystem::exists(manifest_path)) {
        return "";
    }
    try {
        const auto manifest = object_of(vf::parse_json(read_file(manifest_path)), "manifest");
        const auto found = manifest.find("manifest_hash");
        if (found == manifest.end() || !found->second.is_string()) {
            return "";
        }
        return found->second.as_string();
    } catch (const std::exception&) {
        return "";
    }
}

struct Args {
    std::filesystem::path source;
    std::filesystem::path typed_ir;
    std::vector<std::pair<std::string, std::filesystem::path>> dependencies;
};

Args parse_args(int argc, char** argv) {
    Args args;
    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        if (arg == "--source" && i + 1 < argc) {
            args.source = argv[++i];
            continue;
        }
        if (arg == "--typed-ir" && i + 1 < argc) {
            args.typed_ir = argv[++i];
            continue;
        }
        if (arg == "--dependency" && i + 1 < argc) {
            const std::string spec = argv[++i];
            const std::size_t eq = spec.find('=');
            if (eq == std::string::npos || eq == 0 || eq + 1 >= spec.size()) {
                throw WebGpuArtifactFailure("dependency must be name=path");
            }
            args.dependencies.push_back({spec.substr(0, eq), spec.substr(eq + 1)});
            continue;
        }
        throw WebGpuArtifactFailure("usage: vkf_webgpu_artifact_smoke --source <file.vkf> --typed-ir <file.json>");
    }
    if (args.source.empty() || args.typed_ir.empty()) {
        throw WebGpuArtifactFailure("usage: vkf_webgpu_artifact_smoke --source <file.vkf> --typed-ir <file.json>");
    }
    return args;
}

}  // namespace

int main(int argc, char** argv) {
    try {
        const Args args = parse_args(argc, argv);
        const std::string source_text = read_file(args.source);
        const std::string typed_ir_text = read_file(args.typed_ir);
        const vf::JsonValue typed_ir = vf::parse_json(typed_ir_text);
        ModulePlan plan = collect_module_plan(typed_ir);
        if (plan.retained_scene_render) {
            const auto lowered = plan.typed_retained_scene_render
                ? vkf::native_scene::lower_typed_retained_scene(
                    typed_ir, source_text, args.source)
                : vkf::native_scene::lower_source(source_text, args.source);
            if (!lowered.has_value()) {
                throw WebGpuArtifactFailure(
                    "retained scene has no compiler-owned render packet");
            }
            collect_retained_scene_features(
                lowered->root, plan.retained_scene);
            collect_retained_scene_entities(
                lowered->root, plan.retained_scene,
                plan.typed_retained_scene_render);
            for (const auto& raw_section :
                 lowered->render_parameters.sections) {
                if (!raw_section.is_object()) continue;
                const auto& section = raw_section.as_object();
                const auto name = section.find("name");
                const auto byte_offset = section.find("byte_offset");
                const auto stride = section.find("stride");
                if (name == section.end() || !name->second.is_string() ||
                    name->second.as_string() != "lights" ||
                    byte_offset == section.end() ||
                    !byte_offset->second.is_number() ||
                    stride == section.end() || !stride->second.is_number()) {
                    continue;
                }
                const auto read_light_f32 = [&](std::uint32_t light_index,
                                                std::uint32_t field_offset) {
                    const std::size_t offset = static_cast<std::size_t>(
                        byte_offset->second.as_number()) +
                        static_cast<std::size_t>(light_index) *
                            static_cast<std::size_t>(stride->second.as_number()) +
                        field_offset;
                    if (offset + sizeof(float) >
                        lowered->render_parameters.arena_bytes.size()) {
                        throw WebGpuArtifactFailure(
                            "retained light record is outside its parameter arena");
                    }
                    float value = 0.0f;
                    std::memcpy(&value,
                        lowered->render_parameters.arena_bytes.data() + offset,
                        sizeof(value));
                    return value;
                };
                for (auto& light : plan.retained_scene.lights) {
                    const auto packed_kind = static_cast<std::uint32_t>(
                        std::lround(read_light_f32(light.light_index, 52u)));
                    if (light.source_object_index.has_value() &&
                        packed_kind != light.kind_code) {
                        throw WebGpuArtifactFailure(
                            "geometry emitter light kind disagrees with its packed record");
                    }
                    if (light.derived_emitter_view) {
                        const auto packed_source = static_cast<std::uint32_t>(
                            std::lround(read_light_f32(
                                light.light_index, 60u)));
                        const auto packed_surface = static_cast<std::uint32_t>(
                            std::lround(read_light_f32(
                                light.light_index, 64u)));
                        if (!light.source_light_index.has_value() ||
                            !light.reflect_surface_object_index.has_value() ||
                            packed_source != *light.source_light_index ||
                            packed_surface !=
                                *light.reflect_surface_object_index) {
                            throw WebGpuArtifactFailure(
                                "reflected emitter view disagrees with its packed source or aperture");
                        }
                    }
                    light.casts_shadow =
                        read_light_f32(light.light_index, 56u) > 0.5f;
                }
                break;
            }
            for (const auto& raw_section :
                 lowered->render_parameters.sections) {
                if (!raw_section.is_object()) continue;
                const auto& section = raw_section.as_object();
                const auto name = section.find("name");
                const auto entries = section.find("entries");
                if (name == section.end() || !name->second.is_string() ||
                    name->second.as_string() != "objects" ||
                    entries == section.end() || !entries->second.is_array()) {
                    continue;
                }
                for (auto& surface :
                     plan.retained_scene.reflective_surfaces) {
                    if (surface.object_index >=
                        entries->second.as_array().size()) continue;
                    const auto& entry_value = entries->second.as_array()[
                        surface.object_index];
                    if (!entry_value.is_object()) continue;
                    const auto aperture = entry_value.as_object().find(
                        "mirror_aperture");
                    if (aperture == entry_value.as_object().end() ||
                        !aperture->second.is_object()) continue;
                    const auto& descriptor = aperture->second.as_object();
                    const auto numeric = [&descriptor](
                        const std::string& key,
                        std::uint32_t fallback) {
                        const auto found = descriptor.find(key);
                        return found != descriptor.end() &&
                            found->second.is_number()
                            ? static_cast<std::uint32_t>(
                                found->second.as_number())
                            : fallback;
                    };
                    surface.aperture_byte_offset = numeric(
                        "byte_offset", 0);
                    surface.aperture_vertex_count = numeric(
                        "vertex_count", 0);
                    surface.aperture_vertex_stride = numeric(
                        "vertex_stride", 40);
                    surface.aperture_position_offset = numeric(
                        "position_offset", 0);
                }
            }
        }
        const std::string wgsl = emit_wgsl(plan);

        const std::string source_hash = stable_hash(source_text);
        const std::string typed_ir_hash = stable_hash(typed_ir_text);
        const std::string artifact_hash = stable_hash(wgsl);
        std::vector<Dependency> dependencies;
        for (const auto& dependency : args.dependencies) {
            dependencies.push_back({dependency.first, dependency.second, stable_hash(read_file(dependency.second))});
        }

        const std::string artifact_stem = artifact_stem_of(args.source);
        const auto build_dir = repo_root_from_source(args.source) / ".vkfbuild" / artifact_stem;
        const auto manifest_path = build_dir / "webgpu-manifest.json";
        const auto artifact_path = build_dir / (artifact_stem + ".wgsl");
        const std::string desired_manifest_hash = stable_hash(
            manifest_key(source_hash, typed_ir_hash, artifact_hash, dependencies, artifact_path)
        );

        std::filesystem::create_directories(build_dir);
        std::string status = "compiled";
        const bool artifact_current = std::filesystem::exists(artifact_path)
            && stable_hash(read_file(artifact_path)) == artifact_hash;
        if (existing_manifest_hash(manifest_path) == desired_manifest_hash && artifact_current) {
            status = "current";
        } else {
            write_text(artifact_path, wgsl);
        }

        auto manifest = manifest_payload(
            args.source,
            source_hash,
            typed_ir_hash,
            artifact_hash,
            dependencies,
            artifact_path,
            status,
            plan
        );
        manifest["manifest_hash"] = vf::JsonValue(desired_manifest_hash);
        write_text(manifest_path, vf::json_stringify(vf::JsonValue(std::move(manifest)), 2) + "\n");

        vf::JsonValue::Object result;
        result["artifact_kind"] = vf::JsonValue("webgpu-wgsl");
        result["artifact_path"] = vf::JsonValue(artifact_path.string());
        result["manifest_path"] = vf::JsonValue(manifest_path.string());
        result["status"] = vf::JsonValue(status);
        std::cout << vf::json_stringify(vf::JsonValue(std::move(result)), -1) << "\n";
        return 0;
    } catch (const std::exception& exc) {
        std::cerr << "<webgpu-artifact-smoke>:1:1: " << exc.what() << "\n";
        return 1;
    }
}
