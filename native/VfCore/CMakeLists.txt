cmake_minimum_required(VERSION 3.14)

project(vf-core CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(vf-core-runtime STATIC
  src/geom_ledger_contract.cpp
  src/json.cpp
  src/runtime.cpp
  src/ui_runtime_contract.cpp
)
target_include_directories(vf-core-runtime PUBLIC
  "${CMAKE_CURRENT_SOURCE_DIR}/include"
)

add_executable(vf-core
  src/ast.cpp
  src/frontend.cpp
  src/lexer.cpp
  src/lexer_core.cpp
  src/lexer_literals.cpp
  src/lexer_symbols.cpp
  src/main.cpp
  src/parser.cpp
  src/parser_core.cpp
  src/parser_expr.cpp
  src/source.cpp
  src/token.cpp
)

target_include_directories(vf-core PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}/include"
)
target_link_libraries(vf-core PRIVATE
  vf-core-runtime
)
