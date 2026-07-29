from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_tagged_value_layout_is_fixed_and_documented() -> None:
    source = (
        ROOT / "compiler/native/vkf_wasm_value_layout.hpp"
    ).read_text(encoding="utf-8")
    assert "slot_size = 16" in source
    assert "tag_offset = 0" in source
    assert "length_offset = 4" in source
    assert "payload_offset = 8" in source
    assert "record_entry_size = 8" in source
    for tag in ("Null", "Boolean", "Number", "Utf8String", "Array", "Record"):
        assert tag in source


def test_value_layout_has_no_host_object_arena() -> None:
    source = (
        ROOT / "compiler/native/vkf_wasm_value_layout.hpp"
    ).read_text(encoding="utf-8")
    forbidden = ("unordered_map", "shared_ptr", "std::string", "std::vector")
    assert all(token not in source for token in forbidden)


def test_browser_transport_exports_are_documented() -> None:
    source = (
        ROOT / "compiler/native/vkf_wasm_value_layout.hpp"
    ).read_text(encoding="utf-8")
    for export in (
        "vkf_vm_value_slot_size",
        "vkf_vm_arguments_ptr/capacity",
        "vkf_vm_results_ptr/capacity",
        "vkf_vm_heap_base/ptr/limit",
        "vkf_vm_alloc",
        "vkf_vm_reset",
        "vkf_vm_invoke",
        "vkf_vm_evaluate",
    ):
        assert export in source
