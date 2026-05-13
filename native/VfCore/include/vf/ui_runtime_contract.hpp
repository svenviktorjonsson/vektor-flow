#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <variant>
#include <vector>

#include "vf/json.hpp"

namespace vf {

enum class UiRuntimePacketKind {
    SceneReplace,
    UiStateReplace,
    DisplayReplace,
    WidgetAppendText,
    InputEvent,
};

const char* ToString(UiRuntimePacketKind kind);
UiRuntimePacketKind ParseUiRuntimePacketKind(std::string_view kind);

struct SceneReplacePacketPayload {
    JsonValue::Array commands;
};

struct UiStateReplacePacketPayload {
    JsonValue::Object state;
};

struct DisplayReplacePacketPayload {
    JsonValue::Object display;
};

struct WidgetAppendTextPacketPayload {
    std::string frame_id;
    std::string widget_id;
    std::string text;
    std::uint64_t append_seq = 0;
};

struct InputEventPacketPayload {
    JsonValue::Object event;
};

using UiRuntimePacketPayload = std::variant<
    SceneReplacePacketPayload,
    UiStateReplacePacketPayload,
    DisplayReplacePacketPayload,
    WidgetAppendTextPacketPayload,
    InputEventPacketPayload>;

struct UiRuntimePacket {
    std::uint64_t seq = 0;
    UiRuntimePacketKind kind = UiRuntimePacketKind::SceneReplace;
    UiRuntimePacketPayload payload = SceneReplacePacketPayload{};
};

struct UiRuntimePacketSnapshot {
    std::uint64_t revision = 0;
    std::uint64_t packet_count = 0;
    std::string source;
    std::string error;
    std::vector<UiRuntimePacket> packets;
    bool has_scene_replace = false;
    SceneReplacePacketPayload scene_replace;
    bool has_ui_state_replace = false;
    UiStateReplacePacketPayload ui_state_replace;
    bool has_display_replace = false;
    DisplayReplacePacketPayload display_replace;
    std::vector<WidgetAppendTextPacketPayload> widget_append_text_packets;
    std::vector<InputEventPacketPayload> input_event_packets;
};

struct UiRuntimePacketSnapshotMetadata {
    std::uint64_t revision = 0;
    std::uint64_t packet_count = 0;
    std::string source;
    std::string error;
};

struct InputEventMatch {
    const UiRuntimePacket* packet = nullptr;
    const InputEventPacketPayload* payload = nullptr;
};

struct WidgetAppendTextMatch {
    const UiRuntimePacket* packet = nullptr;
    const WidgetAppendTextPacketPayload* payload = nullptr;
};

JsonValue ToJsonValue(const SceneReplacePacketPayload& payload);
JsonValue ToJsonValue(const UiStateReplacePacketPayload& payload);
JsonValue ToJsonValue(const DisplayReplacePacketPayload& payload);
JsonValue ToJsonValue(const WidgetAppendTextPacketPayload& payload);
JsonValue ToJsonValue(const InputEventPacketPayload& payload);
JsonValue ToJsonValue(const UiRuntimePacket& packet);
JsonValue ToJsonValue(const UiRuntimePacketSnapshotMetadata& metadata);
JsonValue ToJsonValue(const UiRuntimePacketSnapshot& snapshot);

bool IsUiRuntimeReplacePacketKind(UiRuntimePacketKind kind) noexcept;
bool IsUiRuntimePatchPacketKind(UiRuntimePacketKind kind) noexcept;
UiRuntimePacketSnapshotMetadata MakeUiRuntimePacketSnapshotMetadata(
    std::uint64_t revision = 0,
    std::uint64_t packet_count = 0,
    std::string source = {},
    std::string error = {});
void ValidateUiRuntimePacketSnapshotMetadata(const UiRuntimePacketSnapshotMetadata& metadata);
UiRuntimePacketSnapshot MakeEmptyUiRuntimePacketSnapshot();
UiRuntimePacketSnapshot MakeUiRuntimePacketSnapshot(
    std::vector<UiRuntimePacket> packets,
    std::string source = {},
    std::string error = {});
void ValidateUiRuntimePacketSnapshot(const UiRuntimePacketSnapshot& snapshot);
bool IsUiRuntimePacketSnapshotEmpty(const UiRuntimePacketSnapshot& snapshot) noexcept;
bool HasUiRuntimePacketSnapshotSource(const UiRuntimePacketSnapshot& snapshot) noexcept;
bool HasUiRuntimePacketSnapshotError(const UiRuntimePacketSnapshot& snapshot) noexcept;
const std::string& GetUiRuntimePacketSnapshotSource(const UiRuntimePacketSnapshot& snapshot) noexcept;
const std::string& GetUiRuntimePacketSnapshotError(const UiRuntimePacketSnapshot& snapshot) noexcept;
std::uint64_t GetUiRuntimePacketSnapshotPacketCountValue(const UiRuntimePacketSnapshot& snapshot) noexcept;
UiRuntimePacketSnapshotMetadata GetUiRuntimePacketSnapshotMetadata(const UiRuntimePacketSnapshot& snapshot);
std::uint64_t GetUiRuntimePacketSnapshotMetadataRevision(const UiRuntimePacketSnapshotMetadata& metadata) noexcept;
std::uint64_t GetUiRuntimePacketSnapshotMetadataPacketCount(const UiRuntimePacketSnapshotMetadata& metadata) noexcept;
bool HasUiRuntimePacketSnapshotMetadataSource(const UiRuntimePacketSnapshotMetadata& metadata) noexcept;
bool HasUiRuntimePacketSnapshotMetadataError(const UiRuntimePacketSnapshotMetadata& metadata) noexcept;
const std::string& GetUiRuntimePacketSnapshotMetadataSource(const UiRuntimePacketSnapshotMetadata& metadata) noexcept;
const std::string& GetUiRuntimePacketSnapshotMetadataError(const UiRuntimePacketSnapshotMetadata& metadata) noexcept;
bool IsUiRuntimePacketSnapshotMetadataEmpty(const UiRuntimePacketSnapshotMetadata& metadata) noexcept;
UiRuntimePacketSnapshotMetadata CopyUiRuntimePacketSnapshotMetadata(
    const UiRuntimePacketSnapshotMetadata& metadata);
UiRuntimePacketSnapshotMetadata WithUiRuntimePacketSnapshotMetadataSource(
    const UiRuntimePacketSnapshotMetadata& metadata,
    std::string source);
UiRuntimePacketSnapshotMetadata ClearUiRuntimePacketSnapshotMetadataSource(
    const UiRuntimePacketSnapshotMetadata& metadata);
UiRuntimePacketSnapshotMetadata WithUiRuntimePacketSnapshotMetadataError(
    const UiRuntimePacketSnapshotMetadata& metadata,
    std::string error);
UiRuntimePacketSnapshotMetadata ClearUiRuntimePacketSnapshotMetadataError(
    const UiRuntimePacketSnapshotMetadata& metadata);
UiRuntimePacketSnapshotMetadata ClearUiRuntimePacketSnapshotMetadata(
    const UiRuntimePacketSnapshotMetadata& metadata);
std::size_t GetUiRuntimePacketCount(const std::vector<UiRuntimePacket>& packets) noexcept;
std::size_t GetUiRuntimePacketCount(const UiRuntimePacketSnapshot& snapshot) noexcept;
bool HasUiRuntimePacketKind(const std::vector<UiRuntimePacket>& packets, UiRuntimePacketKind kind) noexcept;
bool HasUiRuntimePacketKind(const UiRuntimePacketSnapshot& snapshot, UiRuntimePacketKind kind) noexcept;
const UiRuntimePacket* GetFirstUiRuntimePacket(const std::vector<UiRuntimePacket>& packets) noexcept;
const UiRuntimePacket* GetLastUiRuntimePacket(const std::vector<UiRuntimePacket>& packets) noexcept;
const UiRuntimePacket* GetFirstUiRuntimePacket(const UiRuntimePacketSnapshot& snapshot) noexcept;
const UiRuntimePacket* GetLastUiRuntimePacket(const UiRuntimePacketSnapshot& snapshot) noexcept;
std::optional<std::uint64_t> GetFirstUiRuntimePacketSeq(const std::vector<UiRuntimePacket>& packets) noexcept;
std::optional<std::uint64_t> GetLastUiRuntimePacketSeq(const std::vector<UiRuntimePacket>& packets) noexcept;
std::optional<std::uint64_t> GetFirstUiRuntimePacketSeq(const UiRuntimePacketSnapshot& snapshot) noexcept;
std::optional<std::uint64_t> GetLastUiRuntimePacketSeq(const UiRuntimePacketSnapshot& snapshot) noexcept;
std::uint64_t GetNextUiRuntimePacketSeq(const std::vector<UiRuntimePacket>& packets) noexcept;
std::uint64_t GetNextUiRuntimePacketSeq(const UiRuntimePacketSnapshot& snapshot) noexcept;
std::uint64_t GetUiRuntimePacketRevision(const UiRuntimePacketSnapshot& snapshot) noexcept;
std::size_t CountUiRuntimePacketsByKind(const std::vector<UiRuntimePacket>& packets, UiRuntimePacketKind kind) noexcept;
std::size_t CountUiRuntimePacketsByKind(const UiRuntimePacketSnapshot& snapshot, UiRuntimePacketKind kind) noexcept;
const std::vector<UiRuntimePacket>& GetUiRuntimePacketArray(const UiRuntimePacketSnapshot& snapshot) noexcept;
const UiRuntimePacket* GetUiRuntimePacketAt(
    const UiRuntimePacketSnapshot& snapshot,
    std::size_t index) noexcept;
const UiRuntimePacket* FindUiRuntimePacketBySeq(
    const UiRuntimePacketSnapshot& snapshot,
    std::uint64_t seq) noexcept;
bool HasUiRuntimePacketSeq(
    const UiRuntimePacketSnapshot& snapshot,
    std::uint64_t seq) noexcept;
UiRuntimePacketSnapshot CopyUiRuntimePacketSnapshot(const UiRuntimePacketSnapshot& snapshot);
UiRuntimePacketSnapshot WithUiRuntimePacketSnapshotMetadata(
    const UiRuntimePacketSnapshot& snapshot,
    const UiRuntimePacketSnapshotMetadata& metadata);
UiRuntimePacketSnapshot RebuildUiRuntimePacketSnapshot(
    const UiRuntimePacketSnapshot& snapshot);
UiRuntimePacketSnapshot ReplaceUiRuntimePacketSnapshotPackets(
    const UiRuntimePacketSnapshot& snapshot,
    std::vector<UiRuntimePacket> packets);
UiRuntimePacketSnapshot WithUiRuntimePacketSnapshotSource(
    const UiRuntimePacketSnapshot& snapshot,
    std::string source);
UiRuntimePacketSnapshot ClearUiRuntimePacketSnapshotSource(const UiRuntimePacketSnapshot& snapshot);
UiRuntimePacketSnapshot WithUiRuntimePacketSnapshotError(
    const UiRuntimePacketSnapshot& snapshot,
    std::string error);
UiRuntimePacketSnapshot ClearUiRuntimePacketSnapshotError(const UiRuntimePacketSnapshot& snapshot);
UiRuntimePacketSnapshot ClearUiRuntimePacketSnapshotMetadata(
    const UiRuntimePacketSnapshot& snapshot);
UiRuntimePacketSnapshot WithUiRuntimePacketSnapshotPackets(
    const UiRuntimePacketSnapshot& snapshot,
    std::vector<UiRuntimePacket> packets);
UiRuntimePacketSnapshot WithUiRuntimePacketSnapshotMetadataAndPackets(
    const UiRuntimePacketSnapshotMetadata& metadata,
    std::vector<UiRuntimePacket> packets);
UiRuntimePacketSnapshot ClearUiRuntimePacketSnapshotPackets(const UiRuntimePacketSnapshot& snapshot);
UiRuntimePacketSnapshot WithUiRuntimePacketAppended(const UiRuntimePacketSnapshot& snapshot, const UiRuntimePacket& packet);
UiRuntimePacketSnapshot WithUiRuntimePacketsAppended(
    const UiRuntimePacketSnapshot& snapshot,
    const std::vector<UiRuntimePacket>& packets);

void ValidateUiRuntimePacket(const UiRuntimePacket& packet);
void ValidateUiRuntimePacketSequence(const std::vector<UiRuntimePacket>& packets);
UiRuntimePacketSnapshot BuildUiRuntimePacketSnapshot(const std::vector<UiRuntimePacket>& packets);
UiRuntimePacketSnapshotMetadata ParseUiRuntimePacketSnapshotMetadata(const JsonValue& value);
UiRuntimePacketSnapshotMetadata ParseUiRuntimePacketSnapshotMetadata(const char* text);
UiRuntimePacketSnapshotMetadata ParseUiRuntimePacketSnapshotMetadata(const std::string& text);
UiRuntimePacketSnapshot ParseUiRuntimePacketSnapshot(const JsonValue& value);
UiRuntimePacketSnapshot ParseUiRuntimePacketSnapshot(const char* text);
UiRuntimePacketSnapshot ParseUiRuntimePacketSnapshot(const std::string& text);

std::vector<const UiRuntimePacket*> FindUiRuntimePacketsByKind(
    const std::vector<UiRuntimePacket>& packets,
    UiRuntimePacketKind kind) noexcept;
std::vector<const UiRuntimePacket*> FindUiRuntimePacketsByKind(
    const UiRuntimePacketSnapshot& snapshot,
    UiRuntimePacketKind kind) noexcept;
const UiRuntimePacket* FindLatestUiRuntimePacketByKind(
    const std::vector<UiRuntimePacket>& packets,
    UiRuntimePacketKind kind) noexcept;
const UiRuntimePacket* FindLatestUiRuntimePacketByKind(
    const UiRuntimePacketSnapshot& snapshot,
    UiRuntimePacketKind kind) noexcept;
const SceneReplacePacketPayload* GetLatestSceneReplacePacketPayload(const UiRuntimePacketSnapshot& snapshot) noexcept;
const UiStateReplacePacketPayload* GetLatestUiStateReplacePacketPayload(const UiRuntimePacketSnapshot& snapshot) noexcept;
const DisplayReplacePacketPayload* GetLatestDisplayReplacePacketPayload(const UiRuntimePacketSnapshot& snapshot) noexcept;
std::vector<WidgetAppendTextMatch> FindWidgetAppendTextPacketsByFrameId(
    const std::vector<UiRuntimePacket>& packets,
    std::string_view frame_id);
std::vector<WidgetAppendTextMatch> FindWidgetAppendTextPacketsByFrameId(
    const UiRuntimePacketSnapshot& snapshot,
    std::string_view frame_id);
std::vector<WidgetAppendTextMatch> FindWidgetAppendTextPacketsByWidgetId(
    const std::vector<UiRuntimePacket>& packets,
    std::string_view widget_id);
std::vector<WidgetAppendTextMatch> FindWidgetAppendTextPacketsByWidgetId(
    const UiRuntimePacketSnapshot& snapshot,
    std::string_view widget_id);
std::optional<WidgetAppendTextMatch> FindLatestWidgetAppendTextPacket(
    const std::vector<UiRuntimePacket>& packets);
std::optional<WidgetAppendTextMatch> FindLatestWidgetAppendTextPacket(
    const UiRuntimePacketSnapshot& snapshot);
std::optional<WidgetAppendTextMatch> FindLatestWidgetAppendTextPacketByFrameId(
    const std::vector<UiRuntimePacket>& packets,
    std::string_view frame_id);
std::optional<WidgetAppendTextMatch> FindLatestWidgetAppendTextPacketByFrameId(
    const UiRuntimePacketSnapshot& snapshot,
    std::string_view frame_id);
std::optional<WidgetAppendTextMatch> FindLatestWidgetAppendTextPacketByWidgetId(
    const std::vector<UiRuntimePacket>& packets,
    std::string_view widget_id);
std::optional<WidgetAppendTextMatch> FindLatestWidgetAppendTextPacketByWidgetId(
    const UiRuntimePacketSnapshot& snapshot,
    std::string_view widget_id);

const SceneReplacePacketPayload* AsSceneReplacePacketPayload(const UiRuntimePacket& packet) noexcept;
const UiStateReplacePacketPayload* AsUiStateReplacePacketPayload(const UiRuntimePacket& packet) noexcept;
const DisplayReplacePacketPayload* AsDisplayReplacePacketPayload(const UiRuntimePacket& packet) noexcept;
const WidgetAppendTextPacketPayload* AsWidgetAppendTextPacketPayload(const UiRuntimePacket& packet) noexcept;
const InputEventPacketPayload* AsInputEventPacketPayload(const UiRuntimePacket& packet) noexcept;

const JsonValue::Object& GetInputEventObject(const InputEventPacketPayload& payload) noexcept;
bool HasInputEventField(const InputEventPacketPayload& payload, std::string_view key) noexcept;
const JsonValue* FindInputEventField(const InputEventPacketPayload& payload, std::string_view key) noexcept;
const JsonValue& RequireInputEventField(const InputEventPacketPayload& payload, std::string_view key);
std::string GetInputEventName(const InputEventPacketPayload& payload);
std::optional<std::string> GetInputEventFrameId(const InputEventPacketPayload& payload);
std::optional<std::string> GetInputEventWidgetId(const InputEventPacketPayload& payload);
std::optional<double> GetInputEventNumberField(const InputEventPacketPayload& payload, std::string_view key);
std::optional<bool> GetInputEventBooleanField(const InputEventPacketPayload& payload, std::string_view key);
std::optional<std::string> GetInputEventStringField(const InputEventPacketPayload& payload, std::string_view key);
std::optional<std::uint64_t> GetInputEventButtons(const InputEventPacketPayload& payload);
std::optional<double> GetInputEventX(const InputEventPacketPayload& payload);
std::optional<double> GetInputEventY(const InputEventPacketPayload& payload);
std::size_t CountInputEventsByName(
    const std::vector<UiRuntimePacket>& packets,
    std::string_view event_name);
std::size_t CountInputEventsByName(
    const UiRuntimePacketSnapshot& snapshot,
    std::string_view event_name);
std::size_t CountInputEventsByFrameId(
    const std::vector<UiRuntimePacket>& packets,
    std::string_view frame_id);
std::size_t CountInputEventsByFrameId(
    const UiRuntimePacketSnapshot& snapshot,
    std::string_view frame_id);
std::size_t CountInputEventsByWidgetId(
    const std::vector<UiRuntimePacket>& packets,
    std::string_view widget_id);
std::size_t CountInputEventsByWidgetId(
    const UiRuntimePacketSnapshot& snapshot,
    std::string_view widget_id);

std::vector<InputEventMatch> FindInputEventsByName(
    const std::vector<UiRuntimePacket>& packets,
    std::string_view event_name);
std::vector<InputEventMatch> FindInputEventsByName(
    const UiRuntimePacketSnapshot& snapshot,
    std::string_view event_name);
std::vector<InputEventMatch> FindInputEventsByFrameId(
    const std::vector<UiRuntimePacket>& packets,
    std::string_view frame_id);
std::vector<InputEventMatch> FindInputEventsByFrameId(
    const UiRuntimePacketSnapshot& snapshot,
    std::string_view frame_id);
std::vector<InputEventMatch> FindInputEventsByWidgetId(
    const std::vector<UiRuntimePacket>& packets,
    std::string_view widget_id);
std::vector<InputEventMatch> FindInputEventsByWidgetId(
    const UiRuntimePacketSnapshot& snapshot,
    std::string_view widget_id);
std::optional<InputEventMatch> FindLatestInputEvent(
    const std::vector<UiRuntimePacket>& packets);
std::optional<InputEventMatch> FindLatestInputEvent(
    const UiRuntimePacketSnapshot& snapshot);
std::optional<InputEventMatch> FindLatestInputEventByName(
    const std::vector<UiRuntimePacket>& packets,
    std::string_view event_name);
std::optional<InputEventMatch> FindLatestInputEventByName(
    const UiRuntimePacketSnapshot& snapshot,
    std::string_view event_name);
std::optional<InputEventMatch> FindLatestInputEventByFrameId(
    const std::vector<UiRuntimePacket>& packets,
    std::string_view frame_id);
std::optional<InputEventMatch> FindLatestInputEventByFrameId(
    const UiRuntimePacketSnapshot& snapshot,
    std::string_view frame_id);
std::optional<InputEventMatch> FindLatestInputEventByWidgetId(
    const std::vector<UiRuntimePacket>& packets,
    std::string_view widget_id);
std::optional<InputEventMatch> FindLatestInputEventByWidgetId(
    const UiRuntimePacketSnapshot& snapshot,
    std::string_view widget_id);

std::string SerializeUiRuntimePacket(const UiRuntimePacket& packet, int indent = 2);
std::string SerializeUiRuntimePackets(const std::vector<UiRuntimePacket>& packets, int indent = 2);
std::string SerializeUiRuntimePacketSnapshotMetadata(
    const UiRuntimePacketSnapshotMetadata& metadata,
    int indent = 2);
std::string SerializeUiRuntimePacketSnapshotPackets(const UiRuntimePacketSnapshot& snapshot, int indent = 2);
std::string SerializeUiRuntimePacketSnapshot(const UiRuntimePacketSnapshot& snapshot, int indent = 2);

UiRuntimePacket ParseUiRuntimePacket(const JsonValue& value);
UiRuntimePacket ParseUiRuntimePacket(const std::string& text);
std::vector<UiRuntimePacket> ParseUiRuntimePackets(const JsonValue& value);
std::vector<UiRuntimePacket> ParseUiRuntimePackets(const std::string& text);

}  // namespace vf
