cmake_minimum_required(VERSION 3.20)

project(vektor_flow_native_compiler LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

get_filename_component(VKF_REPO_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../.." ABSOLUTE)
set(VKF_JSON_SOURCE "${VKF_REPO_ROOT}/native/VfOverlay/vf/json.cpp")
set(VKF_CSV_DEMAND_SOURCE "${CMAKE_CURRENT_SOURCE_DIR}/vkf_csv_demand_source_scanner.cpp")

function(vkf_native_target target source uses_json)
    add_executable(${target} "${CMAKE_CURRENT_SOURCE_DIR}/${source}")
    if(uses_json)
        target_sources(${target} PRIVATE "${VKF_JSON_SOURCE}")
    endif()
    target_include_directories(${target} PRIVATE
        "${VKF_REPO_ROOT}"
        "${VKF_REPO_ROOT}/native/VfOverlay"
    )
    set_target_properties(${target} PROPERTIES
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
    )
endfunction()

vkf_native_target(vkf vkf_driver_artifact_smoke.cpp TRUE)
target_sources(vkf PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}/vkf_lexer_cursor_smoke.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/vkf_parser_token_stream_smoke.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/vkf_ast_to_ir_smoke.cpp"
    "${VKF_CSV_DEMAND_SOURCE}"
)
target_compile_definitions(vkf PRIVATE VKF_NATIVE_FRONTEND_LIBRARY)
vkf_native_target(vkf_lexer_cursor_smoke vkf_lexer_cursor_smoke.cpp FALSE)
vkf_native_target(vkf_parser_token_stream_smoke vkf_parser_token_stream_smoke.cpp TRUE)
vkf_native_target(vkf_ast_to_ir_smoke vkf_ast_to_ir_smoke.cpp TRUE)
target_sources(vkf_ast_to_ir_smoke PRIVATE "${VKF_CSV_DEMAND_SOURCE}")
if(WIN32)
    # Match vkf-strict's native frontend stack reserve. The standalone IR
    # producer lowers the same source graphs but does not include the backend
    # header that supplies this linker directive to vkf-strict.
    target_link_options(vkf_ast_to_ir_smoke PRIVATE "/STACK:8388608")
endif()
vkf_native_target(vkf_bootstrap_bundle_artifact_smoke vkf_bootstrap_bundle_artifact_smoke.cpp TRUE)
vkf_native_target(vkf_compiler_artifact_smoke vkf_compiler_artifact_smoke.cpp TRUE)
vkf_native_target(vkf_arm64_artifact vkf_arm64_artifact.cpp TRUE)
# Structural bootstrap test oracle only; excluded from installed compiler tools.
vkf_native_target(vkf_private_machine_operands ../../tests/bootstrap/private-machine-operands.cpp TRUE)
vkf_native_target(vkf_private_f64_bytes ../../tests/bootstrap/private-f64-bytes.cpp FALSE)
set(VKF_AOT_TARGETS)
if(CMAKE_SIZEOF_VOID_P EQUAL 8 AND CMAKE_SYSTEM_PROCESSOR MATCHES "(AMD64|amd64|x86_64)")
    vkf_native_target(vkf_private_x64_prefix ../../tests/bootstrap/private-x64-prefix.cpp TRUE)
    vkf_native_target(vkf_x64_artifact vkf_x64_artifact.cpp TRUE)
    target_sources(vkf_bootstrap_bundle_artifact_smoke PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/vkf_x64_artifact.cpp"
    )
    target_compile_definitions(vkf_bootstrap_bundle_artifact_smoke PRIVATE
        VKF_X64_BACKEND_LIBRARY
    )
    vkf_native_target(vkf_x64_runner_template vkf_x64_runner_template.cpp FALSE)
    target_sources(vkf PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/vkf_x64_artifact.cpp")
    target_compile_definitions(vkf PRIVATE VKF_X64_BACKEND_LIBRARY)
    vkf_native_target(vkf_strict vkf_driver_artifact_smoke.cpp TRUE)
    target_sources(vkf_strict PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/vkf_lexer_cursor_smoke.cpp"
        "${CMAKE_CURRENT_SOURCE_DIR}/vkf_parser_token_stream_smoke.cpp"
        "${CMAKE_CURRENT_SOURCE_DIR}/vkf_ast_to_ir_smoke.cpp"
        "${CMAKE_CURRENT_SOURCE_DIR}/vkf_x64_artifact.cpp"
        "${VKF_CSV_DEMAND_SOURCE}"
    )
    target_compile_definitions(vkf_strict PRIVATE
        VKF_NATIVE_FRONTEND_LIBRARY
        VKF_X64_BACKEND_LIBRARY
        VKF_STRICT_DIRECT_ONLY
    )
    set_target_properties(vkf_strict PROPERTIES OUTPUT_NAME "vkf-strict")
    if(UNIX AND NOT APPLE)
        target_link_options(vkf_strict PRIVATE "-static-libstdc++" "-static-libgcc")
    endif()
    if(WIN32)
        vkf_native_target(vkf_cpp_aot_artifact vkf_cpp_aot_artifact.cpp TRUE)
        vkf_native_target(
            vkf_linalg_factor_x64_test
            kernels/vkf_linalg_factor_x64_test.cpp
            FALSE
        )
        target_link_options(vkf_x64_runner_template PRIVATE "/NODEFAULTLIB")
        target_link_libraries(vkf_x64_runner_template PRIVATE
            legacy_stdio_definitions.lib
            legacy_stdio_wide_specifiers.lib
            ucrt.lib
            kernel32.lib
        )
        list(APPEND VKF_AOT_TARGETS vkf_cpp_aot_artifact)
    elseif(UNIX AND NOT APPLE)
        # Stage 0 links this template once. Per-program direct artifacts only
        # replace the executable code slot, and avoid dynamic-loader startup.
        target_link_options(vkf_x64_runner_template PRIVATE "-static" "-s")
    endif()
    list(APPEND VKF_AOT_TARGETS
        vkf_x64_artifact
        vkf_x64_runner_template
        vkf_strict
    )
endif()
if(APPLE AND CMAKE_SYSTEM_PROCESSOR MATCHES "(arm64|aarch64|ARM64)")
    vkf_native_target(vkf_strict vkf_driver_artifact_smoke.cpp TRUE)
    target_sources(vkf_strict PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/vkf_lexer_cursor_smoke.cpp"
        "${CMAKE_CURRENT_SOURCE_DIR}/vkf_parser_token_stream_smoke.cpp"
        "${CMAKE_CURRENT_SOURCE_DIR}/vkf_ast_to_ir_smoke.cpp"
        "${VKF_CSV_DEMAND_SOURCE}"
    )
    target_compile_definitions(vkf_strict PRIVATE
        VKF_NATIVE_FRONTEND_LIBRARY
        VKF_ARM64_BACKEND_LIBRARY
        VKF_STRICT_DIRECT_ONLY
    )
    set_target_properties(vkf_strict PROPERTIES OUTPUT_NAME "vkf-strict")
    list(APPEND VKF_AOT_TARGETS vkf_strict)
endif()
vkf_native_target(vkf_wasm_artifact_smoke vkf_wasm_artifact_smoke.cpp TRUE)
vkf_native_target(vkf_symbolic_kernel_artifact vkf_symbolic_kernel_artifact.cpp TRUE)
vkf_native_target(vkf_webgpu_artifact_smoke vkf_webgpu_artifact_smoke.cpp TRUE)
vkf_native_target(
    vkf_adaptive_optimizer_contract_test
    vkf_adaptive_optimizer_contract_test.cpp
    FALSE
)
find_package(Threads REQUIRED)
target_link_libraries(vkf_adaptive_optimizer_contract_test PRIVATE Threads::Threads)
vkf_native_target(vkf_layer_time_runtime_test vkf_layer_time_runtime_test.cpp TRUE)

install(TARGETS
    vkf
    vkf_lexer_cursor_smoke
    vkf_parser_token_stream_smoke
    vkf_ast_to_ir_smoke
    vkf_compiler_artifact_smoke
    vkf_arm64_artifact
    ${VKF_AOT_TARGETS}
    vkf_wasm_artifact_smoke
    vkf_symbolic_kernel_artifact
    vkf_webgpu_artifact_smoke
    RUNTIME DESTINATION bin
)
