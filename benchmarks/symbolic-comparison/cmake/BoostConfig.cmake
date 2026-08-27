# Header-only Boost discovery for the pinned SymEngine boostmp benchmark build.
if(NOT DEFINED BOOST_ROOT OR NOT EXISTS "${BOOST_ROOT}/boost/multiprecision/cpp_int.hpp")
  set(Boost_FOUND FALSE)
  set(Boost_NOT_FOUND_MESSAGE "Set BOOST_ROOT to an extracted Boost source tree")
  return()
endif()

set(Boost_FOUND TRUE)
set(Boost_VERSION "1.86.0")
set(Boost_INCLUDE_DIRS "${BOOST_ROOT}")
set(Boost_LIBRARIES "")
