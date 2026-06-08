cmake_minimum_required(VERSION 3.14)
if(CMAKE_VERSION VERSION_GREATER_EQUAL "4.0")
  set(CMAKE_POLICY_VERSION_MINIMUM "3.5" CACHE STRING "" FORCE)
endif()

project(vf-overlay CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
find_package(Python3 COMPONENTS Interpreter REQUIRED)

get_filename_component(VF_REPO_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../.." ABSOLUTE)

# WebView2 SDK (NuGet)
set(WV2_VERSION "1.0.2849.39")
set(WV2_PKG "${CMAKE_BINARY_DIR}/Microsoft.Web.WebView2.${WV2_VERSION}.nupkg")
set(WV2_ROOT "${CMAKE_BINARY_DIR}/webview2-sdk")

if(NOT EXISTS "${WV2_PKG}")
  file(DOWNLOAD
    "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/${WV2_VERSION}"
    "${WV2_PKG}"
    SHOW_PROGRESS)
endif()

if(NOT EXISTS "${WV2_PKG}")
  message(FATAL_ERROR "Download failed: ${WV2_PKG}")
endif()

file(MAKE_DIRECTORY "${WV2_ROOT}")
if(NOT EXISTS "${WV2_ROOT}/.extracted")
  execute_process(
    COMMAND ${CMAKE_COMMAND} -E tar xf "${WV2_PKG}"
    WORKING_DIRECTORY "${WV2_ROOT}"
    COMMAND_ERROR_IS_FATAL ANY)
  file(WRITE "${WV2_ROOT}/.extracted" "1")
endif()

if(EXISTS "${WV2_ROOT}/build/native/include/WebView2.h")
  set(WV2_INCLUDE_DIR "${WV2_ROOT}/build/native/include")
else()
  file(GLOB_RECURSE WV2_HEADER "${WV2_ROOT}/**/WebView2.h")
  if(NOT WV2_HEADER)
    message(FATAL_ERROR "WebView2.h not found after extracting NuGet to ${WV2_ROOT}")
  endif()
  list(GET WV2_HEADER 0 WV2_H_PATH)
  get_filename_component(WV2_INCLUDE_DIR "${WV2_H_PATH}" DIRECTORY)
endif()

if(CMAKE_SIZEOF_VOID_P EQUAL 8)
  string(TOUPPER "${CMAKE_SYSTEM_PROCESSOR}" _wv2_proc)
  if(_wv2_proc STREQUAL "ARM64")
    set(WV2_ARCH "arm64")
  else()
    set(WV2_ARCH "x64")
  endif()
else()
  set(WV2_ARCH "x86")
endif()

set(WV2_LOADER_LIB "${WV2_ROOT}/build/native/${WV2_ARCH}/WebView2LoaderStatic.lib")
if(NOT EXISTS "${WV2_LOADER_LIB}")
  message(FATAL_ERROR
    "WebView2LoaderStatic.lib not found at ${WV2_LOADER_LIB}. "
    "Delete ${WV2_ROOT} (and ${WV2_ROOT}/.extracted) and reconfigure if the NuGet extract is incomplete.")
endif()

include(FetchContent)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(ENABLE_CJSON_TEST OFF CACHE BOOL "" FORCE)
FetchContent_Declare(
  cjson
  GIT_REPOSITORY https://github.com/DaveGamble/cJSON.git
  GIT_TAG        v1.7.18
)
FetchContent_MakeAvailable(cjson)

set(TRANSPARENT_OVERLAY_SOURCE_DIR "" CACHE PATH "Path to the Tesseracs packages/transparent-overlay source checkout")
set(VF_VENDORED_TRANSPARENT_OVERLAY_DIR "${VF_REPO_ROOT}/native/transparent-overlay-runtime")
set(VF_VENDORED_TRANSPARENT_OVERLAY_PLATFORM_DIR "${VF_VENDORED_TRANSPARENT_OVERLAY_DIR}/windows/${WV2_ARCH}")
set(TRANSPARENT_OVERLAY_INCLUDE_DIR "")
set(TRANSPARENT_OVERLAY_RUNTIME_DLL "")
set(TRANSPARENT_OVERLAY_HOST_EXE "")
if(NOT TRANSPARENT_OVERLAY_SOURCE_DIR)
  if(DEFINED ENV{TRANSPARENT_OVERLAY_SOURCE_DIR})
    set(TRANSPARENT_OVERLAY_SOURCE_DIR "$ENV{TRANSPARENT_OVERLAY_SOURCE_DIR}")
  endif()
endif()
if(EXISTS "${TRANSPARENT_OVERLAY_SOURCE_DIR}/CMakeLists.txt")
  set(TRANSPARENT_OVERLAY_BUILD_TESTS OFF CACHE BOOL "" FORCE)
  set(TRANSPARENT_OVERLAY_BUILD_HOST ON CACHE BOOL "" FORCE)
  set(TRANSPARENT_OVERLAY_BUILD_SHARED ON CACHE BOOL "" FORCE)
  add_subdirectory(
    "${TRANSPARENT_OVERLAY_SOURCE_DIR}"
    "${CMAKE_BINARY_DIR}/transparent-overlay"
  )
  set(TRANSPARENT_OVERLAY_INCLUDE_DIR "${TRANSPARENT_OVERLAY_SOURCE_DIR}/include")
  set(TRANSPARENT_OVERLAY_RUNTIME_DLL "$<TARGET_FILE:TransparentOverlay>")
  if(TARGET transparent-overlay-host)
    set(TRANSPARENT_OVERLAY_HOST_EXE "$<TARGET_FILE:transparent-overlay-host>")
  endif()
else()
  set(_vf_overlay_header "${VF_VENDORED_TRANSPARENT_OVERLAY_DIR}/include/transparent_overlay/overlay.h")
  set(_vf_overlay_dll "${VF_VENDORED_TRANSPARENT_OVERLAY_PLATFORM_DIR}/TransparentOverlay.dll")
  set(_vf_overlay_lib "${VF_VENDORED_TRANSPARENT_OVERLAY_PLATFORM_DIR}/TransparentOverlay.lib")
  set(_vf_overlay_host "${VF_VENDORED_TRANSPARENT_OVERLAY_PLATFORM_DIR}/transparent-overlay-host.exe")
  if(NOT EXISTS "${_vf_overlay_header}" OR NOT EXISTS "${_vf_overlay_dll}" OR NOT EXISTS "${_vf_overlay_lib}" OR NOT EXISTS "${_vf_overlay_host}")
    message(FATAL_ERROR
      "Transparent overlay runtime not found. Expected vendored artifacts under "
      "${VF_VENDORED_TRANSPARENT_OVERLAY_PLATFORM_DIR}. Copy TransparentOverlay.dll, "
      "TransparentOverlay.lib, and transparent-overlay-host.exe into the vendored runtime.")
  endif()
  add_library(TransparentOverlay SHARED IMPORTED GLOBAL)
  set_target_properties(TransparentOverlay PROPERTIES
    IMPORTED_LOCATION "${_vf_overlay_dll}"
    IMPORTED_IMPLIB "${_vf_overlay_lib}"
    INTERFACE_INCLUDE_DIRECTORIES "${VF_VENDORED_TRANSPARENT_OVERLAY_DIR}/include"
  )
  set(TRANSPARENT_OVERLAY_INCLUDE_DIR "${VF_VENDORED_TRANSPARENT_OVERLAY_DIR}/include")
  set(TRANSPARENT_OVERLAY_RUNTIME_DLL "${_vf_overlay_dll}")
  set(TRANSPARENT_OVERLAY_HOST_EXE "${_vf_overlay_host}")
endif()

set(VF_OVERLAY_HOST_SOURCES
  main.cpp
  overlay_geometry_ledger_runtime.cpp
  overlay_packet_runtime.cpp
  vf/compiled_ui_bootstrap_host.cpp
  vf/compiled_ui_bootstrap_packet_bridge.cpp
  vf/compiled_ui_bootstrap_runtime.cpp
  vf/compiled_ui_runtime_demo.cpp
  vf/compiled_ui_runtime_loader.cpp
  vf/compiled_ui_runtime_registry.cpp
  vf/crash_diagnostics.cpp
  vf/geom_ledger_contract.cpp
  vf/json.cpp
  vf/ui_runtime_contract.cpp
)

set(VF_OVERLAY_HOST_LIBS
  cjson
  "${WV2_LOADER_LIB}"
  ole32
  oleaut32
  uuid
  user32
  gdi32
  gdiplus
  crypt32
  shell32
  comdlg32
  advapi32
  dbghelp
  ws2_32
  shlwapi
  d3d11
  dxgi
  dcomp
)

add_library(VfOverlay SHARED
  ${VF_OVERLAY_HOST_SOURCES}
)
target_include_directories(VfOverlay PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}"
  "${WV2_INCLUDE_DIR}"
  "${cjson_SOURCE_DIR}"
)
target_compile_definitions(VfOverlay PRIVATE UNICODE _UNICODE VF_OVERLAY_BUILD_DLL VF_OVERLAY_NO_STANDALONE_MAIN)
target_link_libraries(VfOverlay PRIVATE ${VF_OVERLAY_HOST_LIBS})
set_target_properties(VfOverlay PROPERTIES
  OUTPUT_NAME "VfOverlay"
)
if(MSVC)
  target_compile_options(VfOverlay PRIVATE /Zi)
  target_link_options(VfOverlay PRIVATE /DEBUG /INCREMENTAL:NO)
endif()

add_executable(vf-overlay WIN32
  ${VF_OVERLAY_HOST_SOURCES}
)
target_include_directories(vf-overlay PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}"
  "${WV2_INCLUDE_DIR}"
  "${cjson_SOURCE_DIR}"
)
target_link_libraries(vf-overlay PRIVATE
  ${VF_OVERLAY_HOST_LIBS}
)
target_compile_definitions(vf-overlay PRIVATE UNICODE _UNICODE)
if(MSVC)
  target_compile_options(vf-overlay PRIVATE /Zi)
  target_link_options(vf-overlay PRIVATE /DEBUG /INCREMENTAL:NO)
