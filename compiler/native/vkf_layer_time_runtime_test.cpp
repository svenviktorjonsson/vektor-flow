#include "compiler/native/vkf_retained_scene_packet.hpp"

#include <cassert>
#include <cmath>
#include <functional>
#include <string>
#include <vector>

namespace {

using vkf::retained_scene::detail::LayerTimeMode;
using vkf::retained_scene::detail::LayerTimeDirtyRange;
using vkf::retained_scene::detail::LayerTimeEvaluator;
using vkf::retained_scene::detail::LayerTimeSampler;

void expect_near(double actual, double expected) {
    assert(std::abs(actual - expected) < 1e-12);
}

void expect_error(const std::function<void()>& action, const std::string& fragment) {
    try {
        action();
        assert(false && "expected retained scene error");
    } catch (const vkf::retained_scene::Error& error) {
        assert(std::string(error.what()).find(fragment) != std::string::npos);
    }
}

void repeat_keeps_the_final_sample_then_closes_the_cycle() {
    const LayerTimeSampler sampler({2.0, 4.0, 7.0}, LayerTimeMode::Repeat);

    const auto first = sampler.sample(0.0);
    assert(first.lower_index == 0);
    assert(first.upper_index == 1);
    expect_near(first.alpha, 0.0);
    assert(first.running);
    assert(first.direction == 1);

    const auto middle = sampler.sample(2.0);
    assert(middle.lower_index == 1);
    assert(middle.upper_index == 2);
    expect_near(middle.alpha, 0.0);
    assert(middle.running);
    assert(middle.direction == 1);

    const auto before_end = sampler.sample(4.5);
    expect_near(before_end.axis_position, 6.5);

    const auto final = sampler.sample(5.0);
    assert(final.lower_index == 2);
    assert(final.upper_index == 0);
    expect_near(final.alpha, 0.0);
    expect_near(final.axis_position, 7.0);

    const auto closing = sampler.sample(6.5);
    assert(closing.lower_index == 2);
    assert(closing.upper_index == 0);
    expect_near(closing.alpha, 0.5);

    const auto wrapped = sampler.sample(8.0);
    assert(wrapped.lower_index == 0);
    assert(wrapped.upper_index == 1);
    expect_near(wrapped.alpha, 0.0);
    assert(wrapped.running);
    assert(wrapped.direction == 1);

    const auto after_end = sampler.sample(8.5);
    expect_near(after_end.axis_position, 2.5);
    assert(after_end.running);
}

void repeat_zero_through_359_has_360_distinct_samples() {
    std::vector<double> coordinates;
    for (int degree = 0; degree < 360; ++degree) {
        coordinates.push_back(static_cast<double>(degree));
    }
    const LayerTimeSampler sampler(std::move(coordinates), LayerTimeMode::Repeat);
    const auto last = sampler.sample(359.0);
    assert(last.lower_index == 359);
    assert(last.upper_index == 0);
    expect_near(last.alpha, 0.0);
    expect_near(last.axis_position, 359.0);
    const auto wrapped = sampler.sample(360.0);
    assert(wrapped.lower_index == 0);
    assert(wrapped.upper_index == 1);
    expect_near(wrapped.alpha, 0.0);
    expect_near(wrapped.axis_position, 0.0);
}

void mirror_reverses_at_the_exact_end_and_keeps_running() {
    const LayerTimeSampler sampler({2.0, 4.0, 7.0}, LayerTimeMode::Mirror);

    const auto turn = sampler.sample(5.0);
    assert(turn.lower_index == 1);
    assert(turn.upper_index == 2);
    expect_near(turn.alpha, 1.0);
    assert(turn.running);
    assert(turn.direction == -1);

    const auto before_turn = sampler.sample(4.5);
    expect_near(before_turn.axis_position, 6.5);
    assert(before_turn.direction == 1);

    const auto after_turn = sampler.sample(5.5);
    expect_near(after_turn.axis_position, 6.5);
    assert(after_turn.direction == -1);

    const auto returning = sampler.sample(8.0);
    assert(returning.lower_index == 1);
    assert(returning.upper_index == 2);
    expect_near(returning.alpha, 0.0);
    assert(returning.running);
    assert(returning.direction == -1);

    const auto restarted = sampler.sample(10.0);
    assert(restarted.lower_index == 0);
    assert(restarted.upper_index == 1);
    expect_near(restarted.alpha, 0.0);
    assert(restarted.running);
    assert(restarted.direction == 1);
}

void stop_holds_the_last_sample_at_the_exact_end() {
    const LayerTimeSampler sampler({2.0, 4.0, 7.0}, LayerTimeMode::Stop);
    const auto before_end = sampler.sample(4.5);
    expect_near(before_end.axis_position, 6.5);
    assert(before_end.running);

    const auto stopped = sampler.sample(5.0);
    assert(stopped.lower_index == 1);
    assert(stopped.upper_index == 2);
    expect_near(stopped.alpha, 1.0);
    assert(!stopped.running);
    assert(stopped.direction == 0);

    const auto still_stopped = sampler.sample(50.0);
    expect_near(still_stopped.axis_position, 7.0);
    assert(!still_stopped.running);
}

void reset_jumps_to_the_first_sample_at_the_exact_end() {
    const LayerTimeSampler sampler({2.0, 4.0, 7.0}, LayerTimeMode::Reset);
    const auto before_end = sampler.sample(4.5);
    expect_near(before_end.axis_position, 6.5);
    assert(before_end.running);

    const auto reset = sampler.sample(5.0);
    assert(reset.lower_index == 0);
    assert(reset.upper_index == 1);
    expect_near(reset.alpha, 0.0);
    assert(!reset.running);
    assert(reset.direction == 0);

    const auto still_reset = sampler.sample(50.0);
    expect_near(still_reset.axis_position, 2.0);
    assert(!still_reset.running);
}

void numeric_channels_sample_only_the_current_values_and_preserve_other_dirty_state() {
    const auto operation = vf::parse_json(R"json({
        "layer_axes":["t"],
        "channels":[
            {"name":"p","semantic_axes":["t","c"],"shape":[3,2],"value_kind":"position","value":[[0,0],[10,20],[40,50]]},
            {"name":"c","semantic_axes":["t","c"],"shape":[3,4],"value_kind":"rgba","value":[[0,0.2,0.4,1],[1,0.8,0.6,1],[0.5,0.5,0.5,1]]},
            {"name":"s","semantic_axes":["t"],"shape":[3],"value_kind":"size","measure_space":"data","value":[2,4,8]}
        ],
        "time":{"axis":"t","coordinates":[2,4,7],"mode":"repeat"}
    })json").as_object();
    const auto evaluator = LayerTimeEvaluator::from_operation(operation);
    const std::vector<LayerTimeDirtyRange> existing{{"material", 9, 2}};
    const auto result = evaluator.evaluate(1.0, existing);

