OUTPUT := build/shared-compiler
SOURCES := compiler/native/vkf_browser_compiler.cpp \
 compiler/native/vkf_browser_host_policy.cpp \
 compiler/native/vkf_lexer_cursor_smoke.cpp \
 compiler/native/vkf_parser_token_stream_smoke.cpp \
 compiler/native/vkf_ast_to_ir_smoke.cpp \
 compiler/native/vkf_csv_demand_source_scanner.cpp native/VfOverlay/vf/json.cpp
WASM_OBJECTS := $(addprefix $(OUTPUT)/wasm/,$(SOURCES:.cpp=.o))
NATIVE_OBJECTS := $(addprefix $(OUTPUT)/native/,$(SOURCES:.cpp=.o))
COMMON := -std=c++17 -O1 -I. -Inative/VfOverlay -I$(OUTPUT) -DVKF_NATIVE_FRONTEND_LIBRARY
EXPORTS := '["_vkf_compile_source","_vkf_emit_program","_vkf_describe_tests","_vkf_select_test_files","_vkf_format_stdout","_vkf_format_retained_ui_packets","_vkf_program_pointer","_vkf_program_length","_vkf_result_pointer","_vkf_result_length","_malloc","_free"]'

.PHONY: all
all: $(OUTPUT)/vkf-compiler.wasm $(OUTPUT)/vkf-compiler-probe

$(OUTPUT)/wasm/%.o: %.cpp scripts/shared-compiler.mk
	mkdir -p $(@D)
	em++ $(COMMON) -fwasm-exceptions -MMD -MP -c $< -o $@

$(OUTPUT)/native/%.o: %.cpp scripts/shared-compiler.mk
	mkdir -p $(@D)
	g++ $(COMMON) -DVKF_BROWSER_COMPILER_PROBE -MMD -MP -c $< -o $@

$(OUTPUT)/vkf-compiler.wasm: $(WASM_OBJECTS) scripts/shared-compiler.mk
	em++ $(WASM_OBJECTS) -fwasm-exceptions --no-entry -sSTANDALONE_WASM=1 \
	 -sFILESYSTEM=0 -sALLOW_MEMORY_GROWTH=0 -sINITIAL_MEMORY=268435456 \
	 -sSTACK_SIZE=8388608 -sEXPORTED_FUNCTIONS=$(EXPORTS) -o $@

$(OUTPUT)/vkf-compiler-probe: $(NATIVE_OBJECTS) scripts/shared-compiler.mk
	g++ $(NATIVE_OBJECTS) -o $@

-include $(WASM_OBJECTS:.o=.d) $(NATIVE_OBJECTS:.o=.d)
