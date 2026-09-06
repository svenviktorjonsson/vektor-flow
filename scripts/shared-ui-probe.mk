# Build only into the isolated test artifact directory; never the release artifact.
override OUTPUT := build/shared-ui-probe
include scripts/shared-compiler.mk
COMMON += -DVKF_PRIVATE_UI_EFFECTS_TEST_PROBE -Ibuild/shared-compiler
EXPORTS := '["_vkf_compile_source","_vkf_emit_program","_vkf_describe_tests","_vkf_select_test_files","_vkf_format_stdout","_vkf_format_retained_ui_packets","_vkf_format_ui_packets","_vkf_program_pointer","_vkf_program_length","_vkf_result_pointer","_vkf_result_length","_malloc","_free"]'

$(WASM_OBJECTS) $(NATIVE_OBJECTS): scripts/shared-ui-probe.mk
