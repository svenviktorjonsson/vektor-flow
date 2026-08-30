#include "vf/ui_runtime_contract.hpp"

#include <iostream>
#include <optional>
#include <stdexcept>
#include <string>

namespace {

vf::UiRuntimePacket Packet(std::uint64_t sequence, double x, const char* frame_id = "frame-0") {
    return vf::ParseUiRuntimePacket(
        "{\"seq\":" + std::to_string(sequence) +
        ",\"kind\":\"input.event\",\"payload\":{\"event\":{"
        "\"event\":\"ButtonClicked\",\"widget_id\":\"button-0\",\"frame_id\":\"" +
        frame_id + "\",\"x\":" + std::to_string(x) + "}}}");
}

vf::JsonValue Summary(const std::optional<vf::InputEventPacketPayload>& event) {
    if (!event.has_value()) {
        return vf::JsonValue(nullptr);
    }
    vf::JsonValue::Object summary;
    summary.emplace("event", vf::GetInputEventName(*event));
    summary.emplace("widget_id", *vf::GetInputEventWidgetId(*event));
    summary.emplace("frame_id", *vf::GetInputEventFrameId(*event));
    summary.emplace("x", *vf::GetInputEventX(*event));
    return vf::JsonValue(std::move(summary));
}

vf::JsonValue::Array TakeXs(vf::InternalOwnerEventQueue& queue) {
    vf::JsonValue::Array values;
    values.emplace_back(*vf::GetInputEventX(*queue.Get()));
    values.emplace_back(*vf::GetInputEventX(*queue.Get()));
    return values;
}

vf::UiRuntimePacket GeometryPacket(std::uint64_t sequence, std::uint64_t layer_id) {
    return vf::ParseUiRuntimePacket(
        "{\"seq\":" + std::to_string(sequence) +
        ",\"kind\":\"input.event\",\"payload\":{\"event\":{"
        "\"event\":\"MouseButtonPressed\",\"target\":{\"layer_id\":" +
        std::to_string(layer_id) + ",\"type\":\"Face\",\"u\":2,\"v\":5}}}}");
}

void CheckGeometryPickQueues() {
    vf::InternalGeometryPickOwnerQueues queues(7, "frame-0", "display-0");
    bool rejected = false;
    try {
        queues.ConsumeRuntimePacket(GeometryPacket(1, 8));
    } catch (const std::exception&) {
        rejected = true;
    }
    if (!rejected || !queues.Frame().Empty() || !queues.Display().Empty()) {
        throw std::runtime_error("malformed geometry pick mutated owner queues");
    }
    queues.ConsumeRuntimePacket(GeometryPacket(1, 7));
    const auto frame = queues.Frame().Get();
    const auto display = queues.Display().Get();
    const std::string frame_target = frame.has_value()
        ? vf::json_stringify(vf::RequireInputEventField(*frame, "target"), -1)
        : "missing";
    const std::string display_target = display.has_value()
        ? vf::json_stringify(vf::RequireInputEventField(*display, "target"), -1)
        : "missing";
    const std::string expected =
        "{\"layer_id\":7, \"type\":\"Face\", \"u\":2, \"v\":5}";
    if (!frame.has_value() || !display.has_value() ||
        frame_target != expected || display_target != expected ||
        !queues.Frame().Empty() || !queues.Display().Empty()) {
        throw std::runtime_error(
            "geometry pick owner queues lost their public target: " +
            frame_target + " / " + display_target);
    }
}

void CheckRecursiveRetainedLookup() {
    vf::InternalRetainedOwnerLookup lookup({
        vf::InternalRetainedNode{
            std::string("frame"),
            "Frame",
            {
                vf::InternalRetainedNode{
                    std::string("panel"),
                    "Div",
                    {vf::InternalRetainedNode{std::string("save"), "Button", {}}}},
                vf::InternalRetainedNode{
                    std::string("view"),
                    "View",
                    {vf::InternalRetainedNode{std::uint64_t{7}, "Layer", {}}}},
            }},
    });
    const auto* frame = lookup.Get(std::string("frame"));
    const auto* save = lookup.Get(std::string("save"));
    const auto* layer = lookup.Get(std::uint64_t{7});
    if (frame == nullptr || save == nullptr || save->kind != "Button" ||
        layer == nullptr || layer->kind != "Layer" ||
        lookup.Get(std::string("missing")) != nullptr ||
        lookup.GetFrom(*frame, std::uint64_t{7}) != layer) {
        throw std::runtime_error("recursive retained owner lookup lost a descendant identity");
    }

    bool duplicate_rejected = false;
    try {
        vf::InternalRetainedOwnerLookup duplicate({
            vf::InternalRetainedNode{
                std::string("left"),
                "Div",
                {vf::InternalRetainedNode{std::string("save"), "Button", {}}}},
            vf::InternalRetainedNode{
                std::string("right"),
                "Div",
                {vf::InternalRetainedNode{std::string("save"), "Button", {}}}},
        });
        static_cast<void>(duplicate);
    } catch (const std::exception& error) {
        duplicate_rejected = std::string(error.what()) ==
            "duplicate retained descendant id `save`";
    }
    if (!duplicate_rejected) {
        throw std::runtime_error("duplicate retained descendant ids were not diagnosed");
    }
}

}  // namespace

