#pragma once

#include <string_view>

namespace vkf::ui_package {

inline constexpr std::string_view bundle_header = "VKF_SCENE_BUNDLE_V1\n";
inline constexpr std::string_view bundle_footer = "VKF_SCENE_BUNDLE_END_V1";

inline bool has_bundle_footer(std::string_view bytes) {
    return bytes.size() >= bundle_footer.size() &&
        bytes.substr(bytes.size() - bundle_footer.size()) == bundle_footer;
}

}  // namespace vkf::ui_package