endif()

file(GLOB_RECURSE VF_EMBEDDED_VF_UI_INPUTS CONFIGURE_DEPENDS
  "${VF_REPO_ROOT}/web/vf-ui/*"
)
set(VF_EMBEDDED_VF_UI_RC "${CMAKE_CURRENT_BINARY_DIR}/generated/embedded_vf_ui_assets.rc")
set(VF_EMBEDDED_VF_UI_CPP "${CMAKE_CURRENT_BINARY_DIR}/generated/embedded_vf_ui_assets.cpp")
set(VF_EMBEDDED_VF_UI_HPP "${CMAKE_CURRENT_BINARY_DIR}/generated/embedded_vf_ui_assets.hpp")
add_custom_command(
  OUTPUT
    "${VF_EMBEDDED_VF_UI_RC}"
    "${VF_EMBEDDED_VF_UI_CPP}"
    "${VF_EMBEDDED_VF_UI_HPP}"
  COMMAND "${Python3_EXECUTABLE}"
    "${CMAKE_CURRENT_SOURCE_DIR}/tools/generate_embedded_vf_ui_assets.py"
    "${VF_REPO_ROOT}/web/vf-ui"
    "${VF_EMBEDDED_VF_UI_RC}"
    "${VF_EMBEDDED_VF_UI_CPP}"
    "${VF_EMBEDDED_VF_UI_HPP}"
  DEPENDS
    "${CMAKE_CURRENT_SOURCE_DIR}/tools/generate_embedded_vf_ui_assets.py"
    ${VF_EMBEDDED_VF_UI_INPUTS}
  COMMENT "Embed web/vf-ui into vkf resources"
  VERBATIM
)
add_custom_target(vkf-embedded-vf-ui-assets
  DEPENDS
    "${VF_EMBEDDED_VF_UI_RC}"
    "${VF_EMBEDDED_VF_UI_CPP}"
    "${VF_EMBEDDED_VF_UI_HPP}"
)

