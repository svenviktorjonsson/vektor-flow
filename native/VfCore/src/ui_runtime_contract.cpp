#include "vf/ui_runtime_contract.hpp"

#include <cmath>
#include <limits>
#include <stdexcept>

namespace vf {

namespace {

using JsonObject = JsonValue::Object;

const JsonValue* find_object_field(const JsonObject& object, std::string_view key) noexcept {
    const auto it = object.find(std::string(key));
    return it == object.end() ? nullptr : &it->second;
}

const JsonValue& require_object_field(const JsonValue::Object& object, const char* key) {
    const auto it = object.find(key);
    if (it == object.end()) {
        throw std::runtime_error(std::string("missing packet field: ") + key);
    }
    return it->second;
}

const JsonValue& require_object_field(const JsonObject& object, std::string_view key) {
    const JsonValue* value = find_object_field(object, key);
    if (value == nullptr) {
        throw std::runtime_error("missing object field: " + std::string(key));
    }
    return *value;
}

void require_allowed_keys(const JsonObject& object, std::initializer_list<const char*> allowed, const char* context) {
    for (const auto& entry : object) {
        bool ok = false;
        for (const char* key : allowed) {
            if (entry.first == key) {
                ok = true;
                break;
            }
        }
        if (!ok) {
            throw std::runtime_error(std::string("unexpected ") + context + " field: " + entry.first);
        }
    }
}

std::uint64_t require_uint64(const JsonValue& value, const char* field_name) {
    const double number = value.as_number();
    if (number < 0.0 || !std::isfinite(number) || std::floor(number) != number) {
        throw std::runtime_error(std::string("packet field must be a non-negative integer: ") + field_name);
    }
    return static_cast<std::uint64_t>(number);
}

void require_string_field_if_present(const JsonObject& object, const char* key) {
    const JsonValue* value = find_object_field(object, key);
    if (value != nullptr) {
        static_cast<void>(value->as_string());
    }
}

void require_number_field_if_present(const JsonObject& object, const char* key) {
    const JsonValue* value = find_object_field(object, key);
    if (value != nullptr) {
        const double number = value->as_number();
        if (!std::isfinite(number)) {
            throw std::runtime_error(std::string("input event field must be finite: ") + key);
        }
    }
}

void require_boolean_field_if_present(const JsonObject& object, const char* key) {
    const JsonValue* value = find_object_field(object, key);
    if (value != nullptr) {
        static_cast<void>(value->as_boolean());
    }
}

void validate_input_event_object(const JsonObject& event) {
    static_cast<void>(require_object_field(event, "event").as_string());

    for (const char* key : {"frame_id", "widget_id", "key", "code", "dock"}) {
        require_string_field_if_present(event, key);
    }

    for (const char* key : {
             "x",
             "y",
             "width",
             "height",
             "buttons",
             "delta",
             "delta_x",
             "delta_y",
             "pick_id",
             "pick_mask_representation",
             "pick_mask_carrier",
             "pick_mask_content",
             "pick_mask_exact",
             "object_id",
             "simplex_id",
             "button",
         }) {
        require_number_field_if_present(event, key);
    }

    for (const char* key : {"ctrl", "shift", "alt", "meta"}) {
        require_boolean_field_if_present(event, key);
    }
}

SceneReplacePacketPayload parse_scene_replace_payload(const JsonValue::Object& payload) {
    require_allowed_keys(payload, {"commands"}, "scene.replace payload");
    const JsonValue& commands = require_object_field(payload, "commands");
    return SceneReplacePacketPayload{commands.as_array()};
}

UiStateReplacePacketPayload parse_ui_state_replace_payload(const JsonValue::Object& payload) {
    require_allowed_keys(payload, {"state"}, "ui_state.replace payload");
    const JsonValue& state = require_object_field(payload, "state");
    return UiStateReplacePacketPayload{state.as_object()};
}

DisplayReplacePacketPayload parse_display_replace_payload(const JsonValue::Object& payload) {
    require_allowed_keys(payload, {"display"}, "display.replace payload");
    const JsonValue& display = require_object_field(payload, "display");
    return DisplayReplacePacketPayload{display.as_object()};
}

WidgetAppendTextPacketPayload parse_widget_append_text_payload(const JsonValue::Object& payload) {
    require_allowed_keys(
        payload,
        {"frame_id", "widget_id", "text", "append_seq"},
        "widget.append_text payload");
    WidgetAppendTextPacketPayload out;
    out.frame_id = require_object_field(payload, "frame_id").as_string();
    out.widget_id = require_object_field(payload, "widget_id").as_string();
    out.text = require_object_field(payload, "text").as_string();
    out.append_seq = require_uint64(require_object_field(payload, "append_seq"), "append_seq");
    return out;
}

InputEventPacketPayload parse_input_event_payload(const JsonValue::Object& payload) {
    require_allowed_keys(payload, {"event"}, "input.event payload");
    const JsonValue& event = require_object_field(payload, "event");
    const JsonObject& event_object = event.as_object();
    validate_input_event_object(event_object);
    return InputEventPacketPayload{event_object};
}

JsonValue packet_payload_to_json(const UiRuntimePacketPayload& payload) {
    return std::visit([](const auto& value) { return ToJsonValue(value); }, payload);
}

bool input_event_name_equals(const InputEventPacketPayload& payload, std::string_view event_name) {
    return GetInputEventName(payload) == event_name;
}

bool input_event_frame_equals(const InputEventPacketPayload& payload, std::string_view frame_id) {
    const std::optional<std::string> value = GetInputEventFrameId(payload);
    return value.has_value() && *value == frame_id;
}

bool input_event_widget_equals(const InputEventPacketPayload& payload, std::string_view widget_id) {
    const std::optional<std::string> value = GetInputEventWidgetId(payload);
    return value.has_value() && *value == widget_id;
}

bool widget_append_text_frame_equals(const WidgetAppendTextPacketPayload& payload, std::string_view frame_id) {
    return payload.frame_id == frame_id;
}

bool widget_append_text_widget_equals(const WidgetAppendTextPacketPayload& payload, std::string_view widget_id) {
    return payload.widget_id == widget_id;
}

template <typename Predicate>
std::vector<InputEventMatch> find_input_events_if(const std::vector<UiRuntimePacket>& packets, Predicate predicate) {
    std::vector<InputEventMatch> matches;
    for (const auto& packet : packets) {
        const auto* payload = AsInputEventPacketPayload(packet);
        if (payload != nullptr && predicate(*payload)) {
            matches.push_back(InputEventMatch{&packet, payload});
        }
    }
    return matches;
}

template <typename Predicate>
std::optional<InputEventMatch> find_latest_input_event_if(const std::vector<UiRuntimePacket>& packets, Predicate predicate) {
    for (auto it = packets.rbegin(); it != packets.rend(); ++it) {
        const auto* payload = AsInputEventPacketPayload(*it);
        if (payload != nullptr && predicate(*payload)) {
            return InputEventMatch{&*it, payload};
        }
    }
    return std::nullopt;
}

template <typename Predicate>
std::vector<WidgetAppendTextMatch> find_widget_append_text_packets_if(
    const std::vector<UiRuntimePacket>& packets,
    Predicate predicate) {
    std::vector<WidgetAppendTextMatch> matches;
    for (const auto& packet : packets) {
        const auto* payload = AsWidgetAppendTextPacketPayload(packet);
        if (payload != nullptr && predicate(*payload)) {
            matches.push_back(WidgetAppendTextMatch{&packet, payload});
        }
    }
    return matches;
}

template <typename Predicate>
std::optional<WidgetAppendTextMatch> find_latest_widget_append_text_packet_if(
    const std::vector<UiRuntimePacket>& packets,
    Predicate predicate) {
    for (auto it = packets.rbegin(); it != packets.rend(); ++it) {
        const auto* payload = AsWidgetAppendTextPacketPayload(*it);
        if (payload != nullptr && predicate(*payload)) {
            return WidgetAppendTextMatch{&*it, payload};
        }
    }
    return std::nullopt;
}

UiRuntimePacketSnapshot build_snapshot_from_packets(
    std::vector<UiRuntimePacket> packets,
    std::string source,
    std::string error) {
    UiRuntimePacketSnapshot snapshot;
    snapshot.packets = std::move(packets);
    snapshot.packet_count = static_cast<std::uint64_t>(snapshot.packets.size());
    snapshot.revision = GetLastUiRuntimePacketSeq(snapshot.packets).value_or(0U);
    snapshot.source = std::move(source);
    snapshot.error = std::move(error);

    for (const auto& packet : snapshot.packets) {
        switch (packet.kind) {
        case UiRuntimePacketKind::SceneReplace:
            snapshot.scene_replace = *AsSceneReplacePacketPayload(packet);
            snapshot.has_scene_replace = true;
            break;
        case UiRuntimePacketKind::UiStateReplace:
            snapshot.ui_state_replace = *AsUiStateReplacePacketPayload(packet);
            snapshot.has_ui_state_replace = true;
            break;
        case UiRuntimePacketKind::DisplayReplace:
            snapshot.display_replace = *AsDisplayReplacePacketPayload(packet);
            snapshot.has_display_replace = true;
            break;
        case UiRuntimePacketKind::WidgetAppendText:
            snapshot.widget_append_text_packets.push_back(*AsWidgetAppendTextPacketPayload(packet));
            break;
        case UiRuntimePacketKind::InputEvent:
            snapshot.input_event_packets.push_back(*AsInputEventPacketPayload(packet));
            break;
        }
    }

    return snapshot;
}

}  // namespace

const char* ToString(UiRuntimePacketKind kind) {
    switch (kind) {
    case UiRuntimePacketKind::SceneReplace:
        return "scene.replace";
    case UiRuntimePacketKind::UiStateReplace:
        return "ui_state.replace";
    case UiRuntimePacketKind::DisplayReplace:
        return "display.replace";
    case UiRuntimePacketKind::WidgetAppendText:
        return "widget.append_text";
    case UiRuntimePacketKind::InputEvent:
        return "input.event";
    default:
        return "unknown";
    }
}

UiRuntimePacketKind ParseUiRuntimePacketKind(std::string_view kind) {
    if (kind == "scene.replace") {
        return UiRuntimePacketKind::SceneReplace;
    }
    if (kind == "ui_state.replace") {
        return UiRuntimePacketKind::UiStateReplace;
    }
    if (kind == "display.replace") {
        return UiRuntimePacketKind::DisplayReplace;
    }
    if (kind == "widget.append_text") {
        return UiRuntimePacketKind::WidgetAppendText;
    }
    if (kind == "input.event") {
        return UiRuntimePacketKind::InputEvent;
    }
    throw std::runtime_error("unknown ui runtime packet kind: " + std::string(kind));
}

JsonValue ToJsonValue(const SceneReplacePacketPayload& payload) {
    return JsonValue::Object{{"commands", JsonValue(payload.commands)}};
}

JsonValue ToJsonValue(const UiStateReplacePacketPayload& payload) {
    return JsonValue::Object{{"state", JsonValue(payload.state)}};
}

JsonValue ToJsonValue(const DisplayReplacePacketPayload& payload) {
    return JsonValue::Object{{"display", JsonValue(payload.display)}};
}

JsonValue ToJsonValue(const WidgetAppendTextPacketPayload& payload) {
    return JsonValue::Object{
        {"append_seq", JsonValue(static_cast<double>(payload.append_seq))},
        {"frame_id", JsonValue(payload.frame_id)},
        {"text", JsonValue(payload.text)},
        {"widget_id", JsonValue(payload.widget_id)},
    };
}

JsonValue ToJsonValue(const InputEventPacketPayload& payload) {
    return JsonValue::Object{{"event", JsonValue(payload.event)}};
}

JsonValue ToJsonValue(const UiRuntimePacket& packet) {
    return JsonValue::Object{
        {"kind", JsonValue(ToString(packet.kind))},
        {"payload", packet_payload_to_json(packet.payload)},
        {"seq", JsonValue(static_cast<double>(packet.seq))},
    };
}

JsonValue ToJsonValue(const UiRuntimePacketSnapshotMetadata& metadata) {
    return JsonValue::Object{
        {"error", JsonValue(metadata.error)},
        {"packet_count", JsonValue(static_cast<double>(metadata.packet_count))},
        {"revision", JsonValue(static_cast<double>(metadata.revision))},
        {"source", JsonValue(metadata.source)},
    };
}

JsonValue ToJsonValue(const UiRuntimePacketSnapshot& snapshot) {
    ValidateUiRuntimePacketSnapshot(snapshot);
    JsonValue::Array array;
    array.reserve(snapshot.packets.size());
    for (const auto& packet : snapshot.packets) {
        array.push_back(ToJsonValue(packet));
    }
    return JsonValue::Object{
        {"error", JsonValue(snapshot.error)},
        {"packet_count", JsonValue(static_cast<double>(snapshot.packet_count))},
        {"packets", JsonValue(array)},
        {"revision", JsonValue(static_cast<double>(snapshot.revision))},
        {"source", JsonValue(snapshot.source)},
    };
}

bool IsUiRuntimeReplacePacketKind(UiRuntimePacketKind kind) noexcept {
    switch (kind) {
    case UiRuntimePacketKind::SceneReplace:
    case UiRuntimePacketKind::UiStateReplace:
    case UiRuntimePacketKind::DisplayReplace:
        return true;
    case UiRuntimePacketKind::WidgetAppendText:
    case UiRuntimePacketKind::InputEvent:
        return false;
    }
    return false;
}

bool IsUiRuntimePatchPacketKind(UiRuntimePacketKind kind) noexcept {
    return !IsUiRuntimeReplacePacketKind(kind);
}

UiRuntimePacketSnapshotMetadata MakeUiRuntimePacketSnapshotMetadata(
    std::uint64_t revision,
    std::uint64_t packet_count,
    std::string source,
    std::string error) {
    UiRuntimePacketSnapshotMetadata metadata;
    metadata.revision = revision;
    metadata.packet_count = packet_count;
    metadata.source = std::move(source);
    metadata.error = std::move(error);
    ValidateUiRuntimePacketSnapshotMetadata(metadata);
    return metadata;
}

void ValidateUiRuntimePacketSnapshotMetadata(const UiRuntimePacketSnapshotMetadata& metadata) {
    static_cast<void>(ToJsonValue(metadata));
}

UiRuntimePacketSnapshot MakeEmptyUiRuntimePacketSnapshot() {
    return MakeUiRuntimePacketSnapshot({});
}

UiRuntimePacketSnapshot MakeUiRuntimePacketSnapshot(
    std::vector<UiRuntimePacket> packets,
    std::string source,
    std::string error) {
    UiRuntimePacketSnapshot snapshot = build_snapshot_from_packets(
        std::move(packets),
        std::move(source),
        std::move(error));
    ValidateUiRuntimePacketSnapshot(snapshot);
    return snapshot;
}

void ValidateUiRuntimePacketSnapshot(const UiRuntimePacketSnapshot& snapshot) {
    ValidateUiRuntimePacketSequence(snapshot.packets);

    const std::uint64_t expected_count = static_cast<std::uint64_t>(snapshot.packets.size());
    if (snapshot.packet_count != expected_count) {
        throw std::runtime_error("ui runtime packet snapshot packet_count mismatch");
    }

    const std::uint64_t expected_revision = GetLastUiRuntimePacketSeq(snapshot.packets).value_or(0U);
    if (snapshot.revision != expected_revision) {
        throw std::runtime_error("ui runtime packet snapshot revision mismatch");
    }

    const UiRuntimePacketSnapshot rebuilt = build_snapshot_from_packets(snapshot.packets, snapshot.source, snapshot.error);

    if (snapshot.has_scene_replace != rebuilt.has_scene_replace) {
        throw std::runtime_error("ui runtime packet snapshot scene_replace flag mismatch");
    }
    if (snapshot.has_ui_state_replace != rebuilt.has_ui_state_replace) {
        throw std::runtime_error("ui runtime packet snapshot ui_state_replace flag mismatch");
    }
    if (snapshot.has_display_replace != rebuilt.has_display_replace) {
        throw std::runtime_error("ui runtime packet snapshot display_replace flag mismatch");
    }
    if (snapshot.widget_append_text_packets.size() != rebuilt.widget_append_text_packets.size()) {
        throw std::runtime_error("ui runtime packet snapshot widget.append_text cache mismatch");
    }
    if (snapshot.input_event_packets.size() != rebuilt.input_event_packets.size()) {
        throw std::runtime_error("ui runtime packet snapshot input.event cache mismatch");
    }
}

bool IsUiRuntimePacketSnapshotEmpty(const UiRuntimePacketSnapshot& snapshot) noexcept {
    return snapshot.packets.empty();
}

bool HasUiRuntimePacketSnapshotSource(const UiRuntimePacketSnapshot& snapshot) noexcept {
    return !snapshot.source.empty();
}

bool HasUiRuntimePacketSnapshotError(const UiRuntimePacketSnapshot& snapshot) noexcept {
    return !snapshot.error.empty();
}

const std::string& GetUiRuntimePacketSnapshotSource(const UiRuntimePacketSnapshot& snapshot) noexcept {
    return snapshot.source;
}

const std::string& GetUiRuntimePacketSnapshotError(const UiRuntimePacketSnapshot& snapshot) noexcept {
    return snapshot.error;
}

std::uint64_t GetUiRuntimePacketSnapshotPacketCountValue(const UiRuntimePacketSnapshot& snapshot) noexcept {
    return snapshot.packet_count;
}

UiRuntimePacketSnapshotMetadata GetUiRuntimePacketSnapshotMetadata(const UiRuntimePacketSnapshot& snapshot) {
    ValidateUiRuntimePacketSnapshot(snapshot);
    return MakeUiRuntimePacketSnapshotMetadata(
        snapshot.revision,
        snapshot.packet_count,
        snapshot.source,
        snapshot.error);
}

std::uint64_t GetUiRuntimePacketSnapshotMetadataRevision(const UiRuntimePacketSnapshotMetadata& metadata) noexcept {
    return metadata.revision;
}

std::uint64_t GetUiRuntimePacketSnapshotMetadataPacketCount(const UiRuntimePacketSnapshotMetadata& metadata) noexcept {
    return metadata.packet_count;
}

bool HasUiRuntimePacketSnapshotMetadataSource(const UiRuntimePacketSnapshotMetadata& metadata) noexcept {
    return !metadata.source.empty();
}

bool HasUiRuntimePacketSnapshotMetadataError(const UiRuntimePacketSnapshotMetadata& metadata) noexcept {
    return !metadata.error.empty();
}

const std::string& GetUiRuntimePacketSnapshotMetadataSource(const UiRuntimePacketSnapshotMetadata& metadata) noexcept {
    return metadata.source;
}

const std::string& GetUiRuntimePacketSnapshotMetadataError(const UiRuntimePacketSnapshotMetadata& metadata) noexcept {
    return metadata.error;
}

bool IsUiRuntimePacketSnapshotMetadataEmpty(const UiRuntimePacketSnapshotMetadata& metadata) noexcept {
    return metadata.revision == 0
        && metadata.packet_count == 0
        && metadata.source.empty()
        && metadata.error.empty();
}

UiRuntimePacketSnapshotMetadata CopyUiRuntimePacketSnapshotMetadata(
    const UiRuntimePacketSnapshotMetadata& metadata) {
    ValidateUiRuntimePacketSnapshotMetadata(metadata);
    return metadata;
}

UiRuntimePacketSnapshotMetadata WithUiRuntimePacketSnapshotMetadataSource(
    const UiRuntimePacketSnapshotMetadata& metadata,
    std::string source) {
    ValidateUiRuntimePacketSnapshotMetadata(metadata);
    return MakeUiRuntimePacketSnapshotMetadata(
        metadata.revision,
        metadata.packet_count,
        std::move(source),
        metadata.error);
}

UiRuntimePacketSnapshotMetadata ClearUiRuntimePacketSnapshotMetadataSource(
    const UiRuntimePacketSnapshotMetadata& metadata) {
    return WithUiRuntimePacketSnapshotMetadataSource(metadata, {});
}

UiRuntimePacketSnapshotMetadata WithUiRuntimePacketSnapshotMetadataError(
    const UiRuntimePacketSnapshotMetadata& metadata,
    std::string error) {
    ValidateUiRuntimePacketSnapshotMetadata(metadata);
    return MakeUiRuntimePacketSnapshotMetadata(
        metadata.revision,
        metadata.packet_count,
        metadata.source,
        std::move(error));
}

UiRuntimePacketSnapshotMetadata ClearUiRuntimePacketSnapshotMetadataError(
    const UiRuntimePacketSnapshotMetadata& metadata) {
    return WithUiRuntimePacketSnapshotMetadataError(metadata, {});
}

UiRuntimePacketSnapshotMetadata ClearUiRuntimePacketSnapshotMetadata(
    const UiRuntimePacketSnapshotMetadata& metadata) {
    return ClearUiRuntimePacketSnapshotMetadataError(
        ClearUiRuntimePacketSnapshotMetadataSource(metadata));
}

std::size_t GetUiRuntimePacketCount(const std::vector<UiRuntimePacket>& packets) noexcept {
    return packets.size();
}

std::size_t GetUiRuntimePacketCount(const UiRuntimePacketSnapshot& snapshot) noexcept {
    return static_cast<std::size_t>(snapshot.packet_count);
}

bool HasUiRuntimePacketKind(const std::vector<UiRuntimePacket>& packets, UiRuntimePacketKind kind) noexcept {
    return FindLatestUiRuntimePacketByKind(packets, kind) != nullptr;
}

bool HasUiRuntimePacketKind(const UiRuntimePacketSnapshot& snapshot, UiRuntimePacketKind kind) noexcept {
    return HasUiRuntimePacketKind(snapshot.packets, kind);
}

const UiRuntimePacket* GetFirstUiRuntimePacket(const std::vector<UiRuntimePacket>& packets) noexcept {
    return packets.empty() ? nullptr : &packets.front();
}

const UiRuntimePacket* GetLastUiRuntimePacket(const std::vector<UiRuntimePacket>& packets) noexcept {
    return packets.empty() ? nullptr : &packets.back();
}

const UiRuntimePacket* GetFirstUiRuntimePacket(const UiRuntimePacketSnapshot& snapshot) noexcept {
    return GetFirstUiRuntimePacket(snapshot.packets);
}

const UiRuntimePacket* GetLastUiRuntimePacket(const UiRuntimePacketSnapshot& snapshot) noexcept {
    return GetLastUiRuntimePacket(snapshot.packets);
}

std::optional<std::uint64_t> GetFirstUiRuntimePacketSeq(const std::vector<UiRuntimePacket>& packets) noexcept {
    const UiRuntimePacket* packet = GetFirstUiRuntimePacket(packets);
    return packet == nullptr ? std::nullopt : std::optional<std::uint64_t>(packet->seq);
}

std::optional<std::uint64_t> GetLastUiRuntimePacketSeq(const std::vector<UiRuntimePacket>& packets) noexcept {
    const UiRuntimePacket* packet = GetLastUiRuntimePacket(packets);
    return packet == nullptr ? std::nullopt : std::optional<std::uint64_t>(packet->seq);
}

std::optional<std::uint64_t> GetFirstUiRuntimePacketSeq(const UiRuntimePacketSnapshot& snapshot) noexcept {
    return GetFirstUiRuntimePacketSeq(snapshot.packets);
}

std::optional<std::uint64_t> GetLastUiRuntimePacketSeq(const UiRuntimePacketSnapshot& snapshot) noexcept {
    return GetLastUiRuntimePacketSeq(snapshot.packets);
}

std::uint64_t GetNextUiRuntimePacketSeq(const std::vector<UiRuntimePacket>& packets) noexcept {
    const std::optional<std::uint64_t> last_seq = GetLastUiRuntimePacketSeq(packets);
    return last_seq.has_value() ? (*last_seq + 1U) : 1U;
}

std::uint64_t GetNextUiRuntimePacketSeq(const UiRuntimePacketSnapshot& snapshot) noexcept {
    return GetNextUiRuntimePacketSeq(snapshot.packets);
}

std::uint64_t GetUiRuntimePacketRevision(const UiRuntimePacketSnapshot& snapshot) noexcept {
    return snapshot.revision;
}

std::size_t CountUiRuntimePacketsByKind(const std::vector<UiRuntimePacket>& packets, UiRuntimePacketKind kind) noexcept {
    std::size_t count = 0;
    for (const auto& packet : packets) {
        if (packet.kind == kind) {
            ++count;
        }
    }
    return count;
}

std::size_t CountUiRuntimePacketsByKind(const UiRuntimePacketSnapshot& snapshot, UiRuntimePacketKind kind) noexcept {
    return CountUiRuntimePacketsByKind(snapshot.packets, kind);
}

const std::vector<UiRuntimePacket>& GetUiRuntimePacketArray(const UiRuntimePacketSnapshot& snapshot) noexcept {
    return snapshot.packets;
}

const UiRuntimePacket* GetUiRuntimePacketAt(
    const UiRuntimePacketSnapshot& snapshot,
    std::size_t index) noexcept {
    return index < snapshot.packets.size() ? &snapshot.packets[index] : nullptr;
}

const UiRuntimePacket* FindUiRuntimePacketBySeq(
    const UiRuntimePacketSnapshot& snapshot,
    std::uint64_t seq) noexcept {
    for (const auto& packet : snapshot.packets) {
        if (packet.seq == seq) {
            return &packet;
        }
    }
    return nullptr;
}

bool HasUiRuntimePacketSeq(
    const UiRuntimePacketSnapshot& snapshot,
    std::uint64_t seq) noexcept {
    return FindUiRuntimePacketBySeq(snapshot, seq) != nullptr;
}

UiRuntimePacketSnapshot CopyUiRuntimePacketSnapshot(const UiRuntimePacketSnapshot& snapshot) {
    ValidateUiRuntimePacketSnapshot(snapshot);
    return snapshot;
}

UiRuntimePacketSnapshot WithUiRuntimePacketSnapshotMetadata(
    const UiRuntimePacketSnapshot& snapshot,
    const UiRuntimePacketSnapshotMetadata& metadata) {
    ValidateUiRuntimePacketSnapshot(snapshot);
    ValidateUiRuntimePacketSnapshotMetadata(metadata);
    if (metadata.revision != snapshot.revision) {
        throw std::runtime_error("ui runtime packet snapshot metadata revision does not match packets");
    }
    if (metadata.packet_count != snapshot.packet_count) {
        throw std::runtime_error("ui runtime packet snapshot metadata packet_count does not match packets");
    }
    return MakeUiRuntimePacketSnapshot(snapshot.packets, metadata.source, metadata.error);
}

UiRuntimePacketSnapshot RebuildUiRuntimePacketSnapshot(
    const UiRuntimePacketSnapshot& snapshot) {
    ValidateUiRuntimePacketSnapshot(snapshot);
    return WithUiRuntimePacketSnapshotMetadataAndPackets(
        GetUiRuntimePacketSnapshotMetadata(snapshot),
        std::vector<UiRuntimePacket>(snapshot.packets.begin(), snapshot.packets.end()));
}

UiRuntimePacketSnapshot ReplaceUiRuntimePacketSnapshotPackets(
    const UiRuntimePacketSnapshot& snapshot,
    std::vector<UiRuntimePacket> packets) {
    ValidateUiRuntimePacketSnapshot(snapshot);
    return WithUiRuntimePacketSnapshotMetadataAndPackets(
        GetUiRuntimePacketSnapshotMetadata(snapshot),
        std::move(packets));
}

UiRuntimePacketSnapshot WithUiRuntimePacketSnapshotSource(
    const UiRuntimePacketSnapshot& snapshot,
    std::string source) {
    return WithUiRuntimePacketSnapshotMetadata(
        snapshot,
        WithUiRuntimePacketSnapshotMetadataSource(
            GetUiRuntimePacketSnapshotMetadata(snapshot),
            std::move(source)));
}

UiRuntimePacketSnapshot ClearUiRuntimePacketSnapshotSource(const UiRuntimePacketSnapshot& snapshot) {
    return WithUiRuntimePacketSnapshotMetadata(
        snapshot,
        ClearUiRuntimePacketSnapshotMetadataSource(
            GetUiRuntimePacketSnapshotMetadata(snapshot)));
}

UiRuntimePacketSnapshot WithUiRuntimePacketSnapshotError(
    const UiRuntimePacketSnapshot& snapshot,
    std::string error) {
    return WithUiRuntimePacketSnapshotMetadata(
        snapshot,
        WithUiRuntimePacketSnapshotMetadataError(
            GetUiRuntimePacketSnapshotMetadata(snapshot),
            std::move(error)));
}

UiRuntimePacketSnapshot ClearUiRuntimePacketSnapshotError(const UiRuntimePacketSnapshot& snapshot) {
    return WithUiRuntimePacketSnapshotMetadata(
        snapshot,
        ClearUiRuntimePacketSnapshotMetadataError(
            GetUiRuntimePacketSnapshotMetadata(snapshot)));
}

UiRuntimePacketSnapshot ClearUiRuntimePacketSnapshotMetadata(
    const UiRuntimePacketSnapshot& snapshot) {
    return WithUiRuntimePacketSnapshotMetadata(
        snapshot,
        ClearUiRuntimePacketSnapshotMetadata(
            GetUiRuntimePacketSnapshotMetadata(snapshot)));
}

UiRuntimePacketSnapshot WithUiRuntimePacketSnapshotPackets(
    const UiRuntimePacketSnapshot& snapshot,
    std::vector<UiRuntimePacket> packets) {
    return ReplaceUiRuntimePacketSnapshotPackets(snapshot, std::move(packets));
}

UiRuntimePacketSnapshot WithUiRuntimePacketSnapshotMetadataAndPackets(
    const UiRuntimePacketSnapshotMetadata& metadata,
    std::vector<UiRuntimePacket> packets) {
    ValidateUiRuntimePacketSnapshotMetadata(metadata);
    UiRuntimePacketSnapshot snapshot = MakeUiRuntimePacketSnapshot(
        std::move(packets),
        metadata.source,
        metadata.error);
    if (snapshot.revision != metadata.revision) {
        throw std::runtime_error("ui runtime packet snapshot metadata revision does not match packets");
    }
    if (snapshot.packet_count != metadata.packet_count) {
        throw std::runtime_error("ui runtime packet snapshot metadata packet_count does not match packets");
    }
    return snapshot;
}

UiRuntimePacketSnapshot ClearUiRuntimePacketSnapshotPackets(const UiRuntimePacketSnapshot& snapshot) {
    return ReplaceUiRuntimePacketSnapshotPackets(snapshot, {});
}

UiRuntimePacketSnapshot WithUiRuntimePacketAppended(const UiRuntimePacketSnapshot& snapshot, const UiRuntimePacket& packet) {
    ValidateUiRuntimePacketSnapshot(snapshot);
    std::vector<UiRuntimePacket> packets = snapshot.packets;
    packets.push_back(packet);
    return MakeUiRuntimePacketSnapshot(std::move(packets), snapshot.source, snapshot.error);
}

UiRuntimePacketSnapshot WithUiRuntimePacketsAppended(
    const UiRuntimePacketSnapshot& snapshot,
    const std::vector<UiRuntimePacket>& packets) {
    ValidateUiRuntimePacketSnapshot(snapshot);
    std::vector<UiRuntimePacket> merged = snapshot.packets;
    merged.insert(merged.end(), packets.begin(), packets.end());
    return MakeUiRuntimePacketSnapshot(std::move(merged), snapshot.source, snapshot.error);
}

const SceneReplacePacketPayload* AsSceneReplacePacketPayload(const UiRuntimePacket& packet) noexcept {
    return std::get_if<SceneReplacePacketPayload>(&packet.payload);
}

const UiStateReplacePacketPayload* AsUiStateReplacePacketPayload(const UiRuntimePacket& packet) noexcept {
    return std::get_if<UiStateReplacePacketPayload>(&packet.payload);
}

const DisplayReplacePacketPayload* AsDisplayReplacePacketPayload(const UiRuntimePacket& packet) noexcept {
    return std::get_if<DisplayReplacePacketPayload>(&packet.payload);
}

const WidgetAppendTextPacketPayload* AsWidgetAppendTextPacketPayload(const UiRuntimePacket& packet) noexcept {
    return std::get_if<WidgetAppendTextPacketPayload>(&packet.payload);
}

const InputEventPacketPayload* AsInputEventPacketPayload(const UiRuntimePacket& packet) noexcept {
    return std::get_if<InputEventPacketPayload>(&packet.payload);
}

const JsonValue::Object& GetInputEventObject(const InputEventPacketPayload& payload) noexcept {
    return payload.event;
}

bool HasInputEventField(const InputEventPacketPayload& payload, std::string_view key) noexcept {
    return FindInputEventField(payload, key) != nullptr;
}

const JsonValue* FindInputEventField(const InputEventPacketPayload& payload, std::string_view key) noexcept {
    return find_object_field(payload.event, key);
}

const JsonValue& RequireInputEventField(const InputEventPacketPayload& payload, std::string_view key) {
    return require_object_field(payload.event, key);
}

std::string GetInputEventName(const InputEventPacketPayload& payload) {
    return RequireInputEventField(payload, "event").as_string();
}

std::optional<std::string> GetInputEventFrameId(const InputEventPacketPayload& payload) {
    return GetInputEventStringField(payload, "frame_id");
}

std::optional<std::string> GetInputEventWidgetId(const InputEventPacketPayload& payload) {
    return GetInputEventStringField(payload, "widget_id");
}

std::optional<double> GetInputEventNumberField(const InputEventPacketPayload& payload, std::string_view key) {
    const JsonValue* value = FindInputEventField(payload, key);
    if (value == nullptr) {
        return std::nullopt;
    }
    const double number = value->as_number();
    if (!std::isfinite(number)) {
        throw std::runtime_error("input event field must be finite: " + std::string(key));
    }
    return number;
}

std::optional<bool> GetInputEventBooleanField(const InputEventPacketPayload& payload, std::string_view key) {
    const JsonValue* value = FindInputEventField(payload, key);
    if (value == nullptr) {
        return std::nullopt;
    }
    return value->as_boolean();
}

std::optional<std::string> GetInputEventStringField(const InputEventPacketPayload& payload, std::string_view key) {
    const JsonValue* value = FindInputEventField(payload, key);
    if (value == nullptr) {
        return std::nullopt;
    }
    return value->as_string();
}

std::optional<std::uint64_t> GetInputEventButtons(const InputEventPacketPayload& payload) {
    const std::optional<double> value = GetInputEventNumberField(payload, "buttons");
    if (!value.has_value()) {
        return std::nullopt;
    }
    if (*value < 0.0 || std::floor(*value) != *value || *value > static_cast<double>(std::numeric_limits<std::uint64_t>::max())) {
        throw std::runtime_error("input event buttons must be a non-negative integer");
    }
    return static_cast<std::uint64_t>(*value);
}

std::optional<double> GetInputEventX(const InputEventPacketPayload& payload) {
    return GetInputEventNumberField(payload, "x");
}

std::optional<double> GetInputEventY(const InputEventPacketPayload& payload) {
    return GetInputEventNumberField(payload, "y");
}

std::size_t CountInputEventsByName(
    const std::vector<UiRuntimePacket>& packets,
    std::string_view event_name) {
    return FindInputEventsByName(packets, event_name).size();
}

std::size_t CountInputEventsByName(
    const UiRuntimePacketSnapshot& snapshot,
    std::string_view event_name) {
    return CountInputEventsByName(snapshot.packets, event_name);
}

std::size_t CountInputEventsByFrameId(
    const std::vector<UiRuntimePacket>& packets,
    std::string_view frame_id) {
    return FindInputEventsByFrameId(packets, frame_id).size();
}

std::size_t CountInputEventsByFrameId(
    const UiRuntimePacketSnapshot& snapshot,
    std::string_view frame_id) {
    return CountInputEventsByFrameId(snapshot.packets, frame_id);
}

std::size_t CountInputEventsByWidgetId(
    const std::vector<UiRuntimePacket>& packets,
    std::string_view widget_id) {
    return FindInputEventsByWidgetId(packets, widget_id).size();
}

std::size_t CountInputEventsByWidgetId(
    const UiRuntimePacketSnapshot& snapshot,
    std::string_view widget_id) {
    return CountInputEventsByWidgetId(snapshot.packets, widget_id);
}

std::vector<InputEventMatch> FindInputEventsByName(
    const std::vector<UiRuntimePacket>& packets,
    std::string_view event_name) {
    return find_input_events_if(packets, [&](const InputEventPacketPayload& payload) {
        return input_event_name_equals(payload, event_name);
    });
}

std::vector<InputEventMatch> FindInputEventsByName(
    const UiRuntimePacketSnapshot& snapshot,
    std::string_view event_name) {
    return FindInputEventsByName(snapshot.packets, event_name);
}

std::vector<InputEventMatch> FindInputEventsByFrameId(
    const std::vector<UiRuntimePacket>& packets,
    std::string_view frame_id) {
    return find_input_events_if(packets, [&](const InputEventPacketPayload& payload) {
        return input_event_frame_equals(payload, frame_id);
    });
}

std::vector<InputEventMatch> FindInputEventsByFrameId(
    const UiRuntimePacketSnapshot& snapshot,
    std::string_view frame_id) {
    return FindInputEventsByFrameId(snapshot.packets, frame_id);
}

std::vector<InputEventMatch> FindInputEventsByWidgetId(
    const std::vector<UiRuntimePacket>& packets,
    std::string_view widget_id) {
    return find_input_events_if(packets, [&](const InputEventPacketPayload& payload) {
        return input_event_widget_equals(payload, widget_id);
    });
}

std::vector<InputEventMatch> FindInputEventsByWidgetId(
    const UiRuntimePacketSnapshot& snapshot,
    std::string_view widget_id) {
    return FindInputEventsByWidgetId(snapshot.packets, widget_id);
}

std::optional<InputEventMatch> FindLatestInputEvent(const std::vector<UiRuntimePacket>& packets) {
    return find_latest_input_event_if(packets, [](const InputEventPacketPayload&) { return true; });
}

std::optional<InputEventMatch> FindLatestInputEvent(const UiRuntimePacketSnapshot& snapshot) {
    return FindLatestInputEvent(snapshot.packets);
}

std::optional<InputEventMatch> FindLatestInputEventByName(
    const std::vector<UiRuntimePacket>& packets,
    std::string_view event_name) {
    return find_latest_input_event_if(packets, [&](const InputEventPacketPayload& payload) {
        return input_event_name_equals(payload, event_name);
    });
}

std::optional<InputEventMatch> FindLatestInputEventByName(
    const UiRuntimePacketSnapshot& snapshot,
    std::string_view event_name) {
    return FindLatestInputEventByName(snapshot.packets, event_name);
}

std::optional<InputEventMatch> FindLatestInputEventByFrameId(
    const std::vector<UiRuntimePacket>& packets,
    std::string_view frame_id) {
    return find_latest_input_event_if(packets, [&](const InputEventPacketPayload& payload) {
        return input_event_frame_equals(payload, frame_id);
    });
}

std::optional<InputEventMatch> FindLatestInputEventByFrameId(
    const UiRuntimePacketSnapshot& snapshot,
    std::string_view frame_id) {
    return FindLatestInputEventByFrameId(snapshot.packets, frame_id);
}

std::optional<InputEventMatch> FindLatestInputEventByWidgetId(
    const std::vector<UiRuntimePacket>& packets,
    std::string_view widget_id) {
    return find_latest_input_event_if(packets, [&](const InputEventPacketPayload& payload) {
        return input_event_widget_equals(payload, widget_id);
    });
}

std::optional<InputEventMatch> FindLatestInputEventByWidgetId(
    const UiRuntimePacketSnapshot& snapshot,
    std::string_view widget_id) {
    return FindLatestInputEventByWidgetId(snapshot.packets, widget_id);
}

void ValidateUiRuntimePacket(const UiRuntimePacket& packet) {
    if (packet.seq == 0) {
        throw std::runtime_error("ui runtime packet seq must be greater than zero");
    }

    switch (packet.kind) {
    case UiRuntimePacketKind::SceneReplace: {
        const auto* payload = AsSceneReplacePacketPayload(packet);
        if (payload == nullptr) {
            throw std::runtime_error("scene.replace packet kind/payload mismatch");
        }
        static_cast<void>(ToJsonValue(*payload));
        break;
    }
    case UiRuntimePacketKind::UiStateReplace: {
        const auto* payload = AsUiStateReplacePacketPayload(packet);
        if (payload == nullptr) {
            throw std::runtime_error("ui_state.replace packet kind/payload mismatch");
        }
        static_cast<void>(ToJsonValue(*payload));
        break;
    }
    case UiRuntimePacketKind::DisplayReplace: {
        const auto* payload = AsDisplayReplacePacketPayload(packet);
        if (payload == nullptr) {
            throw std::runtime_error("display.replace packet kind/payload mismatch");
        }
        static_cast<void>(ToJsonValue(*payload));
        break;
    }
    case UiRuntimePacketKind::WidgetAppendText: {
        const auto* payload = AsWidgetAppendTextPacketPayload(packet);
        if (payload == nullptr) {
            throw std::runtime_error("widget.append_text packet kind/payload mismatch");
        }
        if (payload->frame_id.empty()) {
            throw std::runtime_error("widget.append_text frame_id must not be empty");
        }
        if (payload->widget_id.empty()) {
            throw std::runtime_error("widget.append_text widget_id must not be empty");
        }
        static_cast<void>(ToJsonValue(*payload));
        break;
    }
    case UiRuntimePacketKind::InputEvent: {
        const auto* payload = AsInputEventPacketPayload(packet);
        if (payload == nullptr) {
            throw std::runtime_error("input.event packet kind/payload mismatch");
        }
        validate_input_event_object(payload->event);
        static_cast<void>(ToJsonValue(*payload));
        break;
    }
    }
}

void ValidateUiRuntimePacketSequence(const std::vector<UiRuntimePacket>& packets) {
    std::uint64_t previous_seq = 0;
    for (const auto& packet : packets) {
        ValidateUiRuntimePacket(packet);
        if (packet.seq <= previous_seq) {
            throw std::runtime_error("ui runtime packet seq must be strictly increasing");
        }
        previous_seq = packet.seq;
    }
}

UiRuntimePacketSnapshot BuildUiRuntimePacketSnapshot(const std::vector<UiRuntimePacket>& packets) {
    return MakeUiRuntimePacketSnapshot(std::vector<UiRuntimePacket>(packets.begin(), packets.end()));
}

UiRuntimePacketSnapshotMetadata ParseUiRuntimePacketSnapshotMetadata(const JsonValue& value) {
    const JsonObject& object = value.as_object();
    require_allowed_keys(object, {"revision", "packet_count", "source", "error"}, "snapshot metadata");

    std::uint64_t revision = 0;
    if (const JsonValue* revision_value = find_object_field(object, "revision")) {
        revision = require_uint64(*revision_value, "revision");
    }

    std::uint64_t packet_count = 0;
    if (const JsonValue* packet_count_value = find_object_field(object, "packet_count")) {
        packet_count = require_uint64(*packet_count_value, "packet_count");
    }

    std::string source;
    if (const JsonValue* source_value = find_object_field(object, "source")) {
        source = source_value->as_string();
    }

    std::string error;
    if (const JsonValue* error_value = find_object_field(object, "error")) {
        error = error_value->as_string();
    }

    return MakeUiRuntimePacketSnapshotMetadata(revision, packet_count, std::move(source), std::move(error));
}

UiRuntimePacketSnapshotMetadata ParseUiRuntimePacketSnapshotMetadata(const char* text) {
    return ParseUiRuntimePacketSnapshotMetadata(std::string(text == nullptr ? "" : text));
}

UiRuntimePacketSnapshotMetadata ParseUiRuntimePacketSnapshotMetadata(const std::string& text) {
    return ParseUiRuntimePacketSnapshotMetadata(parse_json(text));
}

UiRuntimePacketSnapshot ParseUiRuntimePacketSnapshot(const JsonValue& value) {
    if (value.is_array()) {
        return BuildUiRuntimePacketSnapshot(ParseUiRuntimePackets(value));
    }

    const JsonObject& object = value.as_object();
    require_allowed_keys(object, {"revision", "packet_count", "source", "error", "packets"}, "snapshot");

    const JsonValue& packets_value = require_object_field(object, "packets");
    std::vector<UiRuntimePacket> packets = ParseUiRuntimePackets(packets_value);
    JsonObject metadata_object = object;
    metadata_object.erase("packets");
    const UiRuntimePacketSnapshotMetadata metadata = ParseUiRuntimePacketSnapshotMetadata(JsonValue(metadata_object));
    return WithUiRuntimePacketSnapshotMetadata(
        MakeUiRuntimePacketSnapshot(std::move(packets), metadata.source, metadata.error),
        metadata);
}

UiRuntimePacketSnapshot ParseUiRuntimePacketSnapshot(const char* text) {
    return ParseUiRuntimePacketSnapshot(std::string(text == nullptr ? "" : text));
}

UiRuntimePacketSnapshot ParseUiRuntimePacketSnapshot(const std::string& text) {
    return ParseUiRuntimePacketSnapshot(parse_json(text));
}

std::vector<const UiRuntimePacket*> FindUiRuntimePacketsByKind(
    const std::vector<UiRuntimePacket>& packets,
    UiRuntimePacketKind kind) noexcept {
    std::vector<const UiRuntimePacket*> matches;
    for (const auto& packet : packets) {
        if (packet.kind == kind) {
            matches.push_back(&packet);
        }
    }
    return matches;
}

std::vector<const UiRuntimePacket*> FindUiRuntimePacketsByKind(
    const UiRuntimePacketSnapshot& snapshot,
    UiRuntimePacketKind kind) noexcept {
    return FindUiRuntimePacketsByKind(snapshot.packets, kind);
}

const UiRuntimePacket* FindLatestUiRuntimePacketByKind(
    const std::vector<UiRuntimePacket>& packets,
    UiRuntimePacketKind kind) noexcept {
    for (auto it = packets.rbegin(); it != packets.rend(); ++it) {
        if (it->kind == kind) {
            return &*it;
        }
    }
    return nullptr;
}

const UiRuntimePacket* FindLatestUiRuntimePacketByKind(
    const UiRuntimePacketSnapshot& snapshot,
    UiRuntimePacketKind kind) noexcept {
    return FindLatestUiRuntimePacketByKind(snapshot.packets, kind);
}

const SceneReplacePacketPayload* GetLatestSceneReplacePacketPayload(const UiRuntimePacketSnapshot& snapshot) noexcept {
    return snapshot.has_scene_replace ? &snapshot.scene_replace : nullptr;
}

const UiStateReplacePacketPayload* GetLatestUiStateReplacePacketPayload(const UiRuntimePacketSnapshot& snapshot) noexcept {
    return snapshot.has_ui_state_replace ? &snapshot.ui_state_replace : nullptr;
}

const DisplayReplacePacketPayload* GetLatestDisplayReplacePacketPayload(const UiRuntimePacketSnapshot& snapshot) noexcept {
    return snapshot.has_display_replace ? &snapshot.display_replace : nullptr;
}

std::vector<WidgetAppendTextMatch> FindWidgetAppendTextPacketsByFrameId(
    const std::vector<UiRuntimePacket>& packets,
    std::string_view frame_id) {
    return find_widget_append_text_packets_if(packets, [&](const WidgetAppendTextPacketPayload& payload) {
        return widget_append_text_frame_equals(payload, frame_id);
    });
}

std::vector<WidgetAppendTextMatch> FindWidgetAppendTextPacketsByFrameId(
    const UiRuntimePacketSnapshot& snapshot,
    std::string_view frame_id) {
    return FindWidgetAppendTextPacketsByFrameId(snapshot.packets, frame_id);
}

std::vector<WidgetAppendTextMatch> FindWidgetAppendTextPacketsByWidgetId(
    const std::vector<UiRuntimePacket>& packets,
    std::string_view widget_id) {
    return find_widget_append_text_packets_if(packets, [&](const WidgetAppendTextPacketPayload& payload) {
        return widget_append_text_widget_equals(payload, widget_id);
    });
}

std::vector<WidgetAppendTextMatch> FindWidgetAppendTextPacketsByWidgetId(
    const UiRuntimePacketSnapshot& snapshot,
    std::string_view widget_id) {
    return FindWidgetAppendTextPacketsByWidgetId(snapshot.packets, widget_id);
}

std::optional<WidgetAppendTextMatch> FindLatestWidgetAppendTextPacket(
    const std::vector<UiRuntimePacket>& packets) {
    return find_latest_widget_append_text_packet_if(packets, [](const WidgetAppendTextPacketPayload&) { return true; });
}

std::optional<WidgetAppendTextMatch> FindLatestWidgetAppendTextPacket(
    const UiRuntimePacketSnapshot& snapshot) {
    return FindLatestWidgetAppendTextPacket(snapshot.packets);
}

std::optional<WidgetAppendTextMatch> FindLatestWidgetAppendTextPacketByFrameId(
    const std::vector<UiRuntimePacket>& packets,
    std::string_view frame_id) {
    return find_latest_widget_append_text_packet_if(packets, [&](const WidgetAppendTextPacketPayload& payload) {
        return widget_append_text_frame_equals(payload, frame_id);
    });
}

std::optional<WidgetAppendTextMatch> FindLatestWidgetAppendTextPacketByFrameId(
    const UiRuntimePacketSnapshot& snapshot,
    std::string_view frame_id) {
    return FindLatestWidgetAppendTextPacketByFrameId(snapshot.packets, frame_id);
}

std::optional<WidgetAppendTextMatch> FindLatestWidgetAppendTextPacketByWidgetId(
    const std::vector<UiRuntimePacket>& packets,
    std::string_view widget_id) {
    return find_latest_widget_append_text_packet_if(packets, [&](const WidgetAppendTextPacketPayload& payload) {
        return widget_append_text_widget_equals(payload, widget_id);
    });
}

std::optional<WidgetAppendTextMatch> FindLatestWidgetAppendTextPacketByWidgetId(
    const UiRuntimePacketSnapshot& snapshot,
    std::string_view widget_id) {
    return FindLatestWidgetAppendTextPacketByWidgetId(snapshot.packets, widget_id);
}

std::string SerializeUiRuntimePacket(const UiRuntimePacket& packet, int indent) {
    ValidateUiRuntimePacket(packet);
    return json_stringify(ToJsonValue(packet), indent);
}

std::string SerializeUiRuntimePackets(const std::vector<UiRuntimePacket>& packets, int indent) {
    ValidateUiRuntimePacketSequence(packets);
    JsonValue::Array array;
    array.reserve(packets.size());
    for (const auto& packet : packets) {
        array.push_back(ToJsonValue(packet));
    }
    return json_stringify(JsonValue(array), indent);
}

std::string SerializeUiRuntimePacketSnapshotMetadata(
    const UiRuntimePacketSnapshotMetadata& metadata,
    int indent) {
    ValidateUiRuntimePacketSnapshotMetadata(metadata);
    return json_stringify(ToJsonValue(metadata), indent);
}

std::string SerializeUiRuntimePacketSnapshotPackets(const UiRuntimePacketSnapshot& snapshot, int indent) {
    ValidateUiRuntimePacketSnapshot(snapshot);
    return SerializeUiRuntimePackets(snapshot.packets, indent);
}

std::string SerializeUiRuntimePacketSnapshot(const UiRuntimePacketSnapshot& snapshot, int indent) {
    return json_stringify(ToJsonValue(snapshot), indent);
}

UiRuntimePacket ParseUiRuntimePacket(const JsonValue& value) {
    const JsonValue::Object& object = value.as_object();
    require_allowed_keys(object, {"seq", "kind", "payload"}, "packet");
    UiRuntimePacket packet;
    packet.seq = require_uint64(require_object_field(object, "seq"), "seq");
    packet.kind = ParseUiRuntimePacketKind(require_object_field(object, "kind").as_string());

    const JsonValue::Object& payload = require_object_field(object, "payload").as_object();
    switch (packet.kind) {
    case UiRuntimePacketKind::SceneReplace:
        packet.payload = parse_scene_replace_payload(payload);
        break;
    case UiRuntimePacketKind::UiStateReplace:
        packet.payload = parse_ui_state_replace_payload(payload);
        break;
    case UiRuntimePacketKind::DisplayReplace:
        packet.payload = parse_display_replace_payload(payload);
        break;
    case UiRuntimePacketKind::WidgetAppendText:
        packet.payload = parse_widget_append_text_payload(payload);
        break;
    case UiRuntimePacketKind::InputEvent:
        packet.payload = parse_input_event_payload(payload);
        break;
    }

    ValidateUiRuntimePacket(packet);
    return packet;
}

UiRuntimePacket ParseUiRuntimePacket(const std::string& text) {
    return ParseUiRuntimePacket(parse_json(text));
}

std::vector<UiRuntimePacket> ParseUiRuntimePackets(const JsonValue& value) {
    std::vector<UiRuntimePacket> packets;
    const auto& array = value.as_array();
    packets.reserve(array.size());
    for (const auto& entry : array) {
        packets.push_back(ParseUiRuntimePacket(entry));
    }
    ValidateUiRuntimePacketSequence(packets);
    return packets;
}

std::vector<UiRuntimePacket> ParseUiRuntimePackets(const std::string& text) {
    return ParseUiRuntimePackets(parse_json(text));
}

}  // namespace vf
