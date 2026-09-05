#include "compiler/native/vkf_compiled_geometry_packet.hpp"
#include <iostream>
#include <iterator>

int main() {
    try {
        const std::string input{std::istreambuf_iterator<char>(std::cin), {}};
        const auto request = vf::parse_json(input).as_object();
        auto result = request.count("scene")
            ? vkf::compiled_geometry::CurvePacket{vkf::native_scene::pack_scene_geometry(request.at("scene")), vf::JsonValue(nullptr)}
            : vkf::compiled_geometry::build_u_curve(request.at("properties").as_object(),
                request.at("width").as_number(), request.at("height").as_number());
        vf::JsonValue::Array bytes;
        for (auto byte : result.packed.arena_bytes) bytes.emplace_back(static_cast<double>(byte));
        std::cout << vf::json_stringify(vf::JsonValue(vf::JsonValue::Object{
            {"ok", vf::JsonValue(true)},
            {"metadata", vf::parse_json(result.packed.metadata_json)},
            {"arena", vf::JsonValue(std::move(bytes))},
            {"layout", std::move(result.layout)},
        }), -1);
    } catch (const std::exception& error) {
        std::cout << vf::json_stringify(vf::JsonValue(vf::JsonValue::Object{
            {"ok", vf::JsonValue(false)}, {"message", vf::JsonValue(error.what())},
        }), -1);
    }
}
