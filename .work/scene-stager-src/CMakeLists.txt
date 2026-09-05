cmake_minimum_required(VERSION 3.20)
project(vkf_focused_scene_stager LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
add_executable(vkf-native-scene-artifact-stager
  ../../compiler/native/vkf_native_scene_artifact_stager.cpp
  ../../native/VfOverlay/vf/json.cpp
)
target_include_directories(vkf-native-scene-artifact-stager PRIVATE
  C:/Users/developer/Documents/ViktorTemp/vektor-flow/.work/recovery/VKF-Recovery-2026-09-04/dirty-payload/010-041-rabbit-gallery/untracked
  ../..
  ../../native/VfOverlay
)
add_executable(vkf_wasm_artifact_smoke
  ../../compiler/native/vkf_wasm_artifact_smoke.cpp
  ../../native/VfOverlay/vf/json.cpp
)
target_include_directories(vkf_wasm_artifact_smoke PRIVATE
  C:/Users/developer/Documents/ViktorTemp/vektor-flow/.work/recovery/VKF-Recovery-2026-09-04/dirty-payload/010-041-rabbit-gallery/untracked
  ../..
  ../../native/VfOverlay
)
set_target_properties(vkf_wasm_artifact_smoke PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY ../../native-p-complex-compiler/bin
)
