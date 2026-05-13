cmake_minimum_required(VERSION 3.14)
if(CMAKE_VERSION VERSION_GREATER_EQUAL "4.0")
  set(CMAKE_POLICY_VERSION_MINIMUM "3.5" CACHE STRING "" FORCE)
endif()

project(vf-overlay CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

get_filename_component(VF_REPO_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../.." ABSOLUTE)

if(NOT TARGET vf-core-runtime)
  add_subdirectory("${VF_REPO_ROOT}/native/VfCore" "${CMAKE_BINARY_DIR}/vfcore")
endif()

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

add_executable(vf-overlay WIN32
  main.cpp
  overlay_geometry_ledger_runtime.cpp
  overlay_packet_runtime.cpp
)
target_include_directories(vf-overlay PRIVATE
  "${WV2_INCLUDE_DIR}"
  "${cjson_SOURCE_DIR}"
)
target_link_libraries(vf-overlay PRIVATE
  vf-core-runtime
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
  ws2_32
  shlwapi
  d3d11
  dxgi
  dcomp
)
target_compile_definitions(vf-overlay PRIVATE UNICODE _UNICODE)

add_custom_command(TARGET vf-overlay POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E make_directory
  "$<TARGET_FILE_DIR:vf-overlay>/web"
  COMMAND ${CMAKE_COMMAND} -E copy_directory
  "${VF_REPO_ROOT}/web/vf-ui"
  "$<TARGET_FILE_DIR:vf-overlay>/web"
  COMMENT "Copy web/vf-ui to build output as web/"
)