    assert(result.dirty_ranges.size() == 4);
    assert(result.dirty_ranges[0].channel == "material");
    assert(result.dirty_ranges[0].first == 9);
    assert(result.dirty_ranges[0].count == 2);
    assert((result.dirty_ranges[1] == LayerTimeDirtyRange{"p", 0, 2}));
    assert((result.dirty_ranges[2] == LayerTimeDirtyRange{"c", 0, 4}));
    assert((result.dirty_ranges[3] == LayerTimeDirtyRange{"s", 0, 1}));
    assert(result.channels.at("p") == std::vector<double>({5.0, 10.0}));
    assert(result.channels.at("c") == std::vector<double>({0.5, 0.5, 0.5, 1.0}));
    assert(result.channels.at("s") == std::vector<double>({3.0}));
}

void layers_derive_independent_coordinates_from_their_own_bounds() {
    const auto short_operation = vf::parse_json(R"json({
        "layer_axes":["t"],
        "channels":[
            {"name":"p","semantic_axes":["t","c"],"value":[[0,0],[2,4],[4,8]]},
            {"name":"c","semantic_axes":["t","c"],"value":[[1,0,0,1],[0,1,0,1],[0,0,1,1]]},
            {"name":"s","semantic_axes":["t"],"value":[1,2,3]}
        ],
        "time":{"axis":"t","min":10,"max":14,"mode":"stop"}
    })json").as_object();
    const auto long_operation = vf::parse_json(R"json({
        "layer_axes":["t"],
        "channels":[
            {"name":"p","semantic_axes":["t","c"],"value":[[0,0],[3,6],[6,12],[9,18]]},
            {"name":"c","semantic_axes":["t","c"],"value":[[1,0,0,1],[1,0,0,1],[1,0,0,1],[1,0,0,1]]},
            {"name":"s","semantic_axes":["t"],"value":[1,1,1,1]}
        ],
        "time":{"axis":"t","min":20,"max":29,"mode":"repeat"}
    })json").as_object();

    const auto short_end = LayerTimeEvaluator::from_operation(short_operation).evaluate(4.0);
    assert(!short_end.time.running);
    expect_near(short_end.time.axis_position, 14.0);
    assert(short_end.channels.at("p") == std::vector<double>({4.0, 8.0}));

    const auto long_middle = LayerTimeEvaluator::from_operation(long_operation).evaluate(6.0);
    assert(long_middle.time.running);
    expect_near(long_middle.time.axis_position, 26.0);
    assert(long_middle.channels.at("p") == std::vector<double>({6.0, 12.0}));
}