int main() {
    try {
        CheckGeometryPickQueues();
        CheckRecursiveRetainedLookup();
    } catch (const std::exception& error) {
        std::cerr << error.what() << std::endl;
        return 1;
    }
    vf::InternalButtonClickedOwnerQueues fanout("button-0", "frame-0", "display-0");
    fanout.ConsumeRuntimePacket(Packet(1, 10));
    vf::JsonValue::Object fanout_observation;
    fanout_observation.emplace("button", Summary(fanout.Button().Get()));
    fanout_observation.emplace("buttonEmpty", Summary(fanout.Button().Get()));
    fanout_observation.emplace("frame", Summary(fanout.Frame().Get()));
    fanout_observation.emplace("frameEmpty", Summary(fanout.Frame().Get()));
    fanout_observation.emplace("display", Summary(fanout.Display().Get()));
    fanout_observation.emplace("displayEmpty", Summary(fanout.Display().Get()));

    vf::InternalButtonClickedOwnerQueues fifo("button-0", "frame-0", "display-0");
    fifo.ConsumeRuntimePacket(Packet(1, 10));
    fifo.ConsumeRuntimePacket(Packet(2, 20));
    vf::JsonValue::Object fifo_observation;
    fifo_observation.emplace("button", TakeXs(fifo.Button()));
    fifo_observation.emplace("frame", TakeXs(fifo.Frame()));
    fifo_observation.emplace("display", TakeXs(fifo.Display()));

    vf::InternalButtonClickedOwnerQueues malformed("button-0", "frame-0", "display-0");
    bool rejected = false;
    try {
        malformed.ConsumeRuntimePacket(Packet(1, 10, "other-frame"));
    } catch (const std::exception&) {
        rejected = true;
    }
    vf::JsonValue::Object malformed_observation;
    malformed_observation.emplace("rejected", rejected);
    malformed_observation.emplace("buttonEmpty", Summary(malformed.Button().Get()));
    malformed_observation.emplace("frameEmpty", Summary(malformed.Frame().Get()));
    malformed_observation.emplace("displayEmpty", Summary(malformed.Display().Get()));

    vf::JsonValue::Object root;
    root.emplace("fanout", std::move(fanout_observation));
    root.emplace("fifo", std::move(fifo_observation));
    root.emplace("malformed", std::move(malformed_observation));
    std::cout << vf::json_stringify(vf::JsonValue(std::move(root)), 0) << std::endl;
    return 0;
}