add_executable(vkf
  vkf_launcher.cpp
  "${VF_EMBEDDED_VF_UI_CPP}"
  "${VF_EMBEDDED_VF_UI_RC}"
)
target_include_directories(vkf PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}"
  "${CMAKE_CURRENT_BINARY_DIR}/generated"
  "${TRANSPARENT_OVERLAY_INCLUDE_DIR}"
)
target_compile_definitions(vkf PRIVATE UNICODE _UNICODE VF_VKF_EMBED_OVERLAY_HOST)
target_link_libraries(vkf PRIVATE
  TransparentOverlay
  kernel32
)
if(MSVC)
  target_compile_options(vkf PRIVATE /Zi)
  target_link_options(vkf PRIVATE /DEBUG /INCREMENTAL:NO)
endif()
add_custom_command(TARGET vkf POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy_if_different
  "${TRANSPARENT_OVERLAY_RUNTIME_DLL}"
  "$<TARGET_FILE_DIR:vkf>"
  COMMENT "Copy TransparentOverlay runtime next to vkf"
)
if(TRANSPARENT_OVERLAY_HOST_EXE)
  add_custom_command(TARGET vkf POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
    "${TRANSPARENT_OVERLAY_HOST_EXE}"
    "$<TARGET_FILE_DIR:vkf>"
    COMMENT "Copy transparent overlay host next to vkf"
  )
