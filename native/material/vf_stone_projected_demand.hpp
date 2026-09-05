#pragma once

#include "native/material/vf_stone_refinement_batch.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <map>
#include <set>
#include <stdexcept>
#include <utility>
#include <vector>

namespace vf::material {

using StonePoint3 = std::array<double, 3>;
using StonePoint2 = std::array<double, 2>;
using StoneTriangle = std::array<std::uint32_t, 3>;

struct StoneViewCamera {
    StonePoint3 eye;
    StonePoint3 target;
    StonePoint3 up;
    double vertical_fov_radians;
    double viewport_height;
};

struct StoneProjectedCandidate {
    StoneTriangle face;
    bool silhouette;
    double silhouette_error_pixels;
    double projected_error_pixels;
    double error_bound_pixels;
    std::size_t face_rank;
};

struct StoneProjectedDemand {
    std::vector<StoneTriangle> demands;
    std::vector<StoneProjectedCandidate> candidates;
    std::vector<StoneTriangle> culled;
};

inline StonePoint3 StoneSubtract(
    const StonePoint3& first,
    const StonePoint3& second
) {
    return {
        first[0] - second[0],
        first[1] - second[1],
        first[2] - second[2],
    };
}

inline double StoneDot(
    const StonePoint3& first,
    const StonePoint3& second
) {
    return first[0] * second[0] +
        first[1] * second[1] +
        first[2] * second[2];
}

inline StonePoint3 StoneCross(
    const StonePoint3& first,
    const StonePoint3& second
) {
    return {
        first[1] * second[2] - first[2] * second[1],
        first[2] * second[0] - first[0] * second[2],
        first[0] * second[1] - first[1] * second[0],
    };
}

inline StonePoint3 StoneNormalize(const StonePoint3& point) {
    const double length = std::sqrt(StoneDot(point, point));
    if (!(length > 1.0e-12)) {
        throw std::invalid_argument("stone camera basis is degenerate");
    }
    return {point[0] / length, point[1] / length, point[2] / length};
}

inline StonePoint3 StonePosition(
    const StoneCoarseShape& shape,
    std::uint32_t vertex
) {
    if (vertex >= shape.positions.size()) {
        throw std::invalid_argument("stone triangle index is invalid");
    }
    const auto& point = shape.positions[vertex];
    return {point[0], point[1], point[2]};
}

inline std::size_t StoneCoarseFaceRank(StoneTriangle face) {
    face = CanonicalStoneFace(face);
    static constexpr std::array<StoneTriangle, 8> faces{
        StoneTriangle{0, 2, 4},
        StoneTriangle{1, 4, 2},
        StoneTriangle{1, 3, 4},
        StoneTriangle{0, 4, 3},
        StoneTriangle{0, 5, 2},
        StoneTriangle{1, 2, 5},
        StoneTriangle{1, 5, 3},
        StoneTriangle{0, 3, 5},
    };
    for (std::size_t rank = 0; rank < faces.size(); ++rank) {
        if (CanonicalStoneFace(faces[rank]) == face) return rank;
    }
    throw std::invalid_argument("stone projected face is not coarse");
}

inline std::size_t StoneCoarseFaceLexRank(const StoneTriangle& face) {
    static constexpr std::array<std::size_t, 8> lexical_order{
        0, 4, 3, 7, 1, 5, 2, 6,
    };
    const std::size_t canonical_rank = StoneCoarseFaceRank(face);
    const auto found = std::find(
        lexical_order.begin(),
        lexical_order.end(),
        canonical_rank
    );
    return static_cast<std::size_t>(found - lexical_order.begin());
}

inline StonePoint2 StoneProject(
    const StonePoint3& point,
    const StoneViewCamera& camera,
    const StonePoint3& forward,
    const StonePoint3& right,
    const StonePoint3& up,
    double focal_pixels
) {
    const auto relative = StoneSubtract(point, camera.eye);
    const double depth = StoneDot(relative, forward);
    return {
        focal_pixels * StoneDot(relative, right) / depth,
        focal_pixels * StoneDot(relative, up) / depth,
    };
}

inline StoneProjectedDemand SelectStoneProjectedDemandReference(
    const StoneCoarseShape& shape,
    const StoneViewCamera& camera,
    double max_error_pixels,
    std::size_t face_budget
) {
    constexpr std::size_t maximum_budget = 64;
    constexpr double facing_epsilon = 1.0e-12;
    if (face_budget > maximum_budget) {
        throw std::range_error("stone projected face budget exceeds 64");
    }
    if (!std::isfinite(max_error_pixels) || max_error_pixels < 0.0) {
        throw std::invalid_argument("stone projected error is invalid");
    }
    for (const auto& vector : {camera.eye, camera.target, camera.up}) {
        for (const double value : vector) {
            if (!std::isfinite(value)) {
                throw std::invalid_argument("stone camera is not finite");
            }
        }
    }
    const double pi = std::acos(-1.0);
    if (
        !std::isfinite(camera.vertical_fov_radians) ||
        camera.vertical_fov_radians <= 0.0 ||
        camera.vertical_fov_radians >= pi ||
        !std::isfinite(camera.viewport_height) ||
        camera.viewport_height <= 0.0
    ) {
        throw std::invalid_argument("stone camera projection is invalid");
    }
    const auto forward = StoneNormalize(
        StoneSubtract(camera.target, camera.eye)
    );
    const auto right = StoneNormalize(StoneCross(forward, camera.up));
    const auto up = StoneCross(right, forward);
    const double focal_pixels = camera.viewport_height /
        (2.0 * std::tan(camera.vertical_fov_radians / 2.0));

    const double center_depth = StoneDot(
        {-camera.eye[0], -camera.eye[1], -camera.eye[2]},
        forward
    );
    double depth_sum = 0.0;
    double horizontal_sum = 0.0;
    double maximum_radius = 0.0;
    for (std::size_t axis = 0; axis < 3; ++axis) {
        const double radius = shape.radii[axis];
        depth_sum += std::pow(radius * forward[axis], 2.0);
        horizontal_sum += std::pow(radius * right[axis], 2.0);
        maximum_radius = std::max(maximum_radius, radius);
    }
    const double support_depth = std::sqrt(depth_sum);
    const double support_horizontal = std::sqrt(horizontal_sum);
    const double minimum_depth = center_depth - support_depth;
    if (!(minimum_depth > 0.0)) {
        throw std::invalid_argument(
            "stone must be wholly in front of camera"
        );
    }

    struct FaceState {
        StoneTriangle face;
        std::size_t rank;
        bool visible;
    };
    std::vector<FaceState> states;
    std::set<std::size_t> ranks;
    for (const auto& face : shape.triangles) {
        const auto first = StonePosition(shape, face[0]);
        const auto second = StonePosition(shape, face[1]);
        const auto third = StonePosition(shape, face[2]);
        const auto normal = StoneCross(
            StoneSubtract(second, first),
            StoneSubtract(third, first)
        );
        StonePoint3 centroid{};
        for (std::size_t axis = 0; axis < 3; ++axis) {
            centroid[axis] =
                (first[axis] + second[axis] + third[axis]) / 3.0;
        }
        const double facing = StoneDot(
            normal,
            StoneSubtract(camera.eye, centroid)
        );
        const std::size_t rank = StoneCoarseFaceRank(face);
        if (!ranks.insert(rank).second) {
            throw std::invalid_argument("stone projected face is duplicated");
        }
        states.push_back({face, rank, facing >= -facing_epsilon});
    }

    using Edge = std::pair<std::uint32_t, std::uint32_t>;
    std::map<Edge, std::vector<std::size_t>> faces_by_edge;
    for (std::size_t face = 0; face < states.size(); ++face) {
        for (std::size_t edge = 0; edge < 3; ++edge) {
            const auto values = std::minmax(
                states[face].face[edge],
                states[face].face[(edge + 1) % 3]
            );
            faces_by_edge[values].push_back(face);
        }
    }

    StoneProjectedDemand selection;
    for (std::size_t face_index = 0;
         face_index < states.size(); ++face_index) {
        const auto& state = states[face_index];
        if (!state.visible) {
            selection.culled.push_back(state.face);
            continue;
        }
        double silhouette_error = 0.0;
        double projected_error = 0.0;
        double error_bound = 0.0;
        bool silhouette = false;
        for (std::size_t edge = 0; edge < 3; ++edge) {
            const std::uint32_t first_index = state.face[edge];
            const std::uint32_t second_index =
                state.face[(edge + 1) % 3];
            const auto first = StonePosition(shape, first_index);
            const auto second = StonePosition(shape, second_index);
            StonePoint3 average{};
            double ellipsoid_sum = 0.0;
            double unit_dot = 0.0;
            for (std::size_t axis = 0; axis < 3; ++axis) {
                average[axis] = (first[axis] + second[axis]) / 2.0;
                ellipsoid_sum += std::pow(
                    average[axis] / shape.radii[axis],
                    2.0
                );
                unit_dot += first[axis] / shape.radii[axis] *
                    second[axis] / shape.radii[axis];
            }
            const double ellipsoid_length = std::sqrt(ellipsoid_sum);
            StonePoint3 midpoint{};
            for (std::size_t axis = 0; axis < 3; ++axis) {
                midpoint[axis] = average[axis] / ellipsoid_length;
            }
            const auto first_projected = StoneProject(
                first, camera, forward, right, up, focal_pixels);
            const auto second_projected = StoneProject(
                second, camera, forward, right, up, focal_pixels);
            const auto midpoint_projected = StoneProject(
                midpoint, camera, forward, right, up, focal_pixels);
            const double error = std::hypot(
                midpoint_projected[0] -
                    (first_projected[0] + second_projected[0]) / 2.0,
                midpoint_projected[1] -
                    (first_projected[1] + second_projected[1]) / 2.0
            );
            projected_error = std::max(projected_error, error);
            const double angle = std::acos(
                std::clamp(unit_dot, -1.0, 1.0)
            );
            const double world_deviation = maximum_radius *
                (1.0 - std::cos(angle / 2.0));
            const double bound = focal_pixels * world_deviation *
                (1.0 / minimum_depth +
                 support_horizontal / std::pow(minimum_depth, 2.0));
            error_bound = std::max(error_bound, bound);
            const auto incident = faces_by_edge.at(
                std::minmax(first_index, second_index)
            );
            const bool edge_silhouette = std::any_of(
                incident.begin(),
                incident.end(),
                [&states](std::size_t adjacent) {
                    return !states[adjacent].visible;
                }
            );
            if (edge_silhouette) {
                silhouette = true;
                silhouette_error = std::max(silhouette_error, error);
            }
        }
        if (error_bound > max_error_pixels) {
            selection.candidates.push_back({
                state.face,
                silhouette,
                silhouette_error,
                projected_error,
                error_bound,
                state.rank,
            });
        }
    }
    std::sort(
        selection.candidates.begin(),
        selection.candidates.end(),
        [](const auto& first, const auto& second) {
            if (first.silhouette != second.silhouette) {
                return first.silhouette > second.silhouette;
            }
            if (first.silhouette_error_pixels !=
                second.silhouette_error_pixels) {
                return first.silhouette_error_pixels >
                    second.silhouette_error_pixels;
            }
            if (first.projected_error_pixels !=
                second.projected_error_pixels) {
                return first.projected_error_pixels >
                    second.projected_error_pixels;
            }
            if (first.error_bound_pixels != second.error_bound_pixels) {
                return first.error_bound_pixels > second.error_bound_pixels;
            }
            return StoneCoarseFaceLexRank(first.face) <
                StoneCoarseFaceLexRank(second.face);
        }
    );
    std::sort(
        selection.culled.begin(),
        selection.culled.end(),
        [](const auto& first, const auto& second) {
            return StoneCoarseFaceRank(first) < StoneCoarseFaceRank(second);
        }
    );
    const std::size_t selected = std::min(
        face_budget,
        selection.candidates.size()
    );
    selection.demands.reserve(selected);
    for (std::size_t index = 0; index < selected; ++index) {
        selection.demands.push_back(selection.candidates[index].face);
    }
    return selection;
}

}  // namespace vf::material