void layer_time_rejects_non_increasing_coordinates_and_callable_position_data() {
    expect_error([] {
        (void)LayerTimeSampler({0.0, 0.0, 1.0}, LayerTimeMode::Repeat);
    }, "strictly increasing");

    const auto callable_position = vf::parse_json(R"json({
        "layer_axes":["t"],
        "channels":[
            {"name":"p","semantic_axes":["t","c"],"value":{"kind":"call","callee":{},"args":[]}},
            {"name":"c","semantic_axes":["t","c"],"value":[[1,0,0,1],[1,0,0,1]]},
            {"name":"s","semantic_axes":["t"],"value":[1,1]}
        ],
        "time":{"axis":"t","coordinates":[0,1],"mode":"repeat"}
    })json").as_object();
    expect_error([&] {
        (void)LayerTimeEvaluator::from_operation(callable_position);
    }, "precomputed numeric t-axis data");
}

void temporal_frame_add_and_push_compile_without_a_world() {
    const auto root = vf::parse_json(R"json({
        "ui_program":{
            "schema":"vektor-flow/ui-program",
            "operations":[
                {"kind":"add_frame","parent_kind":"display","frame_id":0,"pos":[0,0],"size":[1,1]},
                {
                    "kind":"add","frame_id":0,"layer_id":7,
                    "properties":{},
                    "layer_axes":["t"],
                    "channels":[
                        {"name":"p","semantic_axes":["t","c"],"value":[[1,2],[5,6]]},
                        {"name":"c","semantic_axes":["t","c"],"value":[[1,0,0,1],[0,0,1,1]]},
                        {"name":"s","semantic_axes":["t"],"value":[0.25,0.5]}
                    ],
                    "time":{"axis":"t","coordinates":[0,2],"mode":"reset"}
                },
                {"kind":"push","frame_id":0}
            ]
        }
    })json");

    const auto packets = vkf::retained_scene::compile_packets(root);
    assert(packets.has_value());
    const auto& mesh = packets->as_array()[2].as_object().at("payload").as_object()
        .at("display").as_object().at("geom").as_object().at("frame_0").as_object()
        .at("meshes").as_array().front().as_object();
    assert(mesh.at("type").as_string() == "field_mesh");
    assert(mesh.at("topology").as_string() == "point-list");
    assert(mesh.at("id").as_string() == "layer_7");
    assert(mesh.at("layer_id").as_number() == 7.0);
    assert(mesh.at("vertices").as_array()[0].as_number() == 1.0);
    assert(mesh.at("vertices").as_array()[1].as_number() == 2.0);
    assert(mesh.at("vertex_size").as_number() == 0.25);
    const auto& runtime = mesh.at("_layer_time").as_object();
    assert(runtime.at("axis").as_string() == "t");
    assert(runtime.at("mode").as_string() == "reset");
    assert(runtime.at("coordinates").as_array().size() == 2);
}

}  // namespace

int main() {
    repeat_keeps_the_final_sample_then_closes_the_cycle();
    repeat_zero_through_359_has_360_distinct_samples();
    mirror_reverses_at_the_exact_end_and_keeps_running();
    stop_holds_the_last_sample_at_the_exact_end();
    reset_jumps_to_the_first_sample_at_the_exact_end();
    numeric_channels_sample_only_the_current_values_and_preserve_other_dirty_state();
    layers_derive_independent_coordinates_from_their_own_bounds();
    layer_time_rejects_non_increasing_coordinates_and_callable_position_data();
    temporal_frame_add_and_push_compile_without_a_world();
    return 0;
}