endif()
add_dependencies(vkf vkf-embedded-vf-ui-assets)

add_executable(vkf-native-scene-artifact-stager
  ../../compiler/native/vkf_native_scene_artifact_stager.cpp
)
if(MSVC)
  target_compile_options(vkf-native-scene-artifact-stager PRIVATE /Zi)
  target_link_options(vkf-native-scene-artifact-stager PRIVATE /DEBUG /INCREMENTAL:NO)
endif()

add_library(vf-compiled-ui-demo SHARED
  vf/compiled_ui_runtime_demo.cpp
)
target_include_directories(vf-compiled-ui-demo PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}"
)
target_compile_definitions(vf-compiled-ui-demo PRIVATE UNICODE _UNICODE)
set_target_properties(vf-compiled-ui-demo PROPERTIES
  OUTPUT_NAME "vf-compiled-ui-demo"
)
if(MSVC)
  target_compile_options(vf-compiled-ui-demo PRIVATE /Zi)
  target_link_options(vf-compiled-ui-demo PRIVATE /DEBUG /INCREMENTAL:NO)
endif()

add_executable(vf-compiled-ui-demo-loader-test
  vf/compiled_ui_runtime_registry.cpp
  vf/compiled_ui_runtime_loader.cpp
  vf/compiled_ui_runtime_loader_test.cpp
)
target_include_directories(vf-compiled-ui-demo-loader-test PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}"
)
target_compile_definitions(vf-compiled-ui-demo-loader-test PRIVATE UNICODE _UNICODE)
target_link_libraries(vf-compiled-ui-demo-loader-test PRIVATE
  user32
  kernel32
)
if(MSVC)
  target_compile_options(vf-compiled-ui-demo-loader-test PRIVATE /Zi)
  target_link_options(vf-compiled-ui-demo-loader-test PRIVATE /DEBUG /INCREMENTAL:NO)
endif()

add_executable(vf-compiled-ui-runtime-registry-test
  vf/compiled_ui_runtime_registry.cpp
  vf/compiled_ui_runtime_registry_test.cpp
)
target_include_directories(vf-compiled-ui-runtime-registry-test PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}"
)
target_compile_definitions(vf-compiled-ui-runtime-registry-test PRIVATE UNICODE _UNICODE)
target_link_libraries(vf-compiled-ui-runtime-registry-test PRIVATE
  user32
  kernel32
)
if(MSVC)
  target_compile_options(vf-compiled-ui-runtime-registry-test PRIVATE /Zi)
  target_link_options(vf-compiled-ui-runtime-registry-test PRIVATE /DEBUG /INCREMENTAL:NO)
endif()

add_executable(vf-compiled-ui-bootstrap-runtime-test
  vf/compiled_ui_bootstrap_runtime.cpp
  vf/compiled_ui_runtime_registry.cpp
  vf/compiled_ui_runtime_loader.cpp
  vf/compiled_ui_bootstrap_runtime_test.cpp
)
target_include_directories(vf-compiled-ui-bootstrap-runtime-test PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}"
)
target_compile_definitions(vf-compiled-ui-bootstrap-runtime-test PRIVATE UNICODE _UNICODE)
target_link_libraries(vf-compiled-ui-bootstrap-runtime-test PRIVATE
  user32
  kernel32
)
if(MSVC)
  target_compile_options(vf-compiled-ui-bootstrap-runtime-test PRIVATE /Zi)
  target_link_options(vf-compiled-ui-bootstrap-runtime-test PRIVATE /DEBUG /INCREMENTAL:NO)
endif()

