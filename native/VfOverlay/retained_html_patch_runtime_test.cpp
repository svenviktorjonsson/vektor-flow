#include "vf/ui_runtime_contract.hpp"

#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

int Fail(const char* message) {
    std::cerr << message << std::endl;
    return 1;
}

bool Rejects(const std::string& packets) {
    try {
        static_cast<void>(vf::ParseUiRuntimePackets(packets));
        return false;
    } catch (const std::exception&) {
        return true;
    }
}

}  // namespace

int main() {
    const std::string packets_json =
        "[{\"seq\":1,\"kind\":\"__vf_internal_html.patch\",\"payload\":{"
        "\"__vf_internal_retained_html_patch\":{\"version\":1,"
        "\"owner\":{\"kind\":\"frame\",\"id\":\"frame-0\"},\"target\":0,"
        "\"mutation\":{\"tag\":1,\"name\":\"\",\"value\":\"Ready\"}}}},"
        "{\"seq\":2,\"kind\":\"__vf_internal_html.patch\",\"payload\":{"
        "\"__vf_internal_retained_html_patch\":{\"version\":1,"
        "\"owner\":{\"kind\":\"frame\",\"id\":\"frame-0\"},\"target\":0,"
        "\"mutation\":{\"tag\":2,\"name\":\"title\",\"value\":\"Run\"}}}}]";
    const std::vector<vf::UiRuntimePacket> packets = vf::ParseUiRuntimePackets(packets_json);
    if (packets.size() != 2 ||
        packets[0].kind != vf::UiRuntimePacketKind::InternalHtmlPatch ||
        packets[1].kind != vf::UiRuntimePacketKind::InternalHtmlPatch ||
        packets[0].seq != 1 || packets[1].seq != 2) {
        return Fail("native retained HTML patch ordering mismatch");
    }
    const vf::InternalHtmlPatchPacketPayload* first =
        vf::AsInternalHtmlPatchPacketPayload(packets[0]);
    if (first == nullptr || first->patch.at("target").as_number() != 0.0) {
        return Fail("native retained HTML patch payload mismatch");
    }
    const std::vector<vf::UiRuntimePacket> round_trip = vf::ParseUiRuntimePackets(
        vf::SerializeUiRuntimePackets(packets, -1));
    if (round_trip.size() != packets.size() ||
        round_trip[0].seq != 1 || round_trip[1].seq != 2) {
        return Fail("native retained HTML patch round-trip mismatch");
    }

    const std::string unsafe =
        "[{\"seq\":1,\"kind\":\"__vf_internal_html.patch\",\"payload\":{"
        "\"__vf_internal_retained_html_patch\":{\"version\":1,"
        "\"owner\":{\"kind\":\"frame\",\"id\":\"frame-0\"},\"target\":0,"
        "\"mutation\":{\"tag\":2,\"name\":\"onclick\",\"value\":\"unsafe()\"}}}}]";
    const std::string unknown_owner =
        "[{\"seq\":1,\"kind\":\"__vf_internal_html.patch\",\"payload\":{"
        "\"__vf_internal_retained_html_patch\":{\"version\":1,"
        "\"owner\":{\"kind\":\"surface\",\"id\":\"frame-0\"},\"target\":0,"
        "\"mutation\":{\"tag\":1,\"name\":\"\",\"value\":\"bad\"}}}}]";
    if (!Rejects(unsafe) || !Rejects(unknown_owner)) {
        return Fail("native retained HTML patch accepted malformed input");
    }

    std::cout << "vf-retained-html-patch-runtime-test passed" << std::endl;
    return 0;
}
