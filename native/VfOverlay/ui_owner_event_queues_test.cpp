#include "vf/ui_runtime_contract.hpp"

#include <iostream>
#include <optional>
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

}  // namespace

int main() {
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
