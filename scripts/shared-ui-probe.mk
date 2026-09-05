# Build only into the isolated test artifact directory; never the release artifact.
override OUTPUT := build/shared-ui-probe
include scripts/shared-compiler.mk
COMMON += -DVKF_PRIVATE_UI_EFFECTS_TEST_PROBE -Ibuild/shared-compiler

$(WASM_OBJECTS) $(NATIVE_OBJECTS): scripts/shared-ui-probe.mk
