cmake_minimum_required(VERSION 3.20)

project(vkf_linalg_eigen_runner LANGUAGES CXX)

include(FetchContent)

find_package(Eigen3 5.0.0 EXACT CONFIG QUIET)
if(NOT Eigen3_FOUND)
  FetchContent_Declare(
    eigen
    GIT_REPOSITORY https://gitlab.com/libeigen/eigen.git
    GIT_TAG 5.0.0
    GIT_SHALLOW TRUE
  )
  set(EIGEN_BUILD_DOC OFF CACHE BOOL "" FORCE)
  set(BUILD_TESTING OFF CACHE BOOL "" FORCE)
  FetchContent_MakeAvailable(eigen)
endif()

add_executable(vkf-linalg-eigen runner.cpp)
target_compile_features(vkf-linalg-eigen PRIVATE cxx_std_20)
target_compile_definitions(
  vkf-linalg-eigen
  PRIVATE EIGEN_DONT_PARALLELIZE VKF_EIGEN_BENCHMARK_VERSION="5.0.0"
)
target_link_libraries(vkf-linalg-eigen PRIVATE Eigen3::Eigen)

if(MSVC)
  target_compile_options(vkf-linalg-eigen PRIVATE /O2 /DNDEBUG)
else()
  target_compile_options(vkf-linalg-eigen PRIVATE -O3 -DNDEBUG)
endif()
