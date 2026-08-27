cmake_minimum_required(VERSION 3.18)
project(vkf_symengine_benchmark LANGUAGES CXX)

find_package(SymEngine CONFIG REQUIRED)

add_executable(symengine_runner symengine_runner.cpp)
target_compile_features(symengine_runner PRIVATE cxx_std_17)
target_include_directories(symengine_runner PRIVATE ${SYMENGINE_INCLUDE_DIRS})
target_link_libraries(symengine_runner PRIVATE ${SYMENGINE_LIBRARIES})

if(MSVC)
  target_compile_options(symengine_runner PRIVATE /O2 /DNDEBUG /EHsc)
else()
  target_compile_options(symengine_runner PRIVATE -O3 -DNDEBUG)
endif()