add_executable(vf-compiled-ui-bootstrap-packet-bridge-test
  overlay_packet_runtime.cpp
  vf/json.cpp
  vf/ui_runtime_contract.cpp
  vf/compiled_ui_bootstrap_packet_bridge.cpp
  vf/compiled_ui_bootstrap_runtime.cpp
  vf/compiled_ui_runtime_registry.cpp
  vf/compiled_ui_runtime_loader.cpp
  vf/compiled_ui_bootstrap_packet_bridge_test.cpp
)
target_include_directories(vf-compiled-ui-bootstrap-packet-bridge-test PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}"
)
target_compile_definitions(vf-compiled-ui-bootstrap-packet-bridge-test PRIVATE UNICODE _UNICODE)
target_link_libraries(vf-compiled-ui-bootstrap-packet-bridge-test PRIVATE
  user32
  kernel32
  ws2_32
)
if(MSVC)
  target_compile_options(vf-compiled-ui-bootstrap-packet-bridge-test PRIVATE /Zi)
  target_link_options(vf-compiled-ui-bootstrap-packet-bridge-test PRIVATE /DEBUG /INCREMENTAL:NO)
endif()

add_executable(vf-compiled-ui-bootstrap-host-test
  overlay_packet_runtime.cpp
  vf/json.cpp
  vf/ui_runtime_contract.cpp
  vf/compiled_ui_bootstrap_host.cpp
  vf/compiled_ui_bootstrap_packet_bridge.cpp
  vf/compiled_ui_bootstrap_runtime.cpp
  vf/compiled_ui_runtime_registry.cpp
  vf/compiled_ui_runtime_loader.cpp
  vf/compiled_ui_bootstrap_host_test.cpp
)
target_include_directories(vf-compiled-ui-bootstrap-host-test PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}"
)
target_compile_definitions(vf-compiled-ui-bootstrap-host-test PRIVATE UNICODE _UNICODE)
target_link_libraries(vf-compiled-ui-bootstrap-host-test PRIVATE
  user32
  kernel32
  ws2_32
)
if(MSVC)
  target_compile_options(vf-compiled-ui-bootstrap-host-test PRIVATE /Zi)
  target_link_options(vf-compiled-ui-bootstrap-host-test PRIVATE /DEBUG /INCREMENTAL:NO)
endif()

add_executable(overlay-packet-runtime-http-test
  overlay_packet_runtime.cpp
  overlay_packet_runtime_http_test.cpp
  vf/json.cpp
  vf/ui_runtime_contract.cpp
)
target_include_directories(overlay-packet-runtime-http-test PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}"
)
target_compile_definitions(overlay-packet-runtime-http-test PRIVATE UNICODE _UNICODE)
target_link_libraries(overlay-packet-runtime-http-test PRIVATE
  user32
  kernel32
  ws2_32
)
if(MSVC)
  target_compile_options(overlay-packet-runtime-http-test PRIVATE /Zi)
  target_link_options(overlay-packet-runtime-http-test PRIVATE /DEBUG /INCREMENTAL:NO)
endif()

add_executable(overlay-packet-runtime-input-test
  overlay_packet_runtime.cpp
  overlay_packet_runtime_input_test.cpp
  vf/json.cpp
  vf/ui_runtime_contract.cpp
)
target_include_directories(overlay-packet-runtime-input-test PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}"
)
target_compile_definitions(overlay-packet-runtime-input-test PRIVATE UNICODE _UNICODE)
target_link_libraries(overlay-packet-runtime-input-test PRIVATE
  user32
  kernel32
  ws2_32
)
if(MSVC)
  target_compile_options(overlay-packet-runtime-input-test PRIVATE /Zi)
  target_link_options(overlay-packet-runtime-input-test PRIVATE /DEBUG /INCREMENTAL:NO)
endif()

add_executable(overlay-packet-runtime-reload-test
  overlay_packet_runtime.cpp
  overlay_packet_runtime_reload_test.cpp
  vf/json.cpp
  vf/ui_runtime_contract.cpp
)
target_include_directories(overlay-packet-runtime-reload-test PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}"
)
target_compile_definitions(overlay-packet-runtime-reload-test PRIVATE UNICODE _UNICODE)
target_link_libraries(overlay-packet-runtime-reload-test PRIVATE
  user32
  kernel32
  ws2_32
)
if(MSVC)
  target_compile_options(overlay-packet-runtime-reload-test PRIVATE /Zi)
  target_link_options(overlay-packet-runtime-reload-test PRIVATE /DEBUG /INCREMENTAL:NO)
endif()

add_custom_command(TARGET vf-overlay POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E make_directory
  "$<TARGET_FILE_DIR:vf-overlay>/web"
  COMMAND ${CMAKE_COMMAND} -E copy_directory
  "${VF_REPO_ROOT}/web/vf-ui"
  "$<TARGET_FILE_DIR:vf-overlay>/web"
  COMMENT "Copy web/vf-ui to build output as web/"
)
